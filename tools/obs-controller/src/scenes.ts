import { arenaFields, buildArena, pickField } from '../../../src/lib/arena';
import { fieldKey } from '../../../src/lib/eventDay';
import { broadcastScene, type Scene } from '../../../src/lib/broadcast/state';
import { phaseOf, type FieldInput } from '../../../src/lib/broadcast/decide';
import type { CompetitionMatch } from '../../../src/data/matches';
import type { LiveScore } from '../../../src/data/liveScores';
import type { LystPublic } from '../../../src/data/lyst';

/**
 * Public data -> one Pack 14 scene per field -> the small input the AUTO decision needs. This is the SAME derivation the overlay uses (buildArena then
 * broadcastScene, from src/lib/arena.ts and src/lib/broadcast/state.ts); nothing here re-derives what a fight is doing.
 */
export interface RawPublic {
  event: { id: string; slug: string; name: string; startsOn: string; endsOn: string; fieldCount?: number | null };
  competitions: Array<{ id: string; name: string; sort?: number }>;
  matches: CompetitionMatch[];
  scores: LiveScore[];
  lyst: LystPublic[];
}

export interface FieldMemory {
  /** When each field was first seen armed (so armed fields can be ordered). */
  armedSince: Map<string, number>;
  /** Fight id -> first-live time as the DATABASE reported it (durable). */
  durableFirstLive: Map<string, number>;
  /** Fight id -> first time this process saw it live (used only until the database value is known). */
  observedFirstLive: Map<string, number>;
  /** The phase each field was in last time, to notice a new arming. */
  lastPhase: Map<string, string>;
}
export const newFieldMemory = (): FieldMemory => ({ armedSince: new Map(), durableFirstLive: new Map(), observedFirstLive: new Map(), lastPhase: new Map() });

const titleOf = (key: string): string => key.replace(/\b\w/g, c => c.toUpperCase());

/** Every field to consider: those with fights, those the operator mapped, and the event's own count of fields (Field 1..N). */
export function fieldNames(raw: RawPublic, mappedKeys: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const n of arenaFields(raw.matches)) names.set(fieldKey(n), n);
  for (const k of mappedKeys) if (!names.has(fieldKey(k))) names.set(fieldKey(k), titleOf(fieldKey(k)));
  const count = Math.min(Math.max(raw.event.fieldCount ?? 0, 0), 24);
  for (let i = 1; i <= count; i++) { const n = `Field ${i}`; if (!names.has(fieldKey(n))) names.set(fieldKey(n), n); }
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export interface BuiltField { input: FieldInput; scene: Scene }

export function buildFields(raw: RawPublic, o: { nowMs: number; serverNowMs: number; mappedKeys: readonly string[]; memory: FieldMemory; phase: 'past' | 'upcoming' | 'current' }): BuiltField[] {
  const out: BuiltField[] = [];
  const names = fieldNames(raw, o.mappedKeys);
  for (const name of names) {
    const field = pickField(names, name);
    const view = buildArena({ matches: raw.matches, scores: raw.scores, competitions: raw.competitions, field, now: o.nowMs, lyst: raw.lyst });
    const scene = broadcastScene(view, { phase: o.phase, nowMs: o.serverNowMs });
    const key = fieldKey(field);
    const phase = phaseOf(scene.mode);
    const fightId = scene.fight?.id ?? null;
    const mem = o.memory;

    let firstLiveMs: number | null = null;
    if (phase === 'fightLive' && fightId) {
      const durable = mem.durableFirstLive.get(fightId);
      if (durable !== undefined) firstLiveMs = durable;
      else {
        if (!mem.observedFirstLive.has(fightId)) mem.observedFirstLive.set(fightId, o.nowMs);
        firstLiveMs = mem.observedFirstLive.get(fightId) ?? null;
      }
    }
    // when did this field first become armed (for ordering armed fields)
    if (phase === 'armed') { if (mem.lastPhase.get(key) !== 'armed' || !mem.armedSince.has(key)) mem.armedSince.set(key, o.nowMs); }
    else mem.armedSince.delete(key);
    mem.lastPhase.set(key, phase);

    const f = scene.fight;
    const summary = f ? `${f.a.name} vs ${f.b.name}${scene.round ? `, round ${scene.round}` : ''}` : null;
    out.push({ scene, input: { field: key, label: view.field, mode: scene.mode, fightId, summary, firstLiveMs, armedSinceMs: phase === 'armed' ? mem.armedSince.get(key) ?? null : null } });
  }
  return out;
}

/** The fights that are in progress and whose first-live time the database has not told us yet. */
export const fightsNeedingFirstLive = (built: readonly BuiltField[], memory: FieldMemory): string[] =>
  built.filter(b => phaseOf(b.scene.mode) === 'fightLive' && b.scene.fight && !memory.durableFirstLive.has(b.scene.fight.id)).map(b => (b.scene.fight as { id: string }).id);
