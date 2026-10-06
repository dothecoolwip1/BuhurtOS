import { describe, expect, it } from 'vitest';
import { archiveFiles, checkDecisions, checkEditions, editionFile, isArchivePath, type ArchiveFile, type HistoryFile } from './history';

const files: ArchiveFile[] = [
  { path: 'Tournament/Archive/Duels Regulations V2024.12.pdf', sha256: 'a'.repeat(64), bytes: 1, archive: 'Tournament', drive_file_id: 'x1' },
  { path: 'Tournament/Archive/Duels Regulations V2024.12(1).pdf', sha256: 'a'.repeat(64), bytes: 1, archive: 'Tournament', drive_file_id: 'x2' },
  { path: 'Tournament/Archive/Duels Regulations 26.1.pdf', sha256: 'b'.repeat(64), bytes: 1, archive: 'Tournament', drive_file_id: 'x3' },
  { path: 'Marshal/Archive/Shields sheet.pdf', sha256: 'c'.repeat(64), bytes: 1, archive: 'Marshal', drive_file_id: 'x4' }
];
const base = (): HistoryFile => ({
  name: 't', governing_body: 'Buhurt International', current_release: '2026-10-06', source_drop: { dir: 'd', checksums: 'SHA256SUMS.txt', manifest: 'm.json' },
  editions: [
    { id: 'tournament/duel-regulations@2024.12', inventory_key: 'tournament/duel-regulations', files: [files[0].path, files[1].path], seq: 1, evidence: 'cover VER. 2024.12, change log December 2024' },
    { id: 'tournament/duel-regulations@26.1', inventory_key: 'tournament/duel-regulations', files: [files[2].path], seq: 2, evidence: 'cover VER. 26.1, change log January 2026' }
  ],
  same_as_current: [],
  held: [{ file: files[3].path, reason: 'one sheet of a chart, word for word page 2 of another file' }]
});
const current = new Map([['tournament/duel-regulations', '26.4']]);
const inventory = new Set(['tournament/duel-regulations', 'marshal/weapon-shield-chart']);

describe('historical editions: decisions are checked before any text is read', () => {
  it('a complete, consistent history passes (byte-identical copies are one edition; the unmatched file is held)', () => {
    expect(checkDecisions(base(), files, current, inventory)).toEqual([]);
  });
  it('every archive file must be accounted for', () => {
    const h = base(); h.held = [];
    expect(checkDecisions(h, files, current, inventory).join(' ')).toMatch(/Shields sheet\.pdf is not accounted for/);
  });
  it('byte-identical files can never become two editions', () => {
    const h = base();
    h.editions[0].files = [files[0].path];
    h.editions.push({ id: 'tournament/duel-regulations@2024.12b', inventory_key: 'tournament/duel-regulations', files: [files[1].path], seq: 3, evidence: 'same bytes as 2024.12, wrongly split' });
    expect(checkDecisions(h, files, current, inventory).join(' ')).toMatch(/byte-identical to a file of tournament\/duel-regulations@2024\.12/);
  });
  it('an edition may not reuse the label of the current version (it would collide with it)', () => {
    const h = base(); h.editions[1].id = 'tournament/duel-regulations@26.4';
    expect(checkDecisions(h, files, current, inventory).join(' ')).toMatch(/already has version 26\.4/);
  });
  it('a file is claimed once; order is unique per document; evidence and a real document are required; a held file needs a reason', () => {
    const h = base();
    h.editions[1].seq = 1;
    h.editions[1].files.push(files[0].path);
    h.held[0].reason = 'unclear';
    h.editions.push({ id: 'executive/unknown@1', inventory_key: 'executive/unknown', files: [], seq: 1, evidence: '' });
    const errs = checkDecisions(h, files, current, inventory).join(' | ');
    expect(errs).toMatch(/claimed twice/);
    expect(errs).toMatch(/seq 1 is not a unique positive order/);
    expect(errs).toMatch(/held .* say why/);
    expect(errs).toMatch(/not a document of the inventory/);
    expect(errs).toMatch(/say why \(evidence\)/);
  });
});

