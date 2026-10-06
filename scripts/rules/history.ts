/**
 * Pack 22: HISTORICAL editions of a governing body's documents (earlier versions found in its archive folders). A separate workflow from the current
 * release (release.ts), so the current release's safeguards stay as they are: nothing here can create, change or publish a current version.
 *
 *   node scripts/rules/history.ts files     <body-dir> <name>              every archive file of the source drop, by SHA-256 (byte-identical copies grouped)
 *   node scripts/rules/history.ts extract   <body-dir> <name> [sha12...]  text of each UNIQUE file (once per SHA-256), OCR only where a page has no text
 *   node scripts/rules/history.ts structure <body-dir> <name>              provisions + per-edition reconciliation, for every edition in history.json
 *   node scripts/rules/history.ts reconcile <body-dir> <name>              every archive file accounted for, editions consistent, nothing collides with current
 *   node scripts/rules/history.ts sql       <body-dir> <name> <out.sql>   the migration that loads the editions as HISTORICAL versions in review
 *
 * A history lives in <body-dir>/history/<name>/:
 *   history.json          a person's decisions, each with its evidence: which logical document every archive file belongs to, which files are the
 *                         same edition, the edition order, files held back (not matched) and files that are the current edition again
 *   files.json            GENERATED: the archive files by SHA-256
 *   text/<sha12>.json     GENERATED: extracted text of one unique file
 *   overrides/<id>.json   a person's review of one edition (version label as printed, OCR fixes, tables, review notes), as in a release
 *   structured/<id>.json  GENERATED: provisions of one edition
 *   reconciliation.json / .md  GENERATED
 * Stable keys use the document's own series ("duel-regulations:4.3"), the same as the current version, so the same rule lines up across versions.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { structureDocument, type Provision, type SourcePage } from './structure.ts';
import { reconcileDocument } from './reconcile.ts';
import { applyOverrides, dollarQuote, extractPdf, fileKey, pdftotextVersion, versionContentSha, type Overrides } from './release.ts';

export interface ArchiveFile { path: string; sha256: string; bytes: number; archive: string; drive_file_id: string | null }
export interface Edition {
  /** "<inventory key>@<version as printed>" */
  id: string;
  inventory_key: string;
  /** Archive files (paths in the source drop) that ARE this edition. The first is read; the others must be byte-identical or have the same content. */
  files: string[];
  /** 1 = oldest edition of the document in this history. The current release's version is newer than every edition. */
  seq: number;
  /** Why this file is this document, and why this order: titles, cover, footers, change log entries, dates as printed. */
  evidence: string;
}
export interface HistoryFile {
  name: string; governing_body: string; current_release: string;
  source_drop: { dir: string; checksums: string; manifest: string };
  editions: Edition[];
  /** Archive files that are the CURRENT edition again (same version and same text as the current release): provenance only, not imported. */
  same_as_current: { file: string; inventory_key: string; evidence: string }[];
  /** Archive files that could not be matched with confidence: held for a person, not imported. */
  held: { file: string; reason: string }[];
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
/** File name of an edition: "tournament__duel-regulations@V2024.12". */
export const editionFile = (id: string) => fileKey(id).replace(/[^A-Za-z0-9_.@-]/g, '_');
/** The edition's own archived file (its Drive copy), never the current document's link; null when the file has no Drive id. */
export const archiveLink = (driveFileId: string | null) => (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null);
export const isArchivePath = (p: string) => /^[^/]+\/Archive\/[^/]+\.pdf$/i.test(p);

/** The archive files of a source drop, from its SHA256SUMS and fetch manifest, grouped by content (byte-identical copies together). */
export function archiveFiles(dropDir: string, sums: string, manifest: { files: { repo_path?: string; drive_file_id?: string; committee: string }[] }): ArchiveFile[] {
  const byPath = new Map(manifest.files.filter(f => f.repo_path).map(f => [f.repo_path!.replace(`${dropDir}/`, ''), f]));
  return sums.trim().split('\n').map(l => { const [h, ...p] = l.split('  '); return { sha256: h, path: p.join('  ').replace(`${dropDir}/`, '') }; })
    .filter(x => isArchivePath(x.path))
    .map(x => ({ ...x, bytes: 0, archive: x.path.split('/')[0], drive_file_id: byPath.get(x.path)?.drive_file_id ?? null }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Release-like checks over the decisions in history.json, before any text is read. Returns the errors (empty = fine). */
export function checkDecisions(h: HistoryFile, files: ArchiveFile[], currentLabels: Map<string, string>, inventoryKeys: Set<string>): string[] {
  const errors: string[] = [];
  const shaOf = new Map(files.map(f => [f.path, f.sha256]));
  const seen = new Map<string, string>();
  const claim = (file: string, by: string) => {
    if (!shaOf.has(file)) errors.push(`${by}: ${file} is not an archive file of the source drop`);
    if (seen.has(file)) errors.push(`${file} is claimed twice (${seen.get(file)} and ${by})`);
    seen.set(file, by);
  };
  for (const e of h.editions) {
    const label = e.id.split('@')[1];
    if (!e.id.startsWith(`${e.inventory_key}@`) || !label) errors.push(`${e.id}: the id is "<inventory key>@<version>"`);
    if (!inventoryKeys.has(e.inventory_key)) errors.push(`${e.id}: ${e.inventory_key} is not a document of the inventory`);
    if (!e.files.length) errors.push(`${e.id}: no file`);
    if (!e.evidence || e.evidence.length < 20) errors.push(`${e.id}: say why (evidence)`);
    if (currentLabels.get(e.inventory_key) === label) errors.push(`${e.id}: the current release already has version ${label} of this document`);
    for (const f of e.files) claim(f, e.id);
  }
  for (const s of h.same_as_current) { claim(s.file, `same_as_current ${s.inventory_key}`); if (!currentLabels.has(s.inventory_key)) errors.push(`same_as_current ${s.file}: ${s.inventory_key} has no current version`); }
  for (const x of h.held) { claim(x.file, 'held'); if (!x.reason || x.reason.length < 20) errors.push(`held ${x.file}: say why`); }
  for (const f of files) if (!seen.has(f.path)) errors.push(`${f.path} is not accounted for (an edition, the current edition again, or held with a reason)`);
  // Byte-identical files are one edition, never two.
  const editionOfSha = new Map<string, string>();
  for (const e of h.editions) for (const f of e.files) {
    const s = shaOf.get(f); if (!s) continue;
    if (editionOfSha.has(s) && editionOfSha.get(s) !== e.id) errors.push(`${f} is byte-identical to a file of ${editionOfSha.get(s)} but is listed under ${e.id}`);
    editionOfSha.set(s, e.id);
  }
  const ids = new Set<string>();
  const seqs = new Map<string, Set<number>>();
  for (const e of h.editions) {
    if (ids.has(e.id)) errors.push(`${e.id} is listed twice`); ids.add(e.id);
    const s = seqs.get(e.inventory_key) ?? new Set(); if (s.has(e.seq) || !Number.isInteger(e.seq) || e.seq < 1) errors.push(`${e.id}: seq ${e.seq} is not a unique positive order within ${e.inventory_key}`); s.add(e.seq); seqs.set(e.inventory_key, s);
  }
  return errors;
}

/** Per-history checks after structuring: one content per edition, no two editions alike, none equal to the current version. */
export function checkEditions(eds: { id: string; inventory_key: string; content_sha256: string; version: string; confirmed: boolean; ok: boolean; file_contents: { file: string; content_sha256: string }[] }[],
  current: Map<string, { version: string; content_sha256: string }>): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const e of eds) {
    if (!e.ok) errors.push(`${e.id}: the edition does not reconcile`);
    if (!e.confirmed) errors.push(`${e.id}: the version label is not confirmed against the document`);
    if (`${e.inventory_key}@${e.version}` !== e.id) errors.push(`${e.id}: the confirmed version is "${e.version}"; the id must say the same`);
    for (const f of e.file_contents) if (f.content_sha256 !== e.content_sha256) errors.push(`${e.id}: ${f.file} has different text from the edition's first file: it is not the same edition`);
    const k = `${e.inventory_key}|${e.content_sha256}`;
    if (seen.has(k)) errors.push(`${e.id} has exactly the same text as ${seen.get(k)}: one edition, not two`); seen.set(k, e.id);
    const cur = current.get(e.inventory_key);
    if (cur && cur.content_sha256 === e.content_sha256) errors.push(`${e.id} has exactly the same text as the current version ${cur.version}: list its file under same_as_current`);
  }
  return errors;
}

function main(argv: string[]) {
  const [cmd, bodyDir, name, ...rest] = argv;
  if (!cmd || !bodyDir || !name) { console.error('usage: history.ts <files|extract|structure|reconcile|sql> <body-dir> <name> ...'); process.exit(2); }
  const dir = join(bodyDir, 'history', name);
  const h = readJson<HistoryFile>(join(dir, 'history.json'));
  for (const sub of ['text', 'structured', 'overrides']) mkdirSync(join(dir, sub), { recursive: true });
  const drop = h.source_drop;
  const manifest = readJson<{ files: { repo_path?: string; drive_file_id?: string; committee: string }[] }>(join(drop.dir, drop.manifest));
  const files = archiveFiles(drop.dir, readFileSync(join(drop.dir, drop.checksums), 'utf8'), manifest);
  const fileByPath = new Map(files.map(f => [f.path, f]));
  const inv = readJson<{ documents: { key: string; label: string; url: string; host: string }[] }>(join(bodyDir, 'source-inventory.json'));
  const curDir = join(bodyDir, 'releases', h.current_release, 'structured');
  const current = new Map(readdirSync(curDir).filter(f => f.endsWith('.json')).map(f => {
    const x = readJson<{ inventory_key: string; version: { version: string; content_sha256: string } }>(join(curDir, f));
    return [x.inventory_key, { version: x.version.version, content_sha256: x.version.content_sha256 }] as const;
  }));
  const textPath = (sha: string) => join(dir, 'text', `${sha.slice(0, 12)}.json`);

  if (cmd === 'files') {
    for (const f of files) {
      const real = sha256File(join(drop.dir, f.path));
      if (real !== f.sha256) { console.error(`CHECKSUM ${f.path} does not match ${drop.checksums}`); process.exitCode = 1; }
      f.bytes = readFileSync(join(drop.dir, f.path)).length;
    }
    const groups = new Map<string, string[]>();
    for (const f of files) groups.set(f.sha256, [...(groups.get(f.sha256) ?? []), f.path]);
    writeJson(join(dir, 'files.json'), { files, unique: groups.size, byte_identical: [...groups.values()].filter(g => g.length > 1) });
    console.log(`${files.length} archive files, ${groups.size} unique by SHA-256; byte-identical groups: ${[...groups.values()].filter(g => g.length > 1).length}`);
    return;
  }

  if (cmd === 'extract') {
    const only = new Set(rest);
    const ver = pdftotextVersion();
    const unique = [...new Map(files.map(f => [f.sha256, f])).values()];
    for (const f of unique) {
      if (only.size && !only.has(f.sha256.slice(0, 12))) continue;
      const src = join(drop.dir, f.path);
      const { pages, pageCount, field, extractor, ocrUsed } = extractPdf(src, ver);
      writeJson(textPath(f.sha256), {
        sha256: sha256File(src), files: files.filter(x => x.sha256 === f.sha256).map(x => x.path), extractor,
        pdfinfo: { pages: pageCount, title: field('Title'), creator: field('Creator'), producer: field('Producer'), created: field('CreationDate'), modified: field('ModDate') }, pages
      });
      console.log(`ok   ${f.sha256.slice(0, 12)} ${f.path}: ${pages.length} pages${ocrUsed ? `, OCR on ${pages.filter(p => p.method === 'ocr').length}` : ''}`);
    }
    return;
  }

  const decisionErrors = () => checkDecisions(h, files, new Map([...current].map(([k, v]) => [k, v.version])), new Set(inv.documents.map(d => d.key)));
  type Text = { sha256: string; extractor: string; pdfinfo: { pages: number; title: string | null }; pages: SourcePage[] };
  const structureOne = (e: Edition, t: Text, o: Overrides) => {
    const series = e.inventory_key.split('/').pop()!;
    const result = structureDocument(t.pages, series, o.noise ?? {}, o.ocr ?? {}, o.layout ?? {});
    const provisions = applyOverrides(result.provisions, o);
    return { result, provisions, content: versionContentSha(provisions) };
  };

  if (cmd === 'structure') {
    const errs = decisionErrors();
    if (errs.length) { for (const e of errs) console.error(`DECISION ${e}`); process.exit(1); }
    for (const e of h.editions) {
      const first = fileByPath.get(e.files[0])!;
      if (!existsSync(textPath(first.sha256))) { console.error(`MISSING text for ${e.files[0]}: extract it first`); process.exitCode = 1; continue; }
      const t = readJson<Text>(textPath(first.sha256));
      const op = join(dir, 'overrides', `${editionFile(e.id)}.json`);
      const o: Overrides = existsSync(op) ? readJson(op) : {};
      const { result, provisions, content } = structureOne(e, t, o);
      const rec = reconcileDocument({ result, provisions, pages: t.pdfinfo.pages, textFixes: result.ocr_corrections.length, ocrLines: t.pages.filter(pg => pg.method === 'ocr').reduce((n, pg) => n + (pg.ocr_lines?.length ?? 0), 0), versionConfirmed: !!(o.version && o.version_confirmed_by), sourceSha256: t.sha256, fetchedSha256: first.sha256 });
      // the other files of the edition: byte-identical (provenance only), or read and compared word for word with the same overrides
      const fileContents = e.files.slice(1).map(p => {
        const f = fileByPath.get(p)!;
        if (f.sha256 === first.sha256) return { file: p, content_sha256: content, same_bytes: true };
        if (!existsSync(textPath(f.sha256))) return { file: p, content_sha256: 'not extracted', same_bytes: false };
        return { file: p, content_sha256: structureOne(e, readJson<Text>(textPath(f.sha256)), o).content, same_bytes: false };
      });
      if (!existsSync(op)) writeJson(op, { version: result.detected.version, published_on: null, version_confirmed_by: null, confirmed_on: null, review: {}, keywords: {}, topics: {} });
      const d = inv.documents.find(x => x.key === e.inventory_key)!;
      writeJson(join(dir, 'structured', `${editionFile(e.id)}.json`), {
        edition: e.id, inventory_key: e.inventory_key, seq: e.seq,
        version: {
          version: o.version ?? result.detected.version ?? 'unconfirmed', title: o.title ?? t.pdfinfo.title ?? d.label, published_on: o.published_on ?? null, effective_from: o.effective_from ?? null,
          note: o.note ?? null, source_url: archiveLink(first.drive_file_id), source_sha256: t.sha256, retrieved_at: null, page_count: t.pdfinfo.pages, extractor: t.extractor,
          content_sha256: content, detected: result.detected, confirmed_by: o.version_confirmed_by ?? null,
          historical: true, edition_seq: e.seq, edition_evidence: e.evidence.slice(0, 1000),
          source_files: e.files.map(p => { const f = fileByPath.get(p)!; return { file: p, archive: f.archive, sha256: f.sha256, drive_file_id: f.drive_file_id }; }),
          reconciliation: { ...rec, unaccounted_lines: rec.unaccounted_lines.slice(0, 50), double_assigned_lines: rec.double_assigned_lines.slice(0, 50) }
        },
        file_contents: fileContents,
        provisions, furniture: result.furniture, rejected_numbers: result.rejected_numbers, ocr_corrections: result.ocr_corrections
      });
      console.log(`${rec.ok ? 'ok  ' : 'FAIL'} ${e.id}: ${provisions.length} provisions, ${rec.needs_review} to review, coverage ${(rec.char_coverage * 100).toFixed(2)}%${rec.errors.length ? ' · ' + rec.errors.join(' · ') : ''}`);
      if (!rec.ok) process.exitCode = 1;
    }
    return;
  }

  type Structured = { edition: string; inventory_key: string; seq: number; version: { version: string; confirmed_by: string | null; content_sha256: string; source_sha256: string; page_count: number; extractor: string; source_files: { file: string }[];
    reconciliation: { ok: boolean; provisions: number; needs_review: number; verified: number; char_coverage: number; ocr_lines?: number; picture_text_lines?: number; ocr_corrections?: number; empty_pages: number[] } };
    file_contents: { file: string; content_sha256: string; same_bytes: boolean }[]; provisions: (Provision & { lines?: string[] })[] };
  const structured = (): Structured[] => h.editions.map(e => join(dir, 'structured', `${editionFile(e.id)}.json`)).filter(existsSync).map(p => readJson<Structured>(p));

  if (cmd === 'reconcile') {
    const errors = decisionErrors();
    const s = structured();
    if (s.length !== h.editions.length) errors.push(`${h.editions.length - s.length} edition(s) not structured yet`);
    errors.push(...checkEditions(s.map(x => ({ id: x.edition, inventory_key: x.inventory_key, content_sha256: x.version.content_sha256, version: x.version.version, confirmed: !!x.version.confirmed_by, ok: x.version.reconciliation.ok, file_contents: x.file_contents })), current));
    const ok = errors.length === 0;
    const uniqueShas = new Set(files.map(f => f.sha256)).size;
    const r = {
      ok, errors, archive_files: files.length, unique_files: uniqueShas, editions: h.editions.length, same_as_current: h.same_as_current.length, held: h.held.length,
      documents: [...new Set(h.editions.map(e => e.inventory_key))].sort(),
      byte_identical_collapsed: h.editions.flatMap(e => e.files.slice(1).filter(f => fileByPath.get(f)!.sha256 === fileByPath.get(e.files[0])!.sha256).map(f => ({ file: f, edition: e.id }))),
      same_text_collapsed: s.flatMap(x => x.file_contents.filter(f => !f.same_bytes).map(f => ({ file: f.file, edition: x.edition })))
    };
    writeJson(join(dir, 'reconciliation.json'), r);
    const byDoc = new Map<string, Structured[]>();
    for (const x of s) byDoc.set(x.inventory_key, [...(byDoc.get(x.inventory_key) ?? []), x]);
    const lines = [`# ${h.governing_body} · historical editions "${h.name}" · reconciliation`, '', `Result: **${ok ? 'PASSED' : 'NOT PASSED'}**`, '',
      `Archive files: ${r.archive_files} (${r.unique_files} unique by SHA-256) · historical editions: ${r.editions} of ${r.documents.length} documents · the current edition again: ${r.same_as_current} · held for review: ${r.held}`, '',
      ...errors.map(e => `- ERROR: ${e}`), '',
      '| Document | Order | Edition (version as printed) | Current version | Files | Pages | Read by | Provisions | To review | Picture text set aside | OCR corrections | Coverage | Result |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...[...byDoc.entries()].sort().flatMap(([k, xs]) => xs.sort((a, b) => a.seq - b.seq).map(x => {
        const v = x.version; const rr = v.reconciliation; const ocrPages = (v.extractor.match(/on (\d+) page\(s\)/) ?? [])[1];
        return `| ${k} | ${x.seq} | ${v.version}${v.confirmed_by ? '' : ' (NOT confirmed)'} | ${current.get(k)?.version ?? '—'} | ${v.source_files.map(f => f.file.split('/').pop()).join('<br>')} | ${v.page_count} | ${ocrPages ? `OCR ${ocrPages}/${v.page_count}` : 'text layer'} | ${rr.provisions} | ${rr.needs_review} | ${rr.picture_text_lines ?? 0} | ${rr.ocr_corrections ?? 0} | ${(rr.char_coverage * 100).toFixed(2)}% | ${rr.ok ? 'ok' : 'errors'} |`;
      })),
      '', '## The current edition again (provenance only, not imported)', ...(h.same_as_current.length ? h.same_as_current.map(x => `- ${x.file} → ${x.inventory_key} (${current.get(x.inventory_key)?.version}): ${x.evidence}`) : ['- none']),
      '', '## Held for review (not imported)', ...(h.held.length ? h.held.map(x => `- ${x.file}: ${x.reason}`) : ['- none']),
      '', '## Byte-identical copies (imported once)', ...(r.byte_identical_collapsed.length ? r.byte_identical_collapsed.map(x => `- ${x.file} = ${x.edition}`) : ['- none']),
      '', '## Different files with the same text (imported once)', ...(r.same_text_collapsed.length ? r.same_text_collapsed.map(x => `- ${x.file} = ${x.edition}`) : ['- none'])];
    writeFileSync(join(dir, 'reconciliation.md'), lines.join('\n') + '\n');
    console.log(lines.slice(0, 5).join('\n')); for (const e of errors) console.error(`ERROR ${e}`);
    if (!ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'sql') {
    const out = rest[0];
    if (!out) { console.error('usage: history.ts sql <body-dir> <name> <out.sql>'); process.exit(2); }
    const rr = existsSync(join(dir, 'reconciliation.json')) ? readJson<{ ok: boolean }>(join(dir, 'reconciliation.json')) : null;
    if (!rr?.ok) { console.error('the history does not reconcile: run reconcile and fix the errors'); process.exit(1); }
    const parts = [`-- GENERATED by scripts/rules/history.ts sql from ${dir}. Do not edit by hand: change the history files and regenerate.\n`,
      `-- Loads ${h.governing_body} HISTORICAL editions "${h.name}" (earlier versions from the archive folders) as historical versions IN REVIEW.\n`,
      `-- They are never the version in force: private.rules_import_historical_version refuses to touch a current version, and a historical version\n`,
      `-- can never be published as current (only publish_historical_version, by the platform owner, after review).\n`];
    for (const x of structured().sort((a, b) => a.inventory_key.localeCompare(b.inventory_key) || a.seq - b.seq)) {
      parts.push(`select private.rules_import_historical_version(${dollarQuote(JSON.stringify({ governing_body: h.governing_body, history: h.name, inventory_key: x.inventory_key, version: x.version,
        provisions: x.provisions.map(({ lines: _lines, ...p }) => p) }))}::jsonb);\n`);
    }
    writeFileSync(out, parts.join(''));
    console.log(`wrote ${out}`);
    return;
  }
  console.error(`unknown command ${cmd}`); process.exit(2);
}

if (process.argv[1] && /history\.ts$/.test(process.argv[1])) void main(process.argv.slice(2));
export { main };
