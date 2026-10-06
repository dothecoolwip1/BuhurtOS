import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStandIn, type StandIn } from '../../../scripts/obs-standin/server.mjs';
import { defaultConfig, LocalFiles, parseConfig, type Config } from '../src/config';
import { Controller, type ControllerOptions } from '../src/controller';
import { MemoryCredentialStore } from '../src/credentials';
import { Logger, Redactor } from '../src/log';
import { ControllerSession } from '../src/session';
import { FakeControl, FakeWorld } from './world';

export const OBS_PASSWORD = 'obs-pass-4f8a1c9e-test';
export const CONTROLLER_CODE = 'K7Q2-M9XD-4TRH';
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await cond()) return; await sleep(15); }
  throw new Error(`timed out waiting for ${what}`);
}

export const MAPPED: Config['mapping'] = {
  lysts: { 'field 1': { live: 'Lyst 1 Live' }, 'field 2': { live: 'Lyst 2 Live' }, 'field 3': { live: 'Lyst 3 Live' } },
  holding: 'Holding', break: 'Break', cameraOff: 'Camera Off'
};

export interface Harness {
  dir: string; standin: StandIn; files: LocalFiles; controller: Controller; world: FakeWorld; control: FakeControl; store: MemoryCredentialStore; session: ControllerSession;
  logger: Logger; logs: string[]; redactor: Redactor;
  /** The Companion's clock (fake, so the 10 s minimum dwell and the 8 s / 25 s result windows can be crossed in a test). */
  clock: { t: number }; advance(ms: number): void;
  /** Replace the controller with a fresh one on the SAME local files and stand-in (a process restart). */
  restartController(): Promise<void>;
  scenes(): string;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  config?: Partial<Config>; audio?: Partial<Config['audio']>; withCode?: boolean; standinPassword?: string; options?: ControllerOptions; startController?: boolean;
  scenes?: string[]; inputs?: unknown[]; program?: string;
}

export async function makeHarness(o: HarnessOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'bos-companion-'));
  const standin = await startStandIn({ password: o.standinPassword ?? OBS_PASSWORD, ...(o.scenes ? { scenes: o.scenes } : {}), ...(o.inputs ? { inputs: o.inputs } : {}), ...(o.program ? { program: o.program } : {}) });
  const redactor = new Redactor();
  const logs: string[] = [];
  const logger = new Logger({ redactor, echo: false, level: 'debug', sink: l => logs.push(`${l.level} ${l.msg}`) });
  const cfg = parseConfig({
    ...defaultConfig(), supabaseUrl: 'http://127.0.0.1:1', supabaseKey: 'publishable-test-key', eventSlug: 'rumble', obsPort: standin.port, uiPort: 0, mapping: MAPPED, ...o.config,
    audio: { musicSource: 'Music', micSource: 'Announcer Mic', duckingFilter: 'Ducking', mediaSource: null, normalLevelDb: -14, fadeMs: 20, ...o.audio }
  });
  const files = new LocalFiles(dir, m => logs.push(`files ${m}`), {});
  files.saveConfig(cfg);
  const store = new MemoryCredentialStore();
  await store.set('obs_password', OBS_PASSWORD);
  if (o.withCode !== false) await store.set('controller_code', CONTROLLER_CODE);
  redactor.add(OBS_PASSWORD); redactor.add(CONTROLLER_CODE);
  const clock = { t: Date.now() };
  const world = new FakeWorld(() => clock.t), control = new FakeControl();
  const fetchFn = (async () => new Response(JSON.stringify({ access_token: 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc', expires_at: Math.floor(Date.now() / 1000) + 600, expires_in: 600, session_secret: 'sess-secret-0123456789-abcdefghijklmnopqrstuv', whoami: { session_id: 's', credential_id: 'c', kind: 'controller', role: 'broadcast_controller', label: 'Stream Laptop', event: { id: 'e', slug: 'rumble', name: 'Rumble', timezone: 'UTC' }, expires_at: new Date(Date.now() + 600_000).toISOString() } }), { status: 200 })) as unknown as typeof fetch;
  const newSession = () => new ControllerSession({ baseUrl: () => 'http://127.0.0.1:1', anonKey: () => 'k', store, logger, fetchFn });
  const session = newSession();
  await session.ensure();
  const options: ControllerOptions = { reconcileMs: 40, heartbeatMs: 100, pollMs: 40, obsBackoffMs: [30, 60, 100], fadeStepMs: 4, verifyProgramMs: 200, sceneRefreshMs: 500, now: () => clock.t, ...o.options };
  const make = () => new Controller({ files: h.files, logger, session: h.session, getObsPassword: () => store.get('obs_password'), data: world, control: o.withCode === false ? null : control, options });
  const h: Harness = {
    dir, standin, files, store, session, world, control, logger, logs, redactor, clock, advance: (ms: number) => { clock.t += ms; },
    controller: null as unknown as Controller,
    async restartController() {
      await h.controller.stop();
      h.files = new LocalFiles(dir, undefined, {});               // a new process reads its settings and its memory from disk
      h.session = newSession(); await h.session.ensure();
      h.controller = make(); h.controller.start();
    },
    scenes: () => standin.state.program ?? '',
    async stop() { await h.controller.stop(); await standin.close(); rmSync(dir, { recursive: true, force: true }); }
  };
  h.controller = make();
  if (o.startController !== false) h.controller.start();
  return h;
}
