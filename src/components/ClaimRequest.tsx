import { useState } from 'react';
import { requestFighterClaim } from '../data/claims';
import { friendlyError } from '../lib/friendlyError';

/**
 * "This is me": asks a platform administrator to link the signed-in account to this existing fighter profile.
 * Asking changes nothing by itself; the fighter keeps every match, result and team record either way.
 */
export function ClaimRequest({ fighterId, name, onSent, hasOwnProfile = false }: { fighterId: string; name: string; onSent?: () => void; hasOwnProfile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<null | { needsReview: boolean }>(null);
  const send = async () => {
    setBusy(true); setError(null);
    try { const r = await requestFighterClaim(fighterId, message); setSent({ needsReview: r.needsReview }); onSent?.(); }
    catch (e) { setError(friendlyError(e, 'Could not send your request.')); } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <p role="status" style={{ color: 'var(--win)' }} data-testid="claim-sent">
        Request sent for {name}. {sent.needsReview ? 'You already have a fighter profile, so an administrator will check whether the two are the same person.' : 'An administrator will confirm it is you.'} Nothing changes until then.
      </p>
    );
  }
  if (!open) return <button type="button" className="btn btn-ink" data-testid={`claim-${fighterId}`} onClick={() => setOpen(true)}>This is me</button>;
  return (
    <div style={{ display: 'grid', gap: 8 }} role="group" aria-label={`Claim ${name}`}>
      {hasOwnProfile && <p className="src">You already have a fighter profile. This request goes to an administrator to check; your profiles are not merged or replaced.</p>}
      <label className="field-in">How can we tell it is you? (optional)
        <textarea rows={3} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} placeholder="For example: I fought for Team One at Event One in 2025" data-testid="claim-message" />
      </label>
      {error && <p role="alert" style={{ color: 'var(--live)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void send()} data-testid="claim-send">{busy ? 'Sending…' : 'Send request'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
