import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { SignIn } from '../../auth/SignIn';
import { CounterQrCard } from '../../components/command/CounterQrCard';
import { DevicesPanel } from '../../components/command/DevicesPanel';
import { Chip, PageHead, Seg } from '../../components/ui';
import { fetchEvent, fetchMyEventContext } from '../../data/api';
import { fetchRegistrations, type ManagedRegistration } from '../../data/manage';
import { TOOLS, modesFor, toolFor } from '../../lib/eventControl';
import { MODE_WORD, PHASE_TONE, PHASE_WORD, controlPath, defaultModeFor, eventPath, eventPhaseOf, isControlMode, type ControlMode } from '../../lib/eventPhaseView';
import { hasDeviceSession } from '../../lib/devices';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useEventRecordWatch } from '../../lib/useEventRecordWatch';
import { BroadcastTab } from '../BroadcastTab';
import { BuildTournamentTab } from '../BuildTournamentTab';
import { CheckinPanel } from '../CheckinPanel';
import { CompetitionsTab } from '../CompetitionsTab';
import { FightersTab } from '../FightersTab';
import { FinalizeTab } from '../FinalizeTab';
import { NotFoundPage } from '../NotFoundPage';
import { PeopleTab } from '../PeopleTab';
import { RunTab } from '../RunTab';
import { SetupTab } from '../SetupTab';
import { TeamsTab } from '../TeamsTab';
import { LiveOps } from './LiveOps';
import { SetupMode } from './SetupMode';
import { RegistrationsTool } from './RegistrationsTool';

/** Who may open Event Control at all (display only; the database decides every read and write): organizers and the people who run the day. */
export const CONTROL_ROLES = ['organizer', 'head_marshal', 'scorekeeper', 'operator', 'owner'];

/**
 * EVENT CONTROL (Pack 25): the one staff door of an event. It is phase aware: it opens on the mode the day needs (Set up before the event, Live ops while it
 * runs, Results after) and an organizer can switch to any mode at any time. A TOOL (?tool=) is one focused job that opens from a mode and comes back to it.
 * Everything the old Manage tabs, Event home, Event day and the Command Centre did is here, once; their old addresses redirect here.
 */
