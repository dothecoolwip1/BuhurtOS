import { useCallback, useEffect, useId, useReducer, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePlatformRole } from '../../auth/usePlatformRole';
import { Dialog } from '../../components/Dialog';
import { Chip, PageHead } from '../../components/ui';
import {
  cleanReason, fetchAdminOrganizations, fetchOrganizationStaff, grantOrganizationAdmin, removeOrganizationAdmin, REASON_MAX, setOrganizationEnabled,
  type OrganizationStaffMember
} from '../../data/organizations';
import { friendlyError } from '../../lib/friendlyError';
import {
  DISABLE_NOTICE, disableTitle, pendingText, platformGate, switchChecked, TOGGLE_IDLE, toggleBusy, toggleReducer, toOrgAdminRow, type OrgAdminRow
} from '../../lib/platformOrgs';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The platform owner's area. The gate here only decides what to show: every call below is checked by the database, and a refusal is shown
 * as written. Anyone who is not the owner sees one plain page, the same for every path under /platform.
 */
function PlatformGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const role = usePlatformRole();
  const gate = platformGate(loading, !!session, role.loading, role.isOwner);
  if (gate === 'loading') return <p className="muted">Loading…</p>;
  if (gate === 'denied') return (
    <section style={{ display: 'grid', gap: 12 }}>
      <PageHead eyebrow="Platform" title="This area is for the platform owner" />
      <p className="muted"><Link className="more" to="/">Back to BuhurtOS</Link></p>
    </section>
  );
  return <>{children}</>;
}

export function PlatformHomePage() {
  useDocumentTitle('Platform');
  return (
    <PlatformGate>
      <section className="plat" style={{ display: 'grid', gap: 20 }}>
        <PageHead eyebrow="Platform" title="Platform" lede="Owner tools. Every action is checked by the database again; this page only decides what is shown." />
        <ul className="plain">
          <li><Link className="panel plat-link" to="/platform/organizations"><b>Organizations</b><span className="muted">Switch organizations on or off and manage their admins.</span></Link></li>
        </ul>
      </section>
    </PlatformGate>
  );
}

export function PlatformOrganizationsPage() {
  useDocumentTitle('Organizations · Platform');
  return <PlatformGate><OrganizationsAdmin /></PlatformGate>;
}

function useWide(query = '(min-width: 1000px)'): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

