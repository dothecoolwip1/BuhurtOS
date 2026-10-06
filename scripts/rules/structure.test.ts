import { describe, expect, it } from 'vitest';
import { contentSha256, crossRefs, detectDate, detectVersion, joinBody, renderTable, structureDocument, type SourcePage } from './structure';
import { reconcileDocument, reconcileRelease } from './reconcile';

// An invented document. It is NOT Buhurt International text: it only has the shapes real rulebooks have (title page, headers/footers, numbered
// sections with titles, wrapped paragraphs, bullets, a skipped number, a stray number in the text, a table, an appendix and an image-only page).
const P1 = `EXAMPLE BODY · EXAMPLE RULES                         V.1.2
Effective 03.02.2026

These example rules exist only to test the BuhurtOS importer.

1. General
1.1 Scope
These rules apply to every example bout held under the
example body, including finals.
1.2 Definitions
A grounded fighter is one who touches the ground with
any part other than the feet.
Page 1 of 4`;
const P2 = `EXAMPLE BODY · EXAMPLE RULES                         V.1.2
2. Fouls
2.1 Prohibited targets
Strikes to the back of the knee are prohibited (see 1.2).
• strikes to the neck
• strikes to the feet
2.3 Penalties
A foul results in a warning.
2.3.1 Repeated fouls lead to a card as described in rule 2.1.
Page 2 of 4`;
const P3 = `EXAMPLE BODY · EXAMPLE RULES                         V.1.2
3.4 points are not a heading here because they do not fit
Zone      Points      Notes
Head      2           Helmet only
Arm       1           Below the shoulder
Appendix A Example chart
1. Chart rows
The chart lists weapons.
Page 3 of 4`;
const P4 = `Page 4 of 4`;
const PAGES = [P1, P2, P3, P4].map((text, i) => ({ page: i + 1, text }));

