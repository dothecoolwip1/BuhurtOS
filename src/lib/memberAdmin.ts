import type { EventRole } from '../types';
import { supabase } from './supabase';

export interface EventMembershipView {
  id: string;
  userId: string;
  role: EventRole;
  teamId?: string;
  displayName: string;
}

export async function listEventMemberships(eventId: string): Promise<EventMembershipView[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('event_memberships').select('id,user_id,role,team_id,profiles(display_name)').eq('event_id', eventId).order('role');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    role: row.role,
    teamId: row.team_id ?? undefined,
    displayName: (Array.isArray(row.profiles) ? row.profiles[0]?.display_name : row.profiles?.display_name) || row.user_id.slice(0, 8)
  }));
}

export async function inviteEventMember(input: { eventId: string; email: string; displayName?: string; role: EventRole; teamId?: string }): Promise<{ invited: boolean }> {
  if (!supabase) return { invited: true };
  const { data, error } = await supabase.functions.invoke('invite-event-member', { body: input });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { invited: Boolean(data?.invited) };
}

export async function removeEventMembership(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('event_memberships').delete().eq('id', id);
  if (error) throw error;
}
