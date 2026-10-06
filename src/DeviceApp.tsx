import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DeviceBar } from './components/DeviceBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineBanner } from './components/OfflineBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { guardPath, landingFor, pathAllowed } from './lib/deviceRoutes';
import { deviceManager } from './lib/deviceSession';
import { supabase } from './lib/supabase';
import { AnnouncerPage } from './pages/AnnouncerPage';
import { CheckinDeskPage } from './pages/CheckinDeskPage';
import { CommandCentrePage } from './pages/CommandCentrePage';
import { DeviceHome } from './pages/DeviceHome';
import { DeviceSignInPage } from './pages/DeviceSignInPage';
import { FieldPage } from './pages/FieldPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { RulesPage } from './pages/RulesPage';
import { ArenaPage } from './pages/arena/ArenaPage';
import { CounterPage } from './pages/lyst/CounterPage';
import './styles/device.css';

const CHECK_MS = 30_000;

/**
 * "Is this device still allowed?" at launch, whenever the screen comes back to the front, when the signal returns, and every 30 seconds while it is
 * showing. The session is looked up by the database on every call, so a withdrawn or expired device is refused at once; the answer 42501 ends the
 * session here too (back to the sign-in page, which says so). Anything else (no signal, a busy server) changes nothing: a device keeps working.
 */
function useDeviceCheck() {
  useEffect(() => {
    const mgr = deviceManager();
    let live = true;
    const check = async () => {
      if (!live || document.hidden) return;
      try {
        let r = await supabase.rpc('device_whoami');
        if (r.error?.code === 'PGRST301' || r.error?.code === 'PGRST303') { if (await mgr.refresh()) r = await supabase.rpc('device_whoami'); }   // the token ran out between calls
        if (!live) return;
        if (r.error) { if (r.error.code === '42501') mgr.endLocally(); return; }
        mgr.applyWhoami(r.data);
      } catch { /* offline: carry on */ }
    };
    mgr.start();
    void check();
    const wake = () => { void mgr.wake().then(check); };
    const timer = window.setInterval(() => { void check(); }, CHECK_MS);
    window.addEventListener('focus', wake); window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('storage', wake);   // another tab of this device signed out
    return () => {
      live = false; window.clearInterval(timer);
      window.removeEventListener('focus', wake); window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('storage', wake);
    };
  }, []);
}

/** A page that sits in the ordinary page column. The counter, the venue display and the announcer own their whole screen. */
const Page = ({ children }: { children: ReactNode }) => <main className="device-main">{children}</main>;

/**
 * The app of a temporary event device (Pack 18.1): its own small route tree, the identity bar on every screen, no account, profile, onboarding or
 * analytics. Every page this role may not use sends the device to its own landing page. This only decides what to OFFER; the database refuses
 * everything a device may not do.
 */
function Frame() {
  const mgr = deviceManager();
  const w = useSyncExternalStore(mgr.subscribe, () => mgr.getWhoami());
  const { pathname, search } = useLocation();
  useDeviceCheck();
  if (!w) return <p className="muted" role="status">Signing out…</p>;
  const subject = { role: w.role, slug: w.event.slug };
  if (!pathAllowed(subject, pathname)) return <Navigate to={landingFor(subject)} replace />;
  return (
    <div className="device-frame">
      <DeviceBar />
      <ErrorBoundary resetKey={pathname + search}>
        <OfflineBanner /><UpdateBanner />
        <Routes>
          <Route path="lyst/join" element={<CounterPage />} />
          <Route path="lyst/join/:code" element={<CounterPage />} />
          <Route path="lyst/counter" element={<CounterPage />} />
          <Route path="events/:eventId" element={<Page><DeviceHome /></Page>} />
          <Route path="events/:eventId/command" element={<Page><CommandCentrePage /></Page>} />
          <Route path="events/:eventId/field/:field" element={<Page><FieldPage /></Page>} />
          <Route path="events/:eventId/checkin" element={<Page><CheckinDeskPage /></Page>} />
          <Route path="events/:eventId/announcer" element={<AnnouncerPage />} />
          <Route path="events/:eventId/arena" element={<ArenaPage />} />
          <Route path="events/:eventId/arena/:field" element={<ArenaPage />} />
          <Route path="rules" element={<Page><RulesPage /></Page>} />
          <Route path="privacy" element={<Page><PrivacyPage /></Page>} />
          <Route path="*" element={<Navigate to={guardPath(subject, '/')} replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}

export function DeviceApp() {
  const { pathname, search } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname + search} fullPage>
      <Routes>
        <Route path="device" element={<DeviceSignInPage />} />
        <Route path="*" element={<Frame />} />
      </Routes>
    </ErrorBoundary>
  );
}
