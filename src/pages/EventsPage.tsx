import { Link, useSearchParams } from 'react-router-dom';
import { EventRow } from '../components/EventRow';
import { toSummary } from '../components/EventSummaryMap';
import { PageHead, Seg } from '../components/ui';
import { splitDrafts } from '../lib/draftView';
import { useAuth } from '../auth/AuthContext';
import { fetchEvents, type LiveEvent } from '../data/api';
import { fetchEventMeta, fetchOrgLites, fetchSeasons } from '../data/careers';
import { notPast, orgName, pastEvents, pastFilterActive, todayIso, type EventLike } from '../lib/careerView';
import { PROVINCES } from '../registration/model';
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
  const meta = useAsync(fetchEventMeta, []);
  const orgs = useAsync(fetchOrgLites, []);
  const seasons = useAsync(fetchSeasons, []);
  const today = todayIso();
  const metaBySlug = new Map((meta.data ?? []).map(m => [m.slug, m]));
  const like = (e: LiveEvent): EventLike & LiveEvent => ({ ...e, organizationId: metaBySlug.get(e.slug)?.organizationId ?? null, seasonId: metaBySlug.get(e.slug)?.seasonId ?? null, region: metaBySlug.get(e.slug)?.region ?? e.region });
  const pastFilter = { seasonId: params.get('season') ?? '', organizationId: params.get('org') ?? '', region: params.get('province') ?? '' };
  const setPast = (key: 'season' | 'org' | 'province', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const matches = (leagues: LeagueId[]) => filter === 'all' || leagues.includes(filter);
  const allLike = (live.data ?? []).map(like);
  const past = pastEvents(allLike, today, pastFilter).filter(e => matches(e.leagues.filter((l): l is LeagueId => l !== 'hacsa')));
  const pastAny = pastEvents(allLike, today, { seasonId: '', organizationId: '', region: '' });
  const orgOf = (slug: string) => (orgs.data ?? []).find(o => o.id === metaBySlug.get(slug)?.organizationId);
  const withOrg = (e: LiveEvent) => {
    const s = toSummary(e);
    const o = orgOf(e.slug);
    return o ? { ...s, badges: [...s.badges, { tone: 'steel' as const, label: o.enabled ? orgName(o) : `${orgName(o)} (inactive)` }] } : s;
  };
  const seasonOptions = (seasons.data ?? []).filter(x => pastAny.some(e => metaBySlug.get(e.slug)?.seasonId === x.id));
  const orgOptions = (orgs.data ?? []).filter(o => pastAny.some(e => metaBySlug.get(e.slug)?.organizationId === o.id));
  const regionOptions = [...new Set(pastAny.map(e => metaBySlug.get(e.slug)?.region).filter((r): r is string => Boolean(r)))].sort();
  const regionName = (code: string) => PROVINCES.find(([k]) => k === code)?.[1] ?? code;
  const { drafts, published: publishedAll } = splitDrafts(live.data ?? [], Boolean(userId));
  const published = notPast(publishedAll.map(like), today);
  const draftList = drafts.map(e => toSummary(e)).filter(e => matches(e.leagues));
  const real = published.map(e => withOrg(e));
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
        {!live.loading && !live.error && list.length === 0 && draftList.length === 0 && samples.length === 0 && pastAny.length === 0 && (
          <div className="panel info"><h3>No events published yet</h3><p style={{ color: 'var(--muted)' }}>Events appear here once their organizers publish them.</p></div>
        )}
      </div>
      {!live.loading && !live.error && list.length === 0 && draftList.length === 0 && pastAny.length > 0 && <p className="muted">No upcoming events right now.</p>}
      {pastAny.length > 0 && (
        <>
          <p className="eyebrow">Past events</p>
          <div className="evfilter">
            {seasonOptions.length > 0 && (
              <label className="field-in" style={{ flex: '1 1 160px' }}>Season
                <select value={pastFilter.seasonId} onChange={e => setPast('season', e.target.value)}><option value="">Any</option>{seasonOptions.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            )}
            {orgOptions.length > 0 && (
              <label className="field-in" style={{ flex: '1 1 160px' }}>Organization
                <select value={pastFilter.organizationId} onChange={e => setPast('org', e.target.value)}><option value="">Any</option>{orgOptions.map(o => <option key={o.id} value={o.id}>{o.enabled ? orgName(o) : `${orgName(o)} (inactive)`}</option>)}</select></label>
            )}
            {regionOptions.length > 0 && (
              <label className="field-in" style={{ flex: '1 1 160px' }}>Province
                <select value={pastFilter.region} onChange={e => setPast('province', e.target.value)}><option value="">Any</option>{regionOptions.map(r => <option key={r} value={r}>{regionName(r)}</option>)}</select></label>
            )}
          </div>
          <div className="eventlist">{past.map(e => <EventRow key={e.id} e={withOrg(e)} />)}</div>
          {past.length === 0 && <div className="panel info"><h3>No past events match</h3><p className="muted">{pastFilterActive(pastFilter) ? 'Try clearing a filter.' : 'Completed events will be listed here.'}</p></div>}
        </>
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
