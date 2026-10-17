import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Chip, TestBadge } from '../components/ui';
import { isSynthetic, useSynthetic } from '../data/synthetic';
import { eventTypeLabel } from '../data/eventTypes';
import { fetchEvent, fetchMyEventContext, type LeagueKey, type LiveCompetition, type LiveEvent, type MyEventContext } from '../data/api';
import { registrationWindow } from '../lib/dates';
import { DRAFT_NOTICE, notPublicMessage } from '../lib/draftView';
import { friendlyError } from '../lib/friendlyError';
import { EventHistory, EventOrganization } from '../components/EventHistory';
import { fetchEventMetaById } from '../data/careers';
import { LiveBracket } from '../components/LiveBracket';
import { LivePools } from '../components/LivePools';
import { useLiveMatches } from '../lib/useLiveMatches';
import { useLystPublic } from '../lib/lyst/useLystPublic';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PROVINCES, formatMoney } from '../registration/model';
import { EventDaySchedule } from './EventDaySchedule';
import { MyNextFight } from './MyNextFight';
import { MyTeamPanel } from './MyTeamPanel';
import { ShareEventButton } from '../components/ShareEventButton';
import { Livestream } from '../components/Livestream';
import { NotFoundPage } from './NotFoundPage';
import { AddToCalendar } from '../components/AddToCalendar';
import { fetchMyFighterId } from '../data/fighters';
import { fetchMyInvitation, withdrawMyInvitation, withdrawRegistration, type MyInvitation } from '../data/invitations';
import { fetchMyEventEntryIds } from '../data/myFight';
import { OfficialResults } from '../components/OfficialResults';
import { AddMyMedalLink } from '../components/PastMedals';
import { CheckinCode } from '../components/CheckinCode';
import { useEventRecordWatch } from '../lib/useEventRecordWatch';
import { defaultViewFor, eventPhaseOf, viewPath, type PublicView } from '../lib/eventPhaseView';
import { EventHeader, type HeaderCta } from './event/EventHeader';
import { LiveFields } from './event/LiveFields';

const LEAGUE_TITLE: Record<LeagueKey, string> = { buhurt: 'Group fights', duels: 'Duels', outrance: 'Profights', hacsa: 'HACSA events' };
const GENDER: Record<LiveCompetition['gender'], string> = { open: 'Open', men: 'Men', women: 'Women' };
const provinceName = (code: string) => PROVINCES.find(([k]) => k === code)?.[1] ?? code;
/** Every role that gives someone a job at the event: they get the one staff door. The database decides what each may do behind it. */
const STAFF_ROLES = ['organizer', 'owner', 'head_marshal', 'marshal', 'scorekeeper', 'announcer', 'check_in', 'inspector', 'medic'];

function feeText(e: LiveEvent): string | null {
  if (e.feeCents <= 0) return null;
  const amount = formatMoney(e.feeCents);
  if (e.registrationMode !== 'buhuros') return `Tickets from ${amount}.`;
  return e.feeProvince ? `${amount} for fighters from ${provinceName(e.feeProvince)}. Fighters from elsewhere and volunteers pay nothing.` : `${amount} per fighter. Volunteers pay nothing.`;
}

