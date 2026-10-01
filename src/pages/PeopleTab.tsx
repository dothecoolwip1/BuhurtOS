import { useState } from 'react';
import { addStaff, fetchStaff, removeStaff, type StaffMember } from '../data/setup';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';

const ROLES: [StaffMember['role'], string, string][] = [
  ['organizer', 'Organizer', 'Runs the event: review, check-in, setup, people.'],
  ['marshal', 'Marshal', 'Scores fights.'],
  ['scorekeeper', 'Scorekeeper', 'Enters the agreed result of each fight.'],
  ['medic', 'Medic', 'Can read the check-in list and medical notes.']
];
const roleName = (r: string) => ROLES.find(([k]) => k === r)?.[1] ?? r;

export function PeopleTab({ eventId, myUserId }: { eventId: string; myUserId: string | undefined }) {
  const [key, setKey] = useState(0);
  const staff = useAsync(() => fetchStaff(eventId), [eventId, key]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('marshal');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); setKey(k => k + 1); } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); }
  };
  const organizers = (staff.data ?? []).filter(s => s.role === 'organizer').length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <form className="panel info" style={{ display: 'grid', gap: 12 }} onSubmit={e => { e.preventDefault(); void run(async () => { await addStaff(eventId, email, role); setEmail(''); }, 'Added.'); }}>
        <h3>Add someone</h3>
        <p className="src">They need to have signed in to BuhurtOS once, with this email address, before you can add them.</p>
        <label className="field-in">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></label>
        <label className="field-in">Role
          <select value={role} onChange={e => setRole(e.target.value as StaffMember['role'])}>{ROLES.map(([k, n, d]) => <option key={k} value={k}>{n}: {d}</option>)}</select>
        </label>
        <button type="submit" className="btn btn-ink" disabled={busy || !email.includes('@')}>Add</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--win)' : 'var(--live)' }}>{msg.text}</p>}
      </form>
      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="staff-h">
        <h3 id="staff-h">Who has access</h3>
        {staff.loading && <p className="muted">Loading…</p>}
        {staff.error != null && <p role="alert">{friendlyError(staff.error, 'Could not load the list.')}</p>}
        {!staff.loading && (staff.data ?? []).length === 0 && <p className="muted">Nobody has been added to this event yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {(staff.data ?? []).map(s => {
            const lastOrganizer = s.role === 'organizer' && organizers <= 1;
            return (
              <li key={`${s.userId}:${s.role}`} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ overflowWrap: 'anywhere' }}><b>{s.email}</b> · {roleName(s.role)}{s.userId === myUserId ? ' (you)' : ''}</span>
                <button type="button" className="btn btn-line" disabled={busy || lastOrganizer} title={lastOrganizer ? 'An event needs at least one organizer' : undefined}
                  onClick={() => run(() => removeStaff(eventId, s.userId, s.role), 'Removed.')}>Remove</button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