describe('rule document structuring', () => {
  const r = structureDocument(PAGES, 'example-rules');
  const by = (n: string) => r.provisions.find(p => p.number === n)!;

  it('finds numbered sections and rules with titles, parents, pages and stable keys', () => {
    expect(r.provisions.map(p => p.number)).toEqual([null, '1', '1.1', '1.2', '2', '2.1', '2.3', '2.3.1', 'Appendix A', '1', null]);
    expect(by('1.1')).toMatchObject({ title: 'Scope', parent_key: 'example-rules:1', depth: 1, kind: 'rule', page_from: 1, page_to: 1, stable_key: 'example-rules:1.1' });
    expect(by('1.1').body).toBe('These rules apply to every example bout held under the example body, including finals.');
    expect(by('2').kind).toBe('section');
    expect(by('2.3.1')).toMatchObject({ parent_key: 'example-rules:2.3', title: null, depth: 2 });
    expect(by('2.3.1').body).toMatch(/^Repeated fouls lead to a card as described in rule 2\.1\.\n3\.4 points/);
  });
  it('keeps bullets on their own lines and records cross references', () => {
    expect(by('2.1').body).toBe('Strikes to the back of the knee are prohibited (see 1.2).\n• strikes to the neck\n• strikes to the feet');
    expect(by('2.1').cross_refs).toEqual(['1.2']);
    expect(by('2.3.1').cross_refs).toEqual(['2.1']);
  });
  it('flags a skipped number, a table, text before the first heading and an unreadable page; never drops them', () => {
    expect(by('2.3').review_status).toBe('needs_review');
    expect(by('2.3').review_note).toMatch(/skips to 2\.3 \(expected 2\.2\)/);
    // Text before the first heading is kept as a note (here the cover); it is only flagged when it holds numbered lines.
    const pre = r.provisions[0];
    expect(pre).toMatchObject({ kind: 'note', topics: ['cover'], review_status: 'extracted' });
    expect(pre.body).toContain('These example rules exist only to test');
    // "3.4 points ..." does not follow 2.3.1, so it stays in the text and is listed
    expect(r.rejected_numbers.map(x => x.text)).toEqual(['3.4 points are not a heading here because they do not fit']);
    expect(by('2.3.1').body).toContain('3.4 points are not a heading');
    expect(by('2.3.1').review_note).toMatch(/table/);
    const fig = r.provisions[r.provisions.length - 1];
    expect(fig).toMatchObject({ kind: 'figure', page_from: 4, review_status: 'needs_review' });
    expect(r.empty_pages).toEqual([4]);
  });
  it('scopes appendix numbers so they never collide with the main text', () => {
    const app = by('Appendix A');
    expect(app).toMatchObject({ kind: 'appendix', title: 'Example chart', stable_key: 'example-rules:appendix-a' });
    const row = r.provisions.find(p => p.stable_key === 'example-rules:appendix-a-1')!;
    expect(row).toMatchObject({ number: '1', title: 'Chart rows', parent_key: 'example-rules:appendix-a', depth: 1 });
    expect(new Set(r.provisions.map(p => p.stable_key)).size).toBe(r.provisions.length);
  });
  it('removes repeated headers and page numbers as furniture, and accounts for every line', () => {
    expect(r.furniture.map(f => f.text.trim())).toEqual(expect.arrayContaining(['Page 1 of 4', 'Page 4 of 4']));
    expect(r.furniture.filter(f => f.reason.startsWith('repeated')).length).toBe(3);
    const rec = reconcileDocument({ result: r, provisions: r.provisions, pages: 4, versionConfirmed: true });
    expect(rec.errors).toEqual([]);
    expect(rec.ok).toBe(true);
    expect(rec.unaccounted_lines).toEqual([]);
    expect(rec.char_coverage).toBeGreaterThan(0.99);
    expect(rec.needs_review).toBe(3);
  });
  it('detects the printed version and date for a person to confirm', () => {
    expect(r.detected).toEqual({ version: '1.2', date: '2026-02-03' });
    expect(detectVersion('Buhurt Rules V.26.4.1')).toBe('26.4.1');
    expect(detectVersion('Version 2026.1')).toBe('2026.1');
    expect(detectDate('January 15, 2026')).toBe('2026-01-15');
    expect(detectDate('15th March 2026')).toBe('2026-03-15');
    expect(detectDate('no date')).toBeNull();
  });
  it('content checksums match the database definition', () => {
    // private.rule_content_sha256('1.1', 'Scope', 'x') in the database gives the same value (checked by pack22_gate.sql)
    expect(contentSha256('1.1', 'Scope', 'x')).toBe('b70459113bd2ed72120fc1397b22cdbaae2259e1c96595bedc26ebbe41012898');
    expect(contentSha256(null, null, '')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('joins wrapped lines but not sentences, bullets or list letters', () => {
    expect(joinBody(['A fighter must', 'hold a weapon.', 'Next sentence.'])).toBe('A fighter must hold a weapon.\nNext sentence.');
    expect(joinBody(['Options:', 'a) one', 'b) two'])).toBe('Options:\na) one\nb) two');
    expect(crossRefs('See § 6 and section 4.10; not 2024.', '4.10')).toEqual(['6']);
  });
});

describe('reconciliation catches what an import must never do', () => {
  const r = structureDocument(PAGES, 'example-rules');
  it('refuses lost text, added text, duplicated lines and an unconfirmed version', () => {
    const lost = r.provisions.map(p => (p.number === '2.1' ? { ...p, lines: p.lines.slice(0, 1), body: p.body.split('\n')[0] } : p));
    const a = reconcileDocument({ result: r, provisions: lost, pages: 4, versionConfirmed: true });
    expect(a.ok).toBe(false);
    expect(a.errors.join(' ')).toMatch(/3 source line\(s\) are in no provision/);
    const added = r.provisions.map(p => (p.number === '1.1' ? { ...p, body: p.body + ' And an invented extra sentence.' } : p));
    expect(reconcileDocument({ result: r, provisions: added, pages: 4, versionConfirmed: true }).errors.join(' ')).toMatch(/more characters than the source/);
    const twice = r.provisions.map(p => (p.number === '1.2' ? { ...p, lines: [...p.lines, r.provisions[2].lines[0]] } : p));
    expect(reconcileDocument({ result: r, provisions: twice, pages: 4, versionConfirmed: true }).errors.join(' ')).toMatch(/more than one provision/);
    expect(reconcileDocument({ result: r, provisions: r.provisions, pages: 4, versionConfirmed: false }).errors.join(' ')).toMatch(/not been confirmed/);
    expect(reconcileDocument({ result: r, provisions: r.provisions, pages: 4, versionConfirmed: true, sourceSha256: 'a'.repeat(64), fetchedSha256: 'b'.repeat(64) }).ok).toBe(false);
  });
  it('accounts for every inventory document at release level', () => {
    const inventory = [{ key: 'm/buhurt-rules', host: 'drive_file' }, { key: 'm/duels-rules', host: 'drive_file' }, { key: 'm/archives', host: 'drive_folder' }, { key: 'x/chart', host: 'drive_file' }];
    const ok = reconcileRelease({ inventory, imported: [{ key: 'm/buhurt-rules', sha256: 'a', ok: true }, { key: 'm/duels-rules', sha256: 'b', ok: true }], excluded: [{ key: 'x/chart', reason: 'image-only chart: linked, not transcribed' }] });
    expect(ok.ok).toBe(true);
    expect(ok.excluded.map(e => e.key)).toEqual(['x/chart', 'm/archives']);
    const missing = reconcileRelease({ inventory, imported: [{ key: 'm/buhurt-rules', sha256: 'a', ok: true }], excluded: [] });
    expect(missing.ok).toBe(false);
    expect(missing.missing).toEqual(['m/duels-rules', 'x/chart']);
    const dup = reconcileRelease({ inventory, imported: [{ key: 'm/buhurt-rules', sha256: 'a', ok: true }, { key: 'm/duels-rules', sha256: 'a', ok: true }], excluded: [{ key: 'x/chart', reason: 'too short' }] });
    expect(dup.errors.join(' ')).toMatch(/same file is imported under more than one document/);
    expect(dup.errors.join(' ')).toMatch(/real reason/);
    expect(reconcileRelease({ inventory, imported: [{ key: 'nope', sha256: null, ok: true }], excluded: [] }).unknown).toEqual(['nope']);
  });
});

describe('the committed example releases are reproducible from their own files', () => {
  it('re-running structure on the committed text and overrides gives exactly the committed provisions and checksums', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { applyOverrides, versionContentSha } = await import('./release');
    // The invented example body and the real Buhurt International release (its OCR corrections, picture text, tables and reviews included).
    for (const rel of ['_example-body/releases/r1', '_example-body/releases/r2', 'buhurt-international/releases/2026-10-06']) {
      const dir = `rules-library/${rel}`;
      for (const f of readdirSync(`${dir}/structured`)) {
        const committed = JSON.parse(readFileSync(`${dir}/structured/${f}`, 'utf8'));
        const text = JSON.parse(readFileSync(`${dir}/text/${f}`, 'utf8'));
        const o = JSON.parse(readFileSync(`${dir}/overrides/${f}`, 'utf8'));
        const again = applyOverrides(structureDocument(text.pages, committed.inventory_key.split('/').pop(), o.noise ?? {}, o.ocr ?? {}, o.layout ?? {}).provisions, o);
        expect(again, `${rel}/${f}`).toEqual(committed.provisions);
        expect(versionContentSha(again)).toBe(committed.version.content_sha256);
        expect(committed.version.source_sha256).toBe(text.sha256);
      }
    }
  });
});

describe('reviewed layout: tables, unnumbered headings, OCR corrections and picture text', () => {
  const page = (text: string, extra: Partial<SourcePage> = {}): SourcePage => ({ page: 1, text, ...extra });
  const DOC = [page(`1. Weights
1.1 Categories
The categories are:
                 Men          Women
 Light           < 75 kg      < 60 kg
 Heavy           > 75 kg
Competitors   who   deviate   from   these   styles   must   ask.`)];
  const table = { replaces: ['1:3', '1:4', '1:5'], rows: [['', 'Men', 'Women'], ['Light', '< 75 kg', '< 60 kg'], ['Heavy', '> 75 kg', '']], note: 'transcribed' };
  it('replaces the transcribed lines by a table that holds exactly their words', () => {
    const r = structureDocument(DOC, 'w', {}, {}, { tables: [table] });
    const p = r.provisions.find(x => x.number === '1.1')!;
    expect(p.body).toBe('The categories are:\n\n|  | Men | Women |\n| --- | --- | --- |\n| Light | < 75 kg | < 60 kg |\n| Heavy | > 75 kg |  |\n\nCompetitors who deviate from these styles must ask.');
    // justified prose with wide gaps is not a table; the transcribed table is no longer flagged
    expect(p.review_status).toBe('extracted');
    const rec = reconcileDocument({ result: r, provisions: r.provisions, pages: 1, versionConfirmed: true });
    // nothing unaccounted and nothing added (the tiny document's only missing characters are the headings' printed dots)
    expect(rec.unaccounted_lines).toEqual([]);
    expect(rec.errors.join(' ')).not.toMatch(/more characters|in no provision|more than one/);
    expect(rec.char_coverage).toBeGreaterThan(0.95);
  });
  it('refuses a table that adds, drops or changes a word', () => {
    expect(() => structureDocument(DOC, 'w', {}, {}, { tables: [{ ...table, rows: [...table.rows, ['Ultra', '> 115 kg', '']] }] })).toThrow(/not in source: .*Ultra/);
    expect(() => structureDocument(DOC, 'w', {}, {}, { tables: [{ ...table, rows: table.rows.slice(0, 2) }] })).toThrow(/missing: .*Heavy/);
    expect(() => structureDocument(DOC, 'w', {}, {}, { tables: [{ ...table, replaces: ['1:3', '1:4', '1:9'] }] })).toThrow(/not all in one provision|no provision holds/);
  });
  it('renders merged cells and paragraphs inside cells as layout marks, and a table without a heading row', () => {
    expect(renderTable({ replaces: [], note: '', rows: [['A', 'B'], ['x<br>y', '^']], header_rows: 0 })).toEqual(['| A | B |', '| x<br>y | ^ |']);
  });
  it('starts a provision at a reviewed unnumbered heading, keyed by its words', () => {
    const r = structureDocument([page('CHART\nBladed Weapons (Sword)   Weight\nType 1   1.1 - 1.7\nOther Restrictions\nNo thrusting.')], 'chart', {}, {}, {
      headings: { '1:0': { title: 'CHART' }, '1:1': { title: 'Bladed Weapons (Sword)' }, '1:3': { title: 'Other Restrictions' } },
      tables: [{ replaces: ['1:1', '1:2'], rows: [['', 'Weight'], ['Type 1', '1.1 - 1.7']], note: 't' }]
    });
    expect(r.provisions.map(p => [p.stable_key, p.kind, p.number])).toEqual([['chart:chart', 'section', null], ['chart:bladed-weapons-sword', 'table', null], ['chart:other-restrictions', 'section', null]]);
    expect(() => structureDocument([page('CHART')], 'c', {}, {}, { headings: { '1:0': { title: 'TABLE' } } })).toThrow(/does not start with/);
  });
  const OCR = [page('1. Rules\n● be 13cm tall\nVEE £088 WINE\nDecember-2024: Sadd', {
    method: 'ocr', ocr_lines: [
      { text: '1. Rules', conf_mean: 96, conf_min: 95, words: 2, uncertain: [] },
      { text: '● be 13cm tall', conf_mean: 80, conf_min: 50, words: 4, uncertain: ['13cm'] },
      { text: 'VEE £088 WINE', conf_mean: 37, conf_min: 16, words: 3, uncertain: ['VEE', 'WINE'], in_picture: 'lettering 10px tall' },
      { text: 'December-2024: Sadd', conf_mean: 63, conf_min: 33, words: 2, uncertain: ['Sadd'] }
    ]
  })];
  it('sets picture lettering aside as furniture and flags uncertain OCR words', () => {
    const r = structureDocument(OCR, 'o');
    expect(r.furniture.map(f => [f.id, f.reason])).toEqual([['1:2', 'OCR: text inside a picture (lettering 10px tall)']]);
    expect(r.provisions[0].review_note).toMatch(/OCR could not read some words with confidence: 13cm, Sadd/);
  });
  it('applies reviewed OCR corrections only where the recorded reading still matches, and reports them', () => {
    const r = structureDocument(OCR, 'o', {}, { fix: { '1:1': { from: '● be 13cm tall', to: '● be 13 cm tall', reason: 'image' }, '1:3': { from: 'December-2024: Sadd', to: 'December-2024: -add', reason: 'image' } }, insert: [{ after: '1:3', text: 'Document created', reason: 'missed' }] });
    expect(r.provisions[0].body).toContain('● be 13 cm tall');
    expect(r.provisions[0].body).toContain('December-2024: -add Document created');
    expect(r.provisions[0].review_status).toBe('extracted');
    expect(r.provisions[0].review_note).toMatch(/includes OCR corrections checked against the page image/);
    expect(r.ocr_corrections.map(c => c.id)).toEqual(['1:1', '1:3', '1:3+1']);
    expect(() => structureDocument(OCR, 'o', {}, { fix: { '1:1': { from: 'something else', to: 'x', reason: '' } } })).toThrow(/now reads/);
    expect(() => structureDocument(DOC, 'o', {}, { fix: { '1:1': { from: '1.1 Categories', to: 'x', reason: '' } } })).toThrow(/no such OCR line/);
  });

  it('a verified review counts only for the exact text it checked (content_sha256 required and matching)', async () => {
    const { applyOverrides } = await import('./release');
    const [p] = structureDocument(DOC, 'o', {}, {}).provisions.filter(x => x.number === '1.1');
    const status = (review: Record<string, unknown>) => applyOverrides([p], { review: { [p.stable_key]: review } } as never)[0].review_status;
    expect(status({ status: 'verified', note: 'checked', content_sha256: p.content_sha256 })).toBe('verified');
    expect(status({ status: 'verified', note: 'checked' })).toBe('needs_review');
    expect(status({ status: 'verified', note: 'checked', content_sha256: 'f'.repeat(64) })).toBe('needs_review');
  });
});
