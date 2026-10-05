import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { Chip, Seg } from '../components/ui';
import type { LiveCompetition, LiveEvent } from '../data/api';
import {
  closeEvent, fetchClosePreflight, fetchFinalizePreflight, finalizeCompetition, reopenCompetition, reopenEvent,
  type ClosePreflight, type FinalizePreflight, type MultiplierSource, type Placement
} from '../data/finalization';
import { categoryLabel, divisionLabel } from '../lib/careerView';
import { buildPodium, closeoutSummary, finalizeAction, nextReady, placeWord, pointsText, reasonOk, representedLine, unattributedFighters } from '../lib/finalization';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;
const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const SOURCES: ReadonlyArray<readonly [MultiplierSource, string]> = [['tournament_structure', 'Tournament structure'], ['league_structure', 'League structure']];
const STATE_LABEL: Record<FinalizePreflight['state'], string> = { official: 'Official', ready: 'Ready to finalize', blocked: 'Needs review', running: 'In progress' };

/**
 * Manage › Results: the organizer makes a competition's placings official, takes one back, and closes the event. Every list here is the server's
 * (competition_finalize_preflight / event_close_preflight); the buttons call finalize_competition, reopen_competition, close_event, reopen_event,
 * which check the caller again. Ringside, one-handed: the state and the one next action lead; detail follows.
 */
export function FinalizeTab({ event, competitions, onChanged }: { event: LiveEvent; competitions: LiveCompetition[]; onChanged: () => void }) {
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const closeout = useAsync(() => fetchClosePreflight(event.id), [event.id, version, event.closedAt, competitions.map(c => `${c.id}:${c.status}`).join(',')]);
  const list = closeout.data?.competitions ?? [];
  const wanted = params.get('competition');
  const picked = competitions.find(c => c.id === wanted) ?? competitions.find(c => list.find(l => l.id === c.id)?.state === 'ready') ?? competitions[0] ?? null;
  const pick = (id: string) => { const next = new URLSearchParams(params); next.set('tab', 'finalize'); next.set('competition', id); setParams(next, { replace: true }); };
  const changed = () => { setVersion(v => v + 1); onChanged(); };
  const stateOf = (id: string) => list.find(l => l.id === id)?.state;
  const marker = (id: string) => ({ official: ' ✓', ready: ' ●', running: '', no_draw: '' } as Record<string, string>)[stateOf(id) ?? ''] ?? '';

  return (
    <section style={{ display: 'grid', gap: 18 }} aria-label="Results and closeout">
      {closeout.data?.closed && <ClosedBanner event={event} pre={closeout.data} onChanged={changed} />}
      {closeout.data && !closeout.data.closed && closeout.data.ready && (
        <p className="panel info" role="status"><b>Every competition is official.</b> When you are done, <a href="#closeout">close the event</a> and it becomes the permanent record.</p>
      )}
      {competitions.length === 0 && <div className="panel info"><h3>No competitions yet</h3><p>Add the competitions first; their results are made official here.</p></div>}
      {competitions.length > 0 && (
        <Seg scroll label="Competition" value={picked?.id ?? ''} options={competitions.map(c => [c.id, `${c.name}${marker(c.id)}`] as const)} onChange={pick} />
      )}
      {picked && (
        <ReviewPanel key={`${picked.id}-${picked.status}-${picked.finalizedAt ?? ''}-${version}`} slug={event.slug} competition={picked} eventClosed={!!event.closedAt}
          nextId={nextReady(list, picked.id)} onPick={pick} onChanged={changed} />
      )}
      {!closeout.data?.closed && <CloseoutCard event={event} pre={closeout.data} loading={closeout.loading} error={closeout.error} onPick={pick} onChanged={changed} />}
    </section>
  );
}

