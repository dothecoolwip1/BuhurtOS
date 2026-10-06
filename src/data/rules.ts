/**
 * Pack 22: the rules library as the app reads it. Reads only: the library is written by the importer and the owner's database functions.
 *
 * Everything readable (published, superseded and withdrawn versions; the owner also sees drafts) is loaded once and kept in this browser, so the
 * rules open instantly and still work with poor signal at the list. A saved copy is shown at once and refreshed in the background.
 */
import { supabase } from '../lib/supabase';
import { RULES } from '../content/rules';
import type { SearchableRule } from '../lib/rules/search';

export interface RuleDocument {
  id: string; slug: string; name: string; governing_body: string | null; inventory_key: string | null; committee: string | null; committee_name: string | null;
  heading: string | null; kind: string | null; applies_to: string[]; relevance: string | null; official_url: string | null; source_host: string | null;
  listed_on_page: boolean; page_order: number | null; previously_cited_as: string | null; classification_note: string | null; synthetic: boolean;
}
export type VersionStatus = 'draft' | 'in_review' | 'published' | 'superseded' | 'withdrawn';
export interface RuleVersion {
  id: string; ruleset_id: string; version: string; title: string | null; status: VersionStatus; published_on: string | null; effective_from: string | null; effective_to: string | null;
  source_url: string | null; source_sha256: string | null; source_retrieved_at: string | null; page_count: number | null; import_release: string | null; imported_at: string | null;
  published_at: string | null; successor_version_id: string | null; withdrawn_reason: string | null; synthetic: boolean; note: string | null;
}
export interface RuleProvision {
  id: string; ruleset_version_id: string; parent_id: string | null; ordinal: number; depth: number; kind: string; number: string | null; title: string | null; body: string;
  page_from: number | null; page_to: number | null; stable_key: string; review_status: 'extracted' | 'needs_review' | 'verified'; review_note: string | null; keywords: string[]; cross_refs: string[];
}
export interface RulesData { documents: RuleDocument[]; versions: RuleVersion[]; provisions: RuleProvision[]; loadedAt: string }

const DOC_COLS = 'id, slug, name, governing_body, inventory_key, committee, committee_name, heading, kind, applies_to, relevance, official_url, source_host, listed_on_page, page_order, previously_cited_as, classification_note, synthetic';
const VER_COLS = 'id, ruleset_id, version, title, status, published_on, effective_from, effective_to, source_url, source_sha256, source_retrieved_at, page_count, import_release, imported_at, published_at, successor_version_id, withdrawn_reason, synthetic, note';
const PROV_COLS = 'id, ruleset_version_id, parent_id, ordinal, depth, kind, number, title, body, page_from, page_to, stable_key, review_status, review_note, keywords, cross_refs';
const PAGE = 1000;

