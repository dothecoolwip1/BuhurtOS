import { useAppState } from '../features/AppState';
import { computeEventStandings } from '../lib/standings';
import { downloadText, openPrintableReport, standingsCsv } from '../lib/export';

export function StandingsPage() {
  const { event, matches, roster } = useAppState();
  if (!event) return null;
  const rows = computeEventStandings(event, matches, roster);
  const print = () => openPrintableReport(`${event.name} Standings`, `<table><thead><tr><th>Rank</th><th>Competitor</th><th>W</th><th>L</th><th>D</th><th>Pts</th></tr></thead><tbody>${rows.map((r,i) => `<tr><td>${i+1}</td><td>${r.name}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td>${r.standingPoints}</td></tr>`).join('')}</tbody></table>`);
  return <>
    <section className="section-head"><div><span className="eyebrow">{event.standingsMode.replaceAll('_',' ')}</span><h1>Standings</h1><p>Only finalized matches from standings-enabled events are counted.</p></div><div className="header-actions"><button onClick={() => downloadText('buhurtos-standings.csv', standingsCsv(rows))}>Export CSV</button><button onClick={print}>Print / PDF</button></div></section>
    {rows.length === 0 ? <div className="state-card">This event is configured with no standings, or no finalized matches exist yet.</div> : <div className="table-wrap"><table><thead><tr><th>#</th><th>Competitor</th><th>W</th><th>L</th><th>D</th><th>PF</th><th>PA</th><th>Diff</th><th>Pts</th></tr></thead><tbody>{rows.map((r,i) => <tr key={r.rosterEntryId}><td>{i+1}</td><td><strong>{r.name}</strong></td><td>{r.wins}</td><td>{r.losses}</td><td>{r.draws}</td><td>{r.pointsFor}</td><td>{r.pointsAgainst}</td><td>{r.differential}</td><td><b>{r.standingPoints}</b></td></tr>)}</tbody></table></div>}
  </>;
}
