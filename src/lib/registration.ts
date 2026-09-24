import { publicSupabase } from './supabase';

export interface RegistrationInput {
  eventId: string;
  email: string;
  displayName: string;
  teamName: string;
  category: string;
  phone: string;
  emergencyContact: string;
  waiverAcknowledged: boolean;
}

export interface RegistrationResult {
  registrationId: string;
  registrationToken: string;
  paymentRequired: boolean;
  amountCents: number;
  currency: string;
}

export async function submitRegistration(input: RegistrationInput): Promise<RegistrationResult> {
  if (!publicSupabase) {
    const key = 'buhurtos-demo-registrations-' + input.eventId;
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<Record<string, any>>;
    if (existing.some(item => item.email?.toLowerCase() === input.email.trim().toLowerCase() && item.category === input.category)) {
      throw new Error('This email is already registered for that category.');
    }
    const registrationId = crypto.randomUUID();
    const registrationToken = crypto.randomUUID();
    const now = new Date().toISOString();
    existing.unshift({
      id: registrationId,
      eventId: input.eventId,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      teamName: input.teamName.trim() || undefined,
      category: input.category,
      phone: input.phone.trim() || undefined,
      emergencyContact: input.emergencyContact.trim() || undefined,
      waiverAcknowledged: input.waiverAcknowledged,
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: now,
      updatedAt: now
    });
    localStorage.setItem(key, JSON.stringify(existing));
    return { registrationId, registrationToken, paymentRequired: true, amountCents: 2500, currency: 'CAD' };
  }
  const { data, error } = await publicSupabase.rpc('submit_public_registration', {
    p_event_id: input.eventId,
    p_email: input.email,
    p_display_name: input.displayName,
    p_team_name: input.teamName,
    p_category: input.category,
    p_phone: input.phone,
    p_emergency_contact: input.emergencyContact,
    p_waiver_acknowledged: input.waiverAcknowledged
  });
  if (error) throw error;
  return data as RegistrationResult;
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
  const { data, error } = await publicSupabase.functions.invoke('create-registration-checkout', { body: { registrationId: result.registrationId, registrationToken: result.registrationToken } });
  if (error) throw error;
  if (data?.paymentUnavailable) {
    throw new Error(data.error || 'Online payment is not configured. Your registration is saved and no charge was attempted.');
  }
  return data?.checkoutUrl ?? null;
}
