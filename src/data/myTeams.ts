import { supabase } from '../lib/supabase';

export interface TeamChoice { id: string; slug: string; name: string; city: string | null; region: string | null; country: string | null }

/** Approved teams are public to read. Filtering by name or city happens in the browser (see filterTeams). */
export async function fetchApprovedTeams(): Promise<TeamChoice[]> {
  const { data, error } = await supabase.from('teams').select('id,slug,name,city,region,country').eq('status', 'approved').order('name').limit(1000);
  if (error) throw error;
  return data as TeamChoice[];
}

export interface CaptainedTeam { teamId: string; name: string; slug: string; status: 'pending' | 'approved' }

/** Teams the signed-in person captains, including a proposed team still waiting for review. A person can always read their own roles. */
export async function fetchMyCaptainedTeams(): Promise<CaptainedTeam[]> {
  const { data, error } = await supabase.from('team_roles').select('team_id,teams(name,slug,status)').eq('role', 'captain');
  if (error) throw error;
  type T = { name: string; slug: string; status: 'pending' | 'approved' };
  type Row = { team_id: string; teams: T | T[] | null };
  return (data as unknown as Row[]).flatMap(r => {
    const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
    return t ? [{ teamId: r.team_id, name: t.name, slug: t.slug, status: t.status }] : [];
  });
}
