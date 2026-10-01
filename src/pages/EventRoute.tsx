import { useParams } from 'react-router-dom';
import { EVENTS } from '../data/fixtures';
import { useSampleMode } from '../data/mode';
import { EventPage } from './EventPage';
import { EventWorkspace } from './EventWorkspace';

/** Real events open the workspace. The invented sample hubs open only in sample mode. */
export function EventRoute() {
  const { eventId = '' } = useParams();
  const sample = useSampleMode();
  return sample && EVENTS.some(e => e.id === eventId) ? <EventPage /> : <EventWorkspace />;
}
