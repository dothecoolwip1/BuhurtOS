import { NavLink, Outlet } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { hasPermission } from '../lib/permissions';
import { signOut } from '../lib/auth';

const nav = [
  ['/', 'Ops', '⚔'],
  ['/roster', 'Roster', '✓'],
  ['/bracket', 'Bracket', '⌘'],
  ['/standings', 'Standings', '≡'],
  ['/public', 'Public', '◎']
] as const;

export function Layout() {
  const { event, online, pendingCount, dataMode, syncNow, user } = useAppState();
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(event && hasPermission(user, permission, event.id, event.organizationId));
  const canSetup = Boolean(user?.platformRoles.includes('platform_super_admin') || user?.organizationRoles.some(role => role.role === 'organization_admin'));
  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-block"><span className="brand-mark">B</span><div><b>BuhurtOS</b><small>Buhurt Tournament Operations</small></div></div>
        <nav>{nav.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'}><span>{icon}</span>{label}</NavLink>)}</nav>
        <div className="utility-nav">{can('bracket.manage') && <NavLink to="/admin">Organizer Tools</NavLink>}{can('discipline.manage') && <NavLink to="/discipline">Discipline</NavLink>}{can('notes.team') && <NavLink to="/notes">Fight Notes</NavLink>}<NavLink to="/sync">Sync Queue</NavLink>{canSetup && <NavLink to="/setup">Setup</NavLink>}<NavLink to={`/register${event ? `?event=${event.id}` : ''}`}>Registration</NavLink>{dataMode === 'supabase' && <button className="link-button" onClick={() => signOut()}>Sign Out</button>}</div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div><strong>{event?.name ?? 'BuhurtOS'}</strong><small>{event?.venue ?? 'Loading event'}</small></div>
          <div className="status-row">
            <span className={`status-pill ${online ? 'ok' : 'warn'}`}>{online ? 'Online' : 'Offline'}</span>
            <span className="status-pill">{dataMode === 'supabase' ? 'Live DB' : 'Demo'}</span>
            {pendingCount > 0 && <button className="status-pill action" onClick={syncNow}>{pendingCount} queued</button>}
          </div>
        </header>
        <div className="page-wrap"><Outlet /></div>
      </main>
      <nav className="bottom-nav">{nav.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'}><span>{icon}</span><small>{label}</small></NavLink>)}</nav>
    </div>
  );
}
