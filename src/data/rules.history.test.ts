import { describe, expect, it } from 'vitest';
import { buildRulesIndex, chronoCompare, compareVersions, officialLink, currentVersion, defaultVersion, inSearchScope, isCurrentText, sameRuleElsewhere, versionName, type RuleDocument, type RuleProvision, type RuleVersion, type RulesData } from './rules';

// One document with its version in force, an older current-release version, and three earlier (historical) editions, one of them still in review.
const doc: RuleDocument = {
  id: 'd1', slug: 'duel-regulations', name: 'Duel Regulations', governing_body: 'Buhurt International', inventory_key: 'tournament/duel-regulations', committee: 'tournament',
  committee_name: 'Tournament Committee', heading: null, kind: 'regulations', applies_to: ['duels'], relevance: 'direct', official_url: null, source_host: 'drive_file',
  listed_on_page: true, page_order: 1, previously_cited_as: null, classification_note: null, synthetic: false
};
const ver = (id: string, version: string, status: RuleVersion['status'], extra: Partial<RuleVersion> = {}): RuleVersion => ({
  id, ruleset_id: 'd1', version, title: null, status, published_on: null, effective_from: null, effective_to: null, source_url: null, source_sha256: null, source_retrieved_at: null,
  page_count: 10, import_release: null, imported_at: '2026-10-06T00:00:00Z', published_at: null, successor_version_id: null, withdrawn_reason: null, synthetic: false, note: null, ...extra
});
const versions: RuleVersion[] = [
  // deliberately out of order, and with labels whose text order is NOT their real order ("26.1" < "2025.03" as text)
  ver('h2', '2025.03', 'superseded', { historical: true, edition_seq: 2 }),
  ver('cur', '26.4', 'published'),
  ver('h3', '26.1', 'in_review', { historical: true, edition_seq: 3 }),
  ver('h1', '2024.12', 'superseded', { historical: true, edition_seq: 1 }),
  ver('old', '26.3', 'superseded', { successor_version_id: 'cur' })
];
const prov = (id: string, v: string, body: string): RuleProvision => ({
  id, ruleset_version_id: v, parent_id: null, ordinal: 1, depth: 0, kind: 'rule', number: '5.2', title: 'When to appeal', body, page_from: 3, page_to: 3,
  stable_key: 'duel-regulations:5.2', review_status: 'extracted', review_note: null, keywords: [], cross_refs: [], topics: [], has_figures: false, extraction: 'text'
});
const data: RulesData = {
  documents: [doc], versions, loadedAt: '2026-10-06T00:00:00Z',
  provisions: [
    prov('p-cur', 'cur', 'Announce the intention to appeal to the Secretary in person.'),
    prov('p-old', 'old', 'Announce the intention to appeal to the Secretary.'),
    prov('p-h1', 'h1', 'Announce the intention to appeal to the Knight Marshal in person.'),
    prov('p-h2', 'h2', 'Announce the intention to appeal to the Secretary in person (2025).'),
    prov('p-h3', 'h3', 'Announce the intention to appeal to the Secretary in person (26.1).')
  ]
};

