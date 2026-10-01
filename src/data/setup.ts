import { supabase } from '../lib/supabase';

/** Event columns an organizer may change are granted in the database; a row the caller cannot change comes back empty, which is reported as a permission error. */
export async function updateEvent(eventId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from('events').update(patch).eq('id', eventId).select('id');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error('not permitted'), { code: '42501' });
}
export const setEventStatus = (eventId: string, status: 'draft' | 'published') => updateEvent(eventId, { status });

export async function fetchPublishFacts(eventId: string): Promise<{ competitions: number; waivers: number }> {
  const [c, w] = await Promise.all([
    supabase.from('competitions').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('waiver_versions').select('id', { count: 'exact', head: true }).eq('event_id', eventId)
  ]);
  if (c.error) throw c.error;
  if (w.error) throw w.error;
  return { competitions: c.count ?? 0, waivers: w.count ?? 0 };
}

export interface StaffMember { userId: string; email: string; role: 'organizer' | 'marshal' | 'scorekeeper' | 'medic' }
export async function fetchStaff(eventId: string): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc('list_event_staff', { p_event: eventId });
  if (error) throw error;
  return (data as { user_id: string; email: string; role: StaffMember['role'] }[]).map(r => ({ userId: r.user_id, email: r.email, role: r.role }));
}
export async function addStaff(eventId: string, email: string, role: StaffMember['role']): Promise<void> {
  const { error } = await supabase.rpc('grant_event_role_by_email', { p_event: eventId, p_email: email.trim(), p_role: role });
  if (error) throw error;
}
export async function removeStaff(eventId: string, userId: string, role: StaffMember['role']): Promise<void> {
  const { error } = await supabase.rpc('remove_event_role', { p_event: eventId, p_user: userId, p_role: role });
  if (error) throw error;
}
