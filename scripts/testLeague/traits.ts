/**
 * Hand-authored simulation traits for NACL-test fighters and teams. They translate the owner's notes in roster.md ("attend: HIGH",
 * "declining", "improving", "melee specialist", "strongest discipline ...") into numbers. They are inputs of the SIMULATION only: the
 * results that come out are loaded through the real RPCs, and the bios are written afterwards from those results.
 */
import type { Cat, Prov } from './roster';

export type KClass = 'very' | 'high' | 'norm' | 'low' | 'rare';

export interface Traits {
  /** Attendance class: very = 10-12 events, high = 7-9, norm = 4-6, low = 3, rare = 2. */
  k: KClass;
  /** Exact number of events, when the owner states it. */
  kFixed?: number;
  /** Rating points gained per season of experience, for at most growthYears seasons (improving newcomers). */
  growth: number;
  growthYears: number;
  /** Rating points lost per season after 2024 (declining veterans who are still competitive). */
  fade: number;
  /** Multiplier on attendance weight per season after 2024 (1 = no change, 0.7 = comes less and less). */
  attFade: number;
  /** Flat bias of the melee (5v5, 3v3) and duel ratings. A melee specialist: melee up, duel down. */
  melee: number;
  duel: number;
  strong?: Cat;
  /** Extra randomness of results (1 = normal, above 1 = inconsistent). */
  vol: number;
  /** Chance of entering a duel discipline when attending (default 0.9) and a melee one (default 0.9). */
  duelEntry: number;
  meleeEntry: number;
  /** Always enters every discipline listed at an event. */
  enterAll: boolean;
  /** Mostly appears at large events (skips many small ones). */
  majorOnly: boolean;
  /** Rarely leaves Alberta. */
  homeOnly: boolean;
  provMult: Partial<Record<Prov, number>>;
  cityMult: Record<string, number>;
  skill: number;
}

const base: Traits = {
  k: 'norm', growth: 0, growthYears: 3, fade: 0, attFade: 1, melee: 0, duel: 0, vol: 1, duelEntry: 0.9, meleeEntry: 0.97,
  enterAll: false, majorOnly: false, homeOnly: false, provMult: {}, cityMult: {}, skill: 0
};

const T = (t: Partial<Traits>): Traits => ({ ...base, ...t });

