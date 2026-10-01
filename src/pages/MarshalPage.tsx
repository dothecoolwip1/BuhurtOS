import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crest } from '../components/Crest';
import { Seg } from '../components/ui';
import { TEAMS } from '../data/fixtures';
import { confirmRound, duelEndRound, duelScore, duelTotal, duelUndo, newDuel, newGroupFight, newPro, proAddRound, proPatch, standing, toggleFighter, type DuelState, type GroupState, type ProState } from '../lib/scoring';
import { proRoundScore, type Side } from '../lib/tournament';
import { link, useOutbox } from '../lib/useOutbox';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Mode = 'group' | 'duel' | 'pro';
const MODES: readonly (readonly [Mode, string])[] = [['group', 'Group fight'], ['duel', 'Duel'], ['pro', 'Profight']];
const HEADINGS: Record<Mode, [string, string]> = { group: ['Group fight · Field 1', 'Semifinal 1'], duel: ['Duels · Field 2', 'Longsword · Pool B'], pro: ['Profight · line marshal', 'Heavyweight · Bout 3'] };

type Record_ = (kind: string, subject: string, payload: unknown) => Promise<void>;

function SyncBar({ waiting }: { waiting: number }) {
  const [off, setOff] = useState(link.simulatedOffline);
  return (
    <div className="syncbar" role="status">
      <span className={`chip ${waiting ? 'brass' : 'win'}`}>{waiting ? `${waiting} saved on this device, waiting for signal` : 'All saved and synced'}</span>
      <label className="chk"><input type="checkbox" checked={off} onChange={e => { link.set(e.target.checked); setOff(e.target.checked); }} /> Pretend there is no signal (preview only)</label>
    </div>
  );
}

function GroupBoard({ record }: { record: Record_ }) {
  const [s, setS] = useState<GroupState>(() => {
    let g = newGroupFight();
    g = toggleFighter(toggleFighter(g, 'a', 2), 'a', 3);
    return [0, 2, 4].reduce((acc, i) => toggleFighter(acc, 'b', i), g);
  });
  const sides: [Side, string][] = [['a', 'ironwardens'], ['b', 'northgate']];
  const winner = (['a', 'b'] as const).find(x => standing(s, x === 'a' ? 'b' : 'a') === 0);
  const tap = (side: Side, i: number) => { const next = toggleFighter(s, side, i); setS(next); void record('group.fighter', 'sf1', { side, index: i, down: next.down[side][i] }); };
  const confirm = () => { const next = confirmRound(s); setS(next); void record('group.round_confirmed', 'sf1', { round: s.round, winner, rounds: next.rounds }); };
  if (s.winner) {
    const t = TEAMS[s.winner === 'a' ? 'ironwardens' : 'northgate'];
    return (
      <div className="panel mboard" style={{ textAlign: 'center', justifyItems: 'center' }}>
        <Crest team={t} size={80} /><span className="chip win">Fight result saved</span>
        <h2 style={{ fontSize: 40 }}>{t.name} win {s.rounds[s.winner]}–{s.rounds[s.winner === 'a' ? 'b' : 'a']}</h2>
        <p style={{ color: 'var(--muted)' }}>They go through to the final on Sunday, Field 1.</p>
        <button type="button" className="btn btn-line" onClick={() => setS(newGroupFight())}>Score another fight</button>
      </div>
    );
  }
  return (
    <div className="panel mboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="eyebrow">Round {s.round} · first to {s.roundsToWin} rounds</span><span className="eyebrow">Rounds {s.rounds.a} – {s.rounds.b}</span></div>
      <div className="mteams">
        {sides.map(([side, id]) => (
          <div className="mteam" key={side}>
            <Crest team={TEAMS[id]} size={52} /><div className="n">{TEAMS[id].name}</div>
            <div className="rounds">{Array.from({ length: s.roundsToWin }, (_, i) => <i key={i} className={i < s.rounds[side] ? 'on' : ''} />)}</div>
            <div className="mcount mono">{standing(s, side)}<small>standing</small></div>
            <div className="fighters">{s.down[side].map((d, i) => (
              <button key={i} type="button" className={`ft ${d ? 'down' : ''}`} aria-pressed={d} aria-label={`${TEAMS[id].name} fighter ${i + 1} ${d ? 'out' : 'standing'}`} onClick={() => tap(side, i)}>{i + 1}</button>
            ))}</div>
          </div>
        ))}
      </div>
      {winner && (
        <div className="prompt"><span><b>{TEAMS[winner === 'a' ? 'ironwardens' : 'northgate'].name} have every opponent grounded.</b> Give round {s.round} to them?</span><button type="button" className="btn btn-win" onClick={confirm}>Confirm round</button></div>
      )}
      <p className="src">Rounds to win is a setting here: the round structure comes from the tournament regulations, which are not loaded yet.</p>
    </div>
  );
}