describe('historical editions: after structuring', () => {
  const ed = (id: string, content: string, extra: Partial<Parameters<typeof checkEditions>[0][number]> = {}) =>
    ({ id, inventory_key: id.split('@')[0], content_sha256: content, version: id.split('@')[1], confirmed: true, ok: true, file_contents: [], ...extra });
  const cur = new Map([['tournament/duel-regulations', { version: '26.4', content_sha256: 'cur' }]]);
  it('distinct, confirmed, reconciled editions pass', () => {
    expect(checkEditions([ed('tournament/duel-regulations@2024.12', 'x'), ed('tournament/duel-regulations@26.1', 'y')], cur)).toEqual([]);
  });
  it('the same text twice is one edition, not two; the same text as the current version is not an edition at all', () => {
    expect(checkEditions([ed('tournament/duel-regulations@2024.12', 'x'), ed('tournament/duel-regulations@2025.03', 'x')], cur).join(' ')).toMatch(/exactly the same text as tournament\/duel-regulations@2024\.12/);
    expect(checkEditions([ed('tournament/duel-regulations@26.1', 'cur')], cur).join(' ')).toMatch(/same text as the current version 26\.4/);
  });
  it('a second file of an edition must have the same text; the label must be confirmed and match the id', () => {
    const errs = checkEditions([ed('tournament/duel-regulations@26.1', 'y', { file_contents: [{ file: 'other.pdf', content_sha256: 'z' }], confirmed: false, version: '26.2' })], cur).join(' | ');
    expect(errs).toMatch(/other\.pdf has different text/);
    expect(errs).toMatch(/not confirmed/);
    expect(errs).toMatch(/the confirmed version is "26\.2"/);
  });
});

describe('archive files', () => {
  it('only Archive/ PDFs of the drop are archive files, grouped with their Drive ids', () => {
    const sums = ['a'.repeat(64) + '  d/Tournament/Archive/A.pdf', 'b'.repeat(64) + '  d/Tournament/Current.pdf', 'a'.repeat(64) + '  d/Tournament/Archive/A(1).pdf'].join('\n');
    const out = archiveFiles('d', sums, { files: [{ repo_path: 'd/Tournament/Archive/A.pdf', drive_file_id: 'id1', committee: 'Tournament' }] });
    expect(out.map(f => f.path).sort()).toEqual(['Tournament/Archive/A(1).pdf', 'Tournament/Archive/A.pdf']);
    expect(out.find(f => f.path === 'Tournament/Archive/A.pdf')!.drive_file_id).toBe('id1');
    expect(isArchivePath('Tournament/Current.pdf')).toBe(false);
    expect(editionFile('marshal/weapon-shield-chart@2024.12.13')).toBe('marshal__weapon-shield-chart@2024.12.13');
  });
});

describe('the committed Buhurt International history reproduces exactly', () => {
  it('re-structuring every edition from its committed text and overrides gives the committed provisions and content hash', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { structureDocument } = await import('./structure');
    const { applyOverrides, versionContentSha } = await import('./release');
    const dir = 'rules-library/buhurt-international/history/archive-2026-10-06';
    const h = JSON.parse(readFileSync(`${dir}/history.json`, 'utf8')) as HistoryFile;
    const shaOf = new Map((JSON.parse(readFileSync(`${dir}/files.json`, 'utf8')) as { files: ArchiveFile[] }).files.map(f => [f.path, f.sha256]));
    expect(readdirSync(`${dir}/structured`).filter(f => f.endsWith('.json')).length).toBe(h.editions.length);
    for (const e of h.editions) {
      const committed = JSON.parse(readFileSync(`${dir}/structured/${editionFile(e.id)}.json`, 'utf8'));
      const text = JSON.parse(readFileSync(`${dir}/text/${shaOf.get(e.files[0])!.slice(0, 12)}.json`, 'utf8'));
      const o = JSON.parse(readFileSync(`${dir}/overrides/${editionFile(e.id)}.json`, 'utf8'));
      const again = applyOverrides(structureDocument(text.pages, e.inventory_key.split('/').pop()!, o.noise ?? {}, o.ocr ?? {}, o.layout ?? {}).provisions, o);
      expect(again, e.id).toEqual(committed.provisions);
      expect(versionContentSha(again), e.id).toBe(committed.version.content_sha256);
      expect(committed.version.historical).toBe(true);
    }
  });
});
