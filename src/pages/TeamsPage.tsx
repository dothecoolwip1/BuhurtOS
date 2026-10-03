import { Link, useSearchParams } from 'react-router-dom';
import { Crest } from '../components/Crest';
import { Chip, PageHead, TestBadge } from '../components/ui';
import { isSynthetic, useSynthetic } from '../data/synthetic';
import { fetchDirectory, teamEmblemUrl, type DirectoryEntry } from '../data/teamDirectory';
import type { CrestDivision, Team } from '../data/types';
import { friendlyError } from '../lib/friendlyError';
import { affiliationOptions, filterTeams, groupByOrganization, listedFromLabel, locationText, NO_SOURCE_LABEL, PENDING_LABEL } from '../lib/teamDirectory';
import { useAsync } from '../lib/useAsync';
import { useTrackSearch } from '../lib/useTrackSearch';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** The generated crest takes the shape the sample data uses; only name, colours, division and initial are drawn. */
export const crestTeam = (t: Pick<DirectoryEntry, 'id' | 'name' | 'colors' | 'crestDivision' | 'initial'> & { emblemPath?: string | null }): Team => ({
  id: t.id, name: t.name, place: '', colors: t.colors, division: t.crestDivision as CrestDivision,
  initial: t.initial || t.name.replace(/^the\s+/i, '').charAt(0).toUpperCase(), emblemUrl: teamEmblemUrl(t.emblemPath), points: 0, record: [0, 0]
});

/** The organization a listed team is a member of (else its first affiliation), for grouping. */
const memberOrg = (t: DirectoryEntry) => {
  const a = t.affiliations.find(x => x.relation === 'member') ?? t.affiliations[0];
  return a ? { slug: a.organizationSlug, name: a.organizationName } : null;
};

export function TeamsPage() {
  useDocumentTitle('Teams');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  useTrackSearch('teams', q);
  const org = params.get('org') ?? '';
  const live = useAsync(fetchDirectory, []);
  const all = live.data ?? [];
  const options = affiliationOptions(all);
  const list = filterTeams(all, q, org);
  const set = (key: 'q' | 'org', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Directory" title="Teams" lede="Teams from around the world. A listing here does not mean a team uses BuhurtOS, and a listed organization has not endorsed BuhurtOS." />
      <div className="evfilter">
        <label className="field-in" style={{ flex: '1 1 240px' }}>
          Search by name, city or region
          <input type="search" value={q} onChange={e => set('q', e.target.value)} placeholder="For example Calgary" />
        </label>
        {options.length > 0 && (
          <label className="field-in" style={{ flex: '0 1 240px' }}>
            Affiliation
            <select value={org} onChange={e => set('org', e.target.value)}>
              <option value="">Any</option>
              {options.map(o => <option key={o.organizationSlug} value={o.organizationSlug}>{o.organizationName}</option>)}
            </select>
          </label>
        )}
        <Link className="btn btn-line" to="/teams/new">Add your team</Link>
      </div>
      {live.loading && <p className="muted">Loading teams…</p>}
      {live.error != null && <p role="alert">{friendlyError(live.error, 'Could not load teams.')}</p>}
      {!live.loading && !live.error && (
        <p className="muted" aria-live="polite">{list.length} {list.length === 1 ? 'team' : 'teams'}{q || org ? ' match' : ''}</p>
      )}
      {groupByOrganization(list, memberOrg).map(g => (
        <section key={g.key || 'none'} style={{ display: 'grid', gap: 12 }} aria-label={g.name}>
          <h2 className="acct-h">{g.name} · {g.teams.length}</h2>
          <div className="teamdir">{g.teams.map(t => <TeamListing key={t.id} t={t} />)}</div>
        </section>
      ))}
      {!live.loading && !live.error && all.length === 0 && (
        <div className="panel info"><h3>No teams listed yet</h3><p style={{ color: 'var(--muted)' }}>Teams appear here once they are approved.</p></div>
      )}
      {!live.loading && !live.error && all.length > 0 && list.length === 0 && (
        <div className="panel info"><h3>No team matches</h3><p style={{ color: 'var(--muted)' }}>Try a different name or clear the filters.</p><button type="button" className="btn btn-line btn-sm" onClick={() => setParams({}, { replace: true })}>Clear filters</button></div>
      )}
    </section>
  );
}

function TeamListing({ t }: { t: DirectoryEntry }) {
  const synthetic = isSynthetic(useSynthetic(), 'team', t.id);
  const where = locationText(t);
  return (
    <Link className="panel teamlisting" to={`/teams/${t.slug}`}>
      <Crest team={crestTeam(t)} size={48} />
      <div style={{ minWidth: 0 }}>
        <div className="n">{t.name}<TestBadge synthetic={synthetic} /></div>
        {where && <div className="l">{where}</div>}
        <div className="s">
          {t.status === 'pending' && <Chip tone="brass">{PENDING_LABEL}</Chip>}
          {t.affiliations.map(a => <Chip key={a.affiliationId} tone="steel">{a.organizationName}</Chip>)}
        </div>
        <div className="l src">{t.sources.length > 0 ? t.sources.map(s => listedFromLabel(s)).join(' · ') : NO_SOURCE_LABEL}</div>
      </div>
    </Link>
  );
}
