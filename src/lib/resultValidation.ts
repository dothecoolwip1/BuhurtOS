import { demoMatches } from '../data/demo';
import type { MatchRecord, ValidationStatus } from '../types';
import { supabase } from './supabase';

export interface ValidationHistoryEntry {
  id:string;
  matchId:string;
  status:ValidationStatus;
  resultSnapshot:Record<string,unknown>;
  reason?:string;
  actorUserId?:string;
  createdAt:string;
}

const DEMO_MATCHES='buhurtos-demo-matches';
const DEMO_HISTORY='buhurtos-demo-validation-history';

function demoRows():MatchRecord[]{
  if(typeof localStorage==='undefined')return structuredClone(demoMatches);
  const stored=localStorage.getItem(DEMO_MATCHES);
  return stored?JSON.parse(stored):structuredClone(demoMatches);
}

export async function setMatchValidationStatus(match:MatchRecord,status:ValidationStatus,reason?:string):Promise<ValidationStatus>{
  const current=match.validationStatus??'in_progress';
  if((status==='disputed'||status==='corrected')&&!reason?.trim())throw new Error('A reason is required for a dispute or correction.');
  if((status==='validated'||status==='final')&&match.status!=='finalized')throw new Error('Only finalized matches can be validated.');
  if(status==='final'&&!['validated','corrected'].includes(current))throw new Error('Validate or correct the result before making it final.');
  if(!supabase){
    const rows=demoRows().map(row=>row.id===match.id?{...row,validationStatus:status}:row);
    localStorage.setItem(DEMO_MATCHES,JSON.stringify(rows));
    const history:ValidationHistoryEntry[]=JSON.parse(localStorage.getItem(DEMO_HISTORY)??'[]');
    history.unshift({id:crypto.randomUUID(),matchId:match.id,status,resultSnapshot:(match.resultSummary??{}) as Record<string,unknown>,reason:reason?.trim()||undefined,createdAt:new Date().toISOString()});
    localStorage.setItem(DEMO_HISTORY,JSON.stringify(history));
    return status;
  }
  const {data,error}=await supabase.rpc('set_match_validation_status',{p_match_id:match.id,p_status:status,p_expected_status:current,p_reason:reason?.trim()||null});
  if(error)throw error;
  return data as ValidationStatus;
}

export async function listValidationHistory(matchId:string):Promise<ValidationHistoryEntry[]>{
  if(!supabase){
    if(typeof localStorage==='undefined')return [];
    return (JSON.parse(localStorage.getItem(DEMO_HISTORY)??'[]') as ValidationHistoryEntry[]).filter(x=>x.matchId===matchId);
  }
  const {data,error}=await supabase.from('match_validation_history').select('*').eq('match_id',matchId).order('created_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,matchId:row.match_id,status:row.status,resultSnapshot:row.result_snapshot??{},reason:row.reason??undefined,actorUserId:row.actor_user_id??undefined,createdAt:row.created_at}));
}
