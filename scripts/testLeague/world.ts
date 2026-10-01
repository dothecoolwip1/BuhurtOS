/**
 * Builds the whole fictional league in memory: roster, attendance, entries, simulated historical events, and the drawn and scheduled
 * current event (Red Deer Rumble-test). Pure and deterministic: the same roster and code always give the same world.
 */
import { parseRoster, type FighterDef, type TeamDef } from './roster';
import { HISTORICAL, RUMBLE, type EventDef } from './events';
import { modelAttendance, teamAffinity, eventTarget } from './attendance';
import { formEntries, type CompPlan } from './entries';
import { simulateCompetition, scheduleEvent, resolved, type CompSim } from './play';
import { traitsOf } from './traits';
import { rngFor, weightedSample, gauss } from './util';

export interface EventWorld { event: EventDef; attendees: Set<number>; comps: CompPlan[]; sims: CompSim[] }
export interface World { teams: TeamDef[]; fighters: FighterDef[]; events: EventWorld[]; rumble: EventWorld; rumbleSeed: number }

/** [men, women] each club sends to the Rumble. Women are concentrated so women's team divisions can run; some clubs send only 2-3. */
const RUMBLE_QUOTA: Record<string, [number, number]> = {
  'Iron Wolves-test': [5, 4], 'Blackforge Knights-test': [4, 2], 'Northern Ravens-test': [5, 3], 'Crimson Stags-test': [4, 2], 'Steel Serpents-test': [3, 1],
  'Mountain Bears-test': [2, 0], 'Stormbreakers-test': [2, 0], 'Golden Lions-test': [2, 0], 'Ashen Guard-test': [1, 1], 'Frostborn Raiders-test': [1, 1]
};
const DUELS_ONLY = 'Golden Lions-test';
const ACTIVITY = { very: 3, high: 2, norm: 1, low: 0.5, rare: 0.2 } as const;

export function registrations(w: EventWorld): number {
  return w.comps.reduce((n, c) => n + c.entries.reduce((m, e) => m + (e.fighterIdx !== null ? 1 : e.roster.length), 0), 0);
}

function pickRumble(teams: TeamDef[], fighters: FighterDef[], hist: EventWorld[], seed: number): Set<number> {
  const latest = hist[hist.length - 1].attendees;
  const counts = fighters.map((_, i) => hist.filter(h => h.attendees.has(i)).length);
  const last3 = fighters.map((_, i) => hist.slice(-3).some(h => h.attendees.has(i)));
  const chosen = new Set<number>();
  for (const t of teams) {
    const members = fighters.filter(f => f.teamIdx === t.idx);
    const [menQuota, womenQuota] = RUMBLE_QUOTA[t.name];
    const w = members.map(f => {
      const tr = traitsOf(f.name);
      let x = ACTIVITY[tr.k] * (0.4 + teamAffinity(t, RUMBLE));
      x *= latest.has(f.idx) ? 0.5 : 1.6;                       // different from the latest event
      if (counts[f.idx] >= 2 && !last3[f.idx]) x *= 2.5;        // returnees
      if (counts[f.idx] <= 3) x *= 1.4;                         // newcomers
      if (f.disciplines.includes('5v5') || f.disciplines.includes('3v3')) x *= t.name === DUELS_ONLY ? 1 : 3;
      if (tr.majorOnly) x *= 0.4;
      x *= tr.attFade ** 2;
      x *= Math.exp(0.5 * gauss(rngFor(`rumble|${seed}|${f.name}`)));
      return x;
    });
    for (const [sex, n] of [['female', womenQuota], ['male', menQuota]] as const) {
      const idx = members.map((_, i) => i).filter(i => members[i].sex === sex);
      for (const j of weightedSample(idx.map(i => w[i]), n, rngFor(`rumble-team|${seed}|${t.name}|${sex}`))) chosen.add(members[idx[j]].idx);
    }
  }
  // The host club sends its whole melee core, so one 5v5 team is made of its own people only.
  for (const n of ['Aldric Stone-test', 'Bram Holt-test', 'Cedric Vale-test', 'Erik Thorn-test', 'Finn Mercer-test']) chosen.add(fighters.find(f => f.name === n)!.idx);
  return chosen;
}

