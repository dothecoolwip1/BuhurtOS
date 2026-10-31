import { supabase } from '../lib/supabase';
import type { OrganizationKind } from './organizations';

/**
 * Suggest a new organization: anyone signed in sends one, the platform owner approves (which creates the organization) or declines.
 * The database enforces everything (who may call, limits, duplicates); these helpers only shape the form and the rows.
 */

export type SuggestionStatus = 'pending' | 'approved' | 'declined';
export type Involvement = 'admin' | 'member' | 'none';

export const KIND_OPTIONS: readonly (readonly [OrganizationKind, string])[] = [
  ['club', 'Club'], ['regional', 'Regional league'], ['national', 'National federation or league'], ['federation', 'International federation'], ['other', 'Other']
];
export const INVOLVEMENT_OPTIONS: readonly (readonly [Involvement, string])[] = [
  ['admin', 'I run it or help run it'], ['member', 'I am a member'], ['none', 'I just know about it']
];
export const kindLabel = (k: OrganizationKind): string => KIND_OPTIONS.find(o => o[0] === k)?.[1] ?? k;
export const involvementLabel = (i: Involvement): string => INVOLVEMENT_OPTIONS.find(o => o[0] === i)?.[1] ?? i;
export const statusText = (s: SuggestionStatus): string => (s === 'pending' ? 'Waiting for review' : s === 'approved' ? 'Added' : 'Not added');

export interface SuggestionForm {
  name: string; shortName: string; kind: OrganizationKind; country: string; region: string; website: string; description: string; involvement: Involvement; note: string;
}
export const emptySuggestion = (): SuggestionForm => ({ name: '', shortName: '', kind: 'club', country: '', region: '', website: '', description: '', involvement: 'none', note: '' });

export const SUGGESTION_LIMITS = { name: 120, shortName: 20, country: 80, region: 80, website: 300, description: 1000, note: 1000 } as const;
export type SuggestionErrors = Partial<Record<keyof SuggestionForm, string>>;

/** Same rules as suggest_organization, so the form can say so before sending. The database checks again. */
export function validateSuggestion(f: SuggestionForm): SuggestionErrors {
  const e: SuggestionErrors = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = 'Give the organization’s name.';
  else if (name.length > SUGGESTION_LIMITS.name) e.name = `Keep the name under ${SUGGESTION_LIMITS.name} characters.`;
  const short = f.shortName.trim();
  if (short && (short.length < 2 || short.length > SUGGESTION_LIMITS.shortName)) e.shortName = `A short name is 2 to ${SUGGESTION_LIMITS.shortName} characters.`;
  if (f.country.trim().length > SUGGESTION_LIMITS.country) e.country = `Keep the country under ${SUGGESTION_LIMITS.country} characters.`;
  if (f.region.trim().length > SUGGESTION_LIMITS.region) e.region = `Keep this under ${SUGGESTION_LIMITS.region} characters.`;
  const web = f.website.trim();
  if (web && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(web)) e.website = 'That does not look like a web address.';
  else if (web.length > SUGGESTION_LIMITS.website) e.website = `Keep the website under ${SUGGESTION_LIMITS.website} characters.`;
  if (f.description.trim().length > SUGGESTION_LIMITS.description) e.description = `Keep the description under ${SUGGESTION_LIMITS.description} characters.`;
  if (f.note.trim().length > SUGGESTION_LIMITS.note) e.note = `Keep the note under ${SUGGESTION_LIMITS.note} characters.`;
  return e;
}

/** What suggest_organization receives: trimmed, blanks left out. */
export function suggestionPayload(f: SuggestionForm): Record<string, string> {
  const out: Record<string, string> = { kind: f.kind, involvement: f.involvement };
  const put = (k: string, v: string) => { const t = v.trim(); if (t) out[k] = t; };
  put('name', f.name); put('short_name', f.shortName); put('country', f.country); put('region', f.region); put('website', f.website); put('description', f.description); put('note', f.note);
  return out;
}

/** Signed in only. Returns the suggestion's id. */
export async function suggestOrganization(f: SuggestionForm): Promise<string> {
  const { data, error } = await supabase.rpc('suggest_organization', { p: suggestionPayload(f) });
  if (error) throw error;
  return data as string;
}

