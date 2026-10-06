import { join } from 'node:path';
import { companionHome, LocalFiles } from './config';
import { Controller } from './controller';
import { createCredentialStore } from './credentials';
import { realControlSource, realPublicData } from './datasource';
import { Logger, Redactor } from './log';
import { ControllerSession } from './session';
import { configureSupabase } from './shim/supabase';
import { startUi } from './ui/server';
import { COMPANION_VERSION } from './version';

/**
 * BuhurtOS Broadcast Companion: a small local process beside OBS. It follows the real fight (from the same public data the overlay reads) and puts the
 * right OBS scene on air; it applies Camera Off the instant it is asked; it keeps the music sensible. It never starts or stops the stream.
 * Exit code 64 = a person chose Quit (the restart script then stops); anything else = a crash (the restart script starts it again).
 */
async function main(): Promise<void> {
  const home = companionHome();
  const redactor = new Redactor();
  const logger = new Logger({ redactor, file: join(home, 'companion.log'), level: process.env.BUHURTOS_LOG_LEVEL === 'debug' ? 'debug' : 'info' });
  logger.info(`BuhurtOS Broadcast Companion ${COMPANION_VERSION} starting`, { home });
  const files = new LocalFiles(home, m => logger.warn(m));
  const store = createCredentialStore(home, { onWarn: m => logger.warn(m) });
  logger.info(`credentials are kept in: ${store.kind}`);
  for (const n of ['obs_password', 'controller_code', 'session_secret'] as const) redactor.add(await store.get(n).catch(() => null));

  const cfg = files.config;
  if (cfg.supabaseUrl && cfg.supabaseKey) {
    const session: ControllerSession = new ControllerSession({ baseUrl: () => files.config.supabaseUrl, anonKey: () => files.config.supabaseKey, store, logger });
    configureSupabase({ url: cfg.supabaseUrl, key: cfg.supabaseKey, getToken: () => session.getToken() });
    await run(files, store, logger, session, true);
  } else {
    logger.warn('BuhurtOS address and key are not set yet: open the local screen to set them (OBS control still works for Camera Off and scene tests)');
    const session = new ControllerSession({ baseUrl: () => files.config.supabaseUrl, anonKey: () => files.config.supabaseKey, store, logger });
    await run(files, store, logger, session, false);
  }
}

async function run(files: LocalFiles, store: ReturnType<typeof createCredentialStore>, logger: Logger, session: ControllerSession, configured: boolean): Promise<void> {
  const controller = new Controller({
    files, logger, session, getObsPassword: () => store.get('obs_password'),
    data: configured ? realPublicData : unconfigured, control: configured ? realControlSource : null
  });
  let ui: Awaited<ReturnType<typeof startUi>> | null = null;
  const quit = async (code: number) => {
    logger.info('shutting down');
    await controller.stop().catch(() => undefined);
    await ui?.close().catch(() => undefined);
    process.exit(code);
  };
  ui = await startUi({
    controller, session, store, logger,
    saveConfig: f => files.updateConfig(f),
    onQuit: () => { void quit(64); }
  }, files.config.uiPort);
  logger.info(`local screen: http://127.0.0.1:${ui.port}`);
  controller.start();
  process.on('SIGINT', () => { void quit(0); });
  process.on('SIGTERM', () => { void quit(0); });
  // a bug must never leave a half-working helper: exit, and the restart script brings it back with the state it saved
  process.on('uncaughtException', e => { logger.error('unexpected error: restarting', { message: e.message }); void quit(1); });
  process.on('unhandledRejection', e => { logger.error('unexpected error: restarting', { message: String((e as Error)?.message ?? e) }); void quit(1); });
}

const unconfigured = {
  fetchEvent: async () => { throw new Error('BuhurtOS address is not set'); },
  fetchCompetition: async () => { throw new Error('BuhurtOS address is not set'); },
  fetchLyst: async () => { throw new Error('BuhurtOS address is not set'); },
  fetchFirstRounds: async () => { throw new Error('BuhurtOS address is not set'); }
};

main().catch(e => { process.stderr.write(`could not start: ${(e as Error).message}\n`); process.exit(1); });
