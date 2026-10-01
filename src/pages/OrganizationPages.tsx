import { Link, useParams } from 'react-router-dom';
import { Chip, PageHead } from '../components/ui';
import { fetchOrganizationBySlug, fetchOrganizationPage } from '../data/organizationPublic';
import { fetchActiveOrganizations, organizationLabel, type Organization } from '../data/organizations';
import { dateRange } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { rankingsPath, splitOrgEvents, todayUtc, type OrgEventInput } from '../lib/platformOrgs';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const NOT_ENDORSED = 'A listing here does not mean an organization uses or endorses BuhurtOS. Buhurt International, HACSA and other bodies have not endorsed BuhurtOS unless they say so themselves.';

export function OrganizationsPage() {
  useDocumentTitle('Organizations');
  const live = useAsync(fetchActiveOrganizations, []);
  const list = live.data ?? [];
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Directory" title="Organizations" lede="Organizations that are currently active on BuhurtOS." />
      <p className="muted" style={{ fontSize: 13 }}>{NOT_ENDORSED}</p>
      {live.loading && <p className="muted">Loading organizations…</p>}
      {!!live.error && <p role="alert" className="plat-err">{friendlyError(live.error)}</p>}
      {!live.loading && !live.error && list.length === 0 && <p className="muted">No organizations are active yet.</p>}
      <ul className="plain orgdir">
        {list.map(o => (
          <li key={o.id}>
            <Link className="panel orglisting" to={`/organizations/${o.slug}`}>
              <b className="n">{o.name}</b>
              <span className="l">{[organizationLabel(o) !== o.name ? organizationLabel(o) : null, o.region, o.country].filter(Boolean).join(' · ')}</span>
              {o.description && <span className="d">{o.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrganizationPage() {
  const { slug = '' } = useParams();
  const org = useAsync(() => fetchOrganizationBySlug(slug), [slug]);
  useDocumentTitle(org.data ? org.data.name : 'Organization');
  if (org.loading) return <p className="muted">Loading…</p>;
  if (org.error) return <p role="alert" className="plat-err">{friendlyError(org.error)}</p>;
  if (!org.data) return (
    <section style={{ display: 'grid', gap: 12 }}>
      <PageHead eyebrow="Organization" title="Organization not found" lede="There is no organization with that address." />
      <p><Link className="more" to="/organizations">All organizations</Link></p>
    </section>
  );
  return <OrganizationBody org={org.data} />;
}

function EventList({ events }: { events: OrgEventInput[] }) {
  return (
    <ul className="plain">
      {events.map(e => (
        <li key={e.id}>
          <Link className="panel orgevent" to={`/events/${e.slug}`}>
            <b>{e.name}</b>
            <span className="muted">{[dateRange(e.startsOn, e.endsOn), [e.city, e.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OrganizationBody({ org }: { org: Organization }) {
  const today = todayUtc();
  const page = useAsync(() => fetchOrganizationPage(org, today), [org.id, org.enabled]);
  const label = organizationLabel(org);
  const d = page.data;
  const events = d ? splitOrgEvents(d.events, today, org.enabled) : null;
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow={org.kind} title={org.name} lede={org.description ?? undefined} />
      <div className="orgmeta">
        {org.shortName && <Chip>{org.shortName}</Chip>}
        <Chip tone={org.enabled ? 'win' : ''}>{org.enabled ? 'Active' : 'Inactive'}</Chip>
        {org.region && <span>{org.region}</span>}
        {org.country && <span>{org.country}</span>}
        {org.website && <a className="more" href={org.website} rel="noopener noreferrer nofollow" target="_blank">Website</a>}
      </div>
      {!org.enabled && (
        <div className="panel orgbanner" role="status">
          <b>This organization is currently inactive</b>
          <span>{label} is not running events or taking registrations on BuhurtOS right now. Its past events, results and records are kept and stay public.</span>
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>{NOT_ENDORSED}</p>
      {!!page.error && <p role="alert" className="plat-err">{friendlyError(page.error)}</p>}
      {page.loading && <p className="muted">Loading {label}…</p>}
      {d && events && (
        <>
          {org.enabled && (
            <>
              <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
                <div><b>{d.teams.length}</b><span>Teams</span></div>
                <div><b>{d.fightersCount}</b><span>Fighters</span></div>
              </div>
              <section aria-labelledby="org-teams" style={{ display: 'grid', gap: 10 }}>
                <h2 id="org-teams">Teams</h2>
                {d.teams.length === 0 ? <p className="muted">No teams are recorded as members yet.</p> : (
                  <ul className="plain orgdir">
                    {d.teams.map(t => (
                      <li key={t.id}><Link className="panel orglisting" to={`/teams/${t.slug}`}><b className="n">{t.name}</b><span className="l">{[t.city, t.region].filter(Boolean).join(', ')}</span></Link></li>
                    ))}
                  </ul>
                )}
                <p className="muted" style={{ fontSize: 13 }}>Membership is recorded team by team. It is never worked out from where a team is.</p>
              </section>
              <section aria-labelledby="org-up" style={{ display: 'grid', gap: 10 }}>
                <h2 id="org-up">Upcoming events</h2>
                {events.upcoming.length === 0 ? <p className="muted">No upcoming events.</p> : <EventList events={events.upcoming} />}
              </section>
            </>
          )}
          <section aria-labelledby="org-past" style={{ display: 'grid', gap: 10 }}>
            <h2 id="org-past">Past events</h2>
            {events.past.length === 0 ? <p className="muted">No past events are recorded.</p> : <EventList events={events.past} />}
          </section>
          <p><Link className="btn btn-line" to={rankingsPath(org.slug)}>Rankings for {label}</Link></p>
        </>
      )}
      <p><Link className="more" to="/organizations">All organizations</Link></p>
    </section>
  );
}
