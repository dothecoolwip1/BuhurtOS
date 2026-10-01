import { useMemo, useState } from 'react';
import { saveMatchSchedule } from '../data/runSchedule';
import { localToIso } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { DEFAULT_DURATION, parseDuration, parseFields, planEnd, planSchedule, timeLabel, type SlotInput } from '../lib/runSchedule';

const errorStyle = { color: 'var(--live)' } as const;

/** "Schedule this competition from <start> every <n> minutes on <fields>". Clashes are not checked here; they show up in Needs attention. */
export function BulkSchedule({ matches, timeZone, onDone }: { matches: SlotInput[]; timeZone: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('');
  const [every, setEvery] = useState(String(DEFAULT_DURATION));
  const [fieldText, setFieldText] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const everyN = parseDuration(every);
  const startIso = start ? localToIso(start, timeZone) : null;
  const fields = useMemo(() => parseFields(fieldText), [fieldText]);
  const slots = useMemo(() => (startIso && everyN ? planSchedule(matches, startIso, everyN, fields, onlyNew) : []), [matches, startIso, everyN, fields, onlyNew]);
  const end = startIso && everyN ? planEnd(slots, everyN) : null;

  if (!open) return <button type="button" className="btn btn-line" onClick={() => setOpen(true)}>Schedule all matches at once</button>;

  const apply = async () => {
    if (!everyN) return;
    setBusy(true); setError(null);
    try {
      for (const s of slots) await saveMatchSchedule(s.matchId, { scheduledAt: s.scheduledAt, field: s.field, durationMinutes: everyN });
      setOpen(false); onDone();
    } catch (e) { setError(friendlyError(e, 'Could not save the schedule. Some matches may already have their new times.')); onDone(); } finally { setBusy(false); }
  };

  return (
    <div className="panel info" style={{ display: 'grid', gap: 8 }} role="group" aria-label="Schedule this competition">
      <h4>Schedule this competition</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="field-in" style={{ flex: '2 1 200px' }}>From (event time)
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="field-in" style={{ flex: '1 1 110px' }}>Every (minutes)
          <input inputMode="numeric" value={every} aria-invalid={everyN === null} onChange={e => setEvery(e.target.value)} />
        </label>
      </div>
      <label className="field-in">On these fields (separate with commas, or leave empty)
        <input value={fieldText} placeholder="Field 1, Field 2" onChange={e => setFieldText(e.target.value)} />
      </label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
        <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} /> Keep matches that already have a time
      </label>
      {everyN === null && <p role="alert" style={errorStyle}>Every must be a whole number of minutes, 1 to 720.</p>}
      {startIso && slots.length > 0 && end && (
        <p>{slots.length} {slots.length === 1 ? 'match' : 'matches'}, from {timeLabel(slots[0].scheduledAt, timeZone)} to about {timeLabel(end, timeZone)}
          {fields.length > 1 ? `, ${fields.length} at a time` : ''}. Each match is given {everyN} minutes.</p>
      )}
      {startIso && slots.length === 0 && everyN !== null && <p className="src">There are no matches to schedule.</p>}
      <p className="src">This does not check for double-booked fighters. If someone is booked twice, it shows under Needs attention at the top.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ink" disabled={busy || !startIso || slots.length === 0 || everyN === null} onClick={apply}>{busy ? 'Saving…' : `Set ${slots.length} times`}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p role="alert" style={errorStyle}>{error}</p>}
    </div>
  );
}
