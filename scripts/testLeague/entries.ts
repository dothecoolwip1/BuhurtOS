/**
 * Turns the people who attend an event into competition entries: one fighter id per person across divisions, duel entries by fighter,
 * team entries (5v5, 3v3) with a roster of exactly the format size taken from that team's attendees. A team that is a few short borrows
 * 1-2 fighters from another team as mercenaries (home team unchanged). Nobody is in two entries of the same competition.
 */
import type { Cat, FighterDef, TeamDef } from './roster';
import { isMelee, SIDE_SIZE, CAT_LABEL } from './roster';
import type { Division, EventDef } from './events';
import { divCode } from './events';
import { traitsOf } from './traits';
import { rngFor, shuffle, uid } from './util';
import { fighterRating } from './rating';

export interface RosterSlot { fighterIdx: number; role: 'fighter' | 'mercenary' }
export interface EntryPlan { id: string; teamIdx: number | null; fighterIdx: number | null; roster: RosterSlot[] }
export interface CompPlan { key: string; id: string; event: EventDef; div: Division; name: string; entries: EntryPlan[] }

export const compName = (d: Division): string => `${d.gender === 'men' ? 'Male' : 'Female'} ${CAT_LABEL[d.cat]}`;
export const sexOf = (g: Division['gender']): 'male' | 'female' => (g === 'men' ? 'male' : 'female');
const MIN_DUEL = 4, MIN_TEAM = 2;

export interface FormOptions { noMeleeTeams?: ReadonlySet<number>; /** Everybody enters every discipline they list (a big weekend, closed registration). */ fullIntent?: boolean }

