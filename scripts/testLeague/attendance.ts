/**
 * Who attends which event. Per event a target size (small 20-25, medium 30-40, large 40-55 unique fighters); per fighter a target number
 * of events (very active 10-12, most about 5, a few 2). Home region, team travel culture, the join date, declining and rare attendance all
 * shape a weight matrix, which is balanced (Sinkhorn) so rows hit the fighter targets and columns the event sizes, then sampled.
 */
import type { FighterDef, TeamDef } from './roster';
import { CITY_COORDS } from './roster';
import type { EventDef } from './events';
import { traitsOf, kFixedOf, teamTraitsOf } from './traits';
import { haversineKm, hash32, rngFor, weightedSample, gauss, yearOf, clamp } from './util';

const SIZE_RANGE = { small: [25, 25], medium: [39, 40], large: [54, 55] } as const;

export function eventTarget(ev: EventDef): number {
  const [lo, hi] = SIZE_RANGE[ev.size];
  return lo + (hash32(`size|${ev.slug}`) % (hi - lo + 1));
}

/** How willing a team is to go to an event (about 1 for its own backyard, small when far away). */
export function teamAffinity(team: TeamDef, ev: EventDef): number {
  const tt = teamTraitsOf(team.name);
  const d = haversineKm(CITY_COORDS[team.city], CITY_COORDS[ev.city]);
  let a = Math.exp(-d / tt.radiusKm) * (tt.provMult[ev.prov] ?? 1);
  if (ev.prov === 'AB' && tt.southAB && CITY_COORDS[ev.city][0] < 51.3) a *= tt.southAB;
  if (ev.prov !== team.prov) {
    a *= tt.awayShare;
    if (ev.size === 'large') a *= 1.5; // championships and big weekends draw travellers
  }
  return a;
}

export function kBase(f: FighterDef, teamName = ''): number {
  const fixed = kFixedOf(f.name);
  if (fixed !== undefined) return fixed;
  const h = hash32(`k|${f.name}`);
  return Math.max(2, Math.round(kRaw(f, h) * (teamName ? teamTraitsOf(teamName).kScale ?? 1 : 1)));
}
function kRaw(f: FighterDef, h: number): number {
  switch (traitsOf(f.name).k) {
    case 'very': return 10 + (h % 3);
    case 'high': return 6 + (h % 2);
    case 'norm': return 4 + (h % 3);
    case 'low': return 3;
    case 'rare': return 2;
  }
}

export interface AttendanceModel { attendees: Set<number>[]; weight: number[][]; k: number[] }

