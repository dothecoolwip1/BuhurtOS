import { useState } from 'react';
import { Dialog } from '../Dialog';
import { Chip } from '../ui';
import { CommandSection } from './CommandSection';
import { DeviceCodeSheet, type CodeItem } from './DeviceCodeSheet';
import { useNow, usePoll } from './hooks';
import { createCredential, fetchCredentials, replaceCredential, revokeAllDevices, revokeCredential, type NewCode } from '../../data/devices';
import {
  CONTROLLER_LABEL, DEVICE_ROLES, LABEL_MAX, ROLE_HINTS, USUAL_SET, accessEndsLabel, lastSeenLabel, roleWord, signedInElsewhereLabel, splitCredentials, statusWord, usualSetToCreate,
  type Credential, type DeviceRole
} from '../../lib/devices';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import '../../styles/command181.css';

type Reveal = { title: string; items: CodeItem[]; notes: string[] };
type Confirm = { kind: 'revoke' | 'replace'; c: Credential } | { kind: 'all'; n: number };
const toItem = (n: NewCode): CodeItem => ({ label: n.credential.label, role: n.credential.role, code: n.code, expiresAt: n.credential.expiresAt });

/**
 * Event devices (the event's permanent organizer only: the database refuses everyone else, a Temporary Organizer included).
 * Make a code for a device, replace one, revoke one, sign every temporary device out, and the stream laptop's own code. A code is shown once, in a
 * sheet, and lives nowhere else: not in storage, not in the list, not in this component once the sheet is closed.
 */
export function DevicesPanel({ eventId, eventName, timezone, refreshKey }: { eventId: string; eventName: string; timezone: string; refreshKey: number }) {
  const [key, setKey] = useState(0);
  const list = useAsync(() => fetchCredentials(eventId), [eventId], [refreshKey, key]);
  usePoll(10_000, () => setKey(k => k + 1));
  const now = useNow(15_000);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<DeviceRole>('counter');
  const refresh = () => setKey(k => k + 1);

  const rows = list.data ?? [];
  const { devices, pastDevices, controller, pastControllers } = splitCredentials(rows);
  const past = [...pastDevices, ...pastControllers];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: friendlyError(e, 'That did not work. Check your signal and try again.') }); } finally { setBusy(false); refresh(); }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    if (!name) { setMsg({ ok: false, text: 'Give the device a name, for example "Secretary Tablet".' }); return; }
    void run(async () => {
      const n = await createCredential(eventId, 'device', name, role);
      setLabel('');
      setReveal({ title: `Code for ${n.credential.label}`, items: [toItem(n)], notes: [] });
    });
  };
  const createController = () => run(async () => {
    const n = await createCredential(eventId, 'controller', CONTROLLER_LABEL, 'broadcast_controller');
    setReveal({ title: 'Code for the stream laptop', items: [toItem(n)], notes: [] });
  });
  const usualSet = () => run(async () => {
    const { toCreate, skipped } = usualSetToCreate(rows);
    const made: CodeItem[] = [];
    const notes: string[] = [];
    if (skipped.length) notes.push(`Already set up, no new code made: ${skipped.join(', ')}.`);
    try {
      for (const d of toCreate) made.push(toItem(await createCredential(eventId, 'device', d.label, d.role)));
    } catch (e) {
      notes.push(`Stopped early: ${friendlyError(e, 'something went wrong')} Make the missing devices one at a time.`);
    }
    if (made.length) setReveal({ title: `${made.length} device ${made.length === 1 ? 'code' : 'codes'}`, items: made, notes });
    else setMsg({ ok: notes.length > 0 && skipped.length === USUAL_SET.length, text: notes.join(' ') || 'No device codes were made.' });
  });
  const doConfirm = () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    void run(async () => {
      if (c.kind === 'revoke') { await revokeCredential(c.c.id); setMsg({ ok: true, text: `${c.c.label} is signed out and its code no longer works.` }); }
      else if (c.kind === 'replace') {
        const n = await replaceCredential(c.c.id);
        setReveal({ title: `New code for ${n.credential.label}`, items: [toItem(n)], notes: ['The old code, and any device signed in with it, stopped working just now.'] });
      } else { const n = await revokeAllDevices(eventId); setMsg({ ok: true, text: n === 1 ? '1 temporary device signed out.' : `${n} temporary devices signed out.` }); }
    });
  };

  const tz = timezone;
  const activeCount = devices.length + (controller ? 1 : 0);
  return (
    <CommandSection id="cc-devices" title="Event devices" count={activeCount} countLabel="active">
      <p className="src">Temporary devices sign in with a code you make here: no account, no email. Each code is shown once. Access ends 24 hours after the event.</p>
      {list.error != null && !list.data && <p role="alert">{friendlyError(list.error, 'Could not load the devices.')} <button type="button" className="linklike" onClick={() => list.reload()}>Try again</button></p>}
      {list.refreshError != null && <p className="src" role="status">Not updating. Showing the last list.</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'dev-ok' : 'err'}>{msg.text}</p>}

      <div className="dev-bar">
        <button type="button" className="btn btn-ink cc-btn" disabled={busy} onClick={() => void usualSet()}>Add the usual set for an event</button>
        <p className="src">Secretary Tablet, Marshal Phone, Announcer Tablet, Event Admin Tablet. All the codes come up together to print. Counter phones need no code of their own: they scan the event's Counter QR.</p>
      </div>

      <form className="dev-form" onSubmit={create} noValidate>
        <h3>Add one device</h3>
        <label className="field-in">Name
          <input value={label} maxLength={LABEL_MAX} placeholder="Second Secretary Tablet" autoComplete="off" onChange={e => { setLabel(e.target.value); setMsg(null); }} />
        </label>
        <label className="field-in">Role
          <select value={role} onChange={e => setRole(e.target.value as DeviceRole)}>{DEVICE_ROLES.map(r => <option key={r} value={r}>{roleWord(r)}</option>)}</select>
        </label>
        <p className="src">{ROLE_HINTS[role]}</p>
        <button type="submit" className="btn btn-line cc-btn" disabled={busy || !label.trim()}>Make a code</button>
      </form>

      <div className="cc-sub">
        <h3>Temporary devices</h3>
        {list.loading && !list.data ? <p className="src">Loading…</p> : devices.length === 0 ? <p className="cc-empty">No device codes are active.</p> : (
          <ul className="dev-list">{devices.map(c => <Row key={c.id} c={c} tz={tz} now={now} busy={busy} onConfirm={setConfirm} />)}</ul>
        )}
        {devices.length > 0 && <p><button type="button" className="btn btn-bad cc-btn" disabled={busy} onClick={() => setConfirm({ kind: 'all', n: devices.length })}>Sign out all temporary devices</button></p>}
      </div>

      <div className="cc-sub">
        <h3>Stream laptop (OBS controller)</h3>
        <p className="src">The computer that runs OBS signs in with its own code. It can report its status and read the control; it cannot score or change anything else. One per event.</p>
        {controller ? <ul className="dev-list"><Row c={controller} tz={tz} now={now} busy={busy} onConfirm={setConfirm} /></ul>
          : <p><button type="button" className="btn btn-line cc-btn" disabled={busy} onClick={() => void createController()}>Make a code for the stream laptop</button></p>}
      </div>

      {past.length > 0 && (
        <details className="dev-past">
          <summary>Revoked and expired ({past.length})</summary>
          <ul className="dev-list">{past.map(c => <Row key={c.id} c={c} tz={tz} now={now} busy={busy} onConfirm={setConfirm} />)}</ul>
        </details>
      )}

      {confirm && (
        <Dialog title={confirm.kind === 'all' ? 'Sign out all temporary devices?' : confirm.kind === 'revoke' ? `Revoke ${confirm.c.label}?` : `New code for ${confirm.c.label}?`} variant="drawer" busy={busy} onClose={() => setConfirm(null)}>
          <p style={{ marginTop: 0 }}>
            {confirm.kind === 'all' ? `All ${confirm.n} temporary ${confirm.n === 1 ? 'device is' : 'devices are'} signed out right away and their codes stop working. The stream laptop is not affected. You can make new codes after.`
              : confirm.kind === 'revoke' ? 'This device is signed out right away and its code stops working. Other devices are not affected.'
              : 'The old code stops working right away and any device signed in with it is signed out. You will see the new code once.'}
          </p>
          <div className="dlg-actions">
            <button type="button" className="btn btn-line" onClick={() => setConfirm(null)}>Keep it</button>
            <button type="button" className={confirm.kind === 'replace' ? 'btn btn-ink' : 'btn btn-danger'} data-autofocus onClick={doConfirm}>
              {confirm.kind === 'all' ? 'Sign out all' : confirm.kind === 'revoke' ? 'Revoke' : 'Make a new code'}
            </button>
          </div>
        </Dialog>
      )}
      {reveal && <DeviceCodeSheet title={reveal.title} items={reveal.items} notes={reveal.notes} eventName={eventName} timezone={timezone} onClose={() => setReveal(null)} />}
    </CommandSection>
  );
}

