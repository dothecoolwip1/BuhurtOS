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
  if(!supabase) return {id:crypto.randomUUID(),name:input.name,shortName:input.shortName,region:input.region};
  const {data,error}=await supabase.from('organizations').insert({name:input.name,short_name:input.shortName,region:input.region,created_by:input.userId,last_edited_by:input.userId}).select('id,name,short_name,region').single();
  if(error)throw error;
  const {error:membershipError}=await supabase.from('organization_memberships').insert({organization_id:data.id,user_id:input.userId,role:'organization_admin'});
  if(membershipError)throw membershipError;
  return {id:data.id,name:data.name,shortName:data.short_name,region:data.region};
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
  const {data,error}=await supabase.from('events').insert({organization_id:input.organizationId,season_id:input.seasonId,name:input.name,venue:input.venue,starts_at:input.startsAt,ends_at:input.endsAt,timezone:input.timezone,event_type:input.eventType,standings_mode:input.standingsMode,status:'draft',created_by:input.userId,last_edited_by:input.userId}).select('id').single();
  if(error)throw error;
  const {error:roleError}=await supabase.from('event_memberships').insert({event_id:data.id,user_id:input.userId,role:'event_organizer'});
  if(roleError)throw roleError;
  return data.id;
}
