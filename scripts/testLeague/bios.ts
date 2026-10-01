/**
 * Fighter bios and highlights. Backgrounds and styles come from the owner's notes (roster.md). Every statement about RESULTS (medals, record,
 * rank, activity) is generated from statistics read back from the product's own views after the results were loaded (stats.json,
 * made by export_stats.sql), so a bio can never claim more than the simulated history supports. The phrases below are the vocabulary
 * that supabase/tests/nacl_league_verify.sql checks against the views.
 */
import type { FighterDef, TeamDef } from './roster';
import { CAT_LABEL } from './roster';
import { traitsOf } from './traits';
import { hash32 } from './util';

export interface Bio { bio: string; style: string; highlights: string[] }
export interface FStats {
  events: number; matches: number; wins: number; losses: number; golds: number; silvers: number; bronzes: number; podiums: number; points: number;
  firstYear: number | null; lastYear: number | null;
  medals: { place: number; comp: string; event: string; year: number }[];
  byYear: Record<string, { m: number; w: number }>;
  rank: { div: string; rank: number; of: number } | null;
}
export type Stats = Record<string, FStats>;

/** Background from the notes (no claims about results). */
const BACKGROUND: Record<string, string> = {
  'Aldric Stone': 'A heavy equipment technician who found the sport at a medieval festival.',
  'Bram Holt': 'A welder and fabricator who first repaired club equipment before he ever put it on.',
  'Cedric Vale': 'A long-time recreational martial artist, balancing training with family and work.',
  'Darius Flint': 'Joined after a club demonstration; athletic, and still building his tournament experience.',
  'Erik Thorn': 'Works in industrial maintenance and brings the same patience to the field.',
  'Finn Mercer': 'Volunteered at events before he ever competed, and only started fighting in late 2024.',
  'Gunnar Reed': 'A long-time historical martial arts practitioner (his joining year is recorded as an assumption).',
  'Astrid Vale': 'Came to armored combat from historical fencing.',
  'Corbin Ash': 'A construction supervisor with little interest in duel rankings.',
  'Arthur Crowe': 'Spent several years in HEMA before armor.',
  'Owen Hart': 'An informal mentor to the newer fighters of his club.',
  'Freya Holt': 'Picks her tournaments, and prefers the big ones.',
  'Kara Reed': 'Keeps her competing close to home in Alberta.',
  'Clara Ash': 'Competes rarely and chooses her events carefully.',
  'Percival Red': 'Regularly makes the drive to Calgary and Red Deer events.',
  'Bianca Frost': 'Happy to travel, with regular trips to British Columbia and Saskatchewan.',
  'Nora Hart': 'Competes widely within Alberta.',
  'Jora Grey': 'Usually enters several divisions at the same tournament.'
};

const TEAM_VOICE: Record<string, string> = {
  'Iron Wolves': 'a physical, melee-minded club', 'Blackforge Knights': 'a club built on structured training', 'Northern Ravens': 'a club that travels well beyond Alberta',
  'Crimson Stags': 'a small club known for developing new fighters', 'Steel Serpents': 'a balanced club with disciplined team fighting', 'Mountain Bears': 'a conditioning-focused club',
  Stormbreakers: 'the Saskatoon club', 'Golden Lions': 'a duel-focused club', 'Ashen Guard': 'the Winnipeg club', 'Frostborn Raiders': 'the Kelowna club'
};

const STYLE: Record<string, string[]> = {
  melee: ['Pack fighter: reads the line and finishes what his team starts', 'Team-first melee fighter, strongest when the whole line holds', 'Aggressive in the scrum, patient at the edges'],
  longsword: ['Longsword: measured distance and clean second intentions', 'Longsword: pressure with the point, then close the line', 'Longsword: patient, technical and hard to bait'],
  sword_shield: ['Sword and shield: solid guard, short counters', 'Sword and shield: uses the rim to take space', 'Sword and shield: defensive base with sudden speed'],
  polearm: ['Polearm: long reach and relentless tempo', 'Polearm: controls the center, finishes with the butt', 'Polearm: steady point work and good footwork']
};

export function styleOf(f: FighterDef): string {
  const tr = traitsOf(f.name);
  const h = hash32(`style|${f.name}`);
  const primary = f.disciplines.find(d => d !== '5v5' && d !== '3v3');
  const melee = f.disciplines.some(d => d === '5v5' || d === '3v3');
  if (tr.melee >= 40 && tr.duel < 0) return 'Melee specialist: strongest in the pack, around average in a duel';
  const set = primary && (!melee || tr.duel >= tr.melee) ? STYLE[primary] : melee && !primary ? STYLE.melee : STYLE[primary ?? 'melee'];
  return set[h % set.length];
}

