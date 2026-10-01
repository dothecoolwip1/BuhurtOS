import { supabase } from '../lib/supabase';
import { countDistinct, type OrgEventInput } from '../lib/platformOrgs';
import { ORGANIZATION_COLUMNS, toOrganization, type Organization } from './organizations';

/** Public reads for an organization's page. Row level security decides what is visible; nothing here hides or shows by itself. */

type OrgDb = Parameters<typeof toOrganization>[0];
export async function fetchOrganizationBySlug(slug: string): Promise<Organization | null> {
  const { data, error } = await supabase.from('organizations').select(ORGANIZATION_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data ? toOrganization(data as unknown as OrgDb) : null;
}

export interface OrgTeam { id: string; slug: string; name: string; city: string | null; region: string | null }
export interface OrganizationPageData { teams: OrgTeam[]; fightersCount: number; events: OrgEventInput[] }
type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Current member teams (affiliation relation 'member', dated now) that are in teams_active, the fighters on them, and the organization's events. */
export async function fetchOrganizationPage(org: Organization, today: string): Promise<OrganizationPageData> {
  const affs = await supabase.from('team_affiliations')
    .select('from_date,to_date,teams(id,slug,name,city,region)').eq('organization_id', org.id).eq('relation', 'member');
  if (affs.error) throw affs.error;
  type AffRow = { from_date: string | null; to_date: string | null; teams: One<OrgTeam> };
  const current = (affs.data as unknown as AffRow[]).filter(a => (!a.from_date || a.from_date <= today) && (!a.to_date || a.to_date >= today));
  const candidates = current.map(a => one(a.teams)).filter((t): t is OrgTeam => t !== null);
  const active = await supabase.from('teams_active').select('slug').in('slug', candidates.map(t => t.slug));
  if (active.error) throw active.error;
  const okSlugs = new Set((active.data as { slug: string }[]).map(r => r.slug));
  const teams = candidates.filter(t => okSlugs.has(t.slug)).sort((a, b) => a.name.localeCompare(b.name));
  const teamIds = teams.map(t => t.id);

  const seasons = await supabase.from('seasons').select('id').eq('organization_id', org.id);
  if (seasons.error) throw seasons.error;
  const seasonIds = (seasons.data as { id: string }[]).map(s => s.id);
  const evFilter = seasonIds.length > 0 ? `organization_id.eq.${org.id},season_id.in.(${seasonIds.join(',')})` : `organization_id.eq.${org.id}`;

  const [fighters, members, events] = await Promise.all([
    teamIds.length ? supabase.from('fighters').select('id').in('team_id', teamIds) : Promise.resolve({ data: [], error: null }),
    teamIds.length ? supabase.from('team_memberships').select('fighter_id,to_date').in('team_id', teamIds) : Promise.resolve({ data: [], error: null }),
    supabase.from('events').select('id,slug,name,starts_on,ends_on,status,city,region').or(evFilter).order('starts_on')
  ]);
  if (fighters.error) throw fighters.error;
  if (members.error) throw members.error;
  if (events.error) throw events.error;
  const fighterIds = (fighters.data as { id: string }[]).map(f => f.id);
  const memberIds = (members.data as { fighter_id: string; to_date: string | null }[]).filter(m => !m.to_date || m.to_date >= today).map(m => m.fighter_id);
  type EvDb = { id: string; slug: string; name: string; starts_on: string; ends_on: string; status: string; city: string | null; region: string | null };
  return {
    teams, fightersCount: countDistinct(fighterIds, memberIds),
    events: (events.data as EvDb[]).map(e => ({ id: e.id, slug: e.slug, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, status: e.status, city: e.city, region: e.region }))
  };
}
