export type UUID = string;

export type EventType = 'ranked_competitive' | 'demo_fun' | 'exhibition' | 'clinic_training' | 'custom';
export type StandingsMode = 'season_and_event' | 'event_only' | 'no_standings';
export type EventStatus = 'draft' | 'published' | 'registration_open' | 'registration_closed' | 'check_in' | 'live' | 'completed' | 'archived' | 'cancelled';
export type MatchStatus = 'scheduled' | 'on_deck' | 'in_the_hole' | 'active' | 'completed' | 'finalized' | 'forfeit' | 'cancelled';
export type MatchStage = 'pool' | 'bracket' | 'showcase' | 'final';
export type ValidationStatus = 'in_progress' | 'submitted' | 'pending_validation' | 'validated' | 'disputed' | 'corrected' | 'final';
export type RingStatus = 'idle' | 'preparing' | 'ready' | 'match_underway' | 'medical_hold' | 'marshal_review' | 'delayed' | 'closed';
export type RosterEntryType = 'fighter' | 'team' | 'ghost_fighter' | 'guest_fighter';
export type RosterStatus = 'registered' | 'approved' | 'no_show' | 'late' | 'withdrawn';
export type EventRole = 'event_organizer' | 'field_marshal' | 'assistant_marshal' | 'team_captain' | 'fighter';
export type OrganizationRole = 'organization_admin' | 'organization_staff';
export type PlatformRole = 'platform_super_admin' | 'platform_staff';

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
  registrationOpen?: boolean;
  registrationFeeCents?: number;
  currency?: string;
}

export interface Team {
  id: UUID;
  organizationId: UUID;
  name: string;
  cityOrRegion?: string;
}

export interface Fighter {
  id: UUID;
  organizationId: UUID;
  teamId?: UUID;
  name: string;
  nickname?: string;
  preferredWeapons: string[];
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

export interface MatchRecord {
  id: UUID;
  organizationId: UUID;
  seasonId: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  bracketId?: UUID;
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
  divisionId?: UUID;
  ringId?: UUID;
  poolId?: UUID;
  scheduledStart?: string;
  validationStatus?: ValidationStatus;
  victoryMethod?: string;
  officialNotes?: string;
  videoUrl?: string;
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


export interface EventDivision {
  id: UUID;
  eventId: UUID;
  rulesetVersionId?: UUID;
  name: string;
  disciplineKey: string;
  genderDivision?: string;
  ageMin?: number;
  ageMax?: number;
  weightMinKg?: number;
  weightMaxKg?: number;
  teamMin?: number;
  teamMax?: number;
  registrationCap?: number;
  advancementConfig: Record<string, unknown>;
  seedingConfig: Record<string, unknown>;
  status: 'draft' | 'open' | 'closed' | 'completed' | 'cancelled';
  sortOrder: number;
}

export interface PoolRecord {
  id: UUID;
  eventId: UUID;
  divisionId: UUID;
  name: string;
  advancementCount: number;
  standingsConfig: {
    winPoints?: number;
    drawPoints?: number;
    tieBreakers?: string[];
  };
  lockedAt?: string;
}

export interface PoolEntryRecord {
  id: UUID;
  poolId: UUID;
  rosterEntryId: UUID;
  seed: number;
  finalPlace?: number;
  advanced: boolean;
}

export interface RingRecord {
  id: UUID;
  eventId: UUID;
  name: string;
  sortOrder: number;
  status: RingStatus;
  statusNote?: string;
  updatedAt: string;
}

export interface ScheduleItem {
  id: UUID;
  eventId: UUID;
  ringId?: UUID;
  matchId?: UUID;
  divisionId?: UUID;
  itemType: 'match' | 'break' | 'ceremony' | 'lunch' | 'armor_check' | 'meeting' | 'awards' | 'custom';
  title: string;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'delayed' | 'active' | 'completed' | 'cancelled';
  isPublic: boolean;
  notes?: string;
}

export interface CorrectionRequest {
  id: UUID;
  organizationId?: UUID;
  eventId?: UUID;
  reporterUserId?: UUID;
  reporterEmail?: string;
  category: 'wrong_fighter' | 'duplicate_fighter' | 'wrong_team' | 'incorrect_score' | 'incorrect_affiliation' | 'wrong_event' | 'missing_event' | 'incorrect_video' | 'other';
  entityType?: string;
  entityId?: UUID;
  description: string;
  evidenceLinks: string[];
  status: 'submitted' | 'under_review' | 'needs_information' | 'approved' | 'rejected' | 'applied';
  resolutionNotes?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface RankingConfiguration {
  id: UUID;
  organizationId?: UUID;
  seasonId?: UUID;
  name: string;
  scope: 'global' | 'organization' | 'country' | 'regional' | 'season' | 'career' | 'discipline' | 'team' | 'weight_class' | 'age_class';
  disciplineKey?: string;
  version: number;
  formula: Record<string, unknown>;
  minimumMatches: number;
  isPublic: boolean;
}
