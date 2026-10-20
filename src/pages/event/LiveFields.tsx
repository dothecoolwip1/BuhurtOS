import { Link } from 'react-router-dom';
import type { CompetitionMatch } from '../../data/matches';
import type { LystPublic } from '../../data/lyst';
import { buildNowAndNext, NOW_LABEL } from '../../lib/liveView';
import { fieldKey, fieldLabel } from '../../lib/eventDay';
import { formatClock, remainingMs, MODE_LABEL, type ServerClock, type TimerMode } from '../../lib/lyst/timer';
import { lystPhase } from '../../lib/arena';
import { useNow } from '../../lib/lyst/useLystState';

/**
 * The public LIVE view (Pack 25): what is happening, per field, right now. NOW, ON DECK and IN THE HOLE from the same queue the organizer runs
 * (buildNowAndNext), with the official clock, round and marshal-confirmed score of the fight on now (lyst_public_state, public and official only).
 * It is the venue display's information, laid out for a phone in a hand. Nothing here is operated.
 */
export function LiveFields({ matches, competitionNames, lyst, clock, slug, mine, teamCompetitions, recorded = false }: {
  matches: readonly CompetitionMatch[]; competitionNames: ReadonlyMap<string, string>; lyst: readonly LystPublic[]; clock: ServerClock; slug: string;
  /** The signed-in fighter's own match ids, so their fight is marked. */
  mine?: ReadonlySet<string>;
  /** Team-fight competitions (buhurt): their official score is ROUNDS WON, and the card says so (Pack 26). */
  teamCompetitions?: ReadonlySet<string>;
  recorded?: boolean;
}) {
  const fields = buildNowAndNext(matches, competitionNames);
  const rows = new Map(lyst.map(r => [r.match_id, r]));
  if (fields.length === 0) return null;
  return (
    <section className="lf" aria-label={recorded ? 'Last recorded fight order' : 'Now on each field'} aria-live="polite">
      {fields.map(f => (
        <article key={f.field} className="lf-field panel" data-testid="live-field" data-field={f.field}>
          <header className="lf-head">
            <h2 className="lf-name">{fieldLabel(f.field)}</h2>
            <Link className="lf-arena" to={`/events/${slug}/arena/${encodeURIComponent(f.field)}`} aria-label={`Big screen for ${fieldLabel(f.field)}`}>Big screen</Link>
          </header>
          <ol className="lf-slots">
            {f.items.map(i => {
              const row = i.state === 'active' ? rows.get(i.id) : undefined;
              const isMine = mine?.has(i.id) ?? false;
              return (
                <li key={i.id} className={`lf-slot is-${i.state}${isMine ? ' is-mine' : ''}`} data-testid={`slot-${i.state}`}>
                  <span className="lf-k">{recorded ? i.state === 'active' ? 'Last recorded' : `Recorded ${NOW_LABEL[i.state].toLowerCase()}` : NOW_LABEL[i.state]}</span>
                  <div className="lf-body">
                    <div className="lf-names"><b className="lf-a">{i.nameA}</b><i>vs</i><b className="lf-b">{i.nameB}</b></div>
                    <span className="lf-ctx">{i.competition} · {i.round}{isMine ? ' · your fight' : ''}</span>
                    {row && <LystLine row={row} clock={clock} recorded={recorded} rounds={teamCompetitions?.has(i.competitionId) ?? false} />}
                  </div>
                </li>
              );
            })}
          </ol>
        </article>
      ))}
    </section>
  );
}

/** The official state of the fight on now: round, clock and the marshal-confirmed totals (never a counter's number). */
function LystLine({ row, clock, rounds, recorded }: { row: LystPublic; clock: ServerClock; rounds: boolean; recorded: boolean }) {
  const running = !recorded && row.timer_status === 'running';
  const now = useNow(running, 250);
  const left = row.timer_status && row.timer_mode ? remainingMs({ status: row.timer_status, remaining_ms: row.timer_remaining_ms ?? 0, started_at: row.timer_started_at }, clock.now(now)) : null;
  const phase = lystPhase({ round: row.round_no, roundStatus: row.round_status, roundsConfirmed: row.rounds_confirmed, timer: null, marks: [] });
  return (
    <div className="lf-lyst">
      {(row.rounds_confirmed > 0 || row.round_no) && <span className="lf-score mono" aria-label={`Official ${rounds ? 'rounds won' : 'score'} ${row.official_a} to ${row.official_b}`}>{row.official_a}<i>–</i>{row.official_b}{rounds && <small className="lf-unit">rounds won</small>}</span>}
      {phase && <span className="lf-phase">{phase}</span>}
      {!recorded && left !== null && row.timer_mode && <span className={`lf-clock mono${running ? ' is-running' : ''}`} role="timer" aria-label={`${MODE_LABEL[row.timer_mode as TimerMode] ?? 'Clock'} ${formatClock(left)}`}>{formatClock(left)}</span>}
    </div>
  );
}

/** The fields that have any live or queued fight, for a quick jump row. */
export const liveFieldNames = (matches: readonly CompetitionMatch[]): string[] => buildNowAndNext(matches, new Map()).map(f => f.field);
export { fieldKey };
