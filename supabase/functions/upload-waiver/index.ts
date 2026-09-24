import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const allowedTypes = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png']
]);

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
  if (!supabaseUrl || !serviceRoleKey) return response(503, { error: 'Waiver storage is not configured.' });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return response(400, { error: 'Invalid multipart form.' });
  }

  const registrationId = String(form.get('registrationId') ?? '').trim();
  const registrationToken = String(form.get('registrationToken') ?? '').trim();
  const file = form.get('file');

  if (!validUuid(registrationId) || !validUuid(registrationToken)) {
    return response(400, { error: 'Invalid registration credentials.' });
  }
  if (!(file instanceof File)) return response(400, { error: 'A waiver file is required.' });
  if (file.size < 1 || file.size > 10 * 1024 * 1024) {
    return response(400, { error: 'Waiver file must be between 1 byte and 10 MB.' });
  }

  const extension = allowedTypes.get(file.type);
  if (!extension) return response(400, { error: 'Waiver must be a PDF, JPG, or PNG file.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: registration, error: registrationError } = await admin
    .from('event_registrations')
    .select('id,event_id,registration_token,waiver_storage_path,status,events!inner(organization_id)')
    .eq('id', registrationId)
    .maybeSingle();

  if (registrationError) return response(500, { error: 'Unable to verify registration.' });
  if (!registration || registration.registration_token !== registrationToken) {
    return response(404, { error: 'Registration not found.' });
  }
  if (registration.status === 'withdrawn' || registration.status === 'rejected') {
    return response(409, { error: 'This registration no longer accepts waiver uploads.' });
  }

  const path = `${registration.event_id}/${registration.id}/${crypto.randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from('waivers')
    .upload(path, bytes, { contentType: file.type, upsert: false, cacheControl: '0' });

  if (uploadError) return response(500, { error: 'Unable to store waiver file.' });

  const previousPath = registration.waiver_storage_path as string | null;
  const { error: updateError } = await admin
    .from('event_registrations')
    .update({ waiver_storage_path: path })
    .eq('id', registration.id)
    .eq('registration_token', registrationToken);

  if (updateError) {
    await admin.storage.from('waivers').remove([path]);
    return response(500, { error: 'Unable to attach waiver to registration.' });
  }

  if (previousPath && previousPath !== path) {
    await admin.storage.from('waivers').remove([previousPath]);
  }

  const eventRelation = registration.events as { organization_id?: string } | Array<{ organization_id?: string }> | null;
  const organizationId = Array.isArray(eventRelation) ? eventRelation[0]?.organization_id : eventRelation?.organization_id;
  await admin.from('audit_log').insert({
    organization_id: organizationId ?? null,
    event_id: registration.event_id,
    actor_user_id: null,
    table_name: 'event_registrations',
    record_id: registration.id,
    action: 'public_waiver_upload',
    payload: { mimeType: file.type, size: file.size, replacedExisting: Boolean(previousPath) }
  });

  return response(200, { uploaded: true });
});
