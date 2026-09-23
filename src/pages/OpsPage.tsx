import { useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { ScoreDialog } from '../components/ScoreDialog';
import { useAppState } from '../features/AppState';
import type { FightCard, MatchRecord } from '../types';
import { hasPermission } from '../lib/permissions';

export function OpsPage() {
  const { loading, error, matches, roster, fightCards, finalizeResult, reorderMatch, setMatchStatus, user, event } = useAppState();
  const [scoring, setScoring] = useState<MatchRecord | null>(null);
  const [selectedField, setSelectedField] = useState<string>('');
  const canScore = Boolean(event && hasPermission(user, 'match.score', event.id, event.organizationId));
  const canReorder = Boolean(event && hasPermission(user, 'match.manage', event.id, event.organizationId));

  const fieldOptions = useMemo(() => {
    const cards = [...fightCards].sort((a,b) => a.sortOrder - b.sortOrder);
    const knownIds = new Set(cards.map(card => card.id));
    const hasUnassigned = matches.some(match => !match.fightCardId || !knownIds.has(match.fightCardId));
    const options: Array<FightCard & { synthetic?: boolean }> = [...cards];
    if (hasUnassigned || options.length === 0) {
      options.push({ id:'unassigned', eventId:event?.id ?? '', name:'Unassigned', listName:'Unassigned', status:'live', sortOrder:9999, synthetic:true });
    }
    return options;
  },[fightCards,matches,event?.id]);

  const activeFieldId = fieldOptions.some(field => field.id === selectedField) ? selectedField : (fieldOptions[0]?.id ?? 'unassigned');
  const activeField = fieldOptions.find(field => field.id === activeFieldId);
  const ordered = useMemo(() => matches
    .filter(match => activeFieldId === 'unassigned' ? !match.fightCardId || !fightCards.some(card => card.id === match.fightCardId) : match.fightCardId === activeFieldId)
    .sort((a,b) => a.scheduledOrder - b.scheduledOrder), [matches,activeFieldId,fightCards]);

  const active = ordered.find(m => m.status === 'active');
  const onDeck = ordered.find(m => m.status === 'on_deck');
  const inHole = ordered.find(m => m.status === 'in_the_hole');

  if (loading) return <div className="state-card">Loading tournament operations…</div>;
  if (error) return <div className="state-card error">{error}</div>;

  return <>
    <section className="hero-grid">
      <div className="hero-card"><span className="eyebrow">Field status</span><h1>Marshal Console</h1><p>Each field has its own fight order, active match, on-deck match, and bullpen state.</p></div>
      <div className="bullpen"><div><span>NOW</span><strong>{active?.label ?? 'No active match'}</strong></div><div><span>ON DECK</span><strong>{onDeck?.label ?? 'None'}</strong></div><div><span>IN THE HOLE</span><strong>{inHole?.label ?? 'None'}</strong></div></div>
    </section>

    <div className="field-tabs" role="tablist" aria-label="Tournament fields">
      {fieldOptions.map(field => <button key={field.id} className={field.id===activeFieldId?'selected':''} onClick={()=>setSelectedField(field.id)}><b>{field.name}</b><small>{matches.filter(match => field.id==='unassigned' ? !match.fightCardId || !fightCards.some(card => card.id===match.fightCardId) : match.fightCardId===field.id).filter(match=>match.status!=='finalized'&&match.status!=='cancelled').length} remaining</small></button>)}
    </div>

    <section className="section-head"><div><span className="eyebrow">Fight card</span><h2>{activeField?.listName ?? activeField?.name ?? 'Field Order'}</h2></div><span>{ordered.filter(m => m.status !== 'finalized' && m.status !== 'cancelled').length} remaining</span></section>
    {ordered.length===0 ? <div className="state-card">No matches are assigned to this field.</div> : <div className="match-list">{ordered.map(match => <MatchCard key={match.id} match={match} roster={roster} onScore={canScore ? () => setScoring(match) : undefined} onMove={canReorder ? d => reorderMatch(match.id, d) : undefined} onStatus={canReorder ? status => setMatchStatus(match.id, status) : undefined} />)}</div>}
    {scoring && <ScoreDialog match={scoring} roster={roster} onClose={() => setScoring(null)} onSubmit={(rounds, forfeit) => finalizeResult(scoring.id, rounds, forfeit)} />}
  </>;
}
