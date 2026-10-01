/** Reads scripts/testLeague/roster.md (the owner's verbatim facts, the source of truth) into typed records. */
import { readFileSync } from 'node:fs';
import { hash32, uid, pad2 } from './util';

export type Cat = '5v5' | '3v3' | 'longsword' | 'sword_shield' | 'polearm';
export type Prov = 'AB' | 'BC' | 'SK' | 'MB';
export type Sex = 'male' | 'female';

export const CAT_LABEL: Record<Cat, string> = { '5v5': '5v5', '3v3': '3v3', longsword: 'Longsword', sword_shield: 'Sword & Shield', polearm: 'Polearm' };
export const MELEE: readonly Cat[] = ['5v5', '3v3'];
export const isMelee = (c: Cat): boolean => c === '5v5' || c === '3v3';
export const SIDE_SIZE: Record<'5v5' | '3v3', number> = { '5v5': 5, '3v3': 3 };

const PROV_CODE: Record<string, Prov> = { Alberta: 'AB', 'British Columbia': 'BC', Saskatchewan: 'SK', Manitoba: 'MB' };
const PROV_NAME: Record<Prov, string> = { AB: 'Alberta', BC: 'British Columbia', SK: 'Saskatchewan', MB: 'Manitoba' };
export const provinceName = (p: Prov): string => PROV_NAME[p];

export const CITY_COORDS: Record<string, readonly [number, number]> = {
  'Red Deer': [52.27, -113.81], Calgary: [51.05, -114.07], Edmonton: [53.55, -113.49], Lethbridge: [49.69, -112.84], 'Medicine Hat': [50.04, -110.68],
  Canmore: [51.09, -115.36], Saskatoon: [52.13, -106.67], Regina: [50.45, -104.61], Winnipeg: [49.9, -97.14], Kelowna: [49.89, -119.5],
  Drumheller: [51.46, -112.71], Blackfalds: [52.38, -113.78], 'Grande Prairie': [55.17, -118.8], Brandon: [49.85, -99.95], Kamloops: [50.67, -120.33]
};

export interface TeamDef {
  idx: number; id: string; name: string; slug: string; initial: string; city: string; prov: Prov; blurb: string;
  colors: [string, string]; crest: 'pale' | 'fess' | 'bend' | 'chevron' | 'quarterly' | 'saltire'; foundedYear: number;
}
export interface FighterDef {
  idx: number; id: string; name: string; teamIdx: number; sex: Sex; age: number; birthYear: number; city: string; prov: Prov;
  joinedYear: number; joinDate: string; joinedAssumed: boolean; disciplines: Cat[]; occasional: Cat[]; notes: string;
}

const SLUG = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const slugOf = SLUG;

const CODE_TO_CAT: Record<string, Cat> = { '5v5': '5v5', '3v3': '3v3', LS: 'longsword', SS: 'sword_shield', PA: 'polearm' };
const PALETTE = ['#8C2C2C', '#2C4A8C', '#2C6B3F', '#6B4A2C', '#5B2C8C', '#8C6B1F', '#2C6B7A', '#7A2C5B', '#4A4A4A', '#1F5B8C'];
const CRESTS = ['pale', 'fess', 'bend', 'chevron', 'quarterly', 'saltire'] as const;

/** Fighters join on a deterministic day of their joined year (so an early-2023 event cannot hold a late-2023 joiner). */
function joinDateFor(name: string, year: number, late2024: boolean): string {
  if (late2024) return '2024-10-12';
  const h = hash32(`join|${name}`);
  const maxMonth = year >= 2023 ? 9 : 12; // 2023 and 2024 joiners are in by September
  const month = 1 + (h % maxMonth);
  const day = 1 + ((h >>> 8) % 27);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseRoster(path = process.env.NACL_ROSTER ?? 'scripts/testLeague/roster.md'): { teams: TeamDef[]; fighters: FighterDef[] } {
  const lines = readFileSync(path, 'utf8').split('\n');
  const teams: TeamDef[] = [];
  const fighters: FighterDef[] = [];
  for (const line of lines) {
    const th = /^## (\d+)\. (.+?): (.+?), (.+?)\. (.*)$/.exec(line);
    if (th) {
      const idx = Number(th[1]) - 1;
      const name = th[2];
      const base = name.replace(/-test$/, '');
      const prov = PROV_CODE[th[4]];
      if (!prov) throw new Error(`unknown province in roster: ${th[4]}`);
      const h = hash32(`team|${name}`);
      const words = base.split(' ');
      teams.push({
        idx, id: uid(`team|${name}`), name, slug: SLUG(name), initial: (words[0][0] + (words[1]?.[0] ?? words[0][1])).toUpperCase(),
        city: th[3], prov, blurb: th[5].trim(), colors: [PALETTE[h % PALETTE.length], '#E9ECEF'], crest: CRESTS[(h >>> 4) % CRESTS.length], foundedYear: 2014 + (h % 5)
      });
      continue;
    }
    if (!line.startsWith('- ') || !line.includes(' | ')) continue;
    const f = line.slice(2).split('|').map(s => s.trim());
    if (f.length < 7) throw new Error(`bad fighter line: ${line}`);
    const [name, g, age, city, prov, joined, disc, ...rest] = f;
    const notes = rest.join(' | ').trim();
    const assumed = /ASSUMED (\d{4})/.exec(joined);
    const late2024 = /late 2024/.test(joined);
    const year = assumed ? Number(assumed[1]) : late2024 ? 2024 : Number(joined);
    if (!Number.isInteger(year)) throw new Error(`cannot read joined year: ${line}`);
    const discs: Cat[] = [];
    const occasional: Cat[] = [];
    for (const raw of disc.split(',')) {
      const code = raw.replace(/\(.*?\)/g, '').trim();
      const cat = CODE_TO_CAT[code];
      if (!cat) throw new Error(`unknown discipline ${code} in: ${line}`);
      discs.push(cat);
      if (/occasional/.test(raw)) occasional.push(cat);
    }
    const idx = fighters.length;
    fighters.push({
      idx, id: uid(`fighter|${name}`), name, teamIdx: teams.length - 1, sex: g === 'F' ? 'female' : 'male', age: Number(age), birthYear: 2026 - Number(age),
      city, prov: prov as Prov, joinedYear: year, joinDate: joinDateFor(name, year, late2024), joinedAssumed: !!assumed, disciplines: discs, occasional, notes
    });
  }
  return { teams, fighters };
}
