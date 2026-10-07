import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { FocusLayout } from './components/FocusLayout';
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
import { RuleDocPage } from './pages/rules/RuleDocPage';
import { RulePage } from './pages/rules/RulePage';
import { RegisterPage } from './registration/RegisterPage';
import { EventControlPage } from './pages/control/EventControlPage';
import { CommandRedirect, ManageRedirect } from './pages/control/LegacyRedirects';
import { AccountPage } from './auth/AccountPage';
import { ResetPasswordPage, SignInPage } from './auth/AuthPages';
import { ClaimProfilePage } from './pages/ClaimProfilePage';
import { TestLoginPage } from './auth/TestLoginPage';
import { WelcomePage } from './pages/WelcomePage';
import { NewEventPage } from './pages/NewEventPage';
import { TeamManagerPage } from './pages/TeamManagerPage';
import { TeamPage } from './pages/TeamPage';
import { TeamEditPage } from './pages/TeamEditPage';
import { ClubMembershipPage } from './pages/ClubMembershipPage';
import { TeamsPage } from './pages/TeamsPage';
import { OrganizationPage, OrganizationsPage } from './pages/OrganizationPages';
import { PlatformFightersPage, PlatformHomePage, PlatformOrganizationsPage } from './pages/platform/PlatformPages';
import { PlatformActivityPage, PlatformBugsPage } from './pages/platform/AdminInsights';
import { PlatformRulesPage } from './pages/platform/PlatformRulesPage';
import { PlatformDevicesPage } from './pages/platform/PlatformDevicesPage';
import { ArenaPage } from './pages/arena/ArenaPage';
import { CounterPage } from './pages/lyst/CounterPage';
import { BroadcastPage } from './pages/broadcast/BroadcastPage';
import { CheckinDeskPage } from './pages/CheckinDeskPage';
import { DisciplineLogPage } from './pages/DisciplineLogPage';
import { AnnouncerPage } from './pages/AnnouncerPage';
import { DeviceSignInPage } from './pages/DeviceSignInPage';
import { DeviceApp } from './DeviceApp';
import { isDeviceMode } from './lib/deviceSession';

/** A temporary event device (Pack 18.1) runs its own small app; a person's account runs the site. Chosen once per page load: switching is a full page load. */
export function App() {
  return isDeviceMode() ? <DeviceApp /> : <SiteApp />;
}

function SiteApp() {
  const { pathname, search } = useLocation();
  // Last line of defence for the screens outside the site chrome (venue display, broadcast overlay, counter phone); the chrome has its own.
  return (
    <ErrorBoundary resetKey={pathname + search} fullPage>
    <Routes>
      {/* The venue display lives outside the site chrome: no header, menus or footer on a screen beside the list. */}
      <Route path="events/:eventId/arena" element={<ArenaPage />} />
      <Route path="events/:eventId/arena/:field" element={<ArenaPage />} />
      {/* The announcer's screen: read-only, no site chrome (Pack 18.1). */}
      <Route path="events/:eventId/announcer" element={<AnnouncerPage />} />
      {/* The broadcast overlay (OBS browser source): public, read-only, no site chrome. */}
      <Route path="broadcast/:eventId" element={<BroadcastPage />} />
      <Route path="broadcast/:eventId/:field" element={<BroadcastPage />} />
      {/* The counter's phone: no site chrome, one screen, one huge button. A signed-in trainee joins through the Lyst's training QR (/lyst/train/:code; the old /lyst/join address still works). */}
      <Route path="lyst/train" element={<CounterPage />} />
      <Route path="lyst/train/:code" element={<CounterPage />} />
      <Route path="lyst/join" element={<CounterPage />} />
      <Route path="lyst/join/:code" element={<CounterPage />} />
      <Route path="lyst/counter" element={<CounterPage />} />
      {/* A temporary event device signs in here once with its code (or a QR that opens /device#c=...). Chrome-less; the fragment is removed at start-up. */}
      <Route path="device" element={<DeviceSignInPage />} />
      {/* Live event operation (Pack 24A1): field scoring and the Lyst, the check-in and armour desk. Same URLs; no site chrome, a compact event header with Exit. */}
      <Route element={<FocusLayout />}>
        <Route path="events/:eventId/field/:field" element={<FieldPage />} />
        <Route path="events/:eventId/checkin" element={<CheckinDeskPage />} />
      </Route>
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
        <Route path="teams/:slug/membership" element={<ClubMembershipPage />} />
        <Route path="fighters" element={<FightersPage />} />
        <Route path="fighters/:id" element={<FighterPage />} />
        <Route path="fighters/:id/edit" element={<ProfileEditPage />} />
        <Route path="rankings" element={<RankingsPage />} />
        <Route path="team-manager" element={<TeamManagerPage />} />
        <Route path="events/:eventId" element={<EventRoute />} />
        <Route path="events/:eventId/overview" element={<EventRoute view="overview" />} />
        <Route path="events/:eventId/live" element={<EventRoute view="live" />} />
        <Route path="events/:eventId/results" element={<EventRoute view="results" />} />
        <Route path="events/:eventId/register" element={<RegisterPage />} />
        <Route path="events/:eventId/control" element={<EventControlPage />} />
        <Route path="events/:eventId/manage" element={<ManageRedirect />} />
        <Route path="events/:eventId/command" element={<CommandRedirect />} />
        <Route path="events/:eventId/discipline" element={<DisciplineLogPage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="organizations/:slug" element={<OrganizationPage />} />
        <Route path="platform" element={<PlatformHomePage />} />
        <Route path="platform/events" element={<PlatformEventsPage />} />
        <Route path="platform/organizations" element={<PlatformOrganizationsPage />} />
        <Route path="platform/fighters" element={<PlatformFightersPage />} />
        <Route path="platform/analytics" element={<PlatformActivityPage />} />
        <Route path="platform/activity" element={<Navigate to="/platform/analytics" replace />} />
        <Route path="platform/bugs" element={<PlatformBugsPage />} />
        <Route path="platform/rules" element={<PlatformRulesPage />} />
        <Route path="platform/devices" element={<PlatformDevicesPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="claim-profile" element={<ClaimProfilePage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="test-login" element={<TestLoginPage />} />
        <Route path="formats" element={<FormatsPage />} />
        <Route path="marshal" element={<MarshalPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="rules/doc/:slug" element={<RuleDocPage />} />
        <Route path="rules/r/:id" element={<RulePage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
