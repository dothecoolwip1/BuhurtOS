import { Link, useParams } from 'react-router-dom';
import { CommandEntry, DeskEntry } from '../components/DeskEntry';
import { ScorekeepingPanel } from '../components/ScorekeepingPanel';
import { PageHead } from '../components/ui';
import { fetchEvent } from '../data/api';
import { deviceRoles, storedWhoami } from '../lib/deviceSession';
import { isOperatorRole, roleLabel } from '../lib/deviceRoutes';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * The home of a temporary event device (Pack 18.1): the marshal's field picker, and for the other roles a short list of the screens that device may open.
 * It reads only public event data plus what the device's own session says (no staff, registration or account tables, which a device cannot read).
 * What each button does is checked again by the database.
 */
export function DeviceHome() {
  const { eventId: slug = '' } = useParams();
  const w = storedWhoami();
  const ev = useAsync(() => fetchEvent(slug), [slug]);
  useDocumentTitle(w ? w.event.name : 'Event');
  if (!w || w.event.slug !== slug) return null;   // the route guard has already sent a device away from another event
  const roles = [...deviceRoles(w), ...(isOperatorRole(w.role) ? ['operator'] : [])];
  const e = `/events/${encodeURIComponent(slug)}`;
  return (
    <section className="device-home fade-in" data-testid="device-home">
      <PageHead eyebrow={roleLabel(w.role)} title={w.event.name} lede={w.role === 'marshal' ? 'Open the field you are marshalling.' : undefined} />
      {ev.loading && !ev.data && <p className="muted" role="status">Loading…</p>}
      {ev.error != null && <p role="alert">{friendlyError(ev.error, 'Could not load this event. It may not be public yet, or there is no signal.')}</p>}
      {ev.data && <ScorekeepingPanel slug={slug} competitions={ev.data.competitions} roles={roles} />}
      <CommandEntry slug={slug} roles={roles} />
      <DeskEntry slug={slug} roles={roles} />
      {w.role === 'scorekeeper' && (
        <section className="panel info" style={{ display: 'grid', gap: 10 }}>
          <h3>Command Centre</h3>
          <p className="src">What needs attention right now. Read only.</p>
          <p><Link className="btn btn-ink" to={`${e}/command`}>Open the Command Centre</Link></p>
        </section>
      )}
      {w.role === 'announcer' && <p><Link className="btn btn-ink fq-big" to={`${e}/announcer`}>Open the announcer view</Link></p>}
      <p><Link className="btn btn-line" to={`${e}/arena`}>Live display of the fields</Link></p>
    </section>
  );
}
