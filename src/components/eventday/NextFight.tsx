import { useState } from 'react';
import { Chip } from '../ui';
import { Dialog } from '../Dialog';
import type { CompetitionMatch } from '../../data/matches';
import { sideLabel } from '../../lib/entryLabel';
import { fightingNow } from '../../lib/eventDay';
import { planHeadline, restWords, type Plan, type PlannedFight } from '../../lib/planner';

export interface NextFightActions {
  busy: boolean;
  /** Start this fight now on its field (nothing is fighting there). */
  run: (m: CompetitionMatch) => void;
  /** Make this fight the next one instead of the recommendation. */
  choose: (m: CompetitionMatch, startNow: boolean) => void;
}

/** Everyone in a fight, side by side, with their rest; a team side shows the person with the least rest (that is what decides the wait). */
function restLines(f: PlannedFight, m: CompetitionMatch, sides: ReadonlyMap<string, readonly string[]>, names: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  for (const [entry, label] of [[m.entryA, sideLabel(m.entryA, m.nameA, 'Side A')], [m.entryB, sideLabel(m.entryB, m.nameB, 'Side B')]] as const) {
    const people = entry ? sides.get(entry) ?? [] : [];
    const rests = f.rests.filter(r => people.includes(r.fighterId));
    if (rests.length === 0) continue;
    if (rests.length === 1) { lines.push(`${names.get(rests[0].fighterId) ?? label}: ${restWords(rests[0].rest).toLowerCase()}`); continue; }
    const fought = rests.filter(r => r.rest !== null).sort((a, b) => a.rest! - b.rest!);
    lines.push(fought.length === 0 ? `${label}: first fight today for everyone` : `${label}: least rest ${names.get(fought[0].fighterId) ?? 'one fighter'} (${restWords(fought[0].rest).toLowerCase()})`);
  }
  return lines;
}

/**
 * "Who fights next?" for one field (Pack 09D). The recommendation is the planner's: the fight already called, or the best-rested ready fight. Short rest is
 * always said out loud; the organizer can run it anyway or choose another fight. Nothing here moves a fight without a tap.
 */
