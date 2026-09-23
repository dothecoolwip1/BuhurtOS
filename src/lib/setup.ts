import type { EventRecord, EventType, StandingsMode } from '../types';
import { supabase } from './supabase';

export interface SetupOrganization { id:string; name:string; shortName:string; region:string }
export interface SetupSeason { id:string; organizationId:string; name:string; startsAt:string; endsAt:string; status:string }

export async function claimFirstSuperAdmin(): Promise<boolean> {
  if (!supabase) return true;
  const { data, error } = await supabase.rpc('claim_first_super_admin');
  if (error) throw error;
  return Boolean(data);
}

export async function listOrganizations(): Promise<SetupOrganization[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('organizations').select('id,name,short_name,region').order('name');
  if (error) throw error;
  return (data ?? []).map((row:any)=>({id:row.id,name:row.name,shortName:row.short_name,region:row.region}));
}

export async function createOrganization(input:{name:string;shortName:string;region:string;userId:string}):Promise<SetupOrganization>{
  if(!supabase)return {id:crypto.randomUUID(),name:input.name,shortName:input.shortName,region:input.region};
  const {data,error}=await supabase.rpc('create_organization_with_admin',{
    p_name:input.name,
    p_short_name:input.shortName,
    p_region:input.region,
    p_country_code:null
  });
  if(error)throw error;
  const id=String(data);
  return {id,name:input.name.trim(),shortName:input.shortName.trim(),region:input.region.trim()};
}

export async function listSeasons(organizationId:string):Promise<SetupSeason[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('seasons').select('id,organization_id,name,starts_at,ends_at,status').eq('organization_id',organizationId).order('starts_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,organizationId:row.organization_id,name:row.name,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status}));
}

export async function createSeason(input:{organizationId:string;name:string;startsAt:string;endsAt:string;userId:string}):Promise<SetupSeason>{
  if(!supabase)return {id:crypto.randomUUID(),organizationId:input.organizationId,name:input.name,startsAt:input.startsAt,endsAt:input.endsAt,status:'active'};
  const {data,error}=await supabase.from('seasons').insert({organization_id:input.organizationId,name:input.name,starts_at:input.startsAt,ends_at:input.endsAt,status:'active',created_by:input.userId,last_edited_by:input.userId}).select('*').single();
  if(error)throw error;
  return {id:data.id,organizationId:data.organization_id,name:data.name,startsAt:data.starts_at,endsAt:data.ends_at,status:data.status};
}

export async function listEvents(organizationId:string):Promise<Array<Pick<EventRecord,'id'|'name'|'venue'|'startsAt'|'status'>>>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('events').select('id,name,venue,starts_at,status').eq('organization_id',organizationId).order('starts_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,name:row.name,venue:row.venue,startsAt:row.starts_at,status:row.status}));
}

export async function createEvent(input:{organizationId:string;seasonId:string;name:string;venue:string;startsAt:string;endsAt:string;timezone:string;eventType:EventType;standingsMode:StandingsMode;userId:string}):Promise<string>{
  if(!supabase)return 'event-hacsa-demo';
  const {data,error}=await supabase.rpc('create_event_with_organizer',{
    p_organization_id:input.organizationId,
    p_season_id:input.seasonId,
    p_name:input.name,
    p_venue:input.venue,
    p_starts_at:input.startsAt,
    p_ends_at:input.endsAt,
    p_timezone:input.timezone,
    p_event_type:input.eventType,
    p_standings_mode:input.standingsMode
  });
  if(error)throw error;
  return String(data);
}
