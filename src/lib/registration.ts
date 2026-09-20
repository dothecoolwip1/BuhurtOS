import { supabase } from './supabase';

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
  if (!supabase) {
    return { registrationId: crypto.randomUUID(), registrationToken: crypto.randomUUID(), paymentRequired: true, amountCents: 2500, currency: 'CAD' };
  }
  const { data, error } = await supabase.rpc('submit_public_registration', {
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
  if (!supabase) return;
  const form = new FormData();
  form.set('registrationId', result.registrationId);
  form.set('registrationToken', result.registrationToken);
  form.set('file', file);
  const { error } = await supabase.functions.invoke('upload-waiver', { body: form });
  if (error) throw error;
}

export async function createRegistrationCheckout(result: RegistrationResult): Promise<string | null> {
  if (!result.paymentRequired) return null;
  if (!supabase) return 'demo://checkout';
  const { data, error } = await supabase.functions.invoke('create-registration-checkout', { body: { registrationId: result.registrationId, registrationToken: result.registrationToken } });
  if (error) throw error;
  return data?.checkoutUrl ?? null;
}
