/** The 15 completed NACL-test events and the current one. Provinces: 9 AB, 2 BC, 2 SK, 2 MB. Dates are May 2023 to Sep 2026 (see roster.md). */
import type { Cat, Prov } from './roster';
import { uid, addDays } from './util';
import { provinceName, slugOf } from './roster';

export type Gender = 'men' | 'women';
export interface Division { cat: Cat; gender: Gender }
export type SizeClass = 'small' | 'medium' | 'large';
export type TierName = 'Source' | 'Classic' | 'Regional';

export interface EventDef {
  idx: number; id: string; slug: string; name: string; city: string; prov: Prov; province: string; venue: string; start: string; end: string; tz: string;
  size: SizeClass; tier: TierName; divisions: Division[]; host: string | null; current: boolean; description: string;
}

const D = (code: string): Division => {
  const g: Gender = code[0] === 'M' ? 'men' : 'women';
  const c = code.slice(1);
  const cat: Cat = c === '5' ? '5v5' : c === '3' ? '3v3' : c === 'LS' ? 'longsword' : c === 'SS' ? 'sword_shield' : 'polearm';
  return { cat, gender: g };
};
const divs = (s: string): Division[] => s.split(' ').map(D);
const ALL = 'M5 W5 M3 W3 MLS WLS MSS WSS MPA WPA';

const TZ: Record<Prov, string> = { AB: 'America/Edmonton', BC: 'America/Vancouver', SK: 'America/Regina', MB: 'America/Winnipeg' };

interface Raw { name: string; city: string; prov: Prov; venue: string; start: string; size: SizeClass; tier: TierName; divs: string; host: string | null; blurb: string }

