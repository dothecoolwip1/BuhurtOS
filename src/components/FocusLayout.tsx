import { Suspense, createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ProfileGate } from '../auth/ProfileGate';
import { setSampleMode, useSampleMode } from '../data/mode';
import { trackPageView } from '../lib/analytics';
import { ErrorBoundary } from './ErrorBoundary';
import { PageLoading } from './PageLoading';
import { useTheme } from './Layout';
import { OfflineBanner } from './OfflineBanner';
import { PushWiring } from './PushWiring';
import { UpdateBanner } from './UpdateBanner';

/** What a focus screen tells its header: the event, what is being operated, where Exit goes, and (where the screen knows it) the sync state. */
export interface FocusBar {
  eventName?: string;
  /** For example "Field 1", "Lyst · Field 1", "Check-in", "Armour inspection". */
  context?: string;
  /** Where Exit goes. Without one, Exit returns to the event page of the route's event. */
  exit?: { to: string; label: string };
  /** Score or desk actions saved on this device and not yet confirmed by the server (the screen's own outbox). Undefined: not shown. */
  pending?: number;
}

const FocusCtx = createContext<Dispatch<SetStateAction<FocusBar>> | null>(null);

/** A focus screen describes itself to the header. Outside FocusLayout this does nothing, so a page still works in the normal site chrome. */
export function useFocusBar(bar: FocusBar) {
  const set = useContext(FocusCtx);
  const { eventName, context, exit, pending } = bar;
  const exitTo = exit?.to, exitLabel = exit?.label;
  useEffect(() => {
    set?.({ eventName, context, exit: exitTo && exitLabel ? { to: exitTo, label: exitLabel } : undefined, pending });
  }, [set, eventName, context, exitTo, exitLabel, pending]);
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * Pack 24A1: the layout for live event operation (field scoring and the Lyst, the check-in and armour desk). While one of these screens is open the
 * device is event equipment: no site header, menus, bottom bar, footer, bug button, theme switch or notification prompts around the controls, and
 * nothing fixed over the bottom of the screen. A compact header keeps the event, what is being operated and an Exit that always goes back to the event.
 * Auth and role checks are unchanged: each page still decides who may use it, and the database checks every action again.
 */
export function FocusLayout() {
  useTheme();   // keep the theme the person chose elsewhere on the site; there is no switch here
  const { pathname, search } = useLocation();
  const { eventId: slug = '' } = useParams();
  const { session } = useAuth();
  const sample = useSampleMode();
  const online = useOnline();
  const [bar, setBar] = useState<FocusBar>({});
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  const userId = session?.user.id;
  useEffect(() => {
    const ping = () => { if (!document.hidden) trackPageView(pathname); };
    ping();
    const t = window.setInterval(ping, 60_000);
    document.addEventListener('visibilitychange', ping);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, [pathname, userId]);
  const exit = bar.exit ?? { to: `/events/${slug}`, label: 'Event' };
  return (
    <div className="focus">
      {sample && <div className="mockflag">SAMPLE MODE · <b>Teams, fighters, events and scores here are invented.</b> <button type="button" className="linklike" onClick={() => setSampleMode(false)}>Leave sample mode</button></div>}
      <header className="focus-top" data-testid="focus-header">
        <Link className="btn btn-line focus-exit" to={exit.to} aria-label={`Exit to ${exit.label}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          <span>Exit</span>
        </Link>
        <div className="focus-id">
          <span className="focus-ctx">{bar.context ?? ''}</span>
          <span className="focus-event" title={bar.eventName}>{bar.eventName ?? ''}</span>
        </div>
        {(!online || bar.pending !== undefined) && (
          <span className={`chip focus-conn ${!online ? 'live' : bar.pending ? 'brass' : 'win'}`} role="status">
            {!online ? 'Offline' : bar.pending ? `${bar.pending} pending` : 'Scores sent'}
          </span>
        )}
      </header>
      <main className="focus-main">
        <PushWiring />
        <OfflineBanner />
        <UpdateBanner />
        <ProfileGate />
        <FocusCtx.Provider value={setBar}>
          <ErrorBoundary resetKey={pathname + search}><Suspense fallback={<PageLoading />}><Outlet /></Suspense></ErrorBoundary>
        </FocusCtx.Provider>
        {/* the build this device runs (the site footer shows it elsewhere): staff and the update banner refer to it, and it is how a device is checked */}
        <p className="focus-version"><span className="mono" data-testid="app-version">{__APP_VERSION__}</span></p>
      </main>
    </div>
  );
}
