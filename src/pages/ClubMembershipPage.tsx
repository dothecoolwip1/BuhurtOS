import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SignIn } from '../auth/SignIn';
import { Dialog } from '../components/Dialog';
import { Chip, PageHead, Seg, Tabs } from '../components/ui';
import {
  applyForMembership, assignOfficer, endOfficer, fetchClubOverview, fetchDuesHistory, fetchOfficers, fetchRoster, OFFICES, setDues, setMembershipStatus,
  type Application, type ClubOverview, type MyMembership
} from '../data/clubMembership';
import { fetchTeamBySlug, type DirectoryEntry } from '../data/teamDirectory';
import {
  agmSnapshot, DUES_LABEL, DUES_OPTIONS, duesSatisfied, filterRoster, historySentence, isAtLeast, MEMBERSHIP_LABEL, MEMBERSHIP_OPTIONS, money, parseMoney,
  ROSTER_FILTERS, summarize, type DuesStatus, type MembershipStatus, type RosterFilter, type RosterMember
} from '../lib/clubMembership';
import { todayIso } from '../lib/careerView';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const bad: React.CSSProperties = { color: 'var(--live)' };

/**
 * /teams/:slug/membership: a club's society membership (Red Deer Reavers first). Everyone signed in sees their OWN membership, dues and
 * voting eligibility and can apply. The club's executive additionally sees the members list, the AGM snapshot and the dues history; only the
 * President, Secretary and Treasurer get the change buttons. The database checks all of it again (migration 20261013000100).
 */
export function ClubMembershipPage() {
  const { slug = '' } = useParams();
  const { session, loading } = useAuth();
  const team = useAsync(() => fetchTeamBySlug(slug), [slug]);
  useDocumentTitle(team.data ? `${team.data.name} membership` : 'Membership');
  const overview = useAsync(() => (team.data && session ? fetchClubOverview(team.data.id) : Promise.resolve(null)), [team.data?.id, session?.user.id]);
  if (loading || team.loading) return <p className="muted">Loading…</p>;
  if (!team.data) return <section className="panel info"><h3>Team not found</h3><Link className="btn btn-line btn-sm" to="/teams">All teams</Link></section>;
  const t = team.data;
  if (!session) {
    return (
      <>
        <PageHead eyebrow={t.name} title="Membership" lede="Members sign in with their BuhurtOS account: the same account works on the club website." />
        <SignIn reason={`Sign in to see your ${t.name} membership, dues and voting status.`} />
      </>
    );
  }
  if (overview.loading) return <p className="muted">Loading membership…</p>;
  if (overview.error != null || !overview.data) return <p role="alert" style={bad}>{friendlyError(overview.error, 'Could not load membership.')}</p>;
  return <Club t={t} o={overview.data} reload={overview.reload} />;
}