export function formEntries(ev: EventDef, attendees: ReadonlySet<number>, teams: readonly TeamDef[], fighters: readonly FighterDef[], opt: FormOptions = {}): { comps: CompPlan[]; attendees: Set<number> } {
  const att = [...attendees].sort((a, b) => a - b);
  const offered = new Map(ev.divisions.map(d => [divCode(d), d]));
  const rating = (i: number, cat: Cat): number => fighterRating(fighters[i], teams[fighters[i].teamIdx], cat, ev);
  const divOf = (i: number, cat: Cat): Division | undefined => offered.get(divCode({ cat, gender: fighters[i].sex === 'male' ? 'men' : 'women' }));

  // 1. Intents: which divisions each attendee wants to enter.
  const intent = new Map<string, Set<number>>(); // division code -> fighters
  const add = (code: string, i: number): void => { (intent.get(code) ?? intent.set(code, new Set()).get(code)!).add(i); };
  for (const i of att) {
    const f = fighters[i], tr = traitsOf(f.name);
    const options: { code: string; p: number }[] = [];
    for (const cat of f.disciplines) {
      const d = divOf(i, cat);
      if (!d) continue;
      if (isMelee(cat) && opt.noMeleeTeams?.has(f.teamIdx)) continue;
      const p = tr.enterAll || opt.fullIntent ? (f.occasional.includes(cat) ? 0.6 : 1) : isMelee(cat) ? (f.occasional.includes(cat) ? 0.3 : tr.meleeEntry) : tr.duelEntry;
      options.push({ code: divCode(d), p });
    }
    let any = false;
    for (const o of options) {
      if (rngFor(`intent|${ev.slug}|${f.name}|${o.code}`)() < o.p) { add(o.code, i); any = true; }
    }
    if (!any && options.length) add(options.sort((a, b) => b.p - a.p)[0].code, i);
  }

  const comps: CompPlan[] = [];
  const placed = new Set<number>();
  const mkComp = (d: Division, entries: EntryPlan[]): CompPlan => {
    const key = `${ev.slug}|${divCode(d)}`;
    return { key, id: uid(`competition|${key}`), event: ev, div: d, name: compName(d), entries };
  };

  // 2. Team divisions.
  for (const d of ev.divisions.filter(x => isMelee(x.cat))) {
    const cat = d.cat as '5v5' | '3v3';
    const S = SIDE_SIZE[cat], minOwn = S === 5 ? 3 : 2, maxBorrow = S === 5 ? 2 : 1;
    const sex = sexOf(d.gender);
    const wants = [...(intent.get(divCode(d)) ?? [])];
    const byTeam = new Map<number, number[]>();
    for (const i of wants) (byTeam.get(fighters[i].teamIdx) ?? byTeam.set(fighters[i].teamIdx, []).get(fighters[i].teamIdx)!).push(i);
    for (const list of byTeam.values()) list.sort((a, b) => rating(b, cat) - rating(a, cat) || a - b);
    const eligibleAll = att.filter(i => fighters[i].sex === sex && fighters[i].disciplines.includes(cat) && !opt.noMeleeTeams?.has(fighters[i].teamIdx));
    const taken = new Set<number>();
    const rosters = new Map<number, RosterSlot[]>();
    const order = [...byTeam.keys()].sort((a, b) => byTeam.get(b)!.length - byTeam.get(a)!.length || a - b);
    for (const t of order) if (byTeam.get(t)!.length >= S) {
      rosters.set(t, byTeam.get(t)!.slice(0, S).map(i => ({ fighterIdx: i, role: 'fighter' as const })));
      byTeam.get(t)!.slice(0, S).forEach(i => taken.add(i));
    }
    const small = order.filter(t => byTeam.get(t)!.length < S && byTeam.get(t)!.length >= minOwn);
    const failed = new Set<number>(order.filter(t => byTeam.get(t)!.length < minOwn));
    for (let sweep = 0; sweep < 2; sweep++) {
      for (const t of small) {
        if (rosters.has(t) || failed.has(t)) continue;
        const own = byTeam.get(t)!;
        if (own.some(i => taken.has(i))) { failed.add(t); continue; }
        const need = S - own.length;
        if (need > maxBorrow) continue;
        const reserved = new Set(small.filter(x => x !== t && !failed.has(x)).map(x => x));
        const cands = eligibleAll.filter(i => !taken.has(i) && fighters[i].teamIdx !== t && !own.includes(i) && !reserved.has(fighters[i].teamIdx));
        const score = (i: number): number => {
          const ft = fighters[i].teamIdx;
          let s = rngFor(`merc|${ev.slug}|${divCode(d)}|${t}|${fighters[i].name}`)();
          if (!byTeam.has(ft) || failed.has(ft)) s += 2; // fighters whose own team cannot field this division are the natural lenders
          if (teams[ft].prov === teams[t].prov) s += 1;
          if (wants.includes(i)) s += 0.5;
          return s;
        };
        cands.sort((a, b) => score(b) - score(a) || a - b);
        if (cands.length < need) { failed.add(t); continue; }
        const lent = cands.slice(0, need);
        rosters.set(t, [...own.map(i => ({ fighterIdx: i, role: 'fighter' as const })), ...lent.map(i => ({ fighterIdx: i, role: 'mercenary' as const }))]);
        own.forEach(i => taken.add(i)); lent.forEach(i => taken.add(i));
      }
    }
    if (rosters.size < MIN_TEAM) continue;
    const entries: EntryPlan[] = [...rosters.entries()].sort((a, b) => a[0] - b[0]).map(([t, roster]) => {
      for (const s of roster) if (s.role === 'fighter' && fighters[s.fighterIdx].teamIdx !== t) throw new Error('roster own member from another team');
      return { id: uid(`entry|${ev.slug}|${divCode(d)}|team|${teams[t].name}`), teamIdx: t, fighterIdx: null, roster };
    });
    comps.push(mkComp(d, entries));
    for (const e of entries) for (const s of e.roster) placed.add(s.fighterIdx);
  }

  // 3. Duel divisions.
  for (const d of ev.divisions.filter(x => !isMelee(x.cat))) {
    const fs = [...(intent.get(divCode(d)) ?? [])].sort((a, b) => a - b);
    if (fs.length < MIN_DUEL) continue;
    comps.push(mkComp(d, fs.map(i => ({ id: uid(`entry|${ev.slug}|${divCode(d)}|fighter|${fighters[i].name}`), teamIdx: null, fighterIdx: i, roster: [] }))));
    fs.forEach(i => placed.add(i));
  }

  // 4. Fighters who ended up with no entry: a duel division that exists, else they do not attend after all.
  for (const i of att) {
    if (placed.has(i)) continue;
    for (const cat of fighters[i].disciplines.filter(c => !isMelee(c))) {
      const c = comps.find(x => x.div.cat === cat && x.div.gender === (fighters[i].sex === 'male' ? 'men' : 'women'));
      if (c) { c.entries.push({ id: uid(`entry|${ev.slug}|${divCode(c.div)}|fighter|${fighters[i].name}`), teamIdx: null, fighterIdx: i, roster: [] }); placed.add(i); break; }
    }
  }
  comps.sort((a, b) => divOrder(a.div) - divOrder(b.div));
  return { comps, attendees: placed };
}

const ORDER: Record<Cat, number> = { '5v5': 0, '3v3': 1, longsword: 2, sword_shield: 3, polearm: 4 };
export const divOrder = (d: Division): number => ORDER[d.cat] * 2 + (d.gender === 'men' ? 0 : 1);
