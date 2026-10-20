import { Link } from 'react-router-dom';
import { Chip, TestBadge } from '../../components/ui';
import type { LiveEvent } from '../../data/api';
import { dateRange } from '../../lib/dates';
import { PHASE_TONE, VIEW_WORD, controlPath, publicEventPresentation, viewPath, type EventPhase, type PublicView } from '../../lib/eventPhaseView';

export interface HeaderCta { to: string; label: string; tone?: 'ink' | 'line' | 'win' }

/**
 * The event header (Pack 25): the first phone viewport carries what matters, nothing decorative. Name, status, dates, venue, the one primary action
 * for this phase, the three destinations (Overview, Live, Results) and, for staff, ONE door: Event Control. The fighter's own next-fight strip is
 * rendered by the page above the destinations, so it is never missed while the event is live.
 */
export function EventHeader({ event, phase, view, cta, control, synthetic, connection, cost }: {
  event: LiveEvent; phase: EventPhase; view: PublicView; cta: HeaderCta | null;
  /** The staff door: shown only to people with a role on this event. */
  control: boolean; synthetic: boolean;
  /** While the event is live: the live connection word for the status row. */
  connection?: 'connecting' | 'live' | 'polling' | null;
  cost?: string | null;
}) {
  const where = [event.venue, [event.city, event.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  return (
    <header className={`ev-head phase-${phase}`} data-testid="event-header">
      <div className="ev-top">
        <div className="ev-status">
          <Chip tone={PHASE_TONE[phase]}>{publicEventPresentation(event).label}</Chip>
          {event.archivedAt && <Chip tone="brass">Archived</Chip>}
          <TestBadge synthetic={synthetic} />
        </div>
        {control && <Link className="btn btn-line ev-control" to={controlPath(event.slug)} data-testid="open-control">Event Control</Link>}
      </div>
      <h1 className="ev-title">{event.name}</h1>
      <p className="ev-facts">
        <span className="ev-when">{dateRange(event.startsOn, event.endsOn)}</span>
        {where && <span className="ev-where">{where}</span>}
        {phase === 'live' && connection && <span className={`ev-conn is-${connection}`} role="status">{connection === 'live' ? 'Updating live' : connection === 'polling' ? 'Updating every few seconds' : 'Connecting'}</span>}
      </p>
      {(cost || (event.registrationClosesAt && phase === 'upcoming')) && <div className="ev-practical">
        {cost && <p><b>Cost</b><span>{cost}</span></p>}
        {event.registrationClosesAt && phase === 'upcoming' && <p><b>Registration deadline</b><span>{new Date(event.registrationClosesAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone ?? 'America/Edmonton' })} ({event.timezone ?? 'America/Edmonton'})</span></p>}
      </div>}
      {cta && <p className="ev-cta"><Link className={`btn btn-${cta.tone ?? 'ink'}`} to={cta.to} data-testid="event-cta">{cta.label}</Link></p>}
      <nav className="ev-views" aria-label="Event">
        {(['overview', 'live', 'results'] as const).map(v => (
          <Link key={v} to={viewPath(event.slug, v)} className={`ev-view${view === v ? ' is-active' : ''}`} aria-current={view === v ? 'page' : undefined} data-testid={`view-${v}`}>
            {v === 'live' && phase === 'live' ? <><i className="ev-dot" aria-hidden="true" />{VIEW_WORD[v]}</> : VIEW_WORD[v]}
          </Link>
        ))}
      </nav>
    </header>
  );
}
