import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { FocusLayout } from './components/FocusLayout';
import { isDeviceMode } from './lib/deviceSession';
import { lazyPage } from './lib/lazyPage';
import { PageLoading } from './components/PageLoading';

// Every screen is its own download, fetched when it is first opened (see lib/lazyPage).
const FieldPage = lazyPage(() => import('./pages/FieldPage'), 'FieldPage');
const EventRoute = lazyPage(() => import('./pages/EventRoute'), 'EventRoute');
const EventsPage = lazyPage(() => import('./pages/EventsPage'), 'EventsPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const MyEventsPage = lazyPage(() => import('./pages/MyEventsPage'), 'MyEventsPage');
const PlatformEventsPage = lazyPage(() => import('./pages/platform/PlatformEventsPage'), 'PlatformEventsPage');
const FighterPage = lazyPage(() => import('./pages/FighterPage'), 'FighterPage');
const ProfileEditPage = lazyPage(() => import('./pages/ProfileEditPage'), 'ProfileEditPage');
const FightersPage = lazyPage(() => import('./pages/FightersPage'), 'FightersPage');
const RankingsPage = lazyPage(() => import('./pages/RankingsPage'), 'RankingsPage');
const FormatsPage = lazyPage(() => import('./pages/FormatsPage'), 'FormatsPage');
const HomePage = lazyPage(() => import('./pages/HomePage'), 'HomePage');
const MarshalPage = lazyPage(() => import('./pages/MarshalPage'), 'MarshalPage');
const PrivacyPage = lazyPage(() => import('./pages/PrivacyPage'), 'PrivacyPage');
const NotFoundPage = lazyPage(() => import('./pages/NotFoundPage'), 'NotFoundPage');
const RulesPage = lazyPage(() => import('./pages/RulesPage'), 'RulesPage');
const RuleDocPage = lazyPage(() => import('./pages/rules/RuleDocPage'), 'RuleDocPage');
const RulePage = lazyPage(() => import('./pages/rules/RulePage'), 'RulePage');
const RegisterPage = lazyPage(() => import('./registration/RegisterPage'), 'RegisterPage');
const EventControlPage = lazyPage(() => import('./pages/control/EventControlPage'), 'EventControlPage');
const CommandRedirect = lazyPage(() => import('./pages/control/LegacyRedirects'), 'CommandRedirect');
const ManageRedirect = lazyPage(() => import('./pages/control/LegacyRedirects'), 'ManageRedirect');
const AccountPage = lazyPage(() => import('./auth/AccountPage'), 'AccountPage');
const ResetPasswordPage = lazyPage(() => import('./auth/AuthPages'), 'ResetPasswordPage');
const SignInPage = lazyPage(() => import('./auth/AuthPages'), 'SignInPage');
const ClaimProfilePage = lazyPage(() => import('./pages/ClaimProfilePage'), 'ClaimProfilePage');
const TestLoginPage = lazyPage(() => import('./auth/TestLoginPage'), 'TestLoginPage');
const WelcomePage = lazyPage(() => import('./pages/WelcomePage'), 'WelcomePage');
const NewEventPage = lazyPage(() => import('./pages/NewEventPage'), 'NewEventPage');
const TeamManagerPage = lazyPage(() => import('./pages/TeamManagerPage'), 'TeamManagerPage');
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage');
const TeamEditPage = lazyPage(() => import('./pages/TeamEditPage'), 'TeamEditPage');
const ClubMembershipPage = lazyPage(() => import('./pages/ClubMembershipPage'), 'ClubMembershipPage');
const TeamsPage = lazyPage(() => import('./pages/TeamsPage'), 'TeamsPage');
const OrganizationPage = lazyPage(() => import('./pages/OrganizationPages'), 'OrganizationPage');
const OrganizationsPage = lazyPage(() => import('./pages/OrganizationPages'), 'OrganizationsPage');
const PlatformFightersPage = lazyPage(() => import('./pages/platform/PlatformPages'), 'PlatformFightersPage');
const PlatformHomePage = lazyPage(() => import('./pages/platform/PlatformPages'), 'PlatformHomePage');
const PlatformOrganizationsPage = lazyPage(() => import('./pages/platform/PlatformPages'), 'PlatformOrganizationsPage');
const PlatformActivityPage = lazyPage(() => import('./pages/platform/AdminInsights'), 'PlatformActivityPage');
const PlatformBugsPage = lazyPage(() => import('./pages/platform/AdminInsights'), 'PlatformBugsPage');
const PlatformRulesPage = lazyPage(() => import('./pages/platform/PlatformRulesPage'), 'PlatformRulesPage');
const PlatformDevicesPage = lazyPage(() => import('./pages/platform/PlatformDevicesPage'), 'PlatformDevicesPage');
const ArenaPage = lazyPage(() => import('./pages/arena/ArenaPage'), 'ArenaPage');
const CounterPage = lazyPage(() => import('./pages/lyst/CounterPage'), 'CounterPage');
const BroadcastPage = lazyPage(() => import('./pages/broadcast/BroadcastPage'), 'BroadcastPage');
const CheckinDeskPage = lazyPage(() => import('./pages/CheckinDeskPage'), 'CheckinDeskPage');
const DisciplineLogPage = lazyPage(() => import('./pages/DisciplineLogPage'), 'DisciplineLogPage');
const AnnouncerPage = lazyPage(() => import('./pages/AnnouncerPage'), 'AnnouncerPage');
const DeviceSignInPage = lazyPage(() => import('./pages/DeviceSignInPage'), 'DeviceSignInPage');
const DeviceApp = lazyPage(() => import('./DeviceApp'), 'DeviceApp');

/** A temporary event device (Pack 18.1) runs its own small app; a person's account runs the site. Chosen once per page load: switching is a full page load. */
export function App() {
  return isDeviceMode() ? <Suspense fallback={<PageLoading />}><DeviceApp /></Suspense> : <SiteApp />;
}

function SiteApp() {
  const { pathname, search } = useLocation();
  // Last line of defence for the screens outside the site chrome (venue display, broadcast overlay, counter phone); the chrome has its own.
  return (
    <ErrorBoundary resetKey={pathname + search} fullPage>
    <Suspense fallback={<PageLoading />}>
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
    </Suspense>
    </ErrorBoundary>
  );
}
