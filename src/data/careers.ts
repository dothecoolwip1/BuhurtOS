import { supabase } from '../lib/supabase';
import { escapeLike, PAGE_SIZE, type AttendanceEntry, type Division, type EventResultRow, type MembershipLine, type OrgLite, type Outcome, type SeasonInfo } from '../lib/careerView';
import { fetchOrganizations } from './organizations';
import { toFighterRanking, toTeamRanking, type RankingRow, type RankingScope } from './fighters';

/**
 * Plain reads for the fighter, rankings, event-history and team pages. Row level security decides what the viewer sees.
 * Public data only. Errors are thrown as-is so friendlyError can show the message.
 */
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const num = (v: number | string | null | undefined): number => Number(v ?? 0);

// ================================================================ organizations and seasons
export async function fetchOrgLites(): Promise<OrgLite[]> {
  return (await fetchOrganizations()).map(o => ({ id: o.id, slug: o.slug, name: o.name, shortName: o.shortName, enabled: o.enabled }));
}
export async function fetchSeasons(): Promise<SeasonInfo[]> {
  const { data, error } = await supabase.from('seasons').select('id,slug,name,organization_id,starts_on,ends_on').order('starts_on', { ascending: false });
  if (error) throw error;
  return (data as unknown as Array<{ id: string; slug: string; name: string; organization_id: string | null; starts_on: string; ends_on: string }>)
    .map(s => ({ id: s.id, slug: s.slug, name: s.name, organizationId: s.organization_id, startsOn: s.starts_on, endsOn: s.ends_on }));
}

// ================================================================ fighter directory
export interface DirectoryFilter { q: string; teamId: string; gender: string; discipline: string; region: string; page: number }
export interface FighterCard {
  id: string; name: string; gender: string | null; city: string | null; region: string | null; disciplines: string[];
  team: { name: string; slug: string } | null;
}
type CardDb = { id: string; display_name: string; gender: string | null; city: string | null; region: string | null; disciplines: string[] | null; team_id: string | null; teams: { name: string; slug: string } | { name: string; slug: string }[] | null };

/**
 * One page of fighters. Search and filters are applied by the database (ilike / eq / contains). The team shown is the fighter's home team
 * (fighters.team_id, else the newest current non-mercenary membership). The team FILTER matches fighters.team_id only.
 */
export async function fetchFighterDirectory(f: DirectoryFilter): Promise<{ rows: FighterCard[]; total: number }> {
  let q = supabase.from('fighters').select('id,display_name,gender,city,region,disciplines,team_id,teams(name,slug)', { count: 'exact' });
  if (f.q.trim()) q = q.ilike('display_name', `%${escapeLike(f.q)}%`);
  if (f.teamId) q = q.eq('team_id', f.teamId);
  if (f.gender) q = q.eq('gender', f.gender);
  if (f.discipline) q = q.contains('disciplines', [f.discipline]);
  if (f.region.trim()) q = q.ilike('region', `${escapeLike(f.region)}%`);
  const from = (Math.max(1, f.page) - 1) * PAGE_SIZE;
  const { data, error, count } = await q.order('display_name').order('id').range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  const rows = (data as unknown as CardDb[]).map(r => ({ id: r.id, name: r.display_name, gender: r.gender, city: r.city, region: r.region, disciplines: r.disciplines ?? [], team: one(r.teams), teamId: r.team_id }));
  // Fighters whose home team comes from a membership rather than fighters.team_id.
  const missing = rows.filter(r => !r.team).map(r => r.id);
  const byFighter = missing.length ? await currentMembershipTeams(missing) : new Map<string, { name: string; slug: string }>();
  return { rows: rows.map(({ teamId: _t, ...r }) => ({ ...r, team: r.team ?? byFighter.get(r.id) ?? null })), total: count ?? rows.length };
}

async function currentMembershipTeams(fighterIds: string[]): Promise<Map<string, { name: string; slug: string }>> {
  const { data, error } = await supabase.from('team_memberships').select('fighter_id,mercenary,from_date,to_date,teams(name,slug)').in('fighter_id', fighterIds).eq('mercenary', false);
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  type M = { fighter_id: string; from_date: string | null; to_date: string | null; teams: { name: string; slug: string } | { name: string; slug: string }[] | null };
  const out = new Map<string, { name: string; slug: string; from: string }>();
  for (const m of data as unknown as M[]) {
    const t = one(m.teams);
    if (!t || (m.to_date && m.to_date < today)) continue;
    const prev = out.get(m.fighter_id);
    if (!prev || (m.from_date ?? '') > prev.from) out.set(m.fighter_id, { ...t, from: m.from_date ?? '' });
  }
  return new Map([...out].map(([k, v]) => [k, { name: v.name, slug: v.slug }]));
}

