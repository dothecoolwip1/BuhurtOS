import type { GeneratedBracket } from './bracket';
import type { Bracket, EventRecord, RosterEntry } from '../types';
import { supabase } from './supabase';

export interface AdminOption { id:string; name:string }

export async function listEventTeamOptions(event: EventRecord): Promise<AdminOption[]> {
  if (!supabase) return [];
  const { data,error }=await supabase.from('teams').select('id,name').eq('organization_id',event.organizationId).eq('is_active',true).is('deleted_at',null).order('name');
  if(error)throw error;
  return (data??[]).map(row=>({id:row.id,name:row.name}));
}

export async function listEventDivisionOptions(event: EventRecord): Promise<AdminOption[]> {
  if (!supabase) return [];
  const { data,error }=await supabase.from('divisions').select('id,name').eq('is_active',true).is('deleted_at',null).or('organization_id.is.null,organization_id.eq.'+event.organizationId).order('name');
  if(error)throw error;
  return (data??[]).map(row=>({id:row.id,name:row.name}));
}

export async function addGhostFighter(
  event: EventRecord,
  displayName: string,
  teamId?: string,
  countryCode?: string,
  divisionId?: string
): Promise<RosterEntry> {
  const row: RosterEntry = {
    id: crypto.randomUUID(),
    organizationId: event.organizationId,
    eventId: event.id,
    teamId,
    entryType: 'ghost_fighter',
    displayName,
    checkedIn: false,
    armorCleared: false,
    medicalCleared: false,
    waiverConfirmed: false,
    weighInCleared: false,
    attendanceStatus: 'registered',
    metadata: { temporary: true, countryCode, divisionId }
  };

  if (!supabase) {
    const key='buhurtos-demo-ghosts';
    const current=JSON.parse(localStorage.getItem(key)??'[]');
    localStorage.setItem(key,JSON.stringify([...current,row]));
    return row;
  }

  const { data,error }=await supabase.rpc('create_temporary_fighter_for_event',{
    p_event_id:event.id,
    p_display_name:displayName,
    p_country_code:countryCode?.trim().toUpperCase()||null,
    p_team_id:teamId||null,
    p_division_id:divisionId||null
  });
  if(error)throw error;
  const result=data as {fighterId:string;rosterEntryId:string};
  return { ...row,id:result.rosterEntryId,fighterId:result.fighterId };
}

export async function saveBracketPlan(
  event: EventRecord,
  plan: GeneratedBracket,
  options: { id:string; name:string; fightCardId?:string; category:string; format?:Bracket['format']; metadata?:Record<string,unknown> }
): Promise<string> {
  if (!supabase) {
    const existing=JSON.parse(localStorage.getItem('buhurtos-demo-bracket-matches')??'[]');
    const ids=new Set(plan.matches.map(match=>match.id));
    localStorage.setItem('buhurtos-demo-bracket-matches',JSON.stringify([...existing.filter((match:any)=>!ids.has(match.id)),...plan.matches]));
    return options.id;
  }

  const { data,error }=await supabase.rpc('save_bracket_plan',{
    p_bracket:{
      id:options.id,
      eventId:event.id,
      fightCardId:options.fightCardId??'',
      name:options.name,
      format:options.format??'single_elimination',
      category:options.category,
      metadata:{ generatedAt:new Date().toISOString(),antiFratricide:true,...(options.metadata??{}) }
    },
    p_matches:plan.matches
  });
  if(error)throw error;
  return data as string;
}
