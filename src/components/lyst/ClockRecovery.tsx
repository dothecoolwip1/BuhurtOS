import type { useReliableTimer } from '../../lib/lyst/useReliableTimer';
import { useState } from 'react';
import { Dialog } from '../Dialog';

export function ClockRecovery({clock}:{clock:ReturnType<typeof useReliableTimer>}){
  const {pendingTimer,timerBusy,clockOverride,setClockOverride,clockReason,setClockReason,restoreRound,setRestoreRound,restoreSeconds,setRestoreSeconds,sendTimer,executeTimer}=clock;
  const [dismissed,setDismissed]=useState<string|null>(null);
  const kind=clock.requiresClockCheck?'check':clockOverride?'override':restoreRound!==null?'restore':pendingTimer&&!timerBusy?'pending':clock.storageProblem&&!pendingTimer?'storage':null;
  const key=kind?`${clock.contextKey}:${kind}:${pendingTimer?.command.command??''}:${restoreRound??''}:${clock.attentionSerial}`:null;
  const close=()=>{setDismissed(key);if(clockOverride)setClockOverride(null);if(restoreRound!==null)setRestoreRound(null);};
  if(!kind||timerBusy)return null;
  if(key===dismissed)return <button type="button" className="btn btn-line ly-clock-attention" onClick={()=>setDismissed(null)}>Clock needs attention · review</button>;
  const title=kind==='override'?'Start paused: counter phones are not ready':kind==='restore'?`Restore round ${restoreRound}`:kind==='pending'?'Clock action needs confirmation':kind==='check'?'Check the saved clock action':'Clock backup needs attention';
  return <Dialog title={title} onClose={close} busy={timerBusy} dismissOnBackdrop={false}>
      {kind==='storage'&&<p className="ly-note" role="alert">{clock.storageProblem}</p>}
      {kind==='check' && <>
        <b>Saved clock action could not be read</b>
        <p>Check the displayed clock and remaining time with the marshal. You can continue in memory with paper backup after that check. The original saved text will be kept.</p>
        {clock.unreadableClockAction!==null && <label className="field-in">Original saved clock action<textarea readOnly rows={4} value={clock.unreadableClockAction} /></label>}
        <button type="button" className="btn btn-line" disabled={timerBusy||clock.offline} onClick={clock.continueAfterClockCheck}>I checked with the marshal · continue with paper backup</button>
      </>}
      {kind==='pending'&&pendingTimer && <>
        <b>Unconfirmed clock action: {pendingTimer.command.action==='start'&&pendingTimer.command.mode==='break'?'end round and start break':pendingTimer.command.action==='start'&&pendingTimer.command.mode==='extended_break'?'start long break':pendingTimer.command.action}{pendingTimer.command.round?` · round ${pendingTimer.command.round}`:''}</b>
        <p>Saved at {new Date(pendingTimer.savedAt).toLocaleTimeString()}. Check the displayed clock. Retrying uses the same command and cannot restart an action the server already saved.</p>
        <button type="button" className="btn btn-line" disabled={timerBusy||clock.offline} onClick={()=>void executeTimer(pendingTimer)}>Retry this clock action</button>
        <button type="button" className="ly-link" disabled={timerBusy||clock.offline} onClick={clock.clearPending}>I checked the clock · clear this action</button>
        {clock.storageProblem && <p role="alert">{clock.storageProblem}</p>}
      </>}
      {kind==='override'&&clockOverride && <>
        <b>Some phones have not saved this round</b>
        <p>The round has not started. Check the phones with the marshal. To start using paper or prepared offline counters, enter the marshal’s reason below.</p>
        <label className="field-in">Reason for starting<input data-autofocus value={clockReason} maxLength={1000} aria-required="true" placeholder="For example: marshal approved paper counting" onChange={e=>setClockReason(e.target.value)} /></label>
        <button type="button" className="btn btn-ink" disabled={timerBusy||clock.offline||clockReason.trim().length<3} onClick={()=>{
          const chosen=clockOverride;setClockOverride(null);sendTimer(chosen.action,{...chosen.options,overrideReason:clockReason.trim()});
        }}>Start with paper or offline counting</button>
        <button type="button" className="ly-link" onClick={()=>setClockOverride(null)}>Keep waiting for the phones</button>
      </>}
      {kind==='restore'&&restoreRound!==null && <>
        <b>Restore round {restoreRound} from the marshal’s clock</b>
        <label className="field-in">Seconds remaining<input type="number" min={1} max={3600} value={restoreSeconds} onChange={e=>setRestoreSeconds(e.target.value)} /></label>
        <label className="field-in">Reason<input value={clockReason} maxLength={1000} onChange={e=>setClockReason(e.target.value)} /></label>
        <button type="button" className="btn btn-ink" disabled={timerBusy||clock.offline||clockReason.trim().length<3||!Number.isInteger(Number(restoreSeconds))||Number(restoreSeconds)<1||Number(restoreSeconds)>3600} onClick={()=>{
          sendTimer('start',{mode:'fight',round:restoreRound,durationMs:Number(restoreSeconds)*1000,overrideReason:clockReason.trim()});setRestoreRound(null);
        }}>Start the remaining time</button>
      </>}
      {kind!=='override'&&<button type="button" className="btn btn-line" onClick={close}>Back to the clock</button>}
  </Dialog>;
}
