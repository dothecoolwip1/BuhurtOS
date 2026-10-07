import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ReviewSheet } from '../../components/ReviewSheet';
import type { LiveCompetition, LiveEvent } from '../../data/api';
import { fetchCompetitionFacts } from '../../data/eventHome';
import type { ManagedRegistration } from '../../data/manage';
import { fetchPublishFacts, setEventStatus } from '../../data/setup';
import type { EventType } from '../../data/eventTypes';
import { friendlyError } from '../../lib/friendlyError';
import { buildable, journey, offeredOnly, STAGES, stageState, type ActionTarget, type JourneyAction } from '../../lib/eventJourney';
import { toolsOf } from '../../lib/eventControl';
import { controlPath, eventPath, legacyManageTarget } from '../../lib/eventPhaseView';
import { useAsync } from '../../lib/useAsync';
import { blockers, countByStatus } from '../../registration/review';
import { publishChecklist } from '../../registration/setup';

/** Where a journey action goes now: each old tab is a mode and a tool of Event Control. */
export const journeyHref = (slug: string, t: { tab: string; query?: string }): string => {
  const { mode, tool } = legacyManageTarget(t.tab);
  return `${controlPath(slug, mode, tool)}${t.query ? `&${t.query}` : ''}`;
};

/**
 * Event Control › Set up (Pack 25; the guided journey of Pack 09D, kept): where the event is, what needs attention, and the ONE thing to do next.
 * Every tool is one tap away below; nothing here is a new way to change data, only the way to find the existing one.
 */
