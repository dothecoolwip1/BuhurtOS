export type UUID = string;

export type EventType = 'ranked_competitive' | 'demo_fun' | 'exhibition' | 'clinic_training' | 'custom';
export type StandingsMode = 'season_and_event' | 'event_only' | 'no_standings';
export type EventStatus = 'draft' | 'published' | 'live' | 'completed' | 'archived';
export type MatchStatus = 'scheduled' | 'on_deck' | 'in_the_hole' | 'active' | 'completed' | 'finalized' | 'forfeit' | 'cancelled';
export type MatchStage = 'pool' | 'bracket' | 'showcase' | 'final';
export type RosterEntryType = 'fighter' | 'team' | 'ghost_fighter' | 'guest_fighter';
export type RosterStatus = 'registered' | 'approved' | 'no_show' | 'late' | 'withdrawn';
export type EventRole = 'event_organizer' | 'field_marshal' | 'assistant_marshal' | 'team_captain' | 'fighter';
export type OrganizationRole = 'organization_admin' | 'organization_staff';
export type PlatformRole = 'platform_super_admin' | 'platform_staff';
export type AffiliationType = 'member' | 'mercenary' | 'guest' | 'independent';
export type DivisionStatus = 'draft' | 'published' | 'retired';

export interface Organization {
  id: UUID;
  name: string;
  shortName: string;
  region: string;
  status: 'active' | 'inactive';
}

export interface Season {
  id: UUID;
  organizationId: UUID;
  name: string;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'active' | 'archived';
}

export interface EventRecord {
  id: UUID;
  organizationId: UUID;
  seasonId: UUID;
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  organizerName?: string;
  eventType: EventType;
  standingsMode: StandingsMode;
  status: EventStatus;
  timezone: string;
  livestreamUrl?: string;
  rulesetId?: UUID;
  registrationOpen?: boolean;
  registrationFeeCents?: number;
  currency?: string;
}

export interface Club {
  id: UUID;
  organizationId: UUID;
  name: string;
  shortName?: string;
  region?: string;
  websiteUrl?: string;
  isActive: boolean;
  deletedAt?: string;
}

export interface Team {
  id: UUID;
  organizationId: UUID;
  clubId?: UUID;
  name: string;
  cityOrRegion?: string;
}

export interface Fighter {
  id: UUID;
  organizationId: UUID;
  identityId?: UUID;
  teamId?: UUID;
  userId?: UUID;
  name: string;
  nickname?: string;
  preferredWeapons: string[];
  mergedIntoFighterId?: UUID;
  deletedAt?: string;
}

export interface FoundationFighter extends Fighter {
  identityId: UUID;
}

export interface FighterAffiliation {
  id: UUID;
  identityId: UUID;
  organizationId: UUID;
  clubId?: UUID;
  teamId?: UUID;
  affiliationType: AffiliationType;
  startsOn: string;
  endsOn?: string;
  isPrimary: boolean;
  sourceEventId?: UUID;
  notes?: string;
}

export interface CompetitionDivision {
  id: UUID;
  organizationId?: UUID;
  name: string;
  slug: string;
  competitionFormatId: string;
  rulesetId?: UUID;
  teamSize?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  ageMin?: number;
  ageMax?: number;
  eligibilityLabel?: string;
  status: DivisionStatus;
  metadata: Record<string, unknown>;
  deletedAt?: string;
}

export interface EventDivision {
  id: UUID;
  eventId: UUID;
  divisionId: UUID;
  rulesetId?: UUID;
  registrationLimit?: number;
  isRegistrationOpen: boolean;
  metadata: Record<string, unknown>;
}

export interface RosterEntry {
  id: UUID;
  organizationId: UUID;
  eventId: UUID;
  teamId?: UUID;
  fighterId?: UUID;
  entryType: RosterEntryType;
  displayName: string;
  checkedIn: boolean;
  armorCleared: boolean;
  medicalCleared: boolean;
  waiverConfirmed: boolean;
  weighInCleared: boolean;
  attendanceStatus: RosterStatus;
  metadata?: Record<string, unknown>;
}

export interface FightCard {
  id: UUID;
  eventId: UUID;
  name: string;
  listName: string;
  status: 'draft' | 'live' | 'locked' | 'archived';
  sortOrder: number;
}

export interface Bracket {
  id: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  divisionId?: UUID;
  name: string;
  format: 'single_elimination' | 'double_elimination' | 'round_robin' | 'pools_to_bracket';
  category: string;
  metadata?: Record<string, unknown>;
}