/** The signed-in fighter was added by the organizer: say so, show the competitions, lead to the form, and let them withdraw. */
function InvitationCard({ event, invitation, onChanged }: { event: LiveEvent; invitation: MyInvitation; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (invitation.status !== 'invited') return null;
  const withdraw = async () => {
    setBusy(true); setProblem(null);
    try { await withdrawMyInvitation(invitation.id); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); setConfirm(false); }
  };
  return (
    <section className="panel info" aria-labelledby="inv-h" style={{ display: 'grid', gap: 10 }} data-testid="invitation-card">
      <h3 id="inv-h">The organizers added you to this event</h3>
      <p>You are expected in: <b>{invitation.competitions.map(c => c.name).join(', ') || 'a competition the organizer will confirm'}</b>.{invitation.note && <> They wrote: “{invitation.note}”.</>}</p>
      <p style={{ margin: 0 }}><Chip tone="brass">Pending: form and waiver</Chip></p>
      <p className="src">Being added is not a registration yet. Fill in the registration form and sign the waiver yourself, and you are in. Or withdraw, and the organizers are told.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {event.status === 'published'
          ? <Link className="btn btn-ink" to={`/events/${event.slug}/register`} data-testid="complete-registration">Complete my registration</Link>
          : <span className="src">The form opens once the event is published.</span>}
        {!confirm && <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(true)}>Withdraw</button>}
      </div>
      {confirm && (
        <div className="panel info" role="alertdialog" aria-label="Confirm withdrawal" style={{ display: 'grid', gap: 8 }}>
          <p><b>Withdraw from {event.name}?</b> The organizers will be told. They can add you again later if plans change.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void withdraw()} data-testid="confirm-withdraw">Yes, withdraw</button>
            <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(false)}>Keep my place</button>
          </div>
        </div>
      )}
      {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
    </section>
  );
}

/** Registration, as the signed-in person sees it: their own state first, the way in otherwise. Upcoming events lead with this. */
function RegistrationCard({ event, mine, signedIn, onChanged, entered, headerLeads = false }: { event: LiveEvent; mine: MyEventContext | undefined; signedIn: boolean; onChanged: () => void; entered: string[];
  /** The header already carries the Register action (Pack 25); the card then keeps the facts (who, when it closes) and not a second button. */
  headerLeads?: boolean }) {
  const win = registrationWindow(event.registrationOpensAt, event.registrationClosesAt);
  const reg = mine?.registration;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const withdraw = async () => {
    if (!reg) return;
    setBusy(true); setProblem(null);
    try { await withdrawRegistration(reg.id); onChanged(); } catch (e) { setProblem(friendlyError(e)); } finally { setBusy(false); setConfirm(false); }
  };
  if (event.registrationMode === 'none') return null;
  if (event.registrationMode === 'external') {
    if (event.status !== 'published' && !mine?.isOrganizer) return null;
    return (
      <section className="panel info" data-testid="registration-card">
        <h3>Tickets and sign-up</h3>
        <p style={{ color: 'var(--muted)' }}>Sign-up for this event happens on another website. BuhurtOS does not handle it.</p>
        {event.externalUrl && <a className="btn btn-ink" href={event.externalUrl} target="_blank" rel="noopener noreferrer">Open the sign-up page</a>}
      </section>
    );
  }
  const to = `/events/${event.slug}/register`;
  if (reg) {
    const word = reg.status === 'accepted' ? 'Accepted' : reg.status === 'declined' ? 'Declined' : reg.status === 'withdrawn' ? 'Withdrawn' : 'Waiting for review';
    return (
      <section className="panel info" aria-labelledby="mine-h" data-testid="registration-card">
        <h3 id="mine-h">Your registration</h3>
        <p><Chip tone={reg.status === 'accepted' ? 'win' : 'brass'}>{word}</Chip></p>
        {entered.length > 0 && <p data-testid="my-entries">You are entered in <b>{entered.join(', ')}</b>.</p>}
        {reg.feeDueCents > 0 && <p style={{ color: 'var(--muted)' }}>Fee: <b>{formatMoney(reg.feeDueCents)}</b> · {reg.feePaid ? 'paid' : 'not marked paid yet'}</p>}
        {reg.status === 'accepted' && event.status === 'published' && !event.closedAt && <CheckinCode slug={event.slug} registrationId={reg.id} />}
        {reg.status === 'withdrawn' && event.status === 'published' && win === 'open' && <p><Link className="btn btn-line" to={to}>Register again</Link></p>}
        {(reg.status === 'accepted' || reg.status === 'pending') && !confirm && <p><button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => setConfirm(true)}>Withdraw from this event</button></p>}
        {confirm && (
          <div className="panel info" role="alertdialog" aria-label="Confirm withdrawal" style={{ display: 'grid', gap: 8 }}>
            <p><b>Withdraw your registration for {event.name}?</b> Your place in the competitions is given up and the organizers are told. You can register again while registration is open.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ink" disabled={busy} onClick={() => void withdraw()}>Yes, withdraw</button>
              <button type="button" className="btn btn-line" disabled={busy} onClick={() => setConfirm(false)}>Keep my registration</button>
            </div>
          </div>
        )}
        {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
      </section>
    );
  }
  if (event.status !== 'published') return null;
  if (win === 'closed') return <section className="panel info" data-testid="registration-card"><h3>Registration is closed</h3><p style={{ color: 'var(--muted)' }}>Teams are final. Contact the organizers if you need to ask about a place.</p></section>;
  if (win === 'not_open') return <section className="panel info" data-testid="registration-card"><h3>Registration has not opened yet</h3>{event.registrationOpensAt && <p className="src">Opens {new Date(event.registrationOpensAt).toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: event.timezone ?? 'America/Edmonton' })}.</p>}</section>;
  return (
    <section className="panel info" data-testid="registration-card">
      <h3>Registration is open</h3>
      <p style={{ color: 'var(--muted)' }}>{signedIn ? 'Fighters and volunteers register here.' : 'Sign in with Google or an email code, then fill in the form.'}{event.registrationClosesAt ? ` Closes ${new Date(event.registrationClosesAt).toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: event.timezone ?? 'America/Edmonton' })}.` : ''}</p>
      {!headerLeads && <Link className="btn btn-ink" to={to}>{signedIn ? 'Register' : 'Sign in and register'}</Link>}
    </section>
  );
}

