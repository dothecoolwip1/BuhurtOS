import { EventRow } from './EventRow';
import { toSummary } from './EventSummaryMap';
import { eventAttention, eventGroup, GROUP_LABEL, groupEvents, ROLE_LABEL, type EventGroup, type IndexedEvent } from '../lib/eventFilters';
import type { EventSummary } from '../data/types';

/** The row shape every view shows: organization, what a draft still needs, and (on My events) the viewer's roles. */
export function toIndexedSummary(e: IndexedEvent, showRoles = false): EventSummary {
  const s = toSummary(e);
  const badges = [...s.badges];
  if (e.orgLabel) badges.push({ tone: 'steel', label: e.orgEnabled ? e.orgLabel : `${e.orgLabel} (inactive)` });
  const attention = eventAttention(e);
  if (attention) badges.push({ tone: 'live', label: attention });
  if (showRoles) for (const r of e.roles) badges.push({ tone: 'brass', label: ROLE_LABEL[r] });
  return { ...s, badges };
}

/** A flat list in the shared order, or grouped under Happening now / Upcoming / Drafts / Past. */
export function EventList({ events, today, grouped = false, showRoles = false, empty }: { events: IndexedEvent[]; today: string; grouped?: boolean; showRoles?: boolean; empty: React.ReactNode }) {
  if (events.length === 0) return <>{empty}</>;
  if (!grouped) {
    return <div className="eventlist" data-testid="event-list">{events.map(e => <EventRow key={e.id} e={toIndexedSummary(e, showRoles)} />)}</div>;
  }
  const g = groupEvents(events, today);
  const order: EventGroup[] = ['now', 'upcoming', 'drafts', 'past'];
  return (
    <div style={{ display: 'grid', gap: 18 }} data-testid="event-list">
      {order.filter(k => g[k].length > 0).map(k => (
        <section key={k} aria-labelledby={`grp-${k}`} style={{ display: 'grid', gap: 10 }}>
          <h2 id={`grp-${k}`} style={{ fontSize: 20, margin: 0 }}>{GROUP_LABEL[k]} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>({g[k].length})</span></h2>
          <div className="eventlist">{g[k].map(e => <EventRow key={e.id} e={toIndexedSummary(e, showRoles)} />)}</div>
        </section>
      ))}
    </div>
  );
}

export { eventGroup };
