import { useParams } from 'react-router-dom';
import { EVENTS } from '../data/fixtures';
import { useSampleMode } from '../data/mode';
import { EventPage } from './EventPage';
import { EventWorkspace } from './EventWorkspace';
import type { PublicView } from '../lib/eventPhaseView';

/** Real events open the workspace on the view asked for (or the one the event's phase leads with). The invented sample hubs open only in sample mode. */
export function EventRoute({ view }: { view?: PublicView }) {
  const { eventId = '' } = useParams();
  const sample = useSampleMode();
  return sample && EVENTS.some(e => e.id === eventId) ? <EventPage /> : <EventWorkspace view={view} />;
}
