/**
 * Registration form logic. Mirrors the checks the database enforces in submit_registration so people get clear
 * messages early; the database stays the authority and re-checks everything.
 */
export type LeagueKey = 'buhurt' | 'duels' | 'outrance' | 'hacsa';
export interface CompetitionOption { id: string; name: string; category: string; league: LeagueKey; gender: 'open' | 'men' | 'women' }
export interface EventFee { feeCents: number; feeProvince: string | null }

export type Insurance = 'hacsa_member' | 'mcc_member' | 'proof_pending' | 'needs_cover' | 'declined';
export interface CompDetails { weight?: string; teammate?: string; teamId?: string }

export interface RegForm {
  fullName: string; email: string; gender: '' | 'male' | 'female' | 'other';
  organization: '' | 'HACSA' | 'MCC' | 'other';
  province: string; teamId: string; biProfile: string;
  /** ISO days of the event the person can attend (chosen from the event's own dates). */
  sharesEquipment: '' | 'yes' | 'no'; attendDates: string[]; availabilityNotes: string;
  competitionIds: string[]; details: Record<string, CompDetails>;
  mercenary: boolean; isVolunteer: boolean; volunteerRoles: string[]; volunteerOther: string;
  insurance: Insurance | '';
  emergencyName: string; emergencyRelationship: string; emergencyPhone: string;
  medicallyFit: boolean; medicalNote: string;
  feeUnderstood: boolean;
  waiverAgree: boolean; waiverName: string; notes: string;
}

export const emptyForm = (email = ''): RegForm => ({
  fullName: '', email, gender: '', organization: '', province: '', teamId: '', biProfile: '',
  sharesEquipment: '', attendDates: [], availabilityNotes: '', competitionIds: [], details: {},
  mercenary: false, isVolunteer: false, volunteerRoles: [], volunteerOther: '', insurance: '',
  emergencyName: '', emergencyRelationship: '', emergencyPhone: '', medicallyFit: false, medicalNote: '',
  feeUnderstood: false, waiverAgree: false, waiverName: '', notes: ''
});

