// Types for the OBS stand-in (plain JS in scripts/obs-standin). Only what the tests use.
declare module '*obs-standin/server.mjs' {
  export interface StandInState {
    obsVersion: string; scenes: Array<{ name: string; uuid: string }>; program: string | null; studioMode: boolean; streaming: boolean; everStreamStarted: boolean; recording: boolean; everRecordStarted: boolean;
    inputs: Map<string, { uuid: string; kind: string; muted: boolean; volumeDb: number; filters: Array<{ filterName: string; filterKind: string; filterEnabled: boolean; filterSettings: Record<string, unknown> }>; media: { state: string } | null }>;
    dangerousSeen: string[];
  }
  export interface LogEntry { seq: number; at: number; type: string; data?: Record<string, unknown>; session: number; viaBatch: boolean; ok: boolean; code: number }
  export interface StandIn {
    label: string; port: number; url: string; state: StandInState; log: LogEntry[];
    requests(type?: string): LogEntry[]; count(type: string): number; clearLog(): void;
    violations(scope?: { mutable?: string[]; music?: string; filter?: string; media?: string | null } | null): Array<LogEntry & { why: string[] }>;
    identifiedSessions(): number; sessionCount(): number;
    dropConnections(): void; exit(): Promise<void>; start(): Promise<void>; restart(o?: { downMs?: number; resetProgram?: boolean }): Promise<void>;
    addScene(n: string): void; removeScene(n: string): void; setProgramByHand(n: string): void; setStudioMode(on: boolean): void;
    removeInput(n: string): void; addInput(n: string, kind?: string, extra?: Record<string, unknown>): void; removeFilter(source: string, filter: string): void;
    setFilterEnabledByHand(source: string, filter: string, on: boolean): void; setMutedByHand(n: string, muted: boolean): void; setVolumeByHand(n: string, db: number): void;
    setPassword(pw: string, o?: { kick?: boolean }): void; injectMeter(input: string, o?: { db?: number; mul?: number; ms?: number }): void;
    setLatency(ms: number, type?: string | null): void; hangNext(type: string): void; failNext(type: string, code?: number, comment?: string): void; dropResponses(on: boolean): void;
    close(): Promise<void>;
  }
  export const STANDIN_LABEL: string;
  export function startStandIn(o?: { port?: number; password?: string; scenes?: string[]; inputs?: unknown[]; program?: string; obsVersion?: string }): Promise<StandIn>;
}
declare module '*obs-standin/allowlist.mjs' {
  export const ALLOWED_REQUESTS: string[];
  export const DANGEROUS_REQUESTS: string[];
  export const ALLOWED_MEDIA_ACTIONS: string[];
  export function violations(log: unknown[], scope?: unknown): unknown[];
}