// ---------------------------------------------------------------- one competition
function ReviewPanel({ slug, competition, eventClosed, nextId, onPick, onChanged }: {
  slug: string; competition: LiveCompetition; eventClosed: boolean; nextId: string | null; onPick: (id: string) => void; onChanged: () => void;
}) {
  const [source, setSource] = useState<MultiplierSource>(competition.status === 'finished' ? 'tournament_structure' : 'tournament_structure');
  const [reload, setReload] = useState(0);
  const pre = useAsync(() => fetchFinalizePreflight(competition.id, source), [competition.id, source, reload]);
  const p = pre.data;
  useEffect(() => { if (p?.competition.multiplierSource && p.state === 'official') setSource(p.competition.multiplierSource); }, [p?.competition.multiplierSource, p?.state]);
  const [confirm, setConfirm] = useState<'finalize' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const podium = useMemo(() => buildPodium(p?.placements ?? []), [p?.placements]);
  const action = p ? finalizeAction({ state: p.state, eventClosed }) : null;
  const unattributed = p ? unattributedFighters(p) : [];

  const finalize = async () => {
    setBusy(true); setProblem(null);
    try {
      const r = await finalizeCompetition(competition.id, source);
      setDone(r.status === 'official' ? `Official. ${r.entries} placings are now the record.` : 'Another organizer already made this official. Showing the official placings.');
      setConfirm(null); setReload(k => k + 1); onChanged();
    } catch (e) { setProblem(friendlyError(e, 'Could not make the result official.')); } finally { setBusy(false); }
  };
  const reopen = async () => {
    setBusy(true); setProblem(null);
    try { await reopenCompetition(competition.id, reason); setDone('Reopened. The placings are no longer official; correct what is needed and finalize again.'); setConfirm(null); setReason(''); setReload(k => k + 1); onChanged(); }
    catch (e) { setProblem(friendlyError(e, 'Could not reopen the result.')); } finally { setBusy(false); }
  };

  return (
    <section className="panel info" aria-labelledby="rv-h" style={{ display: 'grid', gap: 14 }}>
      <div className="ofc-head">
        <h2 id="rv-h" style={{ fontSize: 22 }}>{competition.name}</h2>
        <Chip>{categoryLabel(competition.category)}</Chip><Chip>{divisionLabel(competition.gender)}</Chip>
      </div>
      {pre.loading && !p && <p className="muted">Checking the competition…</p>}
      {pre.error != null && <p role="alert" style={errorStyle}>{friendlyError(pre.error, 'Could not check this competition.')}</p>}
      {done && <p role="status" className="panel" style={{ padding: '10px 12px' }}>{done}</p>}
      {p && (
        <>
          <div className={`fz-state ${p.state}`} role="status">
            <span className="big">{p.state === 'official' ? 'Competition official' : STATE_LABEL[p.state]}</span>
            <span>
              {p.matches.final} of {p.matches.total} fights have a result
              {p.state === 'official' && p.competition.finalizedAt && <> · official since {when(p.competition.finalizedAt)}</>}
              {p.competition.reopenedAt && p.state !== 'official' && <> · reopened {when(p.competition.reopenedAt)}</>}
            </span>
            {p.state === 'official' && (
              <div className="fz-actions">
                <Link className="btn btn-ink" to={`/events/${slug}#results-${competition.id}`}>View official results</Link>
                <Link className="btn btn-line" to={`/events/${slug}/manage?tab=eventday`}>Back to Event day</Link>
                {nextId && <button type="button" className="btn btn-line" onClick={() => onPick(nextId)}>Finalize the next competition</button>}
                {!eventClosed && <button type="button" className="btn btn-line" onClick={() => { setConfirm('reopen'); setProblem(null); }}>Reopen…</button>}
              </div>
            )}
          </div>

          {p.blockers.length > 0 && (
            <div>
              <p className="eyebrow">Before this can be official</p>
              <ul className="fz-list">{p.blockers.map(b => <li key={b.code}><span className="fz-dot block" aria-hidden="true" /><span><b>{b.text}</b>{b.code === 'result_conflicts' && <> <Link to={`/events/${slug}/manage?tab=eventday`}>Review on Event day</Link></>}{(b.code === 'medal_tie' || b.code === 'bracket_missing' || b.code === 'open_matches' || b.code === 'live_matches') && <> <Link to={`/events/${slug}/manage?tab=run`}>Open the Run tools</Link></>}</span></li>)}</ul>
            </div>
          )}
          {p.warnings.length > 0 && (
            <div>
              <p className="eyebrow">Good to know (does not stop the result)</p>
              <ul className="fz-list">{p.warnings.map(w => <li key={w.code}><span className="fz-dot warn" aria-hidden="true" /><span>{w.text}</span></li>)}</ul>
              {unattributed.length > 0 && (
                <p className="src">No team recorded for: {unattributed.map(f => f.name).join(', ')}. If the entry list shows their team, record it under <Link to={`/events/${slug}/manage?tab=run`}>Run › Teams represented</Link>; the placing stays official either way.</p>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            <p className="eyebrow">{p.state === 'official' ? 'Official placings' : 'Placings as they would be recorded'}</p>
            {podium.steps.length === 0 && <p className="muted">No placings can be computed yet.</p>}
            {podium.steps.length > 0 && (
              <ol className={`podium ${podium.steps.length === 1 ? 'one' : podium.steps.length === 2 ? 'two' : ''}`.trim()} aria-label="Podium">
                {podium.steps.map(s => (
                  <li key={s.place} className={`pd-step ${s.medal}`}>
                    <span className="pd-place" aria-hidden="true">{s.place}</span>
                    <span className="pd-label">{s.label}{s.shared ? ' · shared' : ''}</span>
                    {s.entries.map(e => <PlacementLine key={e.entryId} e={e} />)}
                  </li>
                ))}
              </ol>
            )}
            {podium.rest.length > 0 && (
              <ol className="pd-list" aria-label="Full placings">
                {podium.rest.flatMap(g => g.entries.map(e => (
                  <li key={e.entryId} className="pd-row">
                    <span className="rk" aria-label={placeWord(g.place, g.shared)}>{g.place}</span>
                    <span style={{ minWidth: 0 }}><span className="pd-name">{e.name}{e.status === 'disqualified' && <> <Chip tone="live">Disqualified</Chip></>}</span><span className="pd-sub">{g.shared ? `${placeWord(g.place, true)} · ` : ''}{e.kind === 'fighter' ? representedLine(e) : 'Team'}</span></span>
                    <span className="pd-pts">{pointsText(e.points)}</span>
                  </li>
                )))}
              </ol>
            )}
            <p className="src">
              Points: {p.competition.tier ? <>tier <b>{p.competition.tier}</b>, multiplier <b>{p.multiplier ?? 0}</b> ({SOURCES.find(([k]) => k === p.source)?.[1]})</> : <>no tier, so every placing is worth 0</>}. The formula is the league's and is not edited here.
            </p>
            {p.state !== 'official' && p.competition.tier && (
              <label className="field-in" style={{ maxWidth: 360 }}>Multiplier table
                <select value={source} onChange={e => setSource(e.target.value as MultiplierSource)} disabled={busy}>{SOURCES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
              </label>
            )}
          </div>

          {action && p.state !== 'official' && (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              <button type="button" className="btn btn-ink fz-big" disabled={!action.enabled || busy} onClick={() => { setConfirm('finalize'); setProblem(null); }}>{action.label}</button>
              {action.reason && <span className="src">{action.reason}</span>}
            </div>
          )}
          {problem && <p role="alert" style={errorStyle}>{problem}</p>}
        </>
      )}

      {confirm === 'finalize' && p && (
        <Dialog title={`Make ${competition.name} official?`} onClose={() => setConfirm(null)} busy={busy}>
          <div style={{ display: 'grid', gap: 12 }}>
            <p>{podium.steps[0]?.entries.map(e => e.name).join(' and ') ?? 'Nobody'} {podium.steps[0]?.entries.length === 1 ? 'is' : 'are'} the champion; {p.placements.length} placings and their ranking points become the record and count in the rankings. You can reopen it later with a reason if something was wrong.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink fz-big" data-autofocus disabled={busy} onClick={() => void finalize()}>{busy ? 'Saving…' : 'Yes, make it official'}</button>
              <button type="button" className="btn btn-line fz-big" disabled={busy} onClick={() => setConfirm(null)}>Not yet</button>
            </div>
            {problem && <p role="alert" style={errorStyle}>{problem}</p>}
          </div>
        </Dialog>
      )}
      {confirm === 'reopen' && (
        <Dialog title={`Reopen ${competition.name}?`} onClose={() => setConfirm(null)} busy={busy}>
          <form style={{ display: 'grid', gap: 12 }} onSubmit={e => { e.preventDefault(); if (reasonOk(reason)) void reopen(); }}>
            <p>The placings stop being official and leave the rankings until you finalize again. Every version stays in the record with your reason.</p>
            <label className="field-in">Why is it being reopened?
              <input type="text" value={reason} maxLength={200} data-autofocus placeholder="e.g. the final was scored for the wrong fighter" onChange={e => setReason(e.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-ink fz-big" disabled={busy || !reasonOk(reason)}>{busy ? 'Reopening…' : 'Reopen the result'}</button>
              <button type="button" className="btn btn-line fz-big" disabled={busy} onClick={() => setConfirm(null)}>Keep it official</button>
            </div>
            {problem && <p role="alert" style={errorStyle}>{problem}</p>}
          </form>
        </Dialog>
      )}
    </section>
  );
}

function PlacementLine({ e }: { e: Placement }) {
  return (
    <span className="pd-entry">
      <span className="pd-name">{e.name}{e.status === 'disqualified' && <> <Chip tone="live">Disqualified</Chip></>}</span>
      <span className="pd-sub">{e.kind === 'fighter' ? representedLine(e) : 'Team'}</span>
      <span className="pd-pts">{pointsText(e.points)} <small>pts</small></span>
    </span>
  );
}

// ---------------------------------------------------------------- the event
function CloseoutCard({ event, pre, loading, error, onPick, onChanged }: {
  event: LiveEvent; pre: ClosePreflight | undefined; loading: boolean; error: unknown; onPick: (id: string) => void; onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const summary = pre ? closeoutSummary(pre) : null;
  const close = async () => {
    setBusy(true); setProblem(null);
    try { await closeEvent(event.id, note); setConfirm(false); onChanged(); }
    catch (e) { setProblem(friendlyError(e, 'Could not close the event.')); } finally { setBusy(false); }
  };
  return (
    <section id="closeout" className="panel info" aria-labelledby="co-h" style={{ display: 'grid', gap: 12, scrollMarginTop: 72 }}>
      <h2 id="co-h" style={{ fontSize: 22 }}>Close the event</h2>
      <p className="src">Closing makes {event.name} permanent history: every competition is official, nothing operational can change, and the public page becomes the results page. It can be reopened later, with a reason.</p>
      {loading && !pre && <p className="muted">Checking…</p>}
      {error != null && <p role="alert" style={errorStyle}>{friendlyError(error, 'Could not check the event.')}</p>}
      {pre && summary && (
        <>
          <ul className="fz-list" aria-label="Competitions">
            {pre.competitions.map(c => (
              <li key={c.id}>
                <span className={`fz-dot ${c.state === 'official' ? 'ok' : c.state === 'no_draw' ? 'warn' : 'block'}`} aria-hidden="true" />
                <span><b>{c.name}</b> · {c.state === 'official' ? 'official' : c.state === 'ready' ? 'ready to finalize' : c.state === 'no_draw' ? 'never ran (no draw)' : `in progress, ${c.final} of ${c.total} fights`}
                  {c.state === 'ready' && <> <button type="button" className="linklike" onClick={() => onPick(c.id)}>Review</button></>}</span>
              </li>
            ))}
          </ul>
          {pre.blockers.length > 0 && <ul className="fz-list" aria-label="What stops the closeout">{pre.blockers.map(b => <li key={b.code}><span className="fz-dot block" aria-hidden="true" /><b>{b.text}</b></li>)}</ul>}
          {pre.warnings.length > 0 && <ul className="fz-list" aria-label="Warnings">{pre.warnings.map(w => <li key={w.code}><span className="fz-dot warn" aria-hidden="true" /><span>{w.text}</span></li>)}</ul>}
          <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <button type="button" className="btn btn-ink fz-big" disabled={!pre.ready || busy} onClick={() => { setConfirm(true); setProblem(null); }}>Close event</button>
            {!pre.ready && <span className="src">{summary.open > 0 ? `${summary.open} competition${summary.open === 1 ? ' is' : 's are'} not official yet.` : pre.blockers[0]?.text ?? ''}</span>}
          </div>
        </>
      )}
      {problem && <p role="alert" style={errorStyle}>{problem}</p>}
      {confirm && pre && (
        <Dialog title={`Close ${event.name}?`} onClose={() => setConfirm(false)} busy={busy}>
          <form style={{ display: 'grid', gap: 12 }} onSubmit={e => { e.preventDefault(); void close(); }}>
            <p>{summary?.official ?? 0} official competition{summary?.official === 1 ? '' : 's'} become the permanent record of this event. Fights, queues and entrants are locked. Reopening later needs a reason.</p>
            {pre.warnings.length > 0 && <ul className="fz-list">{pre.warnings.map(w => <li key={w.code}><span className="fz-dot warn" aria-hidden="true" /><span>{w.text}</span></li>)}</ul>}
            <label className="field-in">A note for the record (optional)
              <input type="text" value={note} maxLength={200} data-autofocus placeholder="e.g. paper sheets filed" onChange={e => setNote(e.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-ink fz-big" disabled={busy}>{busy ? 'Closing…' : 'Yes, close the event'}</button>
              <button type="button" className="btn btn-line fz-big" disabled={busy} onClick={() => setConfirm(false)}>Not yet</button>
            </div>
            {problem && <p role="alert" style={errorStyle}>{problem}</p>}
          </form>
        </Dialog>
      )}
    </section>
  );
}

function ClosedBanner({ event, pre, onChanged }: { event: LiveEvent; pre: ClosePreflight; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reopen = async () => {
    setBusy(true); setProblem(null);
    try { await reopenEvent(event.id, reason); setConfirm(false); setReason(''); onChanged(); }
    catch (e) { setProblem(friendlyError(e, 'Could not reopen the event.')); } finally { setBusy(false); }
  };
  return (
    <section className="fz-state official" role="status" aria-label="Event closed">
      <span className="big">Event closed · official results</span>
      <span>Closed {when(pre.event.closedAt)}. This event is permanent history: {pre.competitions.filter(c => c.state === 'official').length} official competitions. Nothing operational can change.</span>
      <div className="fz-actions">
        <Link className="btn btn-ink" to={`/events/${event.slug}`}>View the results page</Link>
        <button type="button" className="btn btn-line" onClick={() => { setConfirm(true); setProblem(null); }}>Reopen the event…</button>
      </div>
      {problem && <p role="alert" style={errorStyle}>{problem}</p>}
      {confirm && (
        <Dialog title={`Reopen ${event.name}?`} onClose={() => setConfirm(false)} busy={busy}>
          <form style={{ display: 'grid', gap: 12 }} onSubmit={e => { e.preventDefault(); if (reasonOk(reason)) void reopen(); }}>
            <p>This is for correcting the record: the event stops being closed so a competition can be reopened and refinalized. It is written to the audit history with your reason.</p>
            <label className="field-in">Why is it being reopened?
              <input type="text" value={reason} maxLength={200} data-autofocus placeholder="e.g. a result was contested after closing" onChange={e => setReason(e.target.value)} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-ink fz-big" disabled={busy || !reasonOk(reason)}>{busy ? 'Reopening…' : 'Reopen the event'}</button>
              <button type="button" className="btn btn-line fz-big" disabled={busy} onClick={() => setConfirm(false)}>Keep it closed</button>
            </div>
            {problem && <p role="alert" style={errorStyle}>{problem}</p>}
          </form>
        </Dialog>
      )}
    </section>
  );
}