/** Keyed by the fighter's name without "-test". */
const FIGHTER_TRAITS: Record<string, Traits> = {
  // 1 Iron Wolves: aggressive melee culture
  'Aldric Stone': T({ k: 'very', melee: 40, growth: 12, growthYears: 5, enterAll: true }),
  'Bram Holt': T({ k: 'high', melee: 25, skill: 10 }),
  'Cedric Vale': T({ k: 'low', skill: 40, attFade: 0.9 }),
  'Darius Flint': T({ k: 'norm', growth: 40, growthYears: 3, skill: -25 }),
  'Erik Thorn': T({ k: 'norm', vol: 0.6, skill: 5 }),
  'Finn Mercer': T({ k: 'norm', growth: 30, growthYears: 2, skill: -30 }),
  'Gunnar Reed': T({ k: 'norm', attFade: 0.7, fade: 8, skill: 55 }),
  'Astrid Vale': T({ k: 'very', strong: 'longsword', enterAll: true, skill: 25 }),
  'Brynn Stone': T({ k: 'norm', melee: 75, duel: -45 }),
  'Freya Holt': T({ k: 'low', strong: 'polearm', majorOnly: true, skill: 35 }),
  'Ingrid Thorn': T({ k: 'norm', growth: 70, growthYears: 3, skill: -20, meleeEntry: 0.7 }),
  'Kara Reed': T({ k: 'norm', homeOnly: true }),
  // 2 Blackforge Knights: structured training, strong duelists
  'Arthur Crowe': T({ k: 'high', strong: 'longsword', skill: 30 }),
  'Beckett Frost': T({ k: 'high', vol: 1.7, provMult: { BC: 1.6, SK: 1.4 } }),
  'Corbin Ash': T({ k: 'norm', melee: 50, duel: -50, duelEntry: 0.25 }),
  'Damon Pike': T({ k: 'norm', growth: 65, growthYears: 3, skill: -45 }),
  'Elias Ward': T({ k: 'high', majorOnly: true, provMult: { MB: 0.15 }, skill: 10 }),
  'Felix Crane': T({ k: 'norm', melee: 55, duel: -40 }),
  'Griffin Shaw': T({ k: 'norm', attFade: 0.55, skill: 20 }),
  'Amelia Crowe': T({ k: 'high', strong: 'longsword', skill: 25 }),
  'Bianca Frost': T({ k: 'high', provMult: { BC: 2.6, SK: 2 } }),
  'Clara Ash': T({ k: 'rare', kFixed: 2, strong: 'polearm', skill: 40 }),
  'Delia Pike': T({ k: 'norm', growth: 50, growthYears: 3, skill: -25 }),
  'Evelyn Ward': T({ k: 'norm', vol: 0.55 }),
  // 3 Northern Ravens: large travel culture
  'Hakon Black': T({ k: 'high', melee: 25, skill: 25 }),
  'Ivar North': T({ k: 'very', enterAll: true }),
  'Jasper Grey': T({ k: 'norm', strong: 'sword_shield', skill: 10 }),
  'Kjell Storm': T({ k: 'norm', attFade: 0.7, melee: 20, skill: 25 }),
  'Leif Raven': T({ k: 'high', growth: 85, growthYears: 3, skill: -40 }),
  'Magnus Snow': T({ k: 'very', melee: 20, enterAll: true }),
  'Nils Frost': T({ k: 'high', provMult: { BC: 1.8, SK: 1.8, MB: 2.2 } }),
  'Helga Black': T({ k: 'high', skill: 30 }),
  'Isla North': T({ k: 'very', enterAll: true, skill: 10 }),
  'Jora Grey': T({ k: 'high', enterAll: true }),
  'Liv Storm': T({ k: 'norm', strong: 'longsword', attFade: 0.55, skill: 30 }),
  'Mira Raven': T({ k: 'norm', growth: 45, growthYears: 3, skill: -25 }),
  // 4 Crimson Stags: develops new fighters
  'Owen Hart': T({ k: 'high', skill: 35 }),
  'Percival Red': T({ k: 'high', cityMult: { 'Calgary': 3, 'Red Deer': 3 } }),
  'Quentin Oak': T({ k: 'norm', strong: 'polearm', skill: 10 }),
  'Rowan Hart': T({ k: 'norm', growth: 55, growthYears: 3, skill: -35 }),
  'Silas Ember': T({ k: 'norm', vol: 1.6 }),
  'Tristan Wood': T({ k: 'low', attFade: 0.55, skill: 25 }),
  'Ulric Red': T({ k: 'norm', growth: 30, growthYears: 3, skill: -10 }),
  'Nora Hart': T({ k: 'high', homeOnly: true }),
  'Ophelia Red': T({ k: 'norm', skill: 20, vol: 0.9 }),
  'Piper Oak': T({ k: 'high', melee: 30, skill: 25 }),
  'Rhea Ember': T({ k: 'norm', growth: 50, growthYears: 3, skill: -30 }),
  'Sigrid Wood': T({ k: 'low', attFade: 0.5, skill: 25 }),
  // 5 Steel Serpents: balanced, disciplined team fighting
  'Victor Steel': T({ k: 'high', skill: 35 }),
  'Wyatt Coil': T({ k: 'high', provMult: { BC: 0.4, SK: 0.4, MB: 0.3 } }),
  'Xavier Fang': T({ k: 'norm', skill: 5 }),
  'Yorick Steel': T({ k: 'high', enterAll: true }),
  'Zachary Viper': T({ k: 'norm', strong: 'sword_shield', skill: 10 }),
  'Abel Coil': T({ k: 'low', attFade: 0.55, skill: 25 }),
  'Brogan Fang': T({ k: 'norm', growth: 45, growthYears: 3, skill: -30 }),
  'Talia Steel': T({ k: 'high', skill: 40 }),
  'Una Coil': T({ k: 'norm' }),
  'Vera Fang': T({ k: 'norm' }),
  'Willa Viper': T({ k: 'norm', growth: 20 }),
  'Xena Steel': T({ k: 'norm' }),
  // 6 Mountain Bears: conditioning, travel-focused
  'Calder Bear': T({ k: 'high', skill: 10 }),
  'Declan Ridge': T({ k: 'norm' }),
  'Emmett Stone': T({ k: 'norm', growth: 15 }),
  'Fraser Peak': T({ k: 'norm' }),
  'Gideon Bear': T({ k: 'low', attFade: 0.5, skill: 25 }),
  'Holden Ridge': T({ k: 'norm', growth: 25 }),
  'Isaac Stone': T({ k: 'norm', growth: 50, growthYears: 3, skill: -35 }),
  'Yara Bear': T({ k: 'norm' }),
  'Zelda Ridge': T({ k: 'norm', strong: 'longsword' }),
  'Ada Stone': T({ k: 'norm', growth: 25 }),
  'Belle Peak': T({ k: 'norm', skill: 10 }),
  'Cora Bear': T({ k: 'low', skill: 30, attFade: 0.7 }),
  // 7 Stormbreakers: Saskatchewan, Alberta regularly but less in southern Alberta
  'Jaxon Thunder': T({ k: 'norm' }),
  'Kane Bolt': T({ k: 'norm', strong: 'polearm', skill: 15 }),
  'Lachlan Rain': T({ k: 'norm' }),
  'Milo Storm': T({ k: 'norm' }),
  'Nolan Thunder': T({ k: 'norm' }),
  'Orion Bolt': T({ k: 'norm', growth: 45, growthYears: 3, skill: -30 }),
  'Parker Rain': T({ k: 'low', attFade: 0.55, skill: 10 }),
  // 8 Golden Lions: duel emphasis
  'Roderick Gold': T({ k: 'norm', skill: 20 }),
  'Tobias Crown': T({ k: 'norm', strong: 'polearm', skill: 15 }),
  'Warren Crown': T({ k: 'low', attFade: 0.7, skill: 30 }),
  'Xander Gold': T({ k: 'norm', growth: 50, growthYears: 3, skill: -30 }),
  'Kira Crown': T({ k: 'norm', skill: 25 }),
  // 9 Ashen Guard
  'Gareth Ash': T({ k: 'rare', kFixed: 2, attFade: 0.4, skill: 20 }),
  // 10 Frostborn Raiders
  'Lars Frost': T({ k: 'norm', strong: 'polearm', skill: 20 }),
  'Niklas Ice': T({ k: 'norm', growth: 50, growthYears: 3, skill: -30 })
};

