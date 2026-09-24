import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ShowcaseShell } from './components/ShowcaseShell';
import { Layout } from './components/Layout';
import { RequirePermission } from './components/RequirePermission';
import { AppStateProvider, useAppState } from './features/AppState';

const ShowcaseDashboard = lazy(() => import('./pages/ShowcaseDashboard').then(module => ({ default: module.ShowcaseDashboard })));
const GovernancePage = lazy(() => import('./pages/GovernancePage').then(module => ({ default: module.GovernancePage })));
const TeamsPage = lazy(() => import('./pages/TeamsPage').then(module => ({ default: module.TeamsPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then(module => ({ default: module.TeamPage })));
const TeamHQPage = lazy(() => import('./pages/TeamHQPage').then(module => ({ default: module.TeamHQPage })));
const FightersPage = lazy(() => import('./pages/FightersPage').then(module => ({ default: module.FightersPage })));
const FighterProfilePage = lazy(() => import('./pages/FighterProfilePage').then(module => ({ default: module.FighterProfilePage })));
const MyProfilePage = lazy(() => import('./pages/MyProfilePage').then(module => ({ default: module.MyProfilePage })));
const ShowcaseEventsPage = lazy(() => import('./pages/ShowcaseEventsPage').then(module => ({ default: module.ShowcaseEventsPage })));
const ShowcaseEventPage = lazy(() => import('./pages/ShowcaseEventPage').then(module => ({ default: module.ShowcaseEventPage })));
const ShowcaseRankingsPage = lazy(() => import('./pages/ShowcaseRankingsPage').then(module => ({ default: module.ShowcaseRankingsPage })));
const ShowcaseRulesPage = lazy(() => import('./pages/ShowcaseRulesPage').then(module => ({ default: module.ShowcaseRulesPage })));
const ShowcasePublicPage = lazy(() => import('./pages/ShowcasePublicPage').then(module => ({ default: module.ShowcasePublicPage })));
const MarketingHome = lazy(() => import('./pages/MarketingHome').then(module => ({ default: module.MarketingHome })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })));
const OpsPage = lazy(() => import('./pages/OpsPage').then(module => ({ default: module.OpsPage })));
const RosterPage = lazy(() => import('./pages/RosterPage').then(module => ({ default: module.RosterPage })));
const BracketPage = lazy(() => import('./pages/BracketPage').then(module => ({ default: module.BracketPage })));
const StandingsPage = lazy(() => import('./pages/StandingsPage').then(module => ({ default: module.StandingsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(module => ({ default: module.AdminPage })));
const DisciplinePage = lazy(() => import('./pages/DisciplinePage').then(module => ({ default: module.DisciplinePage })));
const NotesPage = lazy(() => import('./pages/NotesPage').then(module => ({ default: module.NotesPage })));
const SyncPage = lazy(() => import('./pages/SyncPage').then(module => ({ default: module.SyncPage })));
const SetupPage = lazy(() => import('./pages/SetupPage').then(module => ({ default: module.SetupPage })));
const RegistrationPage = lazy(() => import('./pages/RegistrationPage').then(module => ({ default: module.RegistrationPage })));
const PublicPage = lazy(() => import('./pages/PublicPage').then(module => ({ default: module.PublicPage })));
const EventManagementPage = lazy(() => import('./pages/EventManagementPage').then(module => ({ default: module.EventManagementPage })));
const FoundationPage = lazy(() => import('./pages/FoundationPage').then(module => ({ default: module.FoundationPage })));
const RulesetsPage = lazy(() => import('./pages/RulesetsPage').then(module => ({ default: module.RulesetsPage })));
const IdentityPage = lazy(() => import('./pages/IdentityPage').then(module => ({ default: module.IdentityPage })));
const IdentityReviewPage = lazy(() => import('./pages/IdentityReviewPage').then(module => ({ default: module.IdentityReviewPage })));

function OperationsProvider() {
  return <AppStateProvider><Outlet /></AppStateProvider>;
}

function OperationalGate() {
  const { loading, authReady, authNotice, user, dataMode } = useAppState();
  const location = useLocation();
  if (dataMode === 'supabase' && !authReady) return <div className="state-card">Checking account access…</div>;
  if (dataMode === 'supabase' && !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    const reason = authNotice ? `&reason=${encodeURIComponent(authNotice)}` : '';
    return <Navigate to={`/ops/login?next=${next}${reason}`} replace />;
  }
  if (loading) return <div className="state-card">Loading tournament operations…</div>;
  return <Layout />;
}

function RouteFallback() {
  return <div className="state-card" role="status" aria-live="polite">Loading BuhurtOS…</div>;
}

export function App(){
  return <HashRouter><Suspense fallback={<RouteFallback/>}><Routes>
    <Route path="/" element={<MarketingHome/>}/>
    <Route path="/public" element={<ShowcasePublicPage/>}/>
    <Route element={<ShowcaseShell/>}>
      <Route path="/home" element={<ShowcaseDashboard/>}/>
      <Route path="/governance" element={<GovernancePage/>}/>
      <Route path="/teams" element={<TeamsPage/>}/>
      <Route path="/teams/:teamId" element={<TeamPage/>}/>
      <Route path="/team-hq" element={<TeamHQPage/>}/>
      <Route path="/fighters" element={<FightersPage/>}/>
      <Route path="/fighters/:fighterId" element={<FighterProfilePage/>}/>
      <Route path="/me" element={<MyProfilePage/>}/>
      <Route path="/events" element={<ShowcaseEventsPage/>}/>
      <Route path="/events/:eventId" element={<ShowcaseEventPage/>}/>
      <Route path="/rankings" element={<ShowcaseRankingsPage/>}/>
      <Route path="/rules" element={<ShowcaseRulesPage/>}/>
    </Route>

    <Route element={<OperationsProvider/>}>
      <Route path="/live" element={<PublicPage/>}/>
      <Route path="/register" element={<RegistrationPage/>}/>
      <Route path="/ops/login" element={<LoginPage/>}/>
      <Route path="/ops" element={<OperationalGate/>}>
        <Route index element={<OpsPage/>}/>
        <Route path="roster" element={<RosterPage/>}/>
        <Route path="bracket" element={<BracketPage/>}/>
        <Route path="standings" element={<StandingsPage/>}/>
        <Route path="manage" element={<RequirePermission permission="event.manage"><EventManagementPage/></RequirePermission>}/>
        <Route path="admin" element={<RequirePermission permission="bracket.manage"><AdminPage/></RequirePermission>}/>
        <Route path="discipline" element={<RequirePermission permission="discipline.manage"><DisciplinePage/></RequirePermission>}/>
        <Route path="notes" element={<RequirePermission permission="notes.team"><NotesPage/></RequirePermission>}/>
        <Route path="identity" element={<IdentityPage/>}/>
        <Route path="identity-review" element={<IdentityReviewPage/>}/>
        <Route path="foundation" element={<FoundationPage/>}/>
        <Route path="rulesets" element={<RulesetsPage/>}/>
        <Route path="sync" element={<SyncPage/>}/>
        <Route path="setup" element={<SetupPage/>}/>
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></Suspense></HashRouter>;
}
