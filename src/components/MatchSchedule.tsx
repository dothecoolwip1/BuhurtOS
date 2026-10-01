import { useEffect, useState } from 'react';
import { fetchFighterBookings } from '../data/conflicts';
import { saveMatchSchedule } from '../data/runSchedule';
import { isoToLocal, localToIso } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { DEFAULT_DURATION, bookingLine, parseDuration, timeLabel, type Person } from '../lib/runSchedule';

const errorStyle = { color: 'var(--live)' } as const;

/** When and where one match is held. Shows a clash with another competition BEFORE saving, and lets the organizer schedule anyway. */
export function MatchSchedule({ eventId, matchId, scheduledAt, field, duration, people, uncheckedSides, timeZone, jump, onSaved }: {
  eventId: string; matchId: string; scheduledAt: string | null; field: string | null; duration: number; people: Person[];
  /** Team sides with no roster yet: their fighters cannot be checked. */
  uncheckedSides: string[]; timeZone: string; jump: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(jump);
  const [when, setWhen] = useState(isoToLocal(scheduledAt, timeZone));
  const [where, setWhere] = useState(field ?? '');
  const [mins, setMins] = useState(String(duration));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => { if (jump) setEditing(true); }, [jump]);

  const minutes = parseDuration(mins);
  const iso = when ? localToIso(when, timeZone) : null;
  const problem = when && !iso ? 'Pick a date and time.' : minutes === null ? 'Length must be a whole number of minutes, 1 to 720.' : null;

  const write = async () => {
    setBusy(true); setError(null);
    try { await saveMatchSchedule(matchId, { scheduledAt: iso, field: where, durationMinutes: minutes ?? DEFAULT_DURATION }); setWarnings(null); setEditing(false); onSaved(); }
    catch (e) { setError(friendlyError(e, 'Could not save the schedule.')); } finally { setBusy(false); }
  };

  const check = async () => {
    if (problem) return;
    if (!iso || people.length === 0) { await write(); return; }
    setBusy(true); setError(null);
    try {
      const found = await Promise.all(people.map(async p => ({ p, rows: await fetchFighterBookings({ eventId, fighterId: p.fighterId, at: iso, minutes: minutes ?? DEFAULT_DURATION, excludeMatchId: matchId }) })));
      const lines = found.flatMap(({ p, rows }) => rows.map(b => bookingLine(p.name, b, timeZone)));
      if (lines.length === 0) { setBusy(false); await write(); return; }
      setWarnings(lines);
    } catch (e) { setError(friendlyError(e, 'Could not check for clashes.')); } finally { setBusy(false); }
  };

  const summary = scheduledAt
    ? `${timeLabel(scheduledAt, timeZone)} for ${duration} min${field ? ` on ${field}` : ''}`
    : field ? `No time yet, on ${field}` : 'No time or field yet';

  if (!editing) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 160px' }}>{summary}</span>
        <button type="button" className="btn btn-line" onClick={() => setEditing(true)}>{scheduledAt ? 'Change time' : 'Set time'}</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 8 }} role="group" aria-label="Schedule this match">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="field-in" style={{ flex: '2 1 200px' }}>Start (event time)
          <input type="datetime-local" value={when} onChange={e => { setWhen(e.target.value); setWarnings(null); }} />
        </label>
        <label className="field-in" style={{ flex: '1 1 120px' }}>Field
          <input value={where} maxLength={40} placeholder="Field 1" onChange={e => setWhere(e.target.value)} />
        </label>
        <label className="field-in" style={{ flex: '1 1 90px' }}>Minutes
          <input inputMode="numeric" value={mins} aria-invalid={minutes === null} onChange={e => { setMins(e.target.value); setWarnings(null); }} />
        </label>
      </div>
      {uncheckedSides.length > 0 && <p className="src">{uncheckedSides.join(' and ')} {uncheckedSides.length === 1 ? 'has' : 'have'} no roster yet, so clashes for {uncheckedSides.length === 1 ? 'that team' : 'those teams'} cannot be checked. Add a roster below.</p>}
      {problem && <p role="alert" style={errorStyle}>{problem}</p>}
      {warnings && (
        <div className="panel info" role="alert" style={{ display: 'grid', gap: 6 }}>
          <b>Double-booking</b>
          <ul style={{ margin: 0, paddingLeft: 20 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" disabled={busy} onClick={write}>Schedule anyway</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setWarnings(null)}>Pick another time</button>
          </div>
        </div>
      )}
      {!warnings && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink" disabled={busy || Boolean(problem)} onClick={check}>{busy ? 'Checking…' : 'Save'}</button>
          {scheduledAt && <button type="button" className="btn btn-line" disabled={busy} onClick={() => { setWhen(''); }} title="Clear the time, then save">Clear time</button>}
          <button type="button" className="btn btn-line" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </div>
  );
}