export async function fetchTeamOptions(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from('teams').select('id,name').eq('status', 'approved').order('name');
  if (error) throw error;
  return data as Array<{ id: string; name: string }>;
}

/** Home team and gender for a set of fighters (ranking cards, rosters). */
export async function fetchFighterBasics(ids: string[]): Promise<Map<string, { gender: string | null; team: { name: string; slug: string } | null }>> {
  const out = new Map<string, { gender: string | null; team: { name: string; slug: string } | null }>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('fighters').select('id,gender,team_id,teams(name,slug)').in('id', ids);
  if (error) throw error;
  type R = { id: string; gender: string | null; teams: { name: string; slug: string } | { name: string; slug: string }[] | null };
  for (const r of data as unknown as R[]) out.set(r.id, { gender: r.gender, team: one(r.teams) });
  const missing = ids.filter(i => !out.get(i)?.team);
  if (missing.length) {
    const m = await currentMembershipTeams(missing);
    for (const [id, team] of m) out.set(id, { gender: out.get(id)?.gender ?? null, team });
  }
  return out;
}

// ================================================================ fighter profile pieces
const RANK_COLUMNS = 'scope,organization_id,season_id,category,gender,competitions,golds,silvers,bronzes,points,rank';
export async function fetchFighterRankings(fighterId: string): Promise<RankingRow[]> {
  const { data, error } = await supabase.from('ranking_fighters').select(`${RANK_COLUMNS},fighter_id,display_name`).eq('fighter_id', fighterId);
  if (error) throw error;
  return (data as unknown as Parameters<typeof toFighterRanking>[0][]).map(toFighterRanking);
}
export async function fetchTeamRankings(teamId: string): Promise<RankingRow[]> {
  const { data, error } = await supabase.from('ranking_teams').select(`${RANK_COLUMNS},team_id,team_name,team_slug`).eq('team_id', teamId);
  if (error) throw error;
  return (data as unknown as Parameters<typeof toTeamRanking>[0][]).map(toTeamRanking);
}
export type { RankingScope };

export interface RecentFight {
  matchId: string; outcome: Outcome; scoreFor: number; scoreAgainst: number; endsOn: string; finalizedAt: string | null;
  opponent: string | null; forTeam: string | null; competition: string; category: string; gender: Division; eventName: string; eventSlug: string;
}
type FightDb = { match_id: string; entry_id: string; team_id: string | null; competition_id: string; event_id: string; category: string; gender: Division; outcome: Outcome; score_for: number | string; score_against: number | string; event_ends_on: string; finalized_at: string | null };

/** The fighter's latest final matches with the opponent's name, the competition and the event. Three small follow-up reads; any can come back empty. */
export async function fetchRecentFights(fighterId: string, limit = 10): Promise<RecentFight[]> {
  const { data, error } = await supabase.from('fighter_match_rows')
    .select('match_id,entry_id,team_id,competition_id,event_id,category,gender,outcome,score_for,score_against,event_ends_on,finalized_at')
    .eq('fighter_id', fighterId).order('event_ends_on', { ascending: false }).order('finalized_at', { ascending: false, nullsFirst: false }).limit(limit);
  if (error) throw error;
  const mine = data as unknown as FightDb[];
  if (mine.length === 0) return [];
  const matchIds = [...new Set(mine.map(m => m.match_id))];
  const [sides, comps, events] = await Promise.all([
    supabase.from('match_sides').select('match_id,entry_id').in('match_id', matchIds),
    supabase.from('competitions').select('id,name').in('id', [...new Set(mine.map(m => m.competition_id))]),
    supabase.from('events').select('id,slug,name').in('id', [...new Set(mine.map(m => m.event_id))])
  ]);
  if (sides.error) throw sides.error;
  if (comps.error) throw comps.error;
  if (events.error) throw events.error;
  const opponentEntry = new Map<string, string>();
  const myEntryOfMatch = new Map(mine.map(m => [m.match_id, m.entry_id]));
  for (const s of sides.data as Array<{ match_id: string; entry_id: string }>) if (s.entry_id !== myEntryOfMatch.get(s.match_id)) opponentEntry.set(s.match_id, s.entry_id);
  const oppIds = [...new Set(opponentEntry.values())];
  const names = new Map<string, string>();
  if (oppIds.length) {
    const ents = await supabase.from('entries').select('id,teams(name),fighters(display_name)').in('id', oppIds);
    if (ents.error) throw ents.error;
    for (const e of ents.data as unknown as Array<{ id: string; teams: { name: string } | { name: string }[] | null; fighters: { display_name: string } | { display_name: string }[] | null }>) {
      const n = one(e.teams)?.name ?? one(e.fighters)?.display_name;
      if (n) names.set(e.id, n);
    }
  }
  const myTeamIds = [...new Set(mine.flatMap(m => (m.team_id ? [m.team_id] : [])))];
  const teamNames = new Map<string, string>();
  if (myTeamIds.length) {
    const t = await supabase.from('teams').select('id,name').in('id', myTeamIds);
    if (t.error) throw t.error;
    for (const x of t.data as Array<{ id: string; name: string }>) teamNames.set(x.id, x.name);
  }
  const compName = new Map((comps.data as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));
  const eventBy = new Map((events.data as Array<{ id: string; slug: string; name: string }>).map(e => [e.id, e]));
  return mine.map(m => ({
    matchId: m.match_id, outcome: m.outcome, scoreFor: num(m.score_for), scoreAgainst: num(m.score_against), endsOn: m.event_ends_on, finalizedAt: m.finalized_at,
    opponent: names.get(opponentEntry.get(m.match_id) ?? '') ?? null, forTeam: m.team_id ? teamNames.get(m.team_id) ?? null : null,
    competition: compName.get(m.competition_id) ?? 'Competition', category: m.category, gender: m.gender,
    eventName: eventBy.get(m.event_id)?.name ?? 'Event', eventSlug: eventBy.get(m.event_id)?.slug ?? ''
  }));
}

