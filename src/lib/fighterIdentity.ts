import type {
  FighterDuplicateSuggestion,
  FighterIdentity,
  FighterIdentityClaim,
  FighterIdentityMergeReview,
  FighterIdentityPrivateProfile,
  FighterIdentitySearchResult,
  FighterProfileVisibility,
  IdentityAccountRole,
  IdentityClaimStatus
} from '../types';
import { supabase } from './supabase';

const DEMO_IDENTITIES = 'buhurtos-demo-identities';
const DEMO_PRIVATE = 'buhurtos-demo-identity-private';

function readDemo<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function writeDemo(key: string, value: unknown): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
}

export function normalizeIdentityName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function validateFighterPublicProfile(input: {
  displayName: string;
  nickname?: string;
  bio?: string;
  publicRegion?: string;
}): string[] {
  const errors: string[] = [];
  const name = input.displayName.trim();
  if (name.length < 2 || name.length > 120) errors.push('Display name must be between 2 and 120 characters.');
  if ((input.nickname || '').trim().length > 120) errors.push('Nickname must be 120 characters or fewer.');
  if ((input.bio || '').trim().length > 2000) errors.push('Bio must be 2,000 characters or fewer.');
  if ((input.publicRegion || '').trim().length > 160) errors.push('Public region must be 160 characters or fewer.');
  return errors;
}

function rowToIdentity(row: any): FighterIdentity {
  return {
    id: row.id,
    displayName: row.display_name,
    nickname: row.nickname || undefined,
    avatarPath: row.avatar_path || undefined,
    bio: row.bio || undefined,
    publicRegion: row.public_region || undefined,
    profileVisibility: row.profile_visibility,
    profileRevision: Number(row.profile_revision),
    verifiedAt: row.verified_at || undefined
  };
}

function rowToPrivate(row: any): FighterIdentityPrivateProfile {
  return {
    identityId: row.identity_id,
    legalName: row.legal_name || undefined,
    birthDate: row.birth_date || undefined,
    contactEmail: row.contact_email || undefined,
    phone: row.phone || undefined,
    emergencyContactName: row.emergency_contact_name || undefined,
    emergencyContactPhone: row.emergency_contact_phone || undefined,
    guardianName: row.guardian_name || undefined,
    guardianEmail: row.guardian_email || undefined,
    guardianPhone: row.guardian_phone || undefined,
    guardianConsentAt: row.guardian_consent_at || undefined,
    revision: Number(row.revision)
  };
}

