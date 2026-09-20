import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { demoFighters, demoTeams } from '../data/showcase';
import { Avatar, PageHeader, Panel, Pill } from '../components/ShowcaseUI';

export function TeamPage(){
  const {teamId='reavers'}=useParams();
  const team=demoTeams.find(t=>t.id===teamId)??demoTeams[0];
  const members=demoFighters.filter(f=>f.teamId===team.id);
  return <>
    <div className="show-profile-hero team" style={{'--profile-accent':team.color} as CSSProperties}><div className="show-team-logo-xl">{team.logoText}</div><div className="grow"><span className="eyebrow">HACSA TEAM</span><h1>{team.name}</h1><p>{team.city} • Founded {team.founded}</p><div className="show-inline-pills"><Pill tone="green">{team.status}</Pill><Pill>{members.length} profiled fighters</Pill></div></div><button className="show-btn secondary">Share team</button></div>
    <div className="show-profile-tabs"><button className="active">Overview</button><button>Roster</button><button>Results</button><button>History</button><button>Upcoming</button></div>
    <div className="show-two-col wide-left">
      <div className="show-stack">
        <Panel title="About"><p className="show-long-copy">{team.bio} The team profile follows the team through seasons and leadership changes, while individual fighter records remain attached to permanent fighter identities.</p></Panel>
        <Panel title="Fighters" subtitle="Public roster"><div className="show-member-grid">{members.map(f=><Link to={`/fighters/${f.id}`} key={f.id}><Avatar initials={f.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={f.photoTone} size="lg"/><div><b>{f.fighterName}</b><small>{f.categories.slice(0,2).join(' • ')}</small><span>{f.record.wins}–{f.record.losses}–{f.record.draws}</span></div></Link>)}</div></Panel>
      </div>
      <div className="show-stack">
        <Panel title="Team record"><div className="show-record-big"><strong>24–11</strong><span>2026 season</span></div><div className="show-detail-rows"><div><span>HACSA rank</span><b>#2</b></div><div><span>Podiums</span><b>5</b></div><div><span>Events</span><b>7</b></div><div><span>Captain</span><b>{team.captain}</b></div></div></Panel>
        <Panel title="Next event"><span className="eyebrow">SEP 26–27</span><h3>HACSA Fall Open</h3><p className="muted">Springbrook, AB</p><Link className="show-btn primary full" to="/events/fall-open">View event</Link></Panel>
      </div>
    </div>
  </>;
}
