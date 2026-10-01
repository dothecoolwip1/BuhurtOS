/** SAMPLE DATA for the admin preview. People and teams are invented; event facts are the owner's. */
export type Role = 'organizer' | 'scorekeeper' | 'medic' | 'captain';
export const ROLE_LABEL: Record<Role, string> = { organizer: 'Organizer', scorekeeper: 'Scorekeeper', medic: 'Medic', captain: 'Team captain' };

export const RUMBLE = {
  name: 'Red Deer Rumble',
  dates: 'Nov 14 – 15, 2026',
  venue: 'Horse In Hand Ranch, 39506 Highway 2 Service Rd, Blackfalds, Alberta',
  host: 'Red Deer Reavers',
  tier: 'Tier not set',
  registrationCloses: '2026-11-08',
  starts: '2026-11-14'
};

export interface FighterRow { name: string; waiver: boolean; fit: boolean; emergency: boolean; note?: string }
export interface Registration {
  id: string;
  kind: 'team' | 'duelist';
  name: string;
  sub: string;
  competition: string;
  status: 'pending' | 'accepted' | 'declined';
  paid: boolean;
  /** A team a captain just created that no organizer has approved yet. */
  newTeam: boolean;
  fighters: FighterRow[];
}

const f = (name: string, waiver = true, fit = true, emergency = true, note?: string): FighterRow => ({ name, waiver, fit, emergency, note });

export const REGISTRATIONS: Registration[] = [
  { id: 'r1', kind: 'team', name: 'Iron Wardens', sub: 'Calgary, AB', competition: "Men's 5v5", status: 'accepted', paid: true, newTeam: false,
    fighters: [f('Mara Kessling'), f('Owen Dabrowski'), f('Jun Takeda-Ross'), f('Liv Arneson', true, true, true, 'Asthma, inhaler in kit bag'), f('Bram Okafor'), f('Teo Villanueva', false)] },
  { id: 'r2', kind: 'team', name: 'Northgate Company', sub: 'Kamloops, BC', competition: "Men's 5v5", status: 'accepted', paid: false, newTeam: false,
    fighters: [f('Dane Holloway'), f('Rue Castellan'), f('Ivo Brandt'), f('Sasha Pell', false, true, false), f('Cormac Aiken')] },
  { id: 'r3', kind: 'team', name: 'Ravenmoor', sub: 'Winnipeg, MB', competition: "Men's 5v5", status: 'pending', paid: false, newTeam: false,
    fighters: [f('Petr Novak'), f('Ilse Dorn', false), f('Gus Ferreira', false, false, false), f('Noor Aziz'), f('Tomás Vega')] },
  { id: 'r4', kind: 'team', name: 'Prairie Cinders', sub: 'Saskatoon, SK', competition: "Women's 5v5", status: 'pending', paid: false, newTeam: true,
    fighters: [f('Hanne Roos', false), f('Wren Ostby'), f('Dalia Mehra', true, true, true, 'Nut allergy'), f('Priya Nand')] },
  { id: 'r5', kind: 'team', name: 'Grey Fen Brotherhood', sub: 'Duluth, MN', competition: "Men's 3v3", status: 'accepted', paid: true, newTeam: false,
    fighters: [f('Sami Väisänen'), f('Colm Rudd'), f('Eero Lind')] },
  { id: 'r6', kind: 'duelist', name: 'Ruth Achterberg', sub: 'Saltmarsh Lions', competition: 'Longsword', status: 'accepted', paid: true, newTeam: false, fighters: [f('Ruth Achterberg')] },
  { id: 'r7', kind: 'duelist', name: 'Coll MacRae', sub: 'Saltmarsh Lions', competition: 'Longsword', status: 'pending', paid: false, newTeam: false, fighters: [f('Coll MacRae', false)] },
  { id: 'r8', kind: 'duelist', name: 'Ines Duarte', sub: 'Cold Harbor Guard', competition: 'Sword & Shield', status: 'pending', paid: true, newTeam: false, fighters: [f('Ines Duarte')] },
  { id: 'r9', kind: 'duelist', name: 'Ana Lund', sub: 'Emberhold', competition: 'Polearm', status: 'accepted', paid: false, newTeam: false, fighters: [f('Ana Lund', true, true, true, 'Knee brace, old ACL')] },
  { id: 'r10', kind: 'team', name: 'Saltmarsh Lions', sub: 'Norfolk, England', competition: "Men's 5v5", status: 'accepted', paid: true, newTeam: false, fighters: [f('Rory Hale'), f('Ansel Wick'), f('Mina Sato'), f('Jory Beck'), f('Ellis Fenn')] },
  { id: 'r11', kind: 'team', name: 'Emberhold', sub: 'Boise, ID', competition: "Men's 5v5", status: 'accepted', paid: true, newTeam: false, fighters: [f('Cass Rowe'), f('Nils Aberg'), f('Tavi Orr'), f('Hugo Marsh'), f('Kit Ballard')] },
  { id: 'r12', kind: 'team', name: 'Cold Harbor Guard', sub: 'Halifax, NS', competition: "Men's 5v5", status: 'accepted', paid: false, newTeam: false, fighters: [f('Ewan Pike'), f('Tess Moran'), f('Bo Lindqvist'), f('Aziz Karim'), f('Fenn Cole')] },
  { id: 'r13', kind: 'duelist', name: 'Petr Novak', sub: 'Ravenmoor', competition: 'Longsword', status: 'accepted', paid: true, newTeam: false, fighters: [f('Petr Novak')] },
  { id: 'r14', kind: 'duelist', name: 'Mara Kessling', sub: 'Iron Wardens', competition: 'Longsword', status: 'accepted', paid: true, newTeam: false, fighters: [f('Mara Kessling')] },
  { id: 'r15', kind: 'duelist', name: 'Dane Holloway', sub: 'Northgate Company', competition: 'Longsword', status: 'accepted', paid: true, newTeam: false, fighters: [f('Dane Holloway')] },
];