export const PROVINCES: [string, string][] = [['AB', 'Alberta'], ['BC', 'British Columbia'], ['SK', 'Saskatchewan'], ['MB', 'Manitoba'], ['ON', 'Ontario'], ['QC', 'Quebec'], ['NB', 'New Brunswick'], ['NS', 'Nova Scotia'], ['PE', 'Prince Edward Island'], ['NL', 'Newfoundland and Labrador'], ['YT', 'Yukon'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['OUT', 'Outside Canada']];
export const VOLUNTEER_ROLES = ['Squire', 'Points counter', 'Marshal', 'Runner', 'Secretary', 'Scheduling', 'Ticket booth'];
/** The eighth role on the form. Its free-text description is stored in volunteer_roles as `Other: <text>` (no new column). */
export const OTHER_ROLE = 'Other';
export const OTHER_ROLE_MAX = 200;
export const ALL_VOLUNTEER_ROLES = [...VOLUNTEER_ROLES, OTHER_ROLE];
/** The roles to store: the fixed ones as-is, and `Other: <description>` when Other is ticked. */
export function volunteerRolesFor(f: Pick<RegForm, 'isVolunteer' | 'volunteerRoles' | 'volunteerOther'>): string[] {
  if (!f.isVolunteer) return [];
  return f.volunteerRoles.map(r => (r === OTHER_ROLE ? `${OTHER_ROLE}: ${f.volunteerOther.trim()}` : r));
}
export const INSURANCE_OPTIONS: [Insurance, string][] = [
  ['hacsa_member', 'Yes, I am a HACSA member in good standing, my dues are paid and my membership forms are signed'],
  ['mcc_member', 'Yes, I am an MCC member, covered under the partnership with HACSA'],
  ['proof_pending', 'Yes, I will send proof of insurance before check-in'],
  ['needs_cover', 'No, I would like to take part but do not have cover. I will ask about temporary HACSA membership'],
  ['declined', 'No, and I will not be taking part in this event']
];

/** Same rule as the database: volunteers owe nothing; otherwise the fee applies to the fee province (or everyone if none is set). */
export function feeFor(fee: EventFee, province: string, isVolunteer: boolean): number {
  if (isVolunteer) return 0;
  if (!fee.feeProvince) return fee.feeCents;
  return province.toUpperCase() === fee.feeProvince.toUpperCase() ? fee.feeCents : 0;
}
export const formatMoney = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

const needsTeam = (c: CompetitionOption) => c.league === 'buhurt';
const needsWeight = (c: CompetitionOption) => c.league === 'outrance';

export type FieldErrors = Record<string, string>;

export function validate(f: RegForm, comps: CompetitionOption[], fee: EventFee): FieldErrors {
  const e: FieldErrors = {};
  if (f.fullName.trim().length < 2) e.fullName = 'Enter your first and last name.';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
  if (!f.gender) e.gender = 'Choose one.';
  if (!f.organization) e.organization = 'Choose one.';
  if (!f.province) e.province = 'Choose where you are from.';
  if (!f.sharesEquipment) e.sharesEquipment = 'Choose yes or no.';
  if (f.attendDates.length === 0) e.attendDates = 'Pick at least one day.';
  if (!f.isVolunteer && f.competitionIds.length === 0) e.competitionIds = 'Choose at least one category, or sign up as a volunteer.';
  for (const id of f.competitionIds) {
    const c = comps.find(x => x.id === id);
    if (!c) continue;
    if (needsTeam(c) && !(f.details[id]?.teamId || f.teamId)) e[`team:${id}`] = `Choose your team for ${c.name}. Fighters without a team do not fight.`;
    if (needsWeight(c) && !f.details[id]?.weight?.trim()) e[`weight:${id}`] = `Enter your weight for ${c.name}.`;
  }
  if (f.isVolunteer && f.volunteerRoles.includes(OTHER_ROLE)) {
    const o = f.volunteerOther.trim();
    if (o.length < 2) e.volunteerOther = 'Describe how you would like to help.';
    else if (o.length > OTHER_ROLE_MAX) e.volunteerOther = `Keep this under ${OTHER_ROLE_MAX} characters.`;
  }
  if (!f.insurance) e.insurance = 'Choose one.';
  if (f.insurance === 'declined') e.insurance = 'You need insurance cover to take part. Choose another option, or volunteer instead of fighting.';
  if (f.emergencyName.trim().length < 2) e.emergencyName = 'Enter an emergency contact name.';
  if (f.emergencyPhone.replace(/\D/g, '').length < 7) e.emergencyPhone = 'Enter a phone number with at least 7 digits.';
  if (!f.medicallyFit) e.medicallyFit = 'You must declare that you are medically fit to take part.';
  if (feeFor(fee, f.province, f.isVolunteer) > 0 && !f.feeUnderstood) e.feeUnderstood = 'Confirm you understand the fee.';
  if (!f.waiverAgree) e.waiverAgree = 'You must accept the waiver to take part.';
  if (f.waiverName.trim().length < 2) e.waiverName = 'Type your full name to sign.';
  return e;
}

/** The exact object submit_registration expects. */
export function buildPayload(f: RegForm, waiverVersionId: string) {
  return {
    full_name: f.fullName.trim(), gender: f.gender, organization: f.organization, province: f.province,
    team_id: f.teamId || null, shares_equipment: f.sharesEquipment === 'yes', attend_dates: f.attendDates,
    availability_notes: f.availabilityNotes.trim() || null, bi_profile: f.biProfile.trim() || null,
    insurance: f.insurance, is_volunteer: f.isVolunteer, volunteer_roles: volunteerRolesFor(f),
    mercenary: f.mercenary, notes: f.notes.trim() || null,
    waiver_agree: f.waiverAgree, waiver_version_id: waiverVersionId, waiver_signed_name: f.waiverName.trim(),
    competitions: f.competitionIds.map(id => ({ competition_id: id, team_id: f.details[id]?.teamId || f.teamId || null, details: stripEmpty(f.details[id] ?? {}) })),
    private: { email: f.email.trim(), emergency_name: f.emergencyName.trim(), emergency_relationship: f.emergencyRelationship.trim(), emergency_phone: f.emergencyPhone.trim(), medically_fit: f.medicallyFit, medical_note: f.medicalNote.trim() || null }
  };
}
const stripEmpty = (d: CompDetails) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== ''));
