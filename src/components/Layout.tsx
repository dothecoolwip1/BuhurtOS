import { NavLink, Outlet } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { hasPermission } from '../lib/permissions';
import { signOut } from '../lib/auth';

const nav = [
  ['/run', 'Ops', '⚔'],
  ['/run/roster', 'Roster', '✓'],
  ['/run/bracket', 'Bracket', '⌘'],
  ['/run/standings', 'Standings', '≡'],
  ['/run/public', 'Public', '◎']
] as const;

export function Layout() {
  const { event, online, pendingCount, dataMode, syncNow, user } = useAppState();
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(event && hasPermission(user, permission, event.id, event.organizationId));
  const canSetup = dataMode === 'demo' || Boolean(user?.platformRoles.includes('platform_super_admin') || user?.organizationRoles.some(role => role.role === 'organization_admin'));
  return (
    <div className="app-shell">
      <aside className="side-rail">
        <NavLink to="/" className="brand-block"><span className="brand-mark">B</span><div><b>BuhurtOS</b><small>Tournament Operations</small></div></NavLink>
        <nav>{nav.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/run'}><span>{icon}</span>{label}</NavLink>)}</nav>
        <div className="utility-nav">
          {can('bracket.manage') && <NavLink to="/run/admin">Organizer Tools</NavLink>}
          {can('discipline.manage') && <NavLink to="/run/discipline">Discipline</NavLink>}
          {can('notes.team') && <NavLink to="/run/notes">Fight Notes</NavLink>}
          <NavLink to="/run/sync">Sync Queue</NavLink>
          {canSetup && <NavLink to="/run/setup">Setup</NavLink>}
          <NavLink to={event ? `/register?event=${event.id}` : '/register'}>Registration</NavLink>
          <NavLink to="/home">Discover</NavLink>
          {dataMode === 'supabase' && user && <button className="link-button" onClick={() => signOut()}>Sign Out</button>}
          {dataMode === 'supabase' && !user && <NavLink to="/login">Sign In</NavLink>}
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div><strong>{event?.name ?? 'BuhurtOS'}</strong><small>{event?.venue ?? 'No event selected'}</small></div>
          <div className="status-row">
            <span className={`status-pill ${online ? 'ok' : 'warn'}`}>{online ? 'Online' : 'Offline'}</span>
            <span className="status-pill">{dataMode === 'supabase' ? 'Live DB' : 'Demo'}</span>
            {pendingCount > 0 && <button className="status-pill action" onClick={syncNow}>{pendingCount} queued</button>}
          </div>
        </header>
        <div className="page-wrap"><Outlet /></div>
      </main>
      <nav className="bottom-nav">{nav.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/run'}><span>{icon}</span><small>{label}</small></NavLink>)}</nav>
    </div>
  );
}
