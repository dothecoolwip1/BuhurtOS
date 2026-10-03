import { useSearchParams } from 'react-router-dom';
import { EventFilters, EventViewSwitch } from '../components/EventFilters';
import { MonthCalendar } from '../components/MonthCalendar';
import { PageHead, Seg } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useEventIndex } from '../data/eventIndex';
import { applyEventFilter, eventFilterParams, filterOptions, monthKey, parseEventFilter, parseMonth, type EventFilter } from '../lib/eventFilters';
import { todayIso } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const DEFAULTS: Partial<EventFilter> = { when: 'all' };

/**
 * The public calendar: the same events and filters as the Events list, laid out by month. Signed-in people can switch to "My calendar",
 * which keeps only the events they are part of (fighter, captain, organizer, staff, added by an organizer, organization admin).
 */
export function CalendarPage() {
  useDocumentTitle('Calendar');
  const [params, setParams] = useSearchParams();
  const userId = useAuth().session?.user.id;
  const index = useEventIndex(userId);
  const today = todayIso();
  const filter = parseEventFilter(params, DEFAULTS);
  const mine = userId !== undefined && params.get('mine') === '1';
  const { y, m } = parseMonth(params.get('month'), today);
  const update = (f: EventFilter, month = monthKey(y, m), mineNext = mine) => {
    const p = eventFilterParams(f, DEFAULTS);
    if (month !== today.slice(0, 7)) p.set('month', month);
    if (mineNext) p.set('mine', '1');
    setParams(p, { replace: true });
  };
  const all = index.data?.events ?? [];
  const list = applyEventFilter(all, filter, today, mine);
  const options = filterOptions(all, index.data?.orgs ?? []);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Events" title="Calendar" lede={mine ? 'Only the events you are part of: as a fighter, captain, organizer, marshal, scorekeeper, medic, or where an organizer added you.' : 'Every published event, month by month. Tap a day to see what is on.'} />
      <div className="viewswitch">
        <EventViewSwitch signedIn={Boolean(userId)} />
        {userId && <Seg label="Whose calendar" value={mine ? 'mine' : 'all'} options={[['all', 'Everyone'], ['mine', 'My calendar']] as const} onChange={v => update(filter, undefined, v === 'mine')} />}
      </div>
      <EventFilters value={filter} onChange={f => update(f)} options={options} defaults={DEFAULTS} mine={mine} showTest={Boolean(userId)} statuses={Boolean(userId)} />
      {index.loading && !index.data && <p className="muted">Loading the calendar…</p>}
      {index.error != null && <p role="alert">{friendlyError(index.error, 'Could not load the calendar.')}</p>}
      {index.data && <MonthCalendar events={list} year={y} month={m} today={today} showRoles={mine} onMonth={(ny, nm) => update(filter, monthKey(ny, nm))} />}
    </section>
  );
}