export async function fetchFighterMemberships(fighterId: string): Promise<MembershipLine[]> {
  const { data, error } = await supabase.from('team_memberships').select('id,role,mercenary,from_date,to_date,teams(name,slug)').eq('fighter_id', fighterId);
  if (error) throw error;
  type M = { id: string; role: string; mercenary: boolean; from_date: string | null; to_date: string | null; teams: { name: string; slug: string } | { name: string; slug: string }[] | null };
  return (data as unknown as M[]).flatMap(m => {
    const t = one(m.teams);
    return t ? [{ id: m.id, teamName: t.name, teamSlug: t.slug, role: m.role, mercenary: m.mercenary, fromDate: m.from_date, toDate: m.to_date }] : [];
  });
}

export interface Appearance {
  entryId: string; competition: string; category: string; eventName: string; eventSlug: string; startsOn: string; endsOn: string; eventStatus: 'draft' | 'published' | 'cancelled';
  /** The team the fighter fought for, for group fights; null in duels. */
  forTeam: string | null; role: 'fighter' | 'mercenary' | 'guest' | 'duel';
}
type AppDb = { id: string; teams: { name: string } | { name: string }[] | null; competitions: { name: string; category: string; events: { name: string; slug: string; starts_on: string; ends_on: string; status: Appearance['eventStatus'] } | { name: string; slug: string; starts_on: string; ends_on: string; status: Appearance['eventStatus'] }[] | null } | { name: string; category: string; events: unknown }[] | null };
const APP_SELECT = 'id,teams(name),competitions(name,category,events(name,slug,starts_on,ends_on,status))';
function toAppearance(e: AppDb, role: Appearance['role']): Appearance | null {
  const c = one(e.competitions) as { name: string; category: string; events: unknown } | null;
  const ev = c ? (one(c.events as never) as { name: string; slug: string; starts_on: string; ends_on: string; status: Appearance['eventStatus'] } | null) : null;
  if (!c || !ev) return null;
  return { entryId: e.id, competition: c.name, category: c.category, eventName: ev.name, eventSlug: ev.slug, startsOn: ev.starts_on, endsOn: ev.ends_on, eventStatus: ev.status, forTeam: one(e.teams)?.name ?? null, role };
}
/** Every entry the fighter is on: their own duel entries and the rosters of group-fight entries (role says fighter, mercenary or guest). */
export async function fetchFighterAppearances(fighterId: string): Promise<Appearance[]> {
  const [duels, rosters] = await Promise.all([
    supabase.from('entries').select(APP_SELECT).eq('fighter_id', fighterId).neq('status', 'withdrawn'),
    supabase.from('entry_fighters').select(`role,entries(${APP_SELECT})`).eq('fighter_id', fighterId)
  ]);
  if (duels.error) throw duels.error;
  if (rosters.error) throw rosters.error;
  const out: Appearance[] = [];
  for (const d of duels.data as unknown as AppDb[]) { const a = toAppearance(d, 'duel'); if (a) out.push(a); }
  for (const r of rosters.data as unknown as Array<{ role: 'fighter' | 'mercenary' | 'guest'; entries: AppDb | AppDb[] | null }>) {
    const e = one(r.entries);
    const a = e ? toAppearance(e, r.role) : null;
    if (a) out.push(a);
  }
  return out;
}

