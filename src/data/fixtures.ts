import type { BracketRound, Competition, Duelist, EventSummary, FieldQueue, ProBout, ScheduleItem, StandingRow, Team } from './types';

/** SAMPLE DATA. Every team, person, event and score below is invented for the mock-up phase. */
export const SAMPLE_DATA = true;

export const TEAMS: Record<string, Team> = {
  ironwardens: { id: 'ironwardens', name: 'Iron Wardens', place: 'Calgary, Alberta', colors: ['#2C4A8C', '#E9ECEF'], division: 'pale', initial: 'W', points: 1840, record: [14, 4] },
  northgate: { id: 'northgate', name: 'Northgate Company', place: 'Kamloops, British Columbia', colors: ['#B42318', '#D4A63A'], division: 'chevron', initial: 'N', points: 1765, record: [12, 5] },
  greyfen: { id: 'greyfen', name: 'Grey Fen Brotherhood', place: 'Duluth, Minnesota', colors: ['#1A1D22', '#D4A63A'], division: 'bend', initial: 'G', points: 1610, record: [11, 6] },
  saltmarsh: { id: 'saltmarsh', name: 'Saltmarsh Lions', place: 'Norfolk, England', colors: ['#2F7A4F', '#E9ECEF'], division: 'quarterly', initial: 'S', points: 1588, record: [10, 6] },
  ravenmoor: { id: 'ravenmoor', name: 'Ravenmoor', place: 'Winnipeg, Manitoba', colors: ['#6B3F8C', '#E9ECEF'], division: 'fess', initial: 'R', points: 1502, record: [9, 7] },
  emberhold: { id: 'emberhold', name: 'Emberhold', place: 'Boise, Idaho', colors: ['#C9622A', '#1A1D22'], division: 'saltire', initial: 'E', points: 1455, record: [8, 7] },
  coldharbor: { id: 'coldharbor', name: 'Cold Harbor Guard', place: 'Halifax, Nova Scotia', colors: ['#2C4A8C', '#D4A63A'], division: 'chevron', initial: 'C', points: 1390, record: [7, 8] },
  thornwick: { id: 'thornwick', name: 'Thornwick', place: 'Spokane, Washington', colors: ['#1A1D22', '#E9ECEF'], division: 'quarterly', initial: 'T', points: 1322, record: [6, 8] }
};
export const TEAM_LIST = Object.values(TEAMS);

export const EVENTS: EventSummary[] = [
  { id: 'prairie-steel-open', month: 'Oct', day: '17', year: '2026', name: 'Prairie Steel Open', meta: ['Example Fairgrounds, AB', '5 competitions', 'Hosted by Iron Wardens'], leagues: ['buhurt', 'duels', 'outrance'], tier: 'Classic', badges: [{ tone: 'live', label: 'Live now' }], hasHub: true },
  { id: 'northern-lists', month: 'Nov', day: '07', year: '2026', name: 'Northern Lists Training Day', meta: ['Kamloops, BC', 'Open practice, all formats', 'Hosted by Northgate Company'], leagues: ['buhurt', 'duels'], tier: 'Practice', badges: [{ tone: 'win', label: 'Open to all' }], hasHub: false },
  { id: 'cascade-source-cup', month: 'Nov', day: '14', year: '2026', name: 'Cascade Source Cup', meta: ['Spokane, WA', "Men's 5v5 · 4 teams", 'Developing-region event'], leagues: ['buhurt'], tier: 'Source', badges: [{ tone: 'brass', label: 'Registration open' }], hasHub: false },
  { id: 'harbor-profight', month: 'Nov', day: '21', year: '2026', name: 'Harbor Profight Night', meta: ['Halifax, NS', 'Matched fights · 12 bouts'], leagues: ['outrance'], tier: 'Matched fights', badges: [{ tone: 'brass', label: 'Registration open' }], hasHub: false },
  { id: 'great-lakes-regional', month: 'Feb', day: '06', year: '2027', name: 'Great Lakes Regional Duels', meta: ['Duluth, MN', 'Longsword · Sword & Shield · Polearm'], leagues: ['duels'], tier: 'Regional', badges: [{ tone: '', label: 'Opens Dec 1' }], hasHub: false },
  { id: 'na-conference-cup', month: 'Jun', day: '19', year: '2027', name: 'North America Conference Cup', meta: ['Location to be announced', 'Group fight and duels'], leagues: ['buhurt', 'duels'], tier: 'Conference', badges: [{ tone: '', label: 'Submitted to BI' }], hasHub: false }
];

