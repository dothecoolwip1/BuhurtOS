import { useState } from 'react';
import { Chip, Seg } from '../../components/ui';
import type { LiveEvent } from '../../data/api';
import { fetchDisciplineOverview } from '../../data/discipline';
import { withdrawRegistration } from '../../data/invitations';
import { decideRegistration, setRegistrationInsurance, setRegistrationPaid, type Insurance, type ManagedRegistration } from '../../data/manage';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import { attendanceText } from '../../lib/eventDays';
import { fetchEventMembershipContext } from '../../data/organizations';
import { formatMoney, type MembershipContext } from '../../registration/model';
import { blockers, countByStatus, filterRegistrations, insuranceLabel, organizerInsuranceChoices, type ReviewFilter } from '../../registration/review';
import { AttentionStrip } from '../CheckinPanel';
import { ExportRegistrations } from '../ExportRegistrations';

/** Runs an organizer action on one registration, shows a plain-language error, then asks for fresh data. */
function useAction(reload: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);   // "Accepted Aldric Stone": the card may leave the list, the organizer still sees what happened (Pack 26)
  const run = async (id: string, fn: () => Promise<void>, said?: string) => {
    setBusy(id); setError(null);
    try { await fn(); if (said) setDone(said); reload(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(null); }
  };
  return { busy, error, done, run };
}

function Contact({ r }: { r: ManagedRegistration }) {
  return (
    <p style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>
      Emergency contact: <b>{r.emergencyName}</b>{r.emergencyRelationship ? ` (${r.emergencyRelationship})` : ''} · <a href={`tel:${r.emergencyPhone}`}>{r.emergencyPhone}</a>
    </p>
  );
}

function ReviewCard({ r, act, block, ctx }: { r: ManagedRegistration; act: ReturnType<typeof useAction>; block?: string | null; ctx: MembershipContext }) {
  const [showHealth, setShowHealth] = useState(false);
  const disabled = act.busy === r.id;
  const todo = blockers(r);
  return (
    <article className="panel info" style={{ display: 'grid', gap: 10 }} aria-label={r.fullName}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h3 style={{ marginRight: 4 }}>{r.fullName}</h3>
        <Chip tone={r.status === 'accepted' ? 'win' : r.status === 'pending' ? 'brass' : ''}>{r.status}</Chip>
        {r.isVolunteer && <Chip>Volunteer</Chip>}
        {r.mercenary && <Chip>Mercenary</Chip>}
      </div>
      <p style={{ color: 'var(--muted)' }}>
        {[r.organization && r.organization !== 'other' ? `Member of ${r.organization}` : null, r.province, r.teamName ?? 'No team'].filter(Boolean).join(' · ')}
        {r.biProfile ? ` · BI profile: ${r.biProfile}` : ' · no BI profile given'}
      </p>
      {r.categories.length > 0 && <p><b>{r.categories.map(c => c.name + (c.details.weight ? ` (${c.details.weight} kg)` : '') + (c.details.teammate ? ` with ${c.details.teammate}` : '')).join(', ')}</b></p>}
      {r.isVolunteer && r.volunteerRoles.length > 0 && <p>Volunteer roles: {r.volunteerRoles.join(', ')}</p>}
      {todo.length > 0 && <p className="src">Outstanding: {todo.join(' · ')}</p>}
      {block && <p className="desk-block" role="status"><b>Blocked:</b> {block}. They cannot be accepted, checked in or entered until it is lifted.</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.status !== 'accepted' && <button type="button" className="btn btn-ink" disabled={disabled || !!block} onClick={() => act.run(r.id, () => decideRegistration(r.id, 'accepted'), `Accepted ${r.fullName}.`)}>{block ? 'Blocked' : 'Accept'}</button>}
        {r.status !== 'declined' && <button type="button" className="btn btn-line" disabled={disabled} onClick={() => act.run(r.id, () => decideRegistration(r.id, 'declined'), `Declined ${r.fullName}.`)}>Decline</button>}
        {r.status === 'accepted' && <button type="button" className="btn btn-line" disabled={disabled} onClick={() => act.run(r.id, () => decideRegistration(r.id, 'pending'), `${r.fullName} is back in the pending list.`)}>Back to pending</button>}
        {(r.status === 'accepted' || r.status === 'pending') && <button type="button" className="btn btn-line" disabled={disabled} onClick={() => { if (window.confirm(`Withdraw ${r.fullName} from this event? They can register again later.`)) void act.run(r.id, () => withdrawRegistration(r.id)); }}>Withdraw</button>}
      </div>

      {/* fee and insurance: shown in full on an accepted registration (that is where they are settled); folded on a pending one, where the decision comes first */}
      {r.status === 'accepted' && <FeeInsurance r={r} act={act} disabled={disabled} ctx={ctx} />}

      <details>
        <summary>{r.status === 'accepted' ? 'Contact, availability and notes' : 'Fee, insurance, contact and notes'}</summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {r.status !== 'accepted' && <FeeInsurance r={r} act={act} disabled={disabled} ctx={ctx} />}
          <p style={{ overflowWrap: 'anywhere' }}>Email: {r.email}</p>
          <Contact r={r} />
          <p>Can attend: {attendanceText(r.attendDates, r.days)} · shares equipment: {r.sharesEquipment ? 'yes' : 'no'}</p>
          {r.availabilityNotes && <p>Availability note: {r.availabilityNotes}</p>}
          {r.notes && <p>Notes: {r.notes}</p>}
          {r.medicalNote && (showHealth
            ? <p>Private medical note: {r.medicalNote} <button type="button" className="linklike" onClick={() => setShowHealth(false)}>Hide</button></p>
            : <button type="button" className="btn btn-line" onClick={() => setShowHealth(true)}>Show private medical note</button>)}
        </div>
      </details>
    </article>
  );
}

