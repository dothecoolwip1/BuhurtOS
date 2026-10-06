/**
 * Pack 18.1: temporary event devices. Listing, revoking and signing out are controlled database functions (the event's permanent organizer only;
 * a Temporary Organizer is refused by the database). Creating and replacing go through the `device-session` Edge Function, because the function
 * is what makes the code and keeps the verifier key: the browser sends the organizer's own sign-in, the database decides, and the plaintext code
 * comes back ONCE in the answer. This file never keeps, logs or caches a code: it hands it to the caller and forgets it.
 */
import { supabase } from '../lib/supabase';
import type { Credential, CredentialKind } from '../lib/devices';
import { groupCode } from '../lib/devices';

interface Row {
  id: string; kind: CredentialKind; label: string; role: string; status: Credential['status']; used: boolean; expires_at: string | null; created_at: string;
  last_signin_at: string | null; last_seen_at: string | null; signed_in_elsewhere_at: string | null; revoked_at: string | null; replaced: boolean;
}
export async function fetchCredentials(eventId: string): Promise<Credential[]> {
  const { data, error } = await supabase.rpc('list_event_credentials', { p_event: eventId });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(r => ({
    id: r.id, kind: r.kind, label: r.label, role: r.role, status: r.status, used: r.used, expiresAt: r.expires_at, createdAt: r.created_at,
    lastSigninAt: r.last_signin_at, lastSeenAt: r.last_seen_at, signedInElsewhereAt: r.signed_in_elsewhere_at, revokedAt: r.revoked_at, replaced: r.replaced
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