export const FEATURED_EVENT = {
  id: 'prairie-steel-open',
  name: 'Prairie Steel Open',
  dates: 'Sat 17 – Sun 18 Oct 2026',
  venue: 'Example Fairgrounds, Alberta',
  hostTeam: 'ironwardens'
};

export const COMPETITIONS: Competition[] = [
  { id: 'm5', name: "Men's 5v5", league: 'buhurt', tier: 'Classic', division: 'Open', entrants: '8 teams', structure: 'Elimination bracket', status: { tone: 'live', label: 'Semifinals live' } },
  { id: 'w5', name: "Women's 5v5", league: 'buhurt', tier: 'Classic', division: 'Division 1', entrants: '5 teams', structure: 'Round robin', status: { tone: '', label: 'Starts Sat 16:00' } },
  { id: 'lsw', name: 'Longsword', league: 'duels', tier: 'Classic', division: 'Open', entrants: '10 duellists', structure: 'Two pools, then semifinals', status: { tone: 'live', label: 'Pools running' } },
  { id: 'sas', name: 'Sword & Shield', league: 'duels', tier: 'Classic', division: 'Open', entrants: '5 duellists', structure: 'Round robin', status: { tone: 'win', label: 'Finished' } },
  { id: 'pf', name: 'Profight · Heavyweight', league: 'outrance', tier: 'Tournament fights', division: 'Division 1', entrants: '6 bouts', structure: '2 rounds of 2:00, 10-point must', status: { tone: '', label: 'Sat 18:00' } }
];

export const BRACKET_M5: BracketRound[] = [
  { name: 'Quarterfinals', when: 'Sat', matches: [
    { id: 'QF1', a: 'ironwardens', b: 'thornwick', rounds: [2, 0], status: 'done', note: 'Final' },
    { id: 'QF2', a: 'saltmarsh', b: 'ravenmoor', rounds: [2, 1], status: 'done', note: 'Final' },
    { id: 'QF3', a: 'greyfen', b: 'emberhold', rounds: [2, 1], status: 'done', note: 'Final' },
    { id: 'QF4', a: 'northgate', b: 'coldharbor', rounds: [2, 0], status: 'done', note: 'Final' }] },
  { name: 'Semifinals', when: 'Sat', matches: [
    { id: 'SF1', a: 'ironwardens', b: 'northgate', rounds: [1, 1], status: 'live', note: '' },
    { id: 'SF2', a: 'greyfen', b: 'saltmarsh', status: 'next', note: 'Field 1 · next' }] },
  { name: 'Final', when: 'Sun 10:00', matches: [{ id: 'F', status: 'next', note: 'Field 1' }] }
];

export const RR_W5: StandingRow[] = [
  { name: 'Northgate Company', teamId: 'northgate', wins: 4, losses: 0, metric: '+8' },
  { name: 'Saltmarsh Lions', teamId: 'saltmarsh', wins: 3, losses: 1, metric: '+5' },
  { name: 'Emberhold', teamId: 'emberhold', wins: 2, losses: 2, metric: '+1' },
  { name: 'Ravenmoor', teamId: 'ravenmoor', wins: 1, losses: 3, metric: '-4' },
  { name: 'Cold Harbor Guard', teamId: 'coldharbor', wins: 0, losses: 4, metric: '-10' }
];

export const DUELISTS: Duelist[] = [
  { name: 'Mara Kessling', club: 'Iron Wardens' }, { name: 'Dane Holloway', club: 'Northgate Company' },
  { name: 'Ruth Achterberg', club: 'Saltmarsh Lions' }, { name: 'Sami Väisänen', club: 'Grey Fen Brotherhood' },
  { name: 'Coll MacRae', club: 'Saltmarsh Lions' }, { name: 'Ines Duarte', club: 'Cold Harbor Guard' },
  { name: 'Petr Novak', club: 'Ravenmoor' }, { name: 'Ana Lund', club: 'Emberhold' },
  { name: 'Teo Villanueva', club: 'Iron Wardens' }, { name: 'Bram Okafor', club: 'Iron Wardens' }
];
export const clubOf = (name: string) => DUELISTS.find(d => d.name === name)?.club ?? '';

