import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AdminProvider, useAdmin } from './AdminContext';
import { ROLE_LABEL, RUMBLE, type Role } from './data';
import { Seg } from '../components/ui';

const I = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>;
interface Item { to: string; label: string; roles: Role[]; icon: string; end?: boolean; badge?: 'regs' }
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [{ to: '/admin', label: 'Overview', roles: ['organizer', 'scorekeeper', 'medic', 'captain'], icon: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z', end: true }] },
  { title: 'This event', items: [
    { to: '/admin/setup', label: 'Setup guide', roles: ['organizer'], icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9' },
    { to: '/admin/competitions', label: 'Competitions', roles: ['organizer'], icon: 'M7 4h10v4a5 5 0 0 1-10 0ZM12 13v4M8 21h8M9 17h6' },
    { to: '/admin/registration', label: 'Registration', roles: ['organizer', 'captain'], icon: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3', badge: 'regs' },
    { to: '/admin/checkin', label: 'Check-in', roles: ['organizer', 'medic'], icon: 'M5 12l5 5L20 7' },
    { to: '/admin/run', label: 'Run the day', roles: ['organizer', 'scorekeeper'], icon: 'M5 3l14 9-14 9Z' }] },
  { title: 'People', items: [{ to: '/admin/people', label: 'People and access', roles: ['organizer'], icon: 'M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0' }] }
];
const PRIMARY: Record<Role, string[]> = { organizer: ['/admin', '/admin/registration', '/admin/checkin', '/admin/run'], scorekeeper: ['/admin', '/admin/run'], medic: ['/admin', '/admin/checkin'], captain: ['/admin', '/admin/registration'] };

function Shell() {
  const { role, setRole, regs } = useAdmin();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  const pending = regs.filter(r => r.status === 'pending').length;
  const flat = SECTIONS.flatMap(s => s.items);
  const here = flat.find(i => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
  return (
    <div className={`adm-shell ${open ? 'open' : ''}`}>
      <div className="drawer-bg" onClick={() => setOpen(false)} />
      <aside className="adm-side" aria-label="Admin">
        <Link className="brand" to="/"><svg className="mark" viewBox="0 0 30 34" aria-hidden="true"><path d="M2 2h26v14c0 8-6 13-13 16C8 29 2 24 2 16Z" fill="#C9893A" /><path d="M9 9v15M21 9v15M6 14h18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".92" /></svg><span>Buhurt<span className="os">OS</span></span></Link>
        <div className="scopebox"><small>Managing</small><b>{RUMBLE.name}</b><span>{RUMBLE.dates} · {RUMBLE.tier} · Draft</span></div>
        <nav className="adm-nav">
          {SECTIONS.map(s => {
            const items = s.items.filter(i => i.roles.includes(role));
            if (!items.length) return null;
            return <div key={s.title}><h4>{s.title}</h4>{items.map(i => (
              <NavLink key={i.to} to={i.to} end={i.end}>{I(i.icon)}{i.label}{i.badge === 'regs' && pending > 0 && <span className="n">{pending}</span>}</NavLink>
            ))}</div>;
          })}
        </nav>
        <div className="adm-foot">
          <div className="rolebox"><small>Viewing as (preview)</small>
            <Seg label="Role" value={role} options={(Object.keys(ROLE_LABEL) as Role[]).map(r => [r, ROLE_LABEL[r]] as const)} onChange={setRole} /></div>
          <Link className="btn btn-line" to="/">← Public site</Link>
        </div>
      </aside>
      <div className="adm-main">
        <header className="adm-top">
          <button type="button" className="icon-btn menubtn" aria-label="Open menu" onClick={() => setOpen(true)}>{I('M4 7h16M4 12h16M4 17h16')}</button>
          <div className="crumbs"><span>Admin</span><span>/</span><b>{here?.label ?? 'Overview'}</b></div>
          <div className="sp" />
          <Link className="btn btn-line btn-sm" to="/events/prairie-steel-open">View public page</Link>
        </header>
        <div className="adm-body">
          <div className="scopebar"><b>Scope: Event</b><span>{RUMBLE.name}</span><span>·</span><span>You are acting as <b>{ROLE_LABEL[role]}</b></span><span>·</span><span>The database enforces what you can do, not this menu</span></div>
          <Outlet />
        </div>
      </div>
      <nav className="adm-bottom" aria-label="Admin quick">
        {PRIMARY[role].map(p => { const it = flat.find(i => i.to === p)!; return <NavLink key={p} to={p} end={it.end}>{I(it.icon)}{it.label.split(' ')[0]}</NavLink>; })}
        <button type="button" onClick={() => setOpen(true)}>{I('M4 7h16M4 12h16M4 17h16')}More</button>
      </nav>
    </div>
  );
}

export function AdminLayout() { return <AdminProvider><Shell /></AdminProvider>; }
