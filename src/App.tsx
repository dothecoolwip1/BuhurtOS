import { Route, Routes } from 'react-router-dom';
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
