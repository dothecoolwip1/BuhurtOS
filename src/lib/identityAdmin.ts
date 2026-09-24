import type { Club, CompetitionDivision, EventRecord, FighterAffiliation, FoundationFighter, RosterEntry, Team } from '../types';
import { supabase } from './supabase';

const demoKey = (kind: string, organizationId: string) => 'buhurtos-demo-foundation-' + kind + '-' + organizationId;

function readDemo<T>(key: string): T[] {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(key) || '[]') as T[]; } catch { return []; }
}

function writeDemo<T>(key: string, rows: T[]): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(rows));
}

export function normalizeFighterName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function validateAffiliationWindow(startsOn: string, endsOn?: string): string | null {
  if (!startsOn) return 'Start date is required.';
  const start = new Date(startsOn + 'T00:00:00Z');
  if (Number.isNaN(start.getTime())) return 'Start date is invalid.';
  if (!endsOn) return null;
  const end = new Date(endsOn + 'T00:00:00Z');
  if (Number.isNaN(end.getTime())) return 'End date is invalid.';
  return end < start ? 'End date cannot be before the start date.' : null;
}

export function activeAffiliationsAt(rows: FighterAffiliation[], isoDate: string): FighterAffiliation[] {
  const target = isoDate.slice(0, 10);
  return rows.filter(row => row.startsOn <= target && (!row.endsOn || row.endsOn >= target));
}

export function findDuplicateFighterCandidates(rows: FoundationFighter[]): Array<[FoundationFighter, FoundationFighter]> {
  const active = rows.filter(row => !row.deletedAt && !row.mergedIntoFighterId);
  const pairs: Array<[FoundationFighter, FoundationFighter]> = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (active[i].organizationId === active[j].organizationId && normalizeFighterName(active[i].name) === normalizeFighterName(active[j].name)) {
        pairs.push([active[i], active[j]]);
      }
    }
  }
  return pairs;
}

function rowToClub(row: any): Club {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    shortName: row.short_name || undefined,
    region: row.region || undefined,
    websiteUrl: row.website_url || undefined,
    isActive: row.is_active,
    visibility: row.visibility || undefined,
    publicDescription: row.public_description || undefined,
    logoPath: row.logo_path || undefined,
    publicContactEmail: row.public_contact_email || undefined,
    deletedAt: row.deleted_at || undefined
  };
}

function rowToDivision(row: any): CompetitionDivision {
  return {
    id: row.id,
    organizationId: row.organization_id || undefined,
    name: row.name,
    slug: row.slug,
    competitionFormatId: row.competition_format_id,
    rulesetId: row.ruleset_id || undefined,
    teamSize: row.team_size || undefined,
    minWeightKg: row.min_weight_kg == null ? undefined : Number(row.min_weight_kg),
    maxWeightKg: row.max_weight_kg == null ? undefined : Number(row.max_weight_kg),
    ageMin: row.age_min == null ? undefined : row.age_min,
    ageMax: row.age_max == null ? undefined : row.age_max,
    eligibilityLabel: row.eligibility_label || undefined,
    status: row.status,
    metadata: row.metadata || {},
    deletedAt: row.deleted_at || undefined
  };
}

function rowToFighter(row: any): FoundationFighter {
  return {
    id: row.id,
    organizationId: row.organization_id,
    identityId: row.identity_id,
    teamId: row.team_id || undefined,
    userId: row.user_id || undefined,
    name: row.name,
    nickname: row.nickname || undefined,
    preferredWeapons: row.preferred_weapons || [],
    mergedIntoFighterId: row.merged_into_fighter_id || undefined,
    deletedAt: row.deleted_at || undefined
  };
}

function rowToAffiliation(row: any): FighterAffiliation {
  return {
    id: row.id,
    identityId: row.identity_id,
    organizationId: row.organization_id,
    clubId: row.club_id || undefined,
    teamId: row.team_id || undefined,
    affiliationType: row.affiliation_type,
    startsOn: row.starts_on,
    endsOn: row.ends_on || undefined,
    isPrimary: row.is_primary,
    sourceEventId: row.source_event_id || undefined,
    notes: row.notes || undefined
  };
}

