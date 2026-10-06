import { useState } from 'react';
import { usePoll } from './hooks';
import { fetchStaffNames, grantRole, removeRole } from '../../data/devices';
import { staffRoleChoices, staffRoleWord } from '../../lib/devices';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import '../../styles/command181.css';

/**
 * Who works this event, by NAME (never an email: the database does not return one for this list), for the people who may run the day: the event's
 * organizer and a Temporary Organizer. Add by email (the person must have signed in to BuhurtOS once), remove with one tap. A Temporary Organizer may
 * hand out every role except Organizer; the database refuses that, and the list of roles offered here leaves it out.
 */
export function StaffNamesPanel({ eventId, viewerIsOrganizer, refreshKey }: { eventId: string; viewerIsOrganizer: boolean; refreshKey: number }) {
  const [key, setKey] = useState(0);
  const staff = useAsync(() => fetchStaffNames(eventId), [eventId], [refreshKey, key]);
  usePoll(20_000, () => setKey(k => k + 1));
  const choices = staffRoleChoices(viewerIsOrganizer);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('marshal');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: friendlyError(e, 'That did not work. Try again.') }); } finally { setBusy(false); setKey(k => k + 1); }
  };
  const rows = staff.data ?? [];
  const lastOrganizer = rows.filter(r => r.role === 'organizer').length <= 1;

  return (
    <div className="staff-names" data-testid="staff-names">
      {staff.error != null && !staff.data && <p role="alert">{friendlyError(staff.error, 'Could not load the staff.')} <button type="button" className="linklike" onClick={() => staff.reload()}>Try again</button></p>}
      {staff.data && rows.length === 0 && <p className="cc-empty">Nobody is assigned to this event yet.</p>}
      {rows.length > 0 && (
        <ul className="staff-list">
          {rows.map(r => (
            <li key={`${r.userId}:${r.role}`} data-testid="staff-row">
              <span className="staff-who"><b>{r.name}</b> <span className="src">{staffRoleWord(r.role)}</span></span>
              <button type="button" className="btn btn-line btn-sm" disabled={busy || (r.role === 'organizer' && (lastOrganizer || !viewerIsOrganizer))} aria-label={`Remove ${r.name} as ${staffRoleWord(r.role)}`}
                title={r.role === 'organizer' ? (viewerIsOrganizer ? (lastOrganizer ? 'An event needs at least one organizer' : undefined) : 'Only an organizer can remove an organizer') : undefined}
                onClick={() => void run(() => removeRole(eventId, r.userId, r.role), `Removed ${r.name} as ${staffRoleWord(r.role)}.`)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form className="staff-add" onSubmit={e => { e.preventDefault(); void run(async () => { await grantRole(eventId, email, role); setEmail(''); }, `Added as ${staffRoleWord(role)}.`); }}>
        <h3>Add someone</h3>
        <p className="src">They must have signed in to BuhurtOS once with this email address.</p>
        <label className="field-in">Email<input type="email" required value={email} autoComplete="off" onChange={e => { setEmail(e.target.value); setMsg(null); }} /></label>
        <label className="field-in">Role
          <select value={role} onChange={e => setRole(e.target.value)}>{choices.map(c => <option key={c} value={c}>{staffRoleWord(c)}</option>)}</select>
        </label>
        <button type="submit" className="btn btn-line cc-btn" disabled={busy || !email.includes('@')}>Add</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'dev-ok' : 'err'}>{msg.text}</p>}
      </form>
    </div>
  );
}
