import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { FieldPage } from './pages/FieldPage';
import { EventRoute } from './pages/EventRoute';
import { EventsPage } from './pages/EventsPage';
import { CalendarPage } from './pages/CalendarPage';
import { MyEventsPage } from './pages/MyEventsPage';
import { PlatformEventsPage } from './pages/platform/PlatformEventsPage';
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
import { ClaimProfilePage } from './pages/ClaimProfilePage';
import { TestLoginPage } from './auth/TestLoginPage';
import { WelcomePage } from './pages/WelcomePage';
import { NewEventPage } from './pages/NewEventPage';
import { TeamManagerPage } from './pages/TeamManagerPage';
import { TeamPage } from './pages/TeamPage';
import { TeamEditPage } from './pages/TeamEditPage';
import { TeamsPage } from './pages/TeamsPage';
import { OrganizationPage, OrganizationsPage } from './pages/OrganizationPages';
import { PlatformFightersPage, PlatformHomePage, PlatformOrganizationsPage } from './pages/platform/PlatformPages';
import { PlatformActivityPage, PlatformBugsPage } from './pages/platform/AdminInsights';
import { ArenaPage } from './pages/arena/ArenaPage';
import { CounterPage } from './pages/lyst/CounterPage';
import { BroadcastPage } from './pages/broadcast/BroadcastPage';

export function App() {
  const { pathname, search } = useLocation();
  // Last line of defence for the screens outside the site chrome (venue display, broadcast overlay, counter phone); the chrome has its own.
  return (
    <ErrorBoundary resetKey={pathname + search} fullPage>
    <Routes>
      {/* The venue display lives outside the site chrome: no header, menus or footer on a screen beside the list. */}
      <Route path="events/:eventId/arena" element={<ArenaPage />} />
      <Route path="events/:eventId/arena/:field" element={<ArenaPage />} />
      {/* The broadcast overlay (OBS browser source): public, read-only, no site chrome. */}
      <Route path="broadcast/:eventId" element={<BroadcastPage />} />
      <Route path="broadcast/:eventId/:field" element={<BroadcastPage />} />
      {/* The counter's phone: no site chrome, one screen, one huge button. */}
      <Route path="lyst/join" element={<CounterPage />} />
      <Route path="lyst/join/:code" element={<CounterPage />} />
      <Route path="lyst/counter" element={<CounterPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/new" element={<NewEventPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="my-events" element={<MyEventsPage />} />
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
        <Route path="platform/events" element={<PlatformEventsPage />} />
        <Route path="platform/organizations" element={<PlatformOrganizationsPage />} />
        <Route path="platform/fighters" element={<PlatformFightersPage />} />
        <Route path="platform/analytics" element={<PlatformActivityPage />} />
        <Route path="platform/activity" element={<Navigate to="/platform/analytics" replace />} />
        <Route path="platform/bugs" element={<PlatformBugsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="claim-profile" element={<ClaimProfilePage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="test-login" element={<TestLoginPage />} />
        <Route path="formats" element={<FormatsPage />} />
        <Route path="marshal" element={<MarshalPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