describe('historical editions beside the current rules', () => {
  const idx = buildRulesIndex(data);

  it('the version in force stays the current version; an earlier edition never is', () => {
    expect(currentVersion(idx, 'd1')?.id).toBe('cur');
    expect(defaultVersion(idx, 'd1')?.id).toBe('cur');
    expect(versions.filter(isCurrentText).map(v => v.id)).toEqual(['cur']);
  });

  it('versions are ordered by evidence, not by label text: in force, older current-release, then earlier editions newest first', () => {
    expect(idx.versionsByDoc.get('d1')!.map(v => v.id)).toEqual(['cur', 'old', 'h3', 'h2', 'h1']);
    expect([...versions].sort(compareVersions).map(v => v.version)).toEqual(['26.4', '26.3', '26.1', '2025.03', '2024.12']);
  });

  it('default search covers the current text only; earlier editions come in only when explicitly included', () => {
    const scope = (older: boolean) => idx.entries.filter(e => inSearchScope(e.version, older)).map(e => e.id).sort();
    expect(scope(false)).toEqual(['p-cur']);
    expect(scope(true)).toEqual(['p-cur', 'p-h1', 'p-h2', 'p-h3', 'p-old']);
  });

  it('the same rule in other versions lists the current wording first and names earlier editions as such', () => {
    const others = sameRuleElsewhere(idx, idx.provisionById.get('p-h1')!);
    expect(others.map(e => e.version.id)).toEqual(['cur', 'old', 'h3', 'h2']);
    expect(versionName(idx.versionById.get('h2')!)).toBe('Earlier edition 2025.03');
    expect(versionName(idx.versionById.get('cur')!)).toBe('26.4');
  });

  it('with nothing in force (the owner, before publishing) a document still opens on the current release, never on an earlier edition', () => {
    const owner = buildRulesIndex({ ...data, versions: [ver('h9', '2024.12', 'in_review', { historical: true, edition_seq: 1 }), ver('cr', '26.4', 'in_review')], provisions: [] });
    expect(currentVersion(owner, 'd1')).toBeNull();
    expect(defaultVersion(owner, 'd1')?.id).toBe('cr');
    // only earlier editions readable (e.g. published as historical while the current release is still in review): the page opens on none of them
    const onlyHistory = buildRulesIndex({ ...data, versions: [ver('h9', '2024.12', 'superseded', { historical: true, edition_seq: 1 })], provisions: [] });
    expect(defaultVersion(onlyHistory, 'd1')).toBeNull();
    expect(currentVersion(onlyHistory, 'd1')).toBeNull();
  });

  it('rows from before historical editions existed (no historical field) still read as current', () => {
    const legacy = ver('lg', '26.4', 'published');
    delete (legacy as Partial<RuleVersion>).historical;
    expect(isCurrentText(legacy)).toBe(true);
  });

  it('compare never pairs a rule with another document that happens to use the same key', () => {
    const other: RuleDocument = { ...doc, id: 'd2', slug: 'other', name: 'Other body Duel Regulations', inventory_key: 'other/duel-regulations' };
    const withOther = buildRulesIndex({ ...data, documents: [doc, other], versions: [...versions, { ...ver('o1', '1.0', 'published'), ruleset_id: 'd2' }], provisions: [...data.provisions, prov('p-o1', 'o1', 'Another body’s rule with the same key.')] });
    expect(sameRuleElsewhere(withOther, withOther.provisionById.get('p-h1')!).map(e => e.version.id)).toEqual(['cur', 'old', 'h3', 'h2']);
  });

  it('compare names the OLDER side by what the versions are, not by how they are listed (withdrawn, in review, historical)', () => {
    const older = (a: RuleVersion, b: RuleVersion) => (chronoCompare(a, b) < 0 ? a.version : b.version);
    // a withdrawn earlier edition is still older than the next edition
    expect(older(ver('w', '26.1', 'withdrawn', { historical: true, edition_seq: 3, withdrawn_reason: 'x' }), ver('h', '2025.03', 'superseded', { historical: true, edition_seq: 2 }))).toBe('2025.03');
    // a withdrawn current version published after an older one is newer
    expect(older(ver('c', '26.4', 'withdrawn', { published_at: '2026-09-01T00:00:00Z', withdrawn_reason: 'x' }), ver('o', '26.2', 'superseded', { published_at: '2026-03-01T00:00:00Z' }))).toBe('26.2');
    // for the owner: the next version still in review is newer than the one in force
    expect(older(ver('n', '26.5', 'in_review'), ver('p', '26.4', 'published', { published_at: '2026-09-01T00:00:00Z' }))).toBe('26.4');
    // every historical edition is older than any current-release version
    expect(older(ver('cr', '26.4', 'in_review'), ver('hx', '26.2', 'superseded', { historical: true, edition_seq: 9 }))).toBe('26.2');
  });

  it('an earlier edition links to its own archived file, never to the current document (and no page anchor on a Drive file)', () => {
    const siteDoc = { ...doc, source_host: 'site_file' as const, official_url: 'https://example.org/current.pdf' };
    expect(officialLink(siteDoc, ver('h', '2024.06', 'superseded', { historical: true, edition_seq: 1, source_url: 'https://drive.google.com/file/d/abc/view' }), 4)).toBe('https://drive.google.com/file/d/abc/view');
    expect(officialLink(siteDoc, ver('h', '2024.06', 'superseded', { historical: true, edition_seq: 1, source_url: null }), 4)).toBeNull();
    expect(officialLink(siteDoc, ver('c', '26.4', 'published', { source_url: 'https://example.org/current.pdf' }), 4)).toBe('https://example.org/current.pdf#page=4');
  });
});
