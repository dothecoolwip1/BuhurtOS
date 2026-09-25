import { competitionFormats } from './competitionFormats';
import { publicSupabase } from './supabase';

export type RegistrationKind = 'individual' | 'team';
export type RegistrationEligibilityStatus = 'eligible' | 'ineligible' | 'needs_review';
export type RegistrationStatus = 'pending' | 'approved' | 'waitlisted' | 'withdrawn' | 'rejected';

export interface RegistrationDivisionOption {
  id: string;
  name: string;
  teamSize?: number;
  registrationLimit?: number;
  isRegistrationOpen: boolean;
  divisionSnapshot: Record<string, any>;
}

export interface RegistrationInput {
  eventId: string;
  eventDivisionId: string;
  registrationKind: RegistrationKind;
  email: string;
  displayName: string;
  teamName: string;
  teamRoster: string[];
  fighterIdentityId?: string;
  ageYears?: number;
  weightKg?: number;
  experienceYears?: number;
  declarations: Record<string, boolean>;
  customValues: Record<string, string | number | boolean>;
  phone: string;
  emergencyContact: string;
  waiverAcknowledged: boolean;
}

export interface RegistrationResult {
  eventId: string;
  registrationId: string;
  registrationToken: string;
  status: RegistrationStatus;
  eligibilityStatus: RegistrationEligibilityStatus;
  eligibilityReasons: string[];
  paymentRequired: boolean;
  amountCents: number;
  currency: string;
}

export async function listRegistrationDivisions(eventId: string): Promise<RegistrationDivisionOption[]> {
  if (!publicSupabase) {
    return competitionFormats.slice(0, 8).map(format => ({
      id: 'demo-' + format.id,
      name: format.name,
      teamSize: format.teamSize,
      isRegistrationOpen: true,
      divisionSnapshot: {
        name: format.name,
        competitionFormatId: format.id,
        teamSize: format.teamSize ?? 1,
        eligibilityRules: []
      }
    }));
  }
  const { data, error } = await publicSupabase
    .from('event_divisions')
    .select('id,event_id,division_snapshot,registration_limit,is_registration_open')
    .eq('event_id', eventId)
    .eq('is_registration_open', true)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.division_snapshot?.name ?? row.division_snapshot?.competitionFormatId ?? 'Event division',
    teamSize: row.division_snapshot?.teamSize ?? undefined,
    registrationLimit: row.registration_limit ?? undefined,
    isRegistrationOpen: row.is_registration_open,
    divisionSnapshot: row.division_snapshot ?? {}
  }));
}

function demoEligibility(input: RegistrationInput, division?: RegistrationDivisionOption): { status: RegistrationEligibilityStatus; reasons: string[] } {
  const reasons: string[] = [];
  const expected = Number(division?.divisionSnapshot?.teamSize ?? division?.teamSize ?? 1);
  if (expected > 1 && input.registrationKind !== 'team') reasons.push('This division requires a team registration.');
  if (expected > 1 && input.teamRoster.length !== expected) reasons.push(`Team size must be exactly ${expected}.`);
  if (expected <= 1 && input.registrationKind !== 'individual') reasons.push('This division requires an individual registration.');
  const status: RegistrationEligibilityStatus = reasons.length ? 'ineligible' : 'needs_review';
  if (!reasons.length) reasons.push('Organizer review is required in demo mode.');
  return { status, reasons };
}

