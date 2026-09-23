export type UUID = string;

export type EventType = 'ranked_competitive' | 'demo_fun' | 'exhibition' | 'clinic_training' | 'custom';
export type StandingsMode = 'season_and_event' | 'event_only' | 'no_standings';
export type EventStatus = 'draft' | 'published' | 'live' | 'completed' | 'archived';
export type MatchStatus = 'scheduled' | 'on_deck' | 'in_the_hole' | 'active' | 'completed' | 'finalized' | 'forfeit' | 'cancelled';
export type MatchStage = 'pool' | 'bracket' | 'showcase' | 'final';
export type RosterEntryType = 'fighter' | 'team' | 'ghost_fighter' | 'guest_fighter';
export type RosterStatus = 'registered' | 'approved' | 'no_show' | 'late' | 'withdrawn';
export type EventRole =
  | 'tournament_director'
  | 'event_organizer'
  | 'field_marshal'
  | 'assistant_marshal'
  | 'scorekeeper'
  | 'registration_staff'
  | 'armor_inspector'
  | 'medical_staff'
  | 'team_captain'
  | 'fighter';
export type OrganizationRole = 'organization_admin' | 'organization_staff';
export type PlatformRole = 'platform_super_admin' | 'platform_staff';

export type TeamType =
  | 'permanent'
  | 'season'
  | 'a_team'
  | 'b_team'
  | 'womens'
  | 'youth'
  | 'competition'
  | 'tournament'
  | 'temporary'
  | 'mercenary'
  | 'mixed';

export type AffiliationType =
  | 'home_club'
  | 'permanent_team'
  | 'season_team'
  | 'tournament_team'
  | 'temporary_team'
  | 'mercenary'
  | 'historical_representation';

export interface Organization {
  id: UUID;
  name: string;
  shortName: string;
  slug?: string;
  region: string;
  countryCode?: string;
  logoPath?: string;
  description?: string;
  websiteUrl?: string;
  socialLinks?: Record<string, string>;
  branding?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  isPublic?: boolean;
  status: 'active' | 'inactive';
  deletedAt?: string;
}

export interface Season {
  id: UUID;
  organizationId: UUID;
  name: string;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'active' | 'archived';
  rulesetId?: UUID;
  championshipConfig?: Record<string, unknown>;
  configurationSnapshot?: Record<string, unknown>;
  finalizedAt?: string;
}

export interface Club {
  id: UUID;
  organizationId?: UUID;
  name: string;
  shortName?: string;
  logoPath?: string;
  countryCode?: string;
  provinceState?: string;
  city?: string;
  description?: string;
  websiteUrl?: string;
  socialLinks: Record<string, string>;
  publicRoster: boolean;
  isActive: boolean;
  mergedIntoId?: UUID;
}

export interface Discipline {
  id: UUID;
  organizationId?: UUID;
  code: string;
  name: string;
  competitionKind: 'individual' | 'team' | 'hybrid';
  description?: string;
  defaultTeamSize?: number;
  configuration: Record<string, unknown>;
  isActive: boolean;
}

export interface Division {
  id: UUID;
  organizationId?: UUID;
  disciplineId: UUID;
  name: string;
  code: string;
  ageClassId?: UUID;
  weightClassId?: UUID;
  genderClassId?: UUID;
  minimumFighters?: number;
  maximumFighters?: number;
  substitutionsAllowed?: number;
  configuration: Record<string, unknown>;
  isActive: boolean;
}