export async function fetchRulesData(): Promise<RulesData> {
  const [d, v] = await Promise.all([
    supabase.from('rulesets').select(DOC_COLS).order('committee', { nullsFirst: false }).order('page_order', { nullsFirst: false }).order('name'),
    supabase.from('ruleset_versions').select(VER_COLS).order('published_on', { ascending: false, nullsFirst: false })
  ]);
  if (d.error) throw d.error;
  if (v.error) throw v.error;
  const versions = (v.data ?? []) as RuleVersion[];
  const provisions: RuleProvision[] = [];
  if (versions.length) {
    // The API returns at most 1000 rows per request: read the text in pages, in reading order.
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('rule_provisions').select(PROV_COLS).in('ruleset_version_id', versions.map(x => x.id))
        .order('ruleset_version_id').order('ordinal').range(from, from + PAGE - 1);
      if (error) throw error;
      provisions.push(...((data ?? []) as RuleProvision[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return { documents: (d.data ?? []) as RuleDocument[], versions, provisions, loadedAt: new Date().toISOString() };
}

/* ---------------- the saved copy in this browser ---------------- */
const CACHE_KEY = 'bos-rules-cache-v1';
let memory: RulesData | null = null;
let inflight: Promise<RulesData> | null = null;
const subs = new Set<(d: RulesData) => void>();

export function readCachedRules(): RulesData | null {
  if (memory) return memory;
  try { const raw = localStorage.getItem(CACHE_KEY); if (raw) memory = JSON.parse(raw) as RulesData; } catch { /* storage blocked or full: just load */ }
  return memory;
}
/** Loads the library (once at a time), keeps it in memory and in this browser, and tells everyone showing rules. */
export function refreshRules(): Promise<RulesData> {
  if (!inflight) {
    inflight = fetchRulesData().then(d => {
      memory = d;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* too big or blocked: memory only */ }
      subs.forEach(f => f(d));
      return d;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}
export function subscribeRules(f: (d: RulesData) => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
export function clearRulesCache() { memory = null; try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } }

/* ---------------- the index the screens and search use ---------------- */
export interface RuleEntry extends SearchableRule {
  provision: RuleProvision; version: RuleVersion; doc: RuleDocument;
  /** Ancestors, outermost first. */
  ancestors: RuleProvision[];
}
export interface RulesIndex {
  data: RulesData;
  docById: Map<string, RuleDocument>;
  docBySlug: Map<string, RuleDocument>;
  versionById: Map<string, RuleVersion>;
  versionsByDoc: Map<string, RuleVersion[]>;
  provisionById: Map<string, RuleProvision>;
  byVersion: Map<string, RuleProvision[]>;
  entries: RuleEntry[];
  entryById: Map<string, RuleEntry>;
}

const STATUS_ORDER: Record<VersionStatus, number> = { published: 0, in_review: 1, draft: 2, superseded: 3, withdrawn: 4 };

export function buildRulesIndex(data: RulesData): RulesIndex {
  const docById = new Map(data.documents.map(d => [d.id, d]));
  const docBySlug = new Map(data.documents.map(d => [d.slug, d]));
  const versionById = new Map(data.versions.map(v => [v.id, v]));
  const versionsByDoc = new Map<string, RuleVersion[]>();
  for (const v of data.versions) versionsByDoc.set(v.ruleset_id, [...(versionsByDoc.get(v.ruleset_id) ?? []), v]);
  for (const list of versionsByDoc.values()) list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.published_on ?? '').localeCompare(a.published_on ?? '') || b.version.localeCompare(a.version));
  const provisionById = new Map(data.provisions.map(p => [p.id, p]));
  const byVersion = new Map<string, RuleProvision[]>();
  for (const p of data.provisions) byVersion.set(p.ruleset_version_id, [...(byVersion.get(p.ruleset_version_id) ?? []), p]);
  for (const list of byVersion.values()) list.sort((a, b) => a.ordinal - b.ordinal);
  const entries: RuleEntry[] = [];
  for (const p of data.provisions) {
    const version = versionById.get(p.ruleset_version_id); if (!version) continue;
    const doc = docById.get(version.ruleset_id); if (!doc) continue;
    const ancestors: RuleProvision[] = [];
    for (let a = p.parent_id ? provisionById.get(p.parent_id) : undefined, n = 0; a && n < 10; a = a.parent_id ? provisionById.get(a.parent_id) : undefined, n++) ancestors.unshift(a);
    entries.push({ id: p.id, number: p.number, title: p.title, body: p.body, keywords: p.keywords, path: ancestors.map(a => a.title ?? a.number ?? '').filter(Boolean), document: doc.name, provision: p, version, doc, ancestors });
  }
  return { data, docById, docBySlug, versionById, versionsByDoc, provisionById, byVersion, entries, entryById: new Map(entries.map(e => [e.id, e])) };
}

/** The version a document is currently governed by: the published one, else (for the owner) the newest in review. */
export const currentVersion = (idx: RulesIndex, docId: string): RuleVersion | null => (idx.versionsByDoc.get(docId) ?? []).find(v => v.status === 'published') ?? null;

/** The same rule (same stable key) in the other versions of its document, newest first. */
export function sameRuleElsewhere(idx: RulesIndex, p: RuleProvision): RuleEntry[] {
  return idx.entries.filter(e => e.provision.stable_key === p.stable_key && e.provision.id !== p.id)
    .sort((a, b) => STATUS_ORDER[a.version.status] - STATUS_ORDER[b.version.status] || (b.version.published_on ?? '').localeCompare(a.version.published_on ?? ''));
}

/** A link to the official file, at the page where the provision is printed when the file is the site's own PDF (Drive viewers ignore page anchors). */
export function officialLink(doc: RuleDocument, version: RuleVersion | null, page: number | null): string | null {
  const url = version?.source_url ?? doc.official_url;
  if (!url) return null;
  return page && doc.source_host === 'site_file' && url.endsWith('.pdf') ? `${url}#page=${page}` : url;
}

/* ---------------- BuhurtOS summaries (paraphrases from earlier packs, not official text) ---------------- */
export interface SummaryEntry extends SearchableRule { summary: (typeof RULES)[number]; docs: RuleDocument[] }
/** The 23 existing paraphrased summaries, each linked to the official documents it cites (matched by the version an earlier pack quoted). */
export function summaryEntries(documents: RuleDocument[]): SummaryEntry[] {
  return RULES.map((r, i) => {
    const cited = r.doc.split(' · ').map(s => s.trim());
    const docs = documents.filter(d => d.previously_cited_as && cited.some(c => c === d.previously_cited_as));
    return { id: `summary-${i}`, number: null, title: r.title, body: r.body, keywords: r.keywords ? r.keywords.split(' ') : [], path: [r.kind], document: r.doc, summary: r, docs };
  });
}

/* ---------------- a provision's history ---------------- */
export interface ProvisionRevision { id: number; changed_at: string; reason: string; before: { title: string | null; body: string }; after: { title: string | null; body: string } }
export async function fetchRevisions(provisionId: string): Promise<ProvisionRevision[]> {
  const { data, error } = await supabase.from('rule_provision_revisions').select('id, changed_at, reason, before, after').eq('provision_id', provisionId).order('changed_at');
  if (error) throw error;
  return (data ?? []) as ProvisionRevision[];
}
export interface RuleConflict { id: string; governing_body: string; version_a: string; provision_a: string | null; version_b: string | null; provision_b: string | null; description: string; status: string; resolution: string | null; noted_at: string }
export async function fetchConflicts(versionIds: string[]): Promise<RuleConflict[]> {
  if (!versionIds.length) return [];
  const ids = versionIds.join(',');
  const { data, error } = await supabase.from('rule_conflicts').select('id, governing_body, version_a, provision_a, version_b, provision_b, description, status, resolution, noted_at')
    .or(`version_a.in.(${ids}),version_b.in.(${ids})`).order('noted_at');
  if (error) throw error;
  return (data ?? []) as RuleConflict[];
}

/* ---------------- officiating ---------------- */
export interface Citation { id: string; discipline_id: string; provision_id: string | null; created_at: string }
/** The current rule cited on each disciplinary record (the latest row per record). */
export async function fetchCitations(disciplineIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!disciplineIds.length) return out;
  const { data, error } = await supabase.from('match_discipline_rules').select('id, discipline_id, provision_id, created_at').in('discipline_id', disciplineIds).order('created_at').order('id');
  if (error) throw error;
  for (const c of (data ?? []) as Citation[]) out.set(c.discipline_id, c.provision_id);
  return out;
}

export interface DisciplineLogRow {
  id: string; match_id: string; round_no: number; side: 'a' | 'b'; kind: 'warning' | 'card' | 'deduction' | 'dq'; label: string | null; amount: number; related_id: string | null;
  created_at: string; voided_at: string | null; reason: string | null; called_by: string | null; void_reason: string | null; recorded_by_name: string | null; recorded_by_me: boolean;
  field: string | null; round_label: string | null; queue_state: string | null; competition_id: string; competition_name: string;
  entry_id: string | null; fighter_id: string | null; team_id: string | null; against: string | null;
  provision_id: string | null; rule_number: string | null; rule_title: string | null; rule_document: string | null; rule_version: string | null; rule_version_status: string | null; citation_changes: number;
}
export async function fetchDisciplineLog(eventId: string): Promise<DisciplineLogRow[]> {
  const { data, error } = await supabase.rpc('event_discipline_log', { p_event: eventId });
  if (error) throw error;
  return (data ?? []) as DisciplineLogRow[];
}

export async function setCompetitionRulesetVersion(competitionId: string, versionId: string | null) {
  const { data, error } = await supabase.rpc('set_competition_ruleset_version', { p_competition: competitionId, p_version: versionId });
  if (error) throw error;
  return data as { status: 'ok' | 'duplicate' };
}
