import { appendFileSync, chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The Companion's logger. Nothing secret may ever reach a log line, the log tail in the local screen or the heartbeat: the OBS password, the controller code,
 * the session secret and any token are redacted here, in ONE place, by value (everything registered with `add`) and by shape (a JWT, a Bearer header, a
 * XXXX-XXXX-XXXX code, a long base64url secret) and, for structured data, by key name.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogLine { at: string; level: Level; msg: string }

const MASK = '[hidden]';
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|challenge|salt|api_?key|bearer|controller_?code|session_?secret|^code$|^auth(entication)?$|^key$/i;
// Crockford base32 groups (a device / controller code), a JWT, a Bearer header, and a long run of base64url characters (a session secret, a hash)
const SHAPES: RegExp[] = [
  /(?<![0-9A-Za-z-])[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}(?![0-9A-Za-z-])/gi,   // not inside a UUID
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Za-z0-9_-]{40,}\b/g
];

export class Redactor {
  private values = new Set<string>();
  /** Register a secret value: it is hidden wherever it appears (also without dashes / in lower case, for a code). */
  add(value: string | null | undefined): void {
    if (!value || value.length < 4) return;
    this.values.add(value);
    const bare = value.replace(/[\s-]/g, '');
    if (bare.length >= 8) { this.values.add(bare); this.values.add(bare.toLowerCase()); this.values.add(bare.toUpperCase()); }
    this.values.add(encodeURIComponent(value));
    this.values.add(Buffer.from(value).toString('base64'));
  }
  clear(): void { this.values.clear(); }
  redact(text: string): string {
    let out = text;
    for (const v of [...this.values].sort((a, b) => b.length - a.length)) out = out.split(v).join(MASK);
    for (const re of SHAPES) out = out.replace(re, MASK);
    return out;
  }
  /** Structured data to text, with sensitive keys hidden and the rest redacted as text. Never throws. */
  stringify(data: unknown): string {
    try {
      const seen = new WeakSet<object>();
      const s = JSON.stringify(data, (k, v) => {
        if (k && SENSITIVE_KEY.test(k)) return MASK;
        if (v instanceof Error) return { name: v.name, message: v.message };
        if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[circular]'; seen.add(v); }
        return v;
      });
      return this.redact(s ?? 'undefined');
    } catch { return '[unprintable]'; }
  }
}

export interface LoggerOptions { redactor: Redactor; level?: Level; file?: string | null; echo?: boolean; keep?: number; sink?: (line: LogLine) => void }
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private lines: LogLine[] = [];
  private readonly keep: number;
  private fileReady = false;
  constructor(private readonly o: LoggerOptions) { this.keep = o.keep ?? 400; }
  get redactor(): Redactor { return this.o.redactor; }
  private write(level: Level, msg: string, data?: unknown): void {
    if (ORDER[level] < ORDER[this.o.level ?? 'info']) return;
    const text = this.o.redactor.redact(data === undefined ? msg : `${msg} ${this.o.redactor.stringify(data)}`);
    const line: LogLine = { at: new Date().toISOString(), level, msg: text };
    this.lines.push(line);
    if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
    this.o.sink?.(line);
    if (this.o.echo !== false) (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line.at} ${level.toUpperCase().padEnd(5)} ${line.msg}\n`);
    if (this.o.file) this.toFile(line);
  }
  private toFile(line: LogLine): void {
    try {
      if (!this.fileReady) { mkdirSync(dirname(this.o.file as string), { recursive: true, mode: 0o700 }); closeSync(openSync(this.o.file as string, 'a', 0o600)); try { chmodSync(this.o.file as string, 0o600); } catch { /* not POSIX */ } this.fileReady = true; }
      appendFileSync(this.o.file as string, `${line.at} ${line.level} ${line.msg}\n`);
    } catch { /* a full disk must not stop the stream's helper */ }
  }
  debug(msg: string, data?: unknown): void { this.write('debug', msg, data); }
  info(msg: string, data?: unknown): void { this.write('info', msg, data); }
  warn(msg: string, data?: unknown): void { this.write('warn', msg, data); }
  error(msg: string, data?: unknown): void { this.write('error', msg, data); }
  tail(n = 100): LogLine[] { return this.lines.slice(-n); }
}

export const quietLogger = (): Logger => new Logger({ redactor: new Redactor(), echo: false });
