import { clubOf, TEAMS } from '../data/fixtures';
import type { StandingRow } from '../data/types';
import { Crest } from './Crest';

export function Standings({ title, rows, metricLabel, topAdvance = 2 }: { title: string; rows: StandingRow[]; metricLabel: string; topAdvance?: number }) {
  return (
    <div className="panel board">
      <table>
        <thead><tr><th colSpan={2}>{title}</th><th className="num">W</th><th className="num">L</th><th className="num">{metricLabel}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className={i < topAdvance ? 'top3' : ''}>
              <td className="rk" style={{ width: 34, fontSize: 22 }}>{i + 1}</td>
              <td>
                {r.teamId ? <span className="who"><Crest team={TEAMS[r.teamId]} size={28} /><b style={{ fontWeight: 600 }}>{r.name}</b></span>
                  : <><b style={{ fontWeight: 600 }}>{r.name}</b><div className="src">{clubOf(r.name)}</div></>}
              </td>
              <td className="num">{r.wins}</td><td className="num">{r.losses}</td><td className="num">{r.metric}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
