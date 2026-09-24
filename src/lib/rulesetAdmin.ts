import type {
  EventRecord,
  RulesetRecord,
  RulesetSettings,
  RulesetSettingsPatch,
  RulesetStatus,
  ScoringConfig
} from '../types';
import { supabase } from './supabase';
import { verifiedCompetitionFormats, type CompetitionFormatPreset } from './competitionFormats';

export const defaultRulesetSettings: RulesetSettings = {
  enabledFormats: verifiedCompetitionFormats.map(format => format.id),
  scoringOverrides: {},
  compliance: {
    requireCheckIn: true,
    requireArmorClearance: true,
    requireMedicalClearance: true,
    requireWaiver: true,
    requireWeighIn: true
  },
  discipline: {
    yellowCardsBeforeSuspension: 2,
    redCardSuspensionMatches: 1
  },
  bracket: {
    antiFratricide: true
  }
};

const demoKey = (organizationId: string) => 'buhurtos-demo-rulesets-' + organizationId;

function normalizeSettings(value: RulesetSettingsPatch | null | undefined): RulesetSettings {
  return {
    enabledFormats: value?.enabledFormats !== undefined ? [...value.enabledFormats] : [...defaultRulesetSettings.enabledFormats],
    scoringOverrides: { ...defaultRulesetSettings.scoringOverrides, ...(value?.scoringOverrides ?? {}) },
    compliance: { ...defaultRulesetSettings.compliance, ...(value?.compliance ?? {}) },
    discipline: { ...defaultRulesetSettings.discipline, ...(value?.discipline ?? {}) },
    bracket: { ...defaultRulesetSettings.bracket, ...(value?.bracket ?? {}) }
  };
}

function rowToRuleset(row:any):RulesetRecord {
  const rawSettings=(row.settings??{}) as RulesetSettingsPatch;
  return {
    id:row.id,organizationId:row.organization_id??undefined,teamId:row.team_id??undefined,
    parentRulesetId:row.parent_ruleset_id??undefined,name:row.name,shortName:row.short_name,
    version:row.version,description:row.description??undefined,status:row.status,
    effectiveFrom:row.effective_from??undefined,effectiveTo:row.effective_to??undefined,
    settings:normalizeSettings(rawSettings),overrides:rawSettings,
    eligibilityPolicy:row.eligibility_policy??{},scoringPolicy:row.scoring_policy??{},
    tournamentPolicy:row.tournament_policy??{},rankingPolicy:row.ranking_policy??{},
    revision:Number(row.revision??1),publishedAt:row.published_at??undefined,
    retiredAt:row.retired_at??undefined,createdAt:row.created_at??undefined,updatedAt:row.updated_at??undefined
  };
}

export async function listRulesets(organizationId:string):Promise<RulesetRecord[]> {
  let rows:RulesetRecord[];
  if(!supabase){
    try{rows=JSON.parse(localStorage.getItem(demoKey(organizationId))??'[]') as RulesetRecord[];}
    catch{return [];}
  }else{
    const {data,error}=await supabase.from('rulesets').select('*')
      .or('organization_id.is.null,organization_id.eq.'+organizationId)
      .order('name').order('created_at',{ascending:false});
    if(error)throw error;
    rows=(data??[]).map(rowToRuleset);
  }
  return rows.map(record=>({...record,settings:resolveRulesetSettings(rows,record.id)}))
    .sort((a,b)=>a.name.localeCompare(b.name)||b.version.localeCompare(a.version));
}

