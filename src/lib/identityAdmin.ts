import { demoFighters } from '../data/showcase';
import { findDuplicateCandidates } from './duplicates';
import { supabase } from './supabase';

export interface IdentityFighter {
  id:string;
  organizationId:string;
  name:string;
  nickname?:string;
  teamId?:string;
  userId?:string;
  active:boolean;
  mergedInto?:string;
}

const DEMO_KEY='buhurtos-demo-identity-fighters';
const seedDemo=():IdentityFighter[]=>[
  ...demoFighters.map(f=>({id:f.id,organizationId:'org-hacsa',name:f.name,nickname:f.fighterName!==f.name?f.fighterName:undefined,teamId:f.teamId,active:true})),
  {id:'garrett-legacy',organizationId:'org-hacsa',name:'Garret Robson',teamId:'reavers',active:true}
];

function readDemo():IdentityFighter[]{
  if(typeof localStorage==='undefined')return seedDemo();
  const stored=localStorage.getItem(DEMO_KEY);
  if(!stored){localStorage.setItem(DEMO_KEY,JSON.stringify(seedDemo()));return seedDemo();}
  try{return JSON.parse(stored);}catch{return seedDemo();}
}

export async function listIdentityFighters(organizationId:string):Promise<IdentityFighter[]>{
  if(!supabase)return readDemo().filter(f=>f.organizationId===organizationId);
  const {data,error}=await supabase.from('fighters').select('id,organization_id,display_name,nickname,team_id,user_id,is_active,deleted_at,notes').eq('organization_id',organizationId).order('display_name');
  if(error)throw error;
  return (data??[]).map((f:any)=>({id:f.id,organizationId:f.organization_id,name:f.display_name??f.name,nickname:f.nickname??undefined,teamId:f.team_id??undefined,userId:f.user_id??undefined,active:f.is_active&&!f.deleted_at,mergedInto:f.deleted_at?String(f.notes??'').match(/Merged into fighter ([0-9a-f-]+)/i)?.[1]:undefined}));
}

export async function findIdentityDuplicates(organizationId:string){
  const fighters=(await listIdentityFighters(organizationId)).filter(f=>f.active);
  const candidates=findDuplicateCandidates(fighters.map(f=>({id:f.id,name:f.name,secondary:f.teamId})),0.72);
  return candidates.map(candidate=>({candidate,left:fighters.find(f=>f.id===candidate.leftId)!,right:fighters.find(f=>f.id===candidate.rightId)!}));
}

export async function mergeFighterIdentity(sourceId:string,targetId:string,reason:string):Promise<void>{
  if(!reason.trim())throw new Error('A merge reason is required.');
  if(sourceId===targetId)throw new Error('Source and target must be different profiles.');
  if(!supabase){
    const rows=readDemo();
    const source=rows.find(f=>f.id===sourceId),target=rows.find(f=>f.id===targetId);
    if(!source||!target)throw new Error('Both fighter profiles must exist.');
    if(source.userId&&target.userId&&source.userId!==target.userId)throw new Error('Both profiles are claimed by different accounts.');
    const next=rows.map(f=>f.id===sourceId?{...f,active:false,mergedInto:targetId,userId:undefined}:f.id===targetId?{...f,userId:f.userId??source.userId}:f);
    localStorage.setItem(DEMO_KEY,JSON.stringify(next));return;
  }
  const {error}=await supabase.rpc('merge_fighter_profiles',{p_source_id:sourceId,p_target_id:targetId,p_reason:reason.trim()});
  if(error)throw error;
}