function Competitions({ event, competitions, canAdd }: { event: LiveEvent; competitions: LiveCompetition[]; canAdd: boolean }) {
  const groups = (['buhurt', 'duels', 'outrance', 'hacsa'] as LeagueKey[]).map(l => [l, competitions.filter(c => c.league === l)] as const).filter(([, list]) => list.length > 0);
  if (event.eventType !== 'tournament' && groups.length === 0) return null;
  return (
    <section aria-labelledby="comp-h" className="ev-comps" data-testid="competitions">
      <h2 id="comp-h">Competitions</h2>
      {groups.length === 0 && <p className="muted">No competitions have been added yet.{canAdd && <> <Link to={`/events/${event.slug}/control?mode=setup&tool=competitions`}>Add one in Event Control.</Link></>}</p>}
      {groups.map(([league, list]) => (
        <div key={league} className="panel info ev-comp-group">
          <h3>{LEAGUE_TITLE[league]}</h3>
          <ul>
            {list.map(c => (
              <li key={c.id}>
                <b>{c.name}</b><Chip>{GENDER[c.gender]}</Chip>
                {c.status === 'finished' && <Chip tone="win">Official</Chip>}
                <span className="src">{c.ruleset ?? 'Ruleset not set yet'}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function EventWorkspace({ view: wantedView }: { view?: PublicView }) {
  const { eventId: slug = '' } = useParams();
  const { session } = useAuth();
  const synthetic = useSynthetic();
  const userId = session?.user.id;
  const [recordKey, setRecordKey] = useState(0);
  const loaded = useAsync(() => fetchEvent(slug), [slug], [recordKey]);
  const eventId = loaded.data?.event.id;
  useEventRecordWatch(eventId, () => setRecordKey(k => k + 1));
  const [mineKey, setMineKey] = useState(0);
  const mine = useAsync(() => (eventId && userId ? fetchMyEventContext(eventId, userId) : Promise.resolve(undefined)), [eventId, userId], [mineKey]);
  const myFighter = useAsync(() => (userId ? fetchMyFighterId() : Promise.resolve(null)), [userId]);
  const invitation = useAsync(() => (eventId && myFighter.data ? fetchMyInvitation(eventId, myFighter.data) : Promise.resolve(null)), [eventId, myFighter.data, mineKey]);
  const myEntries = useAsync(() => (eventId && userId ? fetchMyEventEntryIds(eventId).catch(() => []) : Promise.resolve([] as string[])), [eventId, userId, mineKey]);
  const meta = useAsync(() => (eventId ? fetchEventMetaById(eventId) : Promise.resolve(null)), [eventId]);
  const changed = () => setMineKey(k => k + 1);
  useDocumentTitle(loaded.data?.event.name ?? 'Event');
  const event = loaded.data?.event;
  const phase = event ? eventPhaseOf(event) : 'upcoming';
  const view: PublicView = wantedView ?? defaultViewFor(phase);
  const showLive = event?.status === 'published';
  const liveIds = useMemo(() => (showLive ? loaded.data!.competitions.map(c => c.id) : []), [showLive, loaded.data]);
  const live = useLiveMatches(liveIds);
  const lyst = useLystPublic(eventId, phase === 'live');

  if (loaded.loading && !loaded.data) return <p className="muted">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error, 'Could not load this event.')}</p>;
  if (!loaded.data || !event) {
    if (!session) return <NotFoundPage />;
    return (
      <section className="panel info" role="status" style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        <h2>Event not available</h2>
        <p>{notPublicMessage(session.user.email)}</p>
        <p><Link className="btn btn-line" to="/account">Account</Link> <Link className="btn btn-line" to="/events">See events</Link></p>
      </section>
    );
  }

  const { competitions } = loaded.data;
  const names = new Map(competitions.map(c => [c.id, c.name]));
  const allMatches = Object.values(live.data).flatMap(d => d.matches);
  const entryIds = new Set(myEntries.data ?? []);
  const myMatchIds = new Set(allMatches.filter(m => (m.entryA && entryIds.has(m.entryA)) || (m.entryB && entryIds.has(m.entryB))).map(m => m.id));
  const enteredNames = [...new Set(Object.values(live.data).flatMap(d => d.entries).filter(e => entryIds.has(e.id)).map(e => names.get(e.competitionId) ?? ''))].filter(Boolean);
  const completed = phase === 'completed';
  const officialCount = competitions.filter(c => c.status === 'finished').length;
  const running = competitions.filter(c => c.status !== 'finished');
  const isStaff = Boolean(mine.data && (mine.data.isOrganizer || mine.data.roles.some(r => STAFF_ROLES.includes(r))));
  const win = registrationWindow(event.registrationOpensAt, event.registrationClosesAt);
  const cta: HeaderCta | null = phase === 'live' && view !== 'live' ? { to: viewPath(event.slug, 'live'), label: 'What is happening now', tone: 'ink' }
    : completed && view !== 'results' ? { to: viewPath(event.slug, 'results'), label: 'See the results', tone: 'ink' }
    : phase === 'upcoming' && event.registrationMode === 'buhuros' && win === 'open' && !mine.data?.registration ? { to: `/events/${event.slug}/register`, label: session ? 'Register' : 'Sign in and register', tone: 'ink' }
    : phase === 'upcoming' && event.registrationMode === 'external' && event.externalUrl ? null
    : null;
  const canAddCompetition = mine.data?.isOrganizer === true;
  const isTest = isSynthetic(synthetic, 'event', event.id);

  return (
    <section className={`fade-in ev ev-${view}`} style={{ display: 'grid', gap: 18 }}>
      <EventHeader event={event} phase={phase} view={view} cta={cta} control={isStaff} synthetic={isTest} connection={showLive ? live.connection : null} />
      {event.status === 'draft' && (
        <section className="panel info" role="status" aria-label="Draft event" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <p><Chip tone="brass">Draft</Chip> <b>{DRAFT_NOTICE}.</b></p>
          {mine.data?.isOrganizer && <Link className="btn btn-ink btn-sm" to={`/events/${event.slug}/control?mode=setup`}>Finish setting up and publish</Link>}
        </section>
      )}
      {/* the fighter's own fight comes before everything while the event runs */}
      {showLive && (view === 'live' || phase === 'live') && <MyNextFight eventId={event.id} userId={userId} competitions={competitions} live={live} />}
      {event.statsExcludedAt && <p className="panel info ev-note" role="note"><Chip tone="live">Not counted</Chip> <span><b>Not counted in official statistics.</b> Results are kept for the record but do not count in rankings, medals or career totals.</span></p>}
      {isTest && <p className="panel info ev-note" role="note"><TestBadge synthetic /> <span><b>A fictional test event.</b> Its teams, fighters and results are made up and count nowhere.</span></p>}

      {view === 'overview' && (
        <>
          {event.description && <p className="ev-lede">{event.description}</p>}
          <EventOrganization meta={meta.data} />
          {invitation.data && <InvitationCard event={event} invitation={invitation.data} onChanged={changed} />}
          {!completed && <RegistrationCard event={event} mine={mine.data} signedIn={Boolean(session)} onChanged={changed} entered={enteredNames} headerLeads={cta?.to === `/events/${event.slug}/register`} />}
          {showLive && phase !== 'live' && <MyNextFight eventId={event.id} userId={userId} competitions={competitions} live={live} />}
          <EventDaySchedule timeNote={event.timeNote} description={event.description} />
          {event.timeNote && !/\d/.test(event.timeNote) && <p className="panel info"><b>{event.timeNote}</b></p>}
          <Competitions event={event} competitions={competitions} canAdd={canAddCompetition} />
          <Livestream eventId={event.id} slug={event.slug} published={event.status === 'published'} />
          {(feeText(event) || event.feeNote || event.volunteerInfo) && (
            <section className="panel info" aria-labelledby="info-h">
              <h3 id="info-h">Good to know</h3>
              {feeText(event) && <p>{feeText(event)}</p>}
              {event.feeNote && <p style={{ color: 'var(--muted)' }}>{event.feeNote}</p>}
              {event.volunteerInfo && <p style={{ color: 'var(--muted)' }}>{event.volunteerInfo}</p>}
            </section>
          )}
          <MyTeamPanel eventId={event.id} userId={userId} />
          <div className="ev-tools"><ShareEventButton title={event.name} /><AddToCalendar event={event} />{showLive && competitions.length > 0 && <Link className="btn btn-line" to={`/events/${event.slug}/arena`}>Big screen</Link>}</div>
          <p className="src">{eventTypeLabel(event.eventType)}. Rulesets are named as the organizer announced them.</p>
        </>
      )}

      {view === 'live' && (
        <>
          {!showLive && <p className="panel info muted">Live fights appear here once the event is published.</p>}
          {showLive && live.loading && live.updatedAt === null && <p className="muted">Loading the fields…</p>}
          {showLive && live.error != null && live.updatedAt === null && <p role="alert">{friendlyError(live.error, 'Could not load the fights.')}</p>}
          {showLive && <LiveFields matches={allMatches} competitionNames={names} lyst={lyst.rows} clock={lyst.clock} slug={event.slug} mine={myMatchIds} teamCompetitions={new Set(competitions.filter(c => c.league === 'buhurt').map(c => c.id))} />}
          {showLive && live.updatedAt !== null && allMatches.every(m => m.queueState === 'scheduled' || m.queueState === 'final') && (
            <section className="panel info ev-quiet" data-testid="live-quiet">
              <h2>{phase === 'upcoming' ? 'Nothing is fighting yet' : phase === 'completed' ? 'The fighting is over' : 'Nothing on the fields right now'}</h2>
              <p className="muted">{phase === 'upcoming' ? `Fights appear here as the organizers call them, from ${event.startsOn === event.endsOn ? 'the day of the event' : 'the first day'}.` : phase === 'completed' ? 'See the results.' : 'The next fights appear here the moment they are called.'}</p>
              {phase === 'completed' && <Link className="btn btn-ink" to={viewPath(event.slug, 'results')}>Results</Link>}
            </section>
          )}
          <Livestream eventId={event.id} slug={event.slug} published={event.status === 'published'} />
          {showLive && running.length > 0 && live.updatedAt !== null && (
            <section className="live-results" aria-labelledby="brk-h">
              <h2 id="brk-h">Brackets and standings</h2>
              {running.map(c => {
                const d = live.data[c.id];
                if (!d || d.matches.length === 0) return null;
                return (
                  <details key={c.id} className="panel info live-comp ev-bracket" open={running.length <= 2}>
                    <summary><b>{c.name}</b> <span className="src">not official yet</span></summary>
                    <LivePools standings={d.standings} entries={d.entries} matches={d.matches} />
                    <LiveBracket matches={d.matches} liveOk={live.connection === 'live'} />
                  </details>
                );
              })}
              {running.every(c => !live.data[c.id] || live.data[c.id].matches.length === 0) && <p className="muted">No draw has been made yet.</p>}
            </section>
          )}
          {officialCount > 0 && <p><Link className="btn btn-line" to={viewPath(event.slug, 'results')}>Official results so far ({officialCount})</Link></p>}
          {showLive && competitions.length > 0 && <p className="ev-tools"><Link className="btn btn-line" to={`/events/${event.slug}/arena`}>Big screen for the hall</Link></p>}
        </>
      )}

      {view === 'results' && (
        <>
          {completed && event.medalsOnly && (
            <div className="panel info" role="status" data-testid="event-medals-only" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              <p style={{ margin: 0 }}><Chip>Past tournament</Chip> <b>Medals only.</b> This tournament was not run in BuhurtOS: no fights or scores were recorded here. The medals below were added by the fighters themselves from their own results and are not verified; they earn no ranking points.{event.timeNote ? ` ${event.timeNote}.` : ''}</p>
              <AddMyMedalLink />
            </div>
          )}
          {completed && !event.medalsOnly && <p className="panel info" role="status" data-testid="event-closed"><Chip tone="win">Official results</Chip> <b>{event.closedAt ? 'This event is complete.' : 'This event is over.'}</b> The placings here are its permanent record.</p>}
          {!showLive && <p className="panel info muted">Results appear here once the event is published.</p>}
          {showLive && completed && event.medalsOnly && <OfficialResults competitions={competitions} version={recordKey} heading="Medals" emptyText="No medals have been added for this tournament yet." reported />}
          {showLive && completed && !event.medalsOnly && competitions.length > 0 && <EventHistory eventId={event.id} competitions={competitions} live={live} recordKey={recordKey} />}
          {showLive && !completed && (
            <section className="live-results" aria-labelledby="res-h">
              <h2 id="res-h">Results</h2>
              {officialCount > 0 ? <OfficialResults competitions={competitions} version={recordKey} heading={null} /> : <p className="muted">No competition is official yet.</p>}
              {running.length > 0 && <h3 style={{ margin: '6px 0 0' }}>Still being fought</h3>}
              {live.loading && live.updatedAt === null && <p className="muted">Loading results…</p>}
              {live.updatedAt !== null && running.map(c => {
                const d = live.data[c.id];
                if (!d) return null;
                return (
                  <div key={c.id} className="panel info live-comp">
                    <h3>{c.name} <span className="src">not official yet</span></h3>
                    {d.matches.length === 0 && <p className="muted">The draw has not been made yet.</p>}
                    {d.matches.length > 0 && <LivePools standings={d.standings} entries={d.entries} matches={d.matches} />}
                    {d.matches.length > 0 && <LiveBracket matches={d.matches} liveOk={live.connection === 'live'} />}
                  </div>
                );
              })}
            </section>
          )}
          {showLive && completed && !event.medalsOnly && competitions.length === 0 && <p className="muted">This event had no competitions.</p>}
        </>
      )}
    </section>
  );
}