export async function listFoundationFighters(event: EventRecord, roster: RosterEntry[]): Promise<FoundationFighter[]> {
  if (!supabase) {
    const base = new Map<string, FoundationFighter>();
    for (const entry of roster) {
      if (!entry.fighterId) continue;
      if (!base.has(entry.fighterId)) {
        base.set(entry.fighterId, {
          id: entry.fighterId,
          identityId: entry.fighterId,
          organizationId: event.organizationId,
          teamId: entry.teamId,
          name: entry.displayName,
          preferredWeapons: []
        });
      }
    }
    for (const saved of readDemo<FoundationFighter>(demoKey('fighters', event.organizationId))) base.set(saved.id, saved);
    return [...base.values()].filter(row => !row.deletedAt && !row.mergedIntoFighterId).sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await supabase.from('fighters').select('id,organization_id,identity_id,team_id,user_id,name,nickname,preferred_weapons,merged_into_fighter_id,deleted_at').eq('organization_id', event.organizationId).is('deleted_at', null).order('name');
  if (error) throw error;
  return (data || []).map(rowToFighter);
}

export async function listTeams(organizationId: string): Promise<Team[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('teams').select('id,organization_id,name,short_name,city_or_region,club_id,status,is_active,visibility,public_description,deleted_at').eq('organization_id', organizationId).is('deleted_at', null).order('name');
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    shortName: row.short_name || undefined,
    cityOrRegion: row.city_or_region || undefined,
    clubId: row.club_id || undefined,
    status: row.status || undefined,
    isActive: row.is_active,
    visibility: row.visibility || undefined,
    publicDescription: row.public_description || undefined,
    deletedAt: row.deleted_at || undefined
  }));
}

export async function listClubs(organizationId: string): Promise<Club[]> {
  if (!supabase) return readDemo<Club>(demoKey('clubs', organizationId)).filter(row => !row.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const { data, error } = await supabase.from('clubs').select('*').eq('organization_id', organizationId).is('deleted_at', null).order('name');
  if (error) throw error;
  return (data || []).map(rowToClub);
}

export async function createClub(organizationId: string, input: { name: string; shortName?: string; region?: string; websiteUrl?: string }): Promise<Club> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('Club name is required.');
  if (!supabase) {
    const row: Club = { id: crypto.randomUUID(), organizationId, name: cleanName, shortName: input.shortName?.trim() || undefined, region: input.region?.trim() || undefined, websiteUrl: input.websiteUrl?.trim() || undefined, isActive: true };
    const key = demoKey('clubs', organizationId);
    writeDemo(key, [...readDemo<Club>(key), row]);
    return row;
  }
  const { data: clubId, error } = await supabase.rpc('create_club', {
    p_organization: organizationId,
    p_name: cleanName,
    p_short_name: input.shortName?.trim() || null,
    p_region: input.region?.trim() || null,
    p_visibility: 'members',
    p_description: null,
    p_website: input.websiteUrl?.trim() || null
  });
  if (error) throw error;
  const result = await supabase.from('clubs').select('*').eq('id', clubId as string).single();
  if (result.error) throw result.error;
  return rowToClub(result.data);
}

export async function updateClub(organizationId: string, clubId: string, input: { name: string; shortName?: string; region?: string; websiteUrl?: string }): Promise<void> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('Club name is required.');
  if (!supabase) {
    const key = demoKey('clubs', organizationId);
    writeDemo(key, readDemo<Club>(key).map(row => row.id === clubId ? { ...row, name: cleanName, shortName: input.shortName?.trim() || undefined, region: input.region?.trim() || undefined, websiteUrl: input.websiteUrl?.trim() || undefined } : row));
    return;
  }
  const existing = await supabase.from('clubs').select('visibility,public_description').eq('id', clubId).eq('organization_id', organizationId).single();
  if (existing.error) throw existing.error;
  const { error } = await supabase.rpc('update_club', {
    p_club: clubId,
    p_name: cleanName,
    p_short_name: input.shortName?.trim() || null,
    p_region: input.region?.trim() || null,
    p_visibility: existing.data.visibility || 'members',
    p_description: existing.data.public_description || null,
    p_website: input.websiteUrl?.trim() || null
  });
  if (error) throw error;
}

