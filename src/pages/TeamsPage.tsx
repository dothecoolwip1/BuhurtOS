import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { demoTeams } from '../data/showcase';
import { PageHeader, Pill } from '../components/ShowcaseUI';

export function TeamsPage(){
  const [query,setQuery]=useState('');
  const teams=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return demoTeams;
    return demoTeams.filter(team=>[team.name,team.shortName,team.region,team.city,team.captain].some(value=>value.toLowerCase().includes(needle)));
  },[query]);
  return <>
    <PageHeader eyebrow="HACSA Teams" title="Teams" description="Official teams, current rosters, captains, event activity and public team identities." actions={<label className="show-search"><span>⌕</span><input aria-label="Search teams" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search teams"/></label>}/>
    {teams.length===0?<div className="state-card">No teams match that search.</div>:<div className="show-team-grid">{teams.map(team=><Link to={`/teams/${team.id}`} className="show-team-card" key={team.id}>
      <div className="show-team-banner" style={{'--team':team.color} as CSSProperties}><span>{team.logoText}</span><Pill tone={team.status==='active'?'green':'amber'}>{team.status}</Pill></div>
      <div className="show-team-body"><small>{team.region}</small><h2>{team.name}</h2><p>{team.bio}</p><div className="show-team-meta"><span><b>{team.members}</b><small>Members</small></span><span><b>{team.captain}</b><small>Captain</small></span><span><b>{team.founded}</b><small>Founded</small></span></div></div>
    </Link>)}</div>}
  </>;
}
