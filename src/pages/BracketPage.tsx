import { useAppState } from '../features/AppState';
import { groupBracketRounds } from '../lib/bracketView';

export function BracketPage() {
  const { matches, roster } = useAppState();
  const rounds = groupBracketRounds(matches);
  const name = (id?: string, placeholder?: string) => roster.find(r => r.id === id)?.displayName ?? placeholder ?? 'TBD';
  return <>
    <section className="section-head"><div><span className="eyebrow">Bracket</span><h1>Live Progression</h1><p>Winner links are relational, so completed results advance without rewriting bracket history.</p></div></section>
    <div className="bracket-scroll"><div className="bracket-grid">{rounds.map(group => <section className="bracket-round" key={group.round}><h2>{group.round === rounds.length ? 'Final' : `Round ${group.round}`}</h2>{group.matches.map(match => <article className="bracket-match" key={match.id}><span>{match.label}</span>{[1,2].map(side => { const p = match.participants.find(x => x.sideIndex === side); return <div className={match.resultSummary?.winnerSide === side ? 'winner' : ''} key={side}><b>{name(p?.rosterEntryId, p?.placeholderLabel)}</b>{match.resultSummary && <strong>{side === 1 ? match.resultSummary.side1Total : match.resultSummary.side2Total}</strong>}</div>; })}</article>)}</section>)}</div></div>
  </>;
}
