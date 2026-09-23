import { Link } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { computeEventStandings } from '../lib/standings';
import { resolveStreamEmbed } from '../lib/stream';

export function PublicPage() {
  const { event, matches, roster, announcements, fightCards } = useAppState();
  if (!event) return null;

  const embed = resolveStreamEmbed(event.livestreamUrl);
  const publicAnnouncements = announcements
    .filter(a => a.isPublic && (!a.scheduledFor || new Date(a.scheduledFor).getTime() <= Date.now()))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const standings = computeEventStandings(event,matches,roster).slice(0,10);
  const ordered = [...matches].filter(match=>match.status!=='cancelled').sort((a,b)=>a.scheduledOrder-b.scheduledOrder);
  const name = (matchId:string,side:1|2) => {
    const match=matches.find(item=>item.id===matchId);
    const participant=match?.participants.find(item=>item.sideIndex===side);
    if(!participant)return 'TBD';
    if(participant.isPlaceholder)return participant.placeholderLabel ?? 'TBD';
    return roster.find(entry=>entry.id===participant.rosterEntryId)?.displayName ?? 'TBD';
  };

  const knownCardIds=new Set(fightCards.map(card=>card.id));
  const visibleFields=[
    ...[...fightCards].filter(card=>card.status!=='archived').sort((a,b)=>a.sortOrder-b.sortOrder).map(card=>({
      id:card.id,
      name:card.name,
      matches:ordered.filter(match=>match.fightCardId===card.id)
    })),
    ...(ordered.some(match=>!match.fightCardId||!knownCardIds.has(match.fightCardId))?[{
      id:'unassigned',
      name:'Event Queue',
      matches:ordered.filter(match=>!match.fightCardId||!knownCardIds.has(match.fightCardId))
    }]:[])
  ];

  return <div className="public-page">
    <section className="public-hero">
      <span className="live-dot">{event.status==='live'?'LIVE':event.status.toUpperCase()}</span>
      <h1>{event.name}</h1>
      <p>{event.venue} · {new Date(event.startsAt).toLocaleString()}</p>
      <div className="header-actions">
        {event.livestreamUrl&&<a className="stream-btn" href={event.livestreamUrl} target="_blank" rel="noreferrer">Open Livestream</a>}
        {event.registrationOpen&&<Link className="stream-btn" to={"/register?event="+encodeURIComponent(event.id)}>Register</Link>}
      </div>
    </section>

    <nav className="public-event-nav" aria-label="Event sections">
      <a href="#fields">Live Fields</a><a href="#schedule">Schedule</a>
      {event.standingsMode!=='no_standings'&&<a href="#standings">Standings</a>}
      <a href="#updates">Updates</a>
    </nav>

    {embed&&<div className="stream-frame"><iframe src={embed.embedUrl} title={embed.provider+" livestream"} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>}

    <section id="fields" className="section-head"><div><span className="eyebrow">Live event board</span><h2>Fields & Bullpens</h2><p>Current, on-deck and in-the-hole matches update automatically.</p></div></section>
    <div className="public-field-board">
      {visibleFields.length===0?<div className="state-card">The fight card has not been published yet.</div>:visibleFields.map(field=>{
        const active=field.matches.find(match=>match.status==='active');
        const onDeck=field.matches.find(match=>match.status==='on_deck');
        const inHole=field.matches.find(match=>match.status==='in_the_hole');
        const queue=[['Now',active],['On Deck',onDeck],['In The Hole',inHole]] as const;
        return <section className="public-field-card" key={field.id}>
          <header><div><h3>{field.name}</h3><small>{field.matches.filter(match=>!['finalized','cancelled'].includes(match.status)).length} matches remaining</small></div>{active&&<span className="status-pill warn">Live</span>}</header>
          <div className="public-field-queue">{queue.map(([label,match])=><article className={match?.status==='active'?'active':''} key={label}>
            <div className="queue-label"><span>{label}</span><span>{match?.category??''}</span></div>
            {match?<div className="queue-match"><b>{name(match.id,1)}</b><span>VS</span><b>{name(match.id,2)}</b></div>:<small>Waiting for assignment</small>}
          </article>)}</div>
        </section>;
      })}
    </div>

    <div className="public-event-grid">
      <section id="schedule" className="panel-card">
        <div className="section-head"><div><span className="eyebrow">Full order</span><h2>Event Schedule</h2></div></div>
        <div className="public-schedule">{ordered.length===0?<div className="state-card">No matches are published yet.</div>:ordered.map((match,index)=><article key={match.id}>
          <span className="schedule-order">#{index+1}</span>
          <div className="schedule-match"><b>{name(match.id,1)} vs {name(match.id,2)}</b><small>{match.label} · {match.category}{match.fightCardId?' · '+(fightCards.find(card=>card.id===match.fightCardId)?.name??'Field'):''}</small></div>
          <span className={"status-pill "+(match.status==='active'?'warn':match.status==='finalized'?'ok':'')}>{match.status.replaceAll('_',' ')}</span>
        </article>)}</div>
      </section>

      {event.standingsMode!=='no_standings'&&<section id="standings" className="panel-card">
        <div className="section-head"><div><span className="eyebrow">Results</span><h2>Standings</h2></div></div>
        {standings.length===0?<div className="state-card">Standings will appear after finalized matches.</div>:<table className="public-mini-standings"><thead><tr><th>#</th><th>Competitor</th><th>W</th><th>Pts</th></tr></thead><tbody>{standings.map((row,index)=><tr key={row.rosterEntryId}><td>{index+1}</td><td>{row.name}</td><td>{row.wins}</td><td>{row.standingPoints}</td></tr>)}</tbody></table>}
      </section>}
    </div>

    <section id="updates" className="section-head"><div><span className="eyebrow">Updates</span><h2>Announcements</h2></div></section>
    <div className="announcement-list">{publicAnnouncements.length===0?<div className="state-card">No public announcements right now.</div>:publicAnnouncements.map(a=><article key={a.id}><div className="grow"><b>{a.title}</b><p>{a.body}</p><small>{new Date(a.createdAt).toLocaleString()}</small></div></article>)}</div>
  </div>;
}
