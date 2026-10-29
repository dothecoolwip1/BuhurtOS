/** Pack 29: Profight (Outrance) reference data and the §17 standings. Read only; every change goes through the database functions. */
import { supabase } from '../lib/supabase';

export interface WeightClass { code: string; category: string; gender: 'men' | 'women'; name: string; maxKg: number | null; sort: number }
/** Outrance §1.2: the weight classes (men 6, women 5). */
export async function fetchWeightClasses(): Promise<WeightClass[]> {
  const { data, error } = await supabase.from('ref_weight_classes').select('code,category,gender,name,max_kg,sort').order('sort');
  if (error) throw error;
  return (data as Array<{ code: string; category: string; gender: 'men' | 'women'; name: string; max_kg: number | null; sort: number }>)
    .map(w => ({ code: w.code, category: w.category, gender: w.gender, name: w.name, maxKg: w.max_kg, sort: w.sort }));
}

export interface StandingRow {
  fighterId: string; name: string; gender: string; weightClass: string | null; weightClassName: string; weightClassSort: number | null;
  fights: number; wins: number; losses: number; draws: number; lastFightAt: string | null; status: 'active' | 'retired'; current: boolean; rank: number | null;
}
/** Outrance §17: win/loss records within the weight class; retired after a year without a fight, out of the standings after two. */
export async function fetchProfightStandings(): Promise<StandingRow[]> {
  const { data, error } = await supabase.from('profight_standings').select('*');
  if (error) throw error;
  return (data as Array<Record<string, unknown>>).map(r => ({
    fighterId: String(r.fighter_id), name: String(r.display_name), gender: String(r.gender), weightClass: (r.weight_class as string | null) ?? null,
    weightClassName: String(r.weight_class_name), weightClassSort: (r.weight_class_sort as number | null) ?? null,
    fights: Number(r.fights), wins: Number(r.wins), losses: Number(r.losses), draws: Number(r.draws), lastFightAt: (r.last_fight_at as string | null) ?? null,
    status: r.status === 'retired' ? 'retired' : 'active', current: Boolean(r.current), rank: r.rank == null ? null : Number(r.rank)
  }));
}

/** The standings as the page shows them: per division, per weight class (in the rules' order, open weight last), each fighter in their current class. */
export function groupStandings(rows: readonly StandingRow[], gender: string): { weightClass: string; rows: StandingRow[]; retired: StandingRow[] }[] {
  const mine = rows.filter(r => r.gender === gender && r.current);
  const classes = [...new Map(mine.map(r => [r.weightClassName, r.weightClassSort ?? 999])).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return classes.map(([wc]) => ({
    weightClass: wc,
    rows: mine.filter(r => r.weightClassName === wc && r.status === 'active').sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.name.localeCompare(b.name)),
    retired: mine.filter(r => r.weightClassName === wc && r.status === 'retired').sort((a, b) => a.name.localeCompare(b.name))
  }));
}
