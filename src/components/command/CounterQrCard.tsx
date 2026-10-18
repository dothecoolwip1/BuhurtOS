import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { createCounterPool, fetchCounterPool } from '../../data/devices';
import { deviceQrUrl } from '../../lib/devices';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';

function Qr({ value, label }: { value: string; label: string }) {
  const svg = useMemo(() => {
    try { const q = qrcode(0, 'M'); q.addData(value); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch { return ''; }
  }, [value]);
  // the markup comes from the QR library for OUR url only; it holds shapes, never text
  return svg ? <div className="ly-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="src">The QR could not be drawn. Type the code instead.</p>;
}

/**
 * The event's one COUNTER QR (Pack 25), shown in seconds by whoever runs the day: marshal, scorekeeper, organizer. A phone scans it once and becomes a
 * counter on the Lyst and side it chooses. The database decides who may see the code (anyone who may score) and who may make it (the organizer).
 * It is one card everywhere it appears: Live ops, the Lyst's Counters sheet and the devices tool.
 */
export function CounterQrCard({ eventId, compact = false, training = false }: { eventId: string; compact?: boolean; training?: boolean }) {
  const [key, setKey] = useState(0);
  const pool = useAsync(() => fetchCounterPool(eventId, training), [eventId, training], [key]);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);
  const make = async () => {
    setMaking(true); setProblem(null);
    try { await createCounterPool(eventId, training); setKey(k => k + 1); } catch (e) { setProblem(friendlyError(e)); } finally { setMaking(false); }
  };
  const p = pool.data;
  // Pack 27B: the same card is the TRAINING COUNTER QR (practice only: its phones never hold an official place)
  const name = training ? 'Training Counter QR' : 'Counter QR';
  const tid = training ? 'training-qr' : 'counter-qr';
  if (pool.error != null && !p) return <p className="src" role="status">The {name} is for the people who run the fights: {friendlyError(pool.error, 'it could not be loaded.')}</p>;
  return (
    <div className={`ly-join panel info cq${training ? ' is-training' : ''}`} data-testid={tid} data-open={open}>
      {!p && pool.loading && <p className="src">Loading the {name}…</p>}
      {p?.code && !open && <div className="cq-row"><b>{name}</b><span className="src">{p.openSessions} phone{p.openSessions === 1 ? '' : 's'} on it now.</span><button type="button" className="btn btn-ink btn-sm" onClick={() => setOpen(true)} data-testid={`show-${tid}`}>Show the QR</button></div>}
      {p?.code && open && <>
        <Qr value={deviceQrUrl(window.location.origin, import.meta.env.BASE_URL ?? '/', p.code)} label={`The event's ${name}`} />
        <div>
          {training && <b className="cq-tag">Training Counter · practice only</b>}
          <b className="mono ly-code" data-testid={`${tid}-code`}>{p.code.replace(/(.{4})(?=.)/g, '$1-')}</b>
          {training
            ? <span className="src">Someone learning to count scans this on their own phone, says who they are, picks a Lyst and Red or Blue, and counts along with the official counters. Their count is practice: listed apart on the Lyst, never part of the official evidence, never a score. {p.openSessions} phone{p.openSessions === 1 ? '' : 's'} on it now.</span>
            : <span className="src">Any phone that should count scans this once, says who is holding it, picks a Lyst and Red or Blue, and follows the fights on that Lyst by itself. {p.openSessions} phone{p.openSessions === 1 ? '' : 's'} on it now.</span>}
          {!training && <span className="src">A lost or dead phone is replaced by scanning this again on another phone. No second code, no approval.</span>}
          {compact && <button type="button" className="linklike" onClick={() => setOpen(false)}>Hide</button>}
        </div>
      </>}
      {p && !p.code && (
        <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
          <p><b>This event has no {name} yet.</b> {training ? 'One code for everyone who wants to practise counting on their own phone.' : 'One code for every counter phone of the event.'}</p>
          {p.canCreate
            ? <button type="button" className="btn btn-ink" disabled={making} onClick={() => void make()} data-testid={`make-${tid}`}>{making ? 'Making…' : `Make the ${name}`}</button>
            : <p className="src">An organizer makes it once, under Event Control › Counters and devices. Then it shows here.</p>}
        </div>
      )}
      {problem && <p role="alert" className="ly-error">{problem}</p>}
    </div>
  );
}
