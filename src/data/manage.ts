import { supabase } from '../lib/supabase';

export type RegStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';
export type Insurance = 'hacsa_member' | 'mcc_member' | 'proof_received' | 'proof_pending' | 'needs_cover';
export type CheckName = 'checked_in' | 'kit';

export interface ManagedRegistration {
  id: string; status: RegStatus; fullName: string; gender: string; organization: string; province: string | null;
  teamName: string | null; sharesEquipment: boolean; days: string[]; availabilityNotes: string | null; biProfile: string | null;
  insurance: Insurance; isVolunteer: boolean; volunteerRoles: string[]; mercenary: boolean; notes: string | null;
  feeDueCents: number; feePaid: boolean; createdAt: string;
  email: string; emergencyName: string; emergencyRelationship: string; emergencyPhone: string; medicalNote: string | null;
  categories: { competitionId: string; name: string; details: Record<string, string> }[];
  checkedIn: boolean; kitPassed: boolean;
}

type Row = {
  id: string; status: RegStatus; full_name: string; gender: string; organization: string; province: string | null; team_name: string | null;
  shares_equipment: boolean; days: string[]; availability_notes: string | null; bi_profile: string | null; insurance: Insurance;
  is_volunteer: boolean; volunteer_roles: string[]; mercenary: boolean; notes: string | null; fee_due_cents: number; fee_paid: boolean; created_at: string;
  teams: { name: string } | { name: string }[] | null;
  registration_private: PrivateRow | PrivateRow[] | null;
  registration_competitions: { competition_id: string; details: Record<string, string> | null; competitions: { name: string } | { name: string }[] | null }[];
  registration_checks: { check_name: CheckName; passed: boolean }[];
};
type PrivateRow = { email: string; emergency_name: string; emergency_relationship: string; emergency_phone: string; medical_note: string | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

const SELECT = 'id,status,full_name,gender,organization,province,team_name,shares_equipment,days,availability_notes,bi_profile,insurance,is_volunteer,volunteer_roles,mercenary,notes,fee_due_cents,fee_paid,created_at,'
  + 'teams(name),registration_private(email,emergency_name,emergency_relationship,emergency_phone,medical_note),'
  + 'registration_competitions(competition_id,details,competitions(name)),registration_checks(check_name,passed)';

export async function fetchRegistrations(eventId: string): Promise<ManagedRegistration[]> {
  const { data, error } = await supabase.from('registrations').select(SELECT).eq('event_id', eventId).order('created_at');
  if (error) throw error;
  return (data as unknown as Row[]).map(r => {
    const p = one(r.registration_private);
    const passed = (n: CheckName) => r.registration_checks.some(c => c.check_name === n && c.passed);
    return {
      id: r.id, status: r.status, fullName: r.full_name, gender: r.gender, organization: r.organization, province: r.province,
      teamName: one(r.teams)?.name ?? r.team_name, sharesEquipment: r.shares_equipment, days: r.days, availabilityNotes: r.availability_notes,
      biProfile: r.bi_profile, insurance: r.insurance, isVolunteer: r.is_volunteer, volunteerRoles: r.volunteer_roles, mercenary: r.mercenary,
      notes: r.notes, feeDueCents: r.fee_due_cents, feePaid: r.fee_paid, createdAt: r.created_at,
      email: p?.email ?? '', emergencyName: p?.emergency_name ?? '', emergencyRelationship: p?.emergency_relationship ?? '', emergencyPhone: p?.emergency_phone ?? '', medicalNote: p?.medical_note ?? null,
      categories: r.registration_competitions.map(c => ({ competitionId: c.competition_id, name: one(c.competitions)?.name ?? 'Category', details: c.details ?? {} })),
      checkedIn: passed('checked_in'), kitPassed: passed('kit')
    };
  });
}

/** Each of these is a database function that checks the caller is an organizer of the event. */
async function rpc(fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw error;
}
export const decideRegistration = (id: string, status: 'accepted' | 'declined' | 'pending') => rpc('decide_registration', { p_reg: id, p_status: status });
export const setRegistrationPaid = (id: string, paid: boolean) => rpc('set_registration_paid', { p_reg: id, p_paid: paid });
export const setRegistrationCheck = (id: string, check: CheckName, value: boolean) => rpc('set_registration_check', { p_reg: id, p_check: check, p_value: value });
export const setRegistrationInsurance = (id: string, insurance: Insurance) => rpc('set_registration_insurance', { p_reg: id, p_insurance: insurance });
