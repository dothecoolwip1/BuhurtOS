import { Crest } from './Crest';
import { TEAMS } from '../data/fixtures';

export function RankTable({ teamIds, moves }: { teamIds: string[]; moves: ['up' | 'dn' | 'eq', number][] }) {
  return (
    <div className="panel board">
      <table>
        <thead><tr><th>#</th><th>Team</th><th className="num">Pts</th><th className="num">Moved</th></tr></thead>
        <tbody>
          {teamIds.map((id, i) => {
            const t = TEAMS[id];
            const [dir, n] = moves[i % moves.length];
            return (
              <tr key={id} className={i < 3 ? 'top3' : ''}>
                <td className="rk">{i + 1}</td>
                <td><span className="who">{<Crest team={t} size={32} />}<span><b>{t.name}</b><small>{t.place}</small></span></span></td>
                <td className="num">{t.points.toLocaleString()}</td>
                <td className="num"><span className={`mv ${dir}`}>{dir === 'up' ? `▲ ${n}` : dir === 'dn' ? `▼ ${n}` : '—'}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
