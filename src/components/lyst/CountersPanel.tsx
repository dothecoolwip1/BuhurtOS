import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Dialog } from '../Dialog';
import { setEventSides, type LystSeat, type LystState } from '../../data/lyst';
import { CounterQrCard } from '../command/CounterQrCard';
import { DEFAULT_SIDES, SIDE_PRESETS, inkFor, mergeSides, sideLabel, trainingUrl, type EventSides, type SideSpec } from '../../lib/lyst/counters';
import { friendlyError } from '../../lib/friendlyError';

function Qr({ value, label }: { value: string; label: string }) {
  const svg = useMemo(() => {
    try { const q = qrcode(0, 'M'); q.addData(value); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { return ''; }
  }, [value]);
  // the markup comes from the QR library for OUR url only
  return <div className="ly-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The counters on this fight as EVIDENCE: operator, side, tally, online, done. Official phones and trainees are listed apart. Never a combined number. */
export function CounterEvidence({ seats, names, round, compact = false, sides }: { seats: readonly LystSeat[]; names: { a: string; b: string }; round: number; compact?: boolean; sides?: EventSides | null }) {
  const tally = (s: LystSeat) => s.tallies.find(t => t.round_no === round);
  const row = (s: LystSeat) => {
    const t = tally(s);
    return (
      <li key={s.id} className={`ly-seat ly-seat-${s.side ?? 'none'}${s.role === 'learning' ? ' is-learning' : ''}`} data-testid="counter-row" data-side={s.side ?? ''} data-role={s.role}>
        <span className={`ly-corner ly-corner-${s.side ?? 'none'}`}>{s.side ? sideLabel(s.side, sides) : '–'}</span>
        <span className="ly-seat-main"><b>{s.name}</b>{!compact && <span className="src">{s.side ? (s.side === 'a' ? names.a : names.b) : 'no side yet'}{s.role === 'learning' ? ' · training' : ''}</span>}</span>
        <span className="ly-seat-n mono" aria-label={`Round ${round} count ${t?.total ?? 0}${t?.submitted ? ', done' : ''}`}>{t?.total ?? 0}{t?.submitted ? ' ✓' : ''}</span>
        <span className={`ly-online${s.device ? (s.online ? ' is-on' : ' is-off') : ''}`}>{s.device ? (s.online ? 'online' : 'offline') : 'own phone'}</span>
      </li>
    );
  };
  const official = seats.filter(s => s.role === 'official' && s.status === 'active');
  const learning = seats.filter(s => s.role === 'learning' && s.status === 'active');
  const bySide = (side: 'a' | 'b') => official.filter(s => s.side === side);
  return (
    <div className="ly-evidence">
      {(['a', 'b'] as const).map(side => (
        <div key={side} className="ly-evidence-side">
          <b className={`ly-corner-h ly-corner-h-${side}`}>{sideLabel(side, sides)} · {names[side]}</b>
          {bySide(side).length === 0 ? <p className="src">No counter on {sideLabel(side, sides).toLowerCase()}.</p> : <ul className="ly-list">{bySide(side).map(row)}</ul>}
        </div>
      ))}
      {learning.length > 0 && <div className="ly-evidence-side"><b className="ly-corner-h">Training (never official)</b><ul className="ly-list">{learning.map(row)}</ul></div>}
    </div>
  );
}

/**
 * The Lyst's counters sheet (Pack 25). What the operator needs: who is counting which side, each tally, online or not, done or not. The two ways
 * onto a counter: the event's one COUNTER QR (a phone scans it once, picks this Lyst and a side, and follows the fights here by itself) and this
 * field's TRAINING QR (a trainee's own phone; learning only). Nothing here seats, approves, assigns a fighter or carries anyone: the phones do that themselves.
 */
export function CountersPanel({ state, names, round, eventId, fieldName, busy, onNewTrainingCode, onClose, sides, onSidesSaved }: {
  state: LystState; names: { a: string; b: string }; round: number; eventId: string; fieldName: string; busy: boolean;
  onNewTrainingCode: () => void; onClose: () => void; sides?: EventSides | null; onSidesSaved?: () => void;
}) {
  const [tab, setTab] = useState<'counters' | 'qr' | 'training' | 'sides'>('counters');
  const code = state.join_code;
  const trainUrl = code ? trainingUrl(window.location.origin, import.meta.env.BASE_URL, code.code) : '';
  const bound = state.field_counters ?? [];
  const onFight = new Set(state.seats.filter(s => s.status === 'active').map(s => s.name));
  const waitingPhones = bound.filter(b => b.operator && !onFight.has(b.operator));
  return (
    <Dialog title="Counters" variant="drawer" onClose={onClose}>
      <div className="ly-counters">
        <div className="ly-seg-tabs" role="tablist" aria-label="Counters">
          {([['counters', 'This fight'], ['qr', 'Counter QR'], ['training', 'Training QR'], ['sides', 'Sides']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="ly-chip" aria-pressed={tab === k} onClick={() => setTab(k)} data-testid={`counters-tab-${k}`}>{label}</button>
          ))}
        </div>
        {tab === 'counters' && (
          <>
            <p className="src">Evidence only: the marshal's call is the only official score. Each counter's number is shown on its own, never combined.</p>
            <CounterEvidence seats={state.seats} names={names} round={round} sides={sides} />
            {waitingPhones.length > 0 && <p className="src">On this Lyst, not on this fight yet: {waitingPhones.map(b => `${b.operator} (${b.side ? sideLabel(b.side, sides) : 'no side'})`).join(', ')}. They join the next fight that opens here.</p>}
            {state.seats.length === 0 && bound.length === 0 && <p className="src">No counters yet. Show the Counter QR to any phone that should count on this Lyst.</p>}
          </>
        )}
        {tab === 'qr' && <CounterQrCard eventId={eventId} />}
        {tab === 'sides' && <SidesEditor eventId={eventId} sides={sides ?? DEFAULT_SIDES} names={names} onSaved={() => { onSidesSaved?.(); setTab('counters'); }} />}
        {tab === 'training' && (
          <div className="ly-join panel info" data-testid="training-qr">
            {code ? <><Qr value={trainUrl} label="This Lyst's training QR" /><div><b className="mono ly-code">{code.code}</b><span className="src">For someone learning to count on their own phone: scan, say your name, pick Red or Blue, count along. It is practice: never official, listed apart. Expires {new Date(code.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</span></div></>
              : <p>No training code yet for {fieldName}.</p>}
            <button type="button" className="btn btn-line" disabled={busy} onClick={onNewTrainingCode}>{code ? 'New training code' : 'Show training QR'}</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Pack 25.2: the two sides' names and colours for this event (the flag colours of the day). Anyone who runs the Lyst may change them; the phones,
 * the Lyst and the evidence lists follow at once. One tap on a preset sets the name and the colour together; a custom colour keeps the typed name.
 */
export function SidesEditor({ eventId, sides, names, onSaved }: { eventId: string; sides: EventSides; names: { a: string; b: string }; onSaved: () => void }) {
  const [draft, setDraft] = useState<EventSides>(() => mergeSides(sides));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (side: 'a' | 'b', patch: Partial<SideSpec>) => setDraft(d => ({ ...d, [side]: { ...d[side], ...patch } }));
  const save = async () => {
    setBusy(true); setProblem(null);
    try { await setEventSides(eventId, { a: { name: draft.a.name.trim(), color: draft.a.color }, b: { name: draft.b.name.trim(), color: draft.b.color } }); onSaved(); }
    catch (e) { setProblem(friendlyError(e, 'Could not save the sides.')); }
    finally { setBusy(false); }
  };
  return (
    <div className="ly-sides" data-testid="sides-editor">
      <p className="src">The flag colours of the day. Every counter phone, this Lyst and the evidence lists use them at once. Side A is {names.a}, side B is {names.b}.</p>
      {(['a', 'b'] as const).map(side => (
        <div key={side} className="ly-sides-row" data-testid={`sides-row-${side}`}>
          <b>Side {side.toUpperCase()} · {names[side]}</b>
          <div className="ly-swatches" role="group" aria-label={`Side ${side.toUpperCase()} colour`}>
            {SIDE_PRESETS.map(p => (
              <button key={p.name} type="button" className="ly-swatch" style={{ background: p.color, color: inkFor(p.color) }} aria-pressed={draft[side].color.toUpperCase() === p.color.toUpperCase()}
                onClick={() => set(side, { name: p.name, color: p.color })} data-testid={`swatch-${side}-${p.name.toLowerCase()}`}>{p.name}</button>
            ))}
          </div>
          <label><span>Name on the phones and the Lyst</span><input type="text" value={draft[side].name} maxLength={20} onChange={e => set(side, { name: e.target.value })} data-testid={`side-name-${side}`} /></label>
          <label><span>Custom colour</span><input type="color" value={draft[side].color} onChange={e => set(side, { color: e.target.value.toUpperCase() })} aria-label={`Side ${side.toUpperCase()} custom colour`} /></label>
          <span className="ly-sides-preview" style={{ background: draft[side].color, color: inkFor(draft[side].color) }} aria-hidden="true">{draft[side].name || ' '}</span>
        </div>
      ))}
      {problem && <p role="alert" className="ly-error">{problem}</p>}
      <button type="button" className="btn btn-ink" disabled={busy || !draft.a.name.trim() || !draft.b.name.trim()} onClick={() => void save()} data-testid="sides-save">Save the sides</button>
    </div>
  );
}
