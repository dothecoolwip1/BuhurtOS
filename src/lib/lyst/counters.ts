/**
 * The counter's phone. A counter taps; the phone shows the count; the server keeps it as PROVISIONAL evidence for the marshal, never as a score.
 * Taps are saved on the device FIRST and sent in order, each with its own id, so a lost signal, a double send or a refresh can neither lose a tap nor count it twice.
 * Pure: storage and sending are injected.
 */
export const JOIN_CODE_LENGTH = 10;

/** Accepts the bare code, a pasted link, or text with spaces/dashes. Returns the canonical code or null. */
export function parseJoinCode(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const fromLink = /\/lyst\/(?:join|train)\/([A-Za-z0-9-]+)/.exec(raw)?.[1];
  const code = (fromLink ?? raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === JOIN_CODE_LENGTH ? code : null;
}

/** The address the TRAINING QR carries (Pack 25: the Lyst's join code is for trainees; real counters use the event's Counter QR). `base` is the app's base path. */
export function trainingUrl(origin: string, base: string, code: string): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${b}lyst/train/${code}`;
}

/** Pack 29: what a line marshal tapped on their Outrance sheet (p.25), and for which fighter. A side counter's actions never carry a mark. */
export type Mark = 'strike' | 'takedown' | 'weapon_loss' | 'armour_failure';
export interface CountContext { runId?: string; matchId?: string; recovery?: boolean; recordedAt?: string; undoWeight?: number; operator?:string; side?:string; fighter?:string; opponent?:string; correction?: { id: string; from: number; to: number }; mark?: Mark; markSide?: 'a' | 'b' }
export type CountAction = ({ kind: 'tap'; id: string; weight: number; round: number } | { kind: 'undo'; id: string; round: number }) & CountContext;

/** Reported action metadata is untrusted, including when read back from the server. */
export function readCounterCorrection(value: unknown): NonNullable<CountContext['correction']> | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  return typeof c.id==='string' && c.id.length>0 && c.id.length<=100 && Number.isSafeInteger(c.from) && Number(c.from)>=0 && Number.isSafeInteger(c.to) && Number(c.to)>=0 && Number(c.to)<=1000
    ? {id:c.id,from:Number(c.from),to:Number(c.to)} : null;
}

/** One pending item per tap: the id is created when the finger lands, so the same tap is never sent under two ids. */
export class TapQueue {
  private items: CountAction[] = [];
  constructor(private newId: () => string = () => crypto.randomUUID()) {}
  get pending(): readonly CountAction[] { return this.items; }
  get size(): number { return this.items.length; }
  tap(round: number, weight = 1): CountAction { const a: CountAction = { kind: 'tap', id: this.newId(), weight, round }; this.items.push(a); return a; }
  undo(round: number): CountAction { const a: CountAction = { kind: 'undo', id: this.newId(), round }; this.items.push(a); return a; }
  /** Items for a round that is no longer the live one can never be accepted: keep them out of the way (the phone says so). */
  dropRound(round: number): CountAction[] { const gone = this.items.filter(i => i.round === round); this.items = this.items.filter(i => i.round !== round); return gone; }
  /** Called when the server accepted (or recognised as already counted) the head item. */
  shift(id: string): void { if (this.items[0]?.id === id) this.items.shift(); else this.items = this.items.filter(i => i.id !== id); }
  /** The tally the phone shows right now: what the server last confirmed plus what is still waiting, so every tap answers at once. */
  display(serverTotal: number, round: number): number {
    let n = serverTotal;
    const live = this.items.filter(i => i.round === round);
    for (const i of live) n = i.kind === 'tap' ? n + i.weight : Math.max(0, n - 1);
    return n;
  }
  load(items: readonly CountAction[]): void { this.items = [...items]; }
}

export type CounterSend = (a: CountAction) => Promise<{ status: 'ok' | 'duplicate' | 'nothing'; total: number; weights?: number[]; outrance?: unknown } | { status: 'review'; total: number; message: string; alreadyAccepted?:boolean } | { status: 'refused'; reason: 'ROUND_ENDED' | 'ROUND_CHANGED' | 'ROUND_NOT_STARTED' | 'OTHER'; message: string } | { status: 'offline' }>;

/** Send the queue in order until it is empty, the signal is gone, or the server refuses (a round that has ended can never take a tap again). */
export async function flushTaps(q: TapQueue, send: CounterSend): Promise<{ sent: number; total: number | null; stopped: 'empty' | 'offline' | 'refused'; refusal?: string }> {
  let sent = 0, total: number | null = null;
  while (q.size > 0) {
    const head = q.pending[0];
    let r: Awaited<ReturnType<CounterSend>>;
    try { r = await send(head); } catch { return { sent, total, stopped: 'offline' }; }
    if (r.status === 'offline') return { sent, total, stopped: 'offline' };
    if (r.status === 'review') return { sent, total, stopped: 'refused', refusal: r.message };
    if (r.status === 'refused') {
      // the round moved on or ended: nothing waiting for that round can ever count
      q.dropRound(head.round);
      return { sent, total, stopped: 'refused', refusal: r.message };
    }
    total = r.total; q.shift(head.id); sent += 1;
  }
  return { sent, total, stopped: 'empty' };
}

export const SIDE_LABEL = { a: 'Red', b: 'Blue' } as const;
/** The two sides of a fight as the event names and colours them (the flag colours of the day). Pack 25.2: chosen by whoever runs the Lyst. */
export interface SideSpec { name: string; color: string }
export interface EventSides { a: SideSpec; b: SideSpec }
export const DEFAULT_SIDES: EventSides = { a: { name: 'Red', color: '#B42318' }, b: { name: 'Blue', color: '#2C4A8C' } };
/** The usual flag colours, one tap each; a custom colour is always possible too. */
export const SIDE_PRESETS: readonly SideSpec[] = [
  { name: 'Red', color: '#B42318' }, { name: 'Blue', color: '#2C4A8C' }, { name: 'Yellow', color: '#F2B233' }, { name: 'Green', color: '#1B7F3B' },
  { name: 'White', color: '#F4F4F2' }, { name: 'Black', color: '#111111' }, { name: 'Orange', color: '#E0661A' }, { name: 'Purple', color: '#6A3BA3' }
];
/** What the server stores may hold one side only, or nothing: fill the rest from the defaults. */
export function mergeSides(partial: { a?: Partial<SideSpec> | null; b?: Partial<SideSpec> | null } | null | undefined): EventSides {
  return { a: { ...DEFAULT_SIDES.a, ...(partial?.a ?? {}) }, b: { ...DEFAULT_SIDES.b, ...(partial?.b ?? {}) } };
}
/** A phone's position on the Lyst: a side (Red / Blue counter) or, for a Profight, a line marshal who scores both fighters (Outrance §2.3). */
export type Position = 'a' | 'b' | 'm';
export const LINE_MARSHAL = 'Line marshal';
export const sideLabel = (side: Position | null | undefined, sides?: EventSides | null): string => (side === 'm' ? LINE_MARSHAL : side ? (sides ?? DEFAULT_SIDES)[side].name : 'Side');
/** Black or white text, whichever reads on the colour (yellow and white flags need dark ink). */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.4 ? '#111111' : '#ffffff';
}
/** CSS variables for a screen that shows the two sides: `--side-a`, `--side-a-ink`, `--side-b`, `--side-b-ink`. */
export function sideVars(sides: EventSides | null | undefined): Record<string, string> {
  const s = sides ?? DEFAULT_SIDES;
  return { '--side-a': s.a.color, '--side-a-ink': inkFor(s.a.color), '--side-b': s.b.color, '--side-b-ink': inkFor(s.b.color) };
}
/** The words a counter needs: what to do next, in every situation the phone can be in. */
export function counterBanner(state: {
  seat: { status: string; role?: string; side?: Position | null } | null; can_count?: boolean; final?: boolean; waiting?: boolean;
  round?: { status: string } | null; counter_input?: string; binding?: { field_key?: string | null; side?: Position | null } | null;
  outrance?: { position: 'ok' | 'wrong'; need?: 'side' | 'line_marshal'; sheet?: unknown } | null;
}, sides?: EventSides | null): string {
  if (!state.seat) {
    if (state.binding?.field_key && !state.binding.side) return `Choose ${sideLabel('a', sides)} or ${sideLabel('b', sides)}.`;
    return 'Choose your Lyst and side.';
  }
  if (state.seat.status === 'expired') return 'This phone\'s place on the Lyst has run out. Choose your Lyst and side again.';
  if (state.seat.status === 'ended' || state.seat.status === 'declined') return 'You are not counting right now. Choose your Lyst and side.';
  if (state.waiting) return 'Waiting for the next fight on this Lyst. It opens here by itself.';
  if (state.outrance?.position === 'wrong') return state.outrance.need === 'line_marshal'
    ? 'This fight is a Profight: it is scored by line marshals. Switch this phone to Line marshal.'
    : `This fight is not a Profight: choose ${sideLabel('a', sides)} or ${sideLabel('b', sides)} to count it.`;
  if (state.final) return 'This fight is finished. The next one opens here by itself.';
  if (!state.round) return 'Waiting for the round to start.';
  if (state.round.status === 'confirming') return 'Round over. The marshal is confirming the score.';
  if (state.round.status === 'confirmed') return 'Round confirmed. Wait for the next round.';
  if (state.outrance?.position === 'ok' && state.outrance.sheet) return 'Your sheet for this round is handed in. Wait for the next round.';
  if (!state.can_count) return 'Waiting for the round to start.';
  if (state.outrance?.position === 'ok') return 'Tap for every clean legal strike by each fighter. Head strikes do not count.';
  return state.counter_input === 'standing' ? 'Tap FIGHTER DOWN each time one of your side goes down.' : 'Tap COUNT for every valid strike.';
}

/** The three lines a counter sees under the fight: "Last fight", "Now fighting", "Next fight". A finished fight carries its official score. */
export function fightLine(f: { a: string | null; b: string | null; result?: string | null; score_a?: number | null; score_b?: number | null } | null | undefined): string | null {
  if (!f) return null;
  const names = `${f.a ?? 'Fighter'} vs ${f.b ?? 'Fighter'}`;
  if (f.score_a == null || f.score_b == null) return names;
  const score = `${f.score_a}-${f.score_b}`;
  return f.result === 'draw' ? `${names} · ${score} draw` : f.result === 'a' || f.result === 'b' ? `${names} · ${score} to ${f.result === 'a' ? f.a ?? 'Red' : f.b ?? 'Blue'}` : `${names} · ${score}`;
}

/** One tap per valid strike, or two buttons (+2 head/torso, +1 limbs) where the ruleset scores that way; group fights count fighters standing. 'auto' follows the category. */
export function counterInputFor(category: string, setting: 'auto' | 'simple' | 'weighted' | undefined, league?: string): 'simple' | 'weighted' | 'standing' {
  if (league === 'buhurt' || /^\d+v\d+$/.test(category)) return 'standing';
  if (setting === 'simple' || setting === 'weighted') return setting;
  return category === 'sword_shield' || category === 'longsword' ? 'weighted' : 'simple';
}

/** The phone's first-run steps: who, which Lyst (only when there is more than one), which side. Returns the step that still needs an answer. */
export type CounterStep = 'operator' | 'field' | 'side' | 'count';
export function nextStep(b: { operator?: string | null; field_key?: string | null; side?: Position | null } | null | undefined, fields: readonly { key: string }[]): CounterStep {
  if (!b?.operator) return 'operator';
  if (!b.field_key) return fields.length === 1 ? 'side' : 'field';
  if (!b.side) return 'side';
  return 'count';
}
/** With exactly one field there is nothing to choose: that field. */
export const onlyField = (fields: readonly { key: string }[]): string | null => (fields.length === 1 ? fields[0].key : null);
/** What the standing counter shows: fighters still up on this side (bounded at zero). */
export const standingLeft = (perSide: number | null | undefined, downs: number): number => Math.max(0, (perSide ?? 0) - downs);
