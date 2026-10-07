import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '../Dialog';
import { Chip } from '../ui';
import { usePoll } from './hooks';
import { endEventSession, fetchCounterOperatorHistory, fetchDeviceSessionPreview, fetchEventDeviceSessions, fetchPlatformDeviceSessions, moveCounterSession, type OperatorHistoryRow } from '../../data/devices';
import type { CounterState } from '../../data/lyst';
import { SIDE_WORD, sessionLine, sideWord, sortSessions, type DeviceSession } from '../../lib/devices';
import { fieldLabel } from '../../lib/eventDay';
import { friendlyError } from '../../lib/friendlyError';
import { timeAgo } from '../../lib/notificationView';
import { useAsync } from '../../lib/useAsync';
import '../../styles/command181.css';

type Sheet = { kind: 'move'; s: DeviceSession } | { kind: 'end'; s: DeviceSession } | { kind: 'preview'; s: DeviceSession } | { kind: 'history'; s: DeviceSession };
const when = (iso: string | null, now: number) => (iso ? timeAgo(iso, now) : 'never');

/**
 * The phones and tablets signed in right now (Pack 25): what each is doing (a counter's Lyst, side and operator; a staff device's role), online
 * or not, and the few things staff may do to one without ever being it: move a counter to another Lyst or side, sign one phone out, look at what
 * its screen shows (read only) and read who held it. One event's list for its organizer (and whoever may score, for the move); every event's for
 * the platform owner. The database decides each action again.
 */
export function DeviceSessions({ eventId, fieldCount = 1, compact = false }: {
  /** One event's sessions; absent = the platform owner's cross-event list. */
  eventId?: string; fieldCount?: number; compact?: boolean;
}) {
  const [key, setKey] = useState(0);
  const [ended, setEnded] = useState(false);
  const list = useAsync(() => (eventId ? fetchEventDeviceSessions(eventId, ended) : fetchPlatformDeviceSessions(ended)), [eventId, ended], [key]);
  usePoll(10_000, () => setKey(k => k + 1));
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  usePoll(15_000, () => setNow(Date.now()));
  const refresh = () => setKey(k => k + 1);
  const rows = sortSessions(list.data ?? []);
  const live = rows.filter(r => r.status === 'active');
  const past = rows.filter(r => r.status !== 'active');
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: friendlyError(e, 'That did not work. Check your signal and try again.') }); } finally { setBusy(false); refresh(); }
  };
  const byEvent = new Map<string, DeviceSession[]>();
  for (const r of live) { const k = r.event?.name ?? 'Unknown event'; byEvent.set(k, [...(byEvent.get(k) ?? []), r]); }
  const grouped = !eventId && byEvent.size > 1;

  return (
    <section className="dev-sessions" aria-label="Devices signed in" data-testid="device-sessions" style={{ display: 'grid', gap: 10 }}>
      {!compact && <p className="src">Each phone that scanned a code is listed here while it is signed in: what it is doing and whether it is online. A counter phone can be moved to another Lyst or side, signed out, or looked at (read only). Nobody can act as a phone from here.</p>}
      {list.error != null && !list.data && <p role="alert">{friendlyError(list.error, 'Could not load the devices.')} <button type="button" className="linklike" onClick={() => list.reload()}>Try again</button></p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'dev-ok' : 'err'}>{msg.text}</p>}
      {list.loading && !list.data ? <p className="src">Loading…</p> : live.length === 0 ? <p className="cc-empty">No phone or tablet is signed in{eventId ? ' on this event' : ''} right now.</p> : (
        grouped ? [...byEvent.entries()].map(([name, group]) => (
          <div key={name} className="cc-sub">
            <h3>{name} <span className="src">{group.length} signed in</span></h3>
            <ul className="dev-list">{group.map(s => <Row key={s.sessionId} s={s} now={now} busy={busy} onSheet={setSheet} />)}</ul>
          </div>
        )) : <ul className="dev-list">{live.map(s => <Row key={s.sessionId} s={s} now={now} busy={busy} onSheet={setSheet} />)}</ul>
      )}
      <p><button type="button" className="linklike" aria-pressed={ended} onClick={() => setEnded(x => !x)} data-testid="sessions-ended-toggle">{ended ? 'Hide signed-out phones' : 'Show signed-out phones'}</button>{ended && past.length > 0 && <span className="src"> · {past.length} signed out, expired or revoked</span>}</p>
      {ended && past.length > 0 && <ul className="dev-list">{past.map(s => <Row key={s.sessionId} s={s} now={now} busy={busy} onSheet={setSheet} />)}</ul>}

      {sheet?.kind === 'move' && <MoveSheet s={sheet.s} fieldCount={fieldCount} known={rows} busy={busy} onClose={() => setSheet(null)} onMove={(field, side) => { setSheet(null); void run(async () => { const r = await moveCounterSession(sheet.s.sessionId, field, side); return `${r.label} now counts ${sessionLine(r).replace(/^Counter · /, '')}.`; }); }} />}
      {sheet?.kind === 'end' && (
        <Dialog title={`Sign ${sheet.s.label} out?`} variant="drawer" busy={busy} onClose={() => setSheet(null)}>
          <p style={{ marginTop: 0 }}>This phone is signed out right away. Its code keeps working: the same phone, or another, can scan it again. Other phones are not affected.</p>
          <div className="dlg-actions">
            <button type="button" className="btn btn-line" onClick={() => setSheet(null)}>Keep it</button>
            <button type="button" className="btn btn-danger" data-autofocus onClick={() => { const s = sheet.s; setSheet(null); void run(async () => { const r = await endEventSession(s.sessionId); return r === 'ended' ? `${s.label} is signed out.` : `${s.label} was already signed out.`; }); }}>Sign out</button>
          </div>
        </Dialog>
      )}
      {sheet?.kind === 'preview' && <PreviewSheet s={sheet.s} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'history' && <HistorySheet s={sheet.s} onClose={() => setSheet(null)} />}
    </section>
  );
}

