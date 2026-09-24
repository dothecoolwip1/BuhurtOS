import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const allowedRoles = new Set([
  'event_organizer',
  'field_marshal',
  'assistant_marshal',
  'team_captain',
  'fighter'
]);

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!authorization) return response(401, { error: 'Authentication required.' });
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return response(503, { error: 'Account administration is not configured.' });
  }

  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: callerData, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerData.user) return response(401, { error: 'Authentication required.' });

  let input: { eventId?: string; email?: string; role?: string; teamId?: string };
  try {
    input = await request.json();
  } catch {
    return response(400, { error: 'Invalid request body.' });
  }

  const eventId = input.eventId?.trim();
  const email = input.email?.trim().toLowerCase();
  const role = input.role?.trim();
  const teamId = input.teamId?.trim() || null;

  if (!eventId || !email || !role || !allowedRoles.has(role)) {
    return response(400, { error: 'Event, email, and a valid event role are required.' });
  }
  if (role === 'team_captain' && !teamId) {
    return response(400, { error: 'Team captains require a team.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  let targetUserId: string | null = null;
  for (let page = 1; page <= 20 && !targetUserId; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return response(500, { error: 'Unable to look up the account.' });

    const match = data.users.find(user => user.email?.toLowerCase() === email);
    if (match) {
      targetUserId = match.id;
      break;
    }
    if (data.users.length < 100) break;
  }

  if (!targetUserId) {
    return response(404, {
      error: 'No BuhurtOS account exists for that email. Ask the person to create and verify an account first. No invitation email was sent.'
    });
  }

  const { error: roleError } = await caller.rpc('assign_event_role', {
    p_event_id: eventId,
    p_user_id: targetUserId,
    p_role: role,
    p_team_id: role === 'team_captain' ? teamId : null
  });

  if (roleError) {
    const message = roleError.message || 'Unable to assign event access.';
    const status = /required|authorized|administrator|cannot|only/i.test(message) ? 403 : 400;
    return response(status, { error: message });
  }

  return response(200, { invited: false, assigned: true });
});
