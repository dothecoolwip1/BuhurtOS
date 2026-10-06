import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from './Dialog';
import { TieDecision } from './TieDecision';
import type { LiveCompetition, LiveEvent } from '../data/api';
import { fetchFinalizePreflight, finalizeCompetition } from '../data/finalization';
import { fetchCompetitionMatches, fetchEntries, fetchPoolStandings } from '../data/matches';
import { friendlyError } from '../lib/friendlyError';
import { pointsText } from '../lib/finalization';
import { tiesWithin } from '../lib/runDraw';
import { useAsync } from '../lib/useAsync';
import { boutLine, compareTwo, recordLine, reviewRows, winLossRecords, type ReviewRow } from '../lib/winLoss';

/**
 * Review wins & losses (Pack 09D). Opens when every fight of a competition is done: each competitor's record, who they fought and how it went, the place
 * and points the server calculated, a side-by-side comparison, and then Confirm results, which is Pack 09C's finalize_competition (the one way a result
 * becomes official). A tie that needs a person goes to the existing tie decision; nothing here guesses a placing.
 */
export function ReviewSheet({ event, competition, onClose, onChanged }: { event: LiveEvent; competition: LiveCompetition; onClose: () => void; onChanged: () => void }) {
  const [reload, setReload] = useState(0);
  const pre = useAsync(() => fetchFinalizePreflight(competition.id), [competition.id], [reload]);
  const data = useAsync(async () => {
    const [entries, matches] = await Promise.all([fetchEntries(competition.id), fetchCompetitionMatches(competition.id)]);
    return { entries, matches };
  }, [competition.id, reload]);
  const p = pre.data;
  const rows = useMemo(() => (data.data && p ? reviewRows(winLossRecords(data.data.entries, data.data.matches), p.placements) : []), [data.data, p]);
  const medalTie = !!p?.blockers.some(b => b.code === 'medal_tie');
  const standings = useAsync(() => (medalTie ? fetchPoolStandings(competition.id) : Promise.resolve([])), [medalTie, competition.id], [reload]);
  const ties = useMemo(() => tiesWithin(standings.data ?? [], 3), [standings.data]);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const champion = rows.filter(r => r.place === 1).map(r => r.name).join(' and ');
  const pick = (id: string) => setPicked(x => (x.includes(id) ? x.filter(y => y !== id) : [...x.slice(-1), id]));
  const pair = picked.length === 2 ? [rows.find(r => r.entryId === picked[0])!, rows.find(r => r.entryId === picked[1])!] as const : null;
  const nameOf = (id: string) => rows.find(r => r.entryId === id)?.name ?? 'Unknown entry';

  const confirm = async () => {
    setBusy(true); setProblem(null);
    try {
      const r = await finalizeCompetition(competition.id);
      setDone(r.status === 'official' ? `${competition.name} is official. ${r.entries} placings are now the record.` : 'Another organizer already confirmed these results. They are official.');
      setConfirming(false); setReload(k => k + 1); onChanged();
    } catch (e) { setProblem(friendlyError(e, 'Could not confirm the results.')); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={`Review wins & losses: ${competition.name}`} onClose={onClose} variant="drawer" busy={busy}>
      <div className="rw" style={{ display: 'grid', gap: 14 }}>
        {(pre.loading || data.loading) && !rows.length && <p className="muted">Reading every fight…</p>}
        {pre.error != null && <p role="alert">{friendlyError(pre.error, 'Could not check this competition.')}</p>}
        {data.error != null && <p role="alert">{friendlyError(data.error, 'Could not read the fights.')}</p>}

        {done && (
          <div className="fz-state official" role="status">
            <span className="big">Official</span><span>{done}</span>
            <div className="fz-actions">
              <Link className="btn btn-ink" to={`/events/${event.slug}#results-${competition.id}`} onClick={onClose}>View the podium</Link>
              <button type="button" className="btn btn-line" onClick={onClose}>Next</button>
            </div>
          </div>
        )}

        {p && !done && (
          <p className="rw-lede">
            {p.state === 'official' ? 'These results are official.' : `${p.matches.final} of ${p.matches.total} fights are done.`}
            {p.state === 'ready' && ' Check who won, then confirm.'}
          </p>
        )}

        {p && p.state !== 'official' && p.blockers.length > 0 && !done && (
          <div className="rw-block" role="alert">
            <b>Before you can confirm:</b>
            <ul>{p.blockers.map(b => <li key={b.code}>{b.text}</li>)}</ul>
            {medalTie && <p className="src">Equal records at the top. BuhurtOS will not guess: decide the order below (with a short note), then confirm.</p>}
            {medalTie && ties.map(g => <TieDecision key={`${g.part}-${g.rank}`} comp={competition} group={g} nameOf={nameOf} onDecided={() => { setReload(k => k + 1); onChanged(); }} />)}
            {!medalTie && <Link className="btn btn-line" to={`/events/${event.slug}/manage?tab=finalize&competition=${competition.id}`} onClick={onClose}>Resolve it</Link>}
          </div>
        )}

        {rows.length > 0 && (
          <ol className="rw-list" aria-label="Every competitor">
            {rows.map(r => <Row key={r.entryId} r={r} open={open === r.entryId} onToggle={() => setOpen(o => (o === r.entryId ? null : r.entryId))} compare={picked.includes(r.entryId)} onCompare={() => pick(r.entryId)} />)}
          </ol>
        )}

        {pair && (
          <section className="panel info rw-compare" aria-label="Compare">
            <b>{pair[0].name} vs {pair[1].name}</b>
            <div className="rw-two">
              {pair.map(x => <div key={x.entryId}><b>{x.name}</b><span>{recordLine(x)}</span><span className="src">{x.placeText}{x.points !== null ? ` · ${pointsText(x.points)} pts` : ''}</span></div>)}
            </div>
            <p>{compareTwo(pair[0], pair[1]).line}</p>
            {compareTwo(pair[0], pair[1]).meetings.map(b => <p key={b.matchId} className="src">{b.round}: {pair[0].name} {boutLine(b).replace(/^(Won|Lost) vs|^Tied with/, m => m.toLowerCase())}</p>)}
          </section>
        )}
        {rows.length > 1 && !pair && <p className="src">Tip: tick “Compare” on two competitors to see them side by side.</p>}

        {p && p.state === 'ready' && !done && (
          <div className="dlg-actions sticky rw-actions">
            {!confirming && <button type="button" className="btn btn-ink fz-big" disabled={busy} onClick={() => { setConfirming(true); setProblem(null); }}>Confirm results</button>}
            {confirming && (
              <div role="alertdialog" aria-label="Confirm results" style={{ display: 'grid', gap: 8 }}>
                <p><b>Make {competition.name} official?</b> {champion ? `${champion} ${champion.includes(' and ') ? 'share' : 'is'} the champion. ` : ''}{rows.filter(r => r.place !== null).length} placings and their points become the record. You can still correct them later with a reason.</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void confirm()}>{busy ? 'Confirming…' : 'Yes, confirm results'}</button>
                  <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirming(false)}>Not yet</button>
                </div>
              </div>
            )}
            {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Row({ r, open, onToggle, compare, onCompare }: { r: ReviewRow; open: boolean; onToggle: () => void; compare: boolean; onCompare: () => void }) {
  return (
    <li className={`rw-row${r.place === 1 ? ' gold' : ''}${r.shared ? ' shared' : ''}`}>
      <button type="button" className="rw-main" aria-expanded={open} onClick={onToggle}>
        <span className="rw-place">{r.place ?? '–'}</span>
        <span className="rw-who"><b>{r.name}</b><span>{recordLine(r)}</span></span>
        <span className="rw-pts">{r.placeText}{r.points !== null && <small>{pointsText(r.points)} pts</small>}</span>
      </button>
      <label className="rw-cmp"><input type="checkbox" checked={compare} onChange={onCompare} /> Compare</label>
      {open && (
        <ul className="rw-bouts" aria-label={`${r.name}: every fight`}>
          {r.bouts.length === 0 && <li className="src">No finished fights.</li>}
          {r.bouts.map(b => <li key={b.matchId} className={`rw-bout ${b.outcome}`}><span>{boutLine(b)}</span><span className="src">{b.round}</span></li>)}
        </ul>
      )}
    </li>
  );
}