function Row({ s, now, busy, onSheet }: { s: DeviceSession; now: number; busy: boolean; onSheet: (sh: Sheet) => void }) {
  const active = s.status === 'active';
  const counter = s.role === 'counter';
  return (
    <li className={`dev-row s-${s.status}`} data-testid="session-row" data-label={s.label} data-status={s.status} data-online={s.online}>
      <div className="dev-main">
        <b className="dev-name">{counter && s.binding?.operator ? s.binding.operator : s.label}</b>
        {counter && s.binding?.operator && <span className="src">{s.label}</span>}
        {active ? <Chip tone={s.online ? 'win' : ''}>{s.online ? 'Online' : 'Offline'}</Chip> : <Chip tone={s.status === 'expired' ? 'brass' : ''}>{s.status === 'ended' ? 'Signed out' : s.status === 'revoked' ? 'Revoked' : 'Expired'}</Chip>}
        {s.binding?.side && <span className={`ly-corner ly-corner-${s.binding.side}`} aria-label={`${SIDE_WORD[s.binding.side]} corner`}>{SIDE_WORD[s.binding.side].toUpperCase()}</span>}
      </div>
      <p className="dev-sub">{sessionLine(s)}{s.event && !active ? '' : ''} · seen {when(s.lastSeenAt, now)}{s.endedAt ? ` · ended ${when(s.endedAt, now)}${s.endedReason ? ` (${s.endedReason.replace(/_/g, ' ')})` : ''}` : ''}</p>
      {s.event && <p className="dev-sub"><Link to={`/events/${s.event.slug}/control?mode=live`}>{s.event.name}</Link></p>}
      {active && (
        <div className="dev-actions">
          {counter && <button type="button" className="btn btn-line btn-sm" disabled={busy} aria-label={`Move ${s.label}`} onClick={() => onSheet({ kind: 'move', s })} data-testid="session-move">Move</button>}
          {counter && <button type="button" className="btn btn-line btn-sm" disabled={busy} aria-label={`Preview ${s.label}`} onClick={() => onSheet({ kind: 'preview', s })} data-testid="session-preview">Device preview</button>}
          {counter && <button type="button" className="btn btn-line btn-sm" disabled={busy} aria-label={`Who held ${s.label}`} onClick={() => onSheet({ kind: 'history', s })}>Who held it</button>}
          <button type="button" className="btn btn-bad btn-sm" disabled={busy} aria-label={`Sign out ${s.label}`} onClick={() => onSheet({ kind: 'end', s })} data-testid="session-end">Sign out</button>
        </div>
      )}
    </li>
  );
}