function Club({ t, o, reload }: { t: DirectoryEntry; o: ClubOverview; reload: () => void }) {
  const [params, setParams] = useSearchParams();
  const leadership = o.canViewRoster;
  type View = 'mine' | 'members' | 'agm' | 'history' | 'officers';
  const views: (readonly [View, string])[] = [['mine', 'My membership']];
  if (leadership) views.push(['members', 'Members'], ['agm', 'AGM'], ['history', 'Dues history']);
  if (leadership || o.canAssignOfficers) views.push(['officers', 'Executive']);
  const asked = params.get('view') as View | null;
  const view: View = views.some(([k]) => k === asked) ? asked as View : (leadership ? 'members' : 'mine');
  const setView = (v: View) => { const p = new URLSearchParams(params); p.set('view', v); setParams(p, { replace: true }); };
  const [year, setYear] = useState<number | null>(o.currentYear);

  if (!o.enabled) {
    return (
      <>
        <PageHead eyebrow={t.name} title="Membership" />
        <section className="panel info"><p className="muted">{t.name} does not keep its membership in BuhurtOS.</p>
          {o.canAssignOfficers && <OfficersPanel teamId={t.id} canAssign />}</section>
      </>
    );
  }
  const years = o.years.map(y => y.year);
  return (
    <section className="fade-in club" style={{ display: 'grid', gap: 16 }}>
      <Link className="more no-print" to={`/teams/${t.slug}`}>← {t.name}</Link>
      <PageHead eyebrow={t.name} title="Membership" />
      {views.length > 1 && <div className="no-print"><Tabs value={view} options={views} onChange={setView} /></div>}
      {(view === 'members' || view === 'agm' || view === 'history') && years.length > 1 && (
        <label className="field-in no-print" style={{ maxWidth: 200 }}>Membership year
          <select value={year ?? ''} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
        </label>
      )}
      {view === 'mine' && <Mine t={t} o={o} onChanged={reload} />}
      {view === 'members' && year != null && <Members teamId={t.id} year={year} canChange={o.canChangeDues} />}
      {view === 'agm' && year != null && <Agm t={t} year={year} />}
      {view === 'history' && year != null && <History teamId={t.id} year={year} />}
      {view === 'officers' && <OfficersPanel teamId={t.id} canAssign={o.canAssignOfficers} />}
    </section>
  );
}

// ---------------------------------------------------------------- the member's own view
export function VoteBanner({ eligible, reasons }: { eligible: boolean; reasons: string[] }) {
  return (
    <div className={`vote-banner ${eligible ? 'yes' : 'no'}`} role="status" data-testid="vote-banner">
      <b>{eligible ? 'ELIGIBLE TO VOTE' : 'NOT ELIGIBLE TO VOTE'}</b>
      {!eligible && reasons.length > 0 && <span>{reasons.join(' · ')}</span>}
    </div>
  );
}

function Mine({ t, o, onChanged }: { t: DirectoryEntry; o: ClubOverview; onChanged: () => void }) {
  const current = o.memberships.find(m => m.year === o.currentYear) ?? null;
  const yearInfo = o.years.find(y => y.year === o.currentYear);
  const [editing, setEditing] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {current && !editing && <MyCard m={current} offices={o.offices.map(x => x.label)} onEdit={current.status === 'pending' ? () => setEditing(true) : undefined} />}
      {!current && o.offices.length > 0 && <p className="muted">Your executive role: <b>{o.offices.map(x => x.label).join(', ')}</b>. You have no {o.currentYear} membership record yet.</p>}
      {(!current || editing) && yearInfo && (yearInfo.applicationsOpen
        ? <ApplyForm t={t} o={o} year={yearInfo.year} duesCents={yearInfo.duesCents} existing={editing ? current : null} onDone={() => { setEditing(false); onChanged(); }} onCancel={editing ? () => setEditing(false) : undefined} />
        : <p className="muted">Applications for {yearInfo.year} are closed. Ask the club executive.</p>)}
      {o.memberships.filter(m => m.year !== o.currentYear).length > 0 && (
        <section className="panel info"><h2 className="h3">Earlier years</h2>
          <ul className="club-list">{o.memberships.filter(m => m.year !== o.currentYear).map(m => (
            <li key={m.id}><b>{m.year}</b> <Chip>{MEMBERSHIP_LABEL[m.status]}</Chip> <DuesChip s={m.duesStatus} /></li>
          ))}</ul></section>
      )}
    </div>
  );
}

