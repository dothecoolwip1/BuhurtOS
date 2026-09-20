import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ShowcaseShell } from './components/ShowcaseShell';
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

export function App(){
  return <HashRouter><Routes>
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
    <Route path="*" element={<Navigate to="/home" replace/>}/>
  </Routes></HashRouter>;
}
