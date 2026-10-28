import { describe,expect,it } from 'vitest';
import type { LystState } from '../../data/lyst';
import { counterReviewReason,counterRoundEndedOnServer } from './delivery';
import type { LystTimer } from './timer';
const base={server_now:'2026-10-21T02:00:30Z',seats:[{id:'s',name:'Fictional Counter',slot:null,side:'a',role:'official',status:'active',tallies:[]}],
  counter_delivery:[{seat_id:'s',operator:'Fictional Counter',side:'a',role:'official',run_id:'r',round:1,run_status:'running',prepared_at:'2026-10-21T02:00:00Z',started_at:'2026-10-21T02:00:00Z',seen_at:'2026-10-21T02:00:29Z',pending:0,submitted:true}],counter_recovery:[]} satisfies Pick<LystState,'server_now'|'seats'|'counter_delivery'|'counter_recovery'>;
describe('marshal confirmation with missing phones',()=>{
  it('identifies the missing phone separately when two counters have the same name',()=>{
    const doubled={...base,seats:[base.seats[0],{...base.seats[0],id:'s2'}],counter_delivery:[{...base.counter_delivery[0],seat_id:'s2'}]};
    expect(counterReviewReason(doubled,1)).toContain('Fictional Counter (counter 1) has not saved this round');
    expect(counterReviewReason(doubled,1)).not.toContain('(counter 2)');
  });
  it('does not demand a filler reason just because a healthy round ended more than 20 seconds ago',()=>{
    const ended={...base,counter_delivery:[{...base.counter_delivery[0],run_status:'closed',closed_at:'2026-10-21T02:00:00Z',seen_at:'2026-10-21T01:59:58Z'}]};
    expect(counterReviewReason(ended,1)).toBeNull();
    expect(counterReviewReason({...ended,counter_delivery:[{...ended.counter_delivery[0],pending:1}]},1)).not.toBeNull();
    expect(counterReviewReason({...ended,counter_delivery:[{...ended.counter_delivery[0],seen_at:'2026-10-21T01:59:30Z'}]},1)).not.toBeNull();
  });
  it('accepts fresh, started and submitted phone evidence without adding friction',()=>{expect(counterReviewReason(base,1)).toBeNull();});
  it('provides a reason field for a missing receipt, missing Done, pending counts, or a stale phone',()=>{
    for(const extra of [{started_at:null},{submitted:false},{pending:1},{seen_at:'2026-10-21T01:00:00Z'}]){
      expect(counterReviewReason({...base,counter_delivery:[{...base.counter_delivery[0],...extra}]},1)).toMatch(/marshal/);
    }
  });
  it('does not turn an absent counter into a false all-clear',()=>{expect(counterReviewReason({...base,counter_delivery:[]},1)).not.toBeNull();});
  it('never requires a training counter to submit an official score',()=>{expect(counterReviewReason({...base,seats:[{...base.seats[0],role:'learning'}],counter_delivery:[]},1)).toBeNull();});
});

describe('automatic counter confirmation',()=>{
  const timer:LystTimer&{now_remaining_ms:number}={event_id:'e',field_key:'f',match_id:'m',round_no:1,mode:'fight',status:'running',duration_ms:60000,remaining_ms:60000,now_remaining_ms:60000,started_at:'2026-10-28T20:00:00Z',rev:1};
  it('waits for the server to report expiry instead of inferring it from an old response',()=>{
    const state={round:{no:1,status:'running' as const},timer,server_now:'2026-10-28T20:00:59Z'};
    expect(counterRoundEndedOnServer(state,1)).toBe(false);
    expect(counterRoundEndedOnServer({...state,server_now:'2026-10-28T20:01:00Z'},1)).toBe(true);
  });
  it('opens for a server-ended round but not a break, another round or a confirmed round',()=>{
    const state={round:{no:1,status:'running' as const},timer,server_now:'2026-10-28T20:01:30Z'};
    expect(counterRoundEndedOnServer({...state,round:{no:1,status:'confirming'}},1)).toBe(true);
    expect(counterRoundEndedOnServer({...state,timer:{...timer,mode:'break'}},1)).toBe(false);
    expect(counterRoundEndedOnServer(state,2)).toBe(false);
    expect(counterRoundEndedOnServer({...state,round:{no:1,status:'confirmed'}},1)).toBe(false);
  });
});
