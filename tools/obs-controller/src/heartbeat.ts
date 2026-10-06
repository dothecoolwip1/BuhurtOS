import type { AlsoLive, MappingProblem } from '../../../src/lib/broadcast/decide';

/**
 * The status report the Companion sends to BuhurtOS every 5 seconds (broadcast_controller_heartbeat). What it contains is deliberately small:
 * no password, code, token, secret, raw audio level, scene LIST or file path. Scene names are not sent either; the on-air scene is named because the
 * Command Centre shows it. At most 4 KB (the database refuses more), so lists are trimmed rather than the report dropped.
 */
export interface HeartbeatInput {
  obsConnected: boolean; obsVersion: string | null; obsProblem: string | null;
  mode: 'auto' | 'manual'; modeSource: 'server' | 'local' | 'camera_off' | 'none';
  onAir: { kind: string; field: string | null; scene: string | null; reason: string };
  fight: { field: string; mode: string; summary: string | null } | null;
  cameraOff: boolean; cameraOffLocal: boolean; cameraOffSource: string | null;
  alsoLive: AlsoLive[]; problems: MappingProblem[];
  music: { state: 'on' | 'muted' | 'paused' | 'unknown' | 'none'; ducking: 'on' | 'off' | 'missing' | 'unset'; mic: 'speaking' | 'quiet' | 'missing' | 'unknown' | 'unset'; locked: boolean };
  controllerVersion: string; stale: boolean; staleSeconds: number | null;
}

export const HEARTBEAT_MAX_BYTES = 4096;
const cut = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildHeartbeat(i: HeartbeatInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    obs_connected: i.obsConnected, obs_version: cut(i.obsVersion, 20), obs_problem: cut(i.obsProblem, 120),
    mode: i.mode, mode_source: i.modeSource,
    on_air: { kind: i.onAir.kind, field: i.onAir.field, scene: cut(i.onAir.scene, 60), reason: cut(i.onAir.reason, 120) },
    fight: i.fight ? { field: i.fight.field, mode: i.fight.mode, summary: cut(i.fight.summary, 80) } : null,
    camera_off: i.cameraOff, camera_off_local: i.cameraOffLocal, camera_off_source: i.cameraOffSource,
    also_live: i.alsoLive.slice(0, 6).map(a => ({ field: a.field, label: cut(a.label, 24), mapped: a.mapped })),
    mapping_problems: i.problems.slice(0, 10).map(p => ({ code: p.code, field: p.field ?? null, text: cut(p.text, 110) })),
    music: { state: i.music.state, ducking: i.music.ducking, mic: i.music.mic, locked: i.music.locked },
    controller_version: i.controllerVersion, stale: i.stale, stale_seconds: i.staleSeconds
  };
  // belt and braces: shrink the lists until it fits (it never should come close)
  for (const key of ['mapping_problems', 'also_live'] as const) {
    while (Buffer.byteLength(JSON.stringify(body)) > HEARTBEAT_MAX_BYTES - 64 && (body[key] as unknown[]).length > 0) (body[key] as unknown[]).pop();
  }
  return body;
}
