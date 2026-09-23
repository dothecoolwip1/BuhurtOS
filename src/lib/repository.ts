import type { Announcement, EventRecord, FightCard, MatchRecord, RosterEntry } from '../types';
import { demoAnnouncements, demoEvent, demoMatches, demoRoster } from '../data/demo';
import { supabase } from './supabase';

export interface EventSnapshot {
  event: EventRecord;
  matches: MatchRecord[];
  roster: RosterEntry[];
  fightCards: FightCard[];
  announcements: Announcement[];
}

function snakeMatch(row: Record<string, any>): MatchRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    seasonId: row.season_id,
    eventId: row.event_id,
    fightCardId: row.fight_card_id ?? undefined,
    bracketId: row.bracket_id ?? undefined,
    label: row.label,
    category: row.category,
    matchType: row.match_type,
    scoringConfig: row.scoring_config,
    status: row.status,
    stage: row.stage,
    scheduledOrder: row.scheduled_order,
    bracketRound: row.bracket_round ?? undefined,
    bracketSlot: row.bracket_slot ?? undefined,
    winnerAdvancesToMatchId: row.winner_advances_to_match_id ?? undefined,
    winnerAdvancesToSlot: row.winner_advances_to_slot ?? undefined,
    loserAdvancesToMatchId: row.loser_advances_to_match_id ?? undefined,
    loserAdvancesToSlot: row.loser_advances_to_slot ?? undefined,
    resultSummary: row.result_summary,
    participants: (row.match_participants ?? []).map((p: any) => ({ rosterEntryId: p.roster_entry_id ?? undefined, sideIndex: p.side_index, seed: p.seed ?? undefined, isPlaceholder: p.is_placeholder, placeholderLabel: p.placeholder_label ?? undefined, sourceMatchId: p.source_match_id ?? undefined, sourceSlot: p.source_slot ?? undefined, isWinnerSource: p.is_winner_source ?? undefined })),
    rounds: (row.match_rounds ?? []).map((r: any) => ({ roundNumber: r.round_number, side1Score: Number(r.side_1_score), side2Score: Number(r.side_2_score), notes: r.notes ?? undefined }))
  };
}

