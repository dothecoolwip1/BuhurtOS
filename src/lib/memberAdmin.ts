import type { EventRole } from '../types';
import { isDemoModeAllowed, supabase } from './supabase';

export interface EventMembershipView {
  id: string;
  userId: string;
  role: EventRole;
  teamId?: string;
  displayName: string;
}

export interface EventInvitationView {
  id:string;
  email:string;
  role:EventRole;
  teamId?:string;
  status:'pending'|'accepted'|'revoked'|'expired';
  expiresAt:string;
}

export async function listEventMemberships(eventId: string): Promise<EventMembershipView[]> {
  if (!supabase) return [];
  const { data,error }=await supabase
    .from('event_memberships')
    .select('id,user_id,role,team_id,profiles(display_name)')
    .eq('event_id',eventId)
    .order('role');
  if(error)throw error;
  return (data??[]).map((row:any)=>({
    id:row.id,
    userId:row.user_id,
    role:row.role,
    teamId:row.team_id??undefined,
    displayName:(Array.isArray(row.profiles)?row.profiles[0]?.display_name:row.profiles?.display_name)||row.user_id.slice(0,8)
  }));
}

export async function listPendingEventInvitations(eventId:string):Promise<EventInvitationView[]>{
  if(!supabase)return [];
  const {data,error}=await supabase
    .from('account_invitations')
    .select('id,email,role_key,team_id,status,expires_at')
    .eq('event_id',eventId)
    .eq('status','pending')
    .order('created_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map((row:any)=>({
    id:row.id,
    email:row.email,
    role:row.role_key,
    teamId:row.team_id??undefined,
    status:row.status,
    expiresAt:row.expires_at
  }));
}

export async function inviteEventMember(input: {
  eventId:string;
  email:string;
  displayName?:string;
  role:EventRole;
  teamId?:string;
}): Promise<{ invited:boolean; assigned:boolean; invitationId?:string }> {
  if (!supabase) {
    if(isDemoModeAllowed)return {invited:true,assigned:false};
    throw new Error('BuhurtOS invitations require a configured Supabase project.');
  }
  const {data,error}=await supabase.functions.invoke('invite-event-member',{body:input});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  return {
    invited:Boolean(data?.invited),
    assigned:Boolean(data?.assigned),
    invitationId:data?.invitationId?String(data.invitationId):undefined
  };
}

export async function removeEventMembership(id:string):Promise<void>{
  if(!supabase)return;
  const {error}=await supabase.from('event_memberships').delete().eq('id',id);
  if(error)throw error;
}

export async function revokeEventInvitation(id:string):Promise<void>{
  if(!supabase)return;
  const {error}=await supabase.from('account_invitations').update({status:'revoked'}).eq('id',id).eq('status','pending');
  if(error)throw error;
}