const RAW: Raw[] = [
  { name: 'Central Alberta Steel Open-test', city: 'Red Deer', prov: 'AB', venue: 'Westerner Park Arena-test', start: '2023-05-27', size: 'small', tier: 'Source', divs: 'M5 M3 MLS MSS WLS', host: 'Iron Wolves-test', blurb: 'The first NACL-test calendar event: a one-weekend open for the founding Alberta clubs.' },
  { name: 'Saskatchewan Steel Cup-test', city: 'Saskatoon', prov: 'SK', venue: 'Prairie Hall-test', start: '2023-08-12', size: 'medium', tier: 'Classic', divs: 'M5 W5 MLS WLS MSS WSS MPA', host: 'Stormbreakers-test', blurb: 'First NACL-test event outside Alberta, hosted by Stormbreakers-test.' },
  { name: 'Calgary Iron Clash-test', city: 'Calgary', prov: 'AB', venue: 'Foothills Armoury-test', start: '2023-10-14', size: 'large', tier: 'Classic', divs: ALL, host: 'Blackforge Knights-test', blurb: 'A large autumn tournament with every division on the card.' },
  { name: 'Edmonton Winter Melee-test', city: 'Edmonton', prov: 'AB', venue: 'Northlands Drill Hall-test', start: '2024-02-17', size: 'medium', tier: 'Classic', divs: 'M5 W5 M3 W3 MLS WLS', host: 'Northern Ravens-test', blurb: 'A winter melee weekend weighted to team fighting.' },
  { name: 'Okanagan Armored Open-test', city: 'Kelowna', prov: 'BC', venue: 'Lakeshore Fieldhouse-test', start: '2024-06-08', size: 'medium', tier: 'Classic', divs: 'M5 M3 W5 MLS WLS MSS MPA WPA', host: 'Frostborn Raiders-test', blurb: 'The first NACL-test event in British Columbia.' },
  { name: 'Battle of the Badlands-test', city: 'Drumheller', prov: 'AB', venue: 'Badlands Rodeo Grounds-test', start: '2024-08-17', size: 'small', tier: 'Source', divs: 'M5 M3 MSS WLS MLS', host: null, blurb: 'A small summer event in the Alberta badlands.' },
  { name: 'Blackfalds Battle Bash-test', city: 'Blackfalds', prov: 'AB', venue: 'Blackfalds Multiplex-test', start: '2024-11-09', size: 'small', tier: 'Classic', divs: 'M3 W3 MLS MPA WSS', host: 'Iron Wolves-test', blurb: 'A late-season bash in central Alberta.' },
  { name: 'Prairie Siege-test', city: 'Lethbridge', prov: 'AB', venue: 'Exhibition Park Hall-test', start: '2025-03-15', size: 'medium', tier: 'Classic', divs: 'M5 W5 MLS WLS MSS WSS MPA', host: 'Crimson Stags-test', blurb: 'Southern Alberta season opener hosted by Crimson Stags-test.' },
  { name: 'Queen City Combat Classic-test', city: 'Regina', prov: 'SK', venue: 'Queen City Hall-test', start: '2025-05-24', size: 'medium', tier: 'Classic', divs: 'M5 M3 W5 MLS WLS MSS WPA', host: 'Golden Lions-test', blurb: 'Duel-heavy Saskatchewan classic hosted by Golden Lions-test.' },
  { name: 'Medicine Hat Mayhem-test', city: 'Medicine Hat', prov: 'AB', venue: 'Kinplex Arena-test', start: '2025-07-12', size: 'medium', tier: 'Classic', divs: 'M5 W5 M3 W3 MSS MPA WLS MLS', host: 'Steel Serpents-test', blurb: 'Summer mayhem in the south-east, hosted by Steel Serpents-test.' },
  { name: 'Manitoba Medieval Melee-test', city: 'Winnipeg', prov: 'MB', venue: 'Red River Hall-test', start: '2025-09-06', size: 'small', tier: 'Classic', divs: 'M5 M3 W5 MLS WLS', host: 'Ashen Guard-test', blurb: 'A compact melee weekend hosted by Ashen Guard-test.' },
  { name: 'Prairie Crown Championship-test', city: 'Brandon', prov: 'MB', venue: 'Keystone Centre Hall-test', start: '2025-10-18', size: 'large', tier: 'Regional', divs: ALL, host: null, blurb: 'The Manitoba championship: every division, Regional tier.' },
  { name: 'Pacific Steel Championship-test', city: 'Kamloops', prov: 'BC', venue: 'Sagebrush Arena-test', start: '2026-05-30', size: 'large', tier: 'Regional', divs: ALL, host: null, blurb: 'The British Columbia championship: every division, Regional tier.' },
  { name: 'Grande Prairie Northern Clash-test', city: 'Grande Prairie', prov: 'AB', venue: 'Northern Lights Hall-test', start: '2026-07-11', size: 'small', tier: 'Source', divs: 'M5 M3 MLS WLS MPA', host: null, blurb: 'A far-north Alberta clash, small but keen.' },
  { name: 'Rocky Mountain Rumble-test', city: 'Canmore', prov: 'AB', venue: 'Mountain Rec Centre-test', start: '2026-09-12', size: 'large', tier: 'Classic', divs: ALL, host: 'Mountain Bears-test', blurb: 'The latest completed event: a large mountain weekend hosted by Mountain Bears-test.' }
];


export const HISTORICAL: EventDef[] = RAW.map((r, idx) => ({
  idx, id: uid(`event|${r.name}`), slug: slugOf(r.name), name: r.name, city: r.city, prov: r.prov, province: provinceName(r.prov), venue: r.venue,
  start: r.start, end: addDays(r.start, 1), tz: TZ[r.prov], size: r.size, tier: r.tier, divisions: divs(r.divs), host: r.host, current: false, description: r.blurb
}));

export const RUMBLE: EventDef = {
  idx: 15, id: uid('event|Red Deer Rumble-test'), slug: 'red-deer-rumble-test', name: 'Red Deer Rumble-test', city: 'Red Deer', prov: 'AB', province: 'Alberta',
  venue: 'Westerner Park Arena-test', start: '2026-11-14', end: '2026-11-15', tz: TZ.AB, size: 'medium', tier: 'Classic', divisions: divs(ALL), host: 'Iron Wolves-test', current: true,
  description: 'The current NACL-test tournament, a fictional dataset event: Saturday November 14th and Sunday November 15th, 2026. Registration is closed and the draw is made; the schedule is published but no match is final.'
};

export const ALL_EVENTS: EventDef[] = [...HISTORICAL, RUMBLE];
export const divCode = (d: Division): string => `${d.gender === 'men' ? 'M' : 'W'}${d.cat === '5v5' ? '5' : d.cat === '3v3' ? '3' : d.cat === 'longsword' ? 'LS' : d.cat === 'sword_shield' ? 'SS' : 'PA'}`;
export const SEASONS = [2023, 2024, 2025, 2026];
