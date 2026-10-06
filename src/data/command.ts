import { supabase } from '../lib/supabase';
import type { CommandSnapshot } from '../lib/commandCentre';

type SnapDb = {
  server_now: string;
  event: { id: string; slug: string; name: string; status: string; timezone: string | null; starts_on: string; ends_on: string; closed: boolean };
  viewer: { organizer: boolean; announce?: boolean; operator?: boolean; camera_off?: boolean; camera_release?: boolean; broadcast?: boolean };
  readiness: Record<string, number>;
  not_ready: { registration_id: string; fighter_id: string; name: string; team: string | null; attendance: string; inspection: string; reasons: string[] | null }[];
  overrides: { registration_id: string; name: string; reason: string | null }[];
  fight_warnings: { match_id: string; side: 'a' | 'b'; fighter_id: string; name: string; reasons: string[] | null }[];
  staff: { role: string; names: string[] | null }[];
  broadcast: { configured: boolean };
};

/**
 * Pack 18: the Command Centre's one server read (organizers and the head marshal of this event; the database refuses everyone else with 42501).
 * Read-only: no notes, weights, emails or account ids come back.
 */
export async function fetchCommandSnapshot(eventId: string): Promise<CommandSnapshot> {
  const { data, error } = await supabase.rpc('event_command_snapshot', { p_event: eventId });
  if (error) throw error;
  const d = data as SnapDb;
  const r = d.readiness;
  return {
    serverNow: d.server_now,
    event: { id: d.event.id, slug: d.event.slug, name: d.event.name, status: d.event.status, timezone: d.event.timezone ?? 'America/Edmonton', startsOn: d.event.starts_on, endsOn: d.event.ends_on, closed: d.event.closed },
    viewer: {
      organizer: d.viewer.organizer === true, announce: d.viewer.announce === true, operator: d.viewer.operator === true,
      cameraOff: d.viewer.camera_off === true, cameraRelease: d.viewer.camera_release === true, broadcast: d.viewer.broadcast === true
    },
    readiness: {
      fighters: r.fighters ?? 0, volunteers: r.volunteers ?? 0, missing: r.missing ?? 0, arrived: r.arrived ?? 0, checkedIn: r.checked_in ?? 0, ready: r.ready ?? 0,
      notReady: r.not_ready ?? 0, needsInspection: r.needs_inspection ?? 0, needsCorrection: r.needs_correction ?? 0, failed: r.failed ?? 0, overrides: r.overrides ?? 0,
      adminBlocked: r.admin_blocked ?? 0, pendingRegistrations: r.pending_registrations ?? 0
    },
    notReady: d.not_ready.map(f => ({ registrationId: f.registration_id, fighterId: f.fighter_id, name: f.name, team: f.team, attendance: f.attendance, inspection: f.inspection, reasons: f.reasons ?? [] })),
    overrides: d.overrides.map(o => ({ registrationId: o.registration_id, name: o.name, reason: o.reason })),
    fightWarnings: d.fight_warnings.map(w => ({ matchId: w.match_id, side: w.side, fighterId: w.fighter_id, name: w.name, reasons: w.reasons ?? [] })),
    staff: d.staff.map(s => ({ role: s.role, names: s.names ?? [] })),
    broadcast: { configured: d.broadcast.configured === true }
  };
}
