import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEnv, defaultConfig, LocalFiles, parseConfig, parseState } from '../src/config';
import {
  createCredentialStore, EnvCredentialStore, FileCredentialStore, LayeredCredentialStore, MacKeychainStore, MemoryCredentialStore, WindowsDpapiStore, writePrivateFile, type Runner
} from '../src/credentials';
import { Logger, Redactor } from '../src/log';

const SECRETS = { obs: 'Tr0ub4dor&3-obs-password', code: 'K7Q2-M9XD-4TRH', session: 'p9Xk2mQ7vL1sT8nB4cR6wZ3yH5jD0fGaE2uI9oP7qWk', jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYm9zX2NvbnRyb2xsZXIifQ.c2lnbmF0dXJlMTIzNDU2' };

describe('the redacting logger: no secret reaches a log line', () => {
  const make = () => {
    const redactor = new Redactor(); const lines: string[] = [];
    const log = new Logger({ redactor, echo: false, level: 'debug', sink: l => lines.push(l.msg) });
    redactor.add(SECRETS.obs); redactor.add(SECRETS.code); redactor.add(SECRETS.session);
    return { redactor, log, lines };
  };
  it('hides registered secrets in messages and in structured data, in every form it might appear', () => {
    const { log, lines } = make();
    log.info(`password is ${SECRETS.obs}`);
    log.warn('code', { value: SECRETS.code, nested: { x: `a${SECRETS.code.replace(/-/g, '')}b` } });
    log.error(`bad: ${SECRETS.code.toLowerCase()}`);
    log.debug('url', { link: `https://x/?c=${encodeURIComponent(SECRETS.obs)}` });
    log.info(`b64 ${Buffer.from(SECRETS.obs).toString('base64')}`);
    log.info(`secret ${SECRETS.session}`);
    const all = lines.join('\n') + '\n' + log.tail(100).map(l => l.msg).join('\n');
    for (const s of [SECRETS.obs, SECRETS.code, SECRETS.code.replace(/-/g, ''), SECRETS.session, Buffer.from(SECRETS.obs).toString('base64'), encodeURIComponent(SECRETS.obs)]) expect(all.includes(s), s).toBe(false);
    expect(all).toContain('[hidden]');
  });
  it('hides secrets by SHAPE too, even if nobody registered them: JWTs, Bearer headers, XXXX-XXXX-XXXX codes, long random secrets', () => {
    const { log, lines } = make();
    log.info(`token ${SECRETS.jwt}`); log.info('Authorization: Bearer abcdefghijklmnop12345'); log.info('code W3RT-2NPQ-8XYZ here'); log.info('hash ' + 'a1B2c3D4e5'.repeat(5));
    const all = lines.join('\n');
    expect(all).not.toMatch(/eyJ/); expect(all).not.toMatch(/abcdefghijklmnop12345/); expect(all).not.toMatch(/W3RT-2NPQ-8XYZ/); expect(all).not.toMatch(/a1B2c3D4e5a1B2c3D4e5/);
  });
  it('hides values under sensitive KEYS (password, secret, token, authorization, code, challenge, salt, key...) whatever they hold', () => {
    const { log, lines } = make();
    log.info('x', { password: 'hunter2', session_secret: 'abc', accessToken: 'zzz', Authorization: 'Basic abc', code: 'whatever', challenge: 'c', salt: 's', apikey: 'k', controllerCode: 'cc', ok: 'visible' });
    const out = lines.join('');
    for (const v of ['hunter2', 'Basic abc', 'whatever', 'zzz']) expect(out).not.toContain(v);
    expect(out).toContain('visible');
  });
  it('does not mangle ordinary ids: a UUID in a message survives', () => {
    const { log, lines } = make();
    log.info('match 5d4c0580-7b67-527a-8415-9c0ac43e89e3 went live');
    expect(lines[0]).toContain('5d4c0580-7b67-527a-8415-9c0ac43e89e3');
  });
  it('survives circular and odd data without throwing', () => {
    const { log } = make();
    const a: Record<string, unknown> = {}; a.self = a;
    expect(() => log.info('x', a)).not.toThrow();
    expect(() => log.info('x', { big: 10n as unknown as number })).not.toThrow();
    expect(() => log.info('err', new Error(`failed with ${SECRETS.obs}`))).not.toThrow();
  });
  it('writes the same redacted text to the log file (owner-only) and keeps a bounded tail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-log-'));
    try {
      const redactor = new Redactor(); redactor.add(SECRETS.obs);
      const log = new Logger({ redactor, echo: false, file: join(dir, 'sub', 'c.log'), keep: 5 });
      for (let i = 0; i < 9; i++) log.info(`line ${i} ${SECRETS.obs}`);
      const text = readFileSync(join(dir, 'sub', 'c.log'), 'utf8');
      expect(text).not.toContain(SECRETS.obs); expect(text.split('\n').filter(Boolean)).toHaveLength(9);
      if (process.platform !== 'win32') expect(statSync(join(dir, 'sub', 'c.log')).mode & 0o077).toBe(0);
      expect(log.tail(100)).toHaveLength(5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('credential stores', () => {
  it('memory store: get / set / delete, unknown names refused', async () => {
    const s = new MemoryCredentialStore();
    expect(await s.get('obs_password')).toBeNull();
    await s.set('obs_password', 'x'); expect(await s.get('obs_password')).toBe('x');
    await s.delete('obs_password'); expect(await s.get('obs_password')).toBeNull();
    await expect(s.get('nope' as never)).rejects.toThrow();
  });

  it('file store: owner-only file in an owner-only folder, atomic writes, loose permissions tightened and reported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-cred-'));
    try {
      const warns: string[] = [];
      const path = join(dir, 'home', 'credentials.json');
      const s = new FileCredentialStore(path, m => warns.push(m));
      await s.set('obs_password', SECRETS.obs); await s.set('controller_code', SECRETS.code);
      expect(await s.get('obs_password')).toBe(SECRETS.obs); expect(await s.get('controller_code')).toBe(SECRETS.code);
      if (process.platform !== 'win32') {
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(statSync(join(dir, 'home')).mode & 0o777).toBe(0o700);
        chmodSync(path, 0o644);
        expect(await s.get('obs_password')).toBe(SECRETS.obs);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(warns.join(' ')).toMatch(/readable by other users/);
      }
      await s.delete('obs_password'); expect(await s.get('obs_password')).toBeNull(); expect(await s.get('controller_code')).toBe(SECRETS.code);
      writeFileSync(path, '{not json'); expect(await s.get('controller_code')).toBeNull();      // a damaged file is just empty
      expect(readdirNoTmp(join(dir, 'home'))).toEqual(['credentials.json']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('layered: writes go to the protected store; the environment only fills gaps and is never written', async () => {
    const primary = new MemoryCredentialStore();
    const s = new LayeredCredentialStore(primary, [new EnvCredentialStore({ BUHURTOS_OBS_PASSWORD: 'from-env' } as never)]);
    expect(await s.get('obs_password')).toBe('from-env');
    await s.set('obs_password', 'stored'); expect(await s.get('obs_password')).toBe('stored');
    expect(await new EnvCredentialStore({} as never).get('controller_code')).toBeNull();
    await expect(new EnvCredentialStore({} as never).set()).rejects.toThrow(/read-only/);
  });

  it('the factory picks the OS store by platform and an override; always with the environment as the weakest fallback', () => {
    expect(createCredentialStore('/x', { platform: 'linux', env: {} as never }).kind).toMatch(/file.*environment/);
    expect(createCredentialStore('/x', { platform: 'win32', env: {} as never }).kind).toMatch(/Windows DPAPI/);
    expect(createCredentialStore('/x', { platform: 'darwin', env: {} as never }).kind).toMatch(/Keychain/);
    expect(createCredentialStore('/x', { platform: 'win32', env: { BUHURTOS_CREDENTIAL_STORE: 'file' } as never }).kind).toMatch(/file/);
  });

  it('Windows DPAPI store: the secret goes in on standard input and is never on a command line; only an encrypted blob is saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-dpapi-'));
    try {
      const calls: Array<{ file: string; args: string[]; stdin: string }> = [];
      const run: Runner = async (file, args, stdin) => { calls.push({ file, args, stdin }); return stdin === SECRETS.obs ? { code: 0, stdout: '01000000d08c9ddf0115d1118c7a00c04fc297eb\r\n' } : { code: 0, stdout: `${SECRETS.obs}\r\n` }; };
      const s = new WindowsDpapiStore(join(dir, 'c.json'), run, 'powershell.exe');
      await s.set('obs_password', SECRETS.obs);
      expect(await s.get('obs_password')).toBe(SECRETS.obs);
      for (const c of calls) { expect(c.file).toBe('powershell.exe'); expect(c.args.join(' ')).not.toContain(SECRETS.obs); }
      expect(calls[0].stdin).toBe(SECRETS.obs);
      expect(readFileSync(join(dir, 'c.json'), 'utf8')).not.toContain(SECRETS.obs);
      expect(await s.get('controller_code')).toBeNull();
      const failing = new WindowsDpapiStore(join(dir, 'd.json'), async () => ({ code: 1, stdout: '' }));
      await expect(failing.set('obs_password', 'x')).rejects.toThrow(/DPAPI/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('macOS Keychain store: commands go on standard input to `security -i`, never in the argument list; quoting is safe', async () => {
    const calls: Array<{ file: string; args: string[]; stdin: string }> = [];
    const run: Runner = async (file, args, stdin) => { calls.push({ file, args, stdin }); return { code: 0, stdout: stdin.startsWith('find') ? 'stored-value\n' : '' }; };
    const s = new MacKeychainStore(run);
    await s.set('obs_password', 'pa"ss\\word');
    expect(await s.get('obs_password')).toBe('stored-value');
    await s.delete('obs_password');
    for (const c of calls) { expect(c.file).toBe('security'); expect(c.args).toEqual(['-i']); }
    expect(calls[0].stdin).toContain('add-generic-password -U -s "BuhurtOS Broadcast Companion" -a "obs_password" -w "pa\\"ss\\\\word"');
    await expect(s.set('obs_password', 'line\nbreak')).rejects.toThrow(/line break/);
    expect(await new MacKeychainStore(async () => ({ code: 44, stdout: '' })).get('obs_password')).toBeNull();
  });
});

const readdirNoTmp = (d: string) => readdirSync(d);

describe('settings and local state files', () => {
  it('parseConfig never throws and falls back to defaults for anything invalid; the OBS host is not configurable', () => {
    for (const junk of [null, undefined, 5, 'x', [], { mapping: 5 }, { audio: [] }, { obsPort: 'a' }, { host: '192.168.0.9', obsHost: 'evil' }]) expect(() => parseConfig(junk)).not.toThrow();
    const c = parseConfig({ obsPort: 70000, uiPort: 4800, supabaseUrl: 'ftp://x', host: '10.0.0.1', mapping: { lysts: { 'Field 1 ': { live: 'A', graphics: 5 }, '': { live: 'x' } }, holding: 'H', cameraOff: 'a'.repeat(300) }, audio: { normalLevelDb: 12, fadeMs: -5, cameraAudioInputs: ['a', 5, 'b'] } });
    expect(c.obsPort).toBe(4455); expect(c.uiPort).toBe(4800); expect(c.supabaseUrl).toBeNull();
    expect(c.mapping.lysts).toEqual({ 'field 1': { live: 'A', graphics: null } });
    expect(c.mapping.holding).toBe('H'); expect(c.mapping.cameraOff).toBeNull();
    expect(c.audio.normalLevelDb).toBe(-14); expect(c.audio.fadeMs).toBe(1000); expect(c.audio.cameraAudioInputs).toEqual(['a', 'b']);
    expect((c as unknown as Record<string, unknown>).host).toBeUndefined();
    expect(parseConfig({ supabaseUrl: 'https://x.supabase.co/' }).supabaseUrl).toBe('https://x.supabase.co');
  });
  it('environment overrides apply, the OBS host cannot be overridden', () => {
    const c = applyEnv(defaultConfig(), { BUHURTOS_SUPABASE_URL: 'http://127.0.0.1:54321/', BUHURTOS_SUPABASE_KEY: 'k', BUHURTOS_EVENT_SLUG: 'rumble', OBS_PORT: '4999', OBS_HOST: 'evil.example', BUHURTOS_UI_PORT: '4888' } as never);
    expect(c).toMatchObject({ supabaseUrl: 'http://127.0.0.1:54321', supabaseKey: 'k', eventSlug: 'rumble', obsPort: 4999, uiPort: 4888 });
  });
  it('parseState keeps the Camera Off latch, the last server answer and the medical lock; junk becomes defaults', () => {
    const s = parseState({ cameraOffLocal: true, cameraOffLocalSince: '2026-10-13T20:00:00Z', lastServerCamera: { active: true, reason: 'medical', rev: 4, at: 'x' }, medicalMusicLock: { since: 'y', controlRev: 3, sawNonAuto: true }, firstLive: { a: 1, b: 'no' }, localManual: { kind: 'lyst', field: 'Field 2' }, localMusic: 'muted' });
    expect(s).toMatchObject({ cameraOffLocal: true, lastServerCamera: { active: true, reason: 'medical', rev: 4 }, medicalMusicLock: { sawNonAuto: true }, firstLive: { a: 1 }, localManual: { kind: 'lyst', field: 'Field 2' }, localMusic: 'muted' });
    expect(parseState(5).cameraOffLocal).toBe(false);
    expect(parseState({ localManual: { kind: 'evil' }, localMusic: 'loud' })).toMatchObject({ localManual: null, localMusic: 'auto' });
  });
  it('files are written owner-only and atomically, survive a restart, and a damaged file does not stop the helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-files-'));
    try {
      const f = new LocalFiles(dir, undefined, {});
      f.updateConfig(c => ({ ...c, eventSlug: 'rumble', mapping: { ...c.mapping, holding: 'Holding' } }));
      f.updateState(s => { s.cameraOffLocal = true; });
      if (process.platform !== 'win32') { expect(statSync(f.configPath).mode & 0o777).toBe(0o600); expect(statSync(f.statePath).mode & 0o777).toBe(0o600); expect(statSync(dir).mode & 0o777).toBe(0o700); }
      const again = new LocalFiles(dir, undefined, {});
      expect(again.config.mapping.holding).toBe('Holding'); expect(again.state.cameraOffLocal).toBe(true);
      expect(readFileSync(f.configPath, 'utf8')).not.toMatch(/password|secret|code/i);
      writeFileSync(f.statePath, '{{{'); writeFileSync(f.configPath, '[]');
      const damaged = new LocalFiles(dir, undefined, {});
      expect(damaged.state.cameraOffLocal).toBe(false); expect(damaged.config.obsPort).toBe(4455);
      writePrivateFile(join(dir, 'x', 'y.json'), '{}'); expect(existsSync(join(dir, 'x', 'y.json'))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
