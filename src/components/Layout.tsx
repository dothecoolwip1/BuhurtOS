import { NavLink, Outlet } from 'react-router-dom';
import { useAppState } from '../features/AppState';
import { hasPermission, type Permission } from '../lib/permissions';
import { signOut } from '../lib/auth';

const nav: Array<{to:string;label:string;icon:string;permission?:Permission}> = [
  { to:'/ops', label:'Ops', icon:'⚔', permission:'event.view_private' },
  { to:'/ops/roster', label:'Roster', icon:'✓', permission:'event.view_private' },
  { to:'/ops/bracket', label:'Bracket', icon:'⌘', permission:'bracket.manage' },
  { to:'/ops/standings', label:'Standings', icon:'≡', permission:'event.view_private' },
  { to:'/live', label:'Public', icon:'◎' }
];

export function Layout() {
  const { event,online,pendingCount,dataMode,syncNow,user }=useAppState();
  const can=(permission:Permission)=>Boolean(event&&hasPermission(user,permission,event.id,event.organizationId));
  const visibleNav=nav.filter(item=>!item.permission||can(item.permission));
  const canSetup=Boolean(
    user?.platformRoles.includes('platform_super_admin')
    || user?.organizationRoles.some(role=>role.role==='organization_admin')
    || user?.permissionGrants.some(grant=>grant.permission==='organization.manage')
  );

  return <div className="app-shell">
    <aside className="side-rail">
      <div className="brand-block"><span className="brand-mark">B</span><div><b>BuhurtOS</b><small>Buhurt Tournament Operations</small></div></div>
      <nav>{visibleNav.map(item=><NavLink key={item.to} to={item.to} end={item.to==='/ops'}><span>{item.icon}</span>{item.label}</NavLink>)}</nav>
      <div className="utility-nav">
        {(can('event.manage')||can('registration.manage')||can('announcement.manage'))&&<NavLink to="/ops/manage">Event Command Centre</NavLink>}
        {can('bracket.manage')&&<NavLink to="/ops/admin">Bracket & Access Tools</NavLink>}
        {can('discipline.manage')&&<NavLink to="/ops/discipline">Discipline</NavLink>}
        {can('notes.team')&&<NavLink to="/ops/notes">Fight Notes</NavLink>}
        {can('event.view_private')&&<NavLink to="/ops/sync">Sync Queue</NavLink>}
        {can('organization.manage')&&<NavLink to="/ops/foundation">Organization Administration</NavLink>}
        {canSetup&&<NavLink to="/ops/setup">Platform Setup</NavLink>}
        <NavLink to={'/register'+(event?'?event='+encodeURIComponent(event.id):'')}>Registration</NavLink>
        <NavLink to="/">Platform Home</NavLink>
        {dataMode==='supabase'&&<button className="link-button" onClick={()=>signOut()}>Sign Out</button>}
      </div>
    </aside>
    <main className="main-shell">
      <header className="topbar">
        <div><strong>{event?.name??'BuhurtOS'}</strong><small>{event?.venue??'No event selected'}</small></div>
        <div className="status-row">
          <span className={'status-pill '+(online?'ok':'warn')}>{online?'Online':'Offline'}</span>
          <span className="status-pill">{dataMode==='supabase'?'Live DB':dataMode==='demo'?'Development Demo':'Unconfigured'}</span>
          {pendingCount>0&&<button className="status-pill action" onClick={syncNow}>{pendingCount} queued</button>}
        </div>
      </header>
      <div className="page-wrap"><Outlet/></div>
    </main>
    <nav className="bottom-nav">{visibleNav.map(item=><NavLink key={item.to} to={item.to} end={item.to==='/ops'}><span>{item.icon}</span><small>{item.label}</small></NavLink>)}</nav>
  </div>;
}
