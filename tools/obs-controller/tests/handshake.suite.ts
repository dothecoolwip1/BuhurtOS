import { describe, expect, it } from 'vitest';
import { startStandIn } from '../../../scripts/obs-standin/server.mjs';
import { quietLogger } from '../src/log';
import { EMPTY_POLICY } from '../src/obs/allowlist';
import { BACKOFF_MS, ObsClient, obsAuth, ObsNotConnected, ObsRequestFailed, Sub, SUBSCRIPTIONS_BASE, SUBSCRIPTIONS_WITH_METERS } from '../src/obs/client';
import { OBS_PASSWORD, sleep, waitFor } from './harness';

const mk = (port: number, pw: string | null, extra: Partial<ConstructorParameters<typeof ObsClient>[0]> = {}) =>
  new ObsClient({ port, getPassword: async () => pw, policy: () => EMPTY_POLICY, logger: quietLogger(), backoffMs: [20, 40, 60], ...extra });

describe('obs-websocket v5 authentication (known vectors)', () => {
  // Computed independently with Python's hashlib (not copied from the OBS documentation):
  //   secret = base64(sha256(password + salt)); auth = base64(sha256(secret + challenge))
  it('matches independently computed vectors', () => {
    expect(obsAuth('supersecretpassword', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhTO1twS5OOZDUQ=')).toBe('0Rp31ef8U/w6UzoL4oHx4vrYnErzTCqRgK/Shj+BB0o=');
    expect(obsAuth('correct horse battery staple', 'Zm9vYmFyc2FsdA==', 'Y2hhbGxlbmdlLTEyMzQ1Ng==')).toBe('w/kAnyuNPliIz3hYoOzjgELTCI+l53PYlsIHbCCGUe4=');
  });
  it('changes with every input', () => {
    const base = obsAuth('p', 's', 'c');
    expect(obsAuth('P', 's', 'c')).not.toBe(base);
    expect(obsAuth('p', 'S', 'c')).not.toBe(base);
    expect(obsAuth('p', 's', 'C')).not.toBe(base);
  });
  it('subscription bits are the protocol values: Scenes|Inputs|Outputs|General (+Filters, MediaInputs); the meter bit only when asked', () => {
    expect(Sub.General).toBe(1); expect(Sub.Scenes).toBe(4); expect(Sub.Inputs).toBe(8); expect(Sub.Filters).toBe(32); expect(Sub.Outputs).toBe(64); expect(Sub.MediaInputs).toBe(256); expect(Sub.InputVolumeMeters).toBe(65536);
    expect(SUBSCRIPTIONS_BASE).toBe(1 | 4 | 8 | 32 | 64 | 256);
    expect(SUBSCRIPTIONS_BASE & Sub.InputVolumeMeters).toBe(0);
    expect(SUBSCRIPTIONS_WITH_METERS & Sub.InputVolumeMeters).toBe(Sub.InputVolumeMeters);
    expect(SUBSCRIPTIONS_WITH_METERS & ~Sub.InputVolumeMeters).toBe(SUBSCRIPTIONS_BASE);
  });
  it('the reconnect schedule is 1, 2, 5, 10 seconds, then 10 s for ever', () => { expect([...BACKOFF_MS]).toEqual([1000, 2000, 5000, 10_000]); });
});

describe('connecting to the (stand-in) OBS', () => {
  it('right password: identifies, reads the version; wrong password: refused with 4009 and a plain-words reason; the stand-in checked the real challenge', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    try {
      const good = mk(so.port, OBS_PASSWORD);
      good.start();
      await waitFor(() => good.connected && good.version !== null, 5000, 'identified and version read');
      expect(good.version?.obsVersion).toBe('32.0.0');
      expect(so.identifiedSessions()).toBe(1);
      await good.stop();

      const bad = mk(so.port, 'not-the-password');
      bad.start();
      await waitFor(() => bad.lastProblem !== null, 5000, 'a problem');
      expect(bad.connected).toBe(false);
      expect(bad.lastProblem).toMatch(/rejected the password/);
      await bad.stop();
      expect(so.identifiedSessions()).toBe(0);
    } finally { await so.close(); }
  });

  it('OBS wants a password and none is set: says so, and keeps trying (so fixing it works without a restart)', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    let pw: string | null = null;
    const c = new ObsClient({ port: so.port, getPassword: async () => pw, policy: () => EMPTY_POLICY, logger: quietLogger(), backoffMs: [20, 40] });
    try {
      c.start();
      await waitFor(() => /asks for a password/.test(c.lastProblem ?? ''), 5000, 'no password problem');
      pw = OBS_PASSWORD;
      await waitFor(() => c.connected, 5000, 'connected after the password was set');
    } finally { await c.stop(); await so.close(); }
  });

  it('a password change in OBS (connections dropped) is recovered once the new password is known', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    let pw = OBS_PASSWORD;
    const c = new ObsClient({ port: so.port, getPassword: async () => pw, policy: () => EMPTY_POLICY, logger: quietLogger(), backoffMs: [20, 40] });
    try {
      c.start(); await waitFor(() => c.connected);
      so.setPassword('new-password-123');
      await waitFor(() => !c.connected);
      await waitFor(() => /rejected the password/.test(c.lastProblem ?? ''), 5000, 'rejected');
      pw = 'new-password-123'; c.retryNow();
      await waitFor(() => c.connected, 5000, 'connected with the new password');
    } finally { await c.stop(); await so.close(); }
  });

  it('works against an OBS with authentication off (no password needed)', async () => {
    const so = await startStandIn({ password: '' });
    const c = mk(so.port, null);
    try { c.start(); await waitFor(() => c.connected); } finally { await c.stop(); await so.close(); }
  });

  it('is only ever willing to connect to this laptop', () => {
    for (const host of ['192.168.1.20', '0.0.0.0', 'example.com', '10.0.0.5', '127.0.0.2', '']) expect(() => mk(4455, 'x', { host }), host).toThrow(/this laptop/);
    for (const host of ['127.0.0.1', 'localhost', '::1']) expect(() => mk(4455, 'x', { host }), host).not.toThrow();
  });

  it('reconnects after a drop, an OBS exit and an OBS restart, announcing each identify; backoff restarts after a success', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    const c = mk(so.port, OBS_PASSWORD);
    let identifies = 0, closes = 0;
    c.on('identified', () => { identifies++; }); c.on('closed', () => { closes++; });
    try {
      c.start(); await waitFor(() => identifies === 1);
      so.dropConnections();
      await waitFor(() => identifies === 2, 5000, 'second identify');
      await so.exit();
      await waitFor(() => !c.connected);
      await sleep(150);                                                    // OBS stays down for a while: the client keeps retrying quietly
      expect(c.connected).toBe(false);
      await so.start();
      await waitFor(() => identifies === 3, 5000, 'third identify');
      await so.restart({ downMs: 100 });
      await waitFor(() => identifies === 4, 5000, 'fourth identify');
      expect(closes).toBeGreaterThanOrEqual(3);
    } finally { await c.stop(); await so.close(); }
  });

  it('retries with growing waits, capped at the last step', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    const port = so.port;
    await so.exit();                                                       // nothing listens
    const c = new ObsClient({ port, getPassword: async () => OBS_PASSWORD, policy: () => EMPTY_POLICY, logger: quietLogger(), backoffMs: [30, 60, 120] });
    const waits: string[] = [];
    c.on('state', (s, why) => { if (s === 'waiting') waits.push(why); });
    try {
      c.start();
      await waitFor(() => waits.length >= 5, 5000, 'five retries');
      expect(waits.slice(0, 5)).toEqual(['retrying in 0.03 s', 'retrying in 0.06 s', 'retrying in 0.12 s', 'retrying in 0.12 s', 'retrying in 0.12 s']);
      expect(c.lastProblem).toMatch(/not running|refused/);
    } finally { await c.stop(); await so.close(); }
  });

  it('a request OBS never answers times out; OBS errors carry their code; requests while not connected fail cleanly', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    const c = mk(so.port, OBS_PASSWORD, { requestTimeoutMs: 200, policy: () => ({ ...EMPTY_POLICY, mutableInputs: ['Music'] }) });
    try {
      await expect(c.getStats()).rejects.toBeInstanceOf(ObsNotConnected);
      c.start(); await waitFor(() => c.connected);
      so.hangNext('GetStats');
      await expect(c.getStats()).rejects.toMatchObject({ name: 'ObsRequestFailed', status: -1 });
      await expect(c.setCurrentProgramScene('No Such Scene')).rejects.toMatchObject({ status: 600 });
      await expect(c.getInputMute('Nope')).rejects.toBeInstanceOf(ObsRequestFailed);
      so.failNext('GetStats', 702, 'boom');
      await expect(c.getStats()).rejects.toMatchObject({ status: 702 });
      so.setLatency(60);
      expect((await c.getVersion()).obsVersion).toBe('32.0.0');             // slow but fine
      so.setLatency(0);
      // many requests in flight at once are matched to their own answers
      const many = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? c.getSceneList() : c.getCurrentProgramScene())));
      expect(many).toHaveLength(20);
      so.dropConnections();
      await waitFor(() => !c.connected);
      await expect(c.getStats()).rejects.toBeInstanceOf(ObsNotConnected);
    } finally { await c.stop(); await so.close(); }
  });

  it('requests that were waiting when the connection dropped fail at once (they do not hang)', async () => {
    const so = await startStandIn({ password: OBS_PASSWORD });
    const c = mk(so.port, OBS_PASSWORD, { requestTimeoutMs: 5000 });
    try {
      c.start(); await waitFor(() => c.connected);
      so.hangNext('GetStats');
      const t0 = Date.now();
      const p = c.getStats();
      await sleep(50); so.dropConnections();
      await expect(p).rejects.toBeInstanceOf(ObsNotConnected);
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally { await c.stop(); await so.close(); }
  });
});
