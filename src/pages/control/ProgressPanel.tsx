import { Link } from 'react-router-dom';
import type { CompetitionProgress } from '../../lib/eventDay';
import { RECORD_LABEL, type RecordState } from '../../lib/finalization';

/**
 * Competition progress on Live ops: how far each competition has got and, the moment every fight is done, the review that makes it official.
 * An offered competition with no draw is one line, not a card each (nobody entered, or it is waiting to be built).
 */
export function ProgressPanel({ progress, records, checks, runHref, resultsHref, buildHref, closed, allOfficial, onReview }: {
  progress: CompetitionProgress[]; records: ReadonlyMap<string, RecordState>; checks: ReadonlyMap<string, string | null>; runHref: string; resultsHref: string; buildHref: string; closed: boolean; allOfficial: boolean;
  /** The organizer's review sheet; absent for staff who may only look. */
  onReview?: (competitionId: string) => void;
}) {
  const unbuilt = closed ? [] : progress.filter(p => p.total === 0);
  const shown = closed ? progress : progress.filter(p => p.total > 0);
  return (
    <section className="panel info ed-progress" aria-labelledby="ed-prog-h" style={{ display: 'grid', gap: 10 }} data-testid="progress-panel">
      <h2 id="ed-prog-h" className="ed-h">Competition progress</h2>
      {closed && <p className="ed-calm" role="status"><b>This event is closed.</b> Its results are the permanent record. <Link to={resultsHref}>See the results and closeout</Link></p>}
      {!closed && allOfficial && onReview && <p role="status" style={{ margin: 0 }}><b>Every competition is official.</b> <Link className="btn btn-ink btn-sm" to={`${resultsHref}#closeout`}>Close the event</Link></p>}
      {unbuilt.length > 0 && <p className="src">Not built: {unbuilt.map(p => p.name).join(', ')}. {onReview && <Link to={buildHref}>Build tournament</Link>}</p>}
      <ul className="ed-prog-list">
        {shown.map(p => {
          const record = records.get(p.id) ?? 'running';
          const blocker = record === 'ready' ? checks.get(p.id) ?? null : null;
          const phase = record === 'official' ? 'official' : record === 'ready' ? (blocker ? 'blocked' : 'ready') : record === 'reopened' ? 'reopened' : p.phase;
          const label = record === 'official' ? 'Official' : record === 'ready' ? (blocker ? 'Needs review' : 'Ready to finalize') : record === 'reopened' ? RECORD_LABEL.reopened : p.label;
          return (
            <li key={p.id}>
              <div className="ed-prog-head"><b>{p.name}</b><span className={`ed-phase ed-phase-${phase}`}>{label}</span></div>
              {p.total > 0 && (
                <div className="ed-bar" role="progressbar" aria-label={`${p.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}><i style={{ width: `${p.percent}%` }} /></div>
              )}
              <span className="src">{p.total > 0 ? `${p.final} / ${p.total} fights complete · ${p.percent}%` : closed ? 'Never ran: no draw was built, so it was closed as not held.' : 'Build a draw to see its fights here.'}{blocker ? ` · ${blocker}` : ''}</span>
              {p.needsBracket && !closed && onReview && <Link className="btn btn-line btn-sm" to={runHref}>Build the bracket</Link>}
              {record === 'ready' && onReview && <button type="button" className={`btn ${blocker ? 'btn-line' : 'btn-ink'} btn-sm`} onClick={() => onReview(p.id)}>Review wins &amp; losses</button>}
              {record === 'official' && <Link className="btn btn-line btn-sm" to={`${resultsHref}&competition=${p.id}`}>Official results</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
