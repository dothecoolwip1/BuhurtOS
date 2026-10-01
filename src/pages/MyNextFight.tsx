import { useMemo } from 'react';
import { Chip } from '../components/ui';
import { fetchMyEventEntryIds } from '../data/myFight';
import { friendlyError } from '../lib/friendlyError';
import { nextForEntries, recordText, statusLabel } from '../lib/myFight';
import { useAsync } from '../lib/useAsync';
import type { LiveState } from '../lib/useLiveMatches';

const TONE_STYLE = {
  go: { background: 'var(--live-soft)', borderColor: 'var(--live)' },
  soon: { background: 'var(--brass-soft)', borderColor: 'var(--brass)' },
  wait: {}
} as const;

/**
 * "My next fight" for a signed-in fighter (or anyone accepted on a team entry): where to be, and when.
 * Live data comes from the workspace's useLiveMatches, so it updates by itself. Renders nothing for people with no entry in this event.
 */
export function MyNextFight({ eventId, userId, competitions, live }: { eventId: string; userId: string | undefined; competitions: readonly { id: string; name: string }[]; live: LiveState }) {
  const mine = useAsync(() => (userId ? fetchMyEventEntryIds(eventId) : Promise.resolve([] as string[])), [eventId, userId]);
  const entryIds = mine.data;
  const summary = useMemo(() => {
    const all = Object.values(live.data).flatMap(d => d.matches);
    return nextForEntries(all, entryIds ?? []);
  }, [live.data, entryIds]);

  if (!userId) return null;
  if (mine.error != null) return <p role="alert">{friendlyError(mine.error, 'Could not load your fights.')}</p>;
  if (!entryIds || entryIds.length === 0) return null;

  const compName = (id: string) => competitions.find(c => c.id === id)?.name ?? 'Competition';
  const myEntries = Object.values(live.data).flatMap(d => d.entries).filter(e => entryIds.includes(e.id));
  const { next, results } = summary;
  const status = next ? statusLabel(next.match.queueState, next.ahead, next.match.field) : null;
  const waiting = live.updatedAt === null && live.error == null;

  return (
    <section className="panel info" style={{ display: 'grid', gap: 12, ...(status ? TONE_STYLE[status.tone] : {}) }} aria-labelledby="mynext-h" aria-live="polite">
      <div className="eyebrow">My next fight</div>
      {waiting && <p className="muted">Loading your fights…</p>}
      {live.error != null && live.updatedAt === null && <p role="alert">{friendlyError(live.error, 'Could not load the fights.')}</p>}
      {!waiting && !next && summary.total === 0 && (
        <>
          <h2 id="mynext-h" style={{ fontSize: 26 }}>No fights scheduled yet</h2>
          <p className="muted">You are entered{myEntries.length > 0 ? <> in {myEntries.map(e => compName(e.competitionId)).join(', ')}</> : null}. The draw has not put you in a match yet. This page updates by itself when it does.</p>
        </>
      )}
      {next && status && (
        <>
          <h2 id="mynext-h" style={{ fontSize: status.tone === 'go' ? 30 : 26 }}>{status.label}</h2>
          <p style={{ fontSize: 17 }}><b>vs {next.opponent}</b></p>
          <p>{status.detail}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip>{next.match.field ?? 'Field not set yet'}</Chip>
            {next.ahead !== null && next.match.queueState !== 'active' && <Chip tone="brass">{next.ahead === 0 ? 'Next up' : next.ahead === 1 ? '1 match ahead' : `${next.ahead} matches ahead`}</Chip>}
            <span className="src">{compName(next.match.competitionId)} · {next.match.pool ? `Pool ${next.match.pool}, ` : ''}{next.match.roundLabel}</span>
          </div>
        </>
      )}
      {!waiting && !next && summary.total > 0 && (
        <>
          <h2 id="mynext-h" style={{ fontSize: 26 }}>No more fights scheduled for you yet</h2>
          <p className="muted">You have finished every match you have been drawn into so far. If a later round opens for you it will show up here.</p>
        </>
      )}
      {results.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p><b>Result so far:</b> {recordText(summary)}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {results.map(r => (
              <li key={r.matchId} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip tone={r.outcome === 'won' ? 'win' : ''}>{r.outcome === 'won' ? 'Won' : r.outcome === 'lost' ? 'Lost' : 'Drawn'}</Chip>
                <span style={{ overflowWrap: 'anywhere' }}>vs {r.opponent}{r.mine !== null && r.theirs !== null ? ` ${r.mine}–${r.theirs}` : ''}</span>
                <span className="src">{r.roundLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {live.error != null && live.updatedAt !== null && <p className="src">Could not refresh just now. Showing the last information we have.</p>}
    </section>
  );
}
