import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Where the Companion keeps the three secrets it must remember. They live ONLY on this laptop, protected by the operating system where it can:
 *   - Windows: DPAPI (bound to this Windows user) through PowerShell; the value goes in on standard input, never on a command line.
 *   - macOS: the login Keychain through `security -i` (commands on standard input, so the value is not in the process list).
 *   - anywhere else (and as the fallback): a file only this user can read (mode 0600, in a 0700 folder).
 *   - environment variables are read-only and the weakest option: used only when nothing else has the value.
 * They are never put in Supabase, a URL, a log, the heartbeat or the local screen.
 */
export type CredentialName = 'obs_password' | 'controller_code' | 'session_secret';
export const CREDENTIAL_NAMES: readonly CredentialName[] = ['obs_password', 'controller_code', 'session_secret'];

export interface CredentialStore {
  readonly kind: string;
  get(name: CredentialName): Promise<string | null>;
  set(name: CredentialName, value: string): Promise<void>;
  delete(name: CredentialName): Promise<void>;
}

const cleanName = (name: string): CredentialName => { if (!(CREDENTIAL_NAMES as readonly string[]).includes(name)) throw new Error('unknown credential'); return name as CredentialName; };

/** For tests: nothing leaves the process. */
export class MemoryCredentialStore implements CredentialStore {
  readonly kind = 'memory';
  private m = new Map<CredentialName, string>();
  async get(name: CredentialName) { return this.m.get(cleanName(name)) ?? null; }
  async set(name: CredentialName, value: string) { this.m.set(cleanName(name), value); }
  async delete(name: CredentialName) { this.m.delete(cleanName(name)); }
}

/** Write a file atomically with owner-only permission (a temp file next to it, then rename). */
export function writePrivateFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(path), 0o700); } catch { /* not POSIX */ }
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* not POSIX */ }
  renameSync(tmp, path);
}

/** True when someone other than the owner could read the file (always false where permission bits do not apply). */
export function isOpenToOthers(path: string): boolean {
  if (process.platform === 'win32') return false;
  try { return (statSync(path).mode & 0o077) !== 0; } catch { return false; }
}

/** The fallback: a JSON file, mode 0600. Refuses to trust a file other users can read (it tightens it, and says so through `onWarn`). */
export class FileCredentialStore implements CredentialStore {
  readonly kind = 'file (owner-only)';
  constructor(private readonly path: string, private readonly onWarn: (msg: string) => void = () => undefined) {}
  private read(): Partial<Record<CredentialName, string>> {
    if (!existsSync(this.path)) return {};
    if (isOpenToOthers(this.path)) { try { chmodSync(this.path, 0o600); this.onWarn('The credentials file was readable by other users; it has been made owner-only.'); } catch { this.onWarn('The credentials file is readable by other users and could not be tightened.'); } }
    try { const v = JSON.parse(readFileSync(this.path, 'utf8')) as unknown; return v && typeof v === 'object' ? (v as Partial<Record<CredentialName, string>>) : {}; } catch { return {}; }
  }
  async get(name: CredentialName) { const v = this.read()[cleanName(name)]; return typeof v === 'string' && v ? v : null; }
  async set(name: CredentialName, value: string) { const all = this.read(); all[cleanName(name)] = value; writePrivateFile(this.path, JSON.stringify(all)); }
  async delete(name: CredentialName) { const all = this.read(); delete all[cleanName(name)]; writePrivateFile(this.path, JSON.stringify(all)); }
}

/** Runs a program with text on standard input. Injected so tests can prove what is (and is not) passed on a command line. */
export type Runner = (file: string, args: string[], stdin: string) => Promise<{ code: number; stdout: string }>;
export const defaultRunner: Runner = (file, args, stdin) => new Promise(resolve => {
  const child = execFile(file, args, { timeout: 20_000, windowsHide: true, maxBuffer: 1_000_000 }, (err, stdout) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, stdout: String(stdout ?? '') }));
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(stdin);
});

