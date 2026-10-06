import { supabase } from '../lib/supabase';

/**
 * Pack 22: penalties, suspensions, appeals, authenticity infractions and eligibility. Every write is a database function that checks the caller's
 * authority again (event officials, the authenticity officer, an organization's admins, the platform owner); the screens only decide what to offer.
 * Every write that creates something carries a command id made on this device, so a retry on a poor signal never records it twice.
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
export const newCommandId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

export interface RuleRef { id: string; number: string | null; title: string | null; document?: string; version: string }
export type SanctionKind = 'warning' | 'card' | 'removal' | 'disqualification' | 'team_disqualification';
export interface EventSanction {
  id: string; kind: SanctionKind; card_key: string | null; label: string | null; status: 'active' | 'withdrawn' | 'removed'; created_at: string; ended_at: string | null;
  fighter_id: string | null; team_id: string | null; against: string | null; competition: string | null; reason: string | null; end_reason: string | null; issued_by_name: string | null; rule: RuleRef | null;
}
export interface Finding {
  id: string; registration_id: string; fighter_id: string | null; name: string; severity: 'minor' | 'moderate' | 'major'; item: string; status: 'open' | 'corrected' | 'voided';
  created_at: string; note: string | null; rule: RuleRef | null;
}
export type ReviewKind = 'event_appeal' | 'judiciary_red_card' | 'judiciary_application';
export interface Review {
  id: string; kind: ReviewKind; status: 'lodged' | 'decided' | 'withdrawn'; outcome: string | null; lodged_by_name: string; grounds: string; lodged_at: string; due_by: string; late: boolean;
  decision_note: string | null; decided_at: string | null; match_discipline_id: string | null; event_sanction_id: string | null; match_id: string | null; against: string | null;
}
export interface EventSuspension { id: string; scope: 'remainder_of_event' | 'competition'; competition: string | null; fighter_id: string | null; team_id: string | null; against: string | null; starts_at: string; lifted_at: string | null; label: string; reason: string | null; lift_reason: string | null }
export interface Block { registration_id: string; fighter_id: string | null; name: string; message: string }
export interface Tally { competition: string; against: string | null; fighter_id: string | null; team_id: string | null; cards: Record<string, number> }
/** A fight of the event that has started or finished (an appeal can be about a fight where nothing was recorded). */
export interface EventFight { id: string; competition: string; round_label: string | null; field: string | null; state: string; a: string | null; b: string | null }
export interface DisciplineOverview {
  sanctions: EventSanction[]; findings: Finding[]; reviews: Review[]; blocks: Block[]; event_suspensions: EventSuspension[]; tallies: Tally[]; fights?: EventFight[];
  can: { sanction: boolean; green_card: boolean; finding: boolean; suspend: boolean; lodge_appeal: boolean; decide_appeal: boolean; withdraw_appeal?: boolean };
}
export const fetchDisciplineOverview = (eventId: string) => rpc<DisciplineOverview>('event_discipline_overview', { p_event: eventId });

export interface CardType { governing_body: string; key: string; label: string; level: string; on_tablet: boolean; issued_at_event: boolean; sources: string[]; note: string | null; sort: number }
export async function fetchCardTypes(): Promise<CardType[]> {
  const { data, error } = await supabase.from('discipline_card_types').select('governing_body, key, label, level, on_tablet, issued_at_event, sources, note, sort').order('governing_body').order('sort');
  if (error) throw error;
  return (data ?? []) as CardType[];
}
export interface ReviewRule { governing_body: string; kind: ReviewKind; window_interval: string; outcomes: string[]; sources: string[]; note: string | null }
export async function fetchReviewRules(): Promise<ReviewRule[]> {
  const { data, error } = await supabase.from('discipline_review_rules').select('governing_body, kind, window_interval, outcomes, sources, note');
  if (error) throw error;
  return (data ?? []) as ReviewRule[];
}

