import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BulkSchedule } from '../components/BulkSchedule';
import { MatchSchedule } from '../components/MatchSchedule';
import { RosterEditor } from '../components/RosterEditor';
import { ConflictsPanel } from '../components/RunConflicts';
import { Withdrawals } from '../components/Withdrawals';
import { Chip } from '../components/ui';
import { fetchCompetitionRoster, fetchEventTimeZone, fetchMatchDurations, DEFAULT_TIME_ZONE } from '../data/runSchedule';
import type { LiveCompetition, LiveEvent } from '../data/api';
import {
  buildSchedule, fetchCompetitionMatches, fetchEntries, fetchPoolStandings, groupIntoRounds, recordTieDecision, reopenMatch, setQueue,
  type CompetitionEntry, type CompetitionMatch
} from '../data/matches';
import type { PlannedMatch } from '../lib/bracket';
import { sideLabel } from '../lib/entryLabel';
import { friendlyError } from '../lib/friendlyError';
import {
  DRAW_FORMATS, activeEntries, bracketFromPools, canBuildBracketFromPools, describePlan, drawProblem, maxPoolCount, moveItem, planDraw, randomSeed, rankedPools, tiesWithin,
  type DrawChoice, type DrawFormat, type PlanGroup
} from '../lib/runDraw';
import { matchFighters, sideFighters, timeLabel, DEFAULT_DURATION, type RosterMember, type SideEntry } from '../lib/runSchedule';
import { isEventDayOrLater } from '../lib/autoResolve';
import { structureAdvice } from '../lib/tournament';
import { useAsync } from '../lib/useAsync';

const QUEUE_OPTIONS = [['scheduled', 'Scheduled'], ['on_deck', 'On deck'], ['in_the_hole', 'In the hole'], ['active', 'Active']] as const;
type OpenQueue = (typeof QUEUE_OPTIONS)[number][0];

const errorStyle = { color: 'var(--live)' } as const;

