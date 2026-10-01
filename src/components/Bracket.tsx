import type { BracketRound, BracketMatch } from '../data/types';
import { TEAMS } from '../data/fixtures';
import { Crest } from './Crest';

function Slot({ id, rounds, side, status, other }: { id?: string; rounds?: [number, number]; side: 0 | 1; status: BracketMatch['status']; other: 'a' | 'b' | 'tbd' }) {
  if (!id) return <div className="tm tbd"><span style={{ width: 22 }} /><span>{side === 0 ? 'Winner SF1' : 'Winner SF2'}</span><span /></div>;
  const mine = rounds?.[side];
  const theirs = rounds?.[side === 0 ? 1 : 0];
  const done = status === 'done' && mine !== undefined && theirs !== undefined;
  const cls = done ? (mine! > theirs! ? 'winner' : 'lose') : '';
  void other;
  return (
    <div className={`tm ${cls}`}>
      <Crest team={TEAMS[id]} size={22} /><span className="nm">{TEAMS[id].name}</span><span className="r">{mine ?? ''}</span>
    </div>
  );
}

function Match({ m }: { m: BracketMatch }) {
  return (
    <div className={`match ${m.status === 'live' ? 'live' : ''}`}>
      <div className="mt"><span>{m.id}</span><span>{m.status === 'live' ? <span style={{ color: 'var(--live)', fontWeight: 600 }}>● LIVE</span> : m.note}</span></div>
      <Slot id={m.a} rounds={m.rounds} side={0} status={m.status} other="tbd" />
      <Slot id={m.b} rounds={m.rounds} side={1} status={m.status} other="tbd" />
    </div>
  );
}

export function Bracket({ rounds }: { rounds: BracketRound[] }) {
  return (
    <>
      <p className="bracket-hint" style={{ marginBottom: 10 }}>Swipe sideways to follow the bracket →</p>
      <div className="bracket-wrap">
        <div className="bracket">
          {rounds.map(r => (
            <div className="round" key={r.name}>
              <div className="rh"><span>{r.name}</span><span>{r.when}</span></div>
              <div className="ms">{r.matches.map(m => <Match key={m.id} m={m} />)}</div>
            </div>
          ))}
          <div className="round">
            <div className="rh"><span>Champion</span><span /></div>
            <div className="ms">
              <div className="champion">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: 'var(--brass)' }}><path d="M7 4h10v4a5 5 0 0 1-10 0Z" /><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6" /></svg>
                <span className="n">To be decided</span><span className="src">Sunday · Field 1</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
