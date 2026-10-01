import { Link, useSearchParams } from 'react-router-dom';
import { EventRow } from '../components/EventRow';
import { PageHead, Seg } from '../components/ui';
import { EVENTS } from '../data/fixtures';
import type { LeagueId } from '../data/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Filter = 'all' | LeagueId;
const FILTERS: readonly (readonly [Filter, string])[] = [['all', 'All'], ['buhurt', 'Group fight'], ['duels', 'Duels'], ['outrance', 'Profight']];

export function EventsPage() {
  useDocumentTitle('Events');
  const [params, setParams] = useSearchParams();
  const raw = params.get('format');
  const filter: Filter = FILTERS.some(([k]) => k === raw) ? (raw as Filter) : 'all';
  const list = EVENTS.filter(e => filter === 'all' || e.leagues.includes(filter));
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Calendar" title="Events" lede="One event can run several competitions: a men's 5v5, a women's 5v5, three duel categories and a profight card, each with its own tier and bracket." />
      <div className="evfilter">
        <Seg label="Format" value={filter} options={FILTERS} onChange={v => setParams(v === 'all' ? {} : { format: v }, { replace: true })} />
        <Link className="more" to="/formats?tab=tournaments">What are the tiers? →</Link>
      </div>
      <div className="eventlist">
        {list.length ? list.map(e => <EventRow key={e.id} e={e} />) : (
          <div className="panel info"><h3>No events for this format yet</h3><p style={{ color: 'var(--muted)' }}>Organizers can submit one from their event page.</p></div>
        )}
      </div>
    </section>
  );
}
