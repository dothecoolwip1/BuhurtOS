/**
 * Pack 18.1: the Command Centre's Broadcast panel. Reads the control row, the Camera Off state and the stream controller's last report in one call
 * (any Command Centre reader), and changes the control row through the revision-checked `set_broadcast_control` (an organizer or Temporary Organizer;
 * the database decides). It never touches OBS and never touches Pack 13 state.
 */
import { supabase } from '../lib/supabase';
import { toCameraState } from './camera';
import { DEFAULT_CONTROL, type BroadcastControl, type BroadcastState, type Patch } from '../lib/broadcastView';

type ControlDb = { mode: BroadcastControl['mode']; target_kind: BroadcastControl['targetKind']; target_field: string | null; music_mode: BroadcastControl['musicMode']; auto_duck: boolean;
  priority_fields: string[] | null; rev: number; updated_at: string | null; updated_by_label: string | null };
export const toControl = (c: ControlDb | null | undefined): BroadcastControl => c ? ({
  mode: c.mode === 'manual' ? 'manual' : 'auto', targetKind: c.target_kind ?? null, targetField: c.target_field ?? null, musicMode: c.music_mode ?? 'auto', autoDuck: c.auto_duck !== false,
  priorityFields: c.priority_fields ?? [], rev: c.rev ?? 0, updatedAt: c.updated_at ?? null, updatedByLabel: c.updated_by_label ?? null
}) : DEFAULT_CONTROL;

type CameraDb = Parameters<typeof toCameraState>[0];
type StateDb = {
  control: ControlDb; camera: CameraDb | null;
  controller: { reported_at: string; age_seconds: number; status: unknown } | null; controller_exists: boolean; can_control: boolean; server_now: string;
};
export async function fetchBroadcastState(eventId: string): Promise<BroadcastState> {
  const { data, error } = await supabase.rpc('broadcast_control_state', { p_event: eventId });
  if (error) throw error;
  const d = data as StateDb;
  return {
    control: toControl(d.control), camera: toCameraState(d.camera ?? ({ active: false } as CameraDb)),
    controller: d.controller ? { reportedAt: d.controller.reported_at, ageSeconds: Number(d.controller.age_seconds), status: d.controller.status } : null,
    controllerExists: d.controller_exists === true, canControl: d.can_control === true, serverNow: d.server_now
  };
}

export type SetResult = { status: 'ok' | 'stale'; control: BroadcastControl };
/** `expectedRev` is the revision from the last read: a changed row answers `stale` (nothing is written) instead of being overwritten silently. */
export async function setBroadcastControl(eventId: string, expectedRev: number, patch: Patch): Promise<SetResult> {
  const { data, error } = await supabase.rpc('set_broadcast_control', { p_event: eventId, p_expected_rev: expectedRev, p_patch: patch });
  if (error) throw error;
  const d = data as { status: string; control: ControlDb };
  return { status: d.status === 'ok' ? 'ok' : 'stale', control: toControl(d.control) };
}
