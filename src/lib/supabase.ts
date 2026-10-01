import { createClient } from '@supabase/supabase-js';

/**
 * The URL and the publishable key are public by design: they only identify the project. Every permission is enforced
 * by the database (row-level security and the security-definer functions), never by this file or by hiding buttons.
 */
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://mvbxlebznlgroptwwdsm.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_u76M-dggKSsdsyhUQKveJg_5fPJ5Nan';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});