// ================================================================ event history
export interface EventMeta { id: string; slug: string; organizationId: string | null; seasonId: string | null; region: string | null }
/** organization_id is a readable column of events. The event's organization is its own, else its season's (the database rule). */
export async function fetchEventMeta(): Promise<EventMeta[]> {
  const [ev, se] = await Promise.all([
    supabase.from('events').select('id,slug,organization_id,season_id,region'),
    supabase.from('seasons').select('id,organization_id')
  ]);
  if (ev.error) throw ev.error;
  if (se.error) throw se.error;
  const seasonOrg = new Map((se.data as Array<{ id: string; organization_id: string | null }>).map(s => [s.id, s.organization_id]));
  return (ev.data as Array<{ id: string; slug: string; organization_id: string | null; season_id: string | null; region: string | null }>)
    .map(e => ({ id: e.id, slug: e.slug, organizationId: e.organization_id ?? (e.season_id ? seasonOrg.get(e.season_id) ?? null : null), seasonId: e.season_id, region: e.region }));
}
export async function fetchEventMetaById(eventId: string): Promise<EventMeta | null> {
  const { data, error } = await supabase.from('events').select('id,slug,organization_id,season_id,region').eq('id', eventId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const e = data as { id: string; slug: string; organization_id: string | null; season_id: string | null; region: string | null };
  let org = e.organization_id;
  if (!org && e.season_id) {
    const se = await supabase.from('seasons').select('organization_id').eq('id', e.season_id).maybeSingle();
    if (se.error) throw se.error;
    org = (se.data as { organization_id: string | null } | null)?.organization_id ?? null;
  }
  return { id: e.id, slug: e.slug, organizationId: org, seasonId: e.season_id, region: e.region };
}

export interface EventHistoryData {
  entries: Array<AttendanceEntry & { name: string }>;
  participants: Array<{ fighterId: string; entryId: string }>;
  results: EventResultRow[];
  teamNames: Map<string, string>;
  /** True when the placings belong to a fictional/test event: shown as test data, never counted anywhere official. */
  synthetic: boolean;
}
export async function fetchEventHistory(eventId: string, competitionIds: string[]): Promise<EventHistoryData> {
  if (competitionIds.length === 0) return { entries: [], participants: [], results: [], teamNames: new Map(), synthetic: false };
  const [ents, parts, res] = await Promise.all([
    supabase.from('entries').select('id,competition_id,team_id,fighter_id,status,teams(name),fighters(display_name)').in('competition_id', competitionIds),
    supabase.from('fighter_participation').select('fighter_id,entry_id').eq('event_id', eventId),
    // The event's OWN record reads every recorded placing, fictional events included (flagged `synthetic`). Rankings, career and team
    // statistics keep reading the official-only views; a test event is simply shown as what it is, on its own page.
    supabase.from('result_rows_all').select('competition_id,competition_name,category,gender,entry_id,final_place,points,team_id,entry_fighter_id,synthetic,team_name_at_event').eq('event_id', eventId).order('final_place')
  ]);
  if (ents.error) throw ents.error;
  if (parts.error) throw parts.error;
  if (res.error) throw res.error;
  type E = { id: string; competition_id: string; team_id: string | null; fighter_id: string | null; status: string; teams: { name: string } | { name: string }[] | null; fighters: { display_name: string } | { display_name: string }[] | null };
  const teamNames = new Map<string, string>();
  const entries = (ents.data as unknown as E[]).map(e => {
    const tn = one(e.teams)?.name;
    if (e.team_id && tn) teamNames.set(e.team_id, tn);
    return { entryId: e.id, competitionId: e.competition_id, teamId: e.team_id, fighterId: e.fighter_id, status: e.status, name: tn ?? one(e.fighters)?.display_name ?? 'Unnamed entry' };
  });
  type R = { competition_id: string; competition_name: string; category: string; gender: Division; entry_id: string; final_place: number; points: number | string; team_id: string | null; entry_fighter_id: string | null; synthetic?: boolean; team_name_at_event?: string | null };
  return {
    entries,
    participants: (parts.data as Array<{ fighter_id: string; entry_id: string }>).map(p => ({ fighterId: p.fighter_id, entryId: p.entry_id })),
    results: (res.data as unknown as R[]).map(r => ({ competitionId: r.competition_id, competitionName: r.competition_name, category: r.category, gender: r.gender, entryId: r.entry_id, finalPlace: r.final_place, points: num(r.points), teamId: r.team_id, fighterId: r.entry_fighter_id, synthetic: r.synthetic === true, teamNameAtEvent: r.team_name_at_event ?? null })),
    teamNames,
    synthetic: (res.data as unknown as R[]).some(r => r.synthetic === true)
  };
}

// ================================================================ team record by category
/** Every final match a team entry played, as category + outcome (match_sides). Used for the 5v5 and 3v3 records. */
export async function fetchTeamMatchOutcomes(teamId: string): Promise<Array<{ category: string; outcome: Outcome }>> {
  const { data, error } = await supabase.from('match_sides').select('category,outcome').eq('team_id', teamId).limit(5000);
  if (error) throw error;
  return data as Array<{ category: string; outcome: Outcome }>;
}