export function resolveRulesetSettings(rulesets:RulesetRecord[],rulesetId?:string):RulesetSettings {
  if(!rulesetId)return structuredClone(defaultRulesetSettings);
  const byId=new Map(rulesets.map(record=>[record.id,record]));
  const resolving=new Set<string>();

  const resolve=(id:string):RulesetSettings=>{
    if(resolving.has(id))throw new Error('Ruleset inheritance contains a cycle.');
    resolving.add(id);
    const record=byId.get(id);
    if(!record){resolving.delete(id);return structuredClone(defaultRulesetSettings);}
    const parent=record.parentRulesetId?resolve(record.parentRulesetId):structuredClone(defaultRulesetSettings);
    resolving.delete(id);
    const own:RulesetSettingsPatch=record.overrides??record.settings;
    const scoringOverrides:RulesetSettings['scoringOverrides']={...parent.scoringOverrides};
    for(const [formatId,override] of Object.entries(own.scoringOverrides??{})){
      scoringOverrides[formatId]={...(parent.scoringOverrides[formatId]??{}),...override};
    }
    return {
      enabledFormats:own.enabledFormats!==undefined?[...own.enabledFormats]:[...parent.enabledFormats],
      scoringOverrides,
      compliance:{...parent.compliance,...(own.compliance??{})},
      discipline:{...parent.discipline,...(own.discipline??{})},
      bracket:{...parent.bracket,...(own.bracket??{})}
    };
  };
  return resolve(rulesetId);
}

export function deriveRulesetSettingsPatch(parent:RulesetSettings,effective:RulesetSettings):RulesetSettingsPatch {
  const patch:RulesetSettingsPatch={};
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

  if(!same(parent.enabledFormats,effective.enabledFormats))patch.enabledFormats=[...effective.enabledFormats];

  const scoringOverrides:RulesetSettings['scoringOverrides']={};
  for(const formatId of new Set([...Object.keys(parent.scoringOverrides),...Object.keys(effective.scoringOverrides)])){
    const next=effective.scoringOverrides[formatId];
    if(next!==undefined&&!same(parent.scoringOverrides[formatId]??{},next))scoringOverrides[formatId]={...next};
  }
  if(Object.keys(scoringOverrides).length)patch.scoringOverrides=scoringOverrides;

  const compliance:Partial<RulesetSettings['compliance']>={};
  for(const key of Object.keys(effective.compliance) as Array<keyof RulesetSettings['compliance']>){
    if(effective.compliance[key]!==parent.compliance[key])compliance[key]=effective.compliance[key];
  }
  if(Object.keys(compliance).length)patch.compliance=compliance;

  const discipline:Partial<RulesetSettings['discipline']>={};
  for(const key of Object.keys(effective.discipline) as Array<keyof RulesetSettings['discipline']>){
    if(effective.discipline[key]!==parent.discipline[key])discipline[key]=effective.discipline[key];
  }
  if(Object.keys(discipline).length)patch.discipline=discipline;

  const bracket:Partial<RulesetSettings['bracket']>={};
  for(const key of Object.keys(effective.bracket) as Array<keyof RulesetSettings['bracket']>){
    if(effective.bracket[key]!==parent.bracket[key])bracket[key]=effective.bracket[key];
  }
  if(Object.keys(bracket).length)patch.bracket=bracket;

  return patch;
}

export function applyRulesetToFormat(preset:CompetitionFormatPreset,settings:RulesetSettings):CompetitionFormatPreset {
  const override=settings.scoringOverrides[preset.id]??{};
  return {...preset,scoringConfig:{...preset.scoringConfig,...override} as ScoringConfig};
}

export async function createRuleset(
  event:EventRecord,
  input:Omit<RulesetRecord,'id'|'organizationId'|'createdAt'|'updatedAt'|'revision'|'publishedAt'|'retiredAt'>
):Promise<string>{
  if(!input.name.trim()||!input.shortName.trim()||!input.version.trim())throw new Error('Name, short name, and version are required.');
  const id=crypto.randomUUID();
  const overrides:RulesetSettingsPatch=input.parentRulesetId
    ? (input.overrides??{})
    : (input.overrides??input.settings??structuredClone(defaultRulesetSettings));
  const record:RulesetRecord={
    ...input,id,organizationId:event.organizationId,status:'draft',overrides,
    settings:normalizeSettings(overrides),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  if(!supabase){
    const current=await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId),JSON.stringify([...current,record]));
    return id;
  }
  const {data,error}=await supabase.from('rulesets').insert({
    organization_id:event.organizationId,team_id:input.teamId??null,parent_ruleset_id:input.parentRulesetId??null,
    name:input.name.trim(),short_name:input.shortName.trim(),version:input.version.trim(),
    description:input.description?.trim()||null,status:'draft',effective_from:input.effectiveFrom||null,
    effective_to:input.effectiveTo||null,settings:overrides,eligibility_policy:input.eligibilityPolicy??{},
    scoring_policy:input.scoringPolicy??{},tournament_policy:input.tournamentPolicy??{},ranking_policy:input.rankingPolicy??{}
  }).select('id').single();
  if(error)throw error;
  return data.id;
}

