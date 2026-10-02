import { supabase } from '../lib/supabase';

/** The signed-in person's own account profile (private to them). Not the public fighter profile. */

export type Interest = 'fighter' | 'captain' | 'organizer' | 'volunteer' | 'fan';
export const INTERESTS: ReadonlyArray<readonly [Interest, string, string]> = [
  ['fighter', 'Fighter', 'I compete'],
  ['captain', 'Team captain', 'I run a team'],
  ['organizer', 'Organizer', 'I put on events'],
  ['volunteer', 'Volunteer or marshal', 'I help at events'],
  ['fan', 'Fan', 'I follow the sport']
];

export interface MyProfile { displayName: string; interests: Interest[]; city: string; region: string; country: string; onboarded: boolean }
type Row = { display_name: string; interests: Interest[] | null; city: string | null; region: string | null; country: string | null; onboarded_at: string | null };

export async function fetchMyProfile(userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase.from('profiles').select('display_name,interests,city,region,country,onboarded_at').eq('id', userId).maybeSingle();
  if (error) throw error;
  const r = data as Row | null;
  return r ? { displayName: r.display_name, interests: r.interests ?? [], city: r.city ?? '', region: r.region ?? '', country: r.country ?? '', onboarded: r.onboarded_at !== null } : null;
}

export interface ProfileInput { displayName: string; interests: Interest[]; city: string; region: string; country: string }
export function validateProfileInput(p: ProfileInput): Partial<Record<keyof ProfileInput, string>> {
  const e: Partial<Record<keyof ProfileInput, string>> = {};
  const n = p.displayName.trim().length;
  if (n < 2 || n > 80) e.displayName = 'Your name must be 2 to 80 characters.';
  if (p.interests.length === 0) e.interests = 'Choose at least one.';
  if ([p.city, p.region, p.country].some(v => v.trim().length > 80)) e.city = 'City, province and country are at most 80 characters.';
  return e;
}

export async function completeMyProfile(p: ProfileInput): Promise<void> {
  const t = (s: string) => (s.trim() === '' ? null : s.trim());
  const { error } = await supabase.rpc('complete_my_profile', { p_name: p.displayName.trim(), p_interests: p.interests, p_city: t(p.city), p_region: t(p.region), p_country: t(p.country) });
  if (error) throw error;
}

/** Where the profile step sends people back to: only paths inside the app. */
export const safeNext = (next: string | null): string => (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/welcome') ? next : '/account');
