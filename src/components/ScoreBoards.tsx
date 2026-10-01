import type { ReactNode } from 'react';
import { Seg } from './ui';
import { confirmRound, duelEndRound, duelScore, duelTotal, duelUndo, proAddRound, proPatch, standing, toggleFighter, type DuelState, type GroupState, type ProState } from '../lib/scoring';
import { proRoundScore, type Side } from '../lib/tournament';

/**
 * The three scoring boards, controlled: the page owns the state and says who is fighting. Each tap calls `onChange`
 * with the new state and `record` with an event for the outbox, so the same boards serve the sample preview and the
 * real field screen.
 */
export interface BoardProps<S> {
  state: S;
  onChange: (next: S) => void;
  /** Save one action to the outbox. The page binds the match it belongs to. */
  record: (kind: string, payload: unknown) => void;
  names: Record<Side, string>;
  /** Club or team under a duelist's name. */
  subs?: Record<Side, string>;
  crest?: (side: Side) => ReactNode;
}

export function GroupBoard({ state: s, onChange, record, names, crest }: BoardProps<GroupState>) {
  const winner = (['a', 'b'] as const).find(x => standing(s, x === 'a' ? 'b' : 'a') === 0 && standing(s, x) > 0);
  const tap = (side: Side, i: number) => { const next = toggleFighter(s, side, i); onChange(next); record('group.fighter', { side, index: i, down: next.down[side][i] }); };
  const confirm = () => { const next = confirmRound(s); onChange(next); record('group.round_confirmed', { round: s.round, winner, rounds: next.rounds }); };
  const sides: Side[] = ['a', 'b'];
  return (
    <div className="panel mboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="eyebrow">{s.winner ? 'Fight decided' : `Round ${s.round} · first to ${s.roundsToWin} rounds`}</span><span className="eyebrow">Rounds {s.rounds.a} – {s.rounds.b}</span></div>
      <div className="mteams">
        {sides.map(side => (
          <div className="mteam" key={side}>
            {crest?.(side)}<div className="n">{names[side]}</div>
            <div className="rounds">{Array.from({ length: s.roundsToWin }, (_, i) => <i key={i} className={i < s.rounds[side] ? 'on' : ''} />)}</div>
            <div className="mcount mono">{standing(s, side)}<small>standing</small></div>
            <div className="fighters">{s.down[side].map((d, i) => (
              <button key={i} type="button" className={`ft ${d ? 'down' : ''}`} aria-pressed={d} disabled={!!s.winner} aria-label={`${names[side]} fighter ${i + 1} ${d ? 'out' : 'standing'}`} onClick={() => tap(side, i)}>{i + 1}</button>
            ))}</div>
          </div>
        ))}
      </div>
      {winner && !s.winner && (
        <div className="prompt"><span><b>{names[winner]} have every opponent grounded.</b> Give round {s.round} to them?</span><button type="button" className="btn btn-win" onClick={confirm}>Confirm round</button></div>
      )}
      <p className="src">Rounds to win is a setting on the competition: the round structure comes from the tournament regulations.</p>
    </div>
  );
}

