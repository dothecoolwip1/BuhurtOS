import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { demoFighters } from '../data/showcase';
import { Avatar, PageHeader, Panel, Pill, StatCard } from '../components/ShowcaseUI';

export function TeamHQPage(){
  const roster=useMemo(()=>demoFighters.filter(f=>f.teamId==='reavers'),[]);
  return <>
    <PageHeader eyebrow="Captain Portal" title="Red Deer Reavers HQ" description="Manage the official team roster, affiliations, event lineups and readiness without owning your fighters’ personal profiles." actions={<><Link className="show-btn secondary" to="/teams/reavers">Public team page</Link><Link className="show-btn primary" to="/ops/foundation">Manage affiliations</Link></>}/>
    <div className="show-stat-grid"><StatCard label="Active members" value="14" note="11 fighters • 3 support" tone="accent"/><StatCard label="Fall Open lineup" value="9" note="7 cleared • 2 pending" tone="good"/><StatCard label="Pending invites" value="2" note="Showcase data" tone="warn"/><StatCard label="Season team rank" value="#2" note="HACSA 2026"/></div>
    <div className="show-two-col wide-left">
      <Panel title="Roster" subtitle="Fighters own their personal details. Captains manage event readiness and team relationships through secured tools." actions={<Link className="show-link-btn" to="/ops/foundation">Open affiliations</Link>}>
        <div className="show-roster-table">{roster.map((f,index)=><article key={f.id}><Avatar initials={f.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={f.photoTone}/><div className="grow"><Link to={`/fighters/${f.id}`}><b>{f.name}</b></Link><small>{f.categories.join(' • ')}</small></div><div className="show-readiness"><Pill tone="green">Member</Pill>{index===1?<Pill tone="amber">Waiver due</Pill>:<Pill tone="green">Event ready</Pill>}</div></article>)}</div>
      </Panel>
      <div className="show-stack">
        <Panel title="Captain actions" subtitle="Open the secured workflow that owns each action"><div className="show-action-list"><Link to="/ops/foundation"><span>✉</span><div><b>Team relationships</b><small>Manage affiliations and permanent identity links</small></div><i>›</i></Link><Link to="/ops/roster"><span>✓</span><div><b>Event readiness</b><small>Review check-in and clearances</small></div><i>›</i></Link><Link to="/events/fall-open"><span>⚔</span><div><b>Fall Open</b><small>View schedule and event context</small></div><i>›</i></Link><Link to="/ops/admin"><span>♙</span><div><b>Temporary fighters</b><small>Add event-only ghost fighters</small></div><i>›</i></Link></div></Panel>
        <Panel title="Team profile"><div className="show-team-profile-mini"><span className="show-team-logo-large">RR</span><div><b>Red Deer Reavers</b><small>Central Alberta • HACSA</small><p>Public team page is 86% complete.</p></div></div><Link className="show-btn secondary full" to="/teams/reavers">Preview public team page</Link></Panel>
      </div>
    </div>
    <Panel title="Event lineups" subtitle="Competition readiness is managed per event without changing permanent membership"><div className="show-lineup-grid"><article><div><span className="show-date-tile"><b>SEP</b><small>26</small></span><div><h3>HACSA Fall Open</h3><p>5v5 • Longsword • Sword & Buckler</p></div></div><div className="show-lineup-people">{roster.slice(0,3).map(f=><Avatar key={f.id} initials={f.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={f.photoTone} size="sm"/>)}<span>+6</span></div><Link className="show-btn primary" to="/ops/roster">Manage readiness</Link></article><article><div><span className="show-date-tile"><b>NOV</b><small>14</small></span><div><h3>Winter Clash</h3><p>Registration open</p></div></div><div><Pill tone="amber">4 registered</Pill></div><Link className="show-btn secondary" to="/events/winter-clash">Open event</Link></article></div></Panel>
  </>;
}
