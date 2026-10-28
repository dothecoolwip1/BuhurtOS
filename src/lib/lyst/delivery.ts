import type { CounterState, LystState } from '../../data/lyst';
import { remainingMs } from './timer';

/** An automatic counter prompt needs a fresh server response, not just a local countdown. */
export function counterRoundEndedOnServer(state: Pick<CounterState,'round'|'timer'|'server_now'>,round:number):boolean{
  if(state.round?.no!==round)return false;
  if(state.round.status==='confirming')return true;
  const at=Date.parse(state.server_now),timer=state.timer;
  return Number.isFinite(at)&&state.round.status==='running'&&timer?.mode==='fight'&&timer.status==='running'&&timer.round_no===round&&remainingMs(timer,at)<=0;
}

/** Same operational warning as the database guard. The database decides again
 * on submission; the UI gives the operator a usable reason field beforehand. */
export function counterReviewReason(state: Pick<LystState,'server_now'|'seats'|'counter_delivery'|'counter_recovery'>, round: number): string | null {
  const official = state.seats.filter(s => s.status === 'active' && s.role === 'official');
  const now = Date.parse(state.server_now);
  const missing = official.flatMap((s,index) => {
    const receipt = state.counter_delivery?.find(c => c.seat_id === s.id && c.round === round);
    const reference=receipt?.run_status==='closed'&&receipt.closed_at?Date.parse(receipt.closed_at):now;
    const label=`${s.name} (counter ${s.slot??index+1})`;
    if(!receipt?.prepared_at)return [`${label} has not saved this round.`];
    if(!receipt.started_at)return [`${label} has not confirmed receiving the start.`];
    if(!receipt.submitted)return [`${label} has not confirmed their count.`];
    if((receipt.pending??0)>0)return [`${label} reported ${receipt.pending} unsent actions.`];
    if(!receipt.seen_at || !Number.isFinite(reference) || !Number.isFinite(Date.parse(receipt.seen_at)) || reference-Date.parse(receipt.seen_at)>20000)return [`${label} has not reported recently enough.`];
    return [];
  });
  const held = state.counter_recovery?.some(e => e.round === round && e.role === 'official' && !e.decision);
  return missing.length || held ? [...missing,...(held?['Saved counter actions need marshal review.']:[]),'Check with the marshal and enter why these awarded scores are correct.'].join(' ') : null;
}
