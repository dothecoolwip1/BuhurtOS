import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from '../ui';
import type { CompetitionMatch } from '../../data/matches';
import type { QueueMove } from '../../data/eventDay';
import { matchContext, type FieldBoard, type AdvancePlan } from '../../lib/eventDay';
import { sideLabel } from '../../lib/entryLabel';
import { timeLabel } from '../../lib/runSchedule';

export interface BoardActions {
  /** One action at a time per screen: every button is disabled while one runs, so a double tap can never send two. */
  busy: boolean;
  startNext: (board: FieldBoard) => void;
  move: (match: CompetitionMatch, action: QueueMove) => void;
  sendBack: (match: CompetitionMatch) => void;
}
interface Ctx { slug: string; timeZone: string; competitionNames: ReadonlyMap<string, string>; actions: BoardActions }

const TBD = 'To be decided';
const names = (m: CompetitionMatch) => ({ a: sideLabel(m.entryA, m.nameA, TBD), b: sideLabel(m.entryB, m.nameB, TBD) });
const context = (m: CompetitionMatch, c: Ctx) => matchContext(m, c.competitionNames.get(m.competitionId) ?? 'Competition');
const runLink = (slug: string, matchId: string) => `/events/${slug}/manage?tab=run&match=${matchId}`;
/** The existing scoring screen, opened straight on this match. `from` gives it a way back to Event day. */
export const scoreboardLink = (slug: string, field: string, matchId: string) => `/events/${slug}/field/${encodeURIComponent(field)}?match=${matchId}&from=eventday`;

function Versus({ m, big = false }: { m: CompetitionMatch; big?: boolean }) {
  const n = names(m);
  return (
    <div className={big ? 'ed-names big' : 'ed-names'}>
      <b>{n.a}</b><i>vs</i><b>{n.b}</b>
    </div>
  );
}

/** Everything an organizer might do to a waiting or called match, behind one "Change" disclosure so the card itself stays quiet. */
function Change({ m, c, live }: { m: CompetitionMatch; c: Ctx; live: boolean }) {
  const { actions } = c;
  const label = `${names(m).a} against ${names(m).b}`;
  return (
    <details className="ed-change">
      <summary aria-label={`Change ${label}`}>Change</summary>
      <div className="ed-change-body">
        {!live && <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => actions.move(m, 'first')}>Run next</button>}
        {!live && <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => actions.move(m, 'earlier')}>Run sooner</button>}
        {!live && <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => actions.move(m, 'later')}>Run later</button>}
        {live && <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => actions.move(m, 'skip')}>Skip for now</button>}
        {live && <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => actions.sendBack(m)}>Back to the line</button>}
        <Link className="btn btn-line" to={runLink(c.slug, m.id)}>Change field or time</Link>
      </div>
    </details>
  );
}

function SlotCard({ m, label, tone, c }: { m: CompetitionMatch; label: string; tone: 'brass' | ''; c: Ctx }) {
  return (
    <li className="ed-slot panel" aria-label={`${label}: ${names(m).a} against ${names(m).b}`}>
      <div className="ed-slot-head"><Chip tone={tone}>{label}</Chip><span className="ed-ctx">{context(m, c)}</span>{m.scheduledAt && <span className="ed-time">{timeLabel(m.scheduledAt, c.timeZone)}</span>}</div>
      <Versus m={m} />
      <Change m={m} c={c} live />
    </li>
  );
}

const SHOWN = 5;

/**
 * One field: what is fighting, then who is next, in the order a person at the table needs it. The match fighting now dominates; everything else
 * is smaller. No database words: "now", "on deck", "in the hole", "up next".
 */