function FeeInsurance({ r, act, disabled, ctx }: { r: ManagedRegistration; act: ReturnType<typeof useAction>; disabled: boolean; ctx: MembershipContext }) {
  return (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.feeDueCents > 0 ? (
          <button type="button" className="btn btn-line" disabled={disabled} aria-pressed={r.feePaid} onClick={() => act.run(r.id, () => setRegistrationPaid(r.id, !r.feePaid))}>
            {r.feePaid ? `Paid ${formatMoney(r.feeDueCents)} (undo)` : `Mark ${formatMoney(r.feeDueCents)} paid`}
          </button>
        ) : <span className="src">No fee due</span>}
        <label className="field-in" style={{ display: 'inline-grid' }}>Insurance
          <select value={r.insurance} disabled={disabled} onChange={e => act.run(r.id, () => setRegistrationInsurance(r.id, e.target.value as Insurance))}>
            {organizerInsuranceChoices(ctx, r.insurance).map(k => <option key={k} value={k}>{insuranceLabel(k, ctx)}</option>)}
          </select>
        </label>
      </div>
  );
}

/**
 * Event Control › Registrations (the old Manage › Registrations, unchanged in what it does): review who signed up, accept or decline, fees, insurance,
 * withdrawals and the export. Every decision goes through the database functions, which check the organizer again.
 */
export function RegistrationsTool({ event, regs, loading, error, onChanged }: { event: LiveEvent; regs: ManagedRegistration[]; loading: boolean; error: unknown; onChanged: () => void }) {
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [query, setQuery] = useState('');
  const act = useAction(onChanged);
  // Pack 22: who is blocked by a suspension (the label only), so the organizer sees it before pressing Accept. The database refuses anyway.
  const blocks = useAsync(() => fetchDisciplineOverview(event.id).then(o => new Map(o.blocks.map(b => [b.registration_id, b.message]))).catch(() => new Map<string, string>()), [event.id], [regs]);
  // HACSA insurance wording only for an event linked to HACSA; a failed lookup means generic wording (stored HACSA/MCC answers still show as they are).
  const membership = useAsync(() => fetchEventMembershipContext(event).catch(() => null), [event.organizationId, event.seasonId]);
  const ctx = membership.data ?? null;
  const counts = countByStatus(regs);
  const list = filterRegistrations(regs, filter, query);
  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Registrations">
      <AttentionStrip regs={regs} onPick={k => setFilter(k === 'pending' ? 'pending' : 'accepted')} />
      <Seg scroll label="Show" value={filter} options={[['pending', `Pending ${counts.pending}`], ['accepted', `Accepted ${counts.accepted}`], ['declined', `Declined ${counts.declined}`], ['withdrawn', `Withdrawn ${counts.withdrawn}`], ['all', 'All']] as const} onChange={setFilter} />
      <label className="field-in">Search by name, team or category
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      {act.error && <p role="alert" style={{ color: 'var(--live)' }}>{act.error}</p>}
      {act.done && !act.error && <p role="status" className="src" data-testid="review-done">{act.done}</p>}
      {error != null && <p role="alert">{friendlyError(error, 'Could not load registrations.')}</p>}
      {loading && <p className="muted">Loading registrations…</p>}
      {!loading && list.length === 0 && <div className="panel info"><h3>{regs.length === 0 ? 'No registrations yet' : 'Nothing here'}</h3></div>}
      <div style={{ display: 'grid', gap: 12 }}>
        {list.map(r => <ReviewCard key={r.id} r={r} act={act} block={blocks.data?.get(r.id) ?? null} ctx={ctx} />)}
      </div>
      <ExportRegistrations slug={event.slug} registrations={regs} />
    </section>
  );
}