export async function archiveClub(organizationId: string, clubId: string): Promise<void> {
  if (!supabase) {
    const deletedAt = new Date().toISOString();
    const key = demoKey('clubs', organizationId);
    writeDemo(key, readDemo<Club>(key).map(row => row.id === clubId ? { ...row, isActive: false, deletedAt } : row));
    return;
  }
  const { error } = await supabase.rpc('archive_club', { p_club: clubId });
  if (error) throw error;
}

export async function listDivisions(organizationId: string): Promise<CompetitionDivision[]> {
  if (!supabase) return readDemo<CompetitionDivision>(demoKey('divisions', organizationId)).filter(row => !row.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const { data, error } = await supabase.from('competition_divisions').select('*').or('organization_id.is.null,organization_id.eq.' + organizationId).is('deleted_at', null).order('name');
  if (error) throw error;
  return (data || []).map(rowToDivision);
}

export async function createDivision(organizationId: string, input: { name: string; competitionFormatId: string; teamSize?: number; eligibilityLabel?: string }): Promise<CompetitionDivision> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('Division name is required.');
  const slug = normalizeFighterName(cleanName).replace(/\s+/g, '-');
  if (!slug) throw new Error('Division name must contain letters or numbers.');
  const row: CompetitionDivision = {
    id: crypto.randomUUID(),
    organizationId,
    name: cleanName,
    slug,
    competitionFormatId: input.competitionFormatId,
    teamSize: input.teamSize,
    eligibilityLabel: input.eligibilityLabel?.trim() || undefined,
    status: 'draft',
    metadata: {}
  };
  if (!supabase) {
    const key = demoKey('divisions', organizationId);
    writeDemo(key, [...readDemo<CompetitionDivision>(key), row]);
    return row;
  }
  const { data, error } = await supabase.from('competition_divisions').insert({
    organization_id: organizationId,
    name: cleanName,
    slug,
    competition_format_id: input.competitionFormatId,
    team_size: input.teamSize || null,
    eligibility_label: input.eligibilityLabel?.trim() || null,
    status: 'draft'
  }).select('*').single();
  if (error) throw error;
  return rowToDivision(data);
}

export async function updateDivision(organizationId: string, divisionId: string, input: { name: string; competitionFormatId: string; teamSize?: number; eligibilityLabel?: string }): Promise<void> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('Division name is required.');
  const slug = normalizeFighterName(cleanName).replace(/\s+/g, '-');
  if (!supabase) {
    const key = demoKey('divisions', organizationId);
    writeDemo(key, readDemo<CompetitionDivision>(key).map(row => row.id === divisionId ? { ...row, name: cleanName, slug, competitionFormatId: input.competitionFormatId, teamSize: input.teamSize, eligibilityLabel: input.eligibilityLabel?.trim() || undefined } : row));
    return;
  }
  const { error } = await supabase.from('competition_divisions').update({
    name: cleanName,
    slug,
    competition_format_id: input.competitionFormatId,
    team_size: input.teamSize || null,
    eligibility_label: input.eligibilityLabel?.trim() || null
  }).eq('id', divisionId).eq('organization_id', organizationId).is('deleted_at', null);
  if (error) throw error;
}

export async function setDivisionStatus(organizationId: string, divisionId: string, status: CompetitionDivision['status']): Promise<void> {
  if (!supabase) {
    const key = demoKey('divisions', organizationId);
    writeDemo(key, readDemo<CompetitionDivision>(key).map(row => row.id === divisionId ? { ...row, status } : row));
    return;
  }
  const { error } = await supabase.from('competition_divisions').update({ status }).eq('id', divisionId).eq('organization_id', organizationId).is('deleted_at', null);
  if (error) throw error;
}

export async function archiveDivision(organizationId: string, divisionId: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  if (!supabase) {
    const key = demoKey('divisions', organizationId);
    writeDemo(key, readDemo<CompetitionDivision>(key).map(row => row.id === divisionId ? { ...row, status: 'retired', deletedAt } : row));
    return;
  }
  const { error } = await supabase.from('competition_divisions').update({ status: 'retired', deleted_at: deletedAt }).eq('id', divisionId).eq('organization_id', organizationId).is('deleted_at', null);
  if (error) throw error;
}