export function modelAttendance(teams: readonly TeamDef[], fighters: readonly FighterDef[], events: readonly EventDef[]): AttendanceModel {
  const F = fighters.length, E = events.length;
  const targets = events.map(eventTarget);
  const eligible = (f: FighterDef, ev: EventDef): boolean => f.joinDate < ev.start;
  const w: number[][] = fighters.map(f => {
    const tr = traitsOf(f.name);
    const team = teams[f.teamIdx];
    return events.map(ev => {
      if (!eligible(f, ev)) return 0;
      const sex = f.sex === 'male' ? 'men' : 'women';
      const canCompete = ev.divisions.some(d => d.gender === sex && f.disciplines.includes(d.cat));
      if (!canCompete) return 0;
      let x = teamAffinity(team, ev) * (tr.provMult[ev.prov] ?? 1) * (tr.cityMult[ev.city] ?? 1);
      if (tr.homeOnly && ev.prov !== 'AB') x *= 0.1;
      if (tr.majorOnly) x *= ev.size === 'large' ? 3 : ev.size === 'medium' ? 0.5 : 0.1;
      x *= tr.attFade ** Math.max(0, yearOf(ev.start) - 2024);
      x *= Math.exp(0.45 * gauss(rngFor(`att|${f.name}|${ev.slug}`)));
      // Clubs travel as squads: a club's men and women each tend to come together or not at all.
      x *= Math.exp(0.8 * gauss(rngFor(`squad|${team.name}|${f.sex}|${ev.slug}`)));
      if (f.disciplines.some(c => c === '5v5' || c === '3v3')) x *= Math.exp(1.1 * gauss(rngFor(`melee-squad|${team.name}|${f.sex}|${ev.slug}`)));
      return Math.max(0, x);
    });
  });
  // Fighter targets: fixed for the very active and the rare, scaled for the rest so the rows add up to the event sizes.
  const elig = w.map(row => row.filter(x => x > 0).length);
  const kb = fighters.map(f => kBase(f, teams[f.teamIdx].name));
  const fixed = fighters.map(f => traitsOf(f.name).k === 'very' || traitsOf(f.name).k === 'rare' || kFixedOf(f.name) !== undefined);
  const totalWanted = targets.reduce((a, b) => a + b, 0);
  const sum = (s: number): number => kb.reduce((acc, k, i) => acc + (fixed[i] ? Math.min(k, elig[i]) : Math.min(Math.round(k * s), elig[i], 9)), 0);
  let lo = 0.3, hi = 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (sum(mid) < totalWanted) lo = mid; else hi = mid; }
  const k = kb.map((x, i) => (fixed[i] ? Math.min(x, elig[i]) : Math.max(2, Math.min(Math.round(x * hi), elig[i], 9))));
  // Sinkhorn balancing of inclusion probabilities.
  const P = w.map(row => [...row]);
  for (let it = 0; it < 80; it++) {
    for (let f = 0; f < F; f++) {
      const s = P[f].reduce((a, b) => a + b, 0);
      if (s > 0) for (let e = 0; e < E; e++) P[f][e] = Math.min(0.97, (P[f][e] * k[f]) / s);
    }
    for (let e = 0; e < E; e++) {
      let s = 0;
      for (let f = 0; f < F; f++) s += P[f][e];
      if (s > 0) for (let f = 0; f < F; f++) P[f][e] = Math.min(0.97, (P[f][e] * targets[e]) / s);
    }
  }
  const attendees: Set<number>[] = events.map((ev, e) => {
    const weights = P.map(row => (row[e] > 0 ? row[e] / (1 - row[e] + 0.04) : 0));
    return new Set(weightedSample(weights, targets[e], rngFor(`sample|${ev.slug}`)));
  });
  // Repair: the very active attend at least their target, nobody attends more than 12, the rare exactly their number, everybody 2+.
  const count = (f: number): number => attendees.filter(s => s.has(f)).length;
  const protectedMin = (f: number): number => (fixed[f] ? k[f] : 3);
  const maxFor = (f: number): number => (traitsOf(fighters[f].name).k === 'very' ? 12 : kFixedOf(fighters[f].name) !== undefined ? k[f] : 11);
  for (let pass = 0; pass < 6; pass++) {
    for (let f = 0; f < F; f++) {
      while (count(f) < Math.min(protectedMin(f), elig[f])) {
        const cands = events.map((_, e) => e).filter(e => !attendees[e].has(f) && P[f][e] > 0).sort((a, b) => P[f][b] - P[f][a]);
        let done = false;
        for (const e of cands) {
          const victims = [...attendees[e]].filter(g => g !== f && count(g) > Math.max(protectedMin(g), 3)).sort((a, b) => P[a][e] - P[b][e]);
          if (victims.length) { attendees[e].delete(victims[0]); attendees[e].add(f); done = true; break; }
        }
        if (!done) break;
      }
      while (count(f) > maxFor(f)) {
        const mine = events.map((_, e) => e).filter(e => attendees[e].has(f)).sort((a, b) => P[f][a] - P[f][b]);
        const e = mine[0];
        const subs = fighters.map((_, g) => g).filter(g => !attendees[e].has(g) && P[g][e] > 0 && count(g) < maxFor(g) && !(kFixedOf(fighters[g].name) !== undefined)).sort((a, b) => P[b][e] - P[a][e]);
        if (!subs.length) break;
        attendees[e].delete(f); attendees[e].add(subs[0]);
      }
    }
  }
  return { attendees, weight: P, k };
}