export const POOL_A: StandingRow[] = [
  { name: 'Mara Kessling', wins: 4, losses: 0, metric: '2.4' }, { name: 'Coll MacRae', wins: 3, losses: 1, metric: '1.6' },
  { name: 'Ines Duarte', wins: 2, losses: 2, metric: '1.1' }, { name: 'Petr Novak', wins: 1, losses: 3, metric: '0.8' },
  { name: 'Teo Villanueva', wins: 0, losses: 4, metric: '0.4' }
];
export const POOL_B: StandingRow[] = [
  { name: 'Ruth Achterberg', wins: 3, losses: 1, metric: '1.8' }, { name: 'Dane Holloway', wins: 3, losses: 1, metric: '1.5' },
  { name: 'Sami Väisänen', wins: 2, losses: 2, metric: '1.0' }, { name: 'Ana Lund', wins: 1, losses: 3, metric: '0.7' },
  { name: 'Bram Okafor', wins: 1, losses: 3, metric: '0.6' }
];
export const SAS_ROUND_ROBIN: StandingRow[] = [
  { name: 'Mara Kessling', wins: 4, losses: 0, metric: '2.2' }, { name: 'Dane Holloway', wins: 3, losses: 1, metric: '1.7' },
  { name: 'Coll MacRae', wins: 2, losses: 2, metric: '1.0' }, { name: 'Ruth Achterberg', wins: 1, losses: 3, metric: '0.7' },
  { name: 'Ana Lund', wins: 0, losses: 4, metric: '0.3' }
];

export const PRO_CARD: ProBout[] = [
  { no: '1', weight: 'Light', a: 'Ines Duarte', b: 'Ana Lund', winner: 'Ines Duarte', result: 'UD 20–18', note: '3 marshals agree' },
  { no: '2', weight: 'Heavy', a: 'Petr Novak', b: 'Sami Väisänen', winner: 'Sami Väisänen', result: 'SD 19–19, 19–18', note: 'Split decision' },
  { no: '3', weight: 'Heavy', a: 'Coll MacRae', b: 'Dane Holloway', result: 'Sat 18:40', note: 'Next up' },
  { no: '4', weight: 'Heavy', a: 'Mara Kessling', b: 'Ruth Achterberg', result: 'Sat 19:05', note: '' }
];

export const FIELDS: FieldQueue[] = [
  { name: 'Field 1 · Group fight', slots: [
    { kind: 'now', label: 'Now', teamA: 'ironwardens', teamB: 'northgate', score: '1 – 1', sub: "Men's 5v5 · Semifinal 1 · Round 3" },
    { kind: 'deck', label: 'On deck', teamA: 'greyfen', teamB: 'saltmarsh', sub: "Men's 5v5 · Semifinal 2" },
    { kind: 'hole', label: 'Next', sub: "Women's 5v5 · Round robin · 2 fights" }] },
  { name: 'Field 2 · Duels', slots: [
    { kind: 'now', label: 'Now', score: '3 – 2', sub: 'Longsword · Pool B · Holloway v Lund · Round 2 · 0:41' },
    { kind: 'deck', label: 'On deck', sub: 'Longsword · Pool B · Achterberg v Väisänen' },
    { kind: 'hole', label: 'Next', sub: 'Sword & Shield · Round robin · Lund v Achterberg' }] }
];

export const SCHEDULE: { day: string; items: ScheduleItem[] }[] = [
  { day: 'Saturday', items: [
    { time: '09:00', state: 'done', title: 'Kit check and weigh-in', text: 'Main tent. Bring helmet, gorget, gauntlets and weapons.' },
    { time: '10:30', state: 'done', title: "Men's 5v5 · quarterfinals", text: 'Field 1. Four fights.' },
    { time: '11:00', state: 'done', title: 'Sword & Shield · round robin', text: 'Field 2. Five duellists.' },
    { time: '13:00', state: 'on', title: 'Longsword · pools', text: 'Field 2. Happening now.' },
    { time: '14:30', state: 'on', title: "Men's 5v5 · semifinals", text: 'Field 1. Happening now.' },
    { time: '16:00', state: '', title: "Women's 5v5 · round robin", text: 'Field 1.' },
    { time: '18:00', state: '', title: 'Profight · heavyweight card', text: 'Field 2. Six bouts, three line marshals.' }] },
  { day: 'Sunday', items: [
    { time: '10:00', state: '', title: "Men's 5v5 · final and 3rd place", text: 'Field 1.' },
    { time: '11:30', state: '', title: 'Longsword · semifinals and final', text: 'Field 2.' },
    { time: '14:00', state: '', title: 'Awards', text: 'Main tent.' }] }
];

export const RANKINGS = {
  "Men's 5v5": { kind: 'team' as const, rows: ['ironwardens', 'northgate', 'greyfen', 'saltmarsh', 'ravenmoor', 'emberhold', 'coldharbor', 'thornwick'] }
};
export const MOVES: ['up' | 'dn' | 'eq', number][] = [['up', 2], ['eq', 0], ['up', 1], ['dn', 3], ['up', 4], ['dn', 1], ['eq', 0], ['dn', 2]];
