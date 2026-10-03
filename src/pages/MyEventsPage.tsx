import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { usePlatformRole } from '../auth/usePlatformRole';
import { EventFilters, EventViewSwitch } from '../components/EventFilters';
import { EventList } from '../components/EventList';
import { PageHead } from '../components/ui';
import { useEventIndex } from '../data/eventIndex';
import { applyEventFilter, eventFilterParams, filterOptions, parseEventFilter, sortEvents, type EventFilter } from '../lib/eventFilters';
import { todayIso } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const DEFAULTS: Partial<EventFilter> = { when: 'all' };

/**
 * My events: only events the signed-in person is actually part of. Being the platform owner is not a relationship; the owner's
 * every-event list is under Platform → Events.
 */
export function MyEventsPage() {
  useDocumentTitle('My events');
  const { session, loading } = useAuth();
  const { isOwner } = usePlatformRole();
  const [params, setParams] = useSearchParams();
  const userId = session?.user.id;
  const index = useEventIndex(userId);
  const today = todayIso();
  const filter = parseEventFilter(params, DEFAULTS);
  const setFilter = (f: EventFilter) => setParams(eventFilterParams(f, DEFAULTS), { replace: true });
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Events" title="My events" lede="Sign in to see the events you are part of." /><SignIn /></>;
  const all = index.data?.events ?? [];
  const mineAll = all.filter(e => e.roles.length > 0);
  const list = sortEvents(applyEventFilter(all, filter, today, true), today);
  const options = filterOptions(mineAll, index.data?.orgs ?? []);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Events" title="My events" lede="Events you organize, fight at, captain a team into, staff, or were added to. Happening now first, then what is next." />
      <div className="viewswitch">
        <EventViewSwitch signedIn />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btn-line btn-sm" to="/calendar?mine=1">My calendar</Link>
          {isOwner && <Link className="btn btn-line btn-sm" to="/platform/events">All events (platform)</Link>}
        </div>
      </div>
      <EventFilters value={filter} onChange={setFilter} options={options} defaults={DEFAULTS} mine showTest statuses placeholder="Search my events" />
      {index.loading && !index.data && <p className="muted">Loading your events…</p>}
      {index.error != null && <p role="alert">{friendlyError(index.error, 'Could not load your events.')}</p>}
      {index.data && (
        <EventList events={list} today={today} grouped showRoles
          empty={mineAll.length === 0
            ? <div className="panel info" style={{ display: 'grid', gap: 8 }}><h3>You are not part of any event yet</h3><p className="muted">Register for an event, or create one, and it appears here.{isOwner && ' As the platform owner you can still reach every event under Platform → Events.'}</p><p><Link className="btn btn-ink btn-sm" to="/events">Find an event</Link></p></div>
            : <div className="panel info"><h3>No events match</h3><p className="muted">Try clearing a filter, or switch to All under When.</p></div>} />
      )}
    </section>
  );
}
