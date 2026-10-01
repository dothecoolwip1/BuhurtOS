/** The skill model of the simulation: a rating per fighter, discipline and event, and the win probability between two ratings. */
import type { Cat, FighterDef, TeamDef } from './roster';
import { isMelee } from './roster';
import type { EventDef } from './events';
import { traitsOf, teamTraitsOf } from './traits';
import { gauss, rngFor, clamp, yearOf } from './util';

const noiseCache = new Map<string, number>();
const cachedGauss = (label: string, sd: number): number => {
  let v = noiseCache.get(label);
  if (v === undefined) { v = gauss(rngFor(label)); noiseCache.set(label, v); }
  return v * sd;
};

export const yearsBetween = (fromIso: string, toIso: string): number => (Date.parse(toIso) - Date.parse(fromIso)) / (365.25 * 86400000);

/**
 * Rating of one fighter in one discipline at one event. Parts: experience since joining, age, a personal talent per discipline,
 * the owner's notes (strongest discipline, melee or duel specialist, improving newcomer, declining veteran), the club's form that
 * season (clubs improve and decline) and a small home-province bonus. Higher is better; 100 points is a clear edge.
 */
export function fighterRating(f: FighterDef, team: TeamDef, cat: Cat, ev: EventDef): number {
  const tr = traitsOf(f.name), tt = teamTraitsOf(team.name);
  const year = yearOf(ev.start);
  const y = Math.max(0, yearsBetween(f.joinDate, ev.start));
  const age = f.age - (2026 - year);
  const ageAdj = age < 26 ? -4 * (26 - age) : age > 35 ? -5 * (age - 35) : 0;
  const melee = isMelee(cat);
  const talent = cachedGauss(`talent|${f.name}|${cat}`, 32) + cachedGauss(`talent|${f.name}`, 22);
  const growth = tr.growth * Math.min(y, tr.growthYears) * (tr.growth > 0 ? tt.development : 1);
  const fade = tr.fade * Math.max(0, year - 2024);
  const form = tt.form[year]?.[melee ? 0 : 1] ?? 0;
  const bias = melee ? tr.melee : tr.duel + tt.duelCulture;
  const strong = tr.strong === cat ? 90 : 0;
  const home = ev.prov === team.prov ? 18 : 0;
  const perEvent = cachedGauss(`form|${f.name}|${ev.slug}`, 24);
  return 1500 + 16 * Math.min(y, 8) + ageAdj + talent + growth - fade + form + bias + strong + tr.skill + home + perEvent;
}

/** A team entry's rating: the mean of its roster's melee ratings, the club's synergy, minus a cohesion cost per mercenary. */
export function teamRating(ratings: readonly number[], team: TeamDef, mercenaries: number): number {
  const mean = ratings.reduce((a, b) => a + b, 0) / Math.max(1, ratings.length);
  return mean + teamTraitsOf(team.name).synergy - 9 * mercenaries;
}

/** Chance that A beats B. */
export const winProb = (ra: number, rb: number, scale = 330): number => 1 / (1 + 10 ** ((rb - ra) / scale));

export const volOf = (f: FighterDef): number => clamp(traitsOf(f.name).vol, 0.4, 2);
