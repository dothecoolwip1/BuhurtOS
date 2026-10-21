import { deliverCounterAction } from '../../data/lyst';
import { uploadLegacyCounterAction } from '../../data/counterEvidence';
import { classifyRpcError } from '../scoreSender';
import type { CounterSend } from './counters';

/** The same transport for current and historical seats; server ownership and
 * assignment checks remain authoritative on every call. */
export function counterEvidenceSender(seatId:string):CounterSend{
  return async action=>{
    try{
      if(action.runId){
        const answer=await deliverCounterAction(seatId,action);
        return answer.status==='review'?{status:'review',total:answer.total,message:answer.reason??'Marshal review needed.'}:{status:answer.status,total:answer.total,weights:answer.weights};
      }
      const answer=await uploadLegacyCounterAction(seatId,action);
      return {status:'review',total:0,alreadyAccepted:answer.status==='already_accepted',message:answer.status==='already_accepted'
        ?'The server already accepted this older action. It was not replayed into the current fight.'
        :'The server kept this older action for review. Its original fight is unknown; check the phone and paper sheet.'};
    }catch(error){
      const classification=classifyRpcError(error);
      if(classification==='offline'||classification==='retry')return{status:'offline'};
      const message=(error as {message?:string}|null)?.message??'This evidence could not be delivered.';
      const reason=/ROUND_ENDED/.test(message)?'ROUND_ENDED':/ROUND_CHANGED/.test(message)?'ROUND_CHANGED':/ROUND_NOT_STARTED|WAITING_FOR_FIGHT/.test(message)?'ROUND_NOT_STARTED':'OTHER';
      return{status:'refused',reason,message};
    }
  };
}
