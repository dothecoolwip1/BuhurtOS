import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CommandSection } from './CommandSection';
import { useNow, usePoll } from './hooks';
import { fetchBroadcastState, setBroadcastControl } from '../../data/broadcastControl';
import {
  STALE_MESSAGE, broadcastAccess, controllerAge, isTaken, lystChoices, manualKeepingWhatIsOn, panelStatus, parseHeartbeat, patches, type BroadcastControl, type Patch, type StatusLine
} from '../../lib/broadcastView';
import { manageHref } from '../../lib/commandCentre';
import { friendlyError } from '../../lib/friendlyError';
import { useAsync } from '../../lib/useAsync';
import '../../styles/command181.css';

const POLL_MS = 5000;

/**
 * Broadcast, in a few lines: is the stream laptop connected, AUTO or MANUAL, what is on air, the music and the camera safety state.
 * Anyone who can read the Command Centre sees it; only an organizer or Temporary Organizer is offered the controls (the database decides on every
 * press, and refuses a stale press instead of overwriting someone else). This is not an OBS console: no scenes, no sources, no stream key.
 * Camera Off has its own control at the top of the page.
 */
export function BroadcastPanel({ eventId, slug, fieldNames, configured, organizer, refreshKey }: {
  eventId: string; slug: string; fieldNames: readonly string[]; configured: boolean; organizer: boolean; refreshKey: number;
}) {
  const [key, setKey] = useState(0);
  const readAt = useRef(Date.now());
  const st = useAsync(async () => { const s = await fetchBroadcastState(eventId); readAt.current = Date.now(); return s; }, [eventId], [refreshKey, key]);
  usePoll(POLL_MS, () => setKey(k => k + 1));
  const now = useNow(5000);
  const [applied, setApplied] = useState<BroadcastControl | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const data = st.data;
  if (!data) {
    const refused = (st.error as { code?: string } | null)?.code === '42501';
    if (refused) return null;                                   // this viewer may not see the broadcast state: show nothing rather than an error
    return (
      <CommandSection id="cc-broadcast" title="Broadcast" open>
        {st.error != null ? <p role="alert">{friendlyError(st.error, 'Could not load the broadcast state.')} <button type="button" className="linklike" onClick={() => st.reload()}>Try again</button></p> : <p className="src">Loading…</p>}
      </CommandSection>
    );
  }
  const control = applied && applied.rev > data.control.rev ? applied : data.control;
  const age = controllerAge(data.controller, readAt.current, now);
  const status = panelStatus({ control, camera: data.camera, controller: data.controller, ageSeconds: age });
  const access = broadcastAccess(data);
  const hb = data.controller ? parseHeartbeat(data.controller.status) : null;
  const lysts = lystChoices(fieldNames);

  const press = async (patch: Patch) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await setBroadcastControl(eventId, control.rev, patch);
      setApplied(r.control);
      if (r.status === 'stale') setMsg({ ok: false, text: STALE_MESSAGE });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e, 'That did not go through. Try again.') }); }
    finally { setBusy(false); setKey(k => k + 1); }
  };

  const badge = status.noController ? 'No controller' : status.stale ? 'Controller silent' : control.mode === 'manual' ? 'MANUAL' : 'AUTO';
  return (
    <CommandSection id="cc-broadcast" title="Broadcast" badge={badge} open>
      <p className={`bc-ctl tone-${status.controller.tone}`} role="status" data-testid="bc-controller">
        <b>{status.noController ? 'Stream controller not connected' : `Stream controller: ${status.controller.value}`}</b>
        {status.controller.note && <span className="src"> {status.controller.note}</span>}
        {status.noController && <span className="src"> {data.controllerExists ? 'A code exists but the laptop is not reporting. Is the BuhurtOS Broadcast Companion running?' : 'No stream laptop code has been made for this event.'} The stream is not being followed or monitored from here.</span>}
      </p>
      {status.problems.length > 0 && <ul className="bc-problems">{status.problems.map(p => <li key={p}>⚠ {p}</li>)}</ul>}
      <dl className={`bc-lines${status.stale ? ' is-stale' : ''}`} data-testid="bc-lines">{status.lines.map(l => <Line key={l.id} l={l} />)}</dl>
      {status.alsoLive.length > 0 && <p className="bc-also" data-testid="bc-also">Also live: {status.alsoLive.join(' · ')}</p>}
      {st.refreshError != null && <p className="src" role="status">Not updating. Showing the last state.</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'dev-ok' : 'err'} data-testid="bc-msg">{msg.text}</p>}

      {access === 'control' && (
        <div className="bc-controls" data-testid="bc-controls">
          <div className="bc-group" role="group" aria-label="Mode">
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.mode === 'auto'} disabled={busy || control.mode === 'auto'} onClick={() => void press(patches.auto())}>AUTO</button>
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.mode === 'manual'} disabled={busy || control.mode === 'manual'} onClick={() => void press(manualKeepingWhatIsOn(control, hb))}>MANUAL</button>
          </div>
          {control.mode === 'manual' && <button type="button" className="btn btn-ink bc-btn bc-return" disabled={busy} onClick={() => void press(patches.auto())}>Return to Auto</button>}
          <div className="bc-group" role="group" aria-label="Show on the stream">
            {lysts.length === 0 && <p className="src">No Lyst has fights yet.</p>}
            {lysts.map(l => <button key={l.field} type="button" className="btn btn-line bc-btn" aria-pressed={isTaken(control, l.field)} disabled={busy} onClick={() => void press(patches.takeLyst(l.field))}>Take {l.label}</button>)}
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.mode === 'manual' && control.targetKind === 'holding'} disabled={busy} onClick={() => void press(patches.holding())}>Holding / Between fights</button>
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.mode === 'manual' && control.targetKind === 'break'} disabled={busy} onClick={() => void press(patches.breakScreen())}>Break</button>
          </div>
          <div className="bc-group" role="group" aria-label="Music">
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.musicMode === 'muted'} disabled={busy} onClick={() => void press(patches.music('muted'))}>Mute</button>
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.musicMode === 'auto'} disabled={busy} onClick={() => void press(patches.music('auto'))}>Unmute</button>
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.musicMode === 'paused'} disabled={busy} onClick={() => void press(patches.music('paused'))}>Pause</button>
          </div>
          <div className="bc-group" role="group" aria-label="Auto Duck">
            <button type="button" className="btn btn-line bc-btn" aria-pressed={control.autoDuck} disabled={busy} onClick={() => void press(patches.duck(true))}>Auto Duck On</button>
            <button type="button" className="btn btn-line bc-btn" aria-pressed={!control.autoDuck} disabled={busy} onClick={() => void press(patches.duck(false))}>Auto Duck Off</button>
          </div>
          <p className="src">{control.updatedByLabel ? `Last changed by ${control.updatedByLabel}. ` : ''}Camera Off is the red button at the top of the page.</p>
        </div>
      )}
      <p className="src">{configured ? 'A livestream address is set for this event.' : 'No livestream address is set.'}</p>
      {organizer ? <p><Link className="btn btn-line cc-btn" to={manageHref(slug, 'broadcast')}>Broadcast settings</Link></p> : <p className="src">Organizers manage the broadcast settings.</p>}
    </CommandSection>
  );
}

function Line({ l }: { l: StatusLine }) {
  return (
    <div className={`bc-line tone-${l.tone}`} data-line={l.id}>
      <dt>{l.label}</dt>
      <dd><b>{l.value}</b>{l.note && <span className="src"> {l.note}</span>}</dd>
    </div>
  );
}