export async function submitRegistration(input: RegistrationInput, division?: RegistrationDivisionOption): Promise<RegistrationResult> {
  if (!input.eventDivisionId) throw new Error('Choose a registration division.');
  if (!publicSupabase) {
    const key = 'buhurtos-demo-registrations-' + input.eventId;
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, any>>;
    if (existing.some(item =>
      item.email?.toLowerCase() === input.email.trim().toLowerCase()
      && item.eventDivisionId === input.eventDivisionId
      && !['withdrawn','rejected'].includes(item.status)
    )) throw new Error('This email already has an active registration for that division.');
    const registrationId = crypto.randomUUID();
    const registrationToken = crypto.randomUUID();
    const now = new Date().toISOString();
    const eligibility = demoEligibility(input, division);
    const row = {
      id: registrationId,
      eventId: input.eventId,
      registrationToken,
      eventDivisionId: input.eventDivisionId,
      registrationKind: input.registrationKind,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      teamName: input.teamName.trim() || undefined,
      teamRoster: input.teamRoster,
      teamSize: input.registrationKind === 'team' ? input.teamRoster.length : undefined,
      category: division?.name ?? 'Event division',
      phone: input.phone.trim() || undefined,
      emergencyContact: input.emergencyContact.trim() || undefined,
      waiverAcknowledged: input.waiverAcknowledged,
      eligibilityStatus: eligibility.status,
      eligibilityReasons: eligibility.reasons,
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: now,
      updatedAt: now
    };
    existing.unshift(row);
    localStorage.setItem(key, JSON.stringify(existing));
    return {
      eventId: input.eventId, registrationId, registrationToken, status: 'pending',
      eligibilityStatus: eligibility.status, eligibilityReasons: eligibility.reasons,
      paymentRequired: true, amountCents: 2500, currency: 'CAD'
    };
  }
  const { data, error } = await publicSupabase.rpc('submit_event_registration', {
    p_event_id: input.eventId,
    p_event_division_id: input.eventDivisionId,
    p_registration_kind: input.registrationKind,
    p_email: input.email,
    p_display_name: input.displayName,
    p_team_name: input.teamName,
    p_team_roster: input.teamRoster,
    p_fighter_identity_id: input.fighterIdentityId ?? null,
    p_age_years: input.ageYears ?? null,
    p_weight_kg: input.weightKg ?? null,
    p_experience_years: input.experienceYears ?? null,
    p_declarations: input.declarations,
    p_custom_values: input.customValues,
    p_phone: input.phone,
    p_emergency_contact: input.emergencyContact,
    p_waiver_acknowledged: input.waiverAcknowledged
  });
  if (error) throw error;
  const row = data as any;
  return {
    eventId: input.eventId,
    registrationId: row.registrationId,
    registrationToken: row.registrationToken,
    status: row.status,
    eligibilityStatus: row.eligibilityStatus,
    eligibilityReasons: Array.isArray(row.eligibilityReasons) ? row.eligibilityReasons : [],
    paymentRequired: Boolean(row.paymentRequired),
    amountCents: Number(row.amountCents ?? 0),
    currency: row.currency ?? 'CAD'
  };
}

export async function withdrawRegistration(result: RegistrationResult): Promise<void> {
  if (!publicSupabase) {
    const key = 'buhurtos-demo-registrations-' + result.eventId;
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, any>>;
    const found = existing.find(item => item.id === result.registrationId);
    if (!found || found.registrationToken !== result.registrationToken) throw new Error('Registration not found.');
    localStorage.setItem(key, JSON.stringify(existing.map(item => item.id === result.registrationId ? {
      ...item, status: 'withdrawn', withdrawnAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    } : item)));
    const ghosts = JSON.parse(localStorage.getItem('buhurtos-demo-ghosts') ?? '[]') as Array<Record<string, any>>;
    localStorage.setItem('buhurtos-demo-ghosts', JSON.stringify(ghosts.map(entry =>
      entry.registrationId === result.registrationId || entry.metadata?.registrationId === result.registrationId
        ? { ...entry, attendanceStatus: 'withdrawn', competitionCleared: false }
        : entry
    )));
    return;
  }
  const { error } = await publicSupabase.rpc('withdraw_event_registration', {
    p_registration_id: result.registrationId,
    p_registration_token: result.registrationToken
  });
  if (error) throw error;
}

export async function uploadWaiver(result: RegistrationResult, file: File): Promise<void> {
  if (!publicSupabase) return;
  const form = new FormData();
  form.set('registrationId', result.registrationId);
  form.set('registrationToken', result.registrationToken);
  form.set('file', file);
  const { error } = await publicSupabase.functions.invoke('upload-waiver', { body: form });
  if (error) throw error;
}

export async function createRegistrationCheckout(result: RegistrationResult): Promise<string | null> {
  if (!result.paymentRequired) return null;
  if (!publicSupabase) return 'demo://checkout';
  const { data, error } = await publicSupabase.functions.invoke('create-registration-checkout', {
    body: { registrationId: result.registrationId, registrationToken: result.registrationToken }
  });
  if (error) throw error;
  if (data?.paymentUnavailable) {
    throw new Error(data.error || 'Online payment is not configured. Your registration is saved and no charge was attempted.');
  }
  return data?.checkoutUrl ?? null;
}
