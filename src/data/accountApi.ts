import { supabase } from '../lib/supabase';

/** The caller's own fighter record id, or null when they have none yet (it appears when they join a team or register). Own row only (RLS). */
export async function fetchMyFighterId(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('fighter_accounts').select('fighter_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as { fighter_id: string } | null)?.fighter_id ?? null;
}

export interface DisciplineOption { code: string; name: string; league: string }
export async function fetchDisciplineOptions(): Promise<DisciplineOption[]> {
  const { data, error } = await supabase.from('ref_categories').select('code,name,league,sort').order('sort');
  if (error) throw error;
  return (data as { code: string; name: string; league: string }[]).map(r => ({ code: r.code, name: r.name, league: r.league }));
}

/** Public team picture paths (teams are public; pending ones only for their captain, by RLS). */
export async function fetchTeamImagePaths(teamId: string): Promise<{ logoPath: string | null; bannerPath: string | null }> {
  const { data, error } = await supabase.from('teams').select('logo_path,banner_path').eq('id', teamId).maybeSingle();
  if (error) throw error;
  const r = data as { logo_path: string | null; banner_path: string | null } | null;
  return { logoPath: r?.logo_path ?? null, bannerPath: r?.banner_path ?? null };
}

/** Is the signed in person a captain of this team? (own team_roles row; RLS limits it) */
export async function fetchIsTeamCaptain(teamId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('team_roles').select('role').eq('team_id', teamId).eq('user_id', userId).eq('role', 'captain').maybeSingle();
  if (error) throw error;
  return data !== null;
}
