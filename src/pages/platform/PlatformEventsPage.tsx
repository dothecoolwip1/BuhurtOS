import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { EventFilters } from '../../components/EventFilters';
import { EventList } from '../../components/EventList';
import { PageHead } from '../../components/ui';
import { useEventIndex } from '../../data/eventIndex';
import { applyEventFilter, eventFilterParams, filterOptions, parseEventFilter, sortEvents, type EventFilter } from '../../lib/eventFilters';
import { todayIso } from '../../lib/careerView';
import { friendlyError } from '../../lib/friendlyError';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PlatformGate } from './PlatformPages';

const DEFAULTS: Partial<EventFilter> = { when: 'all', test: true };

/** Platform → Events: every event on BuhurtOS for administration, test data included by default. Not "my events". */
export function PlatformEventsPage() {
  useDocumentTitle('Events · Platform');
  return <PlatformGate><AllEvents /></PlatformGate>;
}

function AllEvents() {
  const [params, setParams] = useSearchParams();
  const userId = useAuth().session?.user.id;
  const index = useEventIndex(userId);
  const today = todayIso();
  const filter = parseEventFilter(params, DEFAULTS);
  const all = index.data?.events ?? [];
  const list = sortEvents(applyEventFilter(all, filter, today), today);
  return (
    <section className="plat" style={{ display: 'grid', gap: 16 }}>
      <PageHead eyebrow="Platform" title="Events" lede="Every event the platform holds, drafts and test data included. Open one to manage it; your own events are under My events." />
      <p><Link className="more" to="/platform">← Platform</Link></p>
      <EventFilters value={filter} onChange={f => setParams(eventFilterParams(f, DEFAULTS), { replace: true })} options={filterOptions(all, index.data?.orgs ?? [])} defaults={DEFAULTS} showTest statuses />
      {index.loading && !index.data && <p className="muted">Loading…</p>}
      {index.error != null && <p role="alert">{friendlyError(index.error, 'Could not load events.')}</p>}
      {index.data && <p className="src">{list.length} of {all.length} events</p>}
      {index.data && <EventList events={list} today={today} grouped empty={<div className="panel info"><h3>No events match</h3></div>} />}
    </section>
  );
}
