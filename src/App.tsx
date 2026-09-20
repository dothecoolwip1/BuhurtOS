import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequirePermission } from './components/RequirePermission';
import { useAppState } from './features/AppState';
import { isSupabaseConfigured } from './lib/supabase';
import { AdminPage } from './pages/AdminPage';
import { BracketPage } from './pages/BracketPage';
import { DisciplinePage } from './pages/DisciplinePage';
import { LoginPage } from './pages/LoginPage';
import { NotesPage } from './pages/NotesPage';
import { OpsPage } from './pages/OpsPage';
import { PublicPage } from './pages/PublicPage';
import { RegistrationPage } from './pages/RegistrationPage';
import { RosterPage } from './pages/RosterPage';
import { StandingsPage } from './pages/StandingsPage';
import { SyncPage } from './pages/SyncPage';
import { SetupPage } from './pages/SetupPage';

function ProtectedLayout(){
  const {user,loading}=useAppState();
  if(loading)return <div className="center-screen">Loading BuhurtOS…</div>;
  if(isSupabaseConfigured&&!user)return <Navigate to="/login" replace/>;
  return <Layout/>;
}

export function App(){
  return <HashRouter><Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/public" element={<PublicPage/>}/>
    <Route path="/register" element={<RegistrationPage/>}/>
    <Route element={<ProtectedLayout/>}>
      <Route path="/" element={<RequirePermission permission="event.view_private"><OpsPage/></RequirePermission>}/>
      <Route path="/roster" element={<RequirePermission permission="event.view_private"><RosterPage/></RequirePermission>}/>
      <Route path="/bracket" element={<RequirePermission permission="event.view_private"><BracketPage/></RequirePermission>}/>
      <Route path="/standings" element={<RequirePermission permission="event.view_private"><StandingsPage/></RequirePermission>}/>
      <Route path="/admin" element={<RequirePermission permission="bracket.manage"><AdminPage/></RequirePermission>}/>
      <Route path="/discipline" element={<RequirePermission permission="discipline.manage"><DisciplinePage/></RequirePermission>}/>
      <Route path="/notes" element={<RequirePermission permission="notes.team"><NotesPage/></RequirePermission>}/>
      <Route path="/sync" element={<RequirePermission permission="event.view_private"><SyncPage/></RequirePermission>}/>
      <Route path="/setup" element={<SetupPage/>}/>
    </Route>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></HashRouter>;
}
