import { supabase } from './supabase';
import { generateSeededPools, type PoolSeed } from './pools';
import type { CorrectionRequest, EventDivision, PoolEntryRecord, PoolRecord, RingRecord, RingStatus, ScheduleItem, UUID } from '../types';

const key=(name:string,eventId:string)=>`buhurtos-demo-${name}-${eventId}`;
const read=<T,>(storageKey:string,fallback:T):T=>{
  if(typeof localStorage==='undefined')return fallback;
  const value=localStorage.getItem(storageKey);
  if(!value)return fallback;
  try{return JSON.parse(value) as T;}catch{return fallback;}
};
const write=<T,>(storageKey:string,value:T)=>{if(typeof localStorage!=='undefined')localStorage.setItem(storageKey,JSON.stringify(value));};

const demoDivisions=(eventId:string):EventDivision[]=>[
  {id:'div-duel',eventId,name:'Longsword',disciplineKey:'longsword',advancementConfig:{kind:'pools_to_elimination',advancePerPool:2},seedingConfig:{method:'manual_then_random',antiFratricide:true},status:'open',sortOrder:1},
  {id:'div-sb',eventId,name:'Sword & Buckler',disciplineKey:'sword_buckler',advancementConfig:{kind:'pools_to_elimination',advancePerPool:2},seedingConfig:{method:'ranking',antiFratricide:true},status:'open',sortOrder:2},
  {id:'div-5v5',eventId,name:'5v5',disciplineKey:'5v5',teamMin:5,teamMax:8,advancementConfig:{kind:'pools_to_elimination',advancePerPool:2},seedingConfig:{method:'ranking',antiFratricide:true},status:'open',sortOrder:3}
];

export async function listEventDivisions(eventId:UUID):Promise<EventDivision[]>{
  if(!supabase)return read(key('divisions',eventId),demoDivisions(eventId));
  const {data,error}=await supabase.from('event_divisions').select('*').eq('event_id',eventId).order('sort_order');
  if(error)throw error;
  return (data??[]).map((d:any)=>({id:d.id,eventId:d.event_id,rulesetVersionId:d.ruleset_version_id??undefined,name:d.name,disciplineKey:d.discipline_key,genderDivision:d.gender_division??undefined,ageMin:d.age_min??undefined,ageMax:d.age_max??undefined,weightMinKg:d.weight_min_kg??undefined,weightMaxKg:d.weight_max_kg??undefined,teamMin:d.team_min??undefined,teamMax:d.team_max??undefined,registrationCap:d.registration_cap??undefined,advancementConfig:d.advancement_config??{},seedingConfig:d.seeding_config??{},status:d.status,sortOrder:d.sort_order}));
}

export async function createEventDivision(eventId:UUID,input:Pick<EventDivision,'name'|'disciplineKey'> & Partial<EventDivision>):Promise<EventDivision>{
  const base:EventDivision={id:crypto.randomUUID(),eventId,name:input.name,disciplineKey:input.disciplineKey,rulesetVersionId:input.rulesetVersionId,genderDivision:input.genderDivision,ageMin:input.ageMin,ageMax:input.ageMax,weightMinKg:input.weightMinKg,weightMaxKg:input.weightMaxKg,teamMin:input.teamMin,teamMax:input.teamMax,registrationCap:input.registrationCap,advancementConfig:input.advancementConfig??{kind:'pools_to_elimination',advancePerPool:2},seedingConfig:input.seedingConfig??{method:'manual',antiFratricide:true},status:input.status??'open',sortOrder:input.sortOrder??0};
  if(!supabase){
    const storageKey=key('divisions',eventId), rows=read(storageKey,demoDivisions(eventId));
    if(rows.some(row=>row.name.toLowerCase()===base.name.toLowerCase()))throw new Error('A division with that name already exists.');
    write(storageKey,[...rows,base]); return base;
  }
  const {data,error}=await supabase.from('event_divisions').insert({event_id:eventId,ruleset_version_id:base.rulesetVersionId??null,name:base.name,discipline_key:base.disciplineKey,gender_division:base.genderDivision??null,age_min:base.ageMin??null,age_max:base.ageMax??null,weight_min_kg:base.weightMinKg??null,weight_max_kg:base.weightMaxKg??null,team_min:base.teamMin??null,team_max:base.teamMax??null,registration_cap:base.registrationCap??null,advancement_config:base.advancementConfig,seeding_config:base.seedingConfig,status:base.status,sort_order:base.sortOrder}).select('*').single();
  if(error)throw error;
  return {...base,id:data.id};
}

