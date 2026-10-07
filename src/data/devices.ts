/**
 * Pack 18.1: temporary event devices. Listing, revoking and signing out are controlled database functions (the event's permanent organizer only;
 * a Temporary Organizer is refused by the database). Creating and replacing go through the `device-session` Edge Function, because the function
 * is what makes the code and keeps the verifier key: the browser sends the organizer's own sign-in, the database decides, and the plaintext code
 * comes back ONCE in the answer. This file never keeps, logs or caches a code: it hands it to the caller and forgets it.
 */
import { supabase } from '../lib/supabase';
import type { Credential, CredentialKind, DeviceSession } from '../lib/devices';
import { COUNTER_POOL_LABEL, groupCode } from '../lib/devices';

interface Row {
  id: string; kind: CredentialKind; label: string; role: string; status: Credential['status']; used: boolean; expires_at: string | null; created_at: string;
  last_signin_at: string | null; last_seen_at: string | null; signed_in_elsewhere_at: string | null; revoked_at: string | null; replaced: boolean; open_sessions?: number | null;
}
export async function fetchCredentials(eventId: string): Promise<Credential[]> {
  const { data, error } = await supabase.rpc('list_event_credentials', { p_event: eventId });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(r => ({
    id: r.id, kind: r.kind, label: r.label, role: r.role, status: r.status, used: r.used, expiresAt: r.expires_at, createdAt: r.created_at,
    lastSigninAt: r.last_signin_at, lastSeenAt: r.last_seen_at, signedInElsewhereAt: r.signed_in_elsewhere_at, revokedAt: r.revoked_at, replaced: r.replaced, openSessions: r.open_sessions ?? 0
  }));
}

export async function revokeCredential(credentialId: string): Promise<'revoked' | 'already_revoked'> {
  const { data, error } = await supabase.rpc('revoke_event_credential', { p_credential: credentialId, p_reason: null });
  if (error) throw error;
  return ((data as { status?: string } | null)?.status === 'already_revoked' ? 'already_revoked' : 'revoked');
}
export async function revokeAllDevices(eventId: string): Promise<number> {
  const { data, error } = await supabase.rpc('revoke_all_event_devices', { p_event: eventId });
  if (error) throw error;
  return Number((data as { revoked?: number } | null)?.revoked ?? 0);
}

/** A new code, shown once. `code` is `XXXX-XXXX-XXXX`. */
export interface NewCode { credential: { id: string; kind: CredentialKind; label: string; role: string; expiresAt: string | null }; code: string }

/** The Edge Function's refusals become errors friendlyError can word: its own message passes through for a refusal of the request (400), a permission message for 401 / 403. */
async function callFunction(body: Record<string, unknown>): Promise<NewCode> {
  const { data, error } = await supabase.functions.invoke('device-session', { body });
  if (error) {
    const res = (error as { context?: unknown }).context;
    if (res instanceof Response) {
      const detail = await res.json().then((j: { error?: unknown }) => (typeof j?.error === 'string' ? j.error : ''), () => '');
      if (res.status === 401) throw Object.assign(new Error('sign in as an organizer'), { code: '28000' });
      if (res.status === 403) throw Object.assign(new Error('only an organizer can do this'), { code: '42501' });
      throw Object.assign(new Error(detail || 'could not make the code'), { code: '22023' });
    }
    throw error;                                      // no network: friendlyError says so
  }
  const d = data as { credential?: { id: string; kind: CredentialKind; label: string; role: string; expires_at: string | null }; code?: string } | null;
  if (!d?.credential || typeof d.code !== 'string') throw Object.assign(new Error('the code was not made'), { code: '22023' });
  return { credential: { id: d.credential.id, kind: d.credential.kind, label: d.credential.label, role: d.credential.role, expiresAt: d.credential.expires_at }, code: groupCode(d.code) };
}
export const createCredential = (eventId: string, kind: CredentialKind, label: string, role: string): Promise<NewCode> =>
  callFunction({ action: 'create', event: eventId, kind, label: label.trim(), role });
export const replaceCredential = (credentialId: string): Promise<NewCode> => callFunction({ action: 'replace', credential: credentialId });
/** Pack 25: the event's one reusable Counter QR (the organizer). The code comes back once here, and is also kept on the credential for scoring staff to show again. */
export const createCounterPool = (eventId: string): Promise<NewCode> => callFunction({ action: 'create', event: eventId, kind: 'counter_pool', label: COUNTER_POOL_LABEL, role: 'counter' });