function PlanView({ groups, open }: { groups: PlanGroup[]; open?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {groups.map(g => (
        <details key={g.heading} open={open ?? g.lines.length <= 8}>
          <summary><b>{g.heading}</b> ({g.lines.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, display: 'grid', gap: 2 }}>{g.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>
      ))}
    </div>
  );
}

function DrawBuilder({ comp, entries, existing, onDone, onClose }: {
  comp: LiveCompetition; entries: CompetitionEntry[]; existing: CompetitionMatch[]; onDone: () => void; onClose: () => void;
}) {
  const active = useMemo(() => activeEntries(entries), [entries]);
  const names = useMemo(() => new Map(entries.map(e => [e.id, e.name])), [entries]);
  const nameOf = (id: string) => names.get(id) ?? 'Unknown entry';
  const advice = structureAdvice(active.length);
  const advisedPools = advice.options.map(o => o.pools.length).find(p => p >= 2) ?? 2;

  const [format, setFormat] = useState<DrawFormat>(active.length >= 7 ? 'pools' : 'round_robin');
  const [mode, setMode] = useState<'random' | 'manual'>('random');
  const [seed, setSeed] = useState(() => randomSeed());
  const [thirdPlace, setThirdPlace] = useState(false);
  const [poolCount, setPoolCount] = useState(Math.min(advisedPools, maxPoolCount(active.length)));
  const [order, setOrder] = useState<string[]>(() => active.map(e => e.id));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice: DrawChoice = { format, entryIds: order, mode, seed, thirdPlace, poolCount };
  const problem = drawProblem(choice);
  const plan = useMemo(() => (problem ? null : planDraw({ format, entryIds: order, mode, seed, thirdPlace, poolCount })), [problem, format, order, mode, seed, thirdPlace, poolCount]);
  const groups = useMemo(() => (plan ? describePlan(plan.matches, nameOf) : []), [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFinal = existing.some(m => m.queueState === 'final');
  const replacing = existing.length > 0;

  const confirm = async () => {
    if (!plan) return;
    setBusy(true); setError(null);
    try { await buildSchedule(comp.id, plan.matches, replacing ? 'replace' : 'new', { draw: { format, mode, seed } }); onDone(); }
    catch (e) { setError(friendlyError(e, 'Could not build the draw. Your existing matches were left as they were.')); }
    finally { setBusy(false); setConfirming(false); }
  };

  const bye = format === 'single_elimination' && active.length >= 2 && (active.length & (active.length - 1)) !== 0;
  return (
    <div className="panel info" style={{ display: 'grid', gap: 14 }} aria-label={`Build draw for ${comp.name}`}>
      <h3>Build draw</h3>
      <label className="field-in">Format
        <select value={format} onChange={e => { setFormat(e.target.value as DrawFormat); setConfirming(false); }}>
          {DRAW_FORMATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      </label>
      {format === 'pools' && (
        <label className="field-in">Number of pools (pool play first, then you build the bracket)
          <input type="number" inputMode="numeric" min={2} max={maxPoolCount(active.length)} value={poolCount} onChange={e => setPoolCount(Number(e.target.value))} />
        </label>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend style={{ fontWeight: 600 }}>{format === 'single_elimination' ? 'Seeding' : 'Who fights whom'}</legend>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
          <input type="radio" name={`mode-${comp.id}`} checked={mode === 'random'} onChange={() => setMode('random')} /> Random draw (can be repeated exactly from its number)
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
          <input type="radio" name={`mode-${comp.id}`} checked={mode === 'manual'} onChange={() => setMode('manual')} /> I will set the order myself
        </label>
      </fieldset>
      {mode === 'random' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field-in" style={{ flex: '1 1 160px' }}>Draw number
            <input type="number" inputMode="numeric" min={1} step={1} value={seed} onChange={e => setSeed(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
          </label>
          <button type="button" className="btn btn-line" onClick={() => setSeed(randomSeed())}>Draw again</button>
        </div>
      )}
      {mode === 'manual' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <p className="src">{format === 'single_elimination' ? 'Top of the list is seed 1.' : format === 'pools' ? 'Entrants are dealt into the pools in this order.' : 'Order of the list.'}</p>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {order.map((id, i) => (
              <li key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, overflowWrap: 'anywhere' }}><b>{i + 1}.</b> {nameOf(id)}</span>
                <button type="button" className="btn btn-line" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0} onClick={() => setOrder(o => moveItem(o, i, -1))}>↑</button>
                <button type="button" className="btn btn-line" aria-label={`Move ${nameOf(id)} down`} disabled={i === order.length - 1} onClick={() => setOrder(o => moveItem(o, i, 1))}>↓</button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {format === 'single_elimination' && (
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={thirdPlace} onChange={e => setThirdPlace(e.target.checked)} /> Add a third-place match{active.length < 4 ? ' (needs 4 or more entrants)' : ''}
        </label>
      )}

      {problem && <p role="alert" style={errorStyle}>{problem}</p>}
      {plan && (
        <div style={{ display: 'grid', gap: 8 }} aria-label="Preview">
          <h4>Preview: {plan.matches.length} matches{mode === 'random' ? `, draw number ${seed}` : ''}</h4>
          {bye && <p className="src">With {active.length} entrants some get a bye (they skip the first round).</p>}
          {plan.pools.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 20 }}>{plan.pools.map(p => <li key={p.name}><b>Pool {p.name}:</b> {p.entries.map(nameOf).join(', ')}</li>)}</ul>
          )}
          <PlanView groups={groups} />
        </div>
      )}

      {replacing && !hasFinal && <p className="src">This competition already has {existing.length} matches. The new draw is created first, then these are removed once it succeeds.</p>}
      {hasFinal && <p role="alert" style={errorStyle}>Some matches already have final results. Reopen them first, then you can build a new draw.</p>}
      {error && <p role="alert" style={errorStyle}>{error}</p>}

      {!confirming && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink" disabled={!plan || hasFinal || busy} onClick={() => setConfirming(true)}>Use this draw</button>
          <button type="button" className="btn btn-line" onClick={onClose}>Cancel</button>
        </div>
      )}
      {confirming && plan && (
        <div className="panel info" role="alertdialog" aria-label="Confirm draw" style={{ display: 'grid', gap: 8 }}>
          <p><b>{replacing ? `Replace the ${existing.length} existing matches with ${plan.matches.length} new ones?` : `Create ${plan.matches.length} matches for ${comp.name}?`}</b> {replacing ? 'The new matches are created first, and the old ones are deleted only after that works. Deleting the old ones cannot be undone.' : 'You can still change the order of play afterwards.'}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy} onClick={confirm}>{busy ? 'Building…' : replacing ? 'Yes, replace them' : 'Yes, create matches'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirming(false)}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ScheduleCtx { eventId: string; timeZone: string; entries: SideEntry[]; roster: RosterMember[]; durations: Map<string, number>; jumpId: string | null; onScheduled: () => void }

function MatchCard({ m, onChanged, sched }: { m: CompetitionMatch; onChanged: () => void; sched: ScheduleCtx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const isFinal = m.queueState === 'final';
  const ready = Boolean(m.entryA && m.entryB);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const winner = m.result === 'draw' ? 'Draw' : m.result === 'a' ? `${sideLabel(m.entryA, m.nameA, 'Side A')} won` : m.result === 'b' ? `${sideLabel(m.entryB, m.nameB, 'Side B')} won` : '';
  const reasonOk = reason.trim().length >= 3;
  const title = `${sideLabel(m.entryA, m.nameA, 'To be decided')} vs ${sideLabel(m.entryB, m.nameB, 'To be decided')}`;

  return (
    <article id={`match-${m.id}`} tabIndex={-1} className="panel info" style={{ display: 'grid', gap: 10 }} aria-label={title}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ overflowWrap: 'anywhere' }}>{title}</b>
        {isFinal ? <Chip tone="win">Final</Chip> : m.queueState === 'active' ? <Chip tone="live">Active</Chip> : <Chip>{QUEUE_OPTIONS.find(([k]) => k === m.queueState)?.[1] ?? m.queueState}</Chip>}
        {m.field && <Chip tone="steel">{m.field}</Chip>}
      </div>
      {isFinal && m.scheduledAt && <p className="src">Was scheduled for {timeLabel(m.scheduledAt, sched.timeZone)}</p>}
      {isFinal && <p>{winner}{m.scoreA !== null && m.scoreB !== null ? ` (${m.scoreA} to ${m.scoreB})` : ''}</p>}

      {!isFinal && !ready && <p className="src">{m.stage === 'third_place' && !m.entryA && !m.entryB ? 'Waiting for the semifinals to finish' : 'Waiting for earlier results before this match can be scheduled.'}</p>}
      {!isFinal && ready && (<>
        <div className="seg" role="group" aria-label="Queue state">
          {QUEUE_OPTIONS.map(([k, text]) => (
            <button key={k} type="button" disabled={busy} aria-pressed={k === m.queueState} onClick={() => k !== m.queueState && run(() => setQueue(m.id, k as OpenQueue, null))}>{text}</button>
          ))}
        </div>
      </>)}
      {!isFinal && (
        <MatchSchedule eventId={sched.eventId} matchId={m.id} scheduledAt={m.scheduledAt} field={m.field} duration={sched.durations.get(m.id) ?? DEFAULT_DURATION}
          people={matchFighters(m.entryA, m.entryB, sched.entries, sched.roster)} timeZone={sched.timeZone} jump={sched.jumpId === m.id}
          uncheckedSides={[m.entryA, m.entryB].flatMap(id => {
            const e = id ? sched.entries.find(x => x.id === id) : undefined;
            return e && e.teamId && sideFighters(e.id, sched.entries, sched.roster).length === 0 ? [e.name] : [];
          })}
          onSaved={() => { onChanged(); sched.onScheduled(); }} />
      )}

      {isFinal && !reopening && <button type="button" className="btn btn-line" onClick={() => setReopening(true)}>Reopen result</button>}
      {isFinal && reopening && (
        <div className="panel info" role="alertdialog" aria-label="Reopen result" style={{ display: 'grid', gap: 8 }}>
          <p><b>Reopening removes the result and anything it decided in later matches.</b> The reason is saved in the match history.</p>
          <label className="field-in">Reason (required)
            <input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} aria-invalid={!reasonOk} placeholder="For example: wrong winner entered" />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy || !reasonOk} onClick={() => run(async () => { await reopenMatch(m.id, reason.trim()); setReopening(false); setReason(''); })}>Reopen this result</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setReopening(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </article>
  );
}

function PoolBracket({ comp, matches, entries, onDone }: { comp: LiveCompetition; matches: CompetitionMatch[]; entries: CompetitionEntry[]; onDone: () => void }) {
  const [version, setVersion] = useState(0);
  const standings = useAsync(() => fetchPoolStandings(comp.id), [comp.id, matches, version]);
  const names = useMemo(() => new Map(entries.map(e => [e.id, e.name])), [entries]);
  const nameOf = (id: string) => names.get(id) ?? 'Unknown entry';
  const [open, setOpen] = useState(false);
  const [advance, setAdvance] = useState(2);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = standings.data ?? [];
  const ranked = useMemo(() => rankedPools(rows), [rows]);
  const smallest = ranked.length ? Math.min(...ranked.map(p => p.length)) : 1;
  const adv = Math.min(Math.max(1, advance), smallest);
  const ties = useMemo(() => tiesWithin(rows, adv), [rows, adv]);
  const built = useMemo(() => (ranked.length && ranked.length * adv >= 2 && ties.length === 0 ? bracketFromPools(ranked, adv, thirdPlace) : null), [ranked, adv, thirdPlace, ties]);
  const planned: PlannedMatch[] = built?.matches ?? [];

  const confirm = async () => {
    if (!built) return;
    setBusy(true); setError(null);
    try { await buildSchedule(comp.id, built.matches, 'append', { advance: adv }); onDone(); }
    catch (e) { setError(friendlyError(e, 'Could not build the bracket.')); } finally { setBusy(false); }
  };

  return (
    <div className="panel info" style={{ display: 'grid', gap: 10 }}>
      <h4>Pool play is finished</h4>
      {!open && <button type="button" className="btn btn-ink" onClick={() => setOpen(true)}>Build bracket from pool results</button>}
      {open && (<>
        {standings.loading && <p className="muted">Loading pool results…</p>}
        {standings.error != null && <p role="alert" style={errorStyle}>{friendlyError(standings.error, 'Could not load pool results.')}</p>}
        {ranked.length > 0 && (<>
          <label className="field-in">How many advance from each pool
            <input type="number" inputMode="numeric" min={1} max={smallest} value={adv} onChange={e => setAdvance(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={thirdPlace} onChange={e => setThirdPlace(e.target.checked)} /> Add a third-place match
          </label>
          <p className="src">Pool order is by wins, then score difference, then wins against the entries it is level with, then points scored. Entries still level after that must be put in order by an organizer.</p>
          {ties.map(g => <TieDecision key={`${g.part}-${g.rank}`} comp={comp} group={g} nameOf={nameOf} onDecided={() => setVersion(v => v + 1)} />)}
          {ties.length === 0 && <ol style={{ margin: 0, paddingLeft: 20 }}>{(built?.qualifiers ?? []).map(id => <li key={id}>{nameOf(id)}</li>)}</ol>}
          {built && <PlanView groups={describePlan(planned, nameOf)} />}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy || !built} onClick={confirm}>{busy ? 'Building…' : built ? `Create ${planned.length} bracket matches` : 'Decide the ties first'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>)}
        {!standings.loading && ranked.length > 0 && ties.length === 0 && !built && standings.error == null && <p role="alert" style={errorStyle}>At least 2 entrants need to advance to build a bracket.</p>}
        {error && <p role="alert" style={errorStyle}>{error}</p>}
      </>)}
    </div>
  );
}

/** Level entries that decide who advances: the organizer puts them in order and says how it was decided. The database keeps who, when and why. */
function TieDecision({ comp, group, nameOf, onDecided }: { comp: LiveCompetition; group: { part: string; rank: number; entryIds: string[] }; nameOf: (id: string) => string; onDecided: () => void }) {
  const [order, setOrder] = useState<string[]>(group.entryIds);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await recordTieDecision(comp.id, group.part, order, note); onDecided(); }
    catch (e) { setError(friendlyError(e, 'Could not save the order.')); } finally { setBusy(false); }
  };
  return (
    <div className="panel" role="group" aria-label={`Tie for place ${group.rank}${group.part ? ` in pool ${group.part}` : ''}`} style={{ display: 'grid', gap: 8 }}>
      <b>{group.part ? `Pool ${group.part}: ` : ''}these {order.length} are level for place {group.rank}. Put them in the order they should finish.</b>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {order.map((id, i) => (
          <li key={id}>{nameOf(id)}{' '}
            <button type="button" className="btn btn-line btn-sm" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0 || busy} onClick={() => setOrder(moveItem(order, i, -1))}>Up</button>{' '}
            <button type="button" className="btn btn-line btn-sm" aria-label={`Move ${nameOf(id)} down`} disabled={i === order.length - 1 || busy} onClick={() => setOrder(moveItem(order, i, 1))}>Down</button>
          </li>
        ))}
      </ol>
      <label className="field-in">How was this decided?
        <input type="text" value={note} maxLength={200} placeholder="e.g. head marshal drew lots" onChange={e => setNote(e.target.value)} />
      </label>
      <button type="button" className="btn btn-ink" disabled={busy || note.trim().length < 3} onClick={save}>{busy ? 'Saving…' : 'Save this order'}</button>
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </div>
  );
}

function CompetitionRun({ comp, eventId, timeZone, jumpId, eventDay, onScheduled }: { comp: LiveCompetition; eventId: string; timeZone: string; jumpId: string | null; eventDay: boolean; onScheduled: () => void }) {
  const [reload, setReload] = useState(0);
  const [building, setBuilding] = useState(false);
  const [redrawFor, setRedrawFor] = useState<string | null>(null);
  const entries = useAsync(() => fetchEntries(comp.id), [comp.id, reload]);
  const matches = useAsync(() => fetchCompetitionMatches(comp.id), [comp.id, reload]);
  const roster = useAsync(() => fetchCompetitionRoster(comp.id), [comp.id, reload]);
  const durations = useAsync(() => fetchMatchDurations(comp.id), [comp.id, reload]);
  const done = () => { setBuilding(false); setRedrawFor(null); setReload(k => k + 1); onScheduled(); };

  const all = entries.data ?? [];
  const n = activeEntries(all).length;
  const advice = structureAdvice(n);
  const list = matches.data ?? [];
  const rounds = useMemo(() => groupIntoRounds(list), [list]);
  const finals = list.filter(m => m.queueState === 'final').length;
  const sched: ScheduleCtx = { eventId, timeZone, entries: all, roster: roster.data ?? [], durations: durations.data ?? new Map(), jumpId, onScheduled };
  const teamEntries = all.filter(e => e.teamId && e.status !== 'withdrawn' && e.status !== 'disqualified');

  return (
    <section className="panel info" style={{ display: 'grid', gap: 12 }} aria-label={comp.name}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h3 style={{ marginRight: 4 }}>{comp.name}</h3>
        <Chip tone="steel">{entries.loading && !entries.data ? 'Counting…' : `${n} ${n === 1 ? 'entrant' : 'entrants'}`}</Chip>
        {list.length > 0 && <Chip tone="brass">{finals} of {list.length} matches final</Chip>}
      </div>
      {entries.error != null && <p role="alert" style={errorStyle}>{friendlyError(entries.error, 'Could not load entrants.')}</p>}
      {matches.error != null && <p role="alert" style={errorStyle}>{friendlyError(matches.error, 'Could not load matches.')}</p>}

      <details>
        <summary>Suggested format for {n} {n === 1 ? 'entrant' : 'entrants'}</summary>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {advice.note && <p>{advice.note}</p>}
          {advice.options.map(o => (
            <div key={o.title}>
              <p><b>{o.title}</b></p>
              <p>{o.detail}</p>
              {o.pools.length > 1 && <p className="src">Pool sizes: {o.pools.join(', ')}. Then: {o.after}</p>}
              {o.pools.length <= 1 && <p className="src">{o.after}</p>}
            </div>
          ))}
          <p className="src">From the Tournament Structure and Formats document. It is advice; you decide.</p>
        </div>
      </details>

      {!building && (
        <button type="button" className="btn btn-ink" disabled={n < 2 || entries.loading} onClick={() => setBuilding(true)}>
          {list.length > 0 ? 'Build a new draw' : 'Build draw'}
        </button>
      )}
      {n < 2 && !entries.loading && <p className="src">You need at least 2 entrants (not withdrawn or disqualified) to build a draw.</p>}
      {building && redrawFor && <p role="status" className="src">{redrawFor} is out. This new draw leaves them out; the old matches are replaced once you confirm.</p>}
      {building && <DrawBuilder key={`${reload}`} comp={comp} entries={all} existing={list} onDone={done} onClose={() => { setBuilding(false); setRedrawFor(null); }} />}

      {all.length > 0 && (
        <Withdrawals entries={all} matches={list} eventDay={eventDay} onChanged={() => { setReload(k => k + 1); onScheduled(); }}
          onRedraw={name => { if (list.some(m => m.queueState === 'final')) return; setRedrawFor(name); setBuilding(true); }} />
      )}

      {canBuildBracketFromPools(list) && <PoolBracket comp={comp} matches={list} entries={all} onDone={done} />}

      {teamEntries.length > 0 && (
        <details>
          <summary><b>Team rosters</b> ({teamEntries.length})</summary>
          <div style={{ display: 'grid', gap: 14, marginTop: 8 }}>
            {teamEntries.map(e => (
              <RosterEditor key={e.id} entryId={e.id} entryName={e.name} teamId={e.teamId} category={comp.category} locked={comp.status === 'finished'}
                onChanged={() => { setReload(k => k + 1); onScheduled(); }} />
            ))}
          </div>
        </details>
      )}

      {list.some(m => m.queueState !== 'final') && (
        <BulkSchedule matches={list.map(m => ({ matchId: m.id, queueState: m.queueState, scheduledAt: m.scheduledAt }))} timeZone={timeZone}
          onDone={() => { setReload(k => k + 1); onScheduled(); }} />
      )}

      {rounds.length > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {rounds.map(r => (
            <div key={r.key} style={{ display: 'grid', gap: 8 }}>
              <h4>{r.pool ? `Pool ${r.pool}, ${r.label}` : r.label}</h4>
              {r.matches.map(m => <MatchCard key={`${m.id}-${m.version}-${m.queueState}-${m.field ?? ''}-${m.scheduledAt ?? ''}-${sched.durations.get(m.id) ?? ''}`} m={m} sched={sched} onChanged={() => setReload(k => k + 1)} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function RunTab({ event, competitions }: { event: LiveEvent; competitions: LiveCompetition[] }) {
  const [conflictsKey, setConflictsKey] = useState(0);
  const [version, setVersion] = useState(0);
  const [jumpId, setJumpId] = useState<string | null>(null);
  const tz = useAsync(() => fetchEventTimeZone(event.id), [event.id]);
  const timeZone = tz.data ?? DEFAULT_TIME_ZONE;
  const names = useMemo(() => new Map(competitions.map(c => [c.id, c.name])), [competitions]);
  const eventDay = isEventDayOrLater(event.startsOn, timeZone);

  useEffect(() => {
    if (!jumpId) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`match-${jumpId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    }, 60);
    const clear = setTimeout(() => setJumpId(null), 1500);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [jumpId]);

  if (competitions.length === 0) {
    return (
      <div className="panel info" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
        <h3>No competitions yet</h3>
        <p>Add at least one competition to {event.name} first. Then you can build draws and run the matches here.</p>
        <Link className="btn btn-ink" to={`/events/${event.slug}/manage?tab=setup&add=competition`}>+ Add competition</Link>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {tz.data && <ConflictsPanel eventId={event.id} competitionNames={names} timeZone={timeZone} reloadKey={conflictsKey} onJump={setJumpId} autoFix={!eventDay}
        onFixed={() => { setConflictsKey(k => k + 1); setVersion(v => v + 1); }} />}
      {competitions.map(c => <CompetitionRun key={`${c.id}-${version}`} comp={c} eventId={event.id} timeZone={timeZone} jumpId={jumpId} eventDay={eventDay} onScheduled={() => setConflictsKey(k => k + 1)} />)}
    </div>
  );
}