function rowToClaim(row: any): FighterIdentityClaim {
  return {
    id: row.id,
    identityId: row.identity_id,
    claimantUserId: row.claimant_user_id,
    relationship: row.relationship,
    status: row.status,
    claimNote: row.claim_note || undefined,
    reviewNote: row.review_note || undefined,
    disputeReason: row.dispute_reason || undefined,
    reviewedBy: row.reviewed_by || undefined,
    reviewedAt: row.reviewed_at || undefined,
    disputedBy: row.disputed_by || undefined,
    disputedAt: row.disputed_at || undefined,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToMergeReview(row: any): FighterIdentityMergeReview {
  return {
    id: row.id,
    canonicalIdentityId: row.canonical_identity_id,
    duplicateIdentityId: row.duplicate_identity_id,
    requestedBy: row.requested_by,
    reason: row.reason || undefined,
    status: row.status,
    canonicalRevision: Number(row.canonical_revision),
    duplicateRevision: Number(row.duplicate_revision),
    requestSnapshot: row.request_snapshot || {},
    reviewedBy: row.reviewed_by || undefined,
    reviewNote: row.review_note || undefined,
    reviewedAt: row.reviewed_at || undefined,
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at
  };
}

export async function listMyFighterIdentities(userId: string): Promise<FighterIdentity[]> {
  if (!supabase) return readDemo<FighterIdentity[]>(DEMO_IDENTITIES, []);
  const { data: links, error: linkError } = await supabase
    .from('fighter_identity_accounts')
    .select('identity_id')
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (linkError) throw linkError;
  const ids = [...new Set((links || []).map((row: any) => row.identity_id))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('fighter_identities')
    .select('id,display_name,nickname,avatar_path,bio,public_region,profile_visibility,profile_revision,verified_at')
    .in('id', ids)
    .is('deleted_at', null)
    .order('display_name');
  if (error) throw error;
  return (data || []).map(rowToIdentity);
}

export async function createMyFighterIdentity(displayName: string): Promise<string> {
  const errors = validateFighterPublicProfile({ displayName });
  if (errors.length) throw new Error(errors.join(' '));
  if (!supabase) {
    const rows = readDemo<FighterIdentity[]>(DEMO_IDENTITIES, []);
    const id = crypto.randomUUID();
    rows.push({
      id,
      displayName: displayName.trim(),
      profileVisibility: 'private',
      profileRevision: 1
    });
    writeDemo(DEMO_IDENTITIES, rows);
    return id;
  }
  const { data, error } = await supabase.rpc('create_my_fighter_identity', { p_display_name: displayName.trim() });
  if (error) throw error;
  return data as string;
}

export async function updateFighterPublicProfile(input: {
  identity: FighterIdentity;
  displayName: string;
  nickname?: string;
  bio?: string;
  publicRegion?: string;
  profileVisibility: FighterProfileVisibility;
}): Promise<number> {
  const errors = validateFighterPublicProfile(input);
  if (errors.length) throw new Error(errors.join(' '));
  if (!supabase) {
    const rows = readDemo<FighterIdentity[]>(DEMO_IDENTITIES, []);
    const revision = input.identity.profileRevision + 1;
    writeDemo(DEMO_IDENTITIES, rows.map(row => row.id === input.identity.id ? {
      ...row,
      displayName: input.displayName.trim(),
      nickname: input.nickname?.trim() || undefined,
      bio: input.bio?.trim() || undefined,
      publicRegion: input.publicRegion?.trim() || undefined,
      profileVisibility: input.profileVisibility,
      profileRevision: revision
    } : row));
    return revision;
  }
  const { data, error } = await supabase.rpc('update_fighter_public_profile', {
    p_identity_id: input.identity.id,
    p_expected_revision: input.identity.profileRevision,
    p_display_name: input.displayName.trim(),
    p_nickname: input.nickname?.trim() || null,
    p_bio: input.bio?.trim() || null,
    p_public_region: input.publicRegion?.trim() || null,
    p_visibility: input.profileVisibility
  });
  if (error) throw error;
  return Number(data);
}

export async function loadFighterPrivateProfile(identityId: string): Promise<FighterIdentityPrivateProfile | null> {
  if (!supabase) {
    const rows = readDemo<Record<string, FighterIdentityPrivateProfile>>(DEMO_PRIVATE, {});
    return rows[identityId] || null;
  }
  const { data, error } = await supabase
    .from('fighter_identity_private_profiles')
    .select('*')
    .eq('identity_id', identityId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPrivate(data) : null;
}

export async function updateFighterPrivateProfile(input: {
  identityId: string;
  expectedRevision: number;
  legalName?: string;
  birthDate?: string;
  contactEmail?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
  guardianConsent?: boolean | null;
}): Promise<number> {
  if (input.birthDate && new Date(input.birthDate + 'T00:00:00Z').getTime() > Date.now()) {
    throw new Error('Birth date cannot be in the future.');
  }
  if (!supabase) {
    const rows = readDemo<Record<string, FighterIdentityPrivateProfile>>(DEMO_PRIVATE, {});
    const revision = input.expectedRevision + 1;
    const current = rows[input.identityId];
    rows[input.identityId] = {
      identityId: input.identityId,
      legalName: input.legalName?.trim() || undefined,
      birthDate: input.birthDate || undefined,
      contactEmail: input.contactEmail?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      emergencyContactName: input.emergencyContactName?.trim() || undefined,
      emergencyContactPhone: input.emergencyContactPhone?.trim() || undefined,
      guardianName: input.guardianName?.trim() || undefined,
      guardianEmail: input.guardianEmail?.trim() || undefined,
      guardianPhone: input.guardianPhone?.trim() || undefined,
      guardianConsentAt: input.guardianConsent == null ? current?.guardianConsentAt : input.guardianConsent ? new Date().toISOString() : undefined,
      revision
    };
    writeDemo(DEMO_PRIVATE, rows);
    return revision;
  }
  const { data, error } = await supabase.rpc('update_fighter_private_profile', {
    p_identity_id: input.identityId,
    p_expected_revision: input.expectedRevision,
    p_legal_name: input.legalName?.trim() || null,
    p_birth_date: input.birthDate || null,
    p_contact_email: input.contactEmail?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_emergency_contact_name: input.emergencyContactName?.trim() || null,
    p_emergency_contact_phone: input.emergencyContactPhone?.trim() || null,
    p_guardian_name: input.guardianName?.trim() || null,
    p_guardian_email: input.guardianEmail?.trim() || null,
    p_guardian_phone: input.guardianPhone?.trim() || null,
    p_guardian_consent: input.guardianConsent ?? null
  });
  if (error) throw error;
  return Number(data);
}

export async function searchClaimableFighterIdentities(query: string): Promise<FighterIdentitySearchResult[]> {
  const clean = normalizeIdentityName(query);
  if (clean.length < 3) return [];
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('search_claimable_fighter_identities', { p_query: query.trim() });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    identityId: row.identity_id,
    displayName: row.display_name,
    nickname: row.nickname || undefined,
    publicRegion: row.public_region || undefined,
    isClaimed: Boolean(row.is_claimed),
    isVerified: Boolean(row.is_verified)
  }));
}

export async function submitFighterIdentityClaim(identityId: string, relationship: IdentityAccountRole, note?: string): Promise<string> {
  if (!supabase) throw new Error('Identity claims require the live BuhurtOS database.');
  const { data, error } = await supabase.rpc('submit_fighter_identity_claim', {
    p_identity_id: identityId,
    p_relationship: relationship,
    p_claim_note: note?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

export async function listMyIdentityClaims(userId: string): Promise<FighterIdentityClaim[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('fighter_identity_claims')
    .select('*')
    .eq('claimant_user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToClaim);
}

export async function listIdentityClaimsForReview(): Promise<FighterIdentityClaim[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('fighter_identity_claims')
    .select('*')
    .in('status', ['pending', 'disputed'])
    .order('created_at');
  if (error) throw error;
  return (data || []).map(rowToClaim);
}

export async function reviewFighterIdentityClaim(claim: FighterIdentityClaim, decision: 'approve' | 'reject', note?: string): Promise<IdentityClaimStatus> {
  if (!supabase) throw new Error('Claim review requires the live BuhurtOS database.');
  const { data, error } = await supabase.rpc('review_fighter_identity_claim', {
    p_claim_id: claim.id,
    p_decision: decision,
    p_review_note: note?.trim() || null,
    p_expected_version: claim.version
  });
  if (error) throw error;
  return data as IdentityClaimStatus;
}

export async function disputeFighterIdentityClaim(claim: FighterIdentityClaim, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Dispute reason is required.');
  if (!supabase) throw new Error('Claim disputes require the live BuhurtOS database.');
  const { error } = await supabase.rpc('dispute_fighter_identity_claim', {
    p_claim_id: claim.id,
    p_reason: reason.trim(),
    p_expected_version: claim.version
  });
  if (error) throw error;
}

export async function cancelFighterIdentityClaim(claim: FighterIdentityClaim): Promise<void> {
  if (!supabase) throw new Error('Claim cancellation requires the live BuhurtOS database.');
  const { error } = await supabase.rpc('cancel_fighter_identity_claim', {
    p_claim_id: claim.id,
    p_expected_version: claim.version
  });
  if (error) throw error;
}

export async function suggestFighterIdentityDuplicates(identityId: string): Promise<FighterDuplicateSuggestion[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('suggest_fighter_identity_duplicates', { p_identity_id: identityId });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    candidateIdentityId: row.candidate_identity_id,
    candidateDisplayName: row.candidate_display_name,
    reason: row.reason,
    score: Number(row.score)
  }));
}

export async function listIdentityMergeReviews(): Promise<FighterIdentityMergeReview[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('fighter_identity_merge_reviews')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToMergeReview);
}

export async function requestFighterIdentityMerge(canonicalIdentityId: string, duplicateIdentityId: string, reason?: string): Promise<string> {
  if (canonicalIdentityId === duplicateIdentityId) throw new Error('Choose two different fighter identities.');
  if (!supabase) throw new Error('Merge review requires the live BuhurtOS database.');
  const { data, error } = await supabase.rpc('request_fighter_identity_merge', {
    p_canonical_identity_id: canonicalIdentityId,
    p_duplicate_identity_id: duplicateIdentityId,
    p_reason: reason?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

export async function reviewFighterIdentityMerge(reviewId: string, decision: 'approve' | 'reject', note?: string): Promise<string> {
  if (!supabase) throw new Error('Merge review requires the live BuhurtOS database.');
  const { data, error } = await supabase.rpc('review_fighter_identity_merge', {
    p_review_id: reviewId,
    p_decision: decision,
    p_review_note: note?.trim() || null
  });
  if (error) throw error;
  return String(data);
}
