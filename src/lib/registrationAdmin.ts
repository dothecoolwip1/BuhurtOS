import { supabase } from './supabase';

export type RegistrationStatus='pending'|'approved'|'waitlisted'|'withdrawn'|'rejected';

export interface RegistrationReviewRow {
  id:string;
  eventId:string;
  divisionId?:string;
  displayName:string;
  email:string;
  teamName?:string;
  category:string;
  phone?:string;
  waiverAcknowledged:boolean;
  status:RegistrationStatus;
  paymentStatus:'not_required'|'pending'|'paid'|'failed'|'refunded';
  reviewNotes?:string;
  createdAt:string;
}

const demoKey=(eventId:string)=>`buhurtos-demo-registrations-${eventId}`;

export async function listEventRegistrations(eventId:string):Promise<RegistrationReviewRow[]>{
  if(!supabase){
    const rows:any[]=JSON.parse(localStorage.getItem(demoKey(eventId))??'[]');
    return rows.map(r=>({id:r.registrationId,eventId,divisionId:r.divisionId,displayName:r.displayName,email:r.email,teamName:r.teamName||undefined,category:r.category??'Division',phone:r.phone||undefined,waiverAcknowledged:r.waiverAcknowledged,status:r.status??'pending',paymentStatus:r.paymentRequired?'pending':'not_required',reviewNotes:r.reviewNotes,createdAt:r.createdAt??new Date().toISOString()}));
  }
  const {data,error}=await supabase.from('event_registrations').select('id,event_id,division_id,display_name,email,team_name,category,phone,waiver_acknowledged,status,payment_status,review_notes,created_at').eq('event_id',eventId).order('created_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map((r:any)=>({id:r.id,eventId:r.event_id,divisionId:r.division_id??undefined,displayName:r.display_name,email:r.email,teamName:r.team_name??undefined,category:r.category,phone:r.phone??undefined,waiverAcknowledged:r.waiver_acknowledged,status:r.status,paymentStatus:r.payment_status,reviewNotes:r.review_notes??undefined,createdAt:r.created_at}));
}

export async function reviewEventRegistration(eventId:string,id:string,status:RegistrationStatus,notes?:string):Promise<void>{
  if(status==='rejected'&&!notes?.trim())throw new Error('A rejection reason is required.');
  if(!supabase){
    const rows:any[]=JSON.parse(localStorage.getItem(demoKey(eventId))??'[]');
    localStorage.setItem(demoKey(eventId),JSON.stringify(rows.map(r=>r.registrationId===id?{...r,status,reviewNotes:notes?.trim()||undefined}:r)));return;
  }
  const {error}=await supabase.rpc('review_event_registration',{p_registration_id:id,p_status:status,p_review_notes:notes?.trim()||null});
  if(error)throw error;
}
