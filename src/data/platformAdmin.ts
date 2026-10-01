import { supabase } from '../lib/supabase';
import { adminListFighters, adminListTeams, type AdminFighterRow, type AdminTeamRow } from './admin';
import { collectPages, type AuditEntry } from '../lib/platformAdmin';

/** Owner-only reads for the platform screens. Each is checked by the database (RPC refusal or row level security); an empty answer is shown as empty. */

export const fetchAllAdminTeams = (query: string | null) => collectPages<AdminTeamRow>(o => adminListTeams(query, 200, o));
export const fetchAllAdminFighters = (query: string | null, teamId: string | null) => collectPages<AdminFighterRow>(o => adminListFighters(query, teamId, 200, o));

/** Newest first. audit_log is readable by the platform owner (migration 0500 audit_read); anyone else gets no rows. */
export async function fetchAuditFor(subject: string, limit = 5): Promise<AuditEntry[]> {
  const { data, error } = await supabase.from('audit_log').select('id,at,action,details').eq('subject', subject).order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as unknown as Array<{ id: number; at: string; action: string; details: Record<string, unknown> | null }>).map(r => ({ id: r.id, at: r.at, action: r.action, details: r.details ?? {} }));
}

/** logo_path of a team (the public teams table). */
export async function fetchTeamLogoPath(teamId: string): Promise<string | null> {
  const { data, error } = await supabase.from('teams').select('logo_path').eq('id', teamId).maybeSingle();
  if (error) throw error;
  return (data as { logo_path: string | null } | null)?.logo_path ?? null;
}