function DuelBoard({ record }: { record: Record_ }) {
  const [s, setS] = useState<DuelState>(newDuel);
  const r = s.a.length - 1;
  const ta = duelTotal(s, 'a'), tb = duelTotal(s, 'b');
  const apply = (next: DuelState, kind: string, payload: unknown) => { setS(next); void record(kind, 'ls-b3', payload); };
  const msg = s.winner ? `${s.winner === 'a' ? 'Mara Kessling' : 'Ines Duarte'} wins the match` : r < 2 ? `Round ${r + 1} of 2 · 1:00` : 'Extra round · 30 s · lead of 2 needed';
  const side = (k: Side, name: string, club: string) => (
    <div className="dside"><div className="n">{name}</div><span className="src">{club}</span><div className="dscore mono">{duelTotal(s, k)}</div>
      <div className="rchips">{s[k].map((x, i) => <span key={i} className={`rchip ${i === r && !s.winner ? 'cur' : ''}`}>R{i + 1} · {x}</span>)}</div>
      <button type="button" className="pbtn s2" disabled={!!s.winner} onClick={() => apply(duelScore(s, k, 2), 'duel.strike', { side: k, points: 2 })}>Head or torso +2</button>
      <button type="button" className="pbtn s1" disabled={!!s.winner} onClick={() => apply(duelScore(s, k, 1), 'duel.strike', { side: k, points: 1 })}>Arm, leg or hand +1</button>
    </div>
  );
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span className={`chip ${s.winner ? 'win' : 'live'}`}>{msg}</span></div>
      <div className="mteams">{side('a', 'Mara Kessling', 'Iron Wardens')}{side('b', 'Ines Duarte', 'Cold Harbor Guard')}</div>
      <div className="panel info" style={{ gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Match total</span><b className="mono">{ta} – {tb}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--muted)' }}>Lead needed to win</span><b className="mono">2 points {r >= 1 && Math.abs(ta - tb) >= 2 ? '✓' : `(now ${Math.abs(ta - tb)})`}</b></div>
      </div>
      <div className="mactions">
        <button type="button" className="btn btn-line" disabled={!s.log.length || !!s.winner} onClick={() => apply(duelUndo(s), 'duel.undo', {})}>Undo last strike</button>
        <button type="button" className="btn btn-ink" disabled={!!s.winner} onClick={() => apply(duelEndRound(s), 'duel.round_ended', { round: r + 1, a: s.a, b: s.b })}>End round</button>
      </div>
      {s.winner && <button type="button" className="btn btn-line" style={{ width: '100%' }} onClick={() => setS(newDuel())}>Start a new match</button>}
    </>
  );
}

