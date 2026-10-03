import { useEffect, useState } from 'react';
import { Chip } from '../components/ui';
import type { LiveCompetition } from '../data/api';
import { cancelInvitation, fetchEventInvitations, inviteFighter, type EventInvitation } from '../data/invitations';
import { searchFighters, type FighterOption } from '../data/runSchedule';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { countInvitationStates, INVITATION_STATE_LABEL, invitationState, invitationTodo, type InvitationState } from '../registration/invitationView';

const bad: React.CSSProperties = { color: 'var(--live)' };
const TONE: Record<InvitationState, '' | 'win' | 'brass' | 'steel' | 'live'> = { ready: 'win', pending_confirmation: 'brass', no_account: 'steel', withdrawn: '', cancelled: '' };

/**
 * Organizer → Event → Fighters: add a known fighter record to the event (this is NOT staff; staff live on the People tab), see what
 * each added fighter still has to do themselves, and take an invitation back. Real registrations are reviewed on the Review tab.
 */
export function FightersTab({ eventId, competitions, registrationMode }: { eventId: string; competitions: LiveCompetition[]; registrationMode: string }) {
  const [key, setKey] = useState(0);
  const list = useAsync(() => fetchEventInvitations(eventId), [eventId, key]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = list.data ?? [];
  const counts = countInvitationStates(rows);
  const cancel = async (i: EventInvitation) => {
    setBusy(i.id); setProblem(null);
    try { await cancelInvitation(i.id); setKey(k => k + 1); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(null); }
  };
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="addf-h">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 id="addf-h" style={{ margin: 0 }}>Fighters you added</h3>
          {!adding && <button type="button" className="btn btn-ink" data-testid="add-fighter" disabled={registrationMode !== 'buhuros'} onClick={() => { setAdding(true); setNotice(null); }}>+ Add fighter</button>}
        </div>
        <p className="src">Adding a fighter is not the same as adding staff: they are expected to fight, and they still complete the registration form and sign the waiver themselves. Marshals, scorekeepers and medics go on the People tab.</p>
        {registrationMode !== 'buhuros' && <p role="status" className="src">This event does not take registrations on BuhurtOS, so fighters cannot be added here. Change "How do people sign up" in Setup first.</p>}
        {adding && (
          <AddFighterForm eventId={eventId} competitions={competitions} onDone={(n, notified) => { setAdding(false); setKey(k => k + 1); setNotice(notified ? `${n} was added and told in BuhurtOS.` : `${n} was added. This record has no BuhurtOS account, so nobody was notified; the fighter cannot confirm until they claim it.`); }} onCancel={() => setAdding(false)} />
        )}
        {notice && <p role="status" style={{ color: 'var(--win)' }}>{notice}</p>}
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="inv-h">
        <h3 id="inv-h">Where they stand</h3>
        {list.data && rows.length > 0 && (
          <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip tone="win">{counts.ready} ready</Chip><Chip tone="brass">{counts.pending_confirmation} pending</Chip>
            {counts.no_account > 0 && <Chip tone="steel">{counts.no_account} no account</Chip>}{counts.withdrawn > 0 && <Chip>{counts.withdrawn} withdrawn</Chip>}
          </p>
        )}
        {list.loading && !list.data && <p className="muted">Loading…</p>}
        {list.error != null && <p role="alert" style={bad}>{friendlyError(list.error, 'Could not load the list.')}</p>}
        {list.data && rows.length === 0 && <p className="muted">You have not added any fighters yet.</p>}
        {problem && <p role="alert" style={bad}>{problem}</p>}
        <ul className="plain" style={{ display: 'grid', gap: 10 }}>
          {rows.map(i => {
            const state = invitationState(i);
            const todo = invitationTodo(i);
            return (
              <li key={i.id} className="panel" style={{ padding: '12px 14px', display: 'grid', gap: 6 }} data-testid="invitation-row">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <b style={{ overflowWrap: 'anywhere' }}>{i.displayName}</b>
                  <Chip tone={TONE[state]}>{INVITATION_STATE_LABEL[state]}</Chip>
                  {i.teamName && <span className="src">{i.teamName}</span>}
                </div>
                <span className="src">Added by organizer · {i.competitions.map(c => c.name).join(', ') || 'no competition'}{i.note ? ` · "${i.note}"` : ''}</span>
                {todo.length > 0 && <ul className="plain" style={{ display: 'grid', gap: 2, fontSize: 14 }}>{todo.map(t => <li key={t}>• {t}</li>)}</ul>}
                {state === 'ready' && <span className="src">Form submitted and waiver signed. Insurance, fee and check-in are tracked on the Review and Check-in tabs.</span>}
                {i.status === 'invited' && <div><button type="button" className="btn btn-line btn-sm" disabled={busy === i.id} onClick={() => void cancel(i)}>Take back</button></div>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function AddFighterForm({ eventId, competitions, onDone, onCancel }: { eventId: string; competitions: LiveCompetition[]; onDone: (name: string, notified: boolean) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FighterOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<FighterOption | null>(null);
  const [comps, setComps] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2 || picked) { setHits([]); return; }
    let live = true; setSearching(true);
    const t = window.setTimeout(async () => {
      try { const r = await searchFighters(q); if (live) setHits(r); } catch { if (live) setHits([]); } finally { if (live) setSearching(false); }
    }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, picked]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setProblem(null);
    if (!picked) { setProblem('Choose a fighter from the search results.'); return; }
    if (comps.length === 0) { setProblem('Choose at least one competition.'); return; }
    setBusy(true);
    try { const r = await inviteFighter(eventId, picked.fighterId, comps, note.trim() || null); onDone(picked.displayName, r.notified); }
    catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={e => void submit(e)} className="panel" style={{ padding: 14, display: 'grid', gap: 12 }} aria-label="Add a fighter">
      {!picked && (
        <label className="field-in">Search BuhurtOS fighters by name
          <input type="search" inputMode="search" autoComplete="off" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="At least 2 letters" style={{ minHeight: 48, fontSize: 17 }} />
          <span>Only existing fighter records can be added, so nobody is created twice. A fighter who is not here yet can register from the event page.</span>
        </label>
      )}
      {!picked && q.trim().length >= 2 && (
        <ul className="plain" role="listbox" aria-label="Matching fighters" style={{ display: 'grid', gap: 6 }}>
          {searching && hits.length === 0 && <li className="muted">Searching…</li>}
          {!searching && hits.length === 0 && <li className="muted">No fighter with that name. Check the spelling, or ask them to register themselves.</li>}
          {hits.map(h => (
            <li key={h.fighterId}>
              <button type="button" className="btn btn-line" style={{ width: '100%', justifyContent: 'space-between', minHeight: 48 }} onClick={() => setPicked(h)}>
                <span><b>{h.displayName}</b>{h.homeTeamName && <span className="muted"> · {h.homeTeamName}</span>}</span><span aria-hidden="true">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <>
          <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{picked.displayName}</b>{picked.homeTeamName && <span className="muted">{picked.homeTeamName}</span>} <button type="button" className="linklike" onClick={() => { setPicked(null); setQ(''); }}>Change</button></p>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>Competitions they are expected in</legend>
            {competitions.length === 0 && <p className="src">This event has no competitions yet. Add one in Setup first.</p>}
            {competitions.map(c => (
              <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={comps.includes(c.id)} onChange={() => setComps(list => (list.includes(c.id) ? list.filter(x => x !== c.id) : [...list, c.id]))} /> {c.name}
              </label>
            ))}
          </fieldset>
          <label className="field-in">Note for the fighter (optional)<input value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="For example: we need a fifth for the 5v5" /></label>
        </>
      )}
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-ink" disabled={busy || !picked} data-testid="confirm-add-fighter">{busy ? 'Adding…' : 'Add to event'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