function MoveSheet({ s, fieldCount, known, busy, onClose, onMove }: { s: DeviceSession; fieldCount: number; known: readonly DeviceSession[]; busy: boolean; onClose: () => void; onMove: (field: string | null, side: 'a' | 'b' | null) => void }) {
  const labels = [...new Set([...Array.from({ length: Math.max(1, fieldCount) }, (_, i) => `Field ${i + 1}`), ...known.map(k => k.binding?.fieldLabel).filter((x): x is string => !!x)])];
  const [field, setField] = useState<string>(s.binding?.fieldLabel ?? labels[0] ?? 'Field 1');
  const [side, setSide] = useState<'a' | 'b' | null>(s.binding?.side ?? null);
  const [other, setOther] = useState('');
  return (
    <Dialog title={`Move ${s.label}`} variant="drawer" busy={busy} onClose={onClose}>
      <p style={{ marginTop: 0 }} className="src">The phone follows at once: it leaves its fight and joins the current fight on the new Lyst and side. Who holds it does not change ({s.binding?.operator ?? 'no name yet'}).</p>
      <label className="field-in">Lyst
        <select value={labels.includes(field) ? field : '__other'} onChange={e => setField(e.target.value)}>
          {labels.map(l => <option key={l} value={l}>{fieldLabel(l)}</option>)}
          <option value="__other">Another Lyst…</option>
        </select>
      </label>
      {field === '__other' && <label className="field-in">Lyst name<input value={other} onChange={e => setOther(e.target.value)} placeholder="Lyst 3" /></label>}
      <fieldset className="cp-sides" style={{ border: 0, padding: 0, margin: '8px 0' }}>
        <legend className="src">Side</legend>
        {(['a', 'b'] as const).map(x => <button key={x} type="button" className={`btn ${side === x ? 'btn-ink' : 'btn-line'} cp-side-${x}`} aria-pressed={side === x} onClick={() => setSide(x)}>{sideWord(x).toUpperCase()}</button>)}
        <button type="button" className={`btn ${side === null ? 'btn-ink' : 'btn-line'}`} aria-pressed={side === null} onClick={() => setSide(null)}>No side yet</button>
      </fieldset>
      <div className="dlg-actions">
        <button type="button" className="btn btn-line" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-ink" data-autofocus disabled={field === '__other' && !other.trim()} onClick={() => onMove(field === '__other' ? other.trim() : field, side)}>Move</button>
      </div>
    </Dialog>
  );
}

/** What the phone shows, read only: the same state the phone reads, rendered as a card. Nothing is written for the phone and its last-seen is untouched. */
function PreviewSheet({ s, onClose }: { s: DeviceSession; onClose: () => void }) {
  const st = useAsync(() => fetchDeviceSessionPreview(s.sessionId), [s.sessionId]);
  const d = (st.data ?? null) as Partial<CounterState> | null;
  return (
    <Dialog title={`${s.label} · device preview`} variant="drawer" onClose={onClose}>
      <p className="src" style={{ marginTop: 0 }}>Read only. This is what the phone's screen is showing from the server's point of view; nothing here acts as the phone.</p>
      {st.loading && !st.data && <p className="src">Loading…</p>}
      {st.error != null && <p role="alert">{friendlyError(st.error, 'Could not read this phone.')}</p>}
      {d && (
        <div className="panel info dev-preview" data-testid="device-preview" style={{ display: 'grid', gap: 6 }}>
          <p style={{ margin: 0 }}><b>{d.binding?.operator ?? 'No name yet'}</b> · {d.field_label ? fieldLabel(d.field_label) : 'no Lyst yet'} · {d.binding?.side ? sideWord(d.binding.side) : 'no side yet'}</p>
          {d.fighter ? <p style={{ margin: 0 }}>Counting for <b>{d.fighter}</b>{d.opponent ? ` vs ${d.opponent}` : ''}{d.competition ? ` · ${d.competition}` : ''}{d.round_label ? ` · ${d.round_label}` : ''}</p> : <p style={{ margin: 0 }} className="src">{d.waiting ? 'Waiting for the next fight on this Lyst.' : 'Not on a fight.'}</p>}
          {d.round && <p style={{ margin: 0 }}>Round {d.round.no} · {d.round.status}{typeof d.my_total === 'number' ? ` · this phone's tally ${d.my_total}` : ''}{d.submitted ? ' · submitted' : ''}</p>}
          {d.counter_input === 'standing' && <p style={{ margin: 0 }} className="src">Standing count{typeof d.per_side === 'number' ? ` · ${d.per_side} a side` : ''}</p>}
        </div>
      )}
    </Dialog>
  );
}

function HistorySheet({ s, onClose }: { s: DeviceSession; onClose: () => void }) {
  const h = useAsync(() => fetchCounterOperatorHistory(s.eventId, s.sessionId), [s.eventId, s.sessionId]);
  const rows: OperatorHistoryRow[] = h.data ?? [];
  return (
    <Dialog title={`${s.label} · who held it`} variant="drawer" onClose={onClose}>
      {h.loading && !h.data && <p className="src">Loading…</p>}
      {h.error != null && <p role="alert">{friendlyError(h.error, 'Could not read the history.')}</p>}
      {h.data && rows.length === 0 && <p className="src">Nobody has given a name on this phone yet.</p>}
      {rows.length > 0 && (
        <ol className="cc-list" style={{ margin: 0 }} data-testid="operator-history">
          {rows.map(r => <li key={`${r.sessionId}-${r.startedAt}`}><b>{r.operator}</b> <span className="src">{r.fieldKey ?? 'no Lyst'} · {sideWord(r.side)} · from {new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{r.endedAt ? ` to ${new Date(r.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' · now'}</span></li>)}
        </ol>
      )}
    </Dialog>
  );
}