export function NextFight({ field, label, plan, matches, fighting, called, sides, names, competitionNames, notReady, actions }: {
  /** Field key (lower case, as the planner's lanes) and the name to show. */
  field: string; label: string; plan: Plan; matches: ReadonlyMap<string, CompetitionMatch>; fighting: boolean;
  /** Something is already on deck (the slot above names it): this line then explains the order instead of repeating the pairing. */
  called?: boolean;
  sides: ReadonlyMap<string, readonly string[]>; names: ReadonlyMap<string, string>; competitionNames: ReadonlyMap<string, string>;
  /** Fighters in a fight who are not checked in (name list), by match. */
  notReady: ReadonlyMap<string, string[]>;
  actions: NextFightActions;
}) {
  const [choosing, setChoosing] = useState(false);
  const lane = (plan.lanes.get(field) ?? []).filter(f => matches.get(f.matchId)?.queueState !== 'active');
  const f = lane[0];
  const m = f ? matches.get(f.matchId) : undefined;
  if (!f || !m) return null;
  const others = lane.slice(1).map(x => ({ f: x, m: matches.get(x.matchId)! })).filter(x => x.m);
  // Pack 11: a fight further down the line may hold someone who is fighting on another field at this moment. It can be made next, never started now.
  const busyNow = fightingNow(matches.values(), sides);
  const busyIn = (o: CompetitionMatch): string | null => {
    for (const entry of [o.entryA, o.entryB]) for (const p of (entry ? sides.get(entry) ?? [] : [])) { const where = busyNow.get(p); if (where) return `${names.get(p) ?? 'Someone'} is fighting now on ${where}`; }
    return null;
  };
  const lines = restLines(f, m, sides, names);
  const missing = notReady.get(m.id) ?? [];
  const short = f.short;
  const worst = f.rests.filter(r => r.rest !== null && r.rest < plan.target).sort((a, b) => a.rest! - b.rest!)[0];
  const choose = others.length > 0 && <button type="button" className="btn btn-line" disabled={actions.busy} onClick={() => setChoosing(true)}>Choose another fight</button>;
  const vs = <p className="ed-next-vs"><b>{sideLabel(m.entryA, m.nameA, 'Side A')}</b> <span>vs</span> <b>{sideLabel(m.entryB, m.nameB, 'Side B')}</b></p>;
  const why = (
    <ul className="ed-next-why">
      {lines.map(l => <li key={l}>{l}</li>)}
      <li className={missing.length > 0 ? 'warn' : ''}>{missing.length > 0 ? `Not checked in: ${missing.join(', ')}` : 'Check-in: no recorded blocks. Verify full readiness at the desk.'}</li>
      <li className="src">{planHeadline(f, plan.target)}{f.reasons.some(r => r.code === 'equipment') ? ' · someone shares equipment: check the gear is free' : ''}</li>
    </ul>
  );
  const shortNote = short && worst && (
    <p className="ed-short" role="alert"><b>Short rest.</b> {names.get(worst.fighterId) ?? 'A fighter'} has had {worst.rest === 0 ? 'no fights' : `only ${worst.rest} fight${worst.rest === 1 ? '' : 's'}`} between appearances. No better ready matchup is available right now.</p>
  );
  // While a fight is on, the fight in progress dominates the screen: the next one is a single line that opens on a tap (the queue has already called it).
  if (fighting) {
    return (
      <details className={`ed-next compact panel${short ? ' short' : ''}`} aria-label={`Next up on ${label}`}>
        <summary><Chip tone={short ? 'live' : 'win'}>{called ? 'Why this order' : 'Next up'}</Chip> <span className="ed-next-line">{called ? planHeadline(f, plan.target) : `${sideLabel(m.entryA, m.nameA, 'Side A')} vs ${sideLabel(m.entryB, m.nameB, 'Side B')}`}</span>{!called && <span className="src"> · {short ? `short rest (${f.minRest})` : f.minRest === null ? 'fresh' : 'rested'}</span>}</summary>
        <div className="ed-next-body">
          <span className="ed-ctx">{sideLabel(m.entryA, m.nameA, 'Side A')} vs {sideLabel(m.entryB, m.nameB, 'Side B')} · {competitionNames.get(m.competitionId) ?? ''} · {m.roundLabel}</span>
          {why}
          {shortNote}
          {choose}
        </div>
        {choosing && chooser()}
      </details>
    );
  }
  return (
    <article className={`ed-next panel${short ? ' short' : ''}`} aria-label={`Next recommended on ${label}`}>
      <div className="ed-slot-head"><Chip tone={short ? 'live' : 'win'}>Next recommended</Chip><span className="ed-ctx">{competitionNames.get(m.competitionId) ?? ''} · {m.roundLabel}</span></div>
      {vs}
      {why}
      {shortNote}
      <button type="button" className="btn btn-ink fq-big" disabled={actions.busy} onClick={() => actions.run(m)}>{short ? 'Run anyway' : 'Run this fight'}</button>
      {choose}
      {choosing && chooser()}
    </article>
  );
  function chooser() {
    return (
        <Dialog title={`Choose the next fight on ${label}`} onClose={() => setChoosing(false)} variant="drawer">
          <ul className="ed-choose">
            {others.map(({ f: x, m: o }) => {
              const busy = fighting ? null : busyIn(o);
              return (
                <li key={o.id} className={`panel${busy ? ' ed-busy' : ''}`}>
                  <b>{sideLabel(o.entryA, o.nameA, 'Side A')} vs {sideLabel(o.entryB, o.nameB, 'Side B')}</b>
                  <span className="src">{competitionNames.get(o.competitionId) ?? ''} · {o.roundLabel}</span>
                  <span className={x.short ? 'warn' : ''}>{planHeadline(x, plan.target)}</span>
                  {busy && <span className="warn" role="status">{busy}: it cannot start now.</span>}
                  <button type="button" className="btn btn-line" disabled={actions.busy || !!busy} onClick={() => { setChoosing(false); actions.choose(o, !fighting); }}>{fighting ? 'Make this next' : 'Run this instead'}</button>
                </li>
              );
            })}
          </ul>
        </Dialog>
    );
  }
}
