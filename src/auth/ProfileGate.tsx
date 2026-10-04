import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { fetchMyProfile } from '../data/profile';
import { clearOnboarding, onboardingWanted } from '../lib/analytics';
import { useAsync } from '../lib/useAsync';
import { useAuth } from './AuthContext';

/** Accounts that finished the first-sign-in step in this tab, so the gate does not wait for a reload. */
export const finishedProfiles = new Set<string>();

/** Pages that act for an account (forms, management, the account itself). Everything else is public and never sends anyone to setup. */
export const ACCOUNT_PATH = /^\/(account|my-events|team-manager|platform)(\/|$)|^\/events\/new$|^\/events\/[^/]+\/(register|manage|field)(\/|$)|^\/(teams|fighters)\/[^/]+\/edit$/;

/**
 * Profile setup for an account that has not done it yet. Visiting the site never triggers it, and a visitor without an account is never
 * touched. A signed-in person is sent to /welcome only (a) right after they signed in themselves in this tab, or (b) when they open a
 * page that acts for their account. On public pages they get a small reminder they can dismiss instead.
 * If the profile cannot be read (for example the database is not updated yet) nobody is blocked.
 */
export function ProfileGate() {
  const { session } = useAuth();
  const { pathname, search } = useLocation();
  const userId = session?.user.id;
  const profile = useAsync(() => (userId ? fetchMyProfile(userId) : Promise.resolve(null)), [userId]);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('bos-setup-later') === '1'; } catch { return false; } });
  // The one-time "just signed in" wish is spent once setup is reached or turns out not to be needed.
  const done = pathname === '/welcome' || profile.data?.onboarded === true;
  useEffect(() => { if (done) clearOnboarding(); }, [done]);
  if (!userId || pathname === '/welcome' || finishedProfiles.has(userId)) return null;
  if (profile.error != null || !profile.data || profile.data.onboarded) return null;
  if (onboardingWanted(userId) || ACCOUNT_PATH.test(pathname)) {
    return <Navigate to={`/welcome?next=${encodeURIComponent(pathname + search)}`} replace />;
  }
  if (hidden) return null;
  const later = () => { setHidden(true); try { sessionStorage.setItem('bos-setup-later', '1'); } catch { /* storage can be blocked */ } };
  return (
    <div className="setup-note" role="status">
      <span>Your account is not set up yet. It takes a minute and lets you register for events and join a team.</span>
      <Link className="btn btn-ink btn-sm" to={`/welcome?next=${encodeURIComponent(pathname + search)}`}>Finish setup</Link>
      <button type="button" className="linklike" onClick={later}>Later</button>
    </div>
  );
}
