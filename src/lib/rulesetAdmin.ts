import type { EventRecord, RulesetRecord, RulesetSettings, ScoringConfig } from '../types';
import { supabase } from './supabase';
import { competitionFormats, type CompetitionFormatPreset } from './competitionFormats';

export const defaultRulesetSettings: RulesetSettings = {
  enabledFormats: competitionFormats.map(format => format.id),
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

function normalizeSettings(value: Partial<RulesetSettings> | null | undefined): RulesetSettings {
  return {
    enabledFormats: value?.enabledFormats?.length ? [...value.enabledFormats] : [...defaultRulesetSettings.enabledFormats],
    scoringOverrides: { ...defaultRulesetSettings.scoringOverrides, ...(value?.scoringOverrides ?? {}) },
    compliance: { ...defaultRulesetSettings.compliance, ...(value?.compliance ?? {}) },
    discipline: { ...defaultRulesetSettings.discipline, ...(value?.discipline ?? {}) },
    bracket: { ...defaultRulesetSettings.bracket, ...(value?.bracket ?? {}) }
  };
}

function rowToRuleset(row: any): RulesetRecord {
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
    settings: normalizeSettings(row.settings),
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

export async function listRulesets(organizationId: string): Promise<RulesetRecord[]> {
  if (!supabase) {
    try {
      return (JSON.parse(localStorage.getItem(demoKey(organizationId)) ?? '[]') as RulesetRecord[])
        .map(record => ({ ...record, settings: normalizeSettings(record.settings) }))
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
  const visited = new Set<string>();

  const resolve = (id: string): RulesetSettings => {
    if (visited.has(id)) throw new Error('Ruleset inheritance contains a cycle.');
    visited.add(id);
    const record = byId.get(id);
    if (!record) {
      visited.delete(id);
      return structuredClone(defaultRulesetSettings);
    }
    const parent = record.parentRulesetId ? resolve(record.parentRulesetId) : structuredClone(defaultRulesetSettings);
    visited.delete(id);
    const own = record.settings;
    return {
      enabledFormats: own.enabledFormats?.length ? [...own.enabledFormats] : [...parent.enabledFormats],
      scoringOverrides: { ...parent.scoringOverrides, ...(own.scoringOverrides ?? {}) },
      compliance: { ...parent.compliance, ...(own.compliance ?? {}) },
      discipline: { ...parent.discipline, ...(own.discipline ?? {}) },
      bracket: { ...parent.bracket, ...(own.bracket ?? {}) }
    };
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
  const record: RulesetRecord = {
    ...input,
    id,
    organizationId: event.organizationId,
    settings: normalizeSettings(input.settings),
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
    settings: normalizeSettings(input.settings)
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateDraftRuleset(event: EventRecord, record: RulesetRecord): Promise<void> {
  if (record.status !== 'draft') throw new Error('Published rulesets are immutable. Create a new version instead.');
  if (!supabase) {
    const current = await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId), JSON.stringify(current.map(item => item.id === record.id ? { ...record, updatedAt: new Date().toISOString() } : item)));
    return;
  }
  const { error } = await supabase.from('rulesets').update({
    parent_ruleset_id: record.parentRulesetId ?? null,
    name: record.name.trim(),
    short_name: record.shortName.trim(),
    version: record.version.trim(),
    description: record.description?.trim() || null,
    settings: normalizeSettings(record.settings),
    effective_from: record.effectiveFrom || null,
    effective_to: record.effectiveTo || null
  }).eq('id',record.id).eq('organization_id',event.organizationId).eq('status','draft');
  if (error) throw error;
}

export async function setRulesetStatus(event: EventRecord, record: RulesetRecord, status: 'published'|'retired'): Promise<void> {
  if (!supabase) {
    const current = await listRulesets(event.organizationId);
    localStorage.setItem(demoKey(event.organizationId), JSON.stringify(current.map(item => item.id === record.id ? { ...item, status, updatedAt: new Date().toISOString() } : item)));
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