export function FieldBoardView({ board, plan, c, next }: { board: FieldBoard; plan: AdvancePlan; c: Ctx; /** Pack 09D: the recommended next fight, shown under the fight in progress (or instead of the idle card). */ next?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  const { actions } = c;
  const upcoming = all ? board.upcoming : board.upcoming.slice(0, SHOWN);
  const canStart = plan.promote.length > 0;
  return (
    <section className="ed-field" aria-label={board.name}>
      <h2 className="ed-field-name">{board.name}<span className="ed-count">{board.done} of {board.total} fights done</span></h2>

      {board.now.length > 0 ? board.now.map(m => (
        <article key={m.id} className="ed-now panel" aria-label={`Now on ${board.name}`}>
          <div className="ed-slot-head"><Chip tone="live">Now</Chip><span className="ed-ctx">{context(m, c)}</span></div>
          <Versus m={m} big />
          <Link className="btn btn-ink fq-big ed-open" to={scoreboardLink(c.slug, board.name, m.id)}>Open scoreboard</Link>
          <details className="ed-change">
            <summary>More</summary>
            <div className="ed-change-body">
              <Link className="btn btn-line" to={runLink(c.slug, m.id)}>Open in Run tools</Link>
              <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => actions.sendBack(m)}>Back to the line (not fought)</button>
            </div>
          </details>
        </article>
      )) : board.state === 'ready' && next ? next : (
        <article className="ed-now ed-idle panel" aria-label={`Nothing active on ${board.name}`}>
          {board.state === 'finished' && <><h3>All fights on {board.name} are done</h3><p className="muted">Nothing is left to run here.</p></>}
          {board.state === 'ready' && !next && (<>
            <h3>No fight is active on {board.name}.</h3>
            <p className="muted">The next ready fight is {names(nextToStart(board, plan)).a} against {names(nextToStart(board, plan)).b}.</p>
            <button type="button" className="btn btn-ink fq-big" disabled={actions.busy || !canStart} onClick={() => actions.startNext(board)}>Start next ready match</button>
          </>)}
          {board.state === 'stalled' && (<>
            <h3>Nothing on {board.name} can start yet</h3>
            <p className="muted">{board.waiting.length === 1 ? 'One fight is' : `${board.waiting.length} fights are`} waiting. {board.waiting[0]?.blocked.text}.</p>
            {plan.demote.length > 0 && <button type="button" className="btn btn-line fq-big" disabled={actions.busy} onClick={() => actions.startNext(board)}>Tidy the queue</button>}
          </>)}
        </article>
      )}

      {board.now.length > 0 && next}
      {(board.onDeck.length > 0 || board.inTheHole.length > 0) && (
        <ul className="ed-slots" aria-label={`Next on ${board.name}`}>
          {board.onDeck.map(m => <SlotCard key={m.id} m={m} label="On deck" tone="brass" c={c} />)}
          {board.inTheHole.map(m => <SlotCard key={m.id} m={m} label="In the hole" tone="" c={c} />)}
        </ul>
      )}
      {board.now.length > 0 && board.onDeck.length === 0 && board.inTheHole.length === 0 && board.upcoming.length === 0 && board.state === 'running' && (
        <p className="muted ed-quiet">Nobody is waiting behind this fight{board.waiting.length > 0 ? `; ${board.waiting.length} more ${board.waiting.length === 1 ? 'is' : 'are'} waiting for earlier results` : ''}.</p>
      )}
      {board.now.length > 0 && (canStart || plan.demote.length > 0) && (
        <button type="button" className="btn btn-line ed-fill" disabled={actions.busy} onClick={() => actions.startNext(board)}>{plan.demote.length > 0 ? 'Tidy the queue' : 'Fill the queue behind it'}</button>
      )}

      {board.upcoming.length > 0 && (
        <div className="ed-upcoming">
          <h3>Up next <span className="ed-count">{board.upcoming.length}</span></h3>
          <ol>
            {upcoming.map((m, i) => (
              <li key={m.id} className="ed-up panel">
                <span className="ed-pos" aria-hidden="true">{i + 1}</span>
                <div className="ed-up-body">
                  <Versus m={m} />
                  <span className="ed-ctx">{context(m, c)}{m.scheduledAt ? ` · ${timeLabel(m.scheduledAt, c.timeZone)}` : ''}</span>
                  <Change m={m} c={c} live={false} />
                </div>
              </li>
            ))}
          </ol>
          {board.upcoming.length > SHOWN && <button type="button" className="btn btn-line" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${board.upcoming.length}`}</button>}
        </div>
      )}

      {board.waiting.length > 0 && board.state !== 'stalled' && (
        <details className="ed-waiting">
          <summary>{board.waiting.length} waiting for earlier results or an entrant</summary>
          <ul>{board.waiting.map(w => <li key={w.match.id}><b>{names(w.match).a} vs {names(w.match).b}</b> <span className="muted">· {context(w.match, c)} · {w.blocked.text}</span></li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** The match "Start next ready match" would make active, for the sentence under the button. */
function nextToStart(board: FieldBoard, plan: AdvancePlan): CompetitionMatch {
  const id = plan.promote.find(p => p.to === 'active')?.matchId;
  return [...board.onDeck, ...board.inTheHole, ...board.upcoming].find(m => m.id === id) ?? board.onDeck[0] ?? board.inTheHole[0] ?? board.upcoming[0];
}