function OrganizationsAdmin() {
  const [rows, setRows] = useState<OrgAdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const wide = useWide();
  // Always the server's answer. Called on load and after every change; a failed re-fetch keeps the last list and says so.
  const reload = useCallback(async () => {
    try { setRows((await fetchAdminOrganizations()).map(toOrgAdminRow)); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const managed = rows?.find(r => r.id === managing) ?? null;

  return (
    <section className="plat" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Platform" title="Organizations" lede="Every organization, switched on or off. Switching one off keeps all of its history; nothing is deleted." />
      <p><Link className="more" to="/platform">Platform</Link></p>
      {error && <p role="alert" className="plat-err">{error} <button type="button" className="linklike" onClick={() => void reload()}>Try again</button></p>}
      {!rows && !error && <p className="muted">Loading organizations…</p>}
      {rows && rows.length === 0 && <p className="muted">There are no organizations yet.</p>}
      {rows && rows.length > 0 && (wide
        ? <OrgTable rows={rows} reload={reload} onManage={setManaging} />
        : <ul className="plain orgcards" aria-label="Organizations">{rows.map(r => <li key={r.id}><OrgCard row={r} reload={reload} onManage={setManaging} /></li>)}</ul>)}
      {managed && <AdminDrawer org={managed} onClose={() => setManaging(null)} onChanged={reload} />}
    </section>
  );
}

function StatusChip({ row }: { row: OrgAdminRow }) { return <Chip tone={row.statusTone}>{row.statusLabel}</Chip>; }
function OrgTitle({ row, id }: { row: OrgAdminRow; id: string }) {
  return <span><b id={id} className="org-name">{row.title}</b>{row.shortLabel && <span className="mono org-short"> {row.shortLabel}</span>}</span>;
}

function OrgCard({ row, reload, onManage }: { row: OrgAdminRow; reload: () => Promise<void>; onManage: (id: string) => void }) {
  const nameId = useId();
  return (
    <article className="panel orgcard" aria-labelledby={nameId}>
      <div className="orgcard-top"><OrgTitle row={row} id={nameId} /><StatusChip row={row} /></div>
      <dl className="orgcounts">{row.counts.map(c => <div key={c.key}><dt>{c.label}</dt><dd className="mono">{c.value}</dd></div>)}</dl>
      <OrgControls row={row} nameId={nameId} reload={reload} />
      <button type="button" className="btn btn-line" onClick={() => onManage(row.id)}>Manage admins ({row.adminsCount})</button>
    </article>
  );
}

function OrgTable({ rows, reload, onManage }: { rows: OrgAdminRow[]; reload: () => Promise<void>; onManage: (id: string) => void }) {
  const labels = rows[0].counts;
  return (
    <div className="panel table-scroll">
      <table>
        <thead><tr><th>Organization</th><th>Status</th><th>Enabled</th>{labels.map(c => <th key={c.key} className="num">{c.label}</th>)}<th><span className="sr-only">Admins</span></th></tr></thead>
        <tbody>
          {rows.map(r => {
            const nameId = `orgname-${r.id}`;
            return (
              <tr key={r.id}>
                <td><OrgTitle row={r} id={nameId} /></td>
                <td><StatusChip row={r} /></td>
                <td><OrgControls row={r} nameId={nameId} reload={reload} /></td>
                {r.counts.map(c => <td key={c.key} className="num">{c.value}</td>)}
                <td><button type="button" className="btn btn-line" onClick={() => onManage(r.id)}>Manage admins</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The Enabled switch with its confirmation dialog, pending text and refusal. The switch only ever shows the server's value. */
function OrgControls({ row, nameId, reload }: { row: OrgAdminRow; nameId: string; reload: () => Promise<void> }) {
  const [state, dispatch] = useReducer(toggleReducer, TOGGLE_IDLE);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonId = useId();
  const pending = pendingText(state);

  // The call runs when the machine enters 'pending'; the answer is re-read from the server before the row settles.
  const phase = state.phase;
  const target = state.phase === 'pending' ? state.target : null;
  const reason = state.phase === 'pending' ? state.reason : null;
  useEffect(() => {
    if (phase !== 'pending' || target === null) return;
    let live = true;
    (async () => {
      try {
        await setOrganizationEnabled(row.id, target, reason);
        await reload();
        if (live) dispatch({ type: 'done' });
      } catch (e) {
        if (live) dispatch({ type: 'fail', message: friendlyError(e) });
        await reload();
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, target, reason, row.id]);

  const confirm = () => {
    if (state.phase !== 'confirm-disable') return;
    const c = cleanReason(state.reason);
    if (c.error) { setReasonError(c.error); return; }
    setReasonError(null);
    dispatch({ type: 'confirm', reason: c.reason });
  };

  return (
    <div className="orgctl">
      <label className="switch">
        <input type="checkbox" role="switch" checked={switchChecked(row.enabled, state)} disabled={toggleBusy(state)} aria-describedby={nameId}
          aria-label="Organization Enabled" onChange={() => dispatch({ type: 'request', enabled: row.enabled })} />
        <span className="track" aria-hidden="true" />
        <span className="switch-text">{row.enabled ? '[✓] Enabled' : '[ ] Enabled'}</span>
      </label>
      <span className="muted plat-pending" role="status" aria-live="polite">{pending ?? ''}</span>
      {state.phase === 'failed' && (
        <p role="alert" className="plat-err">
          {state.message} The organization was not changed. <button type="button" className="linklike" onClick={() => dispatch({ type: 'dismiss' })}>Dismiss</button>
        </p>
      )}
      {(state.phase === 'confirm-disable' || (state.phase === 'pending' && state.target === false)) && (
        <Dialog title={disableTitle(row.title)} busy={state.phase === 'pending'} onClose={() => { setReasonError(null); dispatch({ type: 'cancel' }); }}>
          <p>{DISABLE_NOTICE}</p>
          <label className="field-in" htmlFor={reasonId}>
            Reason (optional, kept in the audit log)
            <textarea id={reasonId} rows={3} maxLength={REASON_MAX + 50} data-autofocus value={state.phase === 'confirm-disable' ? state.reason : (state.reason ?? '')}
              disabled={state.phase === 'pending'} onChange={e => dispatch({ type: 'reason', reason: e.target.value })} />
          </label>
          {reasonError && <p role="alert" className="plat-err">{reasonError}</p>}
          <div className="dlg-actions">
            <button type="button" className="btn btn-line" disabled={state.phase === 'pending'} onClick={() => { setReasonError(null); dispatch({ type: 'cancel' }); }}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={state.phase === 'pending'} onClick={confirm}>{state.phase === 'pending' ? 'Disabling…' : 'Disable Organization'}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- per-organization admins
function AdminDrawer({ org, onClose, onChanged }: { org: OrgAdminRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const [staff, setStaff] = useState<OrganizationStaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const emailId = useId();

  const load = useCallback(async () => {
    try { setStaff(await fetchOrganizationStaff(org.id)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [org.id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true); setNote(null); setError(null);
    try { await fn(); await load(); await onChanged(); setNote(done); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); setRemoving(null); }
  };

  return (
    <Dialog title={`${org.title} admins`} variant="drawer" onClose={onClose} busy={busy}>
      <p className="muted">Organization admins can run events and seasons for this organization while it is switched on. The person must have signed in to BuhurtOS once.</p>
      {error && <p role="alert" className="plat-err">{error}</p>}
      {note && <p role="status" className="muted">{note}</p>}
      {!staff && !error && <p className="muted">Loading admins…</p>}
      {staff && staff.length === 0 && <p className="muted">No admins yet.</p>}
      {staff && staff.length > 0 && (
        <ul className="plain">
          {staff.map(s => (
            <li key={s.userId} className="staffrow">
              <span className="staff-email">{s.email}</span>
              {removing === s.userId
                ? <span className="staff-act"><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => removeOrganizationAdmin(org.id, s.userId), 'Admin removed.')}>Remove {s.email}</button><button type="button" className="btn btn-line" disabled={busy} onClick={() => setRemoving(null)}>Keep</button></span>
                : <button type="button" className="btn btn-line" disabled={busy} onClick={() => setRemoving(s.userId)}>Remove<span className="sr-only"> {s.email}</span></button>}
            </li>
          ))}
        </ul>
      )}
      <form className="staffform" onSubmit={e => { e.preventDefault(); if (email.trim()) void run(async () => { await grantOrganizationAdmin(org.id, email); setEmail(''); }, 'Admin added.'); }}>
        <label className="field-in" htmlFor={emailId}>
          Add an admin by email
          <input id={emailId} type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" data-autofocus />
        </label>
        <button type="submit" className="btn btn-ink" disabled={busy || !email.trim()}>{busy ? 'Working…' : 'Add admin'}</button>
      </form>
    </Dialog>
  );
}
