import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchEventCounterEvidence, reviewLegacyCounterEvidence, reviewModernCounterEvidence,
  type CounterEvidenceItem, type EventCounterEvidence as Evidence, type EvidenceFight
} from '../../data/counterEvidence';
import { friendlyError } from '../../lib/friendlyError';

const sideWord = (s: 'a' | 'b' | null) => (s === 'a' ? 'Side A' : s === 'b' ? 'Side B' : 'No side');
const fightText = (f: EvidenceFight) =>
  [f.competition, f.round_label, f.a && f.b ? `${f.a} v ${f.b}` : null, f.field].filter(Boolean).join(' · ') + (f.official ? ' · official' : f.current ? ' · on the Lyst now' : '');
const actionText = (a: Record<string, unknown>) =>
  a.kind === 'tap' ? `+${typeof a.weight === 'number' ? a.weight : 1}` : a.kind === 'undo' ? 'Undo' : 'Unknown action';

type Group = { key: string; kind: 'modern' | 'legacy'; items: CounterEvidenceItem[] };

/**
 * Counter evidence for one event, for staff: late or refused counts the server kept, and older phones' saved counts whose fight is unknown.
 * Nothing here awards or changes a score: a review records a decision and a reason only, and the marshal's call stays the score.
 */
export function EventCounterEvidence({ eventId, refreshKey }: { eventId: string; refreshKey?: unknown }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const nextOffset=useRef<number|null>(null);
  const request=useRef(0);

  const load = useCallback(async (append=false) => {
    const id=++request.current;
    setLoading(true);
    try {
      const answer=await fetchEventCounterEvidence(eventId,append?nextOffset.current??0:0);
      if(id!==request.current)return;
      nextOffset.current=answer.next_offset;
      setData(old=>append&&old?{...answer,modern:[...new Map([...old.modern,...answer.modern].map(i=>[i.id,i])).values()],legacy:[...new Map([...old.legacy,...answer.legacy].map(i=>[i.id,i])).values()],accepted:[...new Map([...(old.accepted??[]),...(answer.accepted??[])].map(i=>[i.id,i])).values()]}:answer);setError(null);
    }
    catch (e) { if(id===request.current)setError(friendlyError(e, 'Could not load counter evidence.')); }
    finally { if(id===request.current)setLoading(false); }
  }, [eventId]);
  useEffect(() => { void load();return()=>{request.current++;}; }, [load, refreshKey]);

  const groups = useMemo<Group[]>(() => {
    if (!data) return [];
    const map = new Map<string, Group>();
    const add = (kind: Group['kind'], key: string, i: CounterEvidenceItem) => { const g = map.get(key) ?? { key, kind, items: [] }; g.items.push(i); map.set(key, g); };
    for (const i of data.modern) if (!i.decision) add('modern', `m:${i.seat_id}:${i.run_id}`, i);
    for (const i of data.legacy) if (!i.decision) add('legacy', `l:${i.seat_id}`, i);
    return [...map.values()].map(g=>({...g,items:[...g.items].sort((a,b)=>a.received_at.localeCompare(b.received_at)||a.id.localeCompare(b.id))}));
  }, [data]);
  const reviewed = data ? [...data.modern, ...data.legacy].filter(i => i.decision) : [];

  const review = async (g: Group, decision: 'noted' | 'dismissed') => {
    const reason = reasons[g.key]?.trim() ?? '';
    setBusy(g.key); setError(null);
    try {
      const ids = g.items.slice(0, 1000).map(i => i.id);
      if (g.kind === 'legacy') await reviewLegacyCounterEvidence(ids, decision, reason); else await reviewModernCounterEvidence(ids, decision, reason);
      setReasons(r => { const { [g.key]: _drop, ...rest } = r; return rest; });
    } catch (e) { setError(friendlyError(e, 'The review was not saved. Refresh before trying again.')); }
    finally { setBusy(null); void load(); }
  };

  return (
    <section className="panel info" aria-label="Counter evidence" style={{ display: 'grid', gap: 10 }} data-testid="event-counter-evidence">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>Counter evidence to review</b>
        <button type="button" className="btn btn-line btn-sm" disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <p className="src">Counts the server kept for a person to look at. They never change a tally, an awarded score or a result. Check the phone and the paper sheet, record the decision, then enter or correct the marshal’s score the usual way.</p>
      {error && <p role="alert">{error}</p>}
      {data?.next_offset!==null && data?.next_offset!==undefined && <button type="button" className="btn btn-line" disabled={loading} onClick={()=>void load(true)}>Load older evidence · more records remain</button>}
      {data && !data.sees_all_fights && <p className="src">You see the fights you may score. The organizer and head marshal see the whole event.</p>}
      {data && groups.length === 0 && <p className="src">Nothing waiting for review.</p>}
      {groups.map(g => {
        const first = g.items[0];
        const fight = first.kind === 'modern' ? first.fight : null;
        const hint = first.kind === 'legacy' ? first.seat_fight_hint : null;
        const canReview = g.kind === 'modern' || data?.can_review_legacy;
        const reason = reasons[g.key] ?? '';
        return (
          <div key={g.key} className="panel info" style={{ display: 'grid', gap: 6, overflowWrap: 'anywhere' }}>
            <b>{first.operator ?? 'Counter'} · {sideWord(first.side)} · {first.field_key}{first.role === 'learning' ? ' · training only' : ''}</b>
            {g.kind === 'modern'
              ? <span>{fight ? fightText(fight) : 'Fight no longer listed'} · round {first.round}{first.kind === 'modern' ? `, attempt ${first.generation}` : ''}</span>
              : <span><b>Fight unknown.</b> Saved by an older version of the counter app with no fight attached.{hint ? <> The seat was last assigned to {fightText(hint)}; that is not proof these counts belong to it.</> : null}</span>}
            <span>{g.items.length} action{g.items.length === 1 ? '' : 's'}: {g.items.map(i => actionText(i.action)).join(', ')}</span>
            <details>
              <summary>Saved actions and exact detail</summary>
              <ol>
                {g.items.map(i => (
                  <li key={i.id}>
                    {actionText(i.action)} · round {i.round ?? '?'} · received {new Date(i.received_at).toLocaleString()}{i.kind === 'modern' ? ` · ${i.reason}` : ''}
                    {(typeof i.action.operator==='string'||typeof i.action.recordedAt==='string')&&<span> · Phone reported {typeof i.action.operator==='string'?i.action.operator.slice(0,80):'operator not saved'} at {typeof i.action.recordedAt==='string'?i.action.recordedAt.slice(0,64):'time not saved'} (unverified)</span>}
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{JSON.stringify(i.action)}</code>
                  </li>
                ))}
              </ol>
            </details>
            {canReview ? (
              <>
                <label className="field-in">Decision and reason
                  <input value={reason} maxLength={1000} onChange={e => setReasons(r => ({ ...r, [g.key]: e.target.value }))} />
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-line" disabled={!!busy || reason.trim().length < 3} onClick={() => void review(g, 'noted')}>Record review{g.items.length > 1000 ? ' (first 1,000)' : ''}</button>
                  <button type="button" className="btn btn-line" disabled={!!busy || reason.trim().length < 3} onClick={() => void review(g, 'dismissed')}>Exclude with reason</button>
                </div>
              </>
            ) : <p className="src">Only the organizer can review evidence whose fight is unknown.</p>}
          </div>
        );
      })}
      {reviewed.length > 0 && (
        <details>
          <summary>Reviewed ({reviewed.length})</summary>
          <ul>{reviewed.map(i => <li key={i.id}>{i.operator ?? 'Counter'} · round {i.round ?? '?'} · {i.kind === 'legacy' ? 'fight unknown' : i.fight ? fightText(i.fight) : 'fight no longer listed'}: {i.decision} · {i.review_reason}</li>)}</ul>
        </details>
      )}
      {!!data?.accepted?.length&&<details><summary>Accepted counter action history ({data.accepted.length})</summary>
        <p className="src">Accepted into a counter’s provisional tally. These actions do not award an official score. Phone names and times are unverified reports, kept beside the server record.</p>
        <ol>{data.accepted.map(a=><li key={a.id} style={{overflowWrap:'anywhere'}}>
          {a.fight?fightText(a.fight):'Fight unavailable'} · round {a.round} · {a.count.kind==='tap'?`+${a.count.weight}`:'Undo'}{a.role==='learning'?' · training only':''}
          <div>Server recorded {a.server_operator??'operator unavailable'} at {new Date(a.recorded_at).toLocaleString()}{a.received_at?` · delivery received ${new Date(a.received_at).toLocaleString()}`:''}.</div>
          <div>Phone reported {a.reported?.operator??'operator not saved'} at {a.reported?.recordedAt??'time not saved'} (unverified).</div>
        </li>)}</ol>
      </details>}
    </section>
  );
}
