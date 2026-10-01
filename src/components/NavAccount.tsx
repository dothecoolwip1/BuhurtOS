import { NavLink } from 'react-router-dom';
import { Avatar } from '../auth/account/shared';
import { useAuth } from '../auth/AuthContext';
import { fetchMyFighterId } from '../data/accountApi';
import { fetchFighterProfile } from '../data/fighters';
import { useAsync } from '../lib/useAsync';

/** The top bar's account link. Shows the person's profile photo (or their initials) when signed in; a failure to load it just leaves the plain label. */
export function NavAccount() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const me = useAsync(async () => {
    if (!userId) return null;
    try {
      const id = await fetchMyFighterId(userId);
      const p = id ? await fetchFighterProfile(id) : null;
      return p ? { name: p.displayName, path: p.photoPath } : null;
    } catch { return null; }
  }, [userId]);
  if (!session) return <NavLink className="btn btn-line" to="/account">Sign in</NavLink>;
  const name = me.data?.name ?? session.user.email ?? 'Account';
  return (
    <NavLink className="btn btn-line navface" to="/account" aria-label="Your account">
      <Avatar path={me.data?.path ?? null} name={name} size={28} />
      <span>Account</span>
    </NavLink>
  );
}
