import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { FieldPage } from './pages/FieldPage';
import { EventRoute } from './pages/EventRoute';
import { EventsPage } from './pages/EventsPage';
import { FighterPage } from './pages/FighterPage';
import { ProfileEditPage } from './pages/ProfileEditPage';
import { FightersPage } from './pages/FightersPage';
import { RankingsPage } from './pages/RankingsPage';
import { FormatsPage } from './pages/FormatsPage';
import { HomePage } from './pages/HomePage';
import { MarshalPage } from './pages/MarshalPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RulesPage } from './pages/RulesPage';
import { RegisterPage } from './registration/RegisterPage';
import { ManagePage } from './pages/ManagePage';
import { AccountPage } from './auth/AccountPage';
import { TestLoginPage } from './auth/TestLoginPage';
import { WelcomePage } from './pages/WelcomePage';
import { NewEventPage } from './pages/NewEventPage';
import { TeamManagerPage } from './pages/TeamManagerPage';
import { TeamPage } from './pages/TeamPage';
import { TeamEditPage } from './pages/TeamEditPage';
import { TeamsPage } from './pages/TeamsPage';
import { MyEventsPage } from './pages/MyEventsPage';
import { OrganizationPage, OrganizationsPage } from './pages/OrganizationPages';
import { PlatformFightersPage, PlatformHomePage, PlatformOrganizationsPage } from './pages/platform/PlatformPages';
import { PlatformActivityPage, PlatformBugsPage } from './pages/platform/AdminInsights';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/new" element={<NewEventPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/new" element={<Navigate to="/team-manager" replace />} />
        <Route path="teams/:slug" element={<TeamPage />} />
        <Route path="teams/:slug/edit" element={<TeamEditPage />} />
        <Route path="fighters" element={<FightersPage />} />
        <Route path="fighters/:id" element={<FighterPage />} />
        <Route path="fighters/:id/edit" element={<ProfileEditPage />} />
        <Route path="rankings" element={<RankingsPage />} />
        <Route path="team-manager" element={<TeamManagerPage />} />
        <Route path="events/:eventId" element={<EventRoute />} />
        <Route path="events/:eventId/register" element={<RegisterPage />} />
        <Route path="events/:eventId/field/:field" element={<FieldPage />} />
        <Route path="events/:eventId/manage" element={<ManagePage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/:slug" element={<OrganizationPage />} />
        <Route path="platform" element={<PlatformHomePage />} />
        <Route path="platform/organizations" element={<PlatformOrganizationsPage />} />
        <Route path="platform/fighters" element={<PlatformFightersPage />} />
        <Route path="platform/analytics" element={<PlatformActivityPage />} />
        <Route path="platform/activity" element={<Navigate to="/platform/analytics" replace />} />
        <Route path="platform/bugs" element={<PlatformBugsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="my-events" element={<MyEventsPage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="test-login" element={<TestLoginPage />} />
        <Route path="formats" element={<FormatsPage />} />
        <Route path="marshal" element={<MarshalPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
