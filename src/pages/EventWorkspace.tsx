import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Chip, PageHead } from '../components/ui';
import { fetchEvent, fetchMyEventContext, type LeagueKey, type LiveCompetition, type LiveEvent, type MyEventContext } from '../data/api';
import { dateRange, registrationWindow } from '../lib/dates';
import { friendlyError } from '../lib/friendlyError';
import { useAsync } from '../lib/useAsync';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { PROVINCES, formatMoney } from '../registration/model';
import { NotFoundPage } from './NotFoundPage';

const LEAGUE_TITLE: Record<LeagueKey, string> = { buhurt: 'Group fights', duels: 'Duels', outrance: 'Profights', hacsa: 'HACSA events' };
const GENDER: Record<LiveCompetition['gender'], string> = { open: 'Open', men: 'Men', women: 'Women' };
const provinceName = (code: string) => PROVINCES.find(([k]) => k === code)?.[1] ?? code;

function feeText(e: LiveEvent): string | null {
  if (e.feeCents <= 0) return null;
  const amount = formatMoney(e.feeCents);
  return e.feeProvince ? `${amount} for fighters from ${provinceName(e.feeProvince)}. Fighters from elsewhere and volunteers pay nothing.` : `${amount} per fighter. Volunteers pay nothing.`;
}

function RegistrationCard({ event, mine, signedIn }: { event: LiveEvent; mine: MyEventContext | undefined; signedIn: boolean }) {
  const win = registrationWindow(event.registrationOpensAt, event.registrationClosesAt);
  const reg = mine?.registration;
  const to = `/events/${event.slug}/register`;
  if (reg) {
    const word = reg.status === 'accepted' ? 'Accepted' : reg.status === 'declined' ? 'Declined' : reg.status === 'withdrawn' ? 'Withdrawn' : 'Waiting for review';
    return (
      <section className="panel info" aria-labelledby="mine-h">
        <h3 id="mine-h">Your registration</h3>
        <p><Chip tone={reg.status === 'accepted' ? 'win' : 'brass'}>{word}</Chip></p>
        {reg.feeDueCents > 0 && <p style={{ color: 'var(--muted)' }}>Fee: <b>{formatMoney(reg.feeDueCents)}</b> · {reg.feePaid ? 'paid' : 'not marked paid yet'}</p>}
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
        {event.status === 'draft' && <> The event is a <b>draft</b>: only organizers can see it.</>}
      </p>
      <p><Link className="btn btn-ink" to={`/events/${event.slug}/manage`}>Review registrations and check people in</Link></p>
      <p className="src">Setup, people and the draw are the next screens to arrive in this workspace.</p>
    </section>
  );
}

export function EventWorkspace() {
  const { eventId: slug = '' } = useParams();
  const { session } = useAuth();
  const userId = session?.user.id;
  const loaded = useAsync(() => fetchEvent(slug), [slug]);
  const eventId = loaded.data?.event.id;
  const mine = useAsync(() => (eventId && userId ? fetchMyEventContext(eventId, userId) : Promise.resolve(undefined)), [eventId, userId]);
  useDocumentTitle(loaded.data?.event.name ?? 'Event');

  if (loaded.loading) return <p className="muted">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error, 'Could not load this event.')}</p>;
  if (!loaded.data) return <NotFoundPage />;

  const { event, competitions } = loaded.data;
  const groups = (['buhurt', 'duels', 'outrance', 'hacsa'] as LeagueKey[]).map(l => [l, competitions.filter(c => c.league === l)] as const).filter(([, list]) => list.length > 0);
  const where = [event.venue, event.address, [event.city, event.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const fee = feeText(event);

  return (
    <section className="fade-in" style={{ display: 'grid', gap: 22 }}>
      <PageHead eyebrow={event.status === 'draft' ? 'Draft: only organizers can see this' : event.eventType} title={event.name} lede={event.description || undefined} />
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <Chip>{dateRange(event.startsOn, event.endsOn)}</Chip>
        {where && <p style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>{where}</p>}
      </div>
      {mine.data?.isOrganizer && <OrganizerPanel event={event} mine={mine.data} />}
      <RegistrationCard event={event} mine={mine.data} signedIn={Boolean(session)} />
      <section aria-labelledby="comp-h" style={{ display: 'grid', gap: 14 }}>
        <h2 id="comp-h">Competitions</h2>
        {groups.length === 0 && <p className="muted">No competitions have been added yet.</p>}
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
      </section>
      {(fee || event.feeNote || event.registrationClosesAt) && (
        <section className="panel info" aria-labelledby="info-h">
          <h3 id="info-h">Good to know</h3>
          {fee && <p>{fee}</p>}
          {event.feeNote && <p style={{ color: 'var(--muted)' }}>{event.feeNote}</p>}
          {event.registrationClosesAt && <p style={{ color: 'var(--muted)' }}>Registration closes {new Date(event.registrationClosesAt).toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Edmonton' })} Mountain time.</p>}
        </section>
      )}
    </section>
  );
}