export interface CompetitionRow { id: string; name: string; league: 'buhurt' | 'duels'; structure: string; roundsToWin?: number; drawn: boolean }
export const COMPETITION_ROWS: CompetitionRow[] = [
  { id: 'm5', name: "Men's 5v5", league: 'buhurt', structure: 'Pools, then elimination', roundsToWin: 2, drawn: false },
  { id: 'w5', name: "Women's 5v5", league: 'buhurt', structure: 'Round robin', roundsToWin: 2, drawn: false },
  { id: 'm3', name: "Men's 3v3", league: 'buhurt', structure: 'Round robin', roundsToWin: 2, drawn: false },
  { id: 'lsw', name: 'Longsword', league: 'duels', structure: 'Pools, then elimination', drawn: false },
  { id: 'sas', name: 'Sword & Shield', league: 'duels', structure: 'Round robin', drawn: false },
  { id: 'buck', name: 'Sword & Buckler', league: 'duels', structure: 'Round robin', drawn: false },
  { id: 'pole', name: 'Polearm', league: 'duels', structure: 'Round robin', drawn: false }
];

export interface QueueItem { id: string; label: string; a: string; b: string; state: 'queued' | 'called' | 'live' | 'done' }
export const FIELD_QUEUES: { name: string; mode: 'group' | 'duel'; items: QueueItem[] }[] = [
  { name: 'Field 1 · Group fights', mode: 'group', items: [
    { id: 'q1', label: "Men's 5v5 · Pool A · 1", a: 'Iron Wardens', b: 'Ravenmoor', state: 'live' },
    { id: 'q2', label: "Men's 5v5 · Pool A · 2", a: 'Northgate Company', b: 'Iron Wardens', state: 'queued' },
    { id: 'q3', label: "Men's 5v5 · Pool A · 3", a: 'Ravenmoor', b: 'Northgate Company', state: 'queued' },
    { id: 'q4', label: "Men's 3v3 · Round robin · 1", a: 'Grey Fen Brotherhood', b: 'Emberhold', state: 'queued' }] },
  { name: 'Field 2 · Duels', mode: 'duel', items: [
    { id: 'q5', label: 'Longsword · Pool A · 1', a: 'Ruth Achterberg', b: 'Coll MacRae', state: 'called' },
    { id: 'q6', label: 'Longsword · Pool A · 2', a: 'Ruth Achterberg', b: 'Ana Lund', state: 'queued' },
    { id: 'q7', label: 'Sword & Shield · Round robin · 1', a: 'Ines Duarte', b: 'Dane Holloway', state: 'queued' }] }
];

export const STAFF = [
  { name: 'Garrett R.', role: 'Organizer', note: 'Owner of this event' },
  { name: 'Priya Nand', role: 'Scorekeeper', note: 'Field 1' },
  { name: 'Tom Beck', role: 'Scorekeeper', note: 'Field 2' },
  { name: 'Sara Ito', role: 'Medic', note: 'First aid, sees medical notes' },
  { name: 'Luka B.', role: 'Scorekeeper', note: 'Invited, has not signed in yet' }
];
