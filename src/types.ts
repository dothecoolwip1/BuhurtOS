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
export type OrganizationKind = 'international_federation' | 'national_federation' | 'regional_organization' | 'local_organization' | 'independent_organization';
export type EntityVisibility = 'public' | 'members' | 'private';
export type OrganizationRelationshipKind = 'governs' | 'recognizes' | 'affiliate';
export type ClubRole = 'club_admin' | 'coach' | 'member';
export type TeamRole = 'team_admin' | 'captain' | 'coach' | 'fighter' | 'support';
export type TeamStatus = 'forming' | 'pending' | 'active' | 'suspended' | 'archived';
export type MembershipScope = 'club' | 'team';
export type MembershipRequestKind = 'invitation' | 'application';
export type MembershipRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

export interface Organization {
  id: UUID;
  name: string;
  shortName: string;
  region: string;
  status: 'active' | 'inactive';
  kind?: OrganizationKind;
  visibility?: EntityVisibility;
  countryCode?: string;
  websiteUrl?: string;
  publicContactEmail?: string;
}

export interface OrganizationRelationship {
  id: UUID;
  parentOrganizationId: UUID;
  childOrganizationId: UUID;
  relationshipKind: OrganizationRelationshipKind;
  startsOn: string;
  endsOn?: string;
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
  visibility?: EntityVisibility;
  publicDescription?: string;
  logoPath?: string;
  publicContactEmail?: string;
  deletedAt?: string;
}

export interface Team {
  id: UUID;
  organizationId: UUID;
  clubId?: UUID;
  name: string;
  shortName?: string;
  cityOrRegion?: string;
  status?: TeamStatus;
  isActive?: boolean;
  visibility?: EntityVisibility;
  publicDescription?: string;
  websiteUrl?: string;
  publicContactEmail?: string;
  foundedOn?: string;
  deletedAt?: string;
}

export interface ClubMembership {
  id: UUID;
  clubId: UUID;
  userId: UUID;
  role: ClubRole;
  displayName: string;
  startsOn: string;
  endsOn?: string;
}

export interface TeamMembership {
  id: UUID;
  teamId: UUID;
  userId: UUID;
  fighterIdentityId?: UUID;
  role: TeamRole;
  displayName: string;
  startsOn: string;
  endsOn?: string;
}

export interface MembershipRequest {
  id: UUID;
  scope: MembershipScope;
  requestKind: MembershipRequestKind;
  status: MembershipRequestStatus;
  clubId?: UUID;
  teamId?: UUID;
  requestedClubRole?: ClubRole;
  requestedTeamRole?: TeamRole;
  requesterUserId?: UUID;
  inviteEmail?: string;
  inviteToken?: UUID;
  expiresAt?: string;
  message?: string;
  createdBy?: UUID;
  createdAt: string;
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
  clubRoles: Array<{ clubId: UUID; role: ClubRole }>;
  teamRoles: Array<{ teamId: UUID; role: TeamRole }>;
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
