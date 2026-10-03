import { Link, useSearchParams } from 'react-router-dom';
import { Chip, PageHead } from '../components/ui';
import { fetchFighterDirectory, fetchTeamOptions, type FighterCard } from '../data/careers';
import { categoryLabel, genderLabel, pageInfo, PAGE_SIZE, parsePage } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useTrackSearch } from '../lib/useTrackSearch';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const DISCIPLINES = ['5v5', '3v3', '12v12', '30v30', 'longsword', 'sword_shield', 'buckler', 'polearm', 'profight', 'sabre', 'greatsword'];

export function FighterListing({ f }: { f: FighterCard }) {
  const where = [f.city, f.region].filter(Boolean).join(', ');
  return (
    <Link className="panel fightercard" to={`/fighters/${f.id}`}>
      <span className="av" aria-hidden="true">{f.name.charAt(0).toUpperCase()}</span>
      <span style={{ minWidth: 0 }}>
        <span className="n">{f.name}</span>
        {f.team && <span className="l">{f.team.name}</span>}
        {where && <span className="l">{where}</span>}
        {(f.gender || f.disciplines.length > 0) && (
          <span className="s">{genderLabel(f.gender) && <Chip>{genderLabel(f.gender)}</Chip>}{f.disciplines.slice(0, 4).map(d => <Chip key={d} tone="steel">{categoryLabel(d)}</Chip>)}</span>
        )}
      </span>
    </Link>
  );
}

export function FightersPage() {
  useDocumentTitle('Fighters');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  useTrackSearch('fighters', q);
  const teamId = params.get('team') ?? '';
  const gender = params.get('gender') ?? '';
  const discipline = params.get('discipline') ?? '';
  const region = params.get('region') ?? '';
  const page = parsePage(params.get('page'));
  const teams = useAsync(fetchTeamOptions, []);
  const list = useAsync(() => fetchFighterDirectory({ q, teamId, gender, discipline, region, page }), [q, teamId, gender, discipline, region, page]);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const info = pageInfo(list.data?.total ?? 0, page);
  const filtered = Boolean(q || teamId || gender || discipline || region);
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow="Directory" title="Fighters" lede="Every fighter with a record on BuhurtOS. Open a name to see their team, their results and their career." />
      <div className="evfilter">
        <label className="field-in" style={{ flex: '1 1 240px' }}>Search by name
          <input type="search" value={q} onChange={e => set('q', e.target.value)} placeholder="For example Alex" /></label>
        <label className="field-in" style={{ flex: '1 1 180px' }}>Team
          <select value={teamId} onChange={e => set('team', e.target.value)}>
            <option value="">Any team</option>
            {(teams.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        <label className="field-in" style={{ flex: '1 1 140px' }}>Gender
          <select value={gender} onChange={e => set('gender', e.target.value)}>
            <option value="">Any</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
          </select></label>
        <label className="field-in" style={{ flex: '1 1 180px' }}>Discipline
          <select value={discipline} onChange={e => set('discipline', e.target.value)}>
            <option value="">Any</option>
            {DISCIPLINES.map(d => <option key={d} value={d}>{categoryLabel(d)}</option>)}
          </select></label>
        <label className="field-in" style={{ flex: '1 1 160px' }}>Region
          <input type="search" value={region} onChange={e => set('region', e.target.value)} placeholder="For example Alberta" /></label>
      </div>
      {list.loading && <p className="muted">Loading fighters…</p>}
      {list.error != null && <p role="alert">{friendlyError(list.error, 'Could not load fighters.')}</p>}
      {!list.loading && !list.error && list.data && (
        <p className="muted" aria-live="polite">{list.data.total === 0 ? 'No fighters' : `Showing ${info.from} to ${info.to} of ${list.data.total} ${list.data.total === 1 ? 'fighter' : 'fighters'}`}{filtered ? ' that match' : ''}</p>
      )}
      <div className="teamdir">{(list.data?.rows ?? []).map(f => <FighterListing key={f.id} f={f} />)}</div>
      {!list.loading && !list.error && list.data?.total === 0 && (
        <div className="panel info">
          <h3>{filtered ? 'Nobody matches those filters' : 'No fighters listed yet'}</h3>
          <p className="muted">{filtered ? 'Try fewer filters or a shorter name.' : 'Fighters appear here once they are on a roster or in a competition.'}</p>
        </div>
      )}
      {info.pages > 1 && (
        <nav className="evfilter" aria-label="Pages">
          <button type="button" className="btn btn-line" disabled={info.page <= 1} onClick={() => set('page', String(info.page - 1))}>Previous</button>
          <span className="muted">Page {info.page} of {info.pages} · {PAGE_SIZE} per page</span>
          <button type="button" className="btn btn-line" disabled={info.page >= info.pages} onClick={() => set('page', String(info.page + 1))}>Next</button>
        </nav>
      )}
    </section>
  );
}
