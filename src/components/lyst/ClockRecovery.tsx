import type { useReliableTimer } from '../../lib/lyst/useReliableTimer';

export function ClockRecovery({clock}:{clock:ReturnType<typeof useReliableTimer>}){
  const {pendingTimer,timerBusy,clockOverride,setClockOverride,clockReason,setClockReason,restoreRound,setRestoreRound,restoreSeconds,setRestoreSeconds,sendTimer,executeTimer}=clock;
  return <>
      {clock.storageProblem&&!pendingTimer&&!clock.requiresClockCheck&&<p className="ly-note" role="alert">{clock.storageProblem}</p>}
      {clock.requiresClockCheck && <section className="panel info" role="alert" style={{display:'grid',gap:8}}>
        <b>Saved clock action could not be read</b>
        <p>Check the displayed clock and remaining time with the marshal. You can continue in memory with paper backup after that check. The original saved text will be kept.</p>
        {clock.unreadableClockAction!==null && <label className="field-in">Original saved clock action<textarea readOnly rows={4} value={clock.unreadableClockAction} /></label>}
        <button type="button" className="btn btn-line" disabled={timerBusy||clock.offline} onClick={clock.continueAfterClockCheck}>I checked with the marshal · continue with paper backup</button>
      </section>}
      {pendingTimer && <section className="panel info" role="status" style={{display:'grid',gap:8}}>
        <b>Unconfirmed clock action: {pendingTimer.command.action==='start'&&pendingTimer.command.mode==='break'?'end round and start break':pendingTimer.command.action==='start'&&pendingTimer.command.mode==='extended_break'?'start long break':pendingTimer.command.action}{pendingTimer.command.round?` · round ${pendingTimer.command.round}`:''}</b>
        <p>Saved at {new Date(pendingTimer.savedAt).toLocaleTimeString()}. Check the displayed clock. Retrying uses the same command and cannot restart an action the server already saved.</p>
        <button type="button" className="btn btn-line" disabled={timerBusy||clock.offline} onClick={()=>void executeTimer(pendingTimer)}>Retry this clock action</button>
        <button type="button" className="ly-link" disabled={timerBusy||clock.offline} onClick={clock.clearPending}>I checked the clock · clear this action</button>
        {clock.storageProblem && <p role="alert">{clock.storageProblem}</p>}
      </section>}
      {clockOverride && <section className="panel info" style={{display:'grid',gap:8}}>
        <b>Some phones have not saved this round</b>
        <p>Check them with the marshal. You can still start using paper or prepared offline counters; record the reason.</p>
        <label className="field-in">Reason for starting<input value={clockReason} maxLength={1000} onChange={e=>setClockReason(e.target.value)} /></label>
        <button type="button" className="btn btn-ink" disabled={timerBusy||clock.offline||clockReason.trim().length<3} onClick={()=>{
          const chosen=clockOverride;setClockOverride(null);sendTimer(chosen.action,{...chosen.options,overrideReason:clockReason.trim()});
        }}>Start with paper or offline counting</button>
        <button type="button" className="ly-link" onClick={()=>setClockOverride(null)}>Keep waiting for the phones</button>
      </section>}
      {restoreRound!==null && <section className="panel info" style={{display:'grid',gap:8}}>
        <b>Restore round {restoreRound} from the marshal’s clock</b>
        <label className="field-in">Seconds remaining<input type="number" min={1} max={3600} value={restoreSeconds} onChange={e=>setRestoreSeconds(e.target.value)} /></label>
        <label className="field-in">Reason<input value={clockReason} maxLength={1000} onChange={e=>setClockReason(e.target.value)} /></label>
        <button type="button" className="btn btn-ink" disabled={timerBusy||clock.offline||clockReason.trim().length<3||!Number.isInteger(Number(restoreSeconds))||Number(restoreSeconds)<1||Number(restoreSeconds)>3600} onClick={()=>{
          sendTimer('start',{mode:'fight',round:restoreRound,durationMs:Number(restoreSeconds)*1000,overrideReason:clockReason.trim()});setRestoreRound(null);
        }}>Start the remaining time</button>
      </section>}
  </>;
}
