import { supabase } from './supabase';
import type { UserContext } from '../types';

export type ClearanceType='identity'|'registration'|'fee'|'waiver'|'insurance'|'weight'|'medical'|'armor'|'weapons'|'check_in'|'custom';
export type ClearanceStatus='pending'|'passed'|'failed'|'reinspection_required'|'waived';

export interface ClearanceRequirement {
  id:string;
  eventId:string;
  clearanceType:ClearanceType;
  label:string;
  required:boolean;
  sortOrder:number;
  configuration:Record<string,unknown>;
}
export interface ClearanceOutcome {
  id:string;
  eventId:string;
  rosterEntryId:string;
  clearanceType:ClearanceType;
  status:ClearanceStatus;
  inspectedBy?:string;
  inspectedAt?:string;
  notes?:string;
  createdAt:string;
}

const DEFAULTS:Array<Omit<ClearanceRequirement,'id'|'eventId'>>=[
  {clearanceType:'identity',label:'Identity',required:true,sortOrder:10,configuration:{}},
  {clearanceType:'registration',label:'Registration',required:true,sortOrder:20,configuration:{}},
  {clearanceType:'waiver',label:'Waiver',required:true,sortOrder:30,configuration:{}},
  {clearanceType:'insurance',label:'Insurance',required:false,sortOrder:40,configuration:{}},
  {clearanceType:'weight',label:'Weight',required:false,sortOrder:50,configuration:{}},
  {clearanceType:'medical',label:'Medical',required:true,sortOrder:60,configuration:{}},
  {clearanceType:'armor',label:'Armor',required:true,sortOrder:70,configuration:{}},
  {clearanceType:'weapons',label:'Weapons',required:true,sortOrder:80,configuration:{}},
  {clearanceType:'check_in',label:'Checked in',required:true,sortOrder:90,configuration:{}}
];
const reqKey=(eventId:string)=>`buhurtos-demo-clearance-requirements-${eventId}`;
const outKey=(eventId:string)=>`buhurtos-demo-clearances-${eventId}`;

export function canRecordClearance(user:UserContext|null,eventId:string,organizationId:string,type:ClearanceType):boolean{
  if(!user)return false;
  if(user.platformRoles.includes('platform_super_admin'))return true;
  if(user.organizationRoles.some(r=>r.organizationId===organizationId&&r.role==='organization_admin'))return true;
  const roles=user.eventRoles.filter(r=>r.eventId===eventId).map(r=>r.role);
  if(roles.some(r=>['event_organizer','tournament_director','field_marshal'].includes(r)))return true;
  if(['identity','registration','fee','waiver','insurance','weight','check_in'].includes(type)&&roles.includes('registration_staff'))return true;
  if(['armor','weapons'].includes(type)&&roles.includes('armor_inspector'))return true;
  if(type==='medical'&&roles.includes('medical_staff'))return true;
  return false;
}

export async function listClearanceRequirements(eventId:string):Promise<ClearanceRequirement[]>{
  if(!supabase){
    const raw=typeof localStorage==='undefined'?null:localStorage.getItem(reqKey(eventId));
    return raw?JSON.parse(raw):DEFAULTS.map((r,i)=>({...r,id:`demo-req-${i}`,eventId}));
  }
  const {data,error}=await supabase.from('event_clearance_requirements').select('*').eq('event_id',eventId).order('sort_order');
  if(error)throw error;
  return (data??[]).map((r:any)=>({id:r.id,eventId:r.event_id,clearanceType:r.clearance_type,label:r.label,required:r.required,sortOrder:r.sort_order,configuration:r.configuration??{}}));
}

export async function setClearanceRequirement(eventId:string,requirement:ClearanceRequirement,required:boolean):Promise<void>{
  if(!supabase){
    const rows=await listClearanceRequirements(eventId);
    localStorage.setItem(reqKey(eventId),JSON.stringify(rows.map(r=>r.id===requirement.id?{...r,required}:r)));return;
  }
  const {error}=await supabase.from('event_clearance_requirements').update({required}).eq('id',requirement.id).eq('event_id',eventId);
  if(error)throw error;
}

export async function listLatestClearances(eventId:string):Promise<ClearanceOutcome[]>{
  if(!supabase){
    const raw=typeof localStorage==='undefined'?null:localStorage.getItem(outKey(eventId));
    const rows:ClearanceOutcome[]=raw?JSON.parse(raw):[];
    const seen=new Set<string>();
    return rows.filter(row=>{const key=`${row.rosterEntryId}:${row.clearanceType}`;if(seen.has(key))return false;seen.add(key);return true;});
  }
  const {data,error}=await supabase.from('event_clearances').select('*').eq('event_id',eventId).order('created_at',{ascending:false});
  if(error)throw error;
  const seen=new Set<string>(),rows:ClearanceOutcome[]=[];
  for(const r of data??[]){
    const key=`${r.roster_entry_id}:${r.clearance_type}`;
    if(seen.has(key))continue;seen.add(key);
    rows.push({id:r.id,eventId:r.event_id,rosterEntryId:r.roster_entry_id,clearanceType:r.clearance_type,status:r.status,inspectedBy:r.inspected_by??undefined,inspectedAt:r.inspected_at??undefined,notes:r.notes??undefined,createdAt:r.created_at});
  }
  return rows;
}

export async function recordClearance(eventId:string,rosterEntryId:string,type:ClearanceType,status:ClearanceStatus,notes?:string):Promise<void>{
  if(status==='failed'&&!notes?.trim())throw new Error('Add a note explaining why the clearance failed.');
  if(!supabase){
    const raw=localStorage.getItem(outKey(eventId));
    const rows:ClearanceOutcome[]=raw?JSON.parse(raw):[];
    rows.unshift({id:crypto.randomUUID(),eventId,rosterEntryId,clearanceType:type,status,inspectedAt:new Date().toISOString(),notes:notes?.trim()||undefined,createdAt:new Date().toISOString()});
    localStorage.setItem(outKey(eventId),JSON.stringify(rows));return;
  }
  const {error}=await supabase.rpc('record_event_clearance',{p_event_id:eventId,p_roster_entry_id:rosterEntryId,p_clearance_type:type,p_status:status,p_notes:notes?.trim()||null});
  if(error)throw error;
}
