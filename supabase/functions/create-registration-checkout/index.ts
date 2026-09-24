import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return response(503, { error: 'Registration payments are not configured.' });

  let input: { registrationId?: string; registrationToken?: string };
  try {
    input = await request.json();
  } catch {
    return response(400, { error: 'Invalid request body.' });
  }

  const registrationId = input.registrationId?.trim() ?? '';
  const registrationToken = input.registrationToken?.trim() ?? '';
  if (!validUuid(registrationId) || !validUuid(registrationToken)) {
    return response(400, { error: 'Invalid registration credentials.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: registration, error } = await admin
    .from('event_registrations')
    .select('id,event_id,registration_token,payment_status,status,events!inner(registration_fee_cents,currency)')
    .eq('id', registrationId)
    .maybeSingle();

  if (error) return response(500, { error: 'Unable to verify registration.' });
  if (!registration || registration.registration_token !== registrationToken) {
    return response(404, { error: 'Registration not found.' });
  }
  if (registration.status === 'withdrawn' || registration.status === 'rejected') {
    return response(409, { error: 'This registration is not eligible for payment.' });
  }

  const eventRelation = registration.events as { registration_fee_cents?: number; currency?: string } | Array<{ registration_fee_cents?: number; currency?: string }> | null;
  const event = Array.isArray(eventRelation) ? eventRelation[0] : eventRelation;
  const amountCents = Number(event?.registration_fee_cents ?? 0);
  const currency = event?.currency ?? 'CAD';

  if (amountCents <= 0 || registration.payment_status === 'not_required') {
    return response(200, { checkoutUrl: null, paymentRequired: false, amountCents: 0, currency });
  }
  if (registration.payment_status === 'paid') {
    return response(200, { checkoutUrl: null, paymentRequired: false, alreadyPaid: true, amountCents, currency });
  }

  return response(503, {
    error: 'Online payment provider is not configured for BuhurtOS yet. Your registration is saved, but no charge was attempted.',
    code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
    paymentRequired: true,
    amountCents,
    currency
  });
});
