import { useCallback, useState } from 'react';
import { readSavedEvidence, STATUS_LABEL, type EvidenceItem, type KeyedStorage, type SavedRecord } from '../../lib/lyst/localEvidence';
import { CounterJournal,type CounterStorage } from '../../lib/lyst/counterJournal';

/** The browser's storage, or null when it is blocked. */
function browserStorage(): KeyedStorage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

function describe(i: EvidenceItem): string {
  if (i.status === 'unreadable') return 'Entry could not be read';
  const what = i.kind === 'tap' ? `+${i.weight ?? 1}` : 'Undo';
  return `Round ${i.round} · ${what}${i.recovery ? ' · counted offline' : ''}${i.recordedAt ? ` · ${Number.isFinite(Date.parse(i.recordedAt)) ? new Date(i.recordedAt).toLocaleTimeString() : i.recordedAt}` : ''}`;
}

function Copy({ text }: { text: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <span>
      <button type="button" className="btn btn-line btn-sm" onClick={() => {
        void (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => setSaid('Copied.'), () => setSaid('Could not copy: select the text below and copy it.'));
      }}>Copy exact saved text</button>
      {said && <span className="src" role="status"> {said}</span>}
    </span>
  );
}

function EvidenceRecord({ r,onArchive,allowPendingArchive }: { r: SavedRecord;onArchive:(seat:string,ids:string[])=>Promise<boolean>;allowPendingArchive:boolean }) {
  const [archiveNote,setArchiveNote]=useState<string|null>(null);
  const unsentHeld=r.items.filter(i=>(i.status==='held_undelivered'||allowPendingArchive&&i.status==='pending')&&i.id!==null);
  // Group entries by the fight they were counted in, so seat and fight provenance stays visible.
  const byFight = new Map<string, EvidenceItem[]>();
  for (const i of r.items) { const k = i.matchId ?? '(fight not saved)'; byFight.set(k, [...(byFight.get(k) ?? []), i]); }
  const label = (matchId: string) => {
    const c = r.contexts[matchId];
    return c ? [c.event, c.competition, c.fight, c.round_label, c.field, c.operator && `counted by ${c.operator}`].filter(Boolean).join(' · ') : null;
  };
  return (
    <li className="panel info" style={{ display: 'grid', gap: 8, overflowWrap: 'anywhere' }}>
      <b>{r.source === 'journal' ? 'Counter phone record' : 'Older saved tap queue'} · seat {r.seatId}</b>
      {r.superseded && <span className="src">Copied into this seat's newer record when the app updated; kept as a recovery copy.</span>}
      {r.problem && <span role="alert">{r.problem}</span>}
      {(r.source==='journal'||allowPendingArchive&&!r.superseded)&&unsentHeld.length>0&&<div>
        <p className="src">After showing these undelivered counts to the marshal, you can keep them as a local archive. {allowPendingArchive?'This phone has no active device access. Archiving stops retrying these selected actions; keep a copy for the marshal.':'Pending taps stay pending.'} This does not review or change a server score.</p>
        <button type="button" className="btn btn-line btn-sm" onClick={()=>{void onArchive(r.seatId,unsentHeld.map(i=>i.id!)).then(ok=>setArchiveNote(ok?'Archived locally. The exact actions are still kept.':'Could not archive while this seat is open or storage is unavailable. Use Saved count evidence on the active counter screen, or keep a copy.'));}}>I showed these counts to the marshal · archive locally</button>
        {archiveNote&&<p role="status" className="src">{archiveNote}</p>}
      </div>}
      {[...byFight.entries()].map(([fight, items]) => (
        <div key={fight} style={{ display: 'grid', gap: 4 }}>
          <span><b>Fight {fight}</b>{label(fight) ? <> · {label(fight)}</> : null}</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {items.map((i, n) => (
              <li key={i.id ?? `u${n}`}>
                {describe(i)} · <b>{STATUS_LABEL[i.status]}</b>{i.reason ? ` · ${i.reason}` : ''}
                {i.raw && <code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{i.raw}</code>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {r.accepted.length > 0 && (
        <div>
          <span>Accepted by the server for this seat (the counter's own tally, not an official score):</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{r.accepted.map(a => <li key={`${a.matchId}:${a.round}`}>Fight {a.matchId ?? '(not saved)'} · round {a.round}: {a.total}</li>)}</ul>
        </div>
      )}
      {r.readable && r.items.length === 0 && r.accepted.length === 0 && <span className="src">Nothing counted in this record.</span>}
      <details>
        <summary>Exact saved text</summary>
        <Copy text={r.raw} />
        <textarea readOnly value={r.raw} rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} aria-label={`Exact saved text for seat ${r.seatId}`} />
      </details>
    </li>
  );
}

/**
 * Saved counter evidence on this browser: no network, no sign-in needed. An explicit archive marks held actions after a human handoff; nothing is deleted.
 * It stays available after a seat change, a replaced device,
 * a sign-out or a withdrawn code, and grants nothing: the marshal decides what any of it means. There is deliberately no delete or clear control.
 */
export function SavedCounterEvidence({ storage,showEmpty=false,allowPendingArchive=false }: { storage?: KeyedStorage | null;showEmpty?:boolean;allowPendingArchive?:boolean }) {
  const read = useCallback(() => { const s = storage === undefined ? browserStorage() : storage; return s ? readSavedEvidence(s) : []; }, [storage]);
  const [records, setRecords] = useState<SavedRecord[]>(read);
  const archive=async(seat:string,ids:string[])=>{
    const s=storage===undefined?browserStorage():storage;
    if(!s || !('setItem' in s) || typeof s.setItem!=='function'||!navigator.locks)return false;
    let saved=false;
    await navigator.locks.request(`bos-counter-tab:${seat}`,{ifAvailable:true},async lock=>{
      if(!lock)return;
      const journal=new CounterJournal(seat,s as KeyedStorage&CounterStorage);
      saved=journal.archiveShownEvidence(new Set(ids),allowPendingArchive);journal.close();
    });
    setRecords(read());return saved;
  };
  if (records.length === 0 && !showEmpty) return null;
  const waiting = records.reduce((n, r) => n + (r.source === 'legacy' && r.superseded ? 0 : r.items.filter(i => i.status === 'pending' || i.status === 'held_undelivered').length), 0);
  const unknown = records.some(r => !r.readable || r.items.some(i => i.status === 'unreadable'));
  return (
    <details className="panel info" data-testid="saved-counter-evidence" style={{ display: 'grid', gap: 8 }} onToggle={e=>{if(e.currentTarget.open)setRecords(read());}}>
      <summary><b>Saved counter evidence</b> · {records.length} record{records.length === 1 ? '' : 's'}{waiting ? ` · ${waiting} not on the server` : ''}{unknown ? ' · some could not be read' : ''}</summary>
      <p className="src">Kept on this phone. Show it to the marshal or copy it for them. It is not an official score and does not sign this phone in.</p>
      {records.length===0 && <p className="src">No saved counter records were found.</p>}
      <button type="button" className="btn btn-line btn-sm" onClick={() => setRecords(read())}>Check again</button>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {records.map(r => <EvidenceRecord key={r.key} r={r} onArchive={archive} allowPendingArchive={allowPendingArchive} />)}
      </ul>
    </details>
  );
}
