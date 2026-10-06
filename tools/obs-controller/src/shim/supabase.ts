import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Node stand-in for src/lib/supabase.ts. The build replaces that module with THIS one (see build.mjs), so the app's own pure modules and data
 * functions (src/data/matches, src/data/lyst, src/data/liveScores, src/data/api, src/lib/arena, the broadcast scene logic) are reused unchanged.
 *
 * The client uses the `accessToken` option: the Companion's controller session supplies the token (role bos_controller), or none (then every request
 * is an ordinary anonymous public read). There is no sign-in, no stored session and no realtime socket: the Companion polls.
 */
export interface SupabaseConfig { url: string; key: string; getToken: () => Promise<string | null>; timeoutMs?: number }

let cfg: SupabaseConfig | null = null;
let client: SupabaseClient | null = null;

export function configureSupabase(c: SupabaseConfig | null): void { cfg = c; client = null; }
export const isSupabaseConfigured = (): boolean => cfg !== null;

function make(): SupabaseClient {
  if (!cfg) throw new Error('BuhurtOS is not set up yet (no project address)');
  const c = cfg;
  return createClient(c.url, c.key, {
    accessToken: async () => { try { return await c.getToken(); } catch { return null; } },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(c.timeoutMs ?? 10_000) }) }
  });
}

/** Same name and shape the app's modules import. Created on first use, so the Companion can be configured after it starts. */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    client ??= make();
    const v = Reflect.get(client, prop, client) as unknown;
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(client) : v;
  }
});