export function SetupMode({ event, competitions, regs, running, onChanged }: {
  event: LiveEvent; competitions: LiveCompetition[]; regs: ManagedRegistration[]; running: boolean; onChanged: () => void;
}) {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const facts = useAsync(() => fetchCompetitionFacts(competitions), [competitions]);
  const pub = useAsync(() => fetchPublishFacts(event.id), [event.id, competitions.length]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const counts = countByStatus(regs);
  const accepted = regs.filter(r => r.status === 'accepted');
  const ready = accepted.filter(r => blockers(r).length === 0).length;
  const checks = publishChecklist({
    eventType: event.eventType as EventType, registrationMode: event.registrationMode, competitions: pub.data?.competitions ?? competitions.length, waivers: pub.data?.waivers ?? 0,
    hasClose: Boolean(event.registrationClosesAt), hasVenue: Boolean(event.venue || event.address), hasLink: Boolean(event.externalUrl)
  });
  const comps = facts.data ?? [];
  const j = journey({
    status: event.status, eventType: event.eventType, closed: !!event.closedAt, archived: !!event.archivedAt, competitions: comps,
    registrations: { pending: counts.pending, accepted: counts.accepted, total: regs.length }, checkin: { ready, accepted: accepted.length },
    publishBlockers: pub.data ? checks.filter(c => c.blocking && !c.ok).map(c => ({ key: c.key, label: c.label })) : [], eventDay: running
  });
  const created = params.get('created') === '1';
  const notes = (params.get('notes') ?? '').split('\n').filter(Boolean);
  const slug = event.slug;

  const go = async (t: ActionTarget) => {
    setProblem(null);
    if (t.to === 'tab') { nav(journeyHref(slug, t)); return; }
    if (t.to === 'public') { nav(eventPath(slug)); return; }
    if (t.to === 'review') { setReviewing(t.competitionId); return; }
    if (t.to === 'publish') {
      if (!window.confirm('Open registration? The event becomes public and people can sign up. You can switch it back to a draft in Event settings.')) return;
      setBusy(true);
      try { await setEventStatus(event.id, 'published'); onChanged(); }
      catch (e) { setProblem(friendlyError(e)); }
      finally { setBusy(false); }
    }
  };
  const actionButton = (a: JourneyAction, primary: boolean) => (
    <button key={a.label} type="button" className={primary ? 'btn btn-ink eh-primary' : 'btn btn-line'} disabled={busy} onClick={() => void go(a.target)} data-testid={primary ? 'journey-primary' : undefined}>
      <span>{a.label}</span>{primary && <small>{a.detail}</small>}
    </button>
  );

  const offered = comps.filter(offeredOnly);
  const built = comps.filter(c => c.record !== 'no_draw');
  const official = comps.filter(c => c.record === 'official');
  const fightsTotal = built.reduce((s, c) => s + c.fights, 0), fightsDone = built.reduce((s, c) => s + c.fightsDone, 0);
  const current = STAGES.find(([k]) => k === j.stage)?.[1] ?? '';

  return (
    <section className="eh" aria-label="Set up" style={{ display: 'grid', gap: 16 }} data-testid="control-setup">
      {created && (
        <div className="panel info eh-created" role="status">
          <b>Your event is created.</b> {event.status === 'draft' ? 'It is a private draft until you open registration.' : ''}
          {notes.length > 0 && <ul className="src" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{notes.map(n => <li key={n}>{n}</li>)}</ul>}
          <button type="button" className="linklike" onClick={() => { params.delete('created'); params.delete('notes'); setParams(params, { replace: true }); }}>Dismiss</button>
        </div>
      )}

      <ol className="eh-steps" aria-label={`Where the event is: ${current}`}>
        {STAGES.map(([k, label]) => {
          const st = stageState(j.stage, k);
          return <li key={k} className={`eh-step ${st}`} aria-current={st === 'current' ? 'step' : undefined}><span className="eh-dot" aria-hidden="true">{st === 'done' ? '✓' : ''}</span>{label}</li>;
        })}
      </ol>

      <div className="panel info eh-next" aria-labelledby="eh-next-h">
        <p className="eyebrow">What to do next</p>
        <h2 id="eh-next-h">{facts.loading && !facts.data ? 'Checking the event…' : j.headline}</h2>
        {j.primary && !(facts.loading && !facts.data) && actionButton(j.primary, true)}
        {j.secondary.length > 0 && <div className="eh-secondary">{j.secondary.map(a => actionButton(a, false))}</div>}
        {problem && <p role="alert" style={{ color: 'var(--live)' }}>{problem}</p>}
        {facts.error != null && <p role="alert">{friendlyError(facts.error, 'Could not read the competitions.')}</p>}
      </div>

      <div className="eh-cards">
        <Link className="panel info eh-card" to={controlPath(slug, 'setup', 'registrations')}>
          <span className="eyebrow">Registrations</span>
          <b>{regs.length}</b>
          <span className="src">{counts.pending > 0 ? `${counts.pending} waiting for you` : regs.length === 0 ? (event.status === 'published' ? 'None yet' : 'Opens when you open registration') : `${counts.accepted} accepted`}</span>
        </Link>
        <Link className="panel info eh-card" to={controlPath(slug, 'live', 'checkin')}>
          <span className="eyebrow">Check-in</span>
          <b>{ready} / {accepted.length}</b>
          <span className="src">{accepted.length === 0 ? 'Nobody accepted yet' : ready === accepted.length ? 'Everyone ready' : `${accepted.length - ready} not ready yet`}</span>
        </Link>
        <Link className="panel info eh-card" to={built.length > 0 ? controlPath(slug, 'results') : controlPath(slug, 'setup', 'competitions')}>
          <span className="eyebrow">Competitions</span>
          <b>{built.length > 0 ? `${official.length} / ${built.length}` : comps.length}</b>
          <span className="src">{built.length > 0 ? 'official' : `offered${comps.filter(buildable).length > 0 ? ` · ${comps.filter(buildable).length} ready to build` : ''}`}</span>
        </Link>
        {built.length > 0 && (
          <Link className="panel info eh-card" to={controlPath(slug, 'live')}>
            <span className="eyebrow">Fights</span>
            <b>{fightsDone} / {fightsTotal}</b>
            <span className="src">done · Live ops</span>
          </Link>
        )}
      </div>

      {offered.length > 0 && event.status === 'published' && (
        <p className="src eh-offered">Offered with fewer than 2 entrants (not run unless more register): {offered.map(c => c.name).join(', ')}.</p>
      )}

      <nav className="panel info eh-more" aria-label="Set-up tools">
        <h2 className="ed-h">Set-up tools</h2>
        <ul className="eh-more-list">
          {toolsOf('setup').map(t => (
            <li key={t.key}><Link to={controlPath(slug, 'setup', t.key)} data-testid={`tool-${t.key}`}><b>{t.label}</b><span className="src">{t.help}</span></Link></li>
          ))}
          <li><Link to={controlPath(slug, 'live', 'devices')}><b>Counters and devices</b><span className="src">The Counter QR, event phones and tablets, the stream laptop</span></Link></li>
          <li><Link to={eventPath(slug)}><b>Public event page</b><span className="src">What fighters and spectators see</span></Link></li>
        </ul>
      </nav>

      {reviewing && <ReviewSheet event={event} competition={competitions.find(c => c.id === reviewing)!} onClose={() => setReviewing(null)} onChanged={onChanged} />}
    </section>
  );
}
