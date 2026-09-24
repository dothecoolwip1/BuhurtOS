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
export type FighterProfileVisibility = 'public' | 'members' | 'private';
export type IdentityAccountRole = 'self' | 'guardian';
export type IdentityClaimStatus = 'pending' | 'approved' | 'rejected' | 'disputed' | 'cancelled';
export type IdentityMergeStatus = 'pending' | 'completed' | 'rejected' | 'cancelled';

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
  defaultRulesetId?: UUID;
  rankingPolicy?: Record<string, unknown>;
  revision?: number;
  updatedAt?: string;
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
  rulesetSnapshotId?: UUID;
  registrationOpen?: boolean;
  registrationFeeCents?: number;
  currency?: string;
  updatedAt?: string;
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

export interface FighterIdentity {
  id: UUID;
  displayName: string;
  nickname?: string;
  avatarPath?: string;
  bio?: string;
  publicRegion?: string;
  profileVisibility: FighterProfileVisibility;
  profileRevision: number;
  verifiedAt?: string;
}

export interface FighterIdentityAccount {
  id: UUID;
  identityId: UUID;
  userId: UUID;
  relationship: IdentityAccountRole;
  verifiedAt: string;
  revokedAt?: string;
}

export interface FighterIdentityPrivateProfile {
  identityId: UUID;
  legalName?: string;
  birthDate?: string;
  contactEmail?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
  guardianConsentAt?: string;
  revision: number;
}

export interface FighterIdentityClaim {
  id: UUID;
  identityId: UUID;
  claimantUserId: UUID;
  relationship: IdentityAccountRole;
  status: IdentityClaimStatus;
  claimNote?: string;
  reviewNote?: string;
  disputeReason?: string;
  reviewedBy?: UUID;
  reviewedAt?: string;
  disputedBy?: UUID;
  disputedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FighterIdentityMergeReview {
  id: UUID;
  canonicalIdentityId: UUID;
  duplicateIdentityId: UUID;
  requestedBy: UUID;
  reason?: string;
  status: IdentityMergeStatus;
  canonicalRevision: number;
  duplicateRevision: number;
  requestSnapshot: Record<string, unknown>;
  reviewedBy?: UUID;
  reviewNote?: string;
  reviewedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface FighterIdentitySearchResult {
  identityId: UUID;
  displayName: string;
  nickname?: string;
  publicRegion?: string;
  isClaimed: boolean;
  isVerified: boolean;
}

export interface FighterDuplicateSuggestion {
  candidateIdentityId: UUID;
  candidateDisplayName: string;
  reason: string;
  score: number;
}

export type EligibilityRuleKind = 'age' | 'weight_kg' | 'experience_years' | 'team_size' | 'declaration' | 'custom';

export interface EligibilityRule {
  kind: EligibilityRuleKind;
  label: string;
  key?: string;
  min?: number;
  max?: number;
  value?: string | number | boolean;
}

export interface CompetitionDivision {
  id: UUID;
  organizationId?: UUID;
  name: string;
  slug: string;
  version?: number;
  supersedesDivisionId?: UUID;
  competitionFormatId: string;
  rulesetId?: UUID;
  teamSize?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  ageMin?: number;
  ageMax?: number;
  minExperienceYears?: number;
  maxExperienceYears?: number;
  eligibilityLabel?: string;
  eligibilityRules?: EligibilityRule[];
  eligibilityExplanation?: string;
  status: DivisionStatus;
  metadata: Record<string, unknown>;
  revision?: number;
  publishedAt?: string;
  retiredAt?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface EventDivision {
  id: UUID;
  eventId: UUID;
  divisionId: UUID;
  rulesetId?: UUID;
  rulesetSnapshotId?: UUID;
  divisionSnapshot?: Record<string, unknown>;
  registrationLimit?: number;
  isRegistrationOpen: boolean;
  metadata: Record<string, unknown>;
  updatedAt?: string;
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
  updatedAt?: string;
}

export interface FightCard {
  id: UUID;
  eventId: UUID;
  name: string;
  listName: string;
  status: 'draft' | 'live' | 'locked' | 'archived';
  sortOrder: number;
  updatedAt?: string;
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

export type RulesetStatus = 'draft' | 'review' | 'published' | 'retired';
export type RulesetSourceKind = 'official' | 'organization' | 'event' | 'historical' | 'internal';

export interface RulesetRecord {
  id: UUID;
  organizationId?: UUID;
  teamId?: UUID;
  parentRulesetId?: UUID;
  name: string;
  shortName: string;
  version: string;
  description?: string;
  status: RulesetStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  settings: RulesetSettings;
  overrides?: RulesetSettingsPatch;
  eligibilityPolicy?: Record<string, unknown>;
  scoringPolicy?: Record<string, unknown>;
  tournamentPolicy?: Record<string, unknown>;
  rankingPolicy?: Record<string, unknown>;
  revision?: number;
  publishedAt?: string;
  retiredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RulesetSource {
  id: UUID;
  rulesetId: UUID;
  label: string;
  sourceUrl?: string;
  versionLabel?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceKind: RulesetSourceKind;
  notes?: string;
  accessedOn?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventRulesetSnapshot {
  id: UUID;
  eventId: UUID;
  rulesetId: UUID;
  rulesetName: string;
  rulesetShortName: string;
  rulesetVersion: string;
  resolvedSettings: RulesetSettings;
  eligibilityPolicy: Record<string, unknown>;
  scoringPolicy: Record<string, unknown>;
  tournamentPolicy: Record<string, unknown>;
  rankingPolicy: Record<string, unknown>;
  rulesetChain: Array<{ id: UUID; name: string; shortName: string; version: string }>;
  sourceSnapshot: Array<Record<string, unknown>>;
  lockedAt: string;
}

export interface EventPolicyException {
  id: UUID;
  organizationId: UUID;
  eventId: UUID;
  divisionId?: UUID;
  rulesetSnapshotId?: UUID;
  policyDomain: 'eligibility' | 'scoring' | 'tournament' | 'ranking';
  ruleKey: string;
  reason: string;
  status: 'approved' | 'revoked';
  approvedAt: string;
  metadata: Record<string, unknown>;
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
