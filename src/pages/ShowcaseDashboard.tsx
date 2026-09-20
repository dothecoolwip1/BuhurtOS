import { Link } from 'react-router-dom';
import { demoEvents, demoFighters, demoTeams, liveMatches, seasonRankings } from '../data/showcase';
import { Avatar, PageHeader, Panel, Pill, StatCard } from '../components/ShowcaseUI';
import { usePreviewMode } from '../features/PreviewMode';

export function ShowcaseDashboard(){
  const {role}=usePreviewMode();
  const admin=role==='bi_admin'||role==='hacsa_admin';
  const captain=role==='captain';
  const fighter=role==='fighter';
  const headline=admin?'HACSA command centre':captain?'Red Deer Reavers HQ':fighter?'Welcome back, Bob':'BuhurtOS';
  const description=admin?'Everything happening across the organization, teams, fighters and sanctioned events.':captain?'Roster readiness, upcoming competition and team administration in one place.':fighter?'Your schedule, record, team and competition history.':'The sport, live.';
  return <>
    <PageHeader eyebrow={role==='bi_admin'?'Buhurt International → HACSA':role==='hacsa_admin'?'HACSA Organization':captain?'Team Captain':fighter?'Fighter Portal':'Overview'} title={headline} description={description} actions={<><Link className="show-btn secondary" to="/public">View public site</Link>{admin?<Link className="show-btn primary" to="/events">Create event</Link>:captain?<Link className="show-btn primary" to="/team-hq">Manage team</Link>:fighter?<Link className="show-btn primary" to="/me">Edit profile</Link>:null}</>}/>
    <div className="show-stat-grid">
      <StatCard label={admin?'Active teams':captain?'Active roster':'Career record'} value={admin?demoTeams.filter(t=>t.status==='active').length:captain?14:'27–9–1'} note={admin?'1 forming team':captain?'12 competition ready':'73% win rate'} tone="accent"/>
      <StatCard label={admin?'Registered fighters':captain?'Next event':'2026 season'} value={admin?'64':captain?'6 days':'8–2'} note={admin?'Across current event':captain?'HACSA Fall Open':'#3 Longsword'} tone="good"/>
      <StatCard label={admin?'Live fields':captain?'Pending actions':'Podiums'} value={admin?3:captain?3:6} note={admin?'All reporting':captain?'2 waivers • 1 invite':'12 career events'} />
      <StatCard label={admin?'Open registrations':captain?'Team ranking':'Upcoming fights'} value={admin?43:captain?'#2':2} note={admin?'Winter Clash':captain?'2026 season':'Today • Fields 1 & 2'} tone="warn"/>
    </div>
    <div className="show-dashboard-grid">
      <Panel title="Live tournament" subtitle="HACSA Fall Open • three fields currently running" actions={<Link to="/events/fall-open">Open command →</Link>}>
        <div className="show-live-list">{liveMatches.map(m=><article key={m.id}><div className="show-live-field"><span className="show-live-dot"></span><b>{m.field}</b><small>{m.division}</small></div><div className="show-live-match"><strong>{m.left}</strong><span>{m.leftScore} : {m.rightScore}</span><strong>{m.right}</strong></div><Pill tone="red">{m.clock}</Pill></article>)}</div>
      </Panel>
      <Panel title={fighter?'My next competition':'Organization pulse'} subtitle={fighter?'Your registered events and readiness':'Items that need attention'}>
        {fighter?<div className="show-next-card"><span className="eyebrow">SEP 26</span><h3>HACSA Fall Open</h3><p>Longsword • Sword & Buckler • 5v5</p><div className="show-ready-row"><Pill tone="green">Registered</Pill><Pill tone="green">Waiver complete</Pill><Pill tone="amber">Armor check at event</Pill></div><Link className="show-btn primary full" to="/events/fall-open">View my schedule</Link></div>:<div className="show-attention-list"><article><span className="show-attention-icon amber">!</span><div><b>7 registrations awaiting review</b><small>HACSA Fall Open</small></div><Link to="/events/fall-open">Review</Link></article><article><span className="show-attention-icon purple">♜</span><div><b>Badlands Forge requesting team approval</b><small>Submitted yesterday</small></div><Link to="/governance">Open</Link></article><article><span className="show-attention-icon blue">§</span><div><b>2027 ruleset draft ready</b><small>14 competition formats</small></div><Link to="/rules">Review</Link></article></div>}
      </Panel>
      <Panel title={captain?'Team roster':'Top season fighters'} subtitle={captain?'Red Deer Reavers • readiness for Fall Open':'Longsword • 2026 HACSA season'} actions={<Link to={captain?'/team-hq':'/rankings'}>View all →</Link>}>
        {captain?<div className="show-mini-roster">{demoFighters.filter(f=>f.teamId==='reavers').map(f=><Link to={`/fighters/${f.id}`} key={f.id}><Avatar initials={f.name.split(' ').map(x=>x[0]).join('').slice(0,2)} tone={f.photoTone}/><div><b>{f.name}</b><small>{f.categories.slice(0,2).join(' • ')}</small></div><Pill tone="green">Ready</Pill></Link>)}</div>:<div className="show-ranking-list">{seasonRankings.slice(0,4).map(r=><article key={r.rank}><strong>{r.rank}</strong><Avatar initials={r.fighter.split(' ').map(x=>x[0]).join('').slice(0,2)} size="sm"/><div><b>{r.fighter}</b><small>{r.team}</small></div><span>{r.points}</span></article>)}</div>}
      </Panel>
      <Panel title="Upcoming events" subtitle="Sanctioned and draft HACSA events" actions={<Link to="/events">Calendar →</Link>}>
        <div className="show-event-list compact">{demoEvents.map(e=><Link to={`/events/${e.id}`} key={e.id}><div className="show-date-tile"><b>{e.date.split(' ')[0]}</b><small>{e.date.split(' ').slice(1).join(' ')}</small></div><div><strong>{e.name}</strong><small>{e.city} • {e.ruleset}</small></div><Pill tone={e.status==='Live'?'red':e.status==='Registration Open'?'green':'neutral'}>{e.status}</Pill></Link>)}</div>
      </Panel>
    </div>
  </>;
}