export interface CompetitionCategory {
  id: UUID;
  organizationId?: UUID;
  divisionId: UUID;
  name: string;
  code: string;
  teamSize?: number;
  configuration: Record<string, unknown>;
  isActive: boolean;
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

export interface Team {
  id: UUID;
  organizationId: UUID;
  clubId?: UUID;
  seasonId?: UUID;
  divisionId?: UUID;
  name: string;
  cityOrRegion?: string;
  countryCode?: string;
  teamType?: TeamType;
  publicRoster?: boolean;
  mergedIntoId?: UUID;
}

export interface Fighter {
  id: UUID;
  organizationId?: UUID;
  teamId?: UUID;
  name: string;
  nickname?: string;
  preferredWeapons: string[];
  countryCode?: string;
  provinceState?: string;
  city?: string;
  nationality?: string;
  socialLinks?: Record<string, string>;
  publicProfile?: boolean;
  isTemporary?: boolean;
  mergedIntoId?: UUID;
}

export interface FighterAffiliation {
  id: UUID;
  fighterId: UUID;
  organizationId?: UUID;
  clubId?: UUID;
  teamId?: UUID;
  seasonId?: UUID;
  eventId?: UUID;
  affiliationType: AffiliationType;
  startsOn?: string;
  endsOn?: string;
  isPrimary: boolean;
  metadata: Record<string, unknown>;
}

export interface FighterClaim {
  id: UUID;
  fighterId: UUID;
  userId: UUID;
  statement?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy?: UUID;
  reviewedAt?: string;
  decisionNotes?: string;
  createdAt: string;
}

export interface Official {
  id: UUID;
  userId?: UUID;
  fighterId?: UUID;
  displayName: string;
  countryCode?: string;
  provinceState?: string;
  qualifications: Record<string, unknown>;
  status: 'active' | 'inactive' | 'suspended' | 'retired';
  publicProfile: boolean;
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

export interface RulesetSettings {
  enabledFormats: string[];
  scoringOverrides: Record<string, Partial<ScoringConfig>>;
  timing: {
    matchDurationSeconds?: number;
    roundDurationSeconds?: number;
    rounds: number;
    restBetweenRoundsSeconds?: number;
    overtimeEnabled: boolean;
    overtimeDurationSeconds?: number;
  };
  victory: {
    conditions: string[];
    pointSystem: Record<string, number>;
    tieBreakers: string[];
  };
  roster: {
    teamSize?: number;
    minimumFighters?: number;
    maximumFighters?: number;
    substitutionsAllowed?: number;
  };
  equipment: {
    allowedWeapons: string[];
    complianceRequirements: string[];
  };
  classifications: {
    ageDivisions: string[];
    weightClasses: string[];
    genderDivisions: string[];
  };
  compliance: {
    requireCheckIn: boolean;
    requireArmorClearance: boolean;
    requireMedicalClearance: boolean;
    requireWaiver: boolean;
    requireWeighIn: boolean;
  };
  discipline: {
    knockdownsEnabled: boolean;
    warningLimit?: number;
    yellowCardsBeforeSuspension: number;
    redCardSuspensionMatches: number;
    disqualificationRules: string[];
  };
  bracket: {
    antiFratricide: boolean;
    advancementRules: string[];
    specialTournamentRules: string[];
  };
}

export interface RulesetSettingsPatch {
  enabledFormats?: string[];
  scoringOverrides?: Record<string, Partial<ScoringConfig>>;
  timing?: Partial<RulesetSettings['timing']>;
  victory?: Partial<RulesetSettings['victory']>;
  roster?: Partial<RulesetSettings['roster']>;
  equipment?: Partial<RulesetSettings['equipment']>;
  classifications?: Partial<RulesetSettings['classifications']>;
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
  settings: RulesetSettingsPatch;
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

export interface ScopedPermissionGrant {
  permission: string;
  organizationId?: UUID;
  eventId?: UUID;
  teamId?: UUID;
}

export interface UserContext {
  userId: UUID;
  displayName: string;
  platformRoles: PlatformRole[];
  organizationRoles: Array<{ organizationId: UUID; role: OrganizationRole }>;
  eventRoles: Array<{ eventId: UUID; role: EventRole; teamId?: UUID }>;
  permissionGrants: ScopedPermissionGrant[];
}

export interface OfflineMutation {
  id: UUID;
  ownerUserId?: UUID;
  entity: string;
  entityId: string;
  operation: 'insert' | 'update' | 'delete' | 'rpc';
  payload: unknown;
  baseVersion?: string;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  attempts: number;
  state: 'queued' | 'syncing' | 'conflict' | 'failed';
  lastError?: string;
}