export function buildWorld(): World {
  const { teams, fighters } = parseRoster();
  const model = modelAttendance(teams, fighters, HISTORICAL);
  const initial = fighters.map((_, i) => model.attendees.filter(a => a.has(i)).length);
  const events: EventWorld[] = HISTORICAL.map(ev => {
    // Some attendees end up without an entry (their team division cannot run); others of the weight matrix take their places.
    const target = eventTarget(ev);
    let att = new Set(model.attendees[ev.idx]);
    let formed = formEntries(ev, att, teams, fighters);
    const tried = new Set<number>(att);
    for (let round = 0; round < 40 && formed.attendees.size < target; round++) {
      const next = new Set(formed.attendees);
      const spare = fighters.map((_, i) => i).filter(i => !next.has(i) && !tried.has(i) && model.weight[i][ev.idx] > 0 && initial[i] < 10).sort((a, b) => model.weight[b][ev.idx] - model.weight[a][ev.idx] || a - b);
      for (const i of spare.slice(0, target - formed.attendees.size)) { next.add(i); tried.add(i); }
      att = next;
      formed = formEntries(ev, att, teams, fighters);
    }
    const sims = formed.comps.map(c => simulateCompetition(c, teams, fighters, { play: true }));
    scheduleEvent(ev, sims, ev.size === 'large' ? 4 : 3);
    return { event: ev, attendees: formed.attendees, comps: formed.comps, sims };
  });

  // The current event: search a deterministic seed until the brief's constraints hold.
  const latest = events[events.length - 1].attendees;
  const aldric = fighters.find(f => f.name === 'Aldric Stone-test')!.idx;
  let rumble: EventWorld | null = null, rumbleSeed = -1;
  let bestGap = 1e9;
  for (let seed = 1; seed < 120; seed++) {
    const picked = pickRumble(teams, fighters, events, seed);
    const formed = formEntries(RUMBLE, picked, teams, fighters, { noMeleeTeams: new Set([teams.find(t => t.name === DUELS_ONLY)!.idx]), fullIntent: true });
    const men = [...formed.attendees].filter(i => fighters[i].sex === 'male').length;
    const women = formed.attendees.size - men;
    const overlap = [...formed.attendees].filter(i => latest.has(i)).length / new Set([...formed.attendees, ...latest]).size;
    const comp = (code: string): CompPlan | undefined => formed.comps.find(c => `${c.div.gender === 'men' ? 'M' : 'W'}${c.div.cat}` === code);
    const m5 = comp('M5v5');
    const merc = formed.comps.filter(c => c.div.cat === '5v5' || c.div.cat === '3v3').some(c => c.entries.some(e => e.roster.some(s => s.role === 'mercenary')));
    const fullOwn = !!m5 && m5.entries.some(e => e.roster.every(s => s.role === 'fighter'));
    const nearFull = !!m5 && m5.entries.some(e => e.roster.filter(s => s.role === 'mercenary').length === 1);
    const aldricCats = formed.comps.filter(c => c.entries.some(e => e.fighterIdx === aldric || e.roster.some(s => s.fighterIdx === aldric))).map(c => `${c.div.gender}${c.div.cat}`);
    const ew: EventWorld = { event: RUMBLE, attendees: formed.attendees, comps: formed.comps, sims: [] };
    const regs = registrations(ew);
    const newcomers = [...formed.attendees].filter(i => events.filter(h => h.attendees.has(i)).length <= 3).length;
    if (process.env.NACL_DEBUG && seed === 4) console.log(formed.comps.map(c => `${c.div.gender[0]}${c.div.cat}:` + c.entries.map(e => e.fighterIdx !== null ? "d" : `${teams[e.teamIdx!].name[0]}${e.roster.length}${e.roster.filter(s => s.role === "mercenary").length ? "m" + e.roster.filter(s => s.role === "mercenary").length : ""}`).join("/")).join("  "), [...formed.attendees].map(i => fighters[i].name.split(" ")[0] + (fighters[i].sex === "male" ? "" : "*")).join(","));
    if (process.env.NACL_DEBUG && seed < 8) console.log(seed, "uniq", formed.attendees.size, "m/w", men, women, "ov", overlap.toFixed(2), "merc", merc, "full", fullOwn, "near", nearFull, "regs", regs, "new", newcomers, aldricCats.join(","));
    const ok = formed.attendees.size >= 38 && formed.attendees.size <= 44 && men >= 25 && men <= 30 && women >= 10 && women <= 15 && overlap < 0.45 && merc && fullOwn && nearFull
      && regs >= 72 && regs <= 105 && newcomers >= 3 && aldricCats.includes('menlongsword') && aldricCats.includes('men5v5') && aldricCats.includes('men3v3');
    if (ok && Math.abs(regs - 90) < bestGap) { bestGap = Math.abs(regs - 90); rumble = ew; rumbleSeed = seed; }
  }
  if (!rumble) throw new Error('no seed satisfied the Red Deer Rumble-test constraints');
  rumble.sims = rumble.comps.map(c => simulateCompetition(c, teams, fighters, { play: false }));
  scheduleEvent(RUMBLE, rumble.sims, 4);
  void resolved;
  return { teams, fighters, events, rumble, rumbleSeed };
}
