import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PushAsk } from '../components/PushAsk';
import { Chip } from '../components/ui';
import { fetchMyEventEntryIds } from '../data/myFight';
import { fetchMyEvents } from '../data/myEvents';
import { friendlyError } from '../lib/friendlyError';
import { nextForEntries, recordText, restText, statusLabel, type NextFight } from '../lib/myFight';
import { useAsync } from '../lib/useAsync';
import type { LiveState } from '../lib/useLiveMatches';

const TONE_STYLE = {
  go: { background: 'var(--live-soft)', borderColor: 'var(--live)' },
  soon: { background: 'var(--brass-soft)', borderColor: 'var(--brass)' },
  wait: {}
} as const;

/** The one unmistakable word for a called fight: the same states a push alert announces. */
const STATE_BADGE: Partial<Record<string, string>> = { active: 'Up now', on_deck: 'On deck', in_the_hole: 'In the hole' };

const aheadChip = (u: NextFight) => (u.match.queueState === 'active' ? 'Fighting now' : u.held ? 'Held for another day' : u.ahead === null ? 'Not in the line yet' : u.ahead === 0 ? 'Next up' : u.ahead === 1 ? '1 fight ahead' : `${u.ahead} fights ahead`);

/**
 * "My next fight" for a signed-in fighter (or anyone accepted on a team entry): where to be, how many fights are ahead (from the field's line
 * and the saved plan order, never a clock), every other fight still to come in any competition, a short-rest note, whether they are checked in,
 * and the result so far. Live data comes from the workspace's useLiveMatches, so it updates by itself. Renders nothing for people with no entry.
 */
export function MyNextFight({ eventId, userId, competitions, live }: { eventId: string; userId: string | undefined; competitions: readonly { id: string; name: string }[]; live: LiveState }) {
  const mine = useAsync(() => (userId ? fetchMyEventEntryIds(eventId) : Promise.resolve([] as string[])), [eventId, userId]);
  const me = useAsync(() => (userId ? fetchMyEvents().catch(() => []) : Promise.resolve([])), [eventId, userId]);
  const entryIds = mine.data;
  const box = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const summary = useMemo(() => {
    const all = Object.values(live.data).flatMap(d => d.matches);
    return nextForEntries(all, entryIds ?? []);
  }, [live.data, entryIds]);

  // A tapped notification lands here (#my-next-fight): bring the card into view once it exists.
  const hasCard = !!userId && !!entryIds && entryIds.length > 0;
  useEffect(() => { if (hasCard && hash === '#my-next-fight') box.current?.scrollIntoView({ block: 'start' }); }, [hasCard, hash]);

  if (!userId) return null;
  if (mine.error != null) return <p role="alert">{friendlyError(mine.error, 'Could not load your fights.')}</p>;
  if (!entryIds || entryIds.length === 0) return null;

  const compName = (id: string) => competitions.find(c => c.id === id)?.name ?? 'Competition';
  const myEntries = Object.values(live.data).flatMap(d => d.entries).filter(e => entryIds.includes(e.id));
  const { next, results, upcoming, rest } = summary;
  const status = next ? statusLabel(next.match.queueState, next.ahead, next.field, next.held) : null;
  const waiting = live.updatedAt === null && live.error == null;
  const reg = me.data?.find(e => e.id === eventId)?.registration ?? null;
  const later = upcoming.slice(1);
  const where = (u: NextFight) => `${compName(u.match.competitionId)} · ${u.match.pool ? `Pool ${u.match.pool}, ` : ''}${u.match.roundLabel}`;

  return (
    <section ref={box} id="my-next-fight" className="panel info" style={{ display: 'grid', gap: 12, scrollMarginTop: 80, ...(status ? TONE_STYLE[status.tone] : {}) }} aria-labelledby="mynext-h" aria-live="polite">
      <div className="eyebrow">My next fight</div>
      {waiting && <p className="muted">Loading your fights…</p>}
      {live.error != null && live.updatedAt === null && <p role="alert">{friendlyError(live.error, 'Could not load the fights.')}</p>}
      {!waiting && !next && summary.total === 0 && (
        <>
          <h2 id="mynext-h" style={{ fontSize: 26 }}>No fights scheduled yet</h2>
          <p className="muted">You are entered{myEntries.length > 0 ? <> in {[...new Set(myEntries.map(e => compName(e.competitionId)))].join(', ')}</> : null}. The draw has not put you in a match yet. This page updates by itself when it does.</p>
        </>
      )}
      {next && status && (
        <>
          {STATE_BADGE[next.match.queueState] && <div className={`mf-state ${status.tone}`} data-testid="mf-state" aria-hidden="true">{STATE_BADGE[next.match.queueState]}</div>}
          <h2 id="mynext-h" style={{ fontSize: status.tone === 'go' ? 30 : 26 }}>{status.label}</h2>
          <p style={{ fontSize: 17 }}><b>vs {next.opponent}</b></p>
          <p>{status.detail}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip>{next.field}</Chip>
            {next.match.queueState !== 'active' && <Chip tone={next.ahead !== null && next.ahead <= 1 ? 'brass' : ''}>{aheadChip(next)}</Chip>}
            <span className="src">{where(next)}</span>
          </div>
          {rest && <p role="status" className="mf-rest" style={{ margin: 0, fontWeight: 600 }}>Short rest: {restText(rest)}</p>}
        </>
      )}
      {!waiting && !next && summary.total > 0 && (
        <>
          <h2 id="mynext-h" style={{ fontSize: 26 }}>No more fights scheduled for you yet</h2>
          <p className="muted">You have finished every match you have been drawn into so far. If a later round opens for you it will show up here.</p>
        </>
      )}
      {reg && reg.status === 'accepted' && (
        <p className="src mf-checkin" data-testid="my-checkin" style={{ margin: 0 }}>
          {reg.checkedIn ? '✓ You are checked in.' : 'Not checked in yet: see the registration desk before your first fight.'}
          {reg.feeDueCents > 0 && !reg.feePaid ? ' Your fee is not marked paid yet.' : ''}
        </p>
      )}
      {later.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ margin: 0 }}><b>Also still to fight:</b> {later.length === 1 ? '1 fight' : `${later.length} fights`}</p>
          <ul className="mf-later" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }} aria-label="Your other fights">
            {later.map(u => (
              <li key={u.match.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip>{u.field}</Chip>
                <Chip tone={u.match.queueState !== 'scheduled' ? 'brass' : ''}>{aheadChip(u)}</Chip>
                <span style={{ overflowWrap: 'anywhere' }}>vs {u.opponent}</span>
                <span className="src">{where(u)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {results.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p><b>Result so far:</b> {recordText(summary)}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {results.map(r => (
              <li key={r.matchId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip tone={r.outcome === 'won' ? 'win' : ''}>{r.outcome === 'won' ? 'Won' : r.outcome === 'lost' ? 'Lost' : 'Drawn'}</Chip>
                <span style={{ overflowWrap: 'anywhere' }}>vs {r.opponent}{r.mine !== null && r.theirs !== null ? ` ${r.mine}–${r.theirs}` : ''}</span>
                <span className="src">{compName(r.competitionId)} · {r.roundLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {live.error != null && live.updatedAt !== null && <p className="src">Could not refresh just now. Showing the last information we have.</p>}
      {next && <PushAsk />}
    </section>
  );
}
