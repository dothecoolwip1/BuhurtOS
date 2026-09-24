import { demoFighters, seasonRankings } from '../data/showcase';
import { Avatar, PageHeader, Panel, Pill, StatCard } from '../components/ShowcaseUI';
import { downloadText } from '../lib/export';

function rankingsCsv(){
  const cell=(value:unknown)=>{
    const text=String(value??'');
    return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
  };
  const rows=[['Rank','Fighter','Team','Category','Points','Change'],...seasonRankings.map(row=>[row.rank,row.fighter,row.team,row.category,row.points,row.change])];
  return rows.map(row=>row.map(cell).join(',')).join('\n');
}

export function ShowcaseRankingsPage(){
  const exportRecords=()=>downloadText('hacsa-2026-showcase-rankings.csv',rankingsCsv());
  return <>
    <PageHeader eyebrow="Records & Rankings" title="2026 HACSA Season" description="Permanent results flow from finalized matches into fighter records, event standings and season rankings." actions={<button className="show-btn secondary" onClick={exportRecords}>Export records</button>}/>
    <div className="show-stat-grid"><StatCard label="Ranked fighters" value="86" note="Across 9 divisions" tone="accent"/><StatCard label="Ranked teams" value="12" note="Melee standings"/><StatCard label="Sanctioned matches" value="642" note="Season to date"/><StatCard label="Season leaders" value="9" note="One per division" tone="good"/></div>
    <div className="show-two-col wide-left"><Panel title="Longsword rankings" subtitle="HACSA ranking points • finalized sanctioned matches only"><div className="show-ranking-table">{seasonRankings.map(row=><article key={row.rank}><strong className="rank">{row.rank}</strong><Avatar initials={row.fighter.split(' ').map(x=>x[0]).join('').slice(0,2)} size="sm"/><div className="grow"><b>{row.fighter}</b><small>{row.team}</small></div><span className={row.change.includes('↑')?'up':row.change.includes('↓')?'down':''}>{row.change}</span><strong>{row.points}<small> pts</small></strong></article>)}</div></Panel><Panel title="Division leaders"><div className="show-division-list">{[['Longsword','Kolby H.','860'],['Sword & Buckler','Alex Morgan','820'],['Polearm','Garrett Robson','774'],['Profight','Mason Clarke','731'],['Greatsword','Bob Mercer','690']].map(([division,name,points],i)=><article key={division}><span>{i+1}</span><div className="grow"><b>{division}</b><small>{name}</small></div><strong>{points}</strong></article>)}</div></Panel></div>
    <Panel title="HACSA record book" subtitle="Career achievements remain with the fighter even when teams change"><div className="show-record-book">{[['Most career wins','Kolby H.','31'],['Highest current win rate','Bob Mercer','73%'],['Most podiums','Kolby H.','8'],['Most events entered','Kolby H.','15'],['Longest current streak','Bob Mercer','6 wins'],['Most 2026 matches','Alex Morgan','22']].map(([label,name,value])=><article key={label}><small>{label}</small><b>{value}</b><span>{name}</span></article>)}</div></Panel>
    <Panel title="Recent record changes" subtitle="Every ranking change traces back to an official result"><div className="show-history-timeline">{demoFighters.slice(0,3).map((f,i)=><article key={f.id}><span className="show-history-dot"></span><div><b>{f.name} moved to #{f.rank}</b><small>After HACSA Spring Open • Longsword • {i+1} event{ i ? 's':''} ago</small></div><Pill tone={i===0?'green':'neutral'}>{i===0?'↑2':'Updated'}</Pill></article>)}</div></Panel>
  </>;
}