/** Windows DPAPI: the stored text is an encrypted blob only this Windows user can decrypt. */
export class WindowsDpapiStore implements CredentialStore {
  readonly kind = 'Windows DPAPI';
  constructor(private readonly path: string, private readonly run: Runner = defaultRunner, private readonly powershell = 'powershell.exe') {}
  private blobs(): Partial<Record<CredentialName, string>> { try { const v = JSON.parse(readFileSync(this.path, 'utf8')) as unknown; return v && typeof v === 'object' ? (v as Partial<Record<CredentialName, string>>) : {}; } catch { return {}; } }
  private ps(script: string, stdin: string) { return this.run(this.powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], stdin); }
  async get(name: CredentialName) {
    const blob = this.blobs()[cleanName(name)];
    if (!blob) return null;
    const r = await this.ps('$b=[Console]::In.ReadToEnd().Trim(); $s=ConvertTo-SecureString $b; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', blob);
    const v = r.stdout.replace(/\r?\n$/, '');
    return r.code === 0 && v ? v : null;
  }
  async set(name: CredentialName, value: string) {
    const r = await this.ps('$v=[Console]::In.ReadToEnd(); ConvertTo-SecureString $v -AsPlainText -Force | ConvertFrom-SecureString', value);
    const blob = r.stdout.trim();
    if (r.code !== 0 || !blob) throw new Error('Windows could not protect the value (DPAPI)');
    const all = this.blobs(); all[cleanName(name)] = blob; writePrivateFile(this.path, JSON.stringify(all));
  }
  async delete(name: CredentialName) { const all = this.blobs(); delete all[cleanName(name)]; writePrivateFile(this.path, JSON.stringify(all)); }
}

/** macOS login Keychain. `security -i` reads its commands from standard input, so a value never appears in `ps`. */
export class MacKeychainStore implements CredentialStore {
  readonly kind = 'macOS Keychain';
  constructor(private readonly run: Runner = defaultRunner, private readonly service = 'BuhurtOS Broadcast Companion') {}
  private quote(s: string): string { return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
  async get(name: CredentialName) {
    const r = await this.run('security', ['-i'], `find-generic-password -s ${this.quote(this.service)} -a ${this.quote(cleanName(name))} -w\n`);
    const v = r.stdout.replace(/\r?\n$/, '');
    return r.code === 0 && v ? v : null;
  }
  async set(name: CredentialName, value: string) {
    if (/[\r\n]/.test(value)) throw new Error('a credential cannot contain a line break');
    const r = await this.run('security', ['-i'], `add-generic-password -U -s ${this.quote(this.service)} -a ${this.quote(cleanName(name))} -w ${this.quote(value)}\n`);
    if (r.code !== 0) throw new Error('the Keychain would not store the value');
  }
  async delete(name: CredentialName) { await this.run('security', ['-i'], `delete-generic-password -s ${this.quote(this.service)} -a ${this.quote(cleanName(name))}\n`); }
}

/** Layered: writes go to the first (protected) store; reads fall back through the list, so the weakest source (environment) only fills gaps. */
export class LayeredCredentialStore implements CredentialStore {
  constructor(private readonly primary: CredentialStore, private readonly fallbacks: CredentialStore[] = []) {}
  get kind() { return this.primary.kind + (this.fallbacks.length ? ` + ${this.fallbacks.map(f => f.kind).join(', ')}` : ''); }
  async get(name: CredentialName) { for (const s of [this.primary, ...this.fallbacks]) { try { const v = await s.get(name); if (v) return v; } catch { /* try the next */ } } return null; }
  set(name: CredentialName, value: string) { return this.primary.set(name, value); }
  delete(name: CredentialName) { return this.primary.delete(name); }
}

/** Environment variables: read-only. BUHURTOS_OBS_PASSWORD, BUHURTOS_CONTROLLER_CODE. */
export class EnvCredentialStore implements CredentialStore {
  readonly kind = 'environment (weakest)';
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async get(name: CredentialName) {
    const v = name === 'obs_password' ? this.env.BUHURTOS_OBS_PASSWORD : name === 'controller_code' ? this.env.BUHURTOS_CONTROLLER_CODE : undefined;
    return v ? v : null;
  }
  async set(): Promise<void> { throw new Error('environment credentials are read-only'); }
  async delete(): Promise<void> { /* nothing to delete */ }
}

export function createCredentialStore(home: string, o: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; run?: Runner; onWarn?: (m: string) => void } = {}): CredentialStore {
  const platform = o.platform ?? process.platform, env = o.env ?? process.env;
  const choice = (env.BUHURTOS_CREDENTIAL_STORE ?? '').toLowerCase();
  const filePath = join(home, 'credentials.json');
  const file = () => new FileCredentialStore(filePath, o.onWarn);
  let primary: CredentialStore;
  if (choice === 'file') primary = file();
  else if (choice === 'dpapi' || (!choice && platform === 'win32')) primary = new WindowsDpapiStore(join(home, 'credentials.dpapi.json'), o.run);
  else if (choice === 'keychain' || (!choice && platform === 'darwin')) primary = new MacKeychainStore(o.run);
  else primary = file();
  return new LayeredCredentialStore(primary, [new EnvCredentialStore(env)]);
}
