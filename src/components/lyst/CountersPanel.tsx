import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Dialog } from '../Dialog';
import type { LystSeat, LystState } from '../../data/lyst';
import { createCounterPool, fetchCounterPool, type CounterPool } from '../../data/devices';
import { deviceQrUrl } from '../../lib/devices';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import { sideLabel, trainingUrl } from '../../lib/lyst/counters';

function Qr({ value, label }: { value: string; label: string }) {
  const svg = useMemo(() => {
    try { const q = qrcode(0, 'M'); q.addData(value); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { return ''; }
  }, [value]);
  // the markup comes from the QR library for OUR url only
  return <div className="ly-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The counters on this fight as EVIDENCE: operator, side, tally, online, done. Official phones and trainees are listed apart. Never a combined number. */
export function CounterEvidence({ seats, names, round, compact = false }: { seats: readonly LystSeat[]; names: { a: string; b: string }; round: number; compact?: boolean }) {
  const tally = (s: LystSeat) => s.tallies.find(t => t.round_no === round);
  const row = (s: LystSeat) => {
    const t = tally(s);
    return (
      <li key={s.id} className={`ly-seat ly-seat-${s.side ?? 'none'}${s.role === 'learning' ? ' is-learning' : ''}`} data-testid="counter-row" data-side={s.side ?? ''} data-role={s.role}>
        <span className={`ly-corner ly-corner-${s.side ?? 'none'}`}>{s.side ? sideLabel(s.side) : '–'}</span>
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
          <b className={`ly-corner-h ly-corner-${side}`}>{sideLabel(side)} · {names[side]}</b>
          {bySide(side).length === 0 ? <p className="src">No counter on {sideLabel(side).toLowerCase()}.</p> : <ul className="ly-list">{bySide(side).map(row)}</ul>}
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
export function CountersPanel({ state, names, round, eventId, fieldName, busy, onNewTrainingCode, onClose }: {
  state: LystState; names: { a: string; b: string }; round: number; eventId: string; fieldName: string; busy: boolean;
  onNewTrainingCode: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<'counters' | 'qr' | 'training'>('counters');
  const [key, setKey] = useState(0);
  const pool = useAsync(() => fetchCounterPool(eventId), [eventId], [key]);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const makePool = async () => {
    setMaking(true); setProblem(null);
    try { await createCounterPool(eventId); setKey(k => k + 1); } catch (e) { setProblem(friendlyError(e)); } finally { setMaking(false); }
  };
  const code = state.join_code;
  const trainUrl = code ? trainingUrl(window.location.origin, import.meta.env.BASE_URL, code.code) : '';
  const bound = state.field_counters ?? [];
  const onFight = new Set(state.seats.filter(s => s.status === 'active').map(s => s.name));
  const waitingPhones = bound.filter(b => b.operator && !onFight.has(b.operator));
  return (
    <Dialog title="Counters" variant="drawer" onClose={onClose}>
      <div className="ly-counters">
        <div className="ly-seg-tabs" role="tablist" aria-label="Counters">
          {([['counters', 'This fight'], ['qr', 'Counter QR'], ['training', 'Training QR']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className="ly-chip" aria-pressed={tab === k} onClick={() => setTab(k)} data-testid={`counters-tab-${k}`}>{label}</button>
          ))}
        </div>
        {tab === 'counters' && (
          <>
            <p className="src">Evidence only: the marshal's call is the only official score. Each counter's number is shown on its own, never combined.</p>
            <CounterEvidence seats={state.seats} names={names} round={round} />
            {waitingPhones.length > 0 && <p className="src">On this Lyst, not on this fight yet: {waitingPhones.map(b => `${b.operator} (${b.side ? sideLabel(b.side) : 'no side'})`).join(', ')}. They join the next fight that opens here.</p>}
            {state.seats.length === 0 && bound.length === 0 && <p className="src">No counters yet. Show the Counter QR to any phone that should count on this Lyst.</p>}
          </>
        )}
        {tab === 'qr' && (
          <div className="ly-join panel info" data-testid="counter-qr">
            {pool.loading && !pool.data && <p className="src">Loading…</p>}
            {pool.error != null && <p role="alert">{friendlyError(pool.error, 'Could not load the Counter QR.')}</p>}
            {pool.data?.code && <>
              <Qr value={deviceQrUrl(window.location.origin, import.meta.env.BASE_URL ?? '/', pool.data.code)} label="The event's Counter QR" />
              <div>
                <b className="mono ly-code" data-testid="counter-qr-code">{pool.data.code.replace(/(.{4})(?=.)/g, '$1-')}</b>
                <span className="src">Any phone that should count scans this once. It then picks a Lyst and Red or Blue, and follows the fights on that Lyst by itself. {pool.data.openSessions} phone{pool.data.openSessions === 1 ? '' : 's'} on it now.</span>
                <span className="src">A lost or dead phone is replaced by scanning this again on another phone.</span>
              </div>
            </>}
            {pool.data && !pool.data.code && <NoPool pool={pool.data} making={making} onMake={() => void makePool()} />}
            {problem && <p role="alert" className="ly-error">{problem}</p>}
          </div>
        )}
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

function NoPool({ pool, making, onMake }: { pool: CounterPool; making: boolean; onMake: () => void }) {
  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
      <p>This event has no Counter QR yet.</p>
      {pool.canCreate
        ? <button type="button" className="btn btn-ink" disabled={making} onClick={onMake} data-testid="make-counter-qr">{making ? 'Making…' : 'Make the Counter QR'}</button>
        : <p className="src">An organizer makes it once, under Event Control › Counters and devices. Then it shows here.</p>}
    </div>
  );
}