export const issueEventSanction = (a: { event: string; kind: SanctionKind; fighter?: string | null; team?: string | null; competition?: string | null; cardKey?: string | null; provision?: string | null; reason?: string | null }, command = newCommandId()) =>
  rpc<{ status: 'ok' | 'duplicate'; id: string }>('issue_event_sanction', { p_command: command, p_event: a.event, p_kind: a.kind, p_fighter: a.fighter ?? null, p_team: a.team ?? null, p_competition: a.competition ?? null, p_card_key: a.cardKey ?? null, p_provision: a.provision ?? null, p_reason: a.reason ?? null });
export const endEventSanction = (id: string, status: 'withdrawn' | 'removed', reason: string) => rpc<{ status: string }>('end_event_sanction', { p_id: id, p_status: status, p_reason: reason });

export const recordFinding = (a: { registration: string; severity: Finding['severity']; item: string; provision?: string | null; note?: string | null }, command = newCommandId()) =>
  rpc<{ status: string; id: string }>('record_authenticity_finding', { p_command: command, p_registration: a.registration, p_severity: a.severity, p_item: a.item, p_provision: a.provision ?? null, p_note: a.note ?? null });
export const closeFinding = (id: string, status: 'corrected' | 'voided', reason?: string | null) => rpc<{ status: string }>('close_authenticity_finding', { p_id: id, p_status: status, p_reason: reason ?? null });

export type Authority = 'event' | 'organization' | 'platform';
export type SuspensionScope = 'remainder_of_event' | 'competition' | 'organization_events' | 'all_events';
export const issueSuspension = (a: { authority: Authority; scope: SuspensionScope; reason: string; fighter?: string | null; team?: string | null; event?: string | null; organization?: string | null; competition?: string | null; startsAt?: string | null; endsAt?: string | null; provision?: string | null }, command = newCommandId()) =>
  rpc<{ status: string; id: string }>('issue_suspension', { p_command: command, p_authority: a.authority, p_scope: a.scope, p_reason: a.reason, p_fighter: a.fighter ?? null, p_team: a.team ?? null, p_event: a.event ?? null, p_organization: a.organization ?? null, p_competition: a.competition ?? null, p_starts_at: a.startsAt ?? null, p_ends_at: a.endsAt ?? null, p_provision: a.provision ?? null });
export const changeSuspension = (id: string, endsAt: string | null, reason: string, command = newCommandId()) => rpc<{ status: string; id: string }>('change_suspension', { p_command: command, p_id: id, p_ends_at: endsAt, p_reason: reason });
export const liftSuspension = (id: string, reason: string) => rpc<{ status: string }>('lift_suspension', { p_id: id, p_reason: reason });

export const lodgeReview = (a: { kind: ReviewKind; lodgedBy: string; grounds: string; matchDiscipline?: string | null; eventSanction?: string | null; suspension?: string | null; match?: string | null; governingBody?: string; from?: string | null }, command = newCommandId()) =>
  rpc<{ status: string; id: string; due_by: string; late: boolean }>('lodge_review', { p_command: command, p_kind: a.kind, p_lodged_by: a.lodgedBy, p_grounds: a.grounds, p_match_discipline: a.matchDiscipline ?? null, p_event_sanction: a.eventSanction ?? null, p_suspension: a.suspension ?? null, p_match: a.match ?? null, p_governing_body: a.governingBody ?? 'Buhurt International', p_from: a.from ?? null });
export const decideReview = (id: string, outcome: string, note: string | null, apply: boolean) => rpc<{ status: string; applied: string | null }>('decide_review', { p_id: id, p_outcome: outcome, p_note: note, p_apply: apply });
export const withdrawReview = (id: string, reason: string) => rpc<{ status: string }>('withdraw_review', { p_id: id, p_reason: reason });

