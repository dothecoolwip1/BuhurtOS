import { HashRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ShowcaseShell } from './components/ShowcaseShell';
import { Layout } from './components/Layout';
import { RequirePermission } from './components/RequirePermission';
import { AppStateProvider, useAppState } from './features/AppState';
import { ShowcaseDashboard } from './pages/ShowcaseDashboard';
import { GovernancePage } from './pages/GovernancePage';
import { TeamsPage } from './pages/TeamsPage';
import { TeamPage } from './pages/TeamPage';
import { TeamHQPage } from './pages/TeamHQPage';
import { FightersPage } from './pages/FightersPage';
import { FighterProfilePage } from './pages/FighterProfilePage';
import { MyProfilePage } from './pages/MyProfilePage';
import { ShowcaseEventsPage } from './pages/ShowcaseEventsPage';
import { ShowcaseEventPage } from './pages/ShowcaseEventPage';
import { ShowcaseRankingsPage } from './pages/ShowcaseRankingsPage';
import { ShowcaseRulesPage } from './pages/ShowcaseRulesPage';
import { ShowcasePublicPage } from './pages/ShowcasePublicPage';
import { MarketingHome } from './pages/MarketingHome';
import { LoginPage } from './pages/LoginPage';
import { OpsPage } from './pages/OpsPage';
import { RosterPage } from './pages/RosterPage';
import { BracketPage } from './pages/BracketPage';
import { StandingsPage } from './pages/StandingsPage';
import { AdminPage } from './pages/AdminPage';
import { DisciplinePage } from './pages/DisciplinePage';
import { NotesPage } from './pages/NotesPage';
import { SyncPage } from './pages/SyncPage';
import { SetupPage } from './pages/SetupPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { PublicPage } from './pages/PublicPage';
import { EventManagementPage } from './pages/EventManagementPage';
import { FoundationPage } from './pages/FoundationPage';
import { RulesetsPage } from './pages/RulesetsPage';
import { signOut } from './lib/auth';

function OperationsProvider() {
  return <AppStateProvider><Outlet /></AppStateProvider>;
}

function OperationalGate() {
  const { loading, user, dataMode } = useAppState();
  const location = useLocation();
  if (loading) return <div className="state-card">Loading tournament operations…</div>;
  if (dataMode === 'supabase' && !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/ops/login?next=${next}`} replace />;
  }
  if (dataMode === 'supabase' && user && user.platformRoles.length === 0 && user.organizationRoles.length === 0 && user.eventRoles.length === 0) {
    return <main className="auth-shell"><section className="auth-card"><span className="eyebrow">Access pending</span><h1>No operational role assigned</h1><p>Your account is signed in, but it has not been granted access to an organization, team, event, or fighter workspace yet.</p><Link className="primary big button-link" to="/live">View public coverage</Link><button className="big" onClick={() => signOut()}>Sign Out</button></section></main>;
  }
  return <Layout />;
}

export function App(){
  return <HashRouter><Routes>
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
        <Route path="foundation" element={<FoundationPage/>}/>
        <Route path="rulesets" element={<RulesetsPage/>}/>
        <Route path="sync" element={<SyncPage/>}/>
        <Route path="setup" element={<SetupPage/>}/>
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></HashRouter>;
}
