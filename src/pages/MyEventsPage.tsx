import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { usePlatformRole } from '../auth/usePlatformRole';
import { EventFilters, EventViewSwitch } from '../components/EventFilters';
import { Chip, PageHead, TestBadge } from '../components/ui';
import { useEventIndex } from '../data/eventIndex';
import { applyEventFilter, eventAttention, eventFilterParams, filterOptions, GROUP_LABEL, groupEvents, parseEventFilter, ROLE_LABEL, type EventFilter, type EventGroup, type IndexedEvent } from '../lib/eventFilters';
import { todayIso } from '../lib/careerView';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { outstanding, whyLabels, type MyEvent, type Why } from '../lib/myEventsView';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { formatMoney } from '../registration/model';

const DEFAULTS: Partial<EventFilter> = { when: 'all' };
const ORDER: EventGroup[] = ['now', 'upcoming', 'drafts', 'past'];

/**
 * My events: only events the signed-in person is directly part of (staff role, own registration, own fighter's entry, captained team's entry,
 * or an organizer added them). The database rule is the same one the Calendar's "My calendar" reads. Being the platform owner or an
 * organization admin is not a relationship; those lists live under Platform and the organization pages.
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
  const groups = groupEvents(applyEventFilter(all, filter, today, true), today);
  const shown = ORDER.reduce((n, g) => n + groups[g].length, 0);
  const options = filterOptions(mineAll, index.data?.orgs ?? []);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Events" title="My events" lede="Events you take part in, run or score, or were added to. Each one says why it is here and what is still open." />
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
      {index.data && mineAll.length === 0 && (
        <div className="panel info" style={{ display: 'grid', gap: 8 }}>
          <h3>Nothing yet</h3>
          <p className="muted">When you register for an event, when an organizer adds you, when a captain enters your team, or when you are given a role at an event, it shows up here.{isOwner && ' As the platform owner you can still reach every event under Platform → Events.'}</p>
          <p><Link className="btn btn-ink btn-sm" to="/events">Find an event</Link></p>
        </div>
      )}
      {index.data && mineAll.length > 0 && shown === 0 && (
        <div className="panel info"><h3>No events match</h3><p className="muted">Try clearing a filter, or switch to All under When. Test events show only with “Show test data”.</p></div>
      )}
      {index.data && shown > 0 && (
        <div style={{ display: 'grid', gap: 18 }} data-testid="event-list">
          {ORDER.filter(g => groups[g].length > 0).map(g => (
            <section key={g} aria-labelledby={`myev-${g}`} style={{ display: 'grid', gap: 10 }}>
              <h2 id={`myev-${g}`} style={{ fontSize: 20, margin: 0 }}>{GROUP_LABEL[g]} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>({groups[g].length})</span></h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {groups[g].map(e => <li key={e.id}><EventCard e={e} d={index.data!.mine.get(e.id)} /></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** One event: why it is here (every reason), what is still open, and the next step for each role the person has. */
function EventCard({ e, d }: { e: IndexedEvent; d: MyEvent | undefined }) {
  const why: Why[] = d ? whyLabels(d) : e.roles.map(r => ({ label: ROLE_LABEL[r], tone: 'brass' as const }));
  const todo = d ? outstanding(d) : [];
  const where = [e.venue, [e.city, e.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const staffRoles = d?.staffRoles ?? e.roles.filter(r => ['organizer', 'head_marshal', 'marshal', 'scorekeeper', 'medic'].includes(r));
  const organizer = staffRoles.includes('organizer');
  const scorer = staffRoles.some(r => r === 'head_marshal' || r === 'marshal' || r === 'scorekeeper');
  const reg = d?.registration ?? null;
  const attention = organizer ? eventAttention(e) : null;
  return (
    <article className="panel info" style={{ display: 'grid', gap: 8 }} aria-label={e.name}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h3 style={{ marginRight: 4, overflowWrap: 'anywhere' }}><Link to={`/events/${e.slug}`}>{e.name}</Link><TestBadge synthetic={e.synthetic} /></h3>
        {e.status === 'draft' && <Chip tone="brass">Draft</Chip>}
        {e.status === 'cancelled' && <Chip>Cancelled</Chip>}
        {e.orgLabel && <Chip tone="steel">{e.orgEnabled ? e.orgLabel : `${e.orgLabel} (inactive)`}</Chip>}
      </div>
      <p className="src" style={{ margin: 0 }}>{dateRange(e.startsOn, e.endsOn)}{where ? ` · ${where}` : ''}</p>
      <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: 0 }} data-testid="why">{why.map(w => <Chip key={w.label} tone={w.tone}>{w.label}</Chip>)}</p>
      {reg && reg.status === 'accepted' && (reg.feeDueCents > 0 || reg.checkedIn) && (
        <p className="src" style={{ margin: 0 }}>{reg.feeDueCents > 0 ? `Fee ${formatMoney(reg.feeDueCents)} · ${reg.feePaid ? 'paid' : 'not marked paid yet'}` : 'No fee'}{reg.checkedIn ? ' · checked in' : ''}</p>
      )}
      {todo.length > 0 && <p style={{ margin: 0, color: 'var(--live)', fontWeight: 600 }}>Outstanding: {todo.join(' · ')}</p>}
      {attention && <p style={{ margin: 0, color: 'var(--live)', fontWeight: 600 }}>{attention}</p>}
      {organizer && d?.pendingRegistrations != null && d.pendingRegistrations > 0 && <p style={{ margin: 0, fontWeight: 600 }}>{d.pendingRegistrations} registration{d.pendingRegistrations === 1 ? '' : 's'} waiting for review</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {reg && <Link className="btn btn-ink btn-sm" to={`/events/${e.slug}/register`}>View registration</Link>}
        {d?.invited && !reg && <Link className="btn btn-ink btn-sm" to={`/events/${e.slug}`}>Complete registration</Link>}
        {organizer && <Link className="btn btn-line btn-sm" to={`/events/${e.slug}/control`}>Event Control</Link>}
        {scorer && !organizer && <Link className="btn btn-line btn-sm" to={`/events/${e.slug}/control?mode=live`}>Event Control</Link>}
        {!reg && !d?.invited && staffRoles.length === 0 && <Link className="btn btn-line btn-sm" to={`/events/${e.slug}`}>Open event</Link>}
      </div>
    </article>
  );
}
