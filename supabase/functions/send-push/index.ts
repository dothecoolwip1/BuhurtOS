// BuhurtOS push dispatcher (Supabase Edge Function). It only DELIVERS: the database decides who is notified, when, and what it says
// (public.push_claim), and records what happened (public.push_report). Nothing here is needed for scoring, the queue or registration to work.
//
// Who may call it: only the database. pg_net sends a shared secret (x-dispatch-secret) that lives in private.push_config; this function has
// verify_jwt off because that caller has no user JWT, and checks the secret itself before doing anything.
// Secrets: the VAPID private key is created here the first time the function runs and stored through a service-role-only database function.
// It is never returned to a caller, never logged and never leaves the database + this function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateVapidKeys, sendWebPush, type VapidKeys } from './webpush.ts';

const MAX_BATCHES = 5;
const CONCURRENCY = 10;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const same = (a: string, b: string) => {          // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

interface Claim { notification_id: string; subscription_id: string; endpoint: string; p256dh: string; auth: string; title: string; body: string; route: string; category: string; tag: string; urgent: boolean; ttl: number }

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const cfgRes = await sb.rpc('push_dispatch_config');
  const cfg = cfgRes.data as { secret?: string; vapid_public?: string; vapid_private?: string; subject?: string } | null;
  if (cfgRes.error || !cfg?.secret) return json({ error: 'not configured' }, 503);
  if (!same(req.headers.get('x-dispatch-secret') ?? '', cfg.secret)) return json({ error: 'forbidden' }, 401);

  let vapid: VapidKeys | null = cfg.vapid_public && cfg.vapid_private ? { publicKey: cfg.vapid_public, privateKey: cfg.vapid_private } : null;
  if (!vapid) {
    const fresh = await generateVapidKeys();
    await sb.rpc('push_store_vapid', { p_public: fresh.publicKey, p_private: fresh.privateKey });   // false when another run stored first: read what won
    const again = (await sb.rpc('push_dispatch_config')).data as typeof cfg;
    if (!again?.vapid_public || !again?.vapid_private) return json({ error: 'could not create keys' }, 500);
    vapid = { publicKey: again.vapid_public, privateKey: again.vapid_private };
  }
  const subject = cfg.subject || 'https://dothecoolwip1.github.io/BuhurtOS/';

  const totals = { claimed: 0, sent: 0, gone: 0, retry: 0, failed: 0 };
  for (let round = 0; round < MAX_BATCHES; round++) {
    const claimed = await sb.rpc('push_claim', { p_limit: 100 });
    const batch = (claimed.data ?? []) as Claim[];
    if (claimed.error || batch.length === 0) break;
    totals.claimed += batch.length;
    const results: { notification_id: string; subscription_id: string; outcome: string; error?: string }[] = [];
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      await Promise.all(batch.slice(i, i + CONCURRENCY).map(async c => {
        const r = await sendWebPush(
          { endpoint: c.endpoint, p256dh: c.p256dh, auth: c.auth },
          { body: { title: c.title, body: c.body, route: c.route, tag: c.tag, category: c.category, urgent: c.urgent }, ttl: c.ttl, urgent: c.urgent },
          vapid!, subject);
        totals[r.outcome] += 1;
        results.push({ notification_id: c.notification_id, subscription_id: c.subscription_id, outcome: r.outcome, error: r.error });
      }));
    }
    await sb.rpc('push_report', { p_results: results });
    if (batch.length < 100) break;
  }

  // Housekeeping with the service key: scrubbed device tombstones after a week, read notifications after a month, everything after 90 days.
  const day = 86_400_000;
  const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
  await sb.from('push_subscriptions').delete().not('revoked_at', 'is', null).lt('revoked_at', iso(7 * day));
  await sb.from('notifications').delete().not('read_at', 'is', null).lt('read_at', iso(30 * day));
  await sb.from('notifications').delete().lt('created_at', iso(90 * day));

  return json({ ok: true, ...totals });
});