export async function loadEventSnapshot(eventId?: string): Promise<EventSnapshot> {
  if (!supabase) {
    const ghosts = typeof localStorage === 'undefined' ? [] : JSON.parse(localStorage.getItem('buhurtos-demo-ghosts') ?? '[]');
    const savedMatches = typeof localStorage === 'undefined' ? null : localStorage.getItem('buhurtos-demo-matches');
    const bracketMatches = typeof localStorage === 'undefined' ? [] : JSON.parse(localStorage.getItem('buhurtos-demo-bracket-matches') ?? '[]');
    const rosterBase = structuredClone(demoRoster);
    const overrides = typeof localStorage === 'undefined' ? {} : JSON.parse(localStorage.getItem('buhurtos-demo-roster-overrides') ?? '{}');
    const roster = [...rosterBase.map(r => ({ ...r, ...(overrides[r.id] ?? {}) })), ...ghosts];
    const baseMatches = savedMatches ? JSON.parse(savedMatches) : structuredClone(demoMatches);
    const existingIds = new Set(baseMatches.map((m: any) => m.id));
    const eventOverride = typeof localStorage === 'undefined' ? null : localStorage.getItem('buhurtos-demo-event-' + demoEvent.id);
    const event = eventOverride ? { ...structuredClone(demoEvent), ...JSON.parse(eventOverride) } : structuredClone(demoEvent);
    const savedAnnouncements = typeof localStorage === 'undefined' ? [] : JSON.parse(localStorage.getItem('buhurtos-demo-announcements-' + demoEvent.id) ?? '[]');
    const announcementIds = new Set(savedAnnouncements.map((a: any) => a.id));
    const announcements = [...savedAnnouncements, ...structuredClone(demoAnnouncements).filter(a => !announcementIds.has(a.id))];
    const allMatches = [...baseMatches, ...bracketMatches.filter((m: any) => !existingIds.has(m.id))];
    const savedFightCards = typeof localStorage === 'undefined' ? [] : JSON.parse(localStorage.getItem('buhurtos-demo-fight-cards-' + demoEvent.id) ?? '[]');
    const fightCardIds = [...new Set(allMatches.map((match: any) => match.fightCardId).filter(Boolean))] as string[];
    const fightCards: FightCard[] = savedFightCards.length ? savedFightCards : fightCardIds.map((id,index) => ({ id, eventId: demoEvent.id, name: 'Field ' + (index + 1), listName: 'Field ' + (index + 1), status: 'live', sortOrder: index }));
    return { event, matches: allMatches, roster, fightCards, announcements };
  }

  let resolvedEventId = eventId || (import.meta.env.VITE_DEFAULT_EVENT_ID as string | undefined);
  if (!resolvedEventId) {
    const candidate = await supabase.from('events').select('id').in('status', ['live','published','draft']).order('starts_at', { ascending: false }).limit(1).maybeSingle();
    if (candidate.error) throw candidate.error;
    resolvedEventId = candidate.data?.id;
  }
  if (!resolvedEventId) throw new Error('No accessible BuhurtOS event was found. Set VITE_DEFAULT_EVENT_ID or publish an event.');

  const { data: sessionData } = await supabase.auth.getSession();
  const rosterColumns = sessionData.session ? '*' : 'id,event_id,team_id,entry_type,display_name,attendance_status';
  const [eventQuery, rosterQuery, fightCardQuery, matchQuery, announcementQuery] = await Promise.all([
    supabase.from('events').select('*').eq('id', resolvedEventId).single(),
    supabase.from('event_roster_entries').select(rosterColumns).eq('event_id', resolvedEventId).order('display_name'),
    supabase.from('fight_cards').select('*').eq('event_id', resolvedEventId).order('sort_order'),
    supabase.from('matches').select('*,match_participants(*),match_rounds(*)').eq('event_id', resolvedEventId).order('scheduled_order'),
    supabase.from('announcements').select('*').eq('event_id', resolvedEventId).order('created_at', { ascending: false })
  ]);

  const error = eventQuery.error || rosterQuery.error || fightCardQuery.error || matchQuery.error || announcementQuery.error;
  if (error) throw error;
  const e: any = eventQuery.data;
  return {
    event: {
      id: e.id, organizationId: e.organization_id, seasonId: e.season_id, name: e.name, venue: e.venue,
      startsAt: e.starts_at, endsAt: e.ends_at, organizerName: e.organizer_name ?? undefined,
      eventType: e.event_type, standingsMode: e.standings_mode, status: e.status, timezone: e.timezone, livestreamUrl: e.livestream_url ?? undefined, rulesetId: e.ruleset_id ?? undefined,
      registrationOpen: e.registration_open, registrationFeeCents: e.registration_fee_cents, currency: e.currency
    },
    roster: (rosterQuery.data ?? []).map((r: any) => ({
      id: r.id, organizationId: r.organization_id, eventId: r.event_id, teamId: r.team_id ?? undefined, fighterId: r.fighter_id ?? undefined,
      entryType: r.entry_type, displayName: r.display_name, checkedIn: r.checked_in ?? false, armorCleared: r.armor_cleared ?? false,
      medicalCleared: r.medical_cleared ?? false, waiverConfirmed: r.waiver_confirmed ?? false, weighInCleared: r.weigh_in_cleared ?? false,
      attendanceStatus: r.attendance_status, metadata: r.metadata
    })),
    fightCards: (fightCardQuery.data ?? []).map((card: any) => ({ id: card.id, eventId: card.event_id, name: card.name, listName: card.list_name, status: card.status, sortOrder: card.sort_order })),
    matches: (matchQuery.data ?? []).map(snakeMatch),
    announcements: (announcementQuery.data ?? []).map((a: any) => ({ id: a.id, eventId: a.event_id, title: a.title, body: a.body, isPublic: a.is_public, scheduledFor: a.scheduled_for ?? undefined, createdAt: a.created_at }))
  };
}
