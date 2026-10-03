import { useState } from 'react';
import { EventRow } from './EventRow';
import { toIndexedSummary } from './EventList';
import { addMonths, eventsInMonth, eventsOnDay, monthGrid, monthLabel, type IndexedEvent } from '../lib/eventFilters';
import { dateRange } from '../lib/dates';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A month of events that stays readable at 390px: small cells with dots, and the day you tap listed underneath (an agenda), so the phone
 * never has to show a tiny desktop grid. Wider screens show the names in the cells.
 */
export function MonthCalendar({ events, year, month, today, onMonth, showRoles = false }: { events: IndexedEvent[]; year: number; month: number; today: string; onMonth: (y: number, m: number) => void; showRoles?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const weeks = monthGrid(year, month, today);
  const inMonth = eventsInMonth(events, year, month).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name));
  const dayList = picked ? eventsOnDay(inMonth, picked) : [];
  const prev = addMonths(year, month, -1), next = addMonths(year, month, 1);
  const t = today.slice(0, 7);
  return (
    <div className="cal" data-testid="month-calendar">
      <div className="cal-head">
        <button type="button" className="btn btn-line" aria-label={`Previous month, ${monthLabel(prev.y, prev.m)}`} onClick={() => { setPicked(null); onMonth(prev.y, prev.m); }}>‹</button>
        <h2 aria-live="polite">{monthLabel(year, month)}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {`${year}-${String(month).padStart(2, '0')}` !== t && <button type="button" className="btn btn-line btn-sm" onClick={() => { setPicked(null); onMonth(Number(t.slice(0, 4)), Number(t.slice(5, 7))); }}>Today</button>}
          <button type="button" className="btn btn-line" aria-label={`Next month, ${monthLabel(next.y, next.m)}`} onClick={() => { setPicked(null); onMonth(next.y, next.m); }}>›</button>
        </div>
      </div>
      <div className="cal-dow" aria-hidden="true">{DOW.map(d => <span key={d}>{d}</span>)}</div>
      <div className="cal-grid" role="grid" aria-label={monthLabel(year, month)}>
        {weeks.flat().map(d => {
          const list = eventsOnDay(inMonth, d.iso);
          return (
            <button key={d.iso} type="button" role="gridcell" className={`cal-day${d.inMonth ? '' : ' out'}${d.today ? ' today' : ''}`} aria-pressed={picked === d.iso}
              aria-label={`${d.iso}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}: ${list.map(e => e.name).join(', ')}` : ''}`}
              onClick={() => setPicked(p => (p === d.iso ? null : d.iso))} disabled={list.length === 0 && picked !== d.iso}>
              <span className="n">{d.day}</span>
              <span className="dots">
                {list.slice(0, 3).map(e => <span key={e.id} className={`dot plain${e.synthetic ? ' test' : e.roles.length ? ' mine' : ''}`} aria-hidden="true" />)}
                {list.slice(0, 2).map(e => <span key={`l${e.id}`} className={`dot lbl${e.synthetic ? ' test' : e.roles.length ? ' mine' : ''}`} aria-hidden="true">{e.name}</span>)}
                {list.length > 3 && <span className="more">+{list.length - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="agenda" aria-live="polite">
        {picked && (
          <>
            <h3>{dateRange(picked, picked)}</h3>
            {dayList.length === 0 ? <p className="muted">Nothing on this day.</p> : <div className="eventlist">{dayList.map(e => <EventRow key={e.id} e={toIndexedSummary(e, showRoles)} />)}</div>}
          </>
        )}
        <h3>{picked ? 'Everything in' : 'Agenda for'} {monthLabel(year, month)}</h3>
        {inMonth.length === 0
          ? <p className="muted">No events this month. Try the next one, or the Events list for everything coming up.</p>
          : <div className="eventlist">{inMonth.map(e => <EventRow key={e.id} e={toIndexedSummary(e, showRoles)} />)}</div>}
      </div>
    </div>
  );
}
