import { useEffect, useState, useSyncExternalStore } from 'react';
import { countUnfinishedBoards } from '../lib/boardStore';
import { activateUpdate, scoringGuard, updateNote, updateSafety, updateStore } from '../lib/swUpdate';
import { trackEvent } from '../lib/analytics';
import { outbox } from '../lib/useOutbox';

/**
 * "A new version is ready". Shown only when a waiting build exists. It never reloads the page by itself: while scoring or while this device
 * holds unconfirmed scoring work it says why it is waiting and offers an explicit emergency button instead.
 */
export function UpdateBanner() {
  const phase = useSyncExternalStore(updateStore.subscribe, () => updateStore.phase);
  const [tick, setTick] = useState(0);
  const [boards, setBoards] = useState(0);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => updateStore.subscribe(() => setTick(t => t + 1)), []);
  useEffect(() => outbox.subscribe(() => setTick(t => t + 1)), []);
  useEffect(() => {
    if (phase !== 'ready') return;
    let live = true;
    const read = () => { void countUnfinishedBoards().then(n => { if (live) setBoards(n); }); };
    read();
    const t = window.setInterval(read, 3000);
    return () => { live = false; window.clearInterval(t); };
  }, [phase, tick]);
  useEffect(() => { if (phase === 'ready') trackEvent('app_update_ready'); }, [phase]);

  if (phase !== 'ready') return null;
  const pending = outbox.pendingTotal();
  const safety = updateSafety({ scoringOpen: scoringGuard.open, pendingActions: pending, unfinishedBoards: boards });
  const go = (emergency: boolean) => { trackEvent('app_update_applied', { emergency }); activateUpdate(); };

  return (
    <div className="panel info" role="status" aria-live="polite" style={{ display: 'grid', gap: 8, margin: '8px 16px' }}>
      <b>A new version of BuhurtOS is ready.</b>
      {updateNote() && <span role="alert" className="src">{updateNote()}</span>}
      {safety.safe ? (
        <>
          <span className="src">Nothing is being scored on this device, so it is safe to update. The page will reload.</span>
          <button type="button" className="btn btn-ink" onClick={() => go(false)}>Update now</button>
        </>
      ) : (
        <>
          <span className="src">It will not replace this version while {safety.reasons.join(' and ')}. It will be offered again as soon as that is finished.</span>
          {!confirming && <button type="button" className="btn btn-line" onClick={() => setConfirming(true)}>Update anyway (emergency)</button>}
          {confirming && (
            <span style={{ display: 'grid', gap: 8 }}>
              <span className="src">Only do this if an organizer told you to. The page reloads. Scoring saved on this device is kept and is sent afterwards, but you will leave the match you are scoring.</span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ink" onClick={() => go(true)}>Yes, update now</button>
                <button type="button" className="btn btn-line" onClick={() => setConfirming(false)}>Not now</button>
              </span>
            </span>
          )}
        </>
      )}
    </div>
  );
}
