import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from '../../components/ui';
import { fetchFighterClaims, resolveFighterClaim, type ClaimRow } from '../../data/claims';
import { claimNoteProblem, historyLine, outcomeText } from '../../lib/claims';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';

/**
 * Someone asks to be the person behind an existing fighter profile. Only a platform administrator decides. Approving links the account to
 * that same profile (same id, same history); it never creates or copies a fighter. An account that already has a fighter is never given a
 * second one here: that case is queued as a look-alike pair instead.
 */
export function ClaimReviews() {
  const [version, setVersion] = useState(0);
  const list = useAsync(fetchFighterClaims, [version]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const decide = async (r: ClaimRow, decision: 'approve' | 'decline') => {
    setBusy(r.requestId); setError(null); setResult(null);
    try { const o = await resolveFighterClaim(r.requestId, decision, (notes[r.requestId] ?? '').trim()); setResult(outcomeText(o, r.fighter.name)); setVersion(v => v + 1); }
    catch (e) { setError(friendlyError(e, 'Could not save the decision.')); setVersion(v => v + 1); } finally { setBusy(null); }
  };
  const rows = list.data ?? [];
  return (
    <section aria-labelledby="claims-h" style={{ display: 'grid', gap: 16 }} data-testid="claim-reviews">
      <h2 id="claims-h" className="acct-h">Profile claims {rows.length > 0 && <Chip tone="brass">{rows.length} waiting</Chip>}</h2>
      {list.loading && !list.data && <p className="muted">Loading…</p>}
      {list.error != null && <p role="alert">{friendlyError(list.error, 'Could not load the claims.')}</p>}
      {!list.loading && list.error == null && rows.length === 0 && <div className="panel info"><h3>No claims waiting</h3><p className="muted">Nobody is asking to claim a fighter profile right now.</p></div>}
      {result && <p role="status" style={{ color: 'var(--win)' }} data-testid="claim-result">{result}</p>}
      {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
      {rows.map(r => {
        const problem = claimNoteProblem(notes[r.requestId] ?? '');
        return (
          <div key={r.requestId} className="panel info" style={{ display: 'grid', gap: 10 }} data-testid="claim-card">
            <div className="panel" style={{ display: 'grid', gap: 4 }}>
              <span className="eyebrow">Asking to claim</span>
              <b><Link to={`/fighters/${r.fighter.id}`}>{r.fighter.name}</Link> <Chip>Unclaimed profile</Chip></b>
              <span className="src">{[r.fighter.team, [r.fighter.city, r.fighter.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'No team or location on record'}</span>
              <span className="src">{historyLine({ entries: r.fighter.entries, lastEvent: r.fighter.events[0] ?? null })}{r.fighter.events.length > 1 ? ` (also ${r.fighter.events.slice(1).join(', ')})` : ''}</span>
              {r.fighter.origin && <span className="src">Added by an organizer at {r.fighter.origin}</span>}
              {r.fighter.claimed && <span className="src" role="alert">This profile already belongs to an account; approving will close the claim without linking.</span>}
            </div>
            <div className="panel" style={{ display: 'grid', gap: 4 }}>
              <span className="eyebrow">Who is asking</span>
              <b>{r.claimant.name ?? 'No name given'}</b>
              <span className="src" style={{ overflowWrap: 'anywhere' }}>{r.claimant.email ?? 'No email'}</span>
              {r.message && <span style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>“{r.message}”</span>}
              {r.claimant.ownFighter && (
                <span className="src" role="note">Already has the fighter profile <Link to={`/fighters/${r.claimant.ownFighter.id}`}>{r.claimant.ownFighter.name}</Link>. Approving will not give them a second one: the two are queued as a possible duplicate instead.</span>
              )}
            </div>
            <label className="field-in">How did you decide? (kept in the audit history)
              <input type="text" maxLength={300} value={notes[r.requestId] ?? ''} onChange={e => setNotes(n => ({ ...n, [r.requestId]: e.target.value }))} data-testid="claim-note" />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-line fq-big" disabled={busy !== null || !!problem} onClick={() => void decide(r, 'decline')}>Decline</button>
              <button type="button" className="btn btn-ink fq-big" disabled={busy !== null || !!problem} onClick={() => void decide(r, 'approve')} data-testid="claim-approve">{r.claimant.ownFighter ? 'Send to identity review' : 'Approve: this is them'}</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
