import { Link, useSearchParams } from 'react-router-dom';
import { EventFilters, EventViewSwitch } from '../components/EventFilters';
import { EventList } from '../components/EventList';
import { EventRow } from '../components/EventRow';
import { PageHead } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useEventIndex } from '../data/eventIndex';
import { fetchCanCreateEvents } from '../data/setup';
import { EVENTS } from '../data/fixtures';
import { useSampleMode } from '../data/mode';
import { applyEventFilter, eventFilterParams, filterOptions, parseEventFilter, sortEvents, type EventFilter } from '../lib/eventFilters';
import { todayIso } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Public events: discovery. Drafts the viewer organizes are shown too (the database only returns drafts to their staff). */
export function EventsPage() {
  useDocumentTitle('Events');
  const sample = useSampleMode();
  const [params, setParams] = useSearchParams();
  const userId = useAuth().session?.user.id;
  const index = useEventIndex(userId);
  const canCreate = useAsync(() => (userId ? fetchCanCreateEvents(userId) : Promise.resolve(false)), [userId]);
  const today = todayIso();
  const filter = parseEventFilter(params);
  const setFilter = (f: EventFilter) => setParams(eventFilterParams(f), { replace: true });
  const all = index.data?.events ?? [];
  const list = sortEvents(applyEventFilter(all, filter, today), today);
  const options = filterOptions(all, index.data?.orgs ?? []);
  const samples = sample ? EVENTS.filter(e => filter.format === 'all' || e.leagues.includes(filter.format)) : [];
  const nothingAtAll = !index.loading && index.error == null && all.length === 0;
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Events" title="Events" lede="Tournaments, practices and gatherings across the sport. One event can run several competitions, each with its own ruleset and bracket." />
      <div className="viewswitch">
        <EventViewSwitch signedIn={Boolean(userId)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link className="more" to="/formats?tab=tournaments">What are the tiers? →</Link>
          {canCreate.data === true && <Link className="btn btn-ink btn-sm" to="/events/new">Create an event</Link>}
        </div>
      </div>
      <EventFilters value={filter} onChange={setFilter} options={options} showTest={Boolean(userId)} statuses={Boolean(userId)} />
      {index.loading && !index.data && <p className="muted">Loading events…</p>}
      {index.error != null && <p role="alert">{friendlyError(index.error, 'Could not load events.')}</p>}
      {index.data && (
        <EventList events={list} today={today} grouped showRoles={false}
          empty={nothingAtAll
            ? <div className="panel info"><h3>No events published yet</h3><p style={{ color: 'var(--muted)' }}>Events appear here once their organizers publish them.</p></div>
            : <div className="panel info"><h3>{filter.when === 'past' ? 'No past events match' : 'No events match'}</h3><p className="muted">{filter.q || filter.org || filter.region || filter.type || filter.format !== 'all' ? 'Try clearing a filter or the search.' : filter.when === 'upcoming' ? 'Nothing is coming up right now. Past events are under Past.' : 'Completed events will be listed here.'}</p></div>} />
      )}
      {samples.length > 0 && (
        <>
          <p className="eyebrow">Sample events (invented)</p>
          <div className="eventlist">{samples.map(e => <EventRow key={e.id} e={e} />)}</div>
        </>
      )}
    </section>
  );
}
