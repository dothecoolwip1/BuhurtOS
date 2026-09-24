import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import {
  listIdentityClaimsForReview,
  listIdentityMergeReviews,
  requestFighterIdentityMerge,
  reviewFighterIdentityClaim,
  reviewFighterIdentityMerge,
  suggestFighterIdentityDuplicates
} from '../lib/fighterIdentity';
import { listFoundationFighters } from '../lib/identityAdmin';
import type {
  FighterDuplicateSuggestion,
  FighterIdentityClaim,
  FighterIdentityMergeReview,
  FoundationFighter
} from '../types';

export function IdentityReviewPage() {
  const { event, roster, user } = useAppState();
  const [fighters, setFighters] = useState<FoundationFighter[]>([]);
  const [claims, setClaims] = useState<FighterIdentityClaim[]>([]);
  const [merges, setMerges] = useState<FighterIdentityMergeReview[]>([]);
  const [canonicalId, setCanonicalId] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [suggestionIdentityId, setSuggestionIdentityId] = useState('');
  const [suggestions, setSuggestions] = useState<FighterDuplicateSuggestion[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = Boolean(
    user?.platformRoles.includes('platform_super_admin')
    || (event && user?.organizationRoles.some(role => role.organizationId === event.organizationId && role.role === 'organization_admin'))
  );
  const isPlatformAdmin = Boolean(user?.platformRoles.includes('platform_super_admin'));

  const identities = useMemo(() => {
    const byIdentity = new Map<string, FoundationFighter>();
    for (const fighter of fighters) if (!byIdentity.has(fighter.identityId)) byIdentity.set(fighter.identityId, fighter);
    return [...byIdentity.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [fighters]);

  const identityName = (identityId: string) => identities.find(row => row.identityId === identityId)?.name || identityId.slice(0, 8);

  const refresh = async () => {
    if (!event) return;
    const [fighterRows, claimRows, mergeRows] = await Promise.all([
      listFoundationFighters(event, roster),
      listIdentityClaimsForReview(),
      listIdentityMergeReviews()
    ]);
    setFighters(fighterRows);
    setClaims(claimRows);
    setMerges(mergeRows);
  };

  useEffect(() => {
    if (!canManage) return;
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load identity review queue.'));
  }, [event?.id, canManage, roster.length]);

  if (!event) return <div className="state-card">Choose an event before opening identity review.</div>;
  if (!canManage) return <div className="state-card">Organization administrator access is required for identity review.</div>;

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The identity review action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const reviewClaim = (claim: FighterIdentityClaim, decision: 'approve' | 'reject') => {
    const note = window.prompt(decision === 'approve' ? 'Optional approval note' : 'Reason for rejection') || '';
    return run(async () => {
      await reviewFighterIdentityClaim(claim, decision, note);
    }, decision === 'approve' ? 'Identity claim approved.' : 'Identity claim rejected.');
  };

  const requestMerge = () => run(async () => {
    await requestFighterIdentityMerge(canonicalId, duplicateId, mergeReason);
    setCanonicalId('');
    setDuplicateId('');
    setMergeReason('');
  }, 'Merge review queued. No identity history has been changed yet.');

  const loadSuggestions = () => run(async () => {
    setSuggestions(await suggestFighterIdentityDuplicates(suggestionIdentityId));
  }, 'Duplicate suggestions refreshed. Suggestions never merge records automatically.');

  const useSuggestion = (suggestion: FighterDuplicateSuggestion) => {
    setCanonicalId(suggestionIdentityId);
    setDuplicateId(suggestion.candidateIdentityId);
    setMergeReason('Duplicate suggestion: ' + suggestion.reason + ' (score ' + suggestion.score + ')');
  };

  const reviewMerge = (review: FighterIdentityMergeReview, decision: 'approve' | 'reject') => {
    const note = window.prompt(decision === 'approve' ? 'Optional merge review note' : 'Reason for rejecting the merge') || '';
    return run(async () => {
      await reviewFighterIdentityMerge(review.id, decision, note);
    }, decision === 'approve' ? 'Merge completed transactionally with historical roster references preserved.' : 'Merge request rejected.');
  };

  return <>
    <section className="section-head">
      <div>
        <span className="eyebrow">Identity governance</span>
        <h1>Claims & Merge Review</h1>
        <p>Claims and duplicate suggestions require human review. Merge requests do not rewrite completed event roster references, results or historical match participation.</p>
      </div>
    </section>

    <div className="admin-grid">
      <section className="panel-card">
        <h2>Identity claims</h2>
        <p>Normal claims can be reviewed by an administrator responsible for that identity. Disputed claims require platform review.</p>
        <div className="membership-list">
          {claims.length === 0 ? <div className="state-card">No claims are waiting for review.</div> : claims.map(claim => <article key={claim.id}>
            <div className="grow">
              <strong>{identityName(claim.identityId)} · {claim.relationship}</strong>
              <small>{claim.status} · claimant {claim.claimantUserId.slice(0, 8)}{claim.claimNote ? ' · ' + claim.claimNote : ''}{claim.disputeReason ? ' · dispute: ' + claim.disputeReason : ''}</small>
            </div>
            <div className="header-actions">
              <button className="primary" disabled={busy || (claim.status === 'disputed' && !isPlatformAdmin)} onClick={() => reviewClaim(claim, 'approve')}>Approve</button>
              <button disabled={busy || (claim.status === 'disputed' && !isPlatformAdmin)} onClick={() => reviewClaim(claim, 'reject')}>Reject</button>
            </div>
          </article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Duplicate suggestions</h2>
        <p>Suggestions use normalized names, aliases and nicknames. A score is only a review signal and never triggers a merge.</p>
        <div className="form-stack">
          <label>Identity<select value={suggestionIdentityId} onChange={e => setSuggestionIdentityId(e.target.value)}>
            <option value="">Choose fighter identity</option>
            {identities.map(fighter => <option key={fighter.identityId} value={fighter.identityId}>{fighter.name}</option>)}
          </select></label>
          <button disabled={busy || !suggestionIdentityId} onClick={loadSuggestions}>Find Possible Duplicates</button>
        </div>
        <div className="membership-list">
          {suggestions.map(row => <article key={row.candidateIdentityId}>
            <div className="grow">
              <strong>{row.candidateDisplayName}</strong>
              <small>{row.reason} · review score {row.score}</small>
            </div>
            <button disabled={busy} onClick={() => useSuggestion(row)}>Review Pair</button>
          </article>)}
        </div>
      </section>

      <section className="panel-card">
        <h2>Request identity merge</h2>
        <p>The first administrator proposes which identity survives. A platform super administrator other than the requester must approve the actual merge.</p>
        <div className="form-stack">
          <label>Keep identity<select value={canonicalId} onChange={e => setCanonicalId(e.target.value)}>
            <option value="">Choose canonical identity</option>
            {identities.map(fighter => <option key={fighter.identityId} value={fighter.identityId}>{fighter.name}</option>)}
          </select></label>
          <label>Merge duplicate into it<select value={duplicateId} onChange={e => setDuplicateId(e.target.value)}>
            <option value="">Choose duplicate identity</option>
            {identities.filter(fighter => fighter.identityId !== canonicalId).map(fighter => <option key={fighter.identityId} value={fighter.identityId}>{fighter.name}</option>)}
          </select></label>
          <textarea rows={3} value={mergeReason} onChange={e => setMergeReason(e.target.value)} placeholder="Why these records appear to be the same person"/>
          <button disabled={busy || !canonicalId || !duplicateId} onClick={requestMerge}>Request Merge Review</button>
        </div>
      </section>

      <section className="panel-card">
        <h2>Merge queue</h2>
        <p>Approving a merge requires platform super administrator access, a different reviewer from the requester, unchanged profile revisions, and no conflicting verified self owners.</p>
        <div className="membership-list">
          {merges.length === 0 ? <div className="state-card">No merge reviews are visible.</div> : merges.map(review => <article key={review.id}>
            <div className="grow">
              <strong>{identityName(review.canonicalIdentityId)} ← {identityName(review.duplicateIdentityId)}</strong>
              <small>{review.status} · requested by {review.requestedBy.slice(0, 8)}{review.reason ? ' · ' + review.reason : ''}</small>
            </div>
            {review.status === 'pending' && <div className="header-actions">
              <button className="primary" disabled={busy || !isPlatformAdmin || review.requestedBy === user?.userId} onClick={() => reviewMerge(review, 'approve')}>Approve Merge</button>
              <button disabled={busy || !isPlatformAdmin || review.requestedBy === user?.userId} onClick={() => reviewMerge(review, 'reject')}>Reject</button>
            </div>}
          </article>)}
        </div>
      </section>
    </div>

    {message && <div className="auth-message">{message}</div>}
  </>;
}