export async function listPools(eventId:UUID,divisionId?:UUID):Promise<Array<PoolRecord & {entries:PoolEntryRecord[]}>>{
  if(!supabase){
    const rows=read<Array<PoolRecord & {entries:PoolEntryRecord[]}>>(key('pools',eventId),[]);
    return divisionId?rows.filter(row=>row.divisionId===divisionId):rows;
  }
  let query=supabase.from('pools').select('*,pool_entries(*)').eq('event_id',eventId).order('name');
  if(divisionId)query=query.eq('division_id',divisionId);
  const {data,error}=await query;
  if(error)throw error;
  return (data??[]).map((p:any)=>({id:p.id,eventId:p.event_id,divisionId:p.division_id,name:p.name,advancementCount:p.advancement_count,standingsConfig:p.standings_config??{},lockedAt:p.locked_at??undefined,entries:(p.pool_entries??[]).map((e:any)=>({id:e.id,poolId:e.pool_id,rosterEntryId:e.roster_entry_id,seed:e.seed,finalPlace:e.final_place??undefined,advanced:e.advanced}))}));
}

export async function saveGeneratedPools(params:{eventId:UUID;divisionId:UUID;entries:PoolSeed[];poolCount:number;advancementCount:number}):Promise<Array<PoolRecord & {entries:PoolEntryRecord[]}>>{
  const generated=generateSeededPools(params.entries,params.poolCount);
  if(!supabase){
    const existing=read<Array<PoolRecord & {entries:PoolEntryRecord[]}>>(key('pools',params.eventId),[]).filter(p=>p.divisionId!==params.divisionId);
    const records=generated.map(group=>{
      const id=crypto.randomUUID();
      return {id,eventId:params.eventId,divisionId:params.divisionId,name:group.name,advancementCount:params.advancementCount,standingsConfig:{winPoints:3,drawPoints:1,tieBreakers:['standing_points','head_to_head','round_differential','score_differential','score_for','seed']},entries:group.entries.map(item=>({id:crypto.randomUUID(),poolId:id,rosterEntryId:item.entry.id,seed:item.seed,advanced:false}))};
    });
    write(key('pools',params.eventId),[...existing,...records]);return records;
  }
  const payload=generated.map(group=>({name:group.name,advancementCount:params.advancementCount,entries:group.entries.map(item=>({rosterEntryId:item.entry.id,seed:item.seed}))}));
  const {error}=await supabase.rpc('replace_division_pools',{p_event_id:params.eventId,p_division_id:params.divisionId,p_pools:payload});
  if(error)throw error;
  return listPools(params.eventId,params.divisionId);
}

const demoRings=(eventId:string):RingRecord[]=>[
  {id:'ring-1',eventId,name:'Ring 1',sortOrder:1,status:'match_underway',statusNote:'Live',updatedAt:new Date().toISOString()},
  {id:'ring-2',eventId,name:'Ring 2',sortOrder:2,status:'ready',updatedAt:new Date().toISOString()},
  {id:'ring-3',eventId,name:'Ring 3',sortOrder:3,status:'delayed',statusNote:'Marshal review',updatedAt:new Date().toISOString()}
];

export async function listRings(eventId:UUID):Promise<RingRecord[]>{
  if(!supabase)return read(key('rings',eventId),demoRings(eventId));
  const {data,error}=await supabase.from('rings').select('*').eq('event_id',eventId).order('sort_order');
  if(error)throw error;
  return (data??[]).map((r:any)=>({id:r.id,eventId:r.event_id,name:r.name,sortOrder:r.sort_order,status:r.status,statusNote:r.status_note??undefined,updatedAt:r.updated_at}));
}
export async function createRing(eventId:UUID,name:string):Promise<RingRecord>{
  if(!name.trim())throw new Error('Ring name is required.');
  if(!supabase){
    const storageKey=key('rings',eventId),rows=read(storageKey,demoRings(eventId));
    const row:RingRecord={id:crypto.randomUUID(),eventId,name:name.trim(),sortOrder:rows.length+1,status:'idle',updatedAt:new Date().toISOString()};
    write(storageKey,[...rows,row]);return row;
  }
  const {data,error}=await supabase.from('rings').insert({event_id:eventId,name:name.trim(),sort_order:(await listRings(eventId)).length+1}).select('*').single();
  if(error)throw error;
  return {id:data.id,eventId:data.event_id,name:data.name,sortOrder:data.sort_order,status:data.status,statusNote:data.status_note??undefined,updatedAt:data.updated_at};
}
export async function setRingStatus(eventId:UUID,ringId:UUID,status:RingStatus,statusNote?:string):Promise<void>{
  if(!supabase){
    const storageKey=key('rings',eventId),rows=read(storageKey,demoRings(eventId));
    write(storageKey,rows.map(r=>r.id===ringId?{...r,status,statusNote:statusNote?.trim()||undefined,updatedAt:new Date().toISOString()}:r));return;
  }
  const {error}=await supabase.from('rings').update({status,status_note:statusNote?.trim()||null,updated_by:(await supabase.auth.getUser()).data.user?.id??null}).eq('id',ringId).eq('event_id',eventId);
  if(error)throw error;
}

