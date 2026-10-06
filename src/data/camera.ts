/** Camera Off, as the app calls it. Every call is a controlled database function; the database decides who may activate (marshal, head marshal,
 *  scorekeeper, announcer, Temporary Organizer, organizer, owner) and who may release (head marshal, Temporary Organizer, organizer, owner). */
import { supabase } from '../lib/supabase';
import type { CameraOffReason, CameraState } from '../lib/cameraOff';

interface Raw { active: boolean; reason: CameraOffReason | null; activated_at: string | null; activated_by_label: string | null; activated_by_role: string | null;
  released_at: string | null; released_by_label: string | null; released_by_role: string | null; rev: number; can_activate?: boolean; can_release?: boolean; status?: string }
export const toCameraState = (r: Raw): CameraState => ({
  active: !!r.active, reason: r.active ? r.reason ?? 'other' : null, activatedAt: r.activated_at ?? null, activatedByLabel: r.activated_by_label ?? null, activatedByRole: r.activated_by_role ?? null,
  releasedAt: r.released_at ?? null, releasedByLabel: r.released_by_label ?? null, releasedByRole: r.released_by_role ?? null, rev: r.rev ?? 0, canActivate: !!r.can_activate, canRelease: !!r.can_release
});

export async function fetchCameraState(eventId: string): Promise<CameraState> {
  const { data, error } = await supabase.rpc('camera_state', { p_event: eventId });
  if (error) throw error;
  return toCameraState(data as Raw);
}
export async function cameraOff(eventId: string, reason: CameraOffReason): Promise<CameraState> {
  const { data, error } = await supabase.rpc('camera_off_activate', { p_event: eventId, p_reason: reason });
  if (error) throw error;
  return toCameraState({ ...(data as Raw), can_activate: true });
}
export async function cameraOn(eventId: string, note?: string): Promise<CameraState> {
  const { data, error } = await supabase.rpc('camera_off_release', { p_event: eventId, p_note: note?.trim() || null });
  if (error) throw error;
  return toCameraState({ ...(data as Raw), can_release: true });
}
