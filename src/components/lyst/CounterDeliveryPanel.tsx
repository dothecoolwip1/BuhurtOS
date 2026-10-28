import { useMemo, useState } from 'react';
import { reviewCounterRecovery, type LystState } from '../../data/lyst';
import { readCounterCorrection, sideLabel, type EventSides } from '../../lib/lyst/counters';
import { friendlyError } from '../../lib/friendlyError';
import { Dialog } from '../Dialog';

/** Expected phones stay visible even when they go quiet. A heartbeat is not a
 * start receipt, and a retained count is never presented as an awarded score. */
export function CounterDeliveryPanel({ state, sides, onChanged, inline = false, visible, onVisibleChange }: { state: LystState; sides: EventSides; onChanged: () => void; inline?: boolean; visible?:boolean;onVisibleChange?:(open:boolean)=>void }) {
  const [open,setOpen]=useState(false);
  const shown=visible??open;
  const show=(v:boolean)=>onVisibleChange?onVisibleChange(v):setOpen(v);
  const delivery = (state.counter_delivery ?? []).filter(c => c.role === 'official');
  const assigned = state.seats.filter(s=>s.status==='active'&&s.role==='official');
  const recovery = state.counter_recovery ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, typeof recovery>();
    for (const e of recovery.filter(e => !e.decision)) {
      const key = `${e.seat_id}:${e.run_id}`;
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [state.counter_recovery]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = delivery.some(c => c.run_status === 'running' || c.run_status === 'closed');
  const acknowledged = delivery.filter(c => started ? c.started_at : c.prepared_at).length;
  const review = async (key: string, decision: 'noted' | 'dismissed') => {
    const rows = groups.find(([k]) => k === key)?.[1] ?? [];
    setBusy(key); setError(null);
    try {
      // Batch is atomic: no partly-reviewed group after a lost connection.
      await reviewCounterRecovery(rows.slice(0, 1000).map(e => e.id), decision, reasons[key]?.trim() ?? '');
      onChanged();
    } catch (e) { setError(friendlyError(e, 'Review was not confirmed. Refresh before retrying.')); onChanged(); }
    finally { setBusy(null); }
  };
  if (!delivery.length && !recovery.length) return null;
  const panel = <section className="panel info ly-phone-details" aria-label="Counter connection safety" style={{ display: 'grid', gap: 10 }}>
    {delivery.length > 0 && <>
      <b role="status">Counter phones: {acknowledged} of {delivery.length} {started ? 'received the start' : 'saved the prepared round'}</b>
      {acknowledged < delivery.length && <p className="ly-note" role="alert">Some phones have not confirmed this round. Check with their counters. A phone with the correct round saved can count from the marshal’s call using its offline button; use paper if it has no prepared round.</p>}
      <details open={acknowledged < delivery.length}>
        <summary>Phone status and pending counts</summary>
        <ul className="ly-list">{delivery.map(c => <li key={c.seat_id} style={{ display: 'grid', gap: 2 }}>
          <b>{c.operator} · {sideLabel(c.side, sides)} · counter {assigned.some(s=>s.id===c.seat_id)?assigned.findIndex(s=>s.id===c.seat_id)+1:delivery.indexOf(c)+1} · round {c.round ?? 'not prepared'}</b>
          <span>{!c.prepared_at ? 'Preparation not received' : c.run_status === 'prepared' ? 'Prepared on phone' : !c.started_at ? 'Start not received' : 'Start received'}{c.submitted ? ' · done' : ' · not submitted'}{c.pending ? ` · ${c.pending} pending at last report` : ''}</span>
          <small>{c.seen_at ? `Last report ${new Date(c.seen_at).toLocaleTimeString()}. A disconnected phone may have more unsent counts.` : 'No delivery receipt from this phone.'}</small>
        </li>)}</ul>
      </details>
    </>}
    {groups.length > 0 && <>
      <b role="alert">Saved counter evidence needs marshal review</b>
      <p>These counts arrived late or came from an offline start. They have not changed any awarded score. Check the phone and paper sheet, record the decision, then enter or correct the marshal’s score.</p>
      {groups.map(([key, rows]) => {
        const first = rows[0]; const taps = rows.filter(e => e.action.kind === 'tap').reduce((n, e) => n + (e.action.kind === 'tap' ? e.action.weight : 0), 0);
        const undos = rows.filter(e => e.action.kind === 'undo').length;
        return <div key={key} style={{ display: 'grid', gap: 8 }}>
          <b>{first.operator} · {sideLabel(first.side, sides)} · round {first.round}, attempt {first.generation}{first.role === 'learning' ? ' · training only' : ''}</b>
          <span>{rows.length} actions: {taps} tapped points, {undos} undos. Check the action order before deciding.</span>
          {[...new Map(rows.flatMap(e=>{const c=readCounterCorrection(e.action.correction);return c?[[c.id,c] as const]:[];})).values()].map(c=><p key={c.id}>Counter edited their total: {c.from} → {c.to}. Original taps are retained; confirm the correction with the counter.</p>)}
          <details><summary>View retained actions</summary><ol>{rows.map(e => <li key={e.id}>{e.action.kind === 'tap' ? `+${e.action.weight}` : 'Undo'} · {e.reason}{e.action.operator?` · phone reported ${e.action.operator} at ${e.action.recordedAt??'time not saved'} (unverified)`:''} · received {new Date(e.received_at).toLocaleTimeString()}</li>)}</ol></details>
          <label className="field-in">Marshal’s decision and reason<input value={reasons[key] ?? ''} maxLength={1000} onChange={e => setReasons(r => ({ ...r, [key]: e.target.value }))} /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-line" disabled={!!busy || (reasons[key]?.trim().length ?? 0) < 3} onClick={() => void review(key, 'noted')}>Record marshal review{rows.length > 1000 ? ' (first 1,000 actions)' : ''}</button>
            <button type="button" className="btn btn-line" disabled={!!busy || (reasons[key]?.trim().length ?? 0) < 3} onClick={() => void review(key, 'dismissed')}>Exclude with reason</button>
          </div>
        </div>;
      })}
    </>}
    {recovery.some(e => e.decision) && <details><summary>Reviewed evidence</summary><ul>{recovery.filter(e => e.decision).map(e => <li key={e.id}>{e.operator}, round {e.round}: {e.decision} · {e.review_reason}</li>)}</ul></details>}
    {error && <p role="alert">{error}</p>}
  </section>;
  if(inline)return panel;
  const attention=acknowledged<delivery.length||groups.length>0;
  return <>
    <button type="button" className={`ly-phone-float${attention?' is-warning':''}`} aria-haspopup="dialog" onClick={()=>show(true)}><span>{delivery.length?'Counter phones':'Counter evidence'}</span>{delivery.length>0&&<> <b>{acknowledged}/{delivery.length}{attention?' · check':''}</b></>}</button>
    {shown&&<Dialog title="Counter phones" wide onClose={()=>{if(!busy)show(false);}} busy={!!busy}>{panel}<button type="button" className="btn btn-line" disabled={!!busy} onClick={()=>show(false)}>Back to scoring</button></Dialog>}
  </>;
}
