import { Link } from 'react-router-dom';
import { demoFighters, demoTeams } from '../data/showcase';
import { Avatar, PageHeader, Pill } from '../components/ShowcaseUI';

export function FightersPage(){
  const teamName=(id:string)=>demoTeams.find(t=>t.id===id)?.name??'Independent';
  return <>
    <PageHeader eyebrow="HACSA Athlete Directory" title="Fighters" description="Permanent fighter identities, public competition records and current team relationships." actions={<div className="show-filter-row"><div className="show-search"><span>⌕</span><input placeholder="Search fighters"/></div><select><option>All categories</option><option>Longsword</option><option>Sword & Buckler</option><option>5v5</option></select></div>}/>
    <div className="show-fighter-grid">{demoFighters.map(f=><Link to={`/fighters/${f.id}`} className="show-fighter-card" key={f.id}><div className={`show-fighter-photo ${f.photoTone}`}><Avatar initials={f.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={f.photoTone} size="xl"/><span className="show-rank-badge">#{f.rank}</span></div><div><span className="eyebrow">{teamName(f.teamId)}</span><h2>{f.fighterName}</h2><p>{f.region}</p><div className="show-fighter-record"><span><b>{f.record.wins}</b><small>Wins</small></span><span><b>{f.record.losses}</b><small>Losses</small></span><span><b>{f.podiums}</b><small>Podiums</small></span></div><div className="show-tag-row">{f.categories.slice(0,3).map(c=><Pill key={c}>{c}</Pill>)}</div></div></Link>)}</div>
  </>;
}
