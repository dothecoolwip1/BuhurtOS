import { Link, useSearchParams } from 'react-router-dom';
import { EventRow } from '../components/EventRow';
import { toSummary } from '../components/EventSummaryMap';
import { PageHead, Seg } from '../components/ui';
import { splitDrafts } from '../lib/draftView';
import { useAuth } from '../auth/AuthContext';
import { fetchEvents } from '../data/api';
import { fetchCanCreateEvents } from '../data/setup';
import { EVENTS } from '../data/fixtures';
import { useSampleMode } from '../data/mode';
import type { LeagueId } from '../data/types';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Filter = 'all' | LeagueId;
const FILTERS: readonly (readonly [Filter, string])[] = [['all', 'All'], ['buhurt', 'Group fight'], ['duels', 'Duels'], ['outrance', 'Profight']];

export function EventsPage() {
  useDocumentTitle('Events');
  const sample = useSampleMode();
  const [params, setParams] = useSearchParams();
  const raw = params.get('format');
  const filter: Filter = FILTERS.some(([k]) => k === raw) ? (raw as Filter) : 'all';
  const live = useAsync(fetchEvents, []);
  const userId = useAuth().session?.user.id;
  const canCreate = useAsync(() => (userId ? fetchCanCreateEvents(userId) : Promise.resolve(false)), [userId]);
  const matches = (leagues: LeagueId[]) => filter === 'all' || leagues.includes(filter);
  const { drafts, published } = splitDrafts(live.data ?? [], Boolean(userId));
  const draftList = drafts.map(e => toSummary(e)).filter(e => matches(e.leagues));
  const real = published.map(e => toSummary(e));
  const list = real.filter(e => matches(e.leagues));
  const samples = sample ? EVENTS.filter(e => matches(e.leagues)) : [];
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Calendar" title="Events" lede="One event can run several competitions, each with its own ruleset and bracket." />
      <div className="evfilter">
        <Seg label="Format" value={filter} options={FILTERS} onChange={v => setParams(v === 'all' ? {} : { format: v }, { replace: true })} />
        <Link className="more" to="/formats?tab=tournaments">What are the tiers? →</Link>
        {canCreate.data === true && <Link className="btn btn-ink btn-sm" to="/events/new">Create an event</Link>}
      </div>
      {live.loading && <p className="muted">Loading events…</p>}
      {live.error != null && <p role="alert">{friendlyError(live.error, 'Could not load events.')}</p>}
      {draftList.length > 0 && (
        <>
          <p className="eyebrow">Your drafts</p>
          <div className="eventlist">{draftList.map(e => <EventRow key={e.id} e={e} />)}</div>
        </>
      )}
      <div className="eventlist">
        {list.map(e => <EventRow key={e.id} e={e} />)}
        {!live.loading && !live.error && list.length === 0 && draftList.length === 0 && samples.length === 0 && (
          <div className="panel info"><h3>No events published yet</h3><p style={{ color: 'var(--muted)' }}>Events appear here once their organizers publish them.</p></div>
        )}
      </div>
      {samples.length > 0 && (
        <>
          <p className="eyebrow">Sample events (invented)</p>
          <div className="eventlist">{samples.map(e => <EventRow key={e.id} e={e} />)}</div>
        </>
      )}
    </section>
  );
}
