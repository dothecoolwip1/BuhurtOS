import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Chip, PageHead, TestBadge } from '../components/ui';
import { fetchMyEvents } from '../data/myEvents';
import { todayIso } from '../lib/careerView';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { GROUP_TITLE, filterMyEvents, groupMyEvents, outstanding, whyLabels, type MyEvent, type MyEventGroup } from '../lib/myEventsView';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { formatMoney } from '../registration/model';

const ORDER: MyEventGroup[] = ['now', 'upcoming', 'drafts', 'past'];

/** Events the signed-in person is part of: as staff, as a registrant, as an entered fighter, as the captain of an entered team. */
export function MyEventsPage() {
  useDocumentTitle('My events');
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Account" title="My events" lede="Sign in to see the events you are part of." /><SignIn /></>;
  return <List />;
}

function List() {
  const events = useAsync(fetchMyEvents, []);
  const [q, setQ] = useState('');
  const [showTest, setShowTest] = useState(false);
  const all = events.data ?? [];
  const hiddenTest = all.filter(e => e.synthetic).length;
  const shown = filterMyEvents(all, q, showTest);
  const groups = groupMyEvents(shown, todayIso());
  const nothingAtAll = events.data && all.length === 0;
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Account" title="My events" lede="Events you take part in, run or score. Each one says why it is here." />
      <Link className="more" to="/account">← Account</Link>
      {events.loading && !events.data && <p className="muted">Loading your events…</p>}
      {events.error != null && <p role="alert">{friendlyError(events.error, 'Could not load your events.')} <button type="button" className="linklike" onClick={events.reload}>Retry</button></p>}
      {nothingAtAll && (
        <div className="panel info" style={{ display: 'grid', gap: 8 }}>
          <h3>Nothing yet</h3>
          <p className="muted">When you register for an event, when a captain enters your team, or when an organizer adds you as staff, it shows up here.</p>
          <p><Link className="btn btn-ink" to="/events">See events</Link></p>
        </div>
      )}
      {!nothingAtAll && events.data && (
        <>
          <div className="evfilter">
            <label className="field-in" style={{ flex: '1 1 220px' }}>Search your events
              <input type="search" value={q} placeholder="Name, city or venue" onChange={e => setQ(e.target.value)} />
            </label>
            {hiddenTest > 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
                <input type="checkbox" checked={showTest} onChange={e => setShowTest(e.target.checked)} /> Show test events ({hiddenTest})
              </label>
            )}
          </div>
          {shown.length === 0 && <p className="muted" role="status">{q ? 'No event matches.' : 'Only test events are on your list. Tick “Show test events” to see them.'}</p>}
          {ORDER.filter(g => groups[g].length > 0).map(g => (
            <section key={g} aria-labelledby={`myev-${g}`} style={{ display: 'grid', gap: 10 }}>
              <h2 id={`myev-${g}`} className="acct-h">{GROUP_TITLE[g]}</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {groups[g].map(e => <li key={e.id}><EventCard e={e} /></li>)}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );
}

function EventCard({ e }: { e: MyEvent }) {
  const why = whyLabels(e);
  const todo = outstanding(e);
  const where = [e.venue, [e.city, e.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const staff = e.staffRoles.length > 0;
  const organizer = e.staffRoles.includes('organizer');
  const scorer = e.staffRoles.some(r => r === 'head_marshal' || r === 'marshal' || r === 'scorekeeper');
  return (
    <article className="panel info" style={{ display: 'grid', gap: 8 }} aria-label={e.name}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h3 style={{ marginRight: 4 }}><Link to={`/events/${e.slug}`}>{e.name}</Link><TestBadge synthetic={e.synthetic} /></h3>
        {e.status === 'draft' && <Chip tone="brass">Draft</Chip>}
        {e.status === 'cancelled' && <Chip>Cancelled</Chip>}
      </div>
      <p className="src" style={{ margin: 0 }}>{dateRange(e.startsOn, e.endsOn)}{where ? ` · ${where}` : ''}</p>
      <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: 0 }}>{why.map(w => <Chip key={w.label} tone={w.tone}>{w.label}</Chip>)}</p>
      {e.registration && e.registration.status === 'accepted' && e.registration.feeDueCents > 0 && (
        <p className="src" style={{ margin: 0 }}>Fee {formatMoney(e.registration.feeDueCents)} · {e.registration.feePaid ? 'paid' : 'not marked paid yet'}{e.registration.checkedIn ? ' · checked in' : ''}</p>
      )}
      {todo.length > 0 && <p style={{ margin: 0, color: 'var(--live)', fontWeight: 600 }}>Outstanding: {todo.join(' · ')}</p>}
      {organizer && e.pendingRegistrations !== null && e.pendingRegistrations > 0 && <p style={{ margin: 0, fontWeight: 600 }}>{e.pendingRegistrations} registration{e.pendingRegistrations === 1 ? '' : 's'} waiting for review</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {e.registration && <Link className="btn btn-ink btn-sm" to={`/events/${e.slug}/register`}>View registration</Link>}
        {organizer && <Link className="btn btn-line btn-sm" to={`/events/${e.slug}/manage`}>Manage</Link>}
        {scorer && !organizer && <Link className="btn btn-line btn-sm" to={`/events/${e.slug}#scorekeeping`}>Scorekeeping</Link>}
        {(!e.registration && !staff) && <Link className="btn btn-line btn-sm" to={`/events/${e.slug}`}>Open event</Link>}
      </div>
    </article>
  );
}
