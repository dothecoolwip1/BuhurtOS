import { supabase } from '../lib/supabase';
import type { DuesChange, DuesStatus, MembershipStatus, RosterMember } from '../lib/clubMembership';

/**
 * Club membership, dues and voting (Red Deer Reavers first). Every call is a database function that checks the caller's CURRENT office in that
 * club (migration 20261013000100); the screens only show what the database already allowed. Nothing here writes a table directly.
 */

export interface ClubYear { year: number; startsOn: string; endsOn: string; duesCents: number; minVotingAge: number; applicationsOpen: boolean }
export interface MyMembership {
  id: string; year: number; status: MembershipStatus; fullName: string; discordName: string | null; dateOfBirth: string | null; adultConfirmed: boolean;
  appliedAt: string; duesStatus: DuesStatus; duesAmountCents: number | null; duesChangedAt: string | null; eligible: boolean; reasonCodes: string[]; reasons: string[];
}
export interface ClubOverview {
  enabled: boolean; currentYear: number | null; years: ClubYear[]; memberships: MyMembership[]; offices: { office: string; label: string }[];
  email: string | null; suggestedName: string | null; canViewRoster: boolean; canChangeDues: boolean; canAssignOfficers: boolean;
}

/** Errors the database raises on purpose are written to be read; "already exists" (23505) is one of them here. */
export function clubError(e: unknown): unknown {
  const x = e as { code?: string; message?: string } | null;
  if (x?.code === '23505' && x.message) return { code: 'P0001', message: x.message };
  return e;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw clubError(error);
  return data as T;
}

export async function fetchClubOverview(teamId: string): Promise<ClubOverview> {
  type Raw = {
    enabled: boolean; current_year: number | null; email: string | null; suggested_name: string | null; can_view_roster: boolean; can_change_dues: boolean; can_assign_officers: boolean;
    years: { year: number; starts_on: string; ends_on: string; dues_cents: number; min_voting_age: number; applications_open: boolean }[];
    memberships: { id: string; year: number; status: MembershipStatus; full_name: string; discord_name: string | null; date_of_birth: string | null; adult_confirmed: boolean;
      applied_at: string; dues_status: DuesStatus; dues_amount_cents: number | null; dues_changed_at: string | null; eligible: boolean; reason_codes: string[]; reasons: string[] }[];
    offices: { office: string; label: string }[];
  };
  const r = await rpc<Raw>('club_membership_overview', { p_team: teamId });
  return {
    enabled: r.enabled, currentYear: r.current_year, email: r.email, suggestedName: r.suggested_name, offices: r.offices ?? [],
    canViewRoster: r.can_view_roster, canChangeDues: r.can_change_dues, canAssignOfficers: r.can_assign_officers,
    years: (r.years ?? []).map(y => ({ year: y.year, startsOn: y.starts_on, endsOn: y.ends_on, duesCents: y.dues_cents, minVotingAge: y.min_voting_age, applicationsOpen: y.applications_open })),
    memberships: (r.memberships ?? []).map(m => ({
      id: m.id, year: m.year, status: m.status, fullName: m.full_name, discordName: m.discord_name, dateOfBirth: m.date_of_birth, adultConfirmed: m.adult_confirmed,
      appliedAt: m.applied_at, duesStatus: m.dues_status, duesAmountCents: m.dues_amount_cents, duesChangedAt: m.dues_changed_at, eligible: m.eligible,
      reasonCodes: m.reason_codes ?? [], reasons: m.reasons ?? []
    }))
  };
}

/** Is club membership switched on for this team (it has at least one membership year)? Public: the dues amount is not private. */
export async function fetchClubEnabled(teamId: string): Promise<boolean> {
  const { count, error } = await supabase.from('club_membership_years').select('year', { count: 'exact', head: true }).eq('team_id', teamId);
  if (error) return false;
  return (count ?? 0) > 0;
}

export interface Application { fullName: string; discordName: string; dateOfBirth: string; adultConfirmed: boolean; agreeBylaws: boolean }

