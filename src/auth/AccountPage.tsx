import { Link, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { fetchMyEvents } from '../data/api';
import { DRAFT_NOTICE, maskEmail } from '../lib/draftView';
import { useAsync } from '../lib/useAsync';
import { MedicalTab } from './account/MedicalTab';
import { PhotosTab } from './account/PhotosTab';
import { ProfileTab } from './account/ProfileTab';
import { TeamsTab } from './account/TeamsTab';
import { useAuth } from './AuthContext';
import { usePlatformRole } from './usePlatformRole';
import { SignIn } from './SignIn';

export const ACCOUNT_TABS = [['profile', 'Profile'], ['photos', 'Photos'], ['medical', 'Medical'], ['teams', 'My teams'], ['events', 'My events'], ['account', 'Account']] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number][0];
/** Unknown or missing ?tab= values fall back to the profile. */
export const tabFrom = (raw: string | null): AccountTab => (ACCOUNT_TABS.find(([k]) => k === raw)?.[0] ?? 'profile');

export function AccountPage() {
  const { session, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <><PageHead eyebrow="Account" title="Sign in" /><SignIn /></>;
  const tab = tabFrom(params.get('tab'));
  const userId = session.user.id;
  return (
    <>
      <PageHead eyebrow="Account" title="Your profile" lede="Fill this in once. Your details fill in event registrations for you." />
      <nav className="acct-nav" aria-label="Account sections">
        {ACCOUNT_TABS.map(([k, label]) => (
          <button key={k} type="button" aria-current={k === tab ? 'page' : undefined} onClick={() => setParams(k === 'profile' ? {} : { tab: k }, { replace: true })}>{label}</button>
        ))}
      </nav>
      <div className="acct-body">
        {tab === 'profile' && <ProfileTab userId={userId} />}
        {tab === 'photos' && <PhotosTab userId={userId} />}
        {tab === 'medical' && <MedicalTab />}
        {tab === 'teams' && <TeamsTab />}
        {tab === 'events' && <MyEvents userId={userId} />}
        {tab === 'account' && <AccountDetails email={session.user.email ?? null} />}
      </div>
    </>
  );
}

function MyEvents({ userId }: { userId: string }) {
  const mine = useAsync(() => fetchMyEvents(userId), [userId]);
  const list = mine.data ?? [];
  return (
    <section className="panel info acct-card" aria-labelledby="myev-h">
      <h2 id="myev-h">My events</h2>
      {mine.loading && <p className="muted">Loading…</p>}
      {!mine.loading && list.length === 0 && <p className="muted">Events you organize will show here. To sign up for an event, open it from the events list.</p>}
      <ul className="plain">
        {list.map(e => (
          <li key={e.id}><Link to={`/events/${e.slug}`}>{e.name}</Link> <span className="src">{e.status === 'draft' ? DRAFT_NOTICE : e.status === 'cancelled' ? 'Cancelled' : 'Published'}</span></li>
        ))}
      </ul>
      <div className="acct-row"><Link className="btn btn-line" to="/events">Browse events</Link><Link className="btn btn-line" to="/events/new">Create an event</Link></div>
    </section>
  );
}

function AccountDetails({ email }: { email: string | null }) {
  const { signOut } = useAuth();
  const { isOwner } = usePlatformRole();
  return (
    <section className="panel info acct-card">
      <h2>Account</h2>
      <p>Signed in as <b>{maskEmail(email) ?? 'your account'}</b></p>
      <div className="acct-row">
        <Link className="btn btn-line" to="/team-manager">Team manager</Link>
        {isOwner && <Link className="btn btn-line" to="/platform/organizations">Organizations</Link>}
        <button className="btn btn-ink" type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
    </section>
  );
}
