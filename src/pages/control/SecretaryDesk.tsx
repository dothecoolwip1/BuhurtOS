import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { LiveCompetition, LiveEvent } from '../../data/api';
import { fetchSecretaryBoard } from '../../data/lyst';
import { useAsync } from '../../lib/useAsync';
import { friendlyError } from '../../lib/friendlyError';
import { fieldLabel } from '../../lib/eventDay';

/** One job at the table: follow the called fights and open their existing scoring screen. */
export function SecretaryDesk({ event }: { event: LiveEvent; competitions: LiveCompetition[] }) {
  const [tick, setTick] = useState(0);
  const live = useAsync(() => fetchSecretaryBoard(event.id), [event.id], [tick]);
  useEffect(() => {
    const refresh = () => setTick(n => n + 1);
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  const [picked, setPicked] = useState('');
  const boards = live.data?.fields ?? [];
  const board = boards.find(b => b.key === picked) ?? boards[0];
  const current = board?.now;
  const slots = [['Fighting now', current], ['Next', board?.on_deck], ['In the hole', board?.in_the_hole]] as const;
  return <section className="panel info secretary-desk" aria-label="Secretary desk" style={{ display: 'grid', gap: 16 }}>
    <header><p className="eyebrow">Secretary / Scorekeeper</p><h1>{event.name}</h1></header>
    {boards.length > 1 && <label>Lyst<select value={board?.key ?? ''} onChange={e => setPicked(e.target.value)}>{boards.map(b => <option key={b.key} value={b.key}>{fieldLabel(b.label)}</option>)}</select></label>}
    {(live.error != null || live.refreshError != null) && <p role="alert">{friendlyError(live.error ?? live.refreshError, 'Could not update the fights. The last received state is shown.')} <button type="button" className="btn btn-line" onClick={live.reload}>Try again</button></p>}
    {live.loading && !board ? <p role="status">Loading fights…</p> : !board ? <p>No fights have been called yet. The organizer sets the order.</p> : slots.map(([label, match]) => <article key={label} className="panel info" style={{ display: 'grid', gap: 10 }}>
      <h2>{label}</h2><p>{match ? <b>{match.a ?? 'To be decided'} vs {match.b ?? 'To be decided'}</b> : 'None called'}</p>
      {match && (label === 'Fighting now' || (label === 'Next' && !current)) && <Link className="btn btn-ink fq-big" to={`/events/${event.slug}/field/${encodeURIComponent(board.key)}?match=${match.match_id}&from=control`}>{label === 'Fighting now' ? 'Scores, marshal calls & clock' : 'Open next fight'}</Link>}
    </article>)}
    <p className="src">Updates automatically. Open the scoring screen to accept or return counter scores, enter the marshal’s awarded numbers and record calls. The organizer sets the running order.</p>
  </section>;
}
