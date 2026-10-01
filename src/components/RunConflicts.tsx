import { useMemo } from 'react';
import { fetchScheduleConflicts, groupConflictsByFighter } from '../data/conflicts';
import { friendlyError } from '../lib/friendlyError';
import { conflictSide, conflictsHeadline, conflictsStripLabel, distinctFighters, timeLabel } from '../lib/runSchedule';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;

/** Top of the Run tab: fighters booked into two matches that overlap (found by fighter, across competitions). */
export function ConflictsPanel({ eventId, competitionNames, timeZone, reloadKey, onJump }: {
  eventId: string; competitionNames: Map<string, string>; timeZone: string; reloadKey: number; onJump: (matchId: string) => void;
}) {
  const res = useAsync(() => fetchScheduleConflicts(eventId), [eventId, reloadKey]);
  const groups = useMemo(() => groupConflictsByFighter(res.data ?? []), [res.data]);
  const name = (id: string) => competitionNames.get(id) ?? 'another competition';

  if (res.error != null) return <p role="alert" style={errorStyle}>{friendlyError(res.error, 'Could not check for double-booked fighters.')}</p>;
  if (!res.data) return <p className="muted">Checking the schedule…</p>;
  const headline = conflictsHeadline(groups.length);
  if (!headline) return <div className="panel info" aria-label="Schedule conflicts"><p><b>No double-booked fighters</b></p></div>;
  return (
    <section className="panel info" aria-label="Schedule conflicts" style={{ display: 'grid', gap: 10, borderColor: 'var(--live)' }}>
      <h3>{headline}</h3>
      {groups.map(g => (
        <div key={g.fighterId} style={{ display: 'grid', gap: 8 }}>
          <b>{g.displayName}</b>
          {g.conflicts.map(c => (
            <div key={`${c.matchA}-${c.matchB}`} style={{ display: 'grid', gap: 6 }}>
              <p>
                {conflictSide(name(c.competitionA), c.scheduledA, timeZone)} and {conflictSide(name(c.competitionB), c.scheduledB, timeZone)}.
                {' '}They overlap by {c.overlapMinutes} minute{c.overlapMinutes === 1 ? '' : 's'}.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-line" onClick={() => onJump(c.matchA)}>Move {name(c.competitionA)} at {timeLabel(c.scheduledA, timeZone)}</button>
                <button type="button" className="btn btn-line" onClick={() => onJump(c.matchB)}>Move {name(c.competitionB)} at {timeLabel(c.scheduledB, timeZone)}</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** One small line for the organizer's "Needs attention" area on the manage page. Renders nothing when all is well. */
export function ConflictsAlert({ eventId, onOpen }: { eventId: string; onOpen: () => void }) {
  const res = useAsync(() => fetchScheduleConflicts(eventId), [eventId]);
  const label = res.data ? conflictsStripLabel(distinctFighters(res.data)) : null;
  if (!label) return null;
  return (
    <section className="panel info" aria-label="Schedule needs attention" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <b>Needs attention now</b>
      <button type="button" className="btn btn-line" onClick={onOpen}>{label}</button>
    </section>
  );
}
