import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDeviceClient } from './deviceClient';
import { configureDevice, deviceManager, isDeviceMode } from './deviceSession';

/**
 * The URL and the publishable key are public by design: they only identify the project. Every permission is enforced
 * by the database (row-level security and the security-definer functions), never by this file or by hiding buttons.
 */
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://mvbxlebznlgroptwwdsm.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_u76M-dggKSsdsyhUQKveJg_5fPJ5Nan';
configureDevice({ url, key });

/**
 * Two modes, chosen once per page load: a person's account (the normal client, unchanged) or a temporary event device (Pack 18.1), which holds a
 * session of its own and uses the `accessToken` client of src/lib/deviceClient.ts. Switching is always a full page load.
 */
export const supabase: SupabaseClient = isDeviceMode()
  ? createDeviceClient(url, key, deviceManager())
  : createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
