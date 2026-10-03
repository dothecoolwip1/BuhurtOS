import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Chip, LiveStatus, PageHead, TestBadge } from '../components/ui';
import { isSynthetic, useSynthetic } from '../data/synthetic';
import { eventTypeLabel } from '../data/eventTypes';
import { fetchEvent, fetchMyEventContext, type LeagueKey, type LiveCompetition, type LiveEvent, type MyEventContext } from '../data/api';
import { dateRange, registrationWindow } from '../lib/dates';
import { DRAFT_NOTICE, notPublicMessage } from '../lib/draftView';
import { friendlyError } from '../lib/friendlyError';
import { EventHistory, EventOrganization } from '../components/EventHistory';
import { fetchEventMetaById } from '../data/careers';
import { eventPhase, todayIso } from '../lib/careerView';
import { LiveBracket } from '../components/LiveBracket';
import { LiveNow } from '../components/LiveNow';
import { LivePools } from '../components/LivePools';
import { useLiveMatches } from '../lib/useLiveMatches';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PROVINCES, formatMoney } from '../registration/model';
import { EventDaySchedule } from './EventDaySchedule';
import { MyNextFight } from './MyNextFight';
import { MyTeamPanel } from './MyTeamPanel';
import { ShareEventButton } from '../components/ShareEventButton';
import { NotFoundPage } from './NotFoundPage';
import { AddToCalendar } from '../components/AddToCalendar';
import { fetchMyFighterId } from '../data/fighters';
import { fetchMyInvitation, withdrawMyInvitation, withdrawRegistration, type MyInvitation } from '../data/invitations';

const LEAGUE_TITLE: Record<LeagueKey, string> = { buhurt: 'Group fights', duels: 'Duels', outrance: 'Profights', hacsa: 'HACSA events' };
const GENDER: Record<LiveCompetition['gender'], string> = { open: 'Open', men: 'Men', women: 'Women' };
const provinceName = (code: string) => PROVINCES.find(([k]) => k === code)?.[1] ?? code;

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

function RegistrationCard({ event, mine, signedIn, onChanged }: { event: LiveEvent; mine: MyEventContext | undefined; signedIn: boolean; onChanged: () => void }) {
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
      <section className="panel info">
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
      <section className="panel info" aria-labelledby="mine-h">
        <h3 id="mine-h">Your registration</h3>
        <p><Chip tone={reg.status === 'accepted' ? 'win' : 'brass'}>{word}</Chip></p>
        {reg.feeDueCents > 0 && <p style={{ color: 'var(--muted)' }}>Fee: <b>{formatMoney(reg.feeDueCents)}</b> · {reg.feePaid ? 'paid' : 'not marked paid yet'}</p>}
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
  if (win === 'closed') return <section className="panel info"><h3>Registration is closed</h3><p style={{ color: 'var(--muted)' }}>Teams are final. Contact the organizers if you need to ask about a place.</p></section>;
  if (win === 'not_open') return <section className="panel info"><h3>Registration has not opened yet</h3></section>;
  return (
    <section className="panel info">
      <h3>Register</h3>
      <p style={{ color: 'var(--muted)' }}>{signedIn ? 'Fighters and volunteers register here.' : 'Sign in with Google or an email code, then fill in the form.'}</p>
      <Link className="btn btn-ink" to={to}>{signedIn ? 'Register' : 'Sign in and register'}</Link>
    </section>
  );
}

