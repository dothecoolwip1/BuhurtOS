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

export interface StaffMember { userId: string; email: string; role: 'organizer' | 'head_marshal' | 'marshal' | 'scorekeeper' | 'medic' }
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

/** Same rule the database applies in create_event: an owner or approved organizer row in platform_roles (each person can read only their own row). */
export async function fetchCanCreateEvents(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('platform_roles').select('role').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).some(r => r.role === 'owner' || r.role === 'organizer');
}

export interface NewEventInput { slug: string; name: string; startsOn: string; endsOn: string; venue: string | null; address: string | null }
export async function createEvent(i: NewEventInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_event', { p_slug: i.slug, p_name: i.name.trim(), p_starts_on: i.startsOn, p_ends_on: i.endsOn, p_venue: i.venue, p_address: i.address });
  if (error) throw error;
  return data as string;
}

export interface NewTeamInput { slug: string; name: string; city: string | null; region: string | null; country: string | null }
export async function createTeam(i: NewTeamInput): Promise<void> {
  const { error } = await supabase.rpc('create_team', { p_slug: i.slug, p_name: i.name.trim(), p_city: i.city, p_region: i.region, p_country: i.country });
  if (error) throw error;
}

/** A taken slug is a unique-violation (23505), which friendlyError would hide behind the generic message. */
export const isSlugTaken = (e: unknown) => (e as { code?: string } | null)?.code === '23505';

export type WaiverKind = 'text' | 'pdf';
export interface Waiver { id: string; version: number; title: string; body: string | null; kind: WaiverKind; documentPath: string | null; source: string | null; createdAt: string }
type WaiverRow = { id: string; version: number; title: string; body: string | null; kind: WaiverKind | null; document_path: string | null; source: string | null; created_at: string };
export const toWaiver = (r: WaiverRow): Waiver => ({ id: r.id, version: r.version, title: r.title, body: r.body, kind: r.kind ?? 'text', documentPath: r.document_path ?? null, source: r.source ?? null, createdAt: r.created_at });
export const WAIVER_COLUMNS = 'id,version,title,body,kind,document_path,source,created_at';

/** The newest waiver of the event, or null. Waivers are public to read (people read them before registering). */
export async function fetchLatestWaiver(eventId: string): Promise<Waiver | null> {
  const { data, error } = await supabase.from('waiver_versions').select(WAIVER_COLUMNS).eq('event_id', eventId).order('version', { ascending: false }).limit(1);
  if (error) throw error;
  const r = (data as WaiverRow[])[0];
  return r ? toWaiver(r) : null;
}
/** Every version, newest first: an organizer can see what people signed over time. */
export async function fetchWaiverVersions(eventId: string): Promise<Waiver[]> {
  const { data, error } = await supabase.from('waiver_versions').select(WAIVER_COLUMNS).eq('event_id', eventId).order('version', { ascending: false });
  if (error) throw error;
  return (data as WaiverRow[]).map(toWaiver);
}
/** A new TEXT version (the database numbers it; waivers are never edited: people who signed an older one keep that one). Organizers only. */
export async function addWaiverText(eventId: string, title: string, body: string, source: 'template' | 'pasted'): Promise<string> {
  const { data, error } = await supabase.rpc('add_waiver_version', { p_event: eventId, p_title: title.trim(), p_body: body.trim(), p_kind: 'text', p_document_path: null, p_source: source });
  if (error) throw error;
  return data as string;
}
/** Uploads the PDF into the event's folder of the private bucket, then records it as the next version. The file is removed if that fails. */
export async function addWaiverPdf(eventId: string, title: string, file: File, note: string | null): Promise<string> {
  const path = `${eventId}/${Date.now()}.pdf`;
  const up = await supabase.storage.from('waiver-documents').upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await supabase.rpc('add_waiver_version', { p_event: eventId, p_title: title.trim(), p_body: note, p_kind: 'pdf', p_document_path: path, p_source: 'upload' });
  if (error) { await supabase.storage.from('waiver-documents').remove([path]); throw error; }
  return data as string;
}
/** A short-lived link to read or download an uploaded waiver (organizers, and anyone who may read the version). */
export async function waiverDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('waiver-documents').createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