export async function listSchedule(eventId:UUID):Promise<ScheduleItem[]>{
  if(!supabase)return read(key('schedule',eventId),[]);
  const {data,error}=await supabase.from('schedule_items').select('*').eq('event_id',eventId).order('starts_at');
  if(error)throw error;
  return (data??[]).map((s:any)=>({id:s.id,eventId:s.event_id,ringId:s.ring_id??undefined,matchId:s.match_id??undefined,divisionId:s.division_id??undefined,itemType:s.item_type,title:s.title,startsAt:s.starts_at,endsAt:s.ends_at,status:s.status,isPublic:s.is_public,notes:s.notes??undefined}));
}
export async function saveScheduleItem(eventId:UUID,input:Omit<ScheduleItem,'id'|'eventId'> & {id?:UUID}):Promise<ScheduleItem>{
  if(new Date(input.endsAt)<=new Date(input.startsAt))throw new Error('Schedule item must end after it starts.');
  const row:ScheduleItem={...input,id:input.id??crypto.randomUUID(),eventId};
  if(!supabase){
    const storageKey=key('schedule',eventId),rows=read<ScheduleItem[]>(storageKey,[]);
    write(storageKey,[...rows.filter(x=>x.id!==row.id),row].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));return row;
  }
  const payload={event_id:eventId,ring_id:row.ringId??null,match_id:row.matchId??null,division_id:row.divisionId??null,item_type:row.itemType,title:row.title,starts_at:row.startsAt,ends_at:row.endsAt,status:row.status,is_public:row.isPublic,notes:row.notes??null};
  const {data,error}=input.id?await supabase.from('schedule_items').update(payload).eq('id',input.id).select('*').single():await supabase.from('schedule_items').insert(payload).select('*').single();
  if(error)throw error;
  return {...row,id:data.id};
}
export async function deleteScheduleItem(eventId:UUID,id:UUID):Promise<void>{
  if(!supabase){const storageKey=key('schedule',eventId);write(storageKey,read<ScheduleItem[]>(storageKey,[]).filter(x=>x.id!==id));return;}
  const {error}=await supabase.from('schedule_items').delete().eq('id',id).eq('event_id',eventId);if(error)throw error;
}

export async function submitCorrection(input:Omit<CorrectionRequest,'id'|'status'|'createdAt'>):Promise<CorrectionRequest>{
  const row:CorrectionRequest={...input,id:crypto.randomUUID(),status:'submitted',createdAt:new Date().toISOString()};
  if(!supabase){
    const storageKey='buhurtos-demo-corrections',rows=read<CorrectionRequest[]>(storageKey,[]);
    write(storageKey,[row,...rows]);return row;
  }
  const {data,error}=await supabase.from('correction_requests').insert({organization_id:input.organizationId??null,event_id:input.eventId??null,reporter_user_id:input.reporterUserId??null,reporter_email:input.reporterEmail??null,category:input.category,entity_type:input.entityType??null,entity_id:input.entityId??null,description:input.description,evidence_links:input.evidenceLinks}).select('*').single();
  if(error)throw error;
  return {...row,id:data.id,createdAt:data.created_at};
}
export async function listCorrections(eventId?:UUID):Promise<CorrectionRequest[]>{
  if(!supabase){const rows=read<CorrectionRequest[]>('buhurtos-demo-corrections',[]);return eventId?rows.filter(r=>r.eventId===eventId):rows;}
  let query=supabase.from('correction_requests').select('*').order('created_at',{ascending:false});
  if(eventId)query=query.eq('event_id',eventId);
  const {data,error}=await query;
  if(error)throw error;
  return (data??[]).map((r:any)=>({id:r.id,organizationId:r.organization_id??undefined,eventId:r.event_id??undefined,reporterUserId:r.reporter_user_id??undefined,reporterEmail:r.reporter_email??undefined,category:r.category,entityType:r.entity_type??undefined,entityId:r.entity_id??undefined,description:r.description,evidenceLinks:r.evidence_links??[],status:r.status,resolutionNotes:r.resolution_notes??undefined,createdAt:r.created_at,resolvedAt:r.resolved_at??undefined}));
}
export async function reviewCorrection(id:UUID,status:CorrectionRequest['status'],resolutionNotes?:string):Promise<void>{
  if(!supabase){const rows=read<CorrectionRequest[]>('buhurtos-demo-corrections',[]);write('buhurtos-demo-corrections',rows.map(r=>r.id===id?{...r,status,resolutionNotes:resolutionNotes?.trim()||undefined,resolvedAt:['rejected','applied'].includes(status)?new Date().toISOString():undefined}:r));return;}
  const {error}=await supabase.rpc('review_correction_request',{p_correction_id:id,p_status:status,p_resolution_notes:resolutionNotes?.trim()||null});if(error)throw error;
}
