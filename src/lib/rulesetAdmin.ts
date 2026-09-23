import type { EventRecord, RulesetRecord, RulesetSettings, RulesetSettingsPatch, ScoringConfig } from '../types';
import { supabase } from './supabase';
import { competitionFormats, type CompetitionFormatPreset } from './competitionFormats';

export const defaultRulesetSettings: RulesetSettings = {
  enabledFormats: competitionFormats.map(format => format.id),
  scoringOverrides: {},
  timing: {
    rounds: 3,
    overtimeEnabled: false
  },
  victory: {
    conditions: ['configured_format_result'],
    pointSystem: {},
    tieBreakers: ['wins','standing_points','score_differential','points_scored']
  },
  roster: {},
  equipment: {
    allowedWeapons: [],
    complianceRequirements: []
  },
  classifications: {
    ageDivisions: [],
    weightClasses: [],
    genderDivisions: []
  },
  compliance: {
    requireCheckIn: true,
    requireArmorClearance: true,
    requireMedicalClearance: true,
    requireWaiver: true,
    requireWeighIn: true
  },
  discipline: {
    knockdownsEnabled: true,
    yellowCardsBeforeSuspension: 2,
    redCardSuspensionMatches: 1,
    disqualificationRules: []
  },
  bracket: {
    antiFratricide: true,
    advancementRules: [],
    specialTournamentRules: []
  }
};

const demoKey = (organizationId: string) => 'buhurtos-demo-rulesets-' + organizationId;

function normalizePatch(value: RulesetSettingsPatch | null | undefined): RulesetSettingsPatch {
  if (!value) return {};
  return {
    ...(value.enabledFormats ? { enabledFormats: [...value.enabledFormats] } : {}),
    ...(value.scoringOverrides ? { scoringOverrides: structuredClone(value.scoringOverrides) } : {}),
    ...(value.timing ? { timing: { ...value.timing } } : {}),
    ...(value.victory ? {
      victory: {
        ...value.victory,
        ...(value.victory.conditions ? { conditions: [...value.victory.conditions] } : {}),
        ...(value.victory.pointSystem ? { pointSystem: { ...value.victory.pointSystem } } : {}),
        ...(value.victory.tieBreakers ? { tieBreakers: [...value.victory.tieBreakers] } : {})
      }
    } : {}),
    ...(value.roster ? { roster: { ...value.roster } } : {}),
    ...(value.equipment ? {
      equipment: {
        ...value.equipment,
        ...(value.equipment.allowedWeapons ? { allowedWeapons: [...value.equipment.allowedWeapons] } : {}),
        ...(value.equipment.complianceRequirements ? { complianceRequirements: [...value.equipment.complianceRequirements] } : {})
      }
    } : {}),
    ...(value.classifications ? {
      classifications: {
        ...value.classifications,
        ...(value.classifications.ageDivisions ? { ageDivisions: [...value.classifications.ageDivisions] } : {}),
        ...(value.classifications.weightClasses ? { weightClasses: [...value.classifications.weightClasses] } : {}),
        ...(value.classifications.genderDivisions ? { genderDivisions: [...value.classifications.genderDivisions] } : {})
      }
    } : {}),
    ...(value.compliance ? { compliance: { ...value.compliance } } : {}),
    ...(value.discipline ? {
      discipline: {
        ...value.discipline,
        ...(value.discipline.disqualificationRules ? { disqualificationRules: [...value.discipline.disqualificationRules] } : {})
      }
    } : {}),
    ...(value.bracket ? {
      bracket: {
        ...value.bracket,
        ...(value.bracket.advancementRules ? { advancementRules: [...value.bracket.advancementRules] } : {}),
        ...(value.bracket.specialTournamentRules ? { specialTournamentRules: [...value.bracket.specialTournamentRules] } : {})
      }
    } : {})
  };
}

