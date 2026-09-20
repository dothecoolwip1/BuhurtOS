import { MatchCard } from '../components/MatchCard';
import { useAppState } from '../features/AppState';
import { resolveStreamEmbed } from '../lib/stream';

export function PublicPage() {
  const { event, matches, roster, announcements } = useAppState();
  if (!event) return null;
  const embed = resolveStreamEmbed(event.livestreamUrl);
  const visible = [...matches].sort((a,b) => a.scheduledOrder - b.scheduledOrder).filter(m => ['active','on_deck','in_the_hole','finalized'].includes(m.status)).slice(0,5);
  return <div className="public-page">
    <section className="public-hero"><span className="live-dot">LIVE</span><h1>{event.name}</h1><p>{event.venue}</p>{event.livestreamUrl && <a className="stream-btn" href={event.livestreamUrl} target="_blank" rel="noreferrer">Open Livestream</a>}</section>{embed && <div className="stream-frame"><iframe src={embed.embedUrl} title={`${embed.provider} livestream`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>}
    <section className="section-head"><div><span className="eyebrow">Spectator view</span><h2>Current Fight Order</h2></div></section>
    <div className="match-list public">{visible.map(match => <MatchCard key={match.id} match={match} roster={roster} />)}</div>
    <section className="section-head"><div><span className="eyebrow">Updates</span><h2>Announcements</h2></div></section>
    <div className="announcement-list">{announcements.filter(a => a.isPublic).map(a => <article key={a.id}><b>{a.title}</b><p>{a.body}</p></article>)}</div>
  </div>;
}
