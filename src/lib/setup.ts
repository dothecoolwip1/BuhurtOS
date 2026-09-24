import type { EventRecord, EventType, StandingsMode } from '../types';
import { supabase } from './supabase';

export interface SetupOrganization {
  id:string;
  name:string;
  shortName:string;
  region:string;
  status:'active'|'inactive';
}

export interface SetupSeason {
  id:string;
  organizationId:string;
  name:string;
  startsAt:string;
  endsAt:string;
  status:'draft'|'active'|'archived';
  defaultRulesetId?:string;
  rankingPolicy:Record<string,unknown>;
  revision:number;
  updatedAt?:string;
}

export async function claimFirstSuperAdmin():Promise<boolean>{
  if(!supabase)return true;
  const {data,error}=await supabase.rpc('claim_first_super_admin');
  if(error)throw error;
  return Boolean(data);
}

export async function listOrganizations():Promise<SetupOrganization[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('organizations').select('id,name,short_name,region,status').order('name');
  if(error)throw error;
  return (data??[]).map((row:any)=>({
    id:row.id,name:row.name,shortName:row.short_name,region:row.region,status:row.status
  }));
}

export async function createOrganization(input:{name:string;shortName:string;region:string;userId:string}):Promise<SetupOrganization>{
  if(!supabase)return {id:crypto.randomUUID(),name:input.name,shortName:input.shortName,region:input.region,status:'active'};
  const {data,error}=await supabase.from('organizations').insert({
    name:input.name,short_name:input.shortName,region:input.region,created_by:input.userId,last_edited_by:input.userId
  }).select('id,name,short_name,region,status').single();
  if(error)throw error;
  const {error:membershipError}=await supabase.rpc('assign_organization_role',{
    p_organization_id:data.id,p_user_id:input.userId,p_role:'organization_admin'
  });
  if(membershipError)throw membershipError;
  return {id:data.id,name:data.name,shortName:data.short_name,region:data.region,status:data.status};
}

export async function updateOrganization(input:{id:string;name:string;shortName:string;region:string}):Promise<void>{
  if(!input.name.trim()||!input.shortName.trim()||!input.region.trim())throw new Error('Organization name, short name, and region are required.');
  if(!supabase)return;
  const {error}=await supabase.from('organizations').update({
    name:input.name.trim(),short_name:input.shortName.trim(),region:input.region.trim()
  }).eq('id',input.id);
  if(error)throw error;
}

export async function setOrganizationStatus(id:string,status:'active'|'inactive'):Promise<void>{
  if(!supabase)return;
  const {error}=await supabase.from('organizations').update({status}).eq('id',id);
  if(error)throw error;
}

function seasonRow(row:any):SetupSeason{
  return {
    id:row.id,organizationId:row.organization_id,name:row.name,startsAt:row.starts_at,endsAt:row.ends_at,
    status:row.status,defaultRulesetId:row.default_ruleset_id??undefined,rankingPolicy:row.ranking_policy??{},
    revision:Number(row.revision??1),updatedAt:row.updated_at??undefined
  };
}

export async function listSeasons(organizationId:string):Promise<SetupSeason[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('seasons')
    .select('id,organization_id,name,starts_at,ends_at,status,default_ruleset_id,ranking_policy,revision,updated_at')
    .eq('organization_id',organizationId).order('starts_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map(seasonRow);
}

export async function createSeason(input:{
  organizationId:string;name:string;startsAt:string;endsAt:string;userId:string;
  defaultRulesetId?:string;rankingPolicy?:Record<string,unknown>
}):Promise<SetupSeason>{
  if(!input.name.trim())throw new Error('Season name is required.');
  if(new Date(input.endsAt).getTime()<=new Date(input.startsAt).getTime())throw new Error('Season end must be after its start.');
  if(!supabase)return {
    id:crypto.randomUUID(),organizationId:input.organizationId,name:input.name,startsAt:input.startsAt,
    endsAt:input.endsAt,status:'draft',defaultRulesetId:input.defaultRulesetId,
    rankingPolicy:input.rankingPolicy??{},revision:1,updatedAt:new Date().toISOString()
  };
  const {data,error}=await supabase.from('seasons').insert({
    organization_id:input.organizationId,name:input.name.trim(),starts_at:input.startsAt,ends_at:input.endsAt,
    status:'draft',default_ruleset_id:input.defaultRulesetId??null,ranking_policy:input.rankingPolicy??{},
    created_by:input.userId,last_edited_by:input.userId
  }).select('*').single();
  if(error)throw error;
  return seasonRow(data);
}

export async function updateSeason(input:{
  id:string;organizationId:string;name:string;startsAt:string;endsAt:string;
  expectedUpdatedAt?:string;defaultRulesetId?:string;rankingPolicy?:Record<string,unknown>
}):Promise<void>{
  if(!input.name.trim())throw new Error('Season name is required.');
  if(new Date(input.endsAt).getTime()<=new Date(input.startsAt).getTime())throw new Error('Season end must be after its start.');
  if(!supabase)return;
  if(!input.expectedUpdatedAt)throw new Error('Season version is missing. Reload before saving.');
  const {error}=await supabase.rpc('update_season_guarded',{
    p_season_id:input.id,p_expected_updated_at:input.expectedUpdatedAt,p_name:input.name.trim(),
    p_starts_at:input.startsAt,p_ends_at:input.endsAt,p_default_ruleset_id:input.defaultRulesetId??null,
    p_ranking_policy:input.rankingPolicy??{}
  });
  if(error)throw error;
}

export async function setSeasonStatus(
  organizationId:string,id:string,status:'draft'|'active'|'archived',expectedUpdatedAt?:string
):Promise<void>{
  if(!supabase)return;
  if(!expectedUpdatedAt)throw new Error('Season version is missing. Reload before changing status.');
  const {error}=await supabase.rpc('transition_season_guarded',{
    p_season_id:id,p_expected_updated_at:expectedUpdatedAt,p_status:status
  });
  if(error)throw error;
}

export async function listEvents(organizationId:string):Promise<Array<Pick<EventRecord,'id'|'name'|'venue'|'startsAt'|'status'>>>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('events').select('id,name,venue,starts_at,status')
    .eq('organization_id',organizationId).order('starts_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map((row:any)=>({
    id:row.id,name:row.name,venue:row.venue,startsAt:row.starts_at,status:row.status
  }));
}

export async function createEvent(input:{
  organizationId:string;seasonId:string;name:string;venue:string;startsAt:string;endsAt:string;
  timezone:string;eventType:EventType;standingsMode:StandingsMode;userId:string
}):Promise<string>{
  if(!supabase)return 'event-hacsa-demo';
  const {data,error}=await supabase.from('events').insert({
    organization_id:input.organizationId,season_id:input.seasonId,name:input.name,venue:input.venue,
    starts_at:input.startsAt,ends_at:input.endsAt,timezone:input.timezone,event_type:input.eventType,
    standings_mode:input.standingsMode,status:'draft',created_by:input.userId,last_edited_by:input.userId
  }).select('id').single();
  if(error)throw error;
  const {error:roleError}=await supabase.rpc('assign_event_role',{
    p_event_id:data.id,p_user_id:input.userId,p_role:'event_organizer',p_team_id:null
  });
  if(roleError)throw roleError;
  return data.id;
}