export function mergeRulesetSettings(parent: RulesetSettings, patch: RulesetSettingsPatch): RulesetSettings {
  return {
    enabledFormats: patch.enabledFormats ? [...patch.enabledFormats] : [...parent.enabledFormats],
    scoringOverrides: { ...parent.scoringOverrides, ...(patch.scoringOverrides ?? {}) },
    timing: { ...parent.timing, ...(patch.timing ?? {}) },
    victory: {
      ...parent.victory,
      ...(patch.victory ?? {}),
      conditions: patch.victory?.conditions ? [...patch.victory.conditions] : [...parent.victory.conditions],
      pointSystem: { ...parent.victory.pointSystem, ...(patch.victory?.pointSystem ?? {}) },
      tieBreakers: patch.victory?.tieBreakers ? [...patch.victory.tieBreakers] : [...parent.victory.tieBreakers]
    },
    roster: { ...parent.roster, ...(patch.roster ?? {}) },
    equipment: {
      ...parent.equipment,
      ...(patch.equipment ?? {}),
      allowedWeapons: patch.equipment?.allowedWeapons ? [...patch.equipment.allowedWeapons] : [...parent.equipment.allowedWeapons],
      complianceRequirements: patch.equipment?.complianceRequirements ? [...patch.equipment.complianceRequirements] : [...parent.equipment.complianceRequirements]
    },
    classifications: {
      ...parent.classifications,
      ...(patch.classifications ?? {}),
      ageDivisions: patch.classifications?.ageDivisions ? [...patch.classifications.ageDivisions] : [...parent.classifications.ageDivisions],
      weightClasses: patch.classifications?.weightClasses ? [...patch.classifications.weightClasses] : [...parent.classifications.weightClasses],
      genderDivisions: patch.classifications?.genderDivisions ? [...patch.classifications.genderDivisions] : [...parent.classifications.genderDivisions]
    },
    compliance: { ...parent.compliance, ...(patch.compliance ?? {}) },
    discipline: {
      ...parent.discipline,
      ...(patch.discipline ?? {}),
      disqualificationRules: patch.discipline?.disqualificationRules ? [...patch.discipline.disqualificationRules] : [...parent.discipline.disqualificationRules]
    },
    bracket: {
      ...parent.bracket,
      ...(patch.bracket ?? {}),
      advancementRules: patch.bracket?.advancementRules ? [...patch.bracket.advancementRules] : [...parent.bracket.advancementRules],
      specialTournamentRules: patch.bracket?.specialTournamentRules ? [...patch.bracket.specialTournamentRules] : [...parent.bracket.specialTournamentRules]
    }
  };
}