export const traitsOf = (name: string): Traits => FIGHTER_TRAITS[name.replace(/-test$/, '')] ?? base;
export const kFixedOf = (name: string): number | undefined => FIGHTER_TRAITS[name.replace(/-test$/, "")]?.kFixed;

/** Which team plays where. radius = km at which the team's willingness to travel falls to 1/e. */
export interface TeamTraits {
  radiusKm: number;
  /** Multiplier on attendance weight for an event province. */
  provMult: Partial<Record<Prov, number>>;
  /** Southern Alberta multiplier (Calgary and south). */
  southAB?: number;
  /** Fraction of the team that travels to events outside its province (smaller groups to distant events). */
  awayShare: number;
  /** Melee synergy (disciplined, aggressive or conditioned team fighting) and duel emphasis, in rating points. */
  synergy: number;
  duelCulture: number;
  /** Per season (2023..2026): [melee form, duel form]. Teams improve and decline; no team is strong everywhere. */
  form: Record<number, [number, number]>;
  /** How much newcomers of the club improve on top of their own growth. */
  development: number;
}

export const TEAM_TRAITS: Record<string, TeamTraits> = {
  'Iron Wolves': { radiusKm: 650, provMult: {}, awayShare: 0.8, synergy: 15, duelCulture: 0, development: 1, form: { 2023: [35, 0], 2024: [55, 10], 2025: [30, 0], 2026: [5, -10] } },
  'Blackforge Knights': { radiusKm: 650, provMult: {}, awayShare: 0.8, synergy: 0, duelCulture: 25, development: 1, form: { 2023: [10, 30], 2024: [20, 40], 2025: [25, 45], 2026: [30, 40] } },
  'Northern Ravens': { radiusKm: 1250, provMult: { BC: 1.4, SK: 1.5, MB: 1.6 }, awayShare: 1, synergy: 10, duelCulture: 0, development: 1, form: { 2023: [30, 10], 2024: [35, 20], 2025: [45, 30], 2026: [40, 35] } },
  'Crimson Stags': { radiusKm: 500, provMult: {}, awayShare: 0.7, synergy: 0, duelCulture: 0, development: 1.5, form: { 2023: [-30, -20], 2024: [-10, 0], 2025: [15, 25], 2026: [35, 40] } },
  'Steel Serpents': { radiusKm: 550, provMult: { BC: 0.6, MB: 0.5 }, awayShare: 0.7, synergy: 28, duelCulture: 0, development: 1, form: { 2023: [20, 0], 2024: [25, 5], 2025: [20, 0], 2026: [25, 5] } },
  'Mountain Bears': { radiusKm: 950, provMult: { BC: 1.6 }, awayShare: 0.9, synergy: 12, duelCulture: 0, development: 1, form: { 2023: [-20, -10], 2024: [0, 0], 2025: [25, 15], 2026: [45, 30] } },
  Stormbreakers: { radiusKm: 750, provMult: { SK: 2.6, MB: 1.1, BC: 0.15 }, southAB: 0.35, awayShare: 0.55, synergy: 5, duelCulture: 0, development: 1, form: { 2023: [30, 20], 2024: [25, 15], 2025: [0, -5], 2026: [-25, -20] } },
  'Golden Lions': { radiusKm: 380, provMult: { SK: 2.4, MB: 0.9, BC: 0.15 }, awayShare: 0.45, synergy: -15, duelCulture: 30, development: 1, form: { 2023: [-20, 25], 2024: [-15, 35], 2025: [-10, 45], 2026: [0, 55] } },
  'Ashen Guard': { radiusKm: 520, provMult: { MB: 3.2, SK: 1.2, AB: 0.4, BC: 0.1 }, awayShare: 0.5, synergy: 8, duelCulture: 0, development: 1, form: { 2023: [0, -10], 2024: [10, 0], 2025: [20, 5], 2026: [15, 10] } },
  'Frostborn Raiders': { radiusKm: 520, provMult: { BC: 3.2, AB: 1, SK: 0.2, MB: 0.1 }, awayShare: 0.6, synergy: 0, duelCulture: 0, development: 1, form: { 2023: [-35, -25], 2024: [-15, -10], 2025: [10, 5], 2026: [30, 25] } }
};
export const teamTraitsOf = (name: string): TeamTraits => TEAM_TRAITS[name.replace(/-test$/, '')];