function OrganizerPanel({ event, mine }: { event: LiveEvent; mine: MyEventContext }) {
  return (
    <section className="panel info" aria-labelledby="org-h">
      <h3 id="org-h">Needs your attention</h3>
      <p>
        <b>{mine.pendingRegistrations ?? 0}</b> registration{mine.pendingRegistrations === 1 ? '' : 's'} waiting for review.
        {event.status === 'draft' && <> The event is a <b>draft</b>: only you and your event staff can see it.</>}
      </p>
      {event.eventType === 'tournament' && event.competitionCount === 0 && <p><Chip tone="brass">Needs competition setup</Chip> <Link className="btn btn-ink btn-sm" to={`/events/${event.slug}/manage?tab=setup&add=competition`}>+ Add competition</Link></p>}
      <p><Link className="btn btn-ink" to={`/events/${event.slug}/manage`}>Review registrations and check people in</Link></p>
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn btn-line" to={`/events/${event.slug}/manage?tab=setup`}>Setup, competitions and waiver</Link>
        <Link className="btn btn-line" to={`/events/${event.slug}/manage?tab=fighters`}>Add fighters</Link>
        <Link className="btn btn-line" to={`/events/${event.slug}/manage?tab=people`}>Staff and roles</Link>
      </p>
    </section>
  );
}

