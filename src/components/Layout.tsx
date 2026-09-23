import { NavLink, Outlet } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { hasPermission } from '../lib/permissions';
import { signOut } from '../lib/auth';

const nav = [
  ['/ops', 'Ops', '⚔'],
  ['/ops/roster', 'Roster', '✓'],
  ['/ops/bracket', 'Bracket', '⌘'],
  ['/ops/standings', 'Standings', '≡'],
  ['/live', 'Public', '◎']
] as const;

export function Layout() {
  const { event, online, pendingCount, dataMode, syncNow, user } = useAppState();
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(event && hasPermission(user, permission, event.id, event.organizationId));
  const canSetup = Boolean(user?.platformRoles.includes('platform_super_admin') || user?.organizationRoles.some(role => role.role === 'organization_admin'));
  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-block"><span className="brand-mark">B</span><div><b>BuhurtOS</b><small>Buhurt Tournament Operations</small></div></div>
        <nav>{nav.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/ops'}><span>{icon}</span>{label}</NavLink>)}</nav>
        <div className="utility-nav">
          {can('event.manage') && <NavLink to="/ops/manage">Event Command Centre</NavLink>}
          {can('bracket.manage') && <NavLink to="/ops/admin">Bracket & Access Tools</NavLink>}
          {can('discipline.manage') && <NavLink to="/ops/discipline">Discipline</NavLink>}
          {can('notes.team') && <NavLink to="/ops/notes">Fight Notes</NavLink>}
          {canSetup && <NavLink to="/ops/foundation">Identity & Divisions</NavLink>}
          {canSetup && <NavLink to="/ops/rulesets">Rulesets</NavLink>}
          <NavLink to="/ops/sync">Sync Queue</NavLink>
          {canSetup && <NavLink to="/ops/setup">Setup</NavLink>}
          <NavLink to={'/register' + (event ? '?event=' + event.id : '')}>Registration</NavLink>
          <NavLink to="/">Platform Home</NavLink>
          {dataMode === 'supabase' && <button className="link-button" onClick={() => signOut()}>Sign Out</button>}
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div><strong>{event?.name ?? 'BuhurtOS'}</strong><small>{event?.venue ?? 'No event selected'}</small></div>
          <div className="status-row">
            <span className={'status-pill ' + (online ? 'ok' : 'warn')}>{online ? 'Online' : 'Offline'}</span>
            <span className="status-pill">{dataMode === 'supabase' ? 'Live DB' : 'Demo'}</span>
            {pendingCount > 0 && <button className="status-pill action" onClick={syncNow}>{pendingCount} queued</button>}
          </div>
        </header>
        <div className="page-wrap"><Outlet /></div>
      </main>
      <nav className="bottom-nav">{nav.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/ops'}><span>{icon}</span><small>{label}</small></NavLink>)}</nav>
    </div>
  );
}
