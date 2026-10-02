import { Navigate, useLocation } from 'react-router-dom';
import { fetchMyProfile } from '../data/profile';
import { useAsync } from '../lib/useAsync';
import { useAuth } from './AuthContext';

/** Accounts that finished the first-sign-in step in this tab, so the gate does not wait for a reload. */
export const finishedProfiles = new Set<string>();

/**
 * Sends a signed-in person who has not set up their profile yet to /welcome, then back to where they were going.
 * If the profile cannot be read (for example the database is not updated yet) nobody is blocked.
 */
export function ProfileGate() {
  const { session } = useAuth();
  const { pathname, search } = useLocation();
  const userId = session?.user.id;
  const profile = useAsync(() => (userId ? fetchMyProfile(userId) : Promise.resolve(null)), [userId]);
  if (!userId || pathname === '/welcome' || finishedProfiles.has(userId)) return null;
  if (profile.error != null || !profile.data || profile.data.onboarded) return null;
  return <Navigate to={`/welcome?next=${encodeURIComponent(pathname + search)}`} replace />;
}