export interface MySuggestion { id: string; createdAt: string; name: string; kind: OrganizationKind; country: string | null; status: SuggestionStatus; decidedAt: string | null; decisionNote: string | null; organizationSlug: string | null }
type MyDb = { id: string; created_at: string; name: string; kind: OrganizationKind; country: string | null; status: SuggestionStatus; decided_at: string | null; decision_note: string | null; organization_slug: string | null };
export const toMySuggestion = (r: MyDb): MySuggestion => ({
  id: r.id, createdAt: r.created_at, name: r.name, kind: r.kind, country: r.country, status: r.status, decidedAt: r.decided_at, decisionNote: r.decision_note, organizationSlug: r.organization_slug
});
export async function fetchMySuggestions(): Promise<MySuggestion[]> {
  const { data, error } = await supabase.rpc('my_organization_suggestions');
  if (error) throw error;
  return (data as MyDb[]).map(toMySuggestion);
}

// ---------------------------------------------------------------- owner review
export interface AdminSuggestion {
  id: string; createdAt: string; personName: string | null; email: string | null; name: string; shortName: string | null; kind: OrganizationKind; country: string | null; region: string | null;
  website: string | null; description: string | null; involvement: Involvement; note: string | null; status: SuggestionStatus; decidedAt: string | null; decisionNote: string | null; organizationSlug: string | null;
}
type AdminDb = {
  id: string; created_at: string; person_name: string | null; email: string | null; name: string; short_name: string | null; kind: OrganizationKind; country: string | null; region: string | null;
  website: string | null; description: string | null; involvement: Involvement; note: string | null; status: SuggestionStatus; decided_at: string | null; decision_note: string | null; organization_slug: string | null;
};
export const toAdminSuggestion = (r: AdminDb): AdminSuggestion => ({
  id: r.id, createdAt: r.created_at, personName: r.person_name, email: r.email, name: r.name, shortName: r.short_name, kind: r.kind, country: r.country, region: r.region,
  website: r.website, description: r.description, involvement: r.involvement, note: r.note, status: r.status, decidedAt: r.decided_at, decisionNote: r.decision_note, organizationSlug: r.organization_slug
});
/** Platform owner only. null = every status. */
export async function fetchAdminSuggestions(status: SuggestionStatus | null): Promise<AdminSuggestion[]> {
  const { data, error } = await supabase.rpc('admin_organization_suggestions', { p_status: status });
  if (error) throw error;
  return (data as AdminDb[]).map(toAdminSuggestion);
}

/** The fields the owner checks before approving. They become the organization exactly as written. */
export interface ApproveForm { name: string; shortName: string; slug: string; kind: OrganizationKind; country: string; region: string; website: string; description: string; makeAdmin: boolean }
/** Lower-case letters, numbers and single dashes, from the short name when there is one. Same rule as the database. */
export const orgSlug = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const approveFormFrom = (s: AdminSuggestion): ApproveForm => ({
  name: s.name, shortName: s.shortName ?? '', slug: orgSlug(s.shortName ?? s.name), kind: s.kind, country: s.country ?? '', region: s.region ?? '',
  website: s.website ?? '', description: s.description ?? '', makeAdmin: s.involvement === 'admin'
});
/** p_org for decide_organization_suggestion: every field sent, blanks as empty strings so the owner can clear one. */
export const approvePayload = (f: ApproveForm) => ({
  name: f.name.trim(), short_name: f.shortName.trim(), slug: f.slug.trim(), kind: f.kind, country: f.country.trim(), region: f.region.trim(), website: f.website.trim(), description: f.description.trim()
});
/** Platform owner only. Approving creates the organization and returns its id; declining returns null. */
export async function decideSuggestion(id: string, decision: 'approved' | 'declined', note: string, form: ApproveForm | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('decide_organization_suggestion', {
    p_suggestion: id, p_decision: decision, p_note: note.trim() || null, p_org: form ? approvePayload(form) : {}, p_make_admin: form?.makeAdmin ?? false
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}