function Row({ c, tz, now, busy, onConfirm }: { c: Credential; tz: string; now: number; busy: boolean; onConfirm: (c: Confirm) => void }) {
  const active = c.status === 'active';
  const elsewhere = active ? signedInElsewhereLabel(c.signedInElsewhereAt, tz) : null;
  const ends = active ? accessEndsLabel(c.expiresAt, tz) : null;
  return (
    <li className={`dev-row s-${c.status}`} data-testid="device-row" data-label={c.label} data-status={c.status}>
      <div className="dev-main"><b className="dev-name">{c.label}</b> <Chip tone={active ? 'win' : c.status === 'expired' ? 'brass' : ''}>{statusWord(c.status)}</Chip></div>
      <p className="dev-sub">{roleWord(c.role)}{active ? ` · ${lastSeenLabel(c, now)}` : c.revokedAt ? ` · ${c.replaced ? 'Replaced' : 'Signed out'}` : ''}</p>
      {elsewhere && <p className="dev-warn" role="status">⚠ {elsewhere}</p>}
      {ends && <p className="dev-sub">{ends}</p>}
      {active && (
        <div className="dev-actions">
          <button type="button" className="btn btn-line btn-sm" disabled={busy} aria-label={`New code for ${c.label}`} onClick={() => onConfirm({ kind: 'replace', c })}>New code</button>
          <button type="button" className="btn btn-bad btn-sm" disabled={busy} aria-label={`Revoke ${c.label}`} onClick={() => onConfirm({ kind: 'revoke', c })}>Revoke</button>
        </div>
      )}
    </li>
  );
}
