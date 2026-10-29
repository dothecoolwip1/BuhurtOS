import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Seg } from '../components/ui';
import { fetchProfightStandings, groupStandings } from '../data/profight';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

/**
 * Profight records (Outrance Rules V.26.4 §17): every competitor's win/loss record, compared within their active weight category. A fighter who
 * has not fought for a year is shown as retired; after two years they leave the standings (their fights stay in the record). Official fights only;
 * fictional test events are never counted.
 */
export function ProfightStandings() {
  const st = useAsync(fetchProfightStandings, []);
  const [gender, setGender] = useState<'men' | 'women'>('men');
  const groups = groupStandings(st.data ?? [], gender);
  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Profight records">
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>Win/loss records within each weight class (Outrance §17). No fight for a year: retired. Two years: out of the standings.</p>
      <div className="evfilter"><Seg label="Division" value={gender} options={[['men', 'Men'], ['women', 'Women']] as const} onChange={setGender} /></div>
      {st.loading && <p className="muted">Loading Profight records…</p>}
      {st.error != null && <div role="alert"><p>{friendlyError(st.error, 'Could not load the Profight records.')}</p><button type="button" className="btn btn-line" onClick={st.reload}>Retry</button></div>}
      {st.data && groups.length === 0 && <div className="panel info"><h3>No Profight records yet</h3><p className="muted">Records appear as soon as a Profight is official.</p></div>}
      {groups.map(g => (
        <div key={g.weightClass} style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ fontSize: 22 }}>{g.weightClass}</h2>
          <ol className="rankcards">
            {g.rows.map(r => (
              <li key={r.fighterId} className="panel rankcard">
                <span className="rk" aria-label={`Rank ${r.rank}`}>{r.rank}</span>
                <span style={{ minWidth: 0 }}><Link to={`/fighters/${r.fighterId}`} className="n">{r.name}</Link><span className="l">{r.fights} fight{r.fights === 1 ? '' : 's'}{r.lastFightAt ? ` · last ${new Date(r.lastFightAt).toLocaleDateString()}` : ''}</span></span>
                <span className="pts"><b className="mono">{r.wins}–{r.losses}{r.draws ? `–${r.draws}` : ''}</b><span>W–L{r.draws ? '–D' : ''}</span></span>
              </li>
            ))}
          </ol>
          {g.retired.length > 0 && <details><summary className="src">Retired ({g.retired.length})</summary><ul>{g.retired.map(r => <li key={r.fighterId}><Link to={`/fighters/${r.fighterId}`}>{r.name}</Link> · {r.wins}–{r.losses}{r.draws ? `–${r.draws}` : ''}</li>)}</ul></details>}
        </div>
      ))}
    </section>
  );
}
