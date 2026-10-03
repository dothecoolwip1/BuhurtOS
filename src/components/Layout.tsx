import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Dialog } from './Dialog';
import { BugReportButton } from './BugReport';
import { trackPageView } from '../lib/analytics';
import { setSampleMode, useSampleMode } from '../data/mode';
import { useAuth } from '../auth/AuthContext';
import { usePlatformRole } from '../auth/usePlatformRole';
import { ProfileGate } from '../auth/ProfileGate';
import { NotificationBell } from './NotificationBell';
import { UpdateBanner } from './UpdateBanner';

const NAV = [
  { to: '/', label: 'Home', end: true, icon: <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" /> },
  { to: '/events', label: 'Events', end: false, icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></> },
  { to: '/calendar', label: 'Calendar', end: false, icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2" /></> },
  { to: '/teams', label: 'Teams', end: false, icon: <><path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6Z" /></> },
  { to: '/fighters', label: 'Fighters', end: false, icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></> },
  { to: '/rankings', label: 'Rankings', end: false, icon: <path d="M6 20V11M12 20V4M18 20v-6" /> },
  { to: '/formats', label: 'Formats', end: false, icon: <path d="M5 19 19 5M19 5l-1 4M19 5l-4 1M19 19 5 5M5 5l1 4M5 5l4 1" /> },
  { to: '/rules', label: 'Rules', end: false, icon: <><path d="M5 4h11l3 3v13H5Z" /><path d="M9 11h6M9 15h6" /></> }
];

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>(() => {
    try { const t = localStorage.getItem('bos-theme'); return t === 'light' || t === 'dark' ? t : undefined; } catch { return undefined; }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('bos-theme', next); } catch { /* storage can be blocked */ }
  };
  return toggle;
}

export function Layout() {
  const toggleTheme = useTheme();
  const { pathname } = useLocation();
  const { session } = useAuth();
  const { isOwner } = usePlatformRole();
  const sample = useSampleMode();
  const [more, setMore] = useState(false);
  useEffect(() => { window.scrollTo({ top: 0 }); setMore(false); }, [pathname]);
  // Usage for the platform owner only: the page on each change, then a heartbeat every minute while the tab is visible. Never blocks anything.
  const userId = session?.user.id;
  useEffect(() => {
    const ping = () => { if (!document.hidden) trackPageView(pathname); };
    ping();
    const t = window.setInterval(ping, 60_000);
    document.addEventListener('visibilitychange', ping);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, [pathname, userId]);
  // The phone bar keeps the four most used places; the rest sit under More.
  const PHONE = NAV.filter(n => n.to !== '/calendar').slice(0, 4);
  const EXTRA = NAV.slice(5);
  const extraActive = EXTRA.some(n => pathname.startsWith(n.to)) || pathname.startsWith('/organizations') || pathname.startsWith('/platform') || pathname.startsWith('/calendar') || pathname.startsWith('/my-events');
  return (
    <>
      {sample && <div className="mockflag">SAMPLE MODE · <b>Teams, fighters, events and scores here are invented.</b> <button type="button" className="linklike" onClick={() => setSampleMode(false)}>Leave sample mode</button></div>}
      <header className={`top${session ? ' signed' : ''}`}>
        <div className="wrap">
          <NavLink className="brand" to="/" aria-label="BuhurtOS home">
            <svg className="mark" viewBox="0 0 30 34" aria-hidden="true"><defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E3C77A" /><stop offset=".35" stopColor="#C9893A" /><stop offset=".65" stopColor="#8E4E6B" /><stop offset="1" stopColor="#2C6BB0" /></linearGradient></defs><path d="M2 2h26v14c0 8-6 13-13 16C8 29 2 24 2 16Z" fill="url(#mk)" /><path d="M9 9v15M21 9v15M6 14h18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".92" /></svg>
            <span>Buhurt<span className="os">OS</span></span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map((n, i) => <NavLink key={n.to} to={n.to} end={n.end} className={i >= 5 ? 'nav-extra' : undefined}>{n.label}</NavLink>)}
            {session && <NavLink to="/my-events" className="nav-extra">My events</NavLink>}
            {isOwner && <NavLink to="/platform" className="nav-extra">Platform</NavLink>}
            {/* On mid-width screens the less used places move under More, so the header never overlaps. */}
            <button type="button" className={`nav-more${extraActive ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>More</button>
          </nav>
          <div className="spacer" />
          <BugReportButton />
          {session && <NotificationBell />}
          <NavLink className="btn btn-line" to="/account">{session ? 'Account' : 'Sign in'}</NavLink>
          <button className="icon-btn theme-btn" type="button" onClick={toggleTheme} aria-label="Switch light or dark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
          </button>
        </div>
      </header>
      <main className="wrap"><UpdateBanner /><ProfileGate /><Outlet /></main>
      <footer><div className="wrap"><span>BuhurtOS · built for the people who fight, run and follow armored combat. It uses limited analytics to understand how the site is used and improve the platform. We do not use GPS or collect what you type into forms.</span><NavLink className="footlink" to="/privacy">Privacy</NavLink>{sample && <span className="mono">Sample mode</span>}<span className="mono" data-testid="app-version">{__APP_VERSION__}</span></div></footer>
      <nav className="bottom" aria-label="Main">
        {PHONE.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">{n.icon}</svg>
            {n.label}
          </NavLink>
        ))}
        <button type="button" className={extraActive ? 'active' : undefined} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          More
        </button>
      </nav>
      {more && (
        <Dialog title="More" variant="drawer" onClose={() => setMore(false)}>
          <nav className="more-list" aria-label="More">
            <NavLink to="/calendar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M8 14h2M12 14h2M16 14h2" /></svg>
              Calendar
            </NavLink>
            {session && (
              <NavLink to="/my-events">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4m-7 9 2 2 4-4" /></svg>
                My events
              </NavLink>
            )}
            {EXTRA.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">{n.icon}</svg>
                {n.label}
              </NavLink>
            ))}
            <NavLink to="/organizations">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" /></svg>
              Organizations
            </NavLink>
            {isOwner && (
              <NavLink to="/platform">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M12 3 3 8l9 5 9-5ZM3 13l9 5 9-5" /></svg>
                Platform
              </NavLink>
            )}
            <NavLink to="/account">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
              {session ? 'Account' : 'Sign in'}
            </NavLink>
            <button type="button" onClick={toggleTheme}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              Light or dark
            </button>
          </nav>
        </Dialog>
      )}
    </>
  );
}
