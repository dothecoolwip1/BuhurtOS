import { supabase } from '../lib/supabase';
import type { Attendance, Inspection, InspectionIssue, ReadinessRow } from '../lib/readiness';

/**
 * Pack 16: check-in, armour inspection and readiness. Every write is a database function that checks the caller's event role again; readiness
 * itself is computed by the database (one rule for the desk, the Lyst screen and captains).
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

type RowDb = {
  registration_id: string; fighter_id: string | null; full_name: string; team_id: string | null; team_name: string | null; competitions: string[] | null; is_volunteer: boolean; status: string;
  attendance: Attendance; inspection: Inspection; issues: InspectionIssue[] | null; inspection_note: string | null; inspected_at: string | null; inspected_by_name: string | null; reinspected: boolean;
  insurance_ok: boolean; fee_ok: boolean; override_active: boolean; override_reason: string | null; profight: boolean; declared_weight: string | null; weight_kg: number | string | null;
  ready: boolean; reasons: string[] | null;
};
const toRow = (r: RowDb): ReadinessRow => ({
  registrationId: r.registration_id, fighterId: r.fighter_id, fullName: r.full_name, teamId: r.team_id, teamName: r.team_name, competitions: r.competitions ?? [],
  isVolunteer: r.is_volunteer, status: r.status, attendance: r.attendance, inspection: r.inspection, issues: r.issues ?? [], note: r.inspection_note,
  inspectedAt: r.inspected_at, inspectedBy: r.inspected_by_name, reinspected: r.reinspected, insuranceOk: r.insurance_ok, feeOk: r.fee_ok,
  overrideActive: r.override_active, overrideReason: r.override_reason, profight: r.profight, declaredWeight: r.declared_weight,
  weightKg: r.weight_kg === null ? null : Number(r.weight_kg), ready: r.ready, reasons: r.reasons ?? []
});

export const fetchEventReadiness = async (eventId: string): Promise<ReadinessRow[]> => (await rpc<RowDb[]>('event_readiness', { p_event: eventId })).map(toRow);

export interface DeskRoles { checkIn: boolean; inspect: boolean; override: boolean; detail: boolean }
export async function fetchMyDeskRoles(eventId: string): Promise<DeskRoles> {
  const r = await rpc<{ check_in?: boolean; inspect?: boolean; override?: boolean; detail?: boolean } | null>('my_desk_roles', { p_event: eventId });
  return { checkIn: r?.check_in === true, inspect: r?.inspect === true, override: r?.override === true, detail: r?.detail === true };
}

export const setAttendance = (regId: string, state: Attendance) => rpc<{ state: Attendance; changed: boolean }>('set_attendance', { p_reg: regId, p_state: state });
export const recordInspection = (regId: string, result: Exclude<Inspection, 'not_inspected' | 'not_needed'> | 'reset', issues: InspectionIssue[] = [], note: string | null = null) =>
  rpc<{ id: string }>('record_inspection', { p_reg: regId, p_result: result, p_issues: issues, p_note: note });
export const recordWeighIn = (regId: string, kg: number) => rpc<{ weight_kg: number }>('record_weigh_in', { p_reg: regId, p_weight_kg: kg });
export const setReadinessOverride = (regId: string, reason: string) => rpc<{ id: string }>('set_readiness_override', { p_reg: regId, p_reason: reason });
export const clearReadinessOverride = (regId: string) => rpc<number>('clear_readiness_override', { p_reg: regId });

export interface InspectionRecord { result: string; issues: InspectionIssue[]; note: string | null; at: string; by: string | null }
export async function fetchInspectionHistory(regId: string): Promise<InspectionRecord[]> {
  const rows = await rpc<{ result: string; issues: InspectionIssue[] | null; note: string | null; inspected_at: string; inspected_by_name: string | null }[]>('inspection_history', { p_reg: regId });
  return rows.map(r => ({ result: r.result, issues: r.issues ?? [], note: r.note, at: r.inspected_at, by: r.inspected_by_name }));
}

/** The two sides of a fight, for the Lyst screen: status words only (no notes, no weights). */
export interface SideReadiness { side: 'a' | 'b'; fighterId: string; name: string; tracked: boolean; ready: boolean; reasons: string[]; overrideActive: boolean }
export async function fetchMatchReadiness(matchId: string): Promise<SideReadiness[]> {
  const rows = await rpc<{ side: 'a' | 'b'; fighter_id: string; name: string; tracked: boolean; ready: boolean; reasons: string[] | null; override_active: boolean }[]>('match_readiness', { p_match: matchId });
  return rows.map(r => ({ side: r.side, fighterId: r.fighter_id, name: r.name, tracked: r.tracked, ready: r.ready, reasons: r.reasons ?? [], overrideActive: r.override_active }));
}

/** A captain's own roster: status words only. */
export interface TeamReadinessRow { registrationId: string; fullName: string; isVolunteer: boolean; attendance: Attendance; inspection: Inspection; ready: boolean; reasons: string[] }
export async function fetchTeamReadiness(eventId: string, teamId: string): Promise<TeamReadinessRow[]> {
  const rows = await rpc<{ registration_id: string; full_name: string; is_volunteer: boolean; attendance: Attendance; inspection: Inspection; ready: boolean; reasons: string[] | null }[]>('team_readiness', { p_event: eventId, p_team: teamId });
  return rows.map(r => ({ registrationId: r.registration_id, fullName: r.full_name, isVolunteer: r.is_volunteer, attendance: r.attendance, inspection: r.inspection, ready: r.ready, reasons: r.reasons ?? [] }));
}