export async function listAffiliations(organizationId: string): Promise<FighterAffiliation[]> {
  if (!supabase) return readDemo<FighterAffiliation>(demoKey('affiliations', organizationId)).sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  const { data, error } = await supabase.from('fighter_affiliations').select('*').eq('organization_id', organizationId).order('starts_on', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToAffiliation);
}

export async function createAffiliation(input: Omit<FighterAffiliation, 'id'>): Promise<FighterAffiliation> {
  const validation = validateAffiliationWindow(input.startsOn, input.endsOn);
  if (validation) throw new Error(validation);
  if (!input.clubId && !input.teamId && input.affiliationType !== 'independent') throw new Error('Choose a club or team, or mark the fighter independent.');
  const row: FighterAffiliation = { ...input, id: crypto.randomUUID() };
  if (!supabase) {
    const key = demoKey('affiliations', input.organizationId);
    const current = readDemo<FighterAffiliation>(key);
    if (input.isPrimary && !input.endsOn && current.some(item => item.identityId === input.identityId && item.isPrimary && !item.endsOn)) {
      throw new Error('This fighter already has an active primary affiliation.');
    }
    writeDemo(key, [row, ...current]);
    return row;
  }
  const { data, error } = await supabase.rpc('create_fighter_affiliation', {
    p_identity_id: input.identityId,
    p_organization_id: input.organizationId,
    p_club_id: input.clubId || null,
    p_team_id: input.teamId || null,
    p_affiliation_type: input.affiliationType,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn || null,
    p_is_primary: input.isPrimary,
    p_source_event_id: input.sourceEventId || null,
    p_notes: input.notes || null
  });
  if (error) throw error;
  return { ...input, id: data as string };
}

export async function endAffiliation(organizationId: string, affiliationId: string, endsOn = new Date().toISOString().slice(0, 10)): Promise<void> {
  if (!supabase) {
    const key = demoKey('affiliations', organizationId);
    writeDemo(key, readDemo<FighterAffiliation>(key).map(row => row.id === affiliationId ? { ...row, endsOn, isPrimary: false } : row));
    return;
  }
  const { error } = await supabase.rpc('end_fighter_affiliation', {
    p_affiliation_id: affiliationId,
    p_ends_on: endsOn
  });
  if (error) throw error;
}

export async function archiveFoundationFighter(event: EventRecord, roster: RosterEntry[], fighterId: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  if (!supabase) {
    const key = demoKey('fighters', event.organizationId);
    const current = await listFoundationFighters(event, roster);
    writeDemo(key, current.map(row => row.id === fighterId ? { ...row, deletedAt } : row));
    return;
  }
  const { error } = await supabase.from('fighters').update({ is_active: false, deleted_at: deletedAt }).eq('id', fighterId).eq('organization_id', event.organizationId).is('deleted_at', null);
  if (error) throw error;
}

export async function claimTemporaryFighter(event: EventRecord, rosterEntryId: string, existingFighterId?: string, displayName?: string): Promise<string> {
  if (!supabase) {
    let fighterId = existingFighterId;
    if (!fighterId) {
      fighterId = crypto.randomUUID();
      const key = demoKey('fighters', event.organizationId);
      const current = readDemo<FoundationFighter>(key);
      writeDemo(key, [...current, { id: fighterId, identityId: fighterId, organizationId: event.organizationId, name: (displayName || 'Temporary fighter').trim(), preferredWeapons: [] }]);
    }
    const overrideKey = 'buhurtos-demo-roster-overrides';
    const overrides = readObject(overrideKey);
    overrides[rosterEntryId] = { ...(overrides[rosterEntryId] || {}), fighterId, entryType: 'fighter' };
    localStorage.setItem(overrideKey, JSON.stringify(overrides));
    return fighterId;
  }
  const { data, error } = await supabase.rpc('claim_temporary_fighter', { p_roster_entry_id: rosterEntryId, p_existing_fighter_id: existingFighterId || null, p_display_name: displayName || null });
  if (error) throw error;
  return data as string;
}

function readObject(key: string): Record<string, any> {
  if (typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(key) || '{}') as Record<string, any>; } catch { return {}; }
}

export async function mergeFoundationFighters(): Promise<void> {
  throw new Error('Direct fighter merges are disabled. Use the identity merge review workflow.');
}
