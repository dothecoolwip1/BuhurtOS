import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Chip, PageHead, Seg } from '../components/ui';
import { fetchEvent, fetchMyEventContext } from '../data/api';
import {
  decideRegistration, fetchRegistrations, setRegistrationInsurance, setRegistrationPaid,
  type Insurance, type ManagedRegistration
} from '../data/manage';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { formatMoney } from '../registration/model';
import { INSURANCE_LABEL, blockers, countByStatus, filterRegistrations, type ReviewFilter } from '../registration/review';
import { AttentionStrip, CheckinPanel } from './CheckinPanel';
import { NotFoundPage } from './NotFoundPage';
import { ExportRegistrations } from './ExportRegistrations';
import { PeopleTab } from './PeopleTab';
import { RunTab } from './RunTab';
import { SetupTab } from './SetupTab';
import { TeamsTab } from './TeamsTab';

type Tab = 'review' | 'checkin' | 'run' | 'setup' | 'people' | 'teams';
const TABS: Tab[] = ['review', 'checkin', 'run', 'setup', 'people', 'teams'];

/** Runs an organizer action on one registration, shows a plain-language error, then asks for fresh data. */
function useAction(reload: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setError(null);
    try { await fn(); reload(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(null); }
  };
  return { busy, error, run };
}

function Contact({ r }: { r: ManagedRegistration }) {
  return (
    <p style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>
      Emergency contact: <b>{r.emergencyName}</b>{r.emergencyRelationship ? ` (${r.emergencyRelationship})` : ''} · <a href={`tel:${r.emergencyPhone}`}>{r.emergencyPhone}</a>
    </p>
  );
}

function ReviewCard({ r, act }: { r: ManagedRegistration; act: ReturnType<typeof useAction> }) {
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
        {[r.organization, r.province, r.teamName ?? 'No team'].filter(Boolean).join(' · ')}
        {r.biProfile ? ` · BI profile: ${r.biProfile}` : ' · no BI profile given'}
      </p>
      {r.categories.length > 0 && <p><b>{r.categories.map(c => c.name + (c.details.weight ? ` (${c.details.weight} kg)` : '') + (c.details.teammate ? ` with ${c.details.teammate}` : '')).join(', ')}</b></p>}
      {r.isVolunteer && r.volunteerRoles.length > 0 && <p>Volunteer roles: {r.volunteerRoles.join(', ')}</p>}
      {todo.length > 0 && <p className="src">Outstanding: {todo.join(' · ')}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.status !== 'accepted' && <button type="button" className="btn btn-ink" disabled={disabled} onClick={() => act.run(r.id, () => decideRegistration(r.id, 'accepted'))}>Accept</button>}
        {r.status !== 'declined' && <button type="button" className="btn btn-line" disabled={disabled} onClick={() => act.run(r.id, () => decideRegistration(r.id, 'declined'))}>Decline</button>}
        {r.status === 'accepted' && <button type="button" className="btn btn-line" disabled={disabled} onClick={() => act.run(r.id, () => decideRegistration(r.id, 'pending'))}>Back to pending</button>}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.feeDueCents > 0 ? (
          <button type="button" className="btn btn-line" disabled={disabled} aria-pressed={r.feePaid} onClick={() => act.run(r.id, () => setRegistrationPaid(r.id, !r.feePaid))}>
            {r.feePaid ? `Paid ${formatMoney(r.feeDueCents)} (undo)` : `Mark ${formatMoney(r.feeDueCents)} paid`}
          </button>
        ) : <span className="src">No fee due</span>}
        <label className="field-in" style={{ display: 'inline-grid' }}>Insurance
          <select value={r.insurance} disabled={disabled} onChange={e => act.run(r.id, () => setRegistrationInsurance(r.id, e.target.value as Insurance))}>
            {(Object.keys(INSURANCE_LABEL) as Insurance[]).map(k => <option key={k} value={k}>{INSURANCE_LABEL[k]}</option>)}
          </select>
        </label>
      </div>

      <details>
        <summary>Contact, availability and notes</summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <p style={{ overflowWrap: 'anywhere' }}>Email: {r.email}</p>
          <Contact r={r} />
          <p>Can attend: {r.days.length ? r.days.map(d => (d === 'sat' ? 'Saturday' : 'Sunday')).join(' and ') : 'not given'} · shares equipment: {r.sharesEquipment ? 'yes' : 'no'}</p>
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

