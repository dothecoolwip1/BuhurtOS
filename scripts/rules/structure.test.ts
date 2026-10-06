import { describe, expect, it } from 'vitest';
import { contentSha256, crossRefs, detectDate, detectVersion, joinBody, structureDocument } from './structure';
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
    const pre = r.provisions[0];
    expect(pre.kind).toBe('unstructured');
    expect(pre.review_status).toBe('needs_review');
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
    expect(rec.needs_review).toBe(4);
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
    for (const rel of ['r1', 'r2']) {
      const dir = `rules-library/_example-body/releases/${rel}`;
      for (const f of readdirSync(`${dir}/structured`)) {
        const committed = JSON.parse(readFileSync(`${dir}/structured/${f}`, 'utf8'));
        const text = JSON.parse(readFileSync(`${dir}/text/${f}`, 'utf8'));
        const o = JSON.parse(readFileSync(`${dir}/overrides/${f}`, 'utf8'));
        const again = applyOverrides(structureDocument(text.pages, committed.inventory_key.split('/').pop()).provisions, o);
        expect(again, `${rel}/${f}`).toEqual(committed.provisions);
        expect(versionContentSha(again)).toBe(committed.version.content_sha256);
        expect(committed.version.source_sha256).toBe(text.sha256);
      }
    }
  });
});
