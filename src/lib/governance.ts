import type {
  CompetitionDivision,
  EligibilityRule,
  EventDivision,
  EventPolicyException,
  EventRecord,
  EventRulesetSnapshot,
  RulesetSource,
  RulesetSourceKind
} from '../types';
import { supabase } from './supabase';

export interface KnownRulesetSource {
  id: string;
  label: string;
  sourceUrl: string;
  versionLabel: string;
  sourceKind: RulesetSourceKind;
  note: string;
}

export const knownRulesetSources: KnownRulesetSource[] = [
  {
    id: 'bi-current',
    label: 'Buhurt International Rules & Policies',
    sourceUrl: 'https://www.buhurtinternational.com/rules',
    versionLabel: 'Current rules library',
    sourceKind: 'official',
    note: 'Primary BI source. Record the specific document/version actually adopted when available.'
  },
  {
    id: 'hacsa-bi',
    label: 'HACSA · Buhurt International Rules',
    sourceUrl: 'https://www.hacsacanada.com/buhurt-international-rules',
    versionLabel: 'HACSA files marked current as of 2025-01-23',
    sourceKind: 'organization',
    note: 'Dated HACSA reference page. Record the exact BI file/version actually adopted rather than assuming these downloads are current.'
  },
  {
    id: 'hacsa-imcf-historical',
    label: 'HACSA · IMCF Rules',
    sourceUrl: 'https://www.hacsacanada.com/imcf-rules',
    versionLabel: 'IMCF Version 5 · HACSA page current as of 2025-01-23',
    sourceKind: 'historical',
    note: 'Historical reference. Do not treat as current BI rules without an explicit organization decision.'
  }
];

function sourceRow(row:any):RulesetSource{
  return {
    id:row.id,rulesetId:row.ruleset_id,label:row.label,sourceUrl:row.source_url??undefined,
    versionLabel:row.version_label??undefined,effectiveFrom:row.effective_from??undefined,
    effectiveTo:row.effective_to??undefined,sourceKind:row.source_kind,notes:row.notes??undefined,
    accessedOn:row.accessed_on??undefined,createdAt:row.created_at??undefined,updatedAt:row.updated_at??undefined
  };
}

export async function listRulesetSources(rulesetId:string):Promise<RulesetSource[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('ruleset_sources').select('*').eq('ruleset_id',rulesetId).order('created_at');
  if(error)throw error;
  return (data??[]).map(sourceRow);
}

export async function addRulesetSource(
  rulesetId:string,
  input:Omit<RulesetSource,'id'|'rulesetId'|'createdAt'|'updatedAt'>
):Promise<RulesetSource>{
  if(!input.label.trim())throw new Error('Source label is required.');
  if(input.sourceUrl&&!input.sourceUrl.startsWith('https://'))throw new Error('Source URL must use HTTPS.');
  if(!supabase)return {id:crypto.randomUUID(),rulesetId,...input};
  const {data,error}=await supabase.from('ruleset_sources').insert({
    ruleset_id:rulesetId,label:input.label.trim(),source_url:input.sourceUrl?.trim()||null,
    version_label:input.versionLabel?.trim()||null,effective_from:input.effectiveFrom||null,
    effective_to:input.effectiveTo||null,source_kind:input.sourceKind,notes:input.notes?.trim()||null,
    accessed_on:input.accessedOn||null
  }).select('*').single();
  if(error)throw error;
  return sourceRow(data);
}

export async function deleteRulesetSource(sourceId:string):Promise<void>{
  if(!supabase)return;
  const {error}=await supabase.from('ruleset_sources').delete().eq('id',sourceId);
  if(error)throw error;
}

export interface EligibilityFacts {
  birthDate?: string;
  ageYears?: number;
  weightKg?: number;
  experienceYears?: number;
  teamSize?: number;
  declarations?: Record<string,boolean>;
  customValues?: Record<string,string|number|boolean>;
}