export function DuelBoard({ state: s, onChange, record, names, subs }: BoardProps<DuelState>) {
  const r = s.a.length - 1;
  const ta = duelTotal(s, 'a'), tb = duelTotal(s, 'b');
  const apply = (next: DuelState, kind: string, payload: unknown) => { onChange(next); record(kind, payload); };
  const msg = s.winner ? `${names[s.winner]} wins the match` : r < 2 ? `Round ${r + 1} of 2 · 1:00` : 'Extra round · 30 s · lead of 2 needed';
  const side = (k: Side) => (
    <div className="dside"><div className="n">{names[k]}</div>{subs?.[k] && <span className="src">{subs[k]}</span>}<div className="dscore mono">{duelTotal(s, k)}</div>
      <div className="rchips">{s[k].map((x, i) => <span key={i} className={`rchip ${i === r && !s.winner ? 'cur' : ''}`}>R{i + 1} · {x}</span>)}</div>
      <button type="button" className="pbtn s2" disabled={!!s.winner} onClick={() => apply(duelScore(s, k, 2), 'duel.strike', { side: k, points: 2 })}>Head or torso +2</button>
      <button type="button" className="pbtn s1" disabled={!!s.winner} onClick={() => apply(duelScore(s, k, 1), 'duel.strike', { side: k, points: 1 })}>Arm, leg or hand +1</button>
    </div>
  );
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span className={`chip ${s.winner ? 'win' : 'live'}`}>{msg}</span></div>
      <div className="mteams">{side('a')}{side('b')}</div>
      <div className="panel info" style={{ gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Match total</span><b className="mono">{ta} – {tb}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Lead needed to win</span><b className="mono">2 points {r >= 1 && Math.abs(ta - tb) >= 2 ? '✓' : `(now ${Math.abs(ta - tb)})`}</b></div>
      </div>
      <div className="mactions">
        <button type="button" className="btn btn-line" disabled={!s.log.length || !!s.winner} onClick={() => apply(duelUndo(s), 'duel.undo', {})}>Undo last strike</button>
        <button type="button" className="btn btn-ink" disabled={!!s.winner} onClick={() => apply(duelEndRound(s), 'duel.round_ended', { round: r + 1, a: s.a, b: s.b })}>End round</button>
      </div>
    </>
  );
}

export function ProBoard({ state: s, onChange, record, names, subs }: BoardProps<ProState>) {
  const cur = s.rounds[s.current];
  const sc = proRoundScore(cur);
  const total = s.rounds.reduce((t, x) => { const y = proRoundScore(x); return [t[0] + y.a, t[1] + y.b]; }, [0, 0]);
  const change = (patch: Partial<typeof cur>) => { onChange(proPatch(s, patch)); record('pro.round_scored', { round: s.current + 1, ...cur, ...patch }); };
  const col = (k: 'A' | 'B') => {
    const sd: Side = k === 'A' ? 'a' : 'b';
    const sk = `strikes${k}` as 'strikesA' | 'strikesB', dk = `deductions${k}` as 'deductionsA' | 'deductionsB';
    return (
      <div className="dside"><div className="n">{names[sd]}</div>{subs?.[sd] && <span className="src">{subs[sd]}</span>}
        <span className="eyebrow">Strike points</span>
        <div className="stepper"><button type="button" aria-label={`Fewer strike points for ${names[sd]}`} onClick={() => change({ [sk]: Math.max(0, cur[sk] - 1) })}>−</button><output>{cur[sk]}</output><button type="button" aria-label={`More strike points for ${names[sd]}`} onClick={() => change({ [sk]: cur[sk] + 1 })}>+</button></div>
        <span className="eyebrow">Point deductions</span>
        <div className="stepper"><button type="button" aria-label={`Remove a deduction from ${names[sd]}`} onClick={() => change({ [dk]: Math.max(0, cur[dk] - 1) })}>−</button><output>{cur[dk]}</output><button type="button" aria-label={`Add a deduction to ${names[sd]}`} onClick={() => change({ [dk]: cur[dk] + 1 })}>+</button></div>
      </div>
    );
  };
  return (
    <>
      <div className="seg" role="group" aria-label="Round">
        {s.rounds.map((_, i) => <button key={i} type="button" aria-pressed={i === s.current} onClick={() => onChange({ ...s, current: i })}>Round {i + 1}</button>)}
        {s.rounds.length < 3 && <button type="button" onClick={() => onChange(proAddRound(s))}>+ Round</button>}
      </div>
      <div className="mteams">{col('A')}{col('B')}</div>
      {Math.abs(cur.strikesA - cur.strikesB) <= 5 && (
        <div className="panel info" style={{ gap: 8 }}><span style={{ fontSize: 14, color: 'var(--muted)' }}>Strike gap is 5 or less. Do grappling, list control, aggression and defence favour one fighter?</span>
          <Seg label="Other criteria" value={cur.otherCriteria} options={[['a', names.a], ['none', 'Neither'], ['b', names.b]] as const} onChange={v => change({ otherCriteria: v })} /></div>
      )}
      <div className="panel info" style={{ gap: 6, textAlign: 'center' }}><span className="eyebrow">Round {s.current + 1} score · {sc.label}</span><div className="sc10 mono"><span>{sc.a}</span><span style={{ color: 'var(--faint)' }}>–</span><span>{sc.b}</span></div></div>
      <div className="panel info" style={{ gap: 6, textAlign: 'center' }}><span className="eyebrow">Fight total, this marshal</span><div className="sc10 mono" style={{ fontSize: 36 }}><span>{total[0]}</span><span style={{ color: 'var(--faint)' }}>–</span><span>{total[1]}</span></div><span className="src">A tournament fight totals between 14 and 20. The secretary averages all marshals.</span></div>
    </>
  );
}