export async function updateDraftRuleset(event:EventRecord,record:RulesetRecord):Promise<void>{
  if(record.status!=='draft')throw new Error('Only draft rulesets can be edited.');
  if(!record.updatedAt&&supabase)throw new Error('Ruleset version is missing. Reload before saving.');
  if(!supabase){
    const current=await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId),JSON.stringify(
      current.map(item=>item.id===record.id?{...record,updatedAt:new Date().toISOString()}:item)
    ));
    return;
  }
  const {error}=await supabase.rpc('update_ruleset_draft_guarded',{
    p_ruleset_id:record.id,p_expected_updated_at:record.updatedAt,p_parent_ruleset_id:record.parentRulesetId??null,
    p_name:record.name.trim(),p_short_name:record.shortName.trim(),p_version:record.version.trim(),
    p_description:record.description?.trim()||null,p_effective_from:record.effectiveFrom||null,
    p_effective_to:record.effectiveTo||null,p_settings:record.overrides??record.settings,
    p_eligibility_policy:record.eligibilityPolicy??{},p_scoring_policy:record.scoringPolicy??{},
    p_tournament_policy:record.tournamentPolicy??{},p_ranking_policy:record.rankingPolicy??{}
  });
  if(error)throw error;
}

export async function setRulesetStatus(event:EventRecord,record:RulesetRecord,status:RulesetStatus):Promise<void>{
  if(!record.updatedAt&&supabase)throw new Error('Ruleset version is missing. Reload before changing status.');
  if(!supabase){
    const current=await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId),JSON.stringify(
      current.map(item=>item.id===record.id?{...item,status,updatedAt:new Date().toISOString()}:item)
    ));
    return;
  }
  const {error}=await supabase.rpc('transition_ruleset_guarded',{
    p_ruleset_id:record.id,p_expected_updated_at:record.updatedAt,p_status:status
  });
  if(error)throw error;
}

export async function activateEventRuleset(
  event:EventRecord,rulesetId:string|null,exceptionReason?:string
):Promise<string|null>{
  if(!event.updatedAt&&supabase)throw new Error('Event version is missing. Reload before changing its ruleset.');
  if(!supabase){
    const key='buhurtos-demo-event-'+event.id;
    let saved:Record<string,unknown>={};
    try{saved=JSON.parse(localStorage.getItem(key)??'{}');}catch{saved={};}
    localStorage.setItem(key,JSON.stringify({...saved,rulesetId:rulesetId??undefined}));
    return rulesetId;
  }
  const {data,error}=await supabase.rpc('assign_event_ruleset_guarded',{
    p_event_id:event.id,p_ruleset_id:rulesetId,p_expected_event_updated_at:event.updatedAt,
    p_effective_window_exception_reason:exceptionReason?.trim()||null
  });
  if(error)throw error;
  return data as string|null;
}

export async function loadEffectiveRuleset(event:EventRecord):Promise<{
  record?:RulesetRecord;settings:RulesetSettings;rulesets:RulesetRecord[]
}>{
  const rulesets=await listRulesets(event.organizationId);
  return {
    record:event.rulesetId?rulesets.find(record=>record.id===event.rulesetId):undefined,
    settings:resolveRulesetSettings(rulesets,event.rulesetId),rulesets
  };
}
