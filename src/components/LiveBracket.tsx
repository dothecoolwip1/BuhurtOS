import type { CSSProperties } from 'react';
import type { CompetitionMatch } from '../data/matches';
import { buildBracketColumns, championOf, type BracketMatchView, type BracketSlot } from '../lib/liveView';

function Slot({ s }: { s: BracketSlot }) {
  const cls = ['tm', s.tbd && 'tbd', s.winner && 'winner', s.loser && 'lose'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="nm">{s.name}{s.winner && <span className="sr-only"> (winner)</span>}</span>
      <span className="r">{s.score ?? ''}</span>
    </div>
  );
}

const STATE_TEXT = { final: 'Final result', in_the_hole: 'In the hole', on_deck: 'On deck', scheduled: '', active: '' } as const;

function MatchBox({ m, liveOk }: { m: BracketMatchView; liveOk: boolean }) {
  return (
    <div className={m.state === 'active' ? 'match live' : 'match'}>
      <div className="mt">
        <span>{m.label}</span>
        <span>{m.state === 'active' ? <span style={{ color: 'var(--live)', fontWeight: 600 }}>{liveOk ? 'LIVE' : 'ACTIVE'}{m.field ? ` · ${m.field}` : ''}</span> : STATE_TEXT[m.state] || m.field || ''}</span>
      </div>
      <Slot s={m.slots[0]} />
      <Slot s={m.slots[1]} />
      {m.explanation && <div className="src" style={{ padding: '4px 8px' }}>{m.explanation}</div>}
    </div>
  );
}

/** Bracket for the elimination, final and third-place matches of one competition. Renders nothing when there are none. */
/** `liveOk` is false while the screen is not receiving live updates (reconnecting): it then says ACTIVE, never LIVE. */
export function LiveBracket({ matches, liveOk = true }: { matches: readonly CompetitionMatch[]; liveOk?: boolean }) {
  const columns = buildBracketColumns(matches);
  if (columns.length === 0) return null;
  const champion = championOf(matches);
  return (
    <div className="live-bracket">
      {champion && <p className="champion-line"><b>Champion:</b> {champion}</p>}
      <p className="bracket-hint">Swipe sideways to follow the bracket →</p>
      <div className="bracket-wrap" role="region" aria-label="Bracket" tabIndex={0}>
        <div className="bracket live-cols" style={{ '--n': columns.length } as CSSProperties}>
          {columns.map(c => (
            <div className="round" key={c.key}>
              <div className="rh"><span>{c.title}</span></div>
              <div className="ms">{c.matches.map(m => <MatchBox key={m.id} m={m} liveOk={liveOk} />)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