export interface EligibilityItem { kind: 'block' | 'warning'; code: string; message: string; source_key: string | null }
export const fetchEligibility = (eventId: string, fighterId: string | null, teamId: string | null = null) => rpc<EligibilityItem[]>('discipline_eligibility', { p_event: eventId, p_fighter: fighterId, p_team: teamId });

export interface FighterDiscipline {
  suspensions: { id: string; authority: Authority; scope: SuspensionScope; starts_at: string; ends_at: string | null; lifted_at: string | null; superseded: boolean; label: string; event: string | null; organization: string | null; in_force: boolean; rule: RuleRef | null }[];
  sanctions: { id: string; kind: SanctionKind; card_key: string | null; label: string | null; status: string; event: string; created_at: string }[];
  findings: { id: string; severity: string; item: string; status: string; event: string; created_at: string }[];
  reviews: { id: string; kind: ReviewKind; status: string; outcome: string | null; lodged_at: string; due_by: string; decided_at: string | null }[];
}
export const fetchFighterDiscipline = (fighterId: string) => rpc<FighterDiscipline>('fighter_discipline', { p_fighter: fighterId });

export interface HistoryItem { entity_id: string; action: string; at: string; details: Record<string, unknown>; by: string | null }
export const fetchRecordHistory = (entity: 'suspension' | 'event_sanction' | 'review' | 'finding', id: string) => rpc<HistoryItem[]>('discipline_record_history', { p_entity: entity, p_id: id });

export interface ManagedSuspension { id: string; authority: Authority; scope: SuspensionScope; fighter_id: string | null; team_id: string | null; against: string | null; starts_at: string; ends_at: string | null; lifted_at: string | null; superseded: boolean; label: string; reason: string | null; lift_reason: string | null; in_force: boolean }
export const fetchManagedSuspensions = (organizationId: string | null) => rpc<ManagedSuspension[]>('managed_suspensions', { p_organization: organizationId });

/* the documents a competition is fought under */
export async function fetchCompetitionRulesets(competitionId: string): Promise<string[]> {
  const { data, error } = await supabase.from('competition_rulesets').select('ruleset_version_id').eq('competition_id', competitionId);
  if (error) throw error;
  return (data ?? []).map(r => (r as { ruleset_version_id: string }).ruleset_version_id);
}
export const applyCurrentDocuments = (competitionId: string, governingBody: string) => rpc<{ status: string; count: number; primary: string | null }>('apply_current_documents', { p_competition: competitionId, p_governing_body: governingBody });
export const setCompetitionRulesets = (competitionId: string, versions: string[]) => rpc<{ status: string; count: number }>('set_competition_rulesets', { p_competition: competitionId, p_versions: versions });
export const applyCardPreset = (eventId: string, governingBody: string) => rpc<{ cards: { key: string; label: string }[] }>('apply_card_preset', { p_event: eventId, p_governing_body: governingBody });

/* plain words */
export const SANCTION_WORD: Record<SanctionKind, string> = { warning: 'Warning', card: 'Card', removal: 'Removed from the event', disqualification: 'Disqualification', team_disqualification: 'Team disqualification' };
export const SEVERITY_WORD: Record<Finding['severity'], string> = { minor: 'Minor', moderate: 'Moderate', major: 'Major' };
export const REVIEW_WORD: Record<ReviewKind, string> = { event_appeal: 'Appeal at the event', judiciary_red_card: 'Judiciary Committee: red card review', judiciary_application: 'Judiciary Committee: application' };
export const OUTCOME_WORD: Record<string, string> = {
  rematch_round: 'Rematch of the round', restart: 'Restart from a point', cards_imposed: 'Cards imposed', cards_withdrawn: 'Cards withdrawn',
  point_deduction_imposed: 'Point deduction imposed', point_deduction_withdrawn: 'Point deduction withdrawn', kept: 'Appeal not approved: decision kept',
  revoked: 'Penalty revoked', increased: 'Penalty increased', reduced: 'Penalty reduced'
};
