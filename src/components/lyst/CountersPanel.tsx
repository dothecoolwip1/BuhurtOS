import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { Dialog } from '../Dialog';
import type { LystState } from '../../data/lyst';
import { joinUrl } from '../../lib/lyst/counters';

function Qr({ value }: { value: string }) {
  const svg = useMemo(() => {
    try { const q = qrcode(0, 'M'); q.addData(value); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { return ''; }
  }, [value]);
  // the markup comes from the QR library for OUR url only
  return <div className="ly-qr" role="img" aria-label="QR code that opens the counter page" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Counters: optional, never authoritative. The tablet shows the code, seats each person on one fighter, and shows every counter's tally SEPARATELY beside the marshal's entry.
 * Learning counters practise the real job: they are listed apart and nothing they tap can reach an official number.
 */
export function CountersPanel({ state, names, round, eventSlug, busy, onNewCode, onAssign, onEnd, onClose }: {
  state: LystState; names: { a: string; b: string }; round: number; eventSlug: string; busy: boolean;
  onNewCode: () => void; onAssign: (seat: string, side: 'a' | 'b', role: 'official' | 'learning') => void; onEnd: (seat: string, decline: boolean) => void; onClose: () => void;
}) {
  const code = state.join_code;
  const url = code ? joinUrl(window.location.origin, import.meta.env.BASE_URL, code.code) : '';
  const official = state.seats.filter(s => s.role === 'official');
  const learning = state.seats.filter(s => s.role === 'learning');
  const tally = (s: LystState['seats'][number]) => s.tallies.find(t => t.round_no === round);
  const seatRow = (s: LystState['seats'][number]) => (
    <li key={s.id} className={`ly-seat ${s.role === 'learning' ? 'is-learning' : ''}`}>
      <span className="ly-slot mono">{s.slot}</span>
      <span className="ly-seat-main"><b>{s.name}</b><span className="src">{s.side === 'a' ? names.a : names.b}{s.role === 'learning' ? ' · learning, never official' : ''}</span></span>
      <span className="ly-seat-n mono" aria-label={`Round ${round} count ${tally(s)?.total ?? 0}${tally(s)?.submitted ? ', done' : ''}`}>{tally(s)?.total ?? 0}{tally(s)?.submitted ? ' ✓' : ''}</span>
      <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => onEnd(s.id, false)} aria-label={`Remove ${s.name}`}>Remove</button>
    </li>
  );
  return (
    <Dialog title="Counters" variant="drawer" onClose={onClose}>
      <div className="ly-counters">
        <p className="src">Counters are optional helpers. The marshal's call is the only official score. Their counts are shown here as evidence only.</p>
        <div className="ly-join panel info">
          {code ? <><Qr value={url} /><div><b className="mono ly-code">{code.code}</b><span className="src">Scan, or open {window.location.host}{import.meta.env.BASE_URL}lyst/join and type the code. It expires at {new Date(code.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</span></div></>
            : <p>No join code yet for this field.</p>}
          <button type="button" className="btn btn-ink" disabled={busy} onClick={onNewCode}>{code ? 'New code' : 'Show join code'}</button>
          {eventSlug && <span className="sr-only">Event {eventSlug}</span>}
        </div>
        {state.requests.length > 0 && (
          <div className="ly-requests">
            <b>Waiting to be seated ({state.requests.length})</b>
            <ul className="ly-list">
              {state.requests.map(r => (
                <li key={r.id} className="ly-request">
                  <span className="ly-req-name"><b>{r.name}</b></span>
                  <div className="ly-assign" role="group" aria-label={`Seat ${r.name}`}>
                    <button type="button" className="btn btn-line" disabled={busy} onClick={() => onAssign(r.id, 'a', 'official')}>Counts {names.a}</button>
                    <button type="button" className="btn btn-line" disabled={busy} onClick={() => onAssign(r.id, 'b', 'official')}>Counts {names.b}</button>
                    <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => onAssign(r.id, 'a', 'learning')}>Learning · {names.a}</button>
                    <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => onAssign(r.id, 'b', 'learning')}>Learning · {names.b}</button>
                    <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => onEnd(r.id, true)}>Decline</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div><b>Counting this fight · round {round}</b>
          {official.length === 0 ? <p className="src">No counters seated. You can run the whole fight from this tablet.</p> : <ul className="ly-list">{official.map(seatRow)}</ul>}
        </div>
        {learning.length > 0 && <div><b>Learning (practice only)</b><ul className="ly-list">{learning.map(seatRow)}</ul></div>}
      </div>
    </Dialog>
  );
}