export function ManagePage() {
  const { eventId: slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id;
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [query, setQuery] = useState('');
  const rawTab = params.get('tab');
  const tab: Tab = TABS.find(t => t === rawTab) ?? 'review';
  const [eventKey, setEventKey] = useState(0);
  const act = useAction(() => setReloadKey(k => k + 1));

  const loaded = useAsync(() => fetchEvent(slug), [slug, eventKey]);
  const eventId = loaded.data?.event.id;
  const mine = useAsync(() => (eventId && userId ? fetchMyEventContext(eventId, userId) : Promise.resolve(undefined)), [eventId, userId]);
  const isOrganizer = mine.data?.isOrganizer === true;
  const regs = useAsync(() => (eventId && isOrganizer ? fetchRegistrations(eventId) : Promise.resolve([] as ManagedRegistration[])), [eventId, isOrganizer, reloadKey]);
  useDocumentTitle(loaded.data ? `Manage ${loaded.data.event.name}` : 'Manage');

  if (authLoading || (loaded.loading && !loaded.data)) return <p className="muted">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error)}</p>;
  if (!loaded.data) return <NotFoundPage />;
  const { event, competitions } = loaded.data;
  if (!session) return <><PageHead eyebrow="Organizers" title={`Manage ${event.name}`} /><SignIn reason="Sign in with the account that organizes this event." /></>;
  if (mine.loading && !mine.data) return <p className="muted">Loading…</p>;
  if (!isOrganizer) {
    return (
      <section style={{ display: 'grid', gap: 14 }}>
        <PageHead eyebrow="Organizers" title="This area is for organizers" lede="Only the organizers of this event can review registrations and check people in. If that should be you, ask the event owner to add your account." />
        <Link className="btn btn-line" to={`/events/${event.slug}`}>Back to the event</Link>
      </section>
    );
  }

  const all = regs.data ?? [];
  const counts = countByStatus(all);
  const list = filterRegistrations(all, filter, query);
  const ready = all.filter(r => r.status === 'accepted' && blockers(r).length === 0).length;
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18 }}>
      <PageHead eyebrow="Organizers" title={`Manage ${event.name}`} />
      <Link className="more" to={`/events/${event.slug}`}>← Back to the event</Link>
      <AttentionStrip regs={all} onPick={k => {
        if (k === 'pending') { setFilter('pending'); setParams({}, { replace: true }); }
        else if (k === 'blocked') setParams({ tab: 'checkin' }, { replace: true });
        else { setFilter('accepted'); setParams({}, { replace: true }); }
      }} />
      <Seg label="Area" value={tab} options={[['review', `Review (${counts.pending} waiting)`], ['checkin', `Check-in (${ready}/${counts.accepted} ready)`], ['run', 'Run'], ['setup', 'Setup'], ['people', 'People'], ['teams', 'Teams']] as const}
        onChange={v => setParams(v === 'review' ? {} : { tab: v }, { replace: true })} />
      {tab === 'run' && <RunTab key={event.id} event={event} competitions={competitions} />}
      {tab === 'setup' && <SetupTab key={event.id} event={event} onChanged={() => setEventKey(k => k + 1)} />}
      {tab === 'teams' && <TeamsTab />}
      {tab === 'people' && <PeopleTab eventId={event.id} myUserId={userId} />}
      {tab === 'checkin' && <CheckinPanel regs={all} loading={regs.loading} onChanged={() => setReloadKey(k => k + 1)} />}
      {tab === 'review' && (<>
      <ExportRegistrations slug={event.slug} registrations={all} />
      {tab === 'review' && (
        <Seg label="Show" value={filter} options={[['pending', `Pending ${counts.pending}`], ['accepted', `Accepted ${counts.accepted}`], ['declined', `Declined ${counts.declined}`], ['all', 'All']] as const} onChange={setFilter} />
      )}
      <label className="field-in">Search by name, team or category
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      {act.error && <p role="alert" style={{ color: 'var(--live)' }}>{act.error}</p>}
      {regs.error != null && <p role="alert">{friendlyError(regs.error, 'Could not load registrations.')}</p>}
      {regs.loading && <p className="muted">Loading registrations…</p>}
      {!regs.loading && list.length === 0 && <div className="panel info"><h3>{all.length === 0 ? 'No registrations yet' : 'Nothing here'}</h3></div>}
      <div style={{ display: 'grid', gap: 12 }}>
        {list.map(r => <ReviewCard key={r.id} r={r} act={act} />)}
      </div>
      </>)}
    </section>
  );
}