const pct = (w: number, m: number): number => (m === 0 ? 0 : Math.round((w * 1000) / m) / 10);

function recordClause(s: FStats): string[] {
  const out: string[] = [];
  if (s.events === 0) return ['Has not yet competed at a completed NACL-test event.'];
  out.push(`Has attended ${s.events} NACL-test event${s.events === 1 ? '' : 's'} (${s.firstYear}${s.lastYear !== s.firstYear ? ` to ${s.lastYear}` : ''}) and fought ${s.matches} matches for a ${s.wins}-${s.losses} record.`);
  if (s.matches >= 6) out.push(s.wins * 2 > s.matches ? 'A winning record overall.' : s.wins * 2 === s.matches ? 'An even record overall.' : 'A losing record so far.');
  if (s.golds > 0) out.push(`A tournament winner (${s.golds} gold).`);
  if (s.podiums >= 4) out.push(`A regular podium finisher with ${s.podiums} medals.`);
  else if (s.podiums >= 1) out.push(`Has reached the podium ${s.podiums === 1 ? 'once' : `${s.podiums} times`}.`);
  else out.push('Has yet to reach a podium.');
  if (s.events >= 9) out.push('One of the most active fighters in the league.');
  const years = Object.keys(s.byYear).sort();
  if (years.length >= 3) {
    const half = Math.floor(years.length / 2);
    const early = years.slice(0, half).reduce((a, y) => ({ m: a.m + s.byYear[y].m, w: a.w + s.byYear[y].w }), { m: 0, w: 0 });
    const late = years.slice(-half).reduce((a, y) => ({ m: a.m + s.byYear[y].m, w: a.w + s.byYear[y].w }), { m: 0, w: 0 });
    if (early.m >= 6 && late.m >= 6) {
      const d = pct(late.w, late.m) - pct(early.w, early.m);
      if (d >= 15) out.push('Results have improved season on season.');
      else if (d <= -15) out.push('Results have dipped in recent seasons.');
    }
  }
  if (s.rank && s.rank.rank <= 5) out.push(`Ranked ${s.rank.rank} of ${s.rank.of} in ${s.rank.div} on career points.`);
  return out;
}

export function makeBios(teams: readonly TeamDef[], fighters: readonly FighterDef[], stats: Stats | null): Map<number, Bio> {
  const out = new Map<number, Bio>();
  for (const f of fighters) {
    const team = teams[f.teamIdx];
    const teamName = team.name.replace(/-test$/, '');
    const s = stats?.[f.id];
    const veteran = f.joinedYear <= 2020;
    const intro = `${f.name.replace(/-test$/, '')} fights for ${team.name}, ${TEAM_VOICE[teamName] ?? 'a NACL-test club'} in ${team.city}.`;
    const level = veteran ? 'A veteran who joined in ' + f.joinedYear + '.' : f.joinedYear >= 2024 ? `A newer competitor, joined in ${f.joinedYear}.` : `Joined in ${f.joinedYear}.`;
    const discs = `Enters ${f.disciplines.map(d => CAT_LABEL[d]).join(', ')}.`;
    const bg = BACKGROUND[f.name.replace(/-test$/, '')] ?? '';
    const results = s ? recordClause(s).join(' ') : 'Fictional NACL-test profile; results are added by the dataset load.';
    const bio = [intro, bg, level, discs, results].filter(Boolean).join(' ').slice(0, 1490);
    const hl: string[] = [];
    if (s) {
      const medals = [...s.medals].sort((a, b) => a.place - b.place || b.year - a.year).slice(0, 6);
      for (const m of medals) hl.push(`${['', 'Gold', 'Silver', 'Bronze'][m.place]}, ${m.comp}, ${m.event} (${m.year})`);
      if (s.matches > 0) hl.push(`Career record ${s.wins}-${s.losses} over ${s.matches} matches at ${s.events} events`);
      if (s.rank && s.rank.rank <= 5) hl.push(`Career rank ${s.rank.rank} of ${s.rank.of} in ${s.rank.div}`);
    }
    hl.push(`Joined ${team.name} in ${f.joinedYear}`);
    out.set(f.idx, { bio, style: styleOf(f), highlights: hl.map(x => x.slice(0, 200)).slice(0, 10) });
  }
  return out;
}
