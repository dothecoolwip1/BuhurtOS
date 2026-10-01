import { Route, Routes } from 'react-router-dom';
import { AdminLayout } from './admin/AdminLayout';
import { CheckinPage, CompetitionsPage, OverviewPage, PeoplePage, RegistrationPage, RunPage, SetupPage } from './admin/pages';
import { Layout } from './components/Layout';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
import { FormatsPage } from './pages/FormatsPage';
import { HomePage } from './pages/HomePage';
import { MarshalPage } from './pages/MarshalPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RulesPage } from './pages/RulesPage';

export function App() {
  return (
    <Routes>
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="competitions" element={<CompetitionsPage />} />
        <Route path="registration" element={<RegistrationPage />} />
        <Route path="checkin" element={<CheckinPage />} />
        <Route path="run" element={<RunPage />} />
        <Route path="people" element={<PeoplePage />} />
      </Route>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:eventId" element={<EventPage />} />
        <Route path="formats" element={<FormatsPage />} />
        <Route path="marshal" element={<MarshalPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
