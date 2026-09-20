import { useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { ScoreDialog } from '../components/ScoreDialog';
import { useAppState } from '../features/AppState';
import type { MatchRecord } from '../types';
import { hasPermission } from '../lib/permissions';

export function OpsPage() {
  const { loading, error, matches, roster, finalizeResult, reorderMatch, setMatchStatus, user, event } = useAppState();
  const [scoring, setScoring] = useState<MatchRecord | null>(null);
  const canScore = Boolean(event && hasPermission(user, 'match.score', event.id, event.organizationId));
  const canReorder = Boolean(event && hasPermission(user, 'match.manage', event.id, event.organizationId));
  const ordered = useMemo(() => [...matches].sort((a, b) => a.scheduledOrder - b.scheduledOrder), [matches]);
  const active = ordered.find(m => m.status === 'active');
  const onDeck = ordered.find(m => m.status === 'on_deck');
  const inHole = ordered.find(m => m.status === 'in_the_hole');
  if (loading) return <div className="state-card">Loading tournament operations…</div>;
  if (error) return <div className="state-card error">{error}</div>;
  return <>
    <section className="hero-grid">
      <div className="hero-card"><span className="eyebrow">Field status</span><h1>Marshal Console</h1><p>Fast field controls with oversized targets, explicit states, and no drag controls for critical ordering.</p></div>
      <div className="bullpen"><div><span>NOW</span><strong>{active?.label ?? 'No active match'}</strong></div><div><span>ON DECK</span><strong>{onDeck?.label ?? 'None'}</strong></div><div><span>IN THE HOLE</span><strong>{inHole?.label ?? 'None'}</strong></div></div>
    </section>
    <section className="section-head"><div><span className="eyebrow">Fight card</span><h2>Field One Order</h2></div><span>{ordered.filter(m => m.status !== 'finalized').length} remaining</span></section>
    <div className="match-list">{ordered.map(match => <MatchCard key={match.id} match={match} roster={roster} onScore={canScore ? () => setScoring(match) : undefined} onMove={canReorder ? d => reorderMatch(match.id, d) : undefined} onStatus={canReorder ? status => setMatchStatus(match.id, status) : undefined} />)}</div>
    {scoring && <ScoreDialog match={scoring} roster={roster} onClose={() => setScoring(null)} onSubmit={(rounds, forfeit) => finalizeResult(scoring.id, rounds, forfeit)} />}
  </>;
}
