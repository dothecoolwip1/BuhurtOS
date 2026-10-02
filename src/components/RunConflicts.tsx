import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchScheduleConflicts, groupConflictsByFighter } from '../data/conflicts';
import { fetchEventResolveInput, moveMatchTime } from '../data/runSchedule';
import { resolveSchedule, type ResolveMove, type ResolveResult } from '../lib/autoResolve';
import { friendlyError } from '../lib/friendlyError';
import { conflictSide, conflictsHeadline, timeLabel } from '../lib/runSchedule';
import { useAsync } from '../lib/useAsync';

const errorStyle = { color: 'var(--live)' } as const;
const REST_OPTIONS = [0, 5, 10, 15] as const;

type Plan = ResolveResult & { names: Map<string, string> };

async function applyMoves(moves: readonly ResolveMove[], back = false): Promise<void> {
  for (const mv of moves) await moveMatchTime(mv.matchId, back ? mv.from : mv.to);
}

/**
 * Top of the Run tab: fighters booked into two overlapping matches, and the fix.
 * Before the event day (`autoFix`) clashes are fixed by themselves as soon as they appear, with an Undo. From the event day on nothing
 * moves unless the organizer presses "Fix automatically" and confirms, so a called match never jumps under people's feet.
 */
export function ConflictsPanel({ eventId, competitionNames, timeZone, reloadKey, onJump, autoFix, onFixed }: {
  eventId: string; competitionNames: Map<string, string>; timeZone: string; reloadKey: number; onJump: (matchId: string) => void; autoFix: boolean; onFixed: () => void;
}) {
  const res = useAsync(() => fetchScheduleConflicts(eventId), [eventId, reloadKey]);
  const groups = useMemo(() => groupConflictsByFighter(res.data ?? []), [res.data]);
  const name = (id: string) => competitionNames.get(id) ?? 'another competition';
  const [rest, setRest] = useState<number>(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ moves: ResolveMove[]; auto: boolean; stillClashing: number } | null>(null);
  const tried = useRef(new Set<string>());

  const makePlan = async (restMinutes: number): Promise<Plan> => {
    const input = await fetchEventResolveInput(eventId);
    return { ...resolveSchedule(input, { restMinutes }), names: new Map(input.map(m => [m.id, competitionNames.get(m.competitionId) ?? 'Match'])) };
  };
  const apply = async (p: Plan, auto: boolean) => {
    await applyMoves(p.moves);
    setDone({ moves: p.moves, auto, stillClashing: p.stillClashing.length });
    setPlan(null);
    onFixed();
  };

  // Before the event day: fix by itself, once per distinct set of clashes (so a clash it cannot fix does not loop).
  const signature = (res.data ?? []).map(c => `${c.matchA}:${c.matchB}`).sort().join('|');
  useEffect(() => {
    if (!autoFix || !signature || busy || tried.current.has(signature)) return;
    tried.current.add(signature);
    setBusy(true); setError(null);
    makePlan(0).then(p => (p.moves.length > 0 ? apply(p, true) : undefined)).catch(e => setError(friendlyError(e, 'Could not fix the schedule automatically.'))).finally(() => setBusy(false));
  }, [autoFix, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = async () => {
    setBusy(true); setError(null);
    try { setPlan(await makePlan(rest)); } catch (e) { setError(friendlyError(e, 'Could not work out a fix.')); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!plan) return;
    setBusy(true); setError(null);
    try { await apply(plan, false); } catch (e) { setError(friendlyError(e, 'Could not move every match. Some may already have their new times.')); onFixed(); } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!done) return;
    setBusy(true); setError(null);
    try { await applyMoves(done.moves, true); setDone(null); onFixed(); } catch (e) { setError(friendlyError(e, 'Could not undo every move.')); onFixed(); } finally { setBusy(false); }
  };

  const doneNote = done && done.moves.length > 0 && (
    <div className="panel info" role="status" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
      <span>{done.auto ? 'Fixed by itself: ' : ''}moved {done.moves.length} {done.moves.length === 1 ? 'match' : 'matches'} later so nobody is double-booked.{done.stillClashing > 0 ? ` ${done.stillClashing} called or finished ${done.stillClashing === 1 ? 'match still clashes' : 'matches still clash'} and need a hand.` : ''}</span>
      <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void undo()}>Undo</button>
    </div>
  );

  if (res.error != null) return <p role="alert" style={errorStyle}>{friendlyError(res.error, 'Could not check for double-booked fighters.')}</p>;
  if (!res.data) return <p className="muted">Checking the schedule…</p>;
  const headline = conflictsHeadline(groups.length);
  if (!headline) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {doneNote}
        <div className="panel info" aria-label="Schedule conflicts"><p><b>No double-booked fighters</b>{autoFix ? <span className="src"> · Until the event day, clashes are fixed automatically.</span> : null}</p></div>
      </div>
    );
  }
  const clashes = res.data.length;
  return (
    <section className="panel info" aria-label="Schedule conflicts" style={{ display: 'grid', gap: 12, borderColor: 'var(--live)' }}>
      <h3>{headline}</h3>
      {doneNote}
      <p className="src">{autoFix
        ? 'Before the event day BuhurtOS fixes these by itself by moving matches a little later. If it could not, the ones left involve matches already called.'
        : 'It is the event day, so nothing moves by itself. Fix them automatically below, or move single matches by hand.'}</p>

      {!plan && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field-in" style={{ flex: '0 1 200px' }}>Rest between a fighter's matches
            <select value={rest} onChange={e => setRest(Number(e.target.value))}>{REST_OPTIONS.map(n => <option key={n} value={n}>{n === 0 ? 'None' : `${n} minutes`}</option>)}</select>
          </label>
          <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void preview()}>{busy ? 'Working…' : 'Fix automatically'}</button>
        </div>
      )}
      {plan && (
        <div className="panel info" role="alertdialog" aria-label="Confirm automatic fix" style={{ display: 'grid', gap: 8 }}>
          {plan.moves.length === 0
            ? <p><b>Nothing can be moved.</b> The clashes left are between matches that are already called, playing or finished. Move one of them by hand.</p>
            : <>
                <p><b>Move {plan.moves.length} {plan.moves.length === 1 ? 'match' : 'matches'} later?</b>{plan.endBefore && plan.endAfter && plan.endAfter !== plan.endBefore ? ` The last match then ends at ${timeLabel(plan.endAfter, timeZone)} instead of ${timeLabel(plan.endBefore, timeZone)}.` : ' The day does not get longer.'}</p>
                <details><summary>See the moves</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{plan.moves.map(mv => <li key={mv.matchId}>{plan.names.get(mv.matchId)}: {timeLabel(mv.from, timeZone)} → {timeLabel(mv.to, timeZone)}</li>)}</ul>
                </details>
                {plan.stillClashing.length > 0 && <p className="src">{plan.stillClashing.length} called or finished {plan.stillClashing.length === 1 ? 'match' : 'matches'} will still clash.</p>}
              </>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {plan.moves.length > 0 && <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void confirm()}>{busy ? 'Moving…' : `Move ${plan.moves.length}`}</button>}
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={errorStyle}>{error}</p>}

      <details>
        <summary>Who is double-booked ({groups.length} {groups.length === 1 ? 'fighter' : 'fighters'}, {clashes} {clashes === 1 ? 'clash' : 'clashes'})</summary>
        <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
          {groups.map(g => (
            <div key={g.fighterId} style={{ display: 'grid', gap: 6 }}>
              <b>{g.displayName}</b>
              {g.conflicts.map(c => (
                <div key={`${c.matchA}-${c.matchB}`} style={{ display: 'grid', gap: 6 }}>
                  <p className="src">{conflictSide(name(c.competitionA), c.scheduledA, timeZone)} and {conflictSide(name(c.competitionB), c.scheduledB, timeZone)} overlap by {c.overlapMinutes} min.</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-line btn-sm" onClick={() => onJump(c.matchA)}>Go to {timeLabel(c.scheduledA, timeZone)}</button>
                    <button type="button" className="btn btn-line btn-sm" onClick={() => onJump(c.matchB)}>Go to {timeLabel(c.scheduledB, timeZone)}</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
