import { useMemo, useState } from 'react';
import { Chip } from '../components/ui';
import type { LiveCompetition, LiveEvent } from '../data/api';
import {
  fetchCompetitionMatches, fetchEntries, fetchStandings, generateMatches, groupIntoRounds, reopenMatch, setQueue,
  type CompetitionEntry, type CompetitionMatch, type QueueState
} from '../data/matches';
import type { PlannedMatch } from '../lib/bracket';
import { friendlyError } from '../lib/friendlyError';
import {
  DRAW_FORMATS, activeEntries, bracketFromPools, canBuildBracketFromPools, describePlan, drawProblem, maxPoolCount, moveItem, planDraw, randomSeed, rankPools,
  type DrawChoice, type DrawFormat, type PlanGroup
} from '../lib/runDraw';
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

  const [format, setFormat] = useState<DrawFormat>(active.length >= 7 ? 'pools' : active.length >= 4 && active.length <= 6 ? 'round_robin' : 'single_elimination');
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
    try { await generateMatches(comp.id, plan.matches, { replace: replacing }); onDone(); }
    catch (e) { setError(friendlyError(e, 'Could not build the draw. Nothing was changed that you can not redo.')); }
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

      {replacing && !hasFinal && <p className="src">This competition already has {existing.length} matches. Building a new draw will delete them.</p>}
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
          <p><b>{replacing ? `Replace the ${existing.length} existing matches with ${plan.matches.length} new ones?` : `Create ${plan.matches.length} matches for ${comp.name}?`}</b> {replacing ? 'The old matches are deleted and this cannot be undone.' : 'You can still change the order of play afterwards.'}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy} onClick={confirm}>{busy ? 'Building…' : replacing ? 'Yes, replace them' : 'Yes, create matches'}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirming(false)}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchCard({ m, onChanged }: { m: CompetitionMatch; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState(m.field ?? '');
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const isFinal = m.queueState === 'final';
  const ready = Boolean(m.entryA && m.entryB);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const winner = m.result === 'draw' ? 'Draw' : m.result === 'a' ? `${m.nameA ?? 'Side A'} won` : m.result === 'b' ? `${m.nameB ?? 'Side B'} won` : '';
  const reasonOk = reason.trim().length >= 3;

  return (
    <article className="panel info" style={{ display: 'grid', gap: 10 }} aria-label={`${m.nameA ?? 'To be decided'} vs ${m.nameB ?? 'To be decided'}`}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ overflowWrap: 'anywhere' }}>{m.nameA ?? 'To be decided'} vs {m.nameB ?? 'To be decided'}</b>
        {isFinal ? <Chip tone="win">Final</Chip> : m.queueState === 'active' ? <Chip tone="live">Active</Chip> : <Chip>{QUEUE_OPTIONS.find(([k]) => k === m.queueState)?.[1] ?? m.queueState}</Chip>}
        {m.field && <Chip tone="steel">{m.field}</Chip>}
      </div>
      {isFinal && <p>{winner}{m.scoreA !== null && m.scoreB !== null ? ` (${m.scoreA} to ${m.scoreB})` : ''}</p>}

      {!isFinal && !ready && <p className="src">Waiting for earlier results before this match can be scheduled.</p>}
      {!isFinal && ready && (<>
        <div className="seg" role="group" aria-label="Queue state">
          {QUEUE_OPTIONS.map(([k, text]) => (
            <button key={k} type="button" disabled={busy} aria-pressed={k === m.queueState} onClick={() => k !== m.queueState && run(() => setQueue(m.id, k as OpenQueue, m.field))}>{text}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="field-in" style={{ flex: '1 1 160px' }}>Field
            <input value={field} maxLength={40} placeholder="For example Field 1" onChange={e => setField(e.target.value)} />
          </label>
          <button type="button" className="btn btn-line" disabled={busy || field.trim() === (m.field ?? '')} onClick={() => run(() => setQueue(m.id, m.queueState as Exclude<QueueState, 'final'>, field.trim() || null))}>Set field</button>
        </div>
      </>)}

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
  const standings = useAsync(() => fetchStandings(comp.id), [comp.id, matches]);
  const names = useMemo(() => new Map(entries.map(e => [e.id, e.name])), [entries]);
  const nameOf = (id: string) => names.get(id) ?? 'Unknown entry';
  const [open, setOpen] = useState(false);
  const [advance, setAdvance] = useState(2);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranked = useMemo(() => (standings.data ? rankPools(matches, standings.data) : []), [matches, standings.data]);
  const smallest = ranked.length ? Math.min(...ranked.map(p => p.length)) : 1;
  const adv = Math.min(Math.max(1, advance), smallest);
  const built = useMemo(() => (ranked.length && ranked.length * adv >= 2 ? bracketFromPools(ranked, adv, thirdPlace) : null), [ranked, adv, thirdPlace]);
  const planned: PlannedMatch[] = built?.matches ?? [];

  const confirm = async () => {
    if (!built) return;
    setBusy(true); setError(null);
    try { await generateMatches(comp.id, built.matches, { append: true }); onDone(); }
    catch (e) { setError(friendlyError(e, 'Could not build the bracket.')); } finally { setBusy(false); }
  };

  return (
    <div className="panel info" style={{ display: 'grid', gap: 10 }}>
      <h4>Pool play is finished</h4>
      {!open && <button type="button" className="btn btn-ink" onClick={() => setOpen(true)}>Build bracket from pool results</button>}
      {open && (<>
        {standings.loading && <p className="muted">Loading pool results…</p>}
        {standings.error != null && <p role="alert" style={errorStyle}>{friendlyError(standings.error, 'Could not load pool results.')}</p>}
        {built && (<>
          <label className="field-in">How many advance from each pool
            <input type="number" inputMode="numeric" min={1} max={smallest} value={adv} onChange={e => setAdvance(Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={thirdPlace} onChange={e => setThirdPlace(e.target.checked)} /> Add a third-place match
          </label>
          <p className="src">Pool order is by wins, then score difference, then points scored. Tie-break rules such as head-to-head are not applied here, so check the order below.</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>{built.qualifiers.map(id => <li key={id}>{nameOf(id)}</li>)}</ol>
          <PlanView groups={describePlan(planned, nameOf)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy} onClick={confirm}>{busy ? 'Building…' : `Create ${planned.length} bracket matches`}</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>)}
        {!standings.loading && !built && standings.error == null && <p role="alert" style={errorStyle}>At least 2 entrants need to advance to build a bracket.</p>}
        {error && <p role="alert" style={errorStyle}>{error}</p>}
      </>)}
    </div>
  );
}

function CompetitionRun({ comp }: { comp: LiveCompetition }) {
  const [reload, setReload] = useState(0);
  const [building, setBuilding] = useState(false);
  const entries = useAsync(() => fetchEntries(comp.id), [comp.id, reload]);
  const matches = useAsync(() => fetchCompetitionMatches(comp.id), [comp.id, reload]);
  const done = () => { setBuilding(false); setReload(k => k + 1); };

  const all = entries.data ?? [];
  const n = activeEntries(all).length;
  const advice = structureAdvice(n);
  const list = matches.data ?? [];
  const rounds = useMemo(() => groupIntoRounds(list), [list]);
  const finals = list.filter(m => m.queueState === 'final').length;

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
      {building && <DrawBuilder comp={comp} entries={all} existing={list} onDone={done} onClose={() => setBuilding(false)} />}

      {canBuildBracketFromPools(list) && <PoolBracket comp={comp} matches={list} entries={all} onDone={done} />}

      {rounds.length > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {rounds.map(r => (
            <div key={r.key} style={{ display: 'grid', gap: 8 }}>
              <h4>{r.pool ? `Pool ${r.pool}, ${r.label}` : r.label}</h4>
              {r.matches.map(m => <MatchCard key={`${m.id}-${m.version}-${m.queueState}-${m.field ?? ''}`} m={m} onChanged={() => setReload(k => k + 1)} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function RunTab({ event, competitions }: { event: LiveEvent; competitions: LiveCompetition[] }) {
  if (competitions.length === 0) {
    return <div className="panel info"><h3>No competitions yet</h3><p>Add competitions to {event.name} first. Then you can build draws and run the matches here.</p></div>;
  }
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {competitions.map(c => <CompetitionRun key={c.id} comp={c} />)}
    </div>
  );
}
