import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SAMPLE_DATA } from '../data/fixtures';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { to: '/', label: 'Home', end: true, icon: <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" /> },
  { to: '/events', label: 'Events', end: false, icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></> },
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
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return (
    <>
      {SAMPLE_DATA && <div className="mockflag">PREVIEW BUILD · <b>Teams, fighters, events and scores are invented sample data.</b></div>}
      <header className="top">
        <div className="wrap">
          <NavLink className="brand" to="/" aria-label="BuhurtOS home">
            <svg className="mark" viewBox="0 0 30 34" aria-hidden="true"><defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E3C77A" /><stop offset=".35" stopColor="#C9893A" /><stop offset=".65" stopColor="#8E4E6B" /><stop offset="1" stopColor="#2C6BB0" /></linearGradient></defs><path d="M2 2h26v14c0 8-6 13-13 16C8 29 2 24 2 16Z" fill="url(#mk)" /><path d="M9 9v15M21 9v15M6 14h18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".92" /></svg>
            <span>Buhurt<span className="os">OS</span></span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}
          </nav>
          <div className="spacer" />
          <NavLink className="btn btn-line" to="/account">{session ? 'Account' : 'Sign in'}</NavLink>
          <NavLink className="btn btn-ink" to="/admin">Manage</NavLink>
          <button className="icon-btn" type="button" onClick={toggleTheme} aria-label="Switch light or dark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
          </button>
        </div>
      </header>
      <main className="wrap"><Outlet /></main>
      <footer><div className="wrap"><span>BuhurtOS · built for the people who fight, run and follow armored combat.</span><span className="mono">Preview build · sample data</span></div></footer>
      <nav className="bottom" aria-label="Main">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">{n.icon}</svg>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
