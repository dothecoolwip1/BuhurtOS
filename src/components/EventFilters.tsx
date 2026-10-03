import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { eventTypeLabel } from '../data/eventTypes';
import { activeFilterCount, DEFAULT_FILTER, FORMAT_FILTERS, ROLE_FILTERS, STATUS_FILTERS, type EventFilter } from '../lib/eventFilters';
import type { OrgLite } from '../lib/careerView';
import { orgOptionLabel } from '../lib/careerView';
import { PROVINCES } from '../registration/model';
import { Seg } from './ui';

const regionName = (code: string) => PROVINCES.find(([k]) => k === code)?.[1] ?? code;

/** Events, Calendar and My events are three views of the same events. One switch moves between them and keeps the filters. */
export function EventViewSwitch({ signedIn }: { signedIn: boolean }) {
  const { pathname, search } = useLocation();
  const views: Array<[string, string]> = [['/events', 'Events'], ['/calendar', 'Calendar'], ...(signedIn ? [['/my-events', 'My events'] as [string, string]] : [])];
  return (
    <nav className="seg" role="group" aria-label="View">
      {views.map(([to, label]) => <Link key={to} to={`${to}${search}`} aria-current={pathname === to ? 'page' : undefined} className="seglink" style={{ padding: '8px 14px', borderRadius: 999, fontSize: 14, fontWeight: 600, color: pathname === to ? 'var(--ink)' : 'var(--muted)', background: pathname === to ? 'var(--raised)' : 'transparent', boxShadow: pathname === to ? 'var(--shadow)' : 'none', textDecoration: 'none' }}>{label}</Link>)}
    </nav>
  );
}

export interface FilterOptions { orgs: OrgLite[]; regions: string[]; types: string[] }

/**
 * Search plus a folding filter panel, the same on every view. `mine` adds the role filter; `showTest` offers the test-data toggle
 * (signed-in people only; it is off by default everywhere). `statuses` offers the status filter where drafts can exist.
 */
export function EventFilters({ value, onChange, options, defaults = {}, mine = false, showTest = false, statuses = false, placeholder = 'Search events, venues, cities, organizations' }: {
  value: EventFilter; onChange: (f: EventFilter) => void; options: FilterOptions; defaults?: Partial<EventFilter>; mine?: boolean; showTest?: boolean; statuses?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(value, defaults);
  const set = <K extends keyof EventFilter>(k: K, v: EventFilter[K]) => onChange({ ...value, [k]: v });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="evsearch">
        <label className="field-in">Search events
          <input type="search" inputMode="search" autoComplete="off" placeholder={placeholder} value={value.q} onChange={e => set('q', e.target.value)} data-testid="event-search" />
        </label>
        <button type="button" className={`btn ${open || n > 0 ? 'btn-ink' : 'btn-line'}`} style={{ minHeight: 48 }} aria-expanded={open} aria-controls="event-filter-panel" onClick={() => setOpen(o => !o)} data-testid="toggle-filters">
          Filters{n > 0 ? ` (${n})` : ''}
        </button>
      </div>
      <Seg label="When" value={value.when} options={[['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']] as const} onChange={v => set('when', v)} />
      {open && (
        <div id="event-filter-panel" className="panel filterpanel">
          <label className="field-in">Format
            <select value={value.format} onChange={e => set('format', e.target.value as EventFilter['format'])}>{FORMAT_FILTERS.map(([k, n2]) => <option key={k} value={k}>{n2}</option>)}</select>
          </label>
          <label className="field-in">Event type
            <select value={value.type} onChange={e => set('type', e.target.value)}><option value="">Any type</option>{options.types.map(t => <option key={t} value={t}>{eventTypeLabel(t)}</option>)}</select>
          </label>
          <label className="field-in">Organization
            <select value={value.org} onChange={e => set('org', e.target.value)}><option value="">Any organization</option>{options.orgs.map(o => <option key={o.id} value={o.id}>{orgOptionLabel(o)}</option>)}</select>
          </label>
          <label className="field-in">Province or state
            <select value={value.region} onChange={e => set('region', e.target.value)}><option value="">Anywhere</option>{options.regions.map(r => <option key={r} value={r}>{regionName(r)}</option>)}</select>
          </label>
          {statuses && (
            <label className="field-in">Status
              <select value={value.status} onChange={e => set('status', e.target.value as EventFilter['status'])}>{STATUS_FILTERS.map(([k, n2]) => <option key={k} value={k}>{n2}</option>)}</select>
            </label>
          )}
          {mine && (
            <label className="field-in">My role
              <select value={value.role} onChange={e => set('role', e.target.value as EventFilter['role'])} data-testid="role-filter"><option value="">Any role</option>{ROLE_FILTERS.map(([k, n2]) => <option key={k} value={k}>{n2}</option>)}</select>
            </label>
          )}
          {showTest && (
            <label className="toggle"><input type="checkbox" checked={value.test} onChange={e => set('test', e.target.checked)} data-testid="show-test" /> Show test data (fictional events)</label>
          )}
          {n > 0 && <div style={{ alignSelf: 'end' }}><button type="button" className="btn btn-line" onClick={() => onChange({ ...DEFAULT_FILTER, ...defaults, q: value.q, when: value.when })}>Clear filters</button></div>}
        </div>
      )}
    </div>
  );
}
