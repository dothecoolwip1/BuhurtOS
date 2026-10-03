import { supabase } from '../lib/supabase';

/**
 * Organizer-added fighters. An invitation is neither a registration nor a staff role: the fighter still completes the form and signs the
 * waiver themselves. Every call is a database function that checks its own authority. Errors are thrown as-is for friendlyError.
 */

export type InvitationStatus = 'invited' | 'registered' | 'withdrawn' | 'cancelled';
export interface EventInvitation {
  id: string; fighterId: string; displayName: string; teamName: string | null; status: InvitationStatus; hasAccount: boolean; note: string | null;
  competitions: Array<{ id: string; name: string }>; registrationId: string | null; registrationStatus: string | null; createdAt: string; decidedAt: string | null;
}
type Row = { invitation_id: string; fighter_id: string; display_name: string; team_name: string | null; status: InvitationStatus; has_account: boolean; note: string | null; competitions: Array<{ id: string; name: string }> | null; registration_id: string | null; registration_status: string | null; created_at: string; decided_at: string | null };
export const toInvitation = (r: Row): EventInvitation => ({
  id: r.invitation_id, fighterId: r.fighter_id, displayName: r.display_name, teamName: r.team_name, status: r.status, hasAccount: r.has_account, note: r.note,
  competitions: r.competitions ?? [], registrationId: r.registration_id, registrationStatus: r.registration_status, createdAt: r.created_at, decidedAt: r.decided_at
});

/** Organizers of the event only; others get an empty list. */
export async function fetchEventInvitations(eventId: string): Promise<EventInvitation[]> {
  const { data, error } = await supabase.rpc('list_event_invitations', { p_event: eventId });
  if (error) throw error;
  return (data as Row[]).map(toInvitation);
}
/** Returns whether the fighter was told (false when the record has no linked account). */
export async function inviteFighter(eventId: string, fighterId: string, competitionIds: string[], note: string | null): Promise<{ invitationId: string; notified: boolean }> {
  const { data, error } = await supabase.rpc('invite_fighter_to_event', { p_event: eventId, p_fighter: fighterId, p_competitions: competitionIds, p_note: note });
  if (error) throw error;
  const r = data as { invitation_id: string; notified: boolean };
  return { invitationId: r.invitation_id, notified: r.notified };
}
export async function cancelInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_invitation', { p_invitation: invitationId });
  if (error) throw error;
}
export async function withdrawMyInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_my_invitation', { p_invitation: invitationId });
  if (error) throw error;
}

export interface MyInvitation { id: string; status: InvitationStatus; note: string | null; competitions: Array<{ id: string; name: string }> }
/** The signed-in fighter's own invitation to this event, if any (row level security returns only theirs). */
export async function fetchMyInvitation(eventId: string, fighterId: string): Promise<MyInvitation | null> {
  const { data, error } = await supabase.from('event_invitations').select('id,status,note,event_invitation_competitions(competition_id,competitions(name))').eq('event_id', eventId).eq('fighter_id', fighterId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  type R = { id: string; status: InvitationStatus; note: string | null; event_invitation_competitions: Array<{ competition_id: string; competitions: { name: string } | { name: string }[] | null }> | null };
  const r = data as unknown as R;
  return {
    id: r.id, status: r.status, note: r.note,
    competitions: (r.event_invitation_competitions ?? []).map(c => ({ id: c.competition_id, name: (Array.isArray(c.competitions) ? c.competitions[0]?.name : c.competitions?.name) ?? 'Competition' }))
  };
}

/** The signed-in person withdraws their own registration (organizers may too). */
export async function withdrawRegistration(registrationId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_registration', { p_reg: registrationId });
  if (error) throw error;
}