function MyCard({ m, offices, onEdit }: { m: MyMembership; offices: string[]; onEdit?: () => void }) {
  return (
    <section className="panel info" style={{ display: 'grid', gap: 12 }} data-testid="my-membership">
      <VoteBanner eligible={m.eligible} reasons={m.reasons} />
      <dl className="club-facts">
        <dt>Member</dt><dd>{m.fullName}</dd>
        <dt>Membership</dt><dd><StatusChip s={m.status} /> {m.year}</dd>
        <dt>{m.year} dues</dt><dd><DuesChip s={m.duesStatus} /> {m.duesAmountCents != null && money(m.duesAmountCents)}</dd>
        {offices.length > 0 && <><dt>Executive role</dt><dd>{offices.join(', ')}</dd></>}
        {m.discordName && <><dt>Discord</dt><dd>{m.discordName}</dd></>}
        <dt>Applied</dt><dd>{new Date(m.appliedAt).toLocaleDateString('en-CA', { dateStyle: 'medium' })}</dd>
      </dl>
      {m.status === 'pending' && <p className="src">Your application is waiting for the club executive. Dues are recorded by the President, Secretary or Treasurer; you cannot change them here.</p>}
      {m.status === 'active' && !duesSatisfied(m.duesStatus) && <p className="src">Pay your dues to the Treasurer. They record it here; it is not paid online.</p>}
      {onEdit && <button type="button" className="btn btn-line btn-sm" onClick={onEdit} style={{ justifySelf: 'start' }}>Edit my application</button>}
    </section>
  );
}

