import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyEvents } from '../data/myEvents';
import { fetchFightNow, type FightNow } from '../data/myFightNow';
import { fetchTeamRequestsInbox } from '../data/teamManager';
import { todayIso } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { homeCards, type HomeCard } from '../lib/homeView';
import type { MyEvent } from '../lib/myEventsView';
import { InstallCard } from './InstallCard';
import { PUSH_EVENT } from './PushWiring';

const TONE = { go: { background: 'var(--live-soft)', borderColor: 'var(--live)' }, soon: { background: 'var(--brass-soft)', borderColor: 'var(--brass)' }, info: {} } as const;
const POLL_MS = 30_000;

interface Facts { fight: FightNow | null; events: MyEvent[]; requests: number }

/**
 * The signed-in Home: "what matters to me right now" and nothing else. A called fight comes first and is unmistakable; then the event that is on
 * today or the next one the person is really in; a captain sees waiting requests. With nothing to say it stays calm. Refreshes while open and the
 * moment an alert arrives; if it cannot refresh it says so instead of showing old facts as current.
 */
export function YourDay() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    const [fight, events, requests] = await Promise.allSettled([fetchFightNow(), fetchMyEvents(), fetchTeamRequestsInbox()]);
    if (fight.status === 'rejected' && events.status === 'rejected') { setStale(true); setError(fight.reason); return; }
    setStale(fight.status === 'rejected' || events.status === 'rejected');
    setError(null);
    setFacts(prev => ({
      fight: fight.status === 'fulfilled' ? fight.value : prev?.fight ?? null,
      events: events.status === 'fulfilled' ? events.value : prev?.events ?? [],
      requests: requests.status === 'fulfilled' ? requests.value.length : prev?.requests ?? 0
    }));
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    const again = () => { if (!document.hidden) void load(); };
    window.addEventListener('focus', again); window.addEventListener(PUSH_EVENT, again); document.addEventListener('visibilitychange', again);
    return () => { window.clearInterval(t); window.removeEventListener('focus', again); window.removeEventListener(PUSH_EVENT, again); document.removeEventListener('visibilitychange', again); };
  }, [load]);

  const cards: HomeCard[] = facts ? homeCards({ fight: facts.fight, events: facts.events, today: todayIso(), captainRequests: facts.requests }) : [];
  return (
    <section className="fade-in" aria-labelledby="yourday-h" style={{ display: 'grid', gap: 14 }}>
      <div><p className="eyebrow">Home</p><h1 id="yourday-h" style={{ fontSize: 'clamp(30px,6vw,46px)', marginTop: 8 }}>Your day</h1></div>
      {!facts && !error && <p className="muted" role="status">Loading…</p>}
      {error != null && !facts && <p role="alert">{friendlyError(error, 'Could not load your day.')} <button type="button" className="linklike" onClick={() => void load()}>Try again</button></p>}
      {stale && facts && <p className="src" role="status">Could not refresh just now. This may be out of date.</p>}
      {facts && cards.length === 0 && <p className="muted">Nothing needs you right now. <Link to="/events">Find an event</Link> or check <Link to="/my-events">My events</Link>.</p>}
      {cards.map(c => (
        <Link key={c.key} to={c.to} className="panel info" data-testid={`home-${c.key}`} style={{ display: 'grid', gap: 4, padding: 16, ...TONE[c.tone] }}>
          <b style={c.tone === 'info' ? { fontSize: 18 } : { fontSize: 'clamp(26px,7vw,34px)', fontFamily: 'var(--f-display)', textTransform: 'uppercase', letterSpacing: '.02em', color: c.tone === 'go' ? 'var(--live)' : 'var(--brass)' }}>{c.title}</b>
          <span style={{ overflowWrap: 'anywhere' }}>{c.detail}</span>
          <span className="more" style={{ fontWeight: 600 }}>{c.cta} →</span>
        </Link>
      ))}
      <InstallCard />
    </section>
  );
}
