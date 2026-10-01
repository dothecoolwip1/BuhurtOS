import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

/**
 * The viewer's own platform_roles rows (row level security only returns their own). This is for what to SHOW: the database enforces
 * every action regardless, so a wrong answer here can only hide or reveal a link, never grant a power.
 * Read once per signed-in account and shared by every component that asks.
 */
export interface PlatformRole { loading: boolean; isOwner: boolean; isOrganizer: boolean }

export const roleFlags = (roles: string[]) => ({ isOwner: roles.includes('owner'), isOrganizer: roles.includes('owner') || roles.includes('organizer') });

const cache = new Map<string, Promise<string[]>>();
function loadRoles(userId: string): Promise<string[]> {
  let p = cache.get(userId);
  if (!p) {
    p = Promise.resolve(supabase.from('platform_roles').select('role').eq('user_id', userId)).then(({ data, error }) => {
      if (error) throw error;
      return (data as { role: string }[]).map(r => r.role);
    });
    cache.set(userId, p);
    p.catch(() => { cache.delete(userId); }); // a failed read is retried next time, not remembered
  }
  return p;
}

export function usePlatformRole(): PlatformRole {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState<{ userId: string | undefined; roles: string[] | null }>({ userId, roles: null });
  useEffect(() => {
    let live = true;
    if (!userId) { setState({ userId, roles: [] }); return; }
    setState(s => (s.userId === userId && s.roles ? s : { userId, roles: null }));
    loadRoles(userId).then(r => { if (live) setState({ userId, roles: r }); }, () => { if (live) setState({ userId, roles: [] }); });
    return () => { live = false; };
  }, [userId]);
  const ready = state.userId === userId && state.roles !== null;
  return { loading: !ready, ...roleFlags(ready ? state.roles! : []) };
}