export function EventControlPage() {
  const { eventId: slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id;
  const [eventKey, setEventKey] = useState(0);
  const [regsKey, setRegsKey] = useState(0);
  const loaded = useAsync(() => fetchEvent(slug), [slug], [eventKey]);
  const eventId = loaded.data?.event.id;
  // a competition becoming official, or the event closing, re-reads the event (realtime, with a slow poll behind it)
  useEventRecordWatch(eventId, () => setEventKey(k => k + 1));
  const mine = useAsync(() => (eventId && (userId || hasDeviceSession()) ? fetchMyEventContext(eventId, userId ?? '') : Promise.resolve(undefined)), [eventId, userId]);
  const organizer = mine.data?.isOrganizer === true;
  const regs = useAsync(() => (eventId && organizer ? fetchRegistrations(eventId) : Promise.resolve([] as ManagedRegistration[])), [eventId, organizer], [regsKey]);
  const event = loaded.data?.event;
  const phase = event ? eventPhaseOf(event) : 'upcoming';
  const wantedMode = params.get('mode');
  const modes = modesFor(organizer);
  const mode: ControlMode = isControlMode(wantedMode) && modes.includes(wantedMode) ? wantedMode : modes.includes(defaultModeFor(phase)) ? defaultModeFor(phase) : 'live';
  const tool = organizer ? toolFor(params.get('tool')) : undefined;
  useDocumentTitle(event ? `${tool ? tool.label : MODE_WORD[mode]} · ${event.name}` : 'Event Control');

  if (authLoading || (loaded.loading && !loaded.data)) return <p className="muted" role="status">Loading…</p>;
  if (loaded.error != null) return <p role="alert">{friendlyError(loaded.error, 'Could not load this event.')}</p>;
  if (!loaded.data || !event) return <NotFoundPage />;
  const device = !session && hasDeviceSession();
  if (!session && !device) return <><PageHead eyebrow="Event Control" title={event.name} /><SignIn reason="Sign in with the account that organizes this event, or as its head marshal or secretary." /></>;
  if (mine.loading && !mine.data) return <p className="muted" role="status">Loading…</p>;
  const staff = organizer || (mine.data?.roles.some(r => CONTROL_ROLES.includes(r)) ?? false);
  if (!staff) {
    return (
      <section style={{ display: 'grid', gap: 14 }}>
        <PageHead eyebrow="Event Control" title="This is for the people who run this event" lede="Its organizers, head marshal and secretary open Event Control. If that should be you, ask the event's organizer to add your account." />
        <Link className="btn btn-line" to={eventPath(event.slug)}>Back to the event</Link>
      </section>
    );
  }
  const { competitions } = loaded.data;
  const changed = () => { setEventKey(k => k + 1); setRegsKey(k => k + 1); };
  const setMode = (m: ControlMode) => setParams({ mode: m }, { replace: true });
  const all = regs.data ?? [];
  const pending = all.filter(r => r.status === 'pending').length;

  return (
    <section className="fade-in ctl" data-testid="event-control" data-mode={mode} data-tool={tool?.key ?? ''}>
      <header className="ctl-head">
        <div className="ctl-top">
          <p className="eyebrow">Event Control</p>
          <Link className="ctl-back" to={eventPath(event.slug)} data-testid="control-exit">Event page →</Link>
        </div>
        <h1 className="ctl-title">{event.name}</h1>
        <p className="ctl-meta"><Chip tone={PHASE_TONE[phase]}>{PHASE_WORD[phase]}</Chip>{event.status === 'cancelled' && <Chip>Cancelled</Chip>}{organizer && pending > 0 && <Link to={controlPath(event.slug, 'setup', 'registrations')} className="ctl-pending">{pending} registration{pending === 1 ? '' : 's'} waiting</Link>}</p>
        {modes.length > 1 && !tool && (
          <div className="ctl-modes"><Seg label="Mode" value={mode} options={modes.map(m => [m, MODE_WORD[m]] as const)} onChange={setMode} /></div>
        )}
        {tool && (
          <nav className="ctl-tool-nav" aria-label="Tool">
            <Link className="btn btn-line btn-sm" to={controlPath(event.slug, mode)} data-testid="tool-back">← {MODE_WORD[mode]}</Link>
            <h2 className="ctl-tool-title">{tool.label}</h2>
          </nav>
        )}
      </header>

      {!tool && mode === 'setup' && <SetupMode key={event.id} event={event} competitions={competitions} regs={all} running={phase === 'live'} onChanged={changed} />}
      {!tool && mode === 'live' && <LiveOps key={event.id} event={event} competitions={competitions} organizer={organizer} onEventChanged={changed} />}
      {!tool && mode === 'results' && (
        <>
          <FinalizeTab key={event.id} event={event} competitions={competitions} onChanged={changed} />
          <p className="src">Something still being fought? <Link to={controlPath(event.slug, 'live')}>Live ops</Link> has the fields and the review of each competition.</p>
        </>
      )}

      {tool?.key === 'settings' && <SetupTab key={event.id} event={event} onChanged={changed} />}
      {tool?.key === 'competitions' && <CompetitionsTab key={event.id} event={event} onChanged={changed} />}
      {tool?.key === 'registrations' && <RegistrationsTool event={event} regs={all} loading={regs.loading} error={regs.error} onChanged={() => setRegsKey(k => k + 1)} />}
      {tool?.key === 'entrants' && <FightersTab key={`${event.id}-${competitions.length}`} eventId={event.id} competitions={competitions} registrationMode={event.registrationMode} regs={all} slug={event.slug} />}
      {tool?.key === 'staff' && <PeopleTab eventId={event.id} myUserId={userId} />}
      {tool?.key === 'teams' && <TeamsTab />}
      {tool?.key === 'broadcast' && <BroadcastTab key={event.id} event={event} />}
      {tool?.key === 'build' && <BuildTournamentTab key={event.id} event={event} competitions={competitions} onChanged={changed} />}
      {tool?.key === 'run' && <RunTab key={event.id} event={event} competitions={competitions} />}
      {tool?.key === 'checkin' && (
        <>
          <p className="panel info" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}><Link className="btn btn-ink" to={`/events/${event.slug}/checkin?from=control`}>Open the check-in desk</Link><span className="src">Arrivals, armour inspection with what needs fixing, weigh-in and who is ready, for desk staff and inspectors too.</span></p>
          <CheckinPanel regs={all} loading={regs.loading} onChanged={() => setRegsKey(k => k + 1)} />
        </>
      )}
      {tool?.key === 'devices' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <CounterQrCard eventId={event.id} />
          <DevicesPanel eventId={event.id} eventName={event.name} timezone={event.timezone ?? 'America/Edmonton'} refreshKey={eventKey} />
        </div>
      )}
      {tool && <p className="src ctl-tool-foot">{TOOLS.find(t => t.key === tool.key)?.help}. <Link to={controlPath(event.slug, mode)}>Back to {MODE_WORD[mode]}</Link>.</p>}
    </section>
  );
}
