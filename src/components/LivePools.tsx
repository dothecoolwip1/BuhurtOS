import type { CompetitionEntry, CompetitionMatch, Standing } from '../data/matches';
import { buildPoolTables } from '../lib/liveView';

/** Wins table per pool or round robin, from the database standings. Renders nothing when the competition has no pool matches. */
export function LivePools({ standings, entries, matches }: { standings: readonly Standing[]; entries: readonly CompetitionEntry[]; matches: readonly CompetitionMatch[] }) {
  const tables = buildPoolTables(standings, entries, matches);
  if (tables.length === 0) return null;
  return (
    <div className="live-pools">
      {tables.map(t => (
        <div key={t.pool ?? 'all'} className="panel board">
          <div className="table-scroll">
            <table>
              <caption className="eyebrow" style={{ textAlign: 'left', padding: '12px 16px 0' }}>{t.label}</caption>
              <thead><tr><th>#</th><th>Entry</th><th className="num">W</th><th className="num">L</th><th className="num">D</th><th className="num">+/-</th></tr></thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={r.entryId}>
                    <td className="rk" style={{ width: 34, fontSize: 22 }}>{i + 1}</td>
                    <td><b style={{ fontWeight: 600 }}>{r.name}</b></td>
                    <td className="num">{r.wins}</td><td className="num">{r.losses}</td><td className="num">{r.draws}</td>
                    <td className="num">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.hasUnresolvedTies && <p className="src" style={{ padding: '0 16px 12px' }}>Ranked by wins, then score difference. Where entries are still level, the organizer applies the tie rules.</p>}
        </div>
      ))}
    </div>
  );
}