export interface EligibilityEvaluation {
  status:'eligible'|'ineligible'|'needs_review';
  reasons:string[];
  passed:string[];
}

function ageOnDate(birthDate:string,eventDate:string):number|undefined{
  const birth=new Date(birthDate+'T00:00:00Z');
  const target=new Date(eventDate);
  if(Number.isNaN(birth.getTime())||Number.isNaN(target.getTime()))return undefined;
  let years=target.getUTCFullYear()-birth.getUTCFullYear();
  const beforeBirthday=target.getUTCMonth()<birth.getUTCMonth()
    ||(target.getUTCMonth()===birth.getUTCMonth()&&target.getUTCDate()<birth.getUTCDate());
  if(beforeBirthday)years-=1;
  return years;
}

function rangeCheck(
  label:string,value:number|undefined,min:number|undefined,max:number|undefined,
  reasons:string[],passed:string[]
){
  if(min==null&&max==null)return;
  if(value==null){reasons.push(label+' needs verification.');return;}
  if(min!=null&&value<min){reasons.push(label+' is below the minimum of '+min+'.');return;}
  if(max!=null&&value>max){reasons.push(label+' exceeds the maximum of '+max+'.');return;}
  passed.push(label+' is within the allowed range.');
}

export function evaluateDivisionEligibility(
  division:CompetitionDivision,
  facts:EligibilityFacts,
  eventDate=new Date().toISOString()
):EligibilityEvaluation{
  const reasons:string[]=[];
  const passed:string[]=[];
  const age=facts.ageYears??(facts.birthDate?ageOnDate(facts.birthDate,eventDate):undefined);

  rangeCheck('Age',age,division.ageMin,division.ageMax,reasons,passed);
  rangeCheck('Weight (kg)',facts.weightKg,division.minWeightKg,division.maxWeightKg,reasons,passed);
  rangeCheck('Experience (years)',facts.experienceYears,division.minExperienceYears,division.maxExperienceYears,reasons,passed);
  if(division.teamSize!=null)rangeCheck('Team size',facts.teamSize,division.teamSize,division.teamSize,reasons,passed);

  for(const rule of division.eligibilityRules??[]){
    if(rule.kind==='age')rangeCheck(rule.label,age,rule.min,rule.max,reasons,passed);
    else if(rule.kind==='weight_kg')rangeCheck(rule.label,facts.weightKg,rule.min,rule.max,reasons,passed);
    else if(rule.kind==='experience_years')rangeCheck(rule.label,facts.experienceYears,rule.min,rule.max,reasons,passed);
    else if(rule.kind==='team_size')rangeCheck(rule.label,facts.teamSize,rule.min,rule.max,reasons,passed);
    else if(rule.kind==='declaration'){
      const value=rule.key?facts.declarations?.[rule.key]:undefined;
      if(value===true)passed.push(rule.label+' confirmed.');
      else if(value===false)reasons.push(rule.label+' is not satisfied.');
      else reasons.push(rule.label+' needs organizer verification.');
    }else{
      const value=rule.key?facts.customValues?.[rule.key]:undefined;
      if(value==null)reasons.push(rule.label+' requires manual review.');
      else if(rule.value!==undefined&&value!==rule.value)reasons.push(rule.label+' does not match the required value.');
      else passed.push(rule.label+' confirmed.');
    }
  }

  const hardFailure=reasons.some(reason=>/below the minimum|exceeds the maximum|not satisfied|does not match/.test(reason));
  return {status:hardFailure?'ineligible':reasons.length?'needs_review':'eligible',reasons,passed};
}

