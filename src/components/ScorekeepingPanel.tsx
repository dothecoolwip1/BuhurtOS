import { Link } from 'react-router-dom';
import type { LiveCompetition } from '../data/api';
import { fetchEventMatches } from '../data/field';
import { fieldLine, fieldOverview } from '../lib/fieldOverview';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

/** Mirrors private.can_score plus the platform owner; the database checks again on every score action. */
export const SCORING_ROLES = ['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'owner'];
export const canScoreWith = (roles: readonly string[] | undefined): boolean => Boolean(roles?.some(r => SCORING_ROLES.includes(r)));

/**
 * The way onto a scoring screen for the people who score: one button per field (ring), with what is queued there.
 * Shown only to event staff who may score. Scorekeepers get no organizer controls here; the links lead to the field queue only.
 */
export function ScorekeepingPanel({ slug, competitions, roles }: { slug: string; competitions: LiveCompetition[]; roles: readonly string[] | undefined }) {
  const allowed = canScoreWith(roles);
  const matches = useAsync(() => (allowed && competitions.length ? fetchEventMatches(competitions) : Promise.resolve([])), [allowed, competitions.map(c => c.id).join(',')]);
  if (!allowed) return null;
  const fields = fieldOverview(matches.data ?? []);
  const scorekeeperOnly = !roles?.some(r => r === 'organizer' || r === 'owner');
  return (
    <section className="panel info" id="scorekeeping" aria-labelledby="score-h" style={{ display: 'grid', gap: 10 }}>
      <h3 id="score-h">Scorekeeping</h3>
      <p className="src">Open the field you are scoring on. The queue there shows the matches an organizer has put on deck, in the hole or active.</p>
      {matches.loading && !matches.data && <p className="muted">Loading the fields…</p>}
      {matches.error != null && <p role="alert">{friendlyError(matches.error, 'Could not load the fields.')}</p>}
      {matches.data && fields.length === 0 && (
        <p className="muted">No field has matches scheduled yet. Fields appear here once the organizer schedules matches on them{scorekeeperOnly ? '; ask an organizer if you expected one' : ' (Manage › Run)'}.</p>
      )}
      {fields.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {fields.map(f => (
            <li key={f.field} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ minWidth: 0 }}><b>{f.field}</b><br /><span className="src">{fieldLine(f)}</span></span>
              <Link className={`btn ${f.queued > 0 ? 'btn-ink' : 'btn-line'}`} to={`/events/${slug}/field/${encodeURIComponent(f.field)}`}>Open {f.field}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