function ProBoard({ record }: { record: Record_ }) {
  const [s, setS] = useState<ProState>(newPro);
  const cur = s.rounds[s.current];
  const sc = proRoundScore(cur);
  const total = s.rounds.reduce((t, x) => { const y = proRoundScore(x); return [t[0] + y.a, t[1] + y.b]; }, [0, 0]);
  const change = (patch: Partial<typeof cur>) => { setS(proPatch(s, patch)); void record('pro.round_scored', 'hw-3', { round: s.current + 1, ...cur, ...patch }); };
  const col = (k: 'A' | 'B', name: string, club: string) => {
    const sk = `strikes${k}` as 'strikesA' | 'strikesB', dk = `deductions${k}` as 'deductionsA' | 'deductionsB';
    return (
      <div className="dside"><div className="n">{name}</div><span className="src">{club}</span>
        <span className="eyebrow">Strike points</span>
        <div className="stepper"><button type="button" aria-label={`Fewer strike points for ${name}`} onClick={() => change({ [sk]: Math.max(0, cur[sk] - 1) })}>−</button><output>{cur[sk]}</output><button type="button" aria-label={`More strike points for ${name}`} onClick={() => change({ [sk]: cur[sk] + 1 })}>+</button></div>
        <span className="eyebrow">Point deductions</span>
        <div className="stepper"><button type="button" aria-label="Remove a deduction" onClick={() => change({ [dk]: Math.max(0, cur[dk] - 1) })}>−</button><output>{cur[dk]}</output><button type="button" aria-label="Add a deduction" onClick={() => change({ [dk]: cur[dk] + 1 })}>+</button></div>
      </div>
    );
  };
  return (
    <>
      <div className="seg" role="group" aria-label="Round">
        {s.rounds.map((_, i) => <button key={i} type="button" aria-pressed={i === s.current} onClick={() => setS({ ...s, current: i })}>Round {i + 1}</button>)}
        {s.rounds.length < 3 && <button type="button" onClick={() => setS(proAddRound(s))}>+ Round</button>}
      </div>
      <div className="mteams">{col('A', 'Coll MacRae', 'Saltmarsh Lions')}{col('B', 'Dane Holloway', 'Northgate Co.')}</div>
      {Math.abs(cur.strikesA - cur.strikesB) <= 5 && (
        <div className="panel info" style={{ gap: 8 }}><span style={{ fontSize: 14, color: 'var(--muted)' }}>Strike gap is 5 or less. Do grappling, list control, aggression and defence favour one fighter?</span>
          <Seg label="Other criteria" value={cur.otherCriteria} options={[['a', 'MacRae'], ['none', 'Neither'], ['b', 'Holloway']] as const} onChange={v => change({ otherCriteria: v })} /></div>
      )}
      <div className="panel info" style={{ gap: 6, textAlign: 'center' }}><span className="eyebrow">Round {s.current + 1} score · {sc.label}</span><div className="sc10 mono"><span>{sc.a}</span><span style={{ color: 'var(--faint)' }}>–</span><span>{sc.b}</span></div></div>
      <div className="panel info" style={{ gap: 6, textAlign: 'center' }}><span className="eyebrow">Fight total, this marshal</span><div className="sc10 mono" style={{ fontSize: 36 }}><span>{total[0]}</span><span style={{ color: 'var(--faint)' }}>–</span><span>{total[1]}</span></div><span className="src">A tournament fight totals between 14 and 20. The secretary averages all marshals.</span></div>
    </>
  );
}

export function MarshalPage() {
  useDocumentTitle('Marshal scoring');
  const [params, setParams] = useSearchParams();
  const mode: Mode = MODES.find(([k]) => k === params.get('mode'))?.[0] ?? 'group';
  const { waiting, record } = useOutbox();
  return (
    <section className="marshal fade-in">
      <SyncBar waiting={waiting} />
      <Seg label="Format" value={mode} options={MODES} onChange={m => setParams({ mode: m }, { replace: true })} />
      <div className="mhead"><div><p className="eyebrow">{HEADINGS[mode][0]}</p><h1 style={{ fontSize: 40, marginTop: 6 }}>{HEADINGS[mode][1]}</h1></div></div>
      <div style={{ display: 'grid', gap: 14 }} key={mode}>
        {mode === 'group' && <GroupBoard record={record} />}
        {mode === 'duel' && <DuelBoard record={record} />}
        {mode === 'pro' && <ProBoard record={record} />}
      </div>
      <p className="src" style={{ textAlign: 'center' }}>Every tap is saved on this device first and sent when there is signal. Nothing is lost if the page closes.</p>
    </section>
  );
}
