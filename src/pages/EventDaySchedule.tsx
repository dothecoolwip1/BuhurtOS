import { groupByDay, parseSchedule } from '../registration/schedule';

/**
 * Event-day times, shown only as the organizer wrote them (time_note and the description). The database has no structured
 * schedule table yet, so nothing here is computed or filled in; a structured schedule is a follow-up.
 */
export function EventDaySchedule({ timeNote, description }: { timeNote: string | null; description: string | null }) {
  const days = groupByDay(parseSchedule(timeNote, description));
  if (days.length === 0) return null;
  return (
    <section className="panel info" aria-labelledby="sched-h" style={{ display: 'grid', gap: 10 }}>
      <h2 id="sched-h">Event-day times</h2>
      {days.map(d => (
        <div key={d.day}>
          <h3>{d.day}</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 6 }}>
            {d.entries.map(e => (
              <li key={e.text} style={{ overflowWrap: 'anywhere' }}>
                <span className="mono" style={{ fontWeight: 600, marginRight: 8 }}>{e.times.join(' – ')}</span>{e.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="src">Times are as announced by the organizers. Check the event page for changes.</p>
    </section>
  );
}
