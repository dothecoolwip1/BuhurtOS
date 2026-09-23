import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ShowcaseShell } from './components/ShowcaseShell';
import { Layout } from './components/Layout';
import { AppStateProvider } from './features/AppState';
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
import { OpsPage } from './pages/OpsPage';
import { RosterPage } from './pages/RosterPage';
import { BracketPage } from './pages/BracketPage';
import { StandingsPage } from './pages/StandingsPage';
import { AdminPage } from './pages/AdminPage';
import { DisciplinePage } from './pages/DisciplinePage';
import { NotesPage } from './pages/NotesPage';
import { SyncPage } from './pages/SyncPage';
import { SetupPage } from './pages/SetupPage';
import { PublicPage } from './pages/PublicPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { LoginPage } from './pages/LoginPage';

export function App(){
  return <HashRouter>
    <AppStateProvider>
      <Routes>
        <Route path="/" element={<MarketingHome/>}/>
        <Route path="/public" element={<ShowcasePublicPage/>}/>
        <Route path="/register" element={<RegistrationPage/>}/>
        <Route path="/login" element={<LoginPage/>}/>

        <Route path="/run" element={<Layout/>}>
          <Route index element={<OpsPage/>}/>
          <Route path="roster" element={<RosterPage/>}/>
          <Route path="bracket" element={<BracketPage/>}/>
          <Route path="standings" element={<StandingsPage/>}/>
          <Route path="public" element={<PublicPage/>}/>
          <Route path="admin" element={<AdminPage/>}/>
          <Route path="discipline" element={<DisciplinePage/>}/>
          <Route path="notes" element={<NotesPage/>}/>
          <Route path="sync" element={<SyncPage/>}/>
          <Route path="setup" element={<SetupPage/>}/>
        </Route>

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

        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </AppStateProvider>
  </HashRouter>;
}