export function EventWorkspace() {
  const { eventId: slug = '' } = useParams();
  const { session } = useAuth();
  const synthetic = useSynthetic();
  const userId = session?.user.id;
  const loaded = useAsync(() => fetchEvent(slug), [slug]);
  const eventId = loaded.data?.event.id;
  const [mineKey, setMineKey] = useState(0);
  const mine = useAsync(() => (eventId && userId ? fetchMyEventContext(eventId, userId) : Promise.resolve(undefined)), [eventId, userId, mineKey]);
  const myFighter = useAsync(() => (userId ? fetchMyFighterId() : Promise.resolve(null)), [userId]);
  const invitation = useAsync(() => (eventId && myFighter.data ? fetchMyInvitation(eventId, myFighter.data) : Promise.resolve(null)), [eventId, myFighter.data, mineKey]);
  const meta = useAsync(() => (eventId ? fetchEventMetaById(eventId) : Promise.resolve(null)), [eventId]);
  const changed = () => setMineKey(k => k + 1);
  useDocumentTitle(loaded.data?.event.name ?? 'Event');
  const showLive = loaded.data?.event.status === 'published';
  const liveIds = showLive ? loaded.data!.competitions.map(c => c.id) : [];
  const live = useLiveMatches(liveIds);

  if (loaded.loading) return <p className="muted">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error, 'Could not load this event.')}</p>;
  if (!loaded.data) {
    if (!session) return <NotFoundPage />;
    return (
      <section className="panel info" role="status" style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        <h2>Event not available</h2>
        <p>{notPublicMessage(session.user.email)}</p>
        <p><Link className="btn btn-line" to="/account">Account</Link> <Link className="btn btn-line" to="/events">See events</Link></p>
      </section>
    );
  }

  const { event, competitions } = loaded.data;
  const groups = (['buhurt', 'duels', 'outrance', 'hacsa'] as LeagueKey[]).map(l => [l, competitions.filter(c => c.league === l)] as const).filter(([, list]) => list.length > 0);
  const where = [event.venue, event.address, [event.city, event.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const fee = feeText(event);
  const names = new Map(competitions.map(c => [c.id, c.name]));
  const allMatches = Object.values(live.data).flatMap(d => d.matches);
  const completed = event.status === 'published' && eventPhase(event.startsOn, event.endsOn, todayIso()) === 'past';

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow={eventTypeLabel(event.eventType)} title={event.name} lede={event.description || undefined} />
      {isSynthetic(synthetic, 'event', event.id) && <p className="panel info" role="note"><TestBadge synthetic /> <b>This is a fictional test event.</b> Its teams, fighters and results are made up. They are not official records and are excluded from rankings and statistics.</p>}
      {event.status === 'draft' && (
        <section className="panel info" role="status" aria-label="Draft event" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <p><Chip tone="brass">Draft</Chip> <b>{DRAFT_NOTICE}.</b></p>
          {mine.data?.isOrganizer && <Link className="btn btn-ink btn-sm" to={`/events/${event.slug}/manage?tab=setup`}>Publish this event (Setup tab)</Link>}
        </section>
      )}
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <Chip>{dateRange(event.startsOn, event.endsOn)}</Chip>
        {event.timeNote && <p style={{ overflowWrap: 'anywhere' }}><b>{event.timeNote}</b></p>}
        {where && <p style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>{where}</p>}
      </div>
      <EventOrganization meta={meta.data} />
      <MyNextFight eventId={event.id} userId={userId} competitions={competitions} live={live} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><ShareEventButton title={event.name} /><AddToCalendar event={event} /></div>
      <EventDaySchedule timeNote={event.timeNote} description={event.description} />
      {showLive && <LiveStatus connection={live.connection} />}
      {showLive && <LiveNow matches={allMatches} competitionNames={names} />}
      {mine.data?.isOrganizer && <OrganizerPanel event={event} mine={mine.data} />}
      <MyTeamPanel eventId={event.id} userId={userId} />
      {invitation.data && <InvitationCard event={event} invitation={invitation.data} onChanged={changed} />}
      <RegistrationCard event={event} mine={mine.data} signedIn={Boolean(session)} onChanged={changed} />
      {(event.eventType === 'tournament' || groups.length > 0) && <section aria-labelledby="comp-h" style={{ display: 'grid', gap: 14 }}>
        <h2 id="comp-h">Competitions</h2>
        {groups.length === 0 && <p className="muted">No competitions have been added yet.{mine.data?.isOrganizer && <> <Link to={`/events/${event.slug}/manage?tab=setup&add=competition`}>Add one in Setup.</Link></>}</p>}
        {groups.map(([league, list]) => (
          <div key={league} className="panel info">
            <h3>{LEAGUE_TITLE[league]}</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
              {list.map(c => (
                <li key={c.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <b>{c.name}</b><Chip>{GENDER[c.gender]}</Chip>
                  <span className="src">{c.ruleset ?? 'Ruleset not set yet'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="src">Rulesets are named as the organizer announced them. BuhurtOS shows what is recorded and does not guess; where a ruleset says it is not loaded, its text is not in BuhurtOS yet.</p>
      </section>}
      {completed && competitions.length > 0 && <EventHistory eventId={event.id} competitions={competitions} live={live} />}
      {showLive && !completed && competitions.length > 0 && (
        <section className="live-results" aria-labelledby="live-h">
          <h2 id="live-h">Results</h2>
          {live.loading && live.updatedAt === null && <p className="muted">Loading results…</p>}
          {live.error != null && live.updatedAt === null && <p role="alert">{friendlyError(live.error, 'Could not load the results.')}</p>}
          {live.updatedAt !== null && competitions.map(c => {
            const d = live.data[c.id];
            if (!d) return null;
            const hasDraw = d.matches.length > 0;
            return (
              <div key={c.id} className="panel info live-comp">
                <h3>{c.name}</h3>
                {!hasDraw && <p className="muted">The draw has not been made yet.</p>}
                {hasDraw && <LivePools standings={d.standings} entries={d.entries} matches={d.matches} />}
                {hasDraw && <LiveBracket matches={d.matches} liveOk={live.connection === 'live'} />}
              </div>
            );
          })}
          {live.error != null && live.updatedAt !== null && <p className="src">Could not refresh just now. Showing the last results we have; trying again shortly.</p>}
        </section>
      )}
      {(fee || event.feeNote || (event.registrationMode === 'buhuros' && event.registrationClosesAt)) && (
        <section className="panel info" aria-labelledby="info-h">
          <h3 id="info-h">Good to know</h3>
          {fee && <p>{fee}</p>}
          {event.feeNote && <p style={{ color: 'var(--muted)' }}>{event.feeNote}</p>}
          {event.registrationMode === 'buhuros' && event.registrationClosesAt && <p style={{ color: 'var(--muted)' }}>Registration closes {new Date(event.registrationClosesAt).toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Edmonton' })} Mountain time.</p>}
        </section>
      )}
    </section>
  );
}