function ApplyForm({ t, o, year, duesCents, existing, onDone, onCancel }: {
  t: DirectoryEntry; o: ClubOverview; year: number; duesCents: number; existing: MyMembership | null; onDone: () => void; onCancel?: () => void;
}) {
  const [a, setA] = useState<Application>({
    fullName: existing?.fullName ?? o.suggestedName ?? '', discordName: existing?.discordName ?? '', dateOfBirth: existing?.dateOfBirth ?? '',
    adultConfirmed: existing?.adultConfirmed ?? false, agreeBylaws: false
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof Application>(k: K, v: Application[K]) => setA(p => ({ ...p, [k]: v }));
  const minor = a.dateOfBirth !== '' && !isAtLeast(a.dateOfBirth, 18, todayIso());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setProblem(null);
    if (a.fullName.trim().length < 2) return setProblem('Enter your full name.');
    if (!a.dateOfBirth && !a.adultConfirmed) return setProblem('Give your date of birth, or confirm you are 18 or older.');
    if (!a.agreeBylaws) return setProblem(`You must agree to follow the ${t.name} bylaws and team standards.`);
    setBusy(true);
    try { await applyForMembership(t.id, year, a); onDone(); } catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };
  return (
    <form className="panel info" style={{ display: 'grid', gap: 12 }} onSubmit={submit} data-testid="apply-form">
      <h2 className="h3">{existing ? 'Edit my application' : `Apply to become a ${year} member`}</h2>
      <p className="src">Annual dues for {year}: <b>{money(duesCents)}</b>, paid to the Treasurer. Your account email: {o.email}.</p>
      <label className="field-in">Full name<input value={a.fullName} onChange={e => set('fullName', e.target.value)} autoComplete="name" maxLength={120} required /></label>
      <label className="field-in">Discord name (optional)<input value={a.discordName} onChange={e => set('discordName', e.target.value)} maxLength={64} /></label>
      <label className="field-in">Date of birth (optional if you confirm 18+ below)<input type="date" value={a.dateOfBirth} max={todayIso()} onChange={e => set('dateOfBirth', e.target.value)} /></label>
      {minor && <p className="src" style={bad}>Members under 18 can join but cannot vote.</p>}
      {!a.dateOfBirth && <label className="checkline"><input type="checkbox" checked={a.adultConfirmed} onChange={e => set('adultConfirmed', e.target.checked)} /> I confirm I am 18 or older</label>}
      <label className="checkline"><input type="checkbox" checked={a.agreeBylaws} onChange={e => set('agreeBylaws', e.target.checked)} /> I agree to follow the {t.name} bylaws and team standards</label>
      {problem && <p role="alert" style={bad}>{problem}</p>}
      <div className="evfilter">
        <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Sending…' : existing ? 'Save application' : 'Apply'}</button>
        {onCancel && <button className="btn btn-line" type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- leadership: the members list
export function StatusChip({ s }: { s: MembershipStatus }) {
  return <Chip tone={s === 'active' ? 'win' : s === 'pending' ? 'brass' : ''}>{MEMBERSHIP_LABEL[s]}</Chip>;
}
export function DuesChip({ s }: { s: DuesStatus }) {
  return <span className={`dues-chip ${s}`}>{DUES_LABEL[s]}</span>;
}
function VoteChip({ r }: { r: Pick<RosterMember, 'eligible'> }) {
  return <span className={`vote-chip ${r.eligible ? 'yes' : 'no'}`}>{r.eligible ? 'Can vote' : 'Cannot vote'}</span>;
}

function Members({ teamId, year, canChange }: { teamId: string; year: number; canChange: boolean }) {
  const [tick, setTick] = useState(0);
  const roster = useAsync(() => fetchRoster(teamId, year), [teamId, year], [tick]);
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [search, setSearch] = useState('');
  const [dues, setDuesFor] = useState<RosterMember | null>(null);
  const [view, setViewFor] = useState<RosterMember | null>(null);
  const rows = useMemo(() => filterRoster(roster.data ?? [], filter, search), [roster.data, filter, search]);
  if (roster.loading) return <p className="muted">Loading members…</p>;
  if (roster.error != null) return <p role="alert" style={bad}>{friendlyError(roster.error, 'Could not load the members list.')}</p>;
  const s = summarize(roster.data ?? []);
  const changed = () => setTick(n => n + 1);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="club-tiles" data-testid="club-summary">
        <Tile n={s.total} label="Total members" onClick={() => setFilter('all')} />
        <Tile n={s.active} label="Active" onClick={() => setFilter('active')} />
        <Tile n={s.voting} label="Can vote" tone="yes" onClick={() => setFilter('eligible')} />
        <Tile n={s.duesPaid} label="Dues paid" onClick={() => setFilter('paid')} />
        <Tile n={s.duesOutstanding} label="Dues outstanding" tone={s.duesOutstanding > 0 ? 'no' : ''} onClick={() => setFilter('unpaid')} />
        <Tile n={s.pending} label="Pending applications" tone={s.pending > 0 ? 'warn' : ''} onClick={() => setFilter('pending')} />
      </div>
      <Seg label="Show" value={filter} options={ROSTER_FILTERS} onChange={setFilter} scroll />
      <input className="club-search" type="search" placeholder="Find a member" value={search} onChange={e => setSearch(e.target.value)} aria-label="Find a member" />
      {rows.length === 0 && <p className="muted">{(roster.data ?? []).length === 0 ? `Nobody has applied for ${year} yet.` : 'Nobody matches.'}</p>}
      <div className="club-rows" role="table" aria-label={`${year} members`}>
        <div className="club-row head" role="row"><span role="columnheader">Member</span><span role="columnheader">Membership</span><span role="columnheader">{year} dues</span><span role="columnheader">Voting</span><span role="columnheader">Actions</span></div>
        {rows.map(r => (
          <div key={r.membershipId} className={`club-row${r.status === 'pending' ? ' pending' : ''}`} role="row" data-testid="member-row">
            <span role="cell" className="who"><b>{r.fullName}</b>{r.offices.length > 0 && <small>{r.offices.join(', ')}</small>}</span>
            <span role="cell"><StatusChip s={r.status} /></span>
            <span role="cell"><DuesChip s={r.duesStatus} /></span>
            <span role="cell" className="vote"><VoteChip r={r} />{!r.eligible && r.reasons.length > 0 && <small>{r.reasons.join(' · ')}</small>}</span>
            <span role="cell" className="acts">
              {canChange && <button type="button" className="btn btn-line btn-sm" onClick={() => setDuesFor(r)} aria-label={`Change dues for ${r.fullName}`}>Dues</button>}
              <button type="button" className="btn btn-line btn-sm" onClick={() => setViewFor(r)} aria-label={`View ${r.fullName}`}>View</button>
            </span>
          </div>
        ))}
      </div>
      {dues && <DuesDialog m={dues} year={year} onClose={() => setDuesFor(null)} onSaved={() => { setDuesFor(null); changed(); }} />}
      {view && <MemberDialog teamId={teamId} m={view} canChange={canChange} onClose={() => setViewFor(null)} onSaved={() => { setViewFor(null); changed(); }} onDues={() => { setDuesFor(view); setViewFor(null); }} />}
    </div>
  );
}

function Tile({ n, label, tone = '', onClick }: { n: number; label: string; tone?: string; onClick: () => void }) {
  return <button type="button" className={`club-tile ${tone}`} onClick={onClick}><b>{n}</b><span>{label}</span></button>;
}

function DuesDialog({ m, year, onClose, onSaved }: { m: RosterMember; year: number; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<DuesStatus>(m.duesStatus === 'unpaid' ? 'paid' : m.duesStatus);
  const [amount, setAmount] = useState(m.duesAmountCents != null ? String(m.duesAmountCents / 100) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setProblem(null);
    const cents = status === 'paid' || status === 'gear_contribution' ? parseMoney(amount) : null;
    if (cents != null && Number.isNaN(cents)) return setProblem('Enter an amount like 20 or 20.00, or leave it empty.');
    setBusy(true);
    try { await setDues(m.membershipId, status, cents, note); onSaved(); } catch (x) { setProblem(friendlyError(x)); setBusy(false); }
  };
  return (
    <Dialog title={`${m.fullName}: ${year} dues`} onClose={onClose} busy={busy}>
      <form onSubmit={save} style={{ display: 'grid', gap: 12 }} data-testid="dues-dialog">
        <p className="src">Now: <DuesChip s={m.duesStatus} />{m.duesChangedByName && <> · last changed by {m.duesChangedByName}</>}</p>
        <div className="dues-pick" role="radiogroup" aria-label="Dues status">
          {DUES_OPTIONS.map(s => (
            <label key={s} className={`dues-opt ${s}${status === s ? ' on' : ''}`}><input type="radio" name="dues" value={s} checked={status === s} onChange={() => setStatus(s)} />{DUES_LABEL[s]}</label>
          ))}
        </div>
        {(status === 'paid' || status === 'gear_contribution') && (
          <label className="field-in">{status === 'paid' ? 'Amount (empty = normal dues)' : 'Value of the gear (optional)'}<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={status === 'paid' ? '20' : ''} /></label>
        )}
        <label className="field-in">Note (optional)<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder={status === 'gear_contribution' ? 'What was contributed' : status === 'waived' ? 'Why' : 'e.g. cash at practice'} /></label>
        <p className="src">This is recorded in the dues history with your name and office.</p>
        {problem && <p role="alert" style={bad}>{problem}</p>}
        <div className="evfilter"><button className="btn btn-ink" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save dues'}</button><button className="btn btn-line" type="button" onClick={onClose} disabled={busy}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function MemberDialog({ teamId, m, canChange, onClose, onSaved, onDues }: { teamId: string; m: RosterMember; canChange: boolean; onClose: () => void; onSaved: () => void; onDues: () => void }) {
  const history = useAsync(() => fetchDuesHistory(teamId, undefined, m.membershipId), [m.membershipId]);
  const [status, setStatus] = useState<MembershipStatus>(m.status === 'pending' ? 'active' : m.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null); setBusy(true);
    try { await setMembershipStatus(m.membershipId, status, note); onSaved(); } catch (x) { setProblem(friendlyError(x)); setBusy(false); }
  };
  return (
    <Dialog title={m.fullName} onClose={onClose} busy={busy} variant="drawer">
      <VoteBanner eligible={m.eligible} reasons={m.reasons} />
      <dl className="club-facts">
        <dt>Membership</dt><dd><StatusChip s={m.status} />{m.statusNote && <small> {m.statusNote}</small>}</dd>
        <dt>Dues</dt><dd><DuesChip s={m.duesStatus} /> {money(m.duesAmountCents)} {m.duesNote && <small>{m.duesNote}</small>}</dd>
        <dt>Age</dt><dd>{m.isAdult == null ? 'Not confirmed' : m.isAdult ? '18 or older' : 'Under 18'}</dd>
        {m.offices.length > 0 && <><dt>Executive</dt><dd>{m.offices.join(', ')}</dd></>}
        {m.email && <><dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{m.email}</dd></>}
        {m.discordName && <><dt>Discord</dt><dd>{m.discordName}</dd></>}
        <dt>Applied</dt><dd>{new Date(m.appliedAt).toLocaleDateString('en-CA', { dateStyle: 'medium' })}</dd>
      </dl>
      {canChange && (
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" className="btn btn-line" onClick={onDues}>Change dues</button>
          <label className="field-in">Membership status
            <select value={status} onChange={e => setStatus(e.target.value as MembershipStatus)}>{MEMBERSHIP_OPTIONS.map(s => <option key={s} value={s}>{MEMBERSHIP_LABEL[s]}</option>)}</select></label>
          <label className="field-in">Note (optional)<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} /></label>
          {problem && <p role="alert" style={bad}>{problem}</p>}
          <button type="button" className="btn btn-ink" onClick={save} disabled={busy || status === m.status}>{m.status === 'pending' && status === 'active' ? 'Approve membership' : 'Save status'}</button>
        </div>
      )}
      <h3 className="h3">Dues history</h3>
      {history.loading && <p className="muted">Loading…</p>}
      {(history.data ?? []).length === 0 && !history.loading && <p className="muted">No dues changes recorded.</p>}
      <ul className="club-list">{(history.data ?? []).map(h => <li key={h.id}>{historySentence(h)}{h.note && <small> “{h.note}”</small>}</li>)}</ul>
    </Dialog>
  );
}

// ---------------------------------------------------------------- AGM snapshot (read-only, printable)
function Agm({ t, year }: { t: DirectoryEntry; year: number }) {
  const [asOf, setAsOf] = useState(todayIso());
  const roster = useAsync(() => fetchRoster(t.id, year, asOf), [t.id, year, asOf]);
  const snap = useMemo(() => agmSnapshot(roster.data ?? []), [roster.data]);
  return (
    <div className="agm" style={{ display: 'grid', gap: 14 }} data-testid="agm">
      <div className="evfilter no-print">
        <label className="field-in" style={{ maxWidth: 220 }}>AGM date (ages counted on)<input type="date" value={asOf} onChange={e => setAsOf(e.target.value || todayIso())} /></label>
        <button type="button" className="btn btn-line" onClick={() => window.print()}>Print</button>
      </div>
      <p className="src no-print">Read-only snapshot. Nothing on this screen changes membership or dues.</p>
      {roster.loading && <p className="muted">Loading…</p>}
      {roster.error != null && <p role="alert" style={bad}>{friendlyError(roster.error)}</p>}
      {roster.data && (
        <>
          <header className="agm-head">
            <h2>{t.name} · {year} eligible voters</h2>
            <p>As of {new Date(`${asOf}T12:00:00`).toLocaleDateString('en-CA', { dateStyle: 'long' })} · printed from BuhurtOS</p>
            <div className="agm-count"><b data-testid="agm-count">{snap.voters.length}</b> eligible voter{snap.voters.length === 1 ? '' : 's'}</div>
          </header>
          <section><h3 className="h3">Eligible to vote</h3>
            {snap.voters.length === 0 ? <p className="muted">Nobody is eligible yet.</p>
              : <ol className="agm-list">{snap.voters.map(r => <li key={r.membershipId}>{r.fullName}{r.offices.length > 0 && <small> ({r.offices.join(', ')})</small>}</li>)}</ol>}
          </section>
          <section><h3 className="h3">Not eligible ({snap.excluded.length})</h3>
            {snap.excluded.length === 0 ? <p className="muted">Nobody is excluded.</p>
              : <ul className="agm-list excluded">{snap.excluded.map(r => <li key={r.membershipId}><b>{r.fullName}</b> <span>{r.reasons.join(' · ')}</span></li>)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dues history
function History({ teamId, year }: { teamId: string; year: number }) {
  const h = useAsync(() => fetchDuesHistory(teamId, year), [teamId, year]);
  if (h.loading) return <p className="muted">Loading…</p>;
  if (h.error != null) return <p role="alert" style={bad}>{friendlyError(h.error)}</p>;
  if ((h.data ?? []).length === 0) return <p className="muted">No dues changes recorded for {year}.</p>;
  return (
    <section className="panel info"><p className="src">Every dues change, newest first. History cannot be edited or removed.</p>
      <ul className="club-list" data-testid="dues-history">{(h.data ?? []).map(x => <li key={x.id}>{historySentence(x)}{x.note && <small> “{x.note}”</small>}</li>)}</ul>
    </section>
  );
}

// ---------------------------------------------------------------- executive offices
function OfficersPanel({ teamId, canAssign }: { teamId: string; canAssign: boolean }) {
  const [tick, setTick] = useState(0);
  const list = useAsync(() => fetchOfficers(teamId), [teamId], [tick]);
  const [email, setEmail] = useState('');
  const [office, setOffice] = useState('treasurer');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const assign = async (e: React.FormEvent) => {
    e.preventDefault(); setProblem(null); setBusy(true);
    try { await assignOfficer(teamId, email, office, note); setEmail(''); setNote(''); setTick(n => n + 1); } catch (x) { setProblem(friendlyError(x)); } finally { setBusy(false); }
  };
  const end = async (id: string, label: string) => {
    if (!window.confirm(`End this ${label} term? Their executive permissions stop immediately.`)) return;
    try { await endOfficer(id, ''); setTick(n => n + 1); } catch (x) { setProblem(friendlyError(x)); }
  };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section className="panel info"><h2 className="h3">Current executive</h2>
        <p className="src">Dues and membership changes are allowed for whoever currently holds President, Secretary or Treasurer. Ending a term removes that permission at once.</p>
        {list.loading && <p className="muted">Loading…</p>}
        {list.error != null && <p role="alert" style={bad}>{friendlyError(list.error)}</p>}
        {(list.data ?? []).length === 0 && !list.loading && <p className="muted">No executive roles are recorded yet.</p>}
        <ul className="club-list">{(list.data ?? []).map(o => (
          <li key={o.officerId} className="officer"><span><b>{o.officeLabel}</b> {o.name ?? o.email}<small> since {o.startedOn}</small></span>
            {canAssign && <button type="button" className="btn btn-line btn-sm" onClick={() => end(o.officerId, o.officeLabel)}>End term</button>}</li>
        ))}</ul>
      </section>
      {canAssign && (
        <form className="panel info" style={{ display: 'grid', gap: 12 }} onSubmit={assign}>
          <h2 className="h3">Assign an executive role</h2>
          <p className="src">Assigning President, Vice President, Secretary or Treasurer ends the previous holder's term the same day.</p>
          <label className="field-in">Their BuhurtOS sign-in email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label className="field-in">Role<select value={office} onChange={e => setOffice(e.target.value)}>{OFFICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field-in">Note (optional)<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. elected at the 2026 AGM" /></label>
          {problem && <p role="alert" style={bad}>{problem}</p>}
          <button className="btn btn-ink" type="submit" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? 'Saving…' : 'Assign'}</button>
        </form>
      )}
    </div>
  );
}