function snapshotRow(row:any):EventRulesetSnapshot{
  return {
    id:row.id,eventId:row.event_id,rulesetId:row.ruleset_id,rulesetName:row.ruleset_name,
    rulesetShortName:row.ruleset_short_name,rulesetVersion:row.ruleset_version,
    resolvedSettings:row.resolved_settings,eligibilityPolicy:row.eligibility_policy??{},
    scoringPolicy:row.scoring_policy??{},tournamentPolicy:row.tournament_policy??{},
    rankingPolicy:row.ranking_policy??{},rulesetChain:row.ruleset_chain??[],
    sourceSnapshot:row.source_snapshot??[],lockedAt:row.locked_at
  };
}

export async function listEventRulesetSnapshots(eventId:string):Promise<EventRulesetSnapshot[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('event_ruleset_snapshots').select('*').eq('event_id',eventId).order('locked_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map(snapshotRow);
}

function exceptionRow(row:any):EventPolicyException{
  return {
    id:row.id,organizationId:row.organization_id,eventId:row.event_id,divisionId:row.division_id??undefined,
    rulesetSnapshotId:row.ruleset_snapshot_id??undefined,policyDomain:row.policy_domain,ruleKey:row.rule_key,
    reason:row.reason,status:row.status,approvedAt:row.approved_at,metadata:row.metadata??{}
  };
}

export async function listEventPolicyExceptions(eventId:string):Promise<EventPolicyException[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('event_policy_exceptions').select('*').eq('event_id',eventId).order('approved_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map(exceptionRow);
}

export async function recordEventPolicyException(
  eventId:string,
  input:{divisionId?:string;policyDomain:EventPolicyException['policyDomain'];ruleKey:string;reason:string;metadata?:Record<string,unknown>}
):Promise<string>{
  if(input.reason.trim().length<8)throw new Error('Provide a meaningful reason for the exception.');
  if(!supabase)return crypto.randomUUID();
  const {data,error}=await supabase.rpc('record_event_policy_exception',{
    p_event_id:eventId,p_division_id:input.divisionId??null,p_policy_domain:input.policyDomain,
    p_rule_key:input.ruleKey.trim(),p_reason:input.reason.trim(),p_metadata:input.metadata??{}
  });
  if(error)throw error;
  return data as string;
}

function eventDivisionRow(row:any):EventDivision{
  return {
    id:row.id,eventId:row.event_id,divisionId:row.division_id,rulesetId:row.ruleset_id??undefined,
    rulesetSnapshotId:row.ruleset_snapshot_id??undefined,divisionSnapshot:row.division_snapshot??undefined,
    registrationLimit:row.registration_limit??undefined,isRegistrationOpen:row.is_registration_open,
    metadata:row.metadata??{},updatedAt:row.updated_at??undefined
  };
}

export async function listEventDivisions(eventId:string):Promise<EventDivision[]>{
  if(!supabase)return [];
  const {data,error}=await supabase.from('event_divisions').select('*').eq('event_id',eventId).order('created_at');
  if(error)throw error;
  return (data??[]).map(eventDivisionRow);
}

export async function assignEventDivision(
  event:EventRecord,divisionId:string,registrationLimit?:number,effectiveWindowExceptionReason?:string
):Promise<void>{
  if(!supabase)return;
  const {error}=await supabase.rpc('assign_event_division_guarded',{
    p_event_id:event.id,p_division_id:divisionId,p_registration_limit:registrationLimit??null,
    p_effective_window_exception_reason:effectiveWindowExceptionReason?.trim()||null
  });
  if(error)throw error;
}

export async function removeEventDivision(event:EventRecord,row:EventDivision):Promise<void>{
  if(!supabase)return;
  if(!row.updatedAt)throw new Error('Event division version is missing. Reload before removing it.');
  const {error}=await supabase.rpc('remove_event_division_guarded',{
    p_event_division_id:row.id,p_expected_updated_at:row.updatedAt
  });
  if(error)throw error;
}

export function parseEligibilityRulesJson(text:string):EligibilityRule[]{
  const value=JSON.parse(text);
  if(!Array.isArray(value))throw new Error('Eligibility rules must be a JSON array.');
  return value as EligibilityRule[];
}