function rowToRuleset(row: Record<string, any>): RulesetRecord {
  return {
    id: row.id,
    organizationId: row.organization_id ?? undefined,
    teamId: row.team_id ?? undefined,
    parentRulesetId: row.parent_ruleset_id ?? undefined,
    name: row.name,
    shortName: row.short_name,
    version: row.version,
    description: row.description ?? undefined,
    status: row.status,
    effectiveFrom: row.effective_from ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    settings: normalizePatch(row.settings),
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

export async function listRulesets(organizationId: string): Promise<RulesetRecord[]> {
  if (!supabase) {
    try {
      return (JSON.parse(localStorage.getItem(demoKey(organizationId)) ?? '[]') as RulesetRecord[])
        .map(record => ({ ...record, settings: normalizePatch(record.settings) }))
        .sort((a,b) => a.name.localeCompare(b.name) || b.version.localeCompare(a.version));
    } catch {
      return [];
    }
  }
  const { data, error } = await supabase
    .from('rulesets')
    .select('*')
    .or('organization_id.is.null,organization_id.eq.' + organizationId)
    .order('name')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToRuleset);
}

export function resolveRulesetSettings(rulesets: RulesetRecord[], rulesetId?: string): RulesetSettings {
  if (!rulesetId) return structuredClone(defaultRulesetSettings);
  const byId = new Map(rulesets.map(record => [record.id, record]));
  const resolving = new Set<string>();

  const resolve = (id: string): RulesetSettings => {
    if (resolving.has(id)) throw new Error('Ruleset inheritance contains a cycle.');
    resolving.add(id);
    const record = byId.get(id);
    if (!record) {
      resolving.delete(id);
      return structuredClone(defaultRulesetSettings);
    }
    const parent = record.parentRulesetId
      ? resolve(record.parentRulesetId)
      : structuredClone(defaultRulesetSettings);
    resolving.delete(id);
    return mergeRulesetSettings(parent, record.settings);
  };

  return resolve(rulesetId);
}

export function applyRulesetToFormat(preset: CompetitionFormatPreset, settings: RulesetSettings): CompetitionFormatPreset {
  const override = settings.scoringOverrides[preset.id] ?? {};
  return {
    ...preset,
    scoringConfig: { ...preset.scoringConfig, ...override } as ScoringConfig
  };
}

export async function createRuleset(
  event: EventRecord,
  input: Omit<RulesetRecord,'id'|'organizationId'|'createdAt'|'updatedAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const patch = normalizePatch(input.settings);
  const record: RulesetRecord = {
    ...input,
    id,
    organizationId: event.organizationId,
    settings: patch,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!supabase) {
    const current = await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId), JSON.stringify([...current, record]));
    return id;
  }
  const { data, error } = await supabase.from('rulesets').insert({
    organization_id: event.organizationId,
    team_id: input.teamId ?? null,
    parent_ruleset_id: input.parentRulesetId ?? null,
    name: input.name.trim(),
    short_name: input.shortName.trim(),
    version: input.version.trim(),
    description: input.description?.trim() || null,
    status: input.status,
    effective_from: input.effectiveFrom || null,
    effective_to: input.effectiveTo || null,
    settings: patch
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateDraftRuleset(event: EventRecord, record: RulesetRecord): Promise<void> {
  if (record.status !== 'draft') throw new Error('Published rulesets are immutable. Create a new version instead.');
  const patch = normalizePatch(record.settings);
  if (!supabase) {
    const current = await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId), JSON.stringify(current.map(item =>
      item.id === record.id ? { ...record, settings: patch, updatedAt: new Date().toISOString() } : item
    )));
    return;
  }
  const { error } = await supabase.from('rulesets').update({
    parent_ruleset_id: record.parentRulesetId ?? null,
    name: record.name.trim(),
    short_name: record.shortName.trim(),
    version: record.version.trim(),
    description: record.description?.trim() || null,
    settings: patch,
    effective_from: record.effectiveFrom || null,
    effective_to: record.effectiveTo || null
  }).eq('id',record.id).eq('organization_id',event.organizationId).eq('status','draft');
  if (error) throw error;
}

export async function cloneRulesetVersion(
  event: EventRecord,
  source: RulesetRecord,
  version: string
): Promise<string> {
  return createRuleset(event, {
    teamId: source.teamId,
    parentRulesetId: source.id,
    name: source.name,
    shortName: source.shortName,
    version,
    description: source.description,
    status: 'draft',
    effectiveFrom: undefined,
    effectiveTo: undefined,
    settings: {}
  });
}

export async function setRulesetStatus(event: EventRecord, record: RulesetRecord, status: 'published'|'retired'): Promise<void> {
  if (status === 'published' && record.status !== 'draft') throw new Error('Only draft rulesets can be published.');
  if (status === 'retired' && record.status !== 'published') throw new Error('Only published rulesets can be retired.');
  if (!supabase) {
    const current = await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId), JSON.stringify(current.map(item =>
      item.id === record.id ? { ...item, status, updatedAt: new Date().toISOString() } : item
    )));
    return;
  }
  const { error } = await supabase.from('rulesets').update({ status }).eq('id',record.id).eq('organization_id',event.organizationId);
  if (error) throw error;
}

export async function activateEventRuleset(event: EventRecord, rulesetId: string | null): Promise<void> {
  if (!supabase) {
    const key='buhurtos-demo-event-' + event.id;
    let saved: Record<string,unknown>={};
    try { saved=JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { saved={}; }
    localStorage.setItem(key,JSON.stringify({ ...saved, rulesetId: rulesetId ?? undefined }));
    return;
  }
  const { error } = await supabase.from('events').update({ ruleset_id: rulesetId }).eq('id',event.id);
  if (error) throw error;
}

export async function loadEffectiveRuleset(event: EventRecord): Promise<{ record?: RulesetRecord; settings: RulesetSettings; rulesets: RulesetRecord[] }> {
  const rulesets=await listRulesets(event.organizationId);
  return {
    record: event.rulesetId ? rulesets.find(record=>record.id===event.rulesetId) : undefined,
    settings: resolveRulesetSettings(rulesets,event.rulesetId),
    rulesets
  };
}
