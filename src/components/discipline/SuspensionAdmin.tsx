import { useMemo, useState } from 'react';
import { Dialog } from '../Dialog';
import { RulePicker } from '../rules/RulesSheet';
import { changeSuspension, fetchManagedSuspensions, fetchRecordHistory, issueSuspension, liftSuspension, type ManagedSuspension } from '../../data/discipline';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import { dayOfUtc, endOfDayUtc, showDayUtc } from '../../lib/discipline/suspensionDates';

const day = showDayUtc;
const endOfDay = endOfDayUtc;

/**
 * Pack 22: suspensions an organization (its admins) or the platform (the owner) decides, for example to record a Judiciary Committee ban. A
 * suspension blocks acceptance, check-in and entry at the events it covers. A change is a new decision that replaces the old one (both stay in the
 * history); a lift ends it. Shown only to people the database lets read it: everyone else sees nothing here.
 */
export function SuspensionAdmin({ organizationId, title }: { organizationId: string | null; title: string }) {
  const [tick, setTick] = useState(0);
  const list = useAsync(() => fetchManagedSuspensions(organizationId), [organizationId], [tick]);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<{ s: ManagedSuspension; what: 'change' | 'lift' | 'history' } | null>(null);
  if ((list.error as { code?: string } | null)?.code === '42501') return null;
  const done = () => setTick(n => n + 1);
  const rows = list.data ?? [];
  const inForce = rows.filter(s => s.in_force);
  const past = rows.filter(s => !s.in_force);
  return (
    <section className="dd-panel" aria-labelledby={`sa-${organizationId ?? 'platform'}`}>
      <div className="dd-head">
        <h2 id={`sa-${organizationId ?? 'platform'}`} className="rl-h2">{title} <span className="mono">{inForce.length} in force</span></h2>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setAdding(true)}>Suspend someone</button>
      </div>
      <p className="src">{organizationId ? 'Covers this organization’s events.' : 'Covers every event on the platform.'} The person is told they are suspended (and until when), not the reason. Reasons stay with the issuing authority.</p>
      {list.loading && !list.data && <p className="src" role="status">Loading…</p>}
      {list.error != null && (list.error as { code?: string }).code !== '42501' && <p role="alert">{friendlyError(list.error, 'Could not load the suspensions.')}</p>}
      {list.data && rows.length === 0 && <p className="rl-none">No suspensions.</p>}
      <ul className="dd-list">
        {[...inForce, ...past].map(s => (
          <li key={s.id} className={s.in_force ? '' : 'void'}>
            <span className="dd-what"><b>{s.against ?? 'Unknown'}</b> · {s.label}{s.lifted_at ? ' · lifted' : s.superseded ? ' · replaced by a later decision' : !s.in_force ? ' · ended' : ''}</span>
            <span className="dl-where">From {day(s.starts_at)}{s.reason ? ` · ${s.reason}` : ''}</span>
            {s.lift_reason && <span className="dl-where">Lifted: {s.lift_reason}</span>}
            <span className="dd-btns">
              {s.in_force && <button type="button" className="btn btn-line btn-sm" onClick={() => setActing({ s, what: 'change' })}>Change the end date</button>}
              {s.in_force && <button type="button" className="btn btn-line btn-sm" onClick={() => setActing({ s, what: 'lift' })}>Lift</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActing({ s, what: 'history' })}>History</button>
            </span>
          </li>
        ))}
      </ul>
      {adding && <AddLongSuspension organizationId={organizationId} onClose={() => setAdding(false)} onDone={done} />}
      {acting?.what === 'change' && <ChangeEnd s={acting.s} onClose={() => setActing(null)} onDone={done} />}
      {acting?.what === 'lift' && <Lift s={acting.s} onClose={() => setActing(null)} onDone={done} />}
      {acting?.what === 'history' && <History s={acting.s} onClose={() => setActing(null)} />}
    </section>
  );
}

function useSubjectSearch(team: boolean) {
  const [q, setQ] = useState('');
  const res = useAsync(async () => {
    const n = q.trim();
    if (n.length < 2) return [] as { id: string; name: string }[];
    const r = team ? await supabase.from('teams').select('id, name').ilike('name', `%${n}%`).limit(8) : await supabase.from('fighters').select('id, display_name').ilike('display_name', `%${n}%`).limit(8);
    if (r.error) throw r.error;
    return (r.data ?? []).map(x => ({ id: (x as { id: string }).id, name: (x as { name?: string; display_name?: string }).name ?? (x as { display_name?: string }).display_name ?? '' }));
  }, [q, team]);
  return { q, setQ, res };
}

function Sheet({ title, onClose, busy, err, children }: { title: string; onClose: () => void; busy: boolean; err: string | null; children: React.ReactNode }) {
  return <Dialog title={title} variant="drawer" onClose={onClose} busy={busy}><div className="dd-form">{children}{err && <p role="alert" className="dd-err">{err}</p>}</div></Dialog>;
}
function useRun(onClose: () => void, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); onDone(); onClose(); } catch (e) { setErr(friendlyError(e, 'That did not go through.')); } finally { setBusy(false); } };
  return { busy, err, run };
}

