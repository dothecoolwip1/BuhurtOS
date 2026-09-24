import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { acceptMembershipInvitation } from '../lib/organizationAdmin';

export function MembershipInvitePage() {
  const { event, user, reload } = useAppState();
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = params.get('token') || '';

  if (!event || !user) return <div className="state-card">A signed-in account and active organization context are required.</div>;
  if (!token) return <div className="state-card">This invitation link is missing its token.</div>;

  const accept = async () => {
    setBusy(true);
    setMessage('');
    try {
      await acceptMembershipInvitation(event.organizationId, token, {
        userId: user.userId,
        displayName: user.displayName
      });
      await reload();
      setAccepted(true);
      setMessage('Invitation accepted. Your new access is active.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The invitation could not be accepted.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel-card">
    <span className="eyebrow">Membership invitation</span>
    <h1>Join through BuhurtOS</h1>
    <p>The invitation is tied to the email address it was issued to. BuhurtOS will also verify that the issuer still has authority to grant the requested role.</p>
    {!accepted && <button className="primary big" disabled={busy} onClick={accept}>{busy ? 'Checking Invitation…' : 'Accept Invitation'}</button>}
    {message && <div className="auth-message">{message}</div>}
    {accepted && <Link className="primary big" to="/ops/governance">Open Organizations & Teams</Link>}
  </section>;
}