export async function applyForMembership(teamId: string, year: number, a: Application): Promise<string> {
  return rpc<string>('apply_for_club_membership', {
    p_team: teamId, p_year: year, p_full_name: a.fullName.trim(), p_discord_name: a.discordName.trim() || null,
    p_date_of_birth: a.dateOfBirth || null, p_adult_confirmed: a.adultConfirmed, p_agree_bylaws: a.agreeBylaws
  });
}

export async function fetchRoster(teamId: string, year: number, asOf?: string): Promise<RosterMember[]> {
  type Row = {
    membership_id: string; full_name: string; email: string | null; discord_name: string | null; status: MembershipStatus; applied_at: string; is_adult: boolean | null;
    dues_status: DuesStatus; dues_amount_cents: number | null; dues_note: string | null; dues_changed_at: string | null; dues_changed_by_name: string | null;
    eligible: boolean; reason_codes: string[]; reasons: string[]; offices: string[]; status_note: string | null;
  };
  const rows = await rpc<Row[]>('club_member_roster', { p_team: teamId, p_year: year, ...(asOf ? { p_as_of: asOf } : {}) });
  return (rows ?? []).map(r => ({
    membershipId: r.membership_id, fullName: r.full_name, email: r.email, discordName: r.discord_name, status: r.status, appliedAt: r.applied_at, isAdult: r.is_adult,
    duesStatus: r.dues_status, duesAmountCents: r.dues_amount_cents, duesNote: r.dues_note, duesChangedAt: r.dues_changed_at, duesChangedByName: r.dues_changed_by_name,
    eligible: r.eligible, reasonCodes: r.reason_codes ?? [], reasons: r.reasons ?? [], offices: r.offices ?? [], statusNote: r.status_note
  }));
}

export async function setDues(membershipId: string, status: DuesStatus, amountCents: number | null, note: string): Promise<void> {
  await rpc<null>('set_club_dues', { p_membership: membershipId, p_status: status, p_amount_cents: amountCents, p_note: note.trim() || null });
}

export async function setMembershipStatus(membershipId: string, status: MembershipStatus, note: string): Promise<void> {
  await rpc<null>('set_club_membership_status', { p_membership: membershipId, p_status: status, p_note: note.trim() || null });
}

export async function fetchDuesHistory(teamId: string, year?: number, membershipId?: string): Promise<DuesChange[]> {
  type Row = { id: number; membership_id: string; membership_year: number; member_name: string; previous_status: DuesStatus | null; new_status: DuesStatus;
    previous_amount_cents: number | null; new_amount_cents: number | null; changed_by_name: string; changed_by_office: string; changed_at: string; note: string | null };
  const rows = await rpc<Row[]>('club_dues_history', { p_team: teamId, p_year: year ?? null, p_membership: membershipId ?? null });
  return (rows ?? []).map(h => ({
    id: h.id, membershipId: h.membership_id, membershipYear: h.membership_year, memberName: h.member_name, previousStatus: h.previous_status, newStatus: h.new_status,
    previousAmountCents: h.previous_amount_cents, newAmountCents: h.new_amount_cents, changedByName: h.changed_by_name, changedByOffice: h.changed_by_office,
    changedAt: h.changed_at, note: h.note
  }));
}

export interface Officer { officerId: string; office: string; officeLabel: string; name: string | null; email: string; startedOn: string }

export async function fetchOfficers(teamId: string): Promise<Officer[]> {
  type Row = { officer_id: string; office: string; office_label: string; name: string | null; email: string; started_on: string };
  const rows = await rpc<Row[]>('list_team_officers', { p_team: teamId });
  return (rows ?? []).map(o => ({ officerId: o.officer_id, office: o.office, officeLabel: o.office_label, name: o.name, email: o.email, startedOn: o.started_on }));
}

export const OFFICES: readonly (readonly [string, string])[] = [
  ['president', 'President'], ['vice_president', 'Vice President'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer'], ['director', 'Director']
];

export async function assignOfficer(teamId: string, email: string, office: string, note: string): Promise<void> {
  await rpc<string>('assign_team_officer', { p_team: teamId, p_email: email.trim(), p_office: office, p_note: note.trim() || null });
}

export async function endOfficer(officerId: string, note: string): Promise<void> {
  await rpc<null>('end_team_officer', { p_officer: officerId, p_note: note.trim() || null });
}
