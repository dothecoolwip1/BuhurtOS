import type { MatchRecord, MatchStatus, RosterEntry } from '../types';

export function MatchCard({ match, roster, onScore, onMove, onStatus }: { match: MatchRecord; roster: RosterEntry[]; onScore?: () => void; onMove?: (direction: -1 | 1) => void; onStatus?: (status: MatchStatus) => void }) {
  const name = (side: 1 | 2) => {
    const p = match.participants.find(x => x.sideIndex === side);
    if (!p) return 'TBD';
    if (p.isPlaceholder) return p.placeholderLabel ?? 'TBD';
    return roster.find(r => r.id === p.rosterEntryId)?.displayName ?? 'Unknown';
  };
  return (
    <article className={`match-card status-${match.status}`}>
      <div className="match-top"><div><span className="eyebrow">{match.category}</span><h3>{match.label}</h3></div><span className="match-status">{match.status.replaceAll('_', ' ')}</span></div>
      <div className="versus"><strong>{name(1)}</strong><span>VS</span><strong>{name(2)}</strong></div>
      {match.resultSummary && <div className="result-line">Final {match.resultSummary.side1Total} : {match.resultSummary.side2Total}</div>}
      {(onScore || onMove || onStatus) && <div className="match-actions">
        {onStatus && match.status !== 'finalized' && match.status !== 'cancelled' && <div className="status-actions">
          <button className={match.status === 'in_the_hole' ? 'selected' : ''} onClick={() => onStatus('in_the_hole')}>In Hole</button>
          <button className={match.status === 'on_deck' ? 'selected' : ''} onClick={() => onStatus('on_deck')}>On Deck</button>
          <button className={match.status === 'active' ? 'selected' : ''} onClick={() => onStatus('active')}>Active</button>
        </div>}
        {onMove && <><button aria-label="Move match earlier" onClick={() => onMove(-1)}>↑ Earlier</button><button aria-label="Move match later" onClick={() => onMove(1)}>↓ Later</button></>}
        {onScore && match.status === 'active' && <button className="primary" onClick={onScore}>Score Match</button>}
      </div>}
    </article>
  );
}