export interface MatchParticipant {
  rosterEntryId?: UUID;
  sideIndex: 1 | 2;
  seed?: number;
  isPlaceholder?: boolean;
  placeholderLabel?: string;
  sourceMatchId?: UUID;
  sourceSlot?: 1 | 2;
  isWinnerSource?: boolean;
}

export interface ScoreRound {
  roundNumber: number;
  side1Score: number;
  side2Score: number;
  notes?: string;
}

export type ScoringKind = 'duel' | 'sword_buckler' | 'team_fight';

export interface ScoringConfig {
  kind: ScoringKind;
  roundsRequired: number;
  winsRequired?: number;
  allowDrawRound?: boolean;
  scoreCapPerRound?: number;
  teamFightMode?: 'survivors' | 'round_wins';
  requireReasonOnForfeit?: boolean;
}

export interface RulesetSettings {
  enabledFormats: string[];
  scoringOverrides: Record<string, Partial<ScoringConfig>>;
  compliance: {
    requireCheckIn: boolean;
    requireArmorClearance: boolean;
    requireMedicalClearance: boolean;
    requireWaiver: boolean;
    requireWeighIn: boolean;
  };
  discipline: {
    yellowCardsBeforeSuspension: number;
    redCardSuspensionMatches: number;
  };
  bracket: {
    antiFratricide: boolean;
  };
}

export interface RulesetSettingsPatch {
  enabledFormats?: string[];
  scoringOverrides?: Record<string, Partial<ScoringConfig>>;
  compliance?: Partial<RulesetSettings['compliance']>;
  discipline?: Partial<RulesetSettings['discipline']>;
  bracket?: Partial<RulesetSettings['bracket']>;
}

export interface RulesetRecord {
  id: UUID;
  organizationId?: UUID;
  teamId?: UUID;
  parentRulesetId?: UUID;
  name: string;
  shortName: string;
  version: string;
  description?: string;
  status: 'draft' | 'published' | 'retired';
  effectiveFrom?: string;
  effectiveTo?: string;
  settings: RulesetSettings;
  overrides?: RulesetSettingsPatch;
  createdAt?: string;
  updatedAt?: string;
}

export interface MatchRecord {
  id: UUID;
  organizationId: UUID;
  seasonId: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  bracketId?: UUID;
  divisionId?: UUID;
  label: string;
  category: string;
  matchType: string;
  scoringConfig: ScoringConfig;
  status: MatchStatus;
  stage: MatchStage;
  scheduledOrder: number;
  bracketRound?: number;
  bracketSlot?: string;
  winnerAdvancesToMatchId?: UUID;
  winnerAdvancesToSlot?: 1 | 2;
  loserAdvancesToMatchId?: UUID;
  loserAdvancesToSlot?: 1 | 2;
  resultSummary?: MatchResultSummary;
  participants: MatchParticipant[];
  rounds: ScoreRound[];
}

export interface MatchResultSummary {
  winnerSide: 1 | 2 | null;
  side1Total: number;
  side2Total: number;
  roundsWonSide1: number;
  roundsWonSide2: number;
  resultType: 'points' | 'rounds' | 'forfeit' | 'draw' | 'bye';
  forfeitReason?: string;
}

export interface DisciplineCard {
  id: UUID;
  eventId: UUID;
  seasonId: UUID;
  matchId?: UUID;
  fighterId?: UUID;
  rosterEntryId?: UUID;
  color: 'yellow' | 'red';
  reason: string;
  notes?: string;
  issuedAt: string;
}

export interface Announcement {
  id: UUID;
  eventId: UUID;
  title: string;
  body: string;
  isPublic: boolean;
  scheduledFor?: string;
  createdAt: string;
}

export interface UserContext {
  userId: UUID;
  displayName: string;
  platformRoles: PlatformRole[];
  organizationRoles: Array<{ organizationId: UUID; role: OrganizationRole }>;
  eventRoles: Array<{ eventId: UUID; role: EventRole; teamId?: UUID }>;
}

export interface OfflineMutation {
  id: string;
  entity: string;
  entityId: string;
  operation: 'insert' | 'update' | 'delete' | 'rpc';
  payload: unknown;
  baseVersion?: string;
  createdAt: string;
  attempts: number;
  state: 'queued' | 'syncing' | 'conflict' | 'failed';
  lastError?: string;
}