function AddLongSuspension({ organizationId, onClose, onDone }: { organizationId: string | null; onClose: () => void; onDone: () => void }) {
  const [team, setTeam] = useState(false);
  const { q, setQ, res } = useSubjectSearch(team);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [until, setUntil] = useState('');
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { busy, err, run } = useRun(onClose, onDone);
  const ok = !!who && reason.trim().length >= 3 && (open || !!until);
  const scopeWord = organizationId ? 'this organization’s events' : 'every event';
  return (
    <Sheet title="Suspend" onClose={onClose} busy={busy} err={err}>
      <div className="dd-seg" role="radiogroup" aria-label="Who">
        <button type="button" role="radio" aria-checked={!team} className={`btn btn-sm ${!team ? 'btn-ink' : 'btn-line'}`} onClick={() => { setTeam(false); setWho(null); }}>A fighter</button>
        <button type="button" role="radio" aria-checked={team} className={`btn btn-sm ${team ? 'btn-ink' : 'btn-line'}`} onClick={() => { setTeam(true); setWho(null); }}>A team</button>
      </div>
      {who ? <div className="rl-picked"><span className="chip steel">{who.name}</span><button type="button" className="btn btn-line btn-sm" onClick={() => setWho(null)}>Change</button></div> : (
        <div className="rl-pick">
          <label className="rulesearch"><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={team ? 'Team name' : 'Fighter name'} aria-label={team ? 'Team name' : 'Fighter name'} autoComplete="off" /></label>
          {(res.data ?? []).map(x => <button key={x.id} type="button" className="rl-pickrow" onClick={() => setWho(x)}><span className="rl-main"><b className="rl-title">{x.name}</b></span></button>)}
        </div>
      )}
      <label className="field-in">Until (last day)<input type="date" value={until} disabled={open} onChange={e => setUntil(e.target.value)} /></label>
      <label className="rl-check"><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /> No end date (for example a permanent ban decided by the governing body)</label>
      <div className="field-in">Rule (optional)<RulePicker value={rule} onChange={setRule} /></div>
      <label className="field-in">Reason (stays with you)<textarea rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: Judiciary Committee decision of 12 October" /></label>
      <div className="dd-actions">
        {confirm && <p className="rl-banner rl-warn dd-confirm" role="alert"><b>Check before you confirm.</b> {who?.name} will be blocked from {scopeWord} {open ? 'with no end date' : `until ${until}`}: no acceptance, no check-in, no entry.</p>}
        <button type="button" className="btn btn-danger" disabled={!ok || busy} onClick={() => (confirm ? void run(() => issueSuspension({ authority: organizationId ? 'organization' : 'platform', scope: organizationId ? 'organization_events' : 'all_events', organization: organizationId, fighter: team ? null : who!.id, team: team ? who!.id : null, endsAt: open ? null : endOfDay(until), provision: rule, reason })) : setConfirm(true))}>{busy ? 'Saving…' : confirm ? 'Yes, suspend' : 'Suspend'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={confirm ? () => setConfirm(false) : onClose}>{confirm ? 'Go back' : 'Cancel'}</button>
      </div>
    </Sheet>
  );
}

function ChangeEnd({ s, onClose, onDone }: { s: ManagedSuspension; onClose: () => void; onDone: () => void }) {
  const [until, setUntil] = useState(s.ends_at ? dayOfUtc(s.ends_at) : '');
  const [open, setOpen] = useState(!s.ends_at);
  const [reason, setReason] = useState('');
  const { busy, err, run } = useRun(onClose, onDone);
  return (
    <Sheet title="Change the end date" onClose={onClose} busy={busy} err={err}>
      <p><b>{s.against}</b> · {s.label}</p>
      <p className="src">This records a new decision that replaces the current one (for example after the Judiciary Committee reduced or increased it). Both stay in the history.</p>
      <label className="field-in">Until (last day)<input type="date" value={until} disabled={open} onChange={e => setUntil(e.target.value)} /></label>
      <label className="rl-check"><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /> No end date</label>
      <label className="field-in">Reason<textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="dd-actions">
        <button type="button" className="btn btn-ink" disabled={busy || reason.trim().length < 3 || (!open && !until)} onClick={() => void run(() => changeSuspension(s.id, open ? null : endOfDay(until), reason))}>{busy ? 'Saving…' : 'Record the change'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}

function Lift({ s, onClose, onDone }: { s: ManagedSuspension; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { busy, err, run } = useRun(onClose, onDone);
  return (
    <Sheet title="Lift the suspension" onClose={onClose} busy={busy} err={err}>
      <p><b>{s.against}</b> · {s.label}</p>
      <label className="field-in">Reason<textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="dd-actions">
        {confirm && <p className="rl-banner rl-warn dd-confirm" role="alert">They can be accepted, checked in and entered again. The suspension stays in the history.</p>}
        <button type="button" className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => (confirm ? void run(() => liftSuspension(s.id, reason)) : setConfirm(true))}>{busy ? 'Saving…' : confirm ? 'Yes, lift it' : 'Lift it'}</button>
        <button type="button" className="btn btn-line" disabled={busy} onClick={confirm ? () => setConfirm(false) : onClose}>{confirm ? 'Go back' : 'Cancel'}</button>
      </div>
    </Sheet>
  );
}

function History({ s, onClose }: { s: ManagedSuspension; onClose: () => void }) {
  const h = useAsync(() => fetchRecordHistory('suspension', s.id), [s.id]);
  const items = useMemo(() => h.data ?? [], [h.data]);
  return (
    <Dialog title={`History · ${s.against ?? ''}`} variant="drawer" onClose={onClose}>
      {h.loading ? <p className="src">Loading…</p> : h.error != null ? <p role="alert">{friendlyError(h.error)}</p> : (
        <ol className="desk-history">{items.map((x, i) => <li key={i}><b>{x.action}</b> · {new Date(x.at).toLocaleString()}{x.by ? ` · ${x.by}` : ''}{typeof x.details.reason === 'string' ? ` · ${x.details.reason}` : ''}{x.details.ends_at !== undefined ? ` · until ${x.details.ends_at ? day(String(x.details.ends_at)) : 'no end date'}` : ''}</li>)}</ol>
      )}
    </Dialog>
  );
}
