import { useState } from 'react';
import type { LiveEvent } from '../data/api';
import { googleCalendarUrl, icsForEvent } from '../lib/eventFilters';

type E = Pick<LiveEvent, 'id' | 'name' | 'slug' | 'startsOn' | 'endsOn' | 'venue' | 'address' | 'city' | 'region'>;

/** "Add to calendar": Google Calendar link, or an .ics file (Apple, Outlook, the phone's own calendar). All-day, plain dates. */
export function AddToCalendar({ event }: { event: E }) {
  const [open, setOpen] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://buhurtos.ca';
  const download = () => {
    const blob = new Blob([icsForEvent(event, origin)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${event.slug}.ics`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" className="btn btn-line btn-sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>Add to calendar</button>
      {open && (
        <span className="calexport" role="group" aria-label="Add to calendar">
          <a className="btn btn-line btn-sm" href={googleCalendarUrl(event, origin)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
          <button type="button" className="btn btn-line btn-sm" onClick={download}>Apple / Outlook (.ics)</button>
        </span>
      )}
    </span>
  );
}