// ---------------------------------------------------------------- Pack 25: the Counter QR for scoring staff, and the phones as sessions
export interface CounterPool { code: string | null; credentialId: string | null; label: string | null; expiresAt: string | null; openSessions: number; canCreate: boolean }
/** What the Lyst and Event Control show: the pool's code (scoring staff of the event), or that there is none and whether this viewer may make one. */
export async function fetchCounterPool(eventId: string): Promise<CounterPool> {
  const { data, error } = await supabase.rpc('counter_pool_code', { p_event: eventId });
  if (error) throw error;
  const d = data as { code: string | null; credential_id?: string | null; label?: string | null; expires_at?: string | null; open_sessions?: number | null; can_create?: boolean } | null;
  return { code: d?.code ?? null, credentialId: d?.credential_id ?? null, label: d?.label ?? null, expiresAt: d?.expires_at ?? null, openSessions: Number(d?.open_sessions ?? 0), canCreate: d?.can_create === true };
}

type SessionDb = {
  session_id: string; credential_id: string; event_id: string; event: { slug: string; name: string; timezone: string } | null; kind: CredentialKind; label: string; role: string;
  created_at: string; last_seen_at: string | null; online: boolean; ended_at: string | null; ended_reason: string | null; expires_at: string | null; status: DeviceSession['status'];
  binding: { field_key: string | null; field_label: string | null; side: 'a' | 'b' | null; operator: string | null; updated_at: string | null } | null;
  seat: { match_id: string | null; side: 'a' | 'b' | null; role: 'official' | 'learning' } | null;
};
const toSession = (r: SessionDb): DeviceSession => ({
  sessionId: r.session_id, credentialId: r.credential_id, eventId: r.event_id, event: r.event, kind: r.kind, label: r.label, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  online: r.online === true, endedAt: r.ended_at, endedReason: r.ended_reason, expiresAt: r.expires_at, status: r.status,
  binding: r.binding ? { fieldKey: r.binding.field_key, fieldLabel: r.binding.field_label, side: r.binding.side, operator: r.binding.operator, updatedAt: r.binding.updated_at } : null,
  seat: r.seat ? { matchId: r.seat.match_id, side: r.seat.side, role: r.seat.role } : null
});
export async function fetchEventDeviceSessions(eventId: string, includeEnded = false): Promise<DeviceSession[]> {
  const { data, error } = await supabase.rpc('list_event_device_sessions', { p_event: eventId, p_include_ended: includeEnded });
  if (error) throw error;
  return ((data ?? []) as SessionDb[]).map(toSession);
}
export async function fetchPlatformDeviceSessions(includeEnded = false): Promise<DeviceSession[]> {
  const { data, error } = await supabase.rpc('platform_device_sessions', { p_include_ended: includeEnded });
  if (error) throw error;
  return ((data ?? []) as SessionDb[]).map(toSession);
}
export async function moveCounterSession(sessionId: string, field: string | null, side: 'a' | 'b' | null): Promise<DeviceSession> {
  const { data, error } = await supabase.rpc('move_counter_session', { p_session: sessionId, p_field: field, p_side: side });
  if (error) throw error;
  return toSession(data as SessionDb);
}
export async function endEventSession(sessionId: string, reason: string | null = null): Promise<'ended' | 'already_ended'> {
  const { data, error } = await supabase.rpc('end_event_session', { p_session: sessionId, p_reason: reason });
  if (error) throw error;
  return (data as { status?: string } | null)?.status === 'already_ended' ? 'already_ended' : 'ended';
}
/** A read-only look at a counter phone's screen state (never "as" the device). */
export async function fetchDeviceSessionPreview(sessionId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('device_session_preview', { p_session: sessionId });
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}
export interface OperatorHistoryRow { sessionId: string; operator: string; fieldKey: string | null; side: 'a' | 'b' | null; startedAt: string; endedAt: string | null }
export async function fetchCounterOperatorHistory(eventId: string, sessionId: string | null = null): Promise<OperatorHistoryRow[]> {
  const { data, error } = await supabase.rpc('counter_operator_history', { p_event: eventId, p_session: sessionId });
  if (error) throw error;
  return ((data ?? []) as { session_id: string; operator: string; field_key: string | null; side: 'a' | 'b' | null; started_at: string; ended_at: string | null }[])
    .map(r => ({ sessionId: r.session_id, operator: r.operator, fieldKey: r.field_key, side: r.side, startedAt: r.started_at, endedAt: r.ended_at }));
}

// ---------------------------------------------------------------- staff, names only (Temporary Organizer or organizer)
export interface StaffName { userId: string; name: string; role: string }
export async function fetchStaffNames(eventId: string): Promise<StaffName[]> {
  const { data, error } = await supabase.rpc('list_event_staff_names', { p_event: eventId });
  if (error) throw error;
  return ((data ?? []) as { user_id: string; name: string; role: string }[]).map(r => ({ userId: r.user_id, name: r.name, role: r.role }));
}
export async function grantRole(eventId: string, email: string, role: string): Promise<void> {
  const { error } = await supabase.rpc('grant_event_role_by_email', { p_event: eventId, p_email: email.trim(), p_role: role });
  if (error) throw error;
}
export async function removeRole(eventId: string, userId: string, role: string): Promise<void> {
  const { error } = await supabase.rpc('remove_event_role', { p_event: eventId, p_user: userId, p_role: role });
  if (error) throw error;
}
