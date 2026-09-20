import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { demoTeams } from '../data/showcase';
import { PageHeader, Pill } from '../components/ShowcaseUI';

export function TeamsPage(){
  return <>
    <PageHeader eyebrow="HACSA Teams" title="Teams" description="Official teams, current rosters, captains, event activity and public team identities." actions={<div className="show-search"><span>⌕</span><input placeholder="Search teams"/></div>}/>
    <div className="show-team-grid">{demoTeams.map(team=><Link to={`/teams/${team.id}`} className="show-team-card" key={team.id}>
      <div className="show-team-banner" style={{'--team':team.color} as CSSProperties}><span>{team.logoText}</span><Pill tone={team.status==='active'?'green':'amber'}>{team.status}</Pill></div>
      <div className="show-team-body"><small>{team.region}</small><h2>{team.name}</h2><p>{team.bio}</p><div className="show-team-meta"><span><b>{team.members}</b><small>Members</small></span><span><b>{team.captain}</b><small>Captain</small></span><span><b>{team.founded}</b><small>Founded</small></span></div></div>
    </Link>)}</div>
  </>;
}
