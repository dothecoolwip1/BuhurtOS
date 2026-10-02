import { supabase } from '../lib/supabase';
import type { DirectoryAffiliation, RecordSourceRef, ResultRow } from '../lib/teamDirectory';
import type { SocialNetwork } from './teamManager';

/** Plain reads. Row level security decides what the viewer sees: approved teams for everyone, pending ones for organizers and the team's captain. */

export interface DirectoryAffiliationRecord extends DirectoryAffiliation { affiliationId: string; relation: string; fromDate: string | null; toDate: string | null; sources: RecordSourceRef[] }
export interface DirectoryEntry {
  id: string; slug: string; name: string; city: string | null; region: string | null; country: string | null; status: 'pending' | 'approved';
  colors: [string, string]; crestDivision: string; initial: string; emblemPath: string | null;
  description: string | null; website: string | null; socialLinks: Partial<Record<SocialNetwork, string>>; foundedYear: number | null; claimedOrganizations: string[];
  affiliations: DirectoryAffiliationRecord[]; sources: RecordSourceRef[];
}

type TeamDb = {
  id: string; slug: string; name: string; city: string | null; region: string | null; country: string | null; status: 'pending' | 'approved';
  colors: string[]; crest_division: string; initial: string; emblem_path?: string | null;
  description: string | null; website: string | null; social_links: Record<string, string> | null; founded_year: number | null; claimed_organizations: string[] | null;
};
type SourceDb = { kind: RecordSourceRef['kind']; title: string; url: string | null };
type RecordSourceDb = { entity_type: string; entity_id: string; status: RecordSourceRef['status']; sources: SourceDb | SourceDb[] | null };
type OrgDb = { slug: string; name: string };
type AffDb = { id: string; team_id: string; relation: string; from_date: string | null; to_date: string | null; organizations: OrgDb | OrgDb[] | null };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const TEAM_COLUMNS = 'id,slug,name,city,region,country,status,colors,crest_division,initial,emblem_path,description,website,social_links,founded_year,claimed_organizations';

function toRecordSource(r: RecordSourceDb): RecordSourceRef | null {
  const s = one(r.sources);
  return s ? { kind: s.kind, title: s.title, url: s.url, status: r.status } : null;
}

async function assemble(teams: TeamDb[]): Promise<DirectoryEntry[]> {
  if (teams.length === 0) return [];
  const [affs, srcs] = await Promise.all([
    supabase.from('team_affiliations').select('id,team_id,relation,from_date,to_date,organizations(slug,name)').in('team_id', teams.map(t => t.id)),
    supabase.from('record_sources').select('entity_type,entity_id,status,sources(kind,title,url)').in('entity_type', ['team', 'team_affiliation'])
  ]);
  if (affs.error) throw affs.error;
  if (srcs.error) throw srcs.error;
  const bySource = new Map<string, RecordSourceRef[]>();
  for (const r of srcs.data as unknown as RecordSourceDb[]) {
    const ref = toRecordSource(r);
    const key = `${r.entity_type}:${r.entity_id}`;
    if (ref) bySource.set(key, [...(bySource.get(key) ?? []), ref]);
  }
  const affByTeam = new Map<string, DirectoryAffiliationRecord[]>();
  for (const a of affs.data as unknown as AffDb[]) {
    const org = one(a.organizations);
    if (!org) continue;
    const rec: DirectoryAffiliationRecord = { affiliationId: a.id, organizationSlug: org.slug, organizationName: org.name, relation: a.relation, fromDate: a.from_date, toDate: a.to_date, sources: bySource.get(`team_affiliation:${a.id}`) ?? [] };
    affByTeam.set(a.team_id, [...(affByTeam.get(a.team_id) ?? []), rec]);
  }
  return teams.map(t => ({
    id: t.id, slug: t.slug, name: t.name, city: t.city, region: t.region, country: t.country, status: t.status,
    colors: [t.colors[0] ?? '#2C4A8C', t.colors[1] ?? '#E9ECEF'] as [string, string], crestDivision: t.crest_division, initial: t.initial, emblemPath: t.emblem_path ?? null,
    description: t.description, website: t.website, socialLinks: (t.social_links ?? {}) as Partial<Record<SocialNetwork, string>>, foundedYear: t.founded_year, claimedOrganizations: t.claimed_organizations ?? [],
    affiliations: affByTeam.get(t.id) ?? [], sources: bySource.get(`team:${t.id}`) ?? []
  }));
}

export async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const { data, error } = await supabase.from('teams').select(TEAM_COLUMNS).order('name');
  if (error) throw error;
  return assemble(data as unknown as TeamDb[]);
}

export async function fetchTeamBySlug(slug: string): Promise<DirectoryEntry | null> {
  const { data, error } = await supabase.from('teams').select(TEAM_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data ? (await assemble([data as unknown as TeamDb]))[0] : null;
}

export interface TeamEventEntry { entryId: string; competitionName: string; entryStatus: string; eventName: string; eventSlug: string; startsOn: string; endsOn: string; eventStatus: 'draft' | 'published' | 'cancelled' }
type EventDb = { name: string; slug: string; starts_on: string; ends_on: string; status: TeamEventEntry['eventStatus'] };
type CompDb = { name: string; events: EventDb | EventDb[] | null };
type EntryDb = { id: string; status: string; competitions: CompDb | CompDb[] | null };

/** Entries are readable for published events; organizers and scorers also see entries in drafts. */
export async function fetchTeamEntries(teamId: string): Promise<TeamEventEntry[]> {
  const { data, error } = await supabase.from('entries').select('id,status,competitions(name,events(name,slug,starts_on,ends_on,status))').eq('team_id', teamId);
  if (error) throw error;
  const out: TeamEventEntry[] = [];
  for (const e of data as unknown as EntryDb[]) {
    const c = one(e.competitions);
    const ev = c ? one(c.events) : null;
    if (!c || !ev) continue;
    out.push({ entryId: e.id, competitionName: c.name, entryStatus: e.status, eventName: ev.name, eventSlug: ev.slug, startsOn: ev.starts_on, endsOn: ev.ends_on, eventStatus: ev.status });
  }
  return out.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}

/** From the permanent results record (team_history). Empty until an organizer finishes a competition. */
export async function fetchTeamResults(teamId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase.from('team_history').select('event_name,event_slug,starts_on,competition_name,final_place,points').eq('team_id', teamId).order('starts_on', { ascending: false });
  if (error) throw error;
  return (data as { event_name: string; event_slug: string; starts_on: string; competition_name: string; final_place: number | null; points: number | null }[])
    .map(r => ({ eventName: r.event_name, eventSlug: r.event_slug, startsOn: r.starts_on, competitionName: r.competition_name, finalPlace: r.final_place, points: r.points === null ? null : Number(r.points) }));
}

/** Public address of a team's emblem, or null when it has none. */
export const teamEmblemUrl = (path: string | null | undefined): string | null => (path ? supabase.storage.from('team-emblems').getPublicUrl(path).data.publicUrl : null);
