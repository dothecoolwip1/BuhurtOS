import { Link } from 'react-router-dom';
import { demoEvents } from '../data/showcase';
import { PageHeader, Pill, StatCard } from '../components/ShowcaseUI';

export function ShowcaseEventsPage(){
  return <>
    <PageHeader eyebrow="Tournament Operations" title="Events" description="Sanctioning, registration, staffing, field operations, pools, brackets, results and public coverage." actions={<><button className="show-btn secondary">Season calendar</button><button className="show-btn primary">＋ Create event</button></>}/>
    <div className="show-stat-grid"><StatCard label="2026 sanctioned" value="8" note="6 complete • 1 live • 1 upcoming" tone="accent"/><StatCard label="Total competitors" value="187" note="Across sanctioned events"/><StatCard label="Matches recorded" value="642" note="Permanent HACSA history"/><StatCard label="Next championship" value="Mar 20" note="2027 HACSA Championship" tone="warn"/></div>
    <div className="show-event-cards">{demoEvents.map(event=><Link to={'/events/'+event.id} key={event.id} className="show-event-card">
      <div className="show-event-card-top"><div><span className="eyebrow">{event.sanctioning} SANCTIONED</span><h2>{event.name}</h2><p>{event.date} • {event.venue} • {event.city}</p></div><Pill tone={event.status==='Live'?'red':event.status==='Registration Open'?'green':'neutral'}>{event.status}</Pill></div>
      <div className="show-event-metrics"><span><b>{event.teams}</b><small>Teams</small></span><span><b>{event.fighters}</b><small>Fighters</small></span><span><b>{event.fields}</b><small>Fields</small></span><span><b>{event.registrations}</b><small>Registrations</small></span></div>
      <div className="show-event-footer"><span><small>RULESET</small><b>{event.ruleset}</b></span><span><small>HOST</small><b>{event.host}</b></span><i>Open command centre →</i></div>
    </Link>)}</div>
  </>;
}
