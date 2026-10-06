/**
 * Pack 22: the reproducible rules import. One command per step; each step reads the previous step's files and writes its own, so every
 * intermediate result can be reviewed and committed. See rules-library/README.md for the full procedure.
 *
 *   node scripts/rules/release.ts inventory-sql <body-dir> <out.sql>          the document directory (from source-inventory.json + classification.json)
 *   node scripts/rules/release.ts fetch       <body-dir> <release> [key...]  download the official files (never overwrites a different file)
 *   node scripts/rules/release.ts register    <body-dir> <release> <key> <file> <supplied-by>
 *                                                                           record an official file obtained another way (e.g. uploaded by the owner)
 *   node scripts/rules/release.ts extract     <body-dir> <release>           pdftotext, one entry per page, with pdfinfo
 *   node scripts/rules/release.ts structure   <body-dir> <release>           provisions + per-document reconciliation
 *   node scripts/rules/release.ts reconcile   <body-dir> <release>           release-level reconciliation (every inventory document accounted for)
 *   node scripts/rules/release.ts sql         <body-dir> <release> <out.sql> the migration that loads it (refuses if the release does not reconcile,
 *                                                                           unless --draft: then every version is stored as an owner-only draft)
 * <body-dir> is e.g. rules-library/buhurt-international. A release lives in <body-dir>/releases/<release>/ with release.json.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, structureDocument, type Provision, type SourcePage } from './structure.ts';
import { reconcileDocument, reconcileRelease } from './reconcile.ts';

interface InventoryDoc { key: string; label: string; committee: string; heading: string | null; url: string; host: 'site_file' | 'drive_file' | 'drive_folder'; ref: string; order: number }
interface InventoryFile { governing_body: string; snapshot: { sha256_html: string; captured_on: string | null }; page_url: string; page_title: string; sections: unknown[]; documents: InventoryDoc[] }
interface ReleaseFile { release: string; governing_body: string; synthetic?: boolean; excluded: { key: string; reason: string }[]; inventory?: string }
export interface Overrides {
  version?: string; version_confirmed_by?: string; confirmed_on?: string; title?: string; published_on?: string | null; effective_from?: string | null; note?: string;
  /** Per stable key: a person's review of the provision against the official document. */
  review?: Record<string, { status: 'verified' | 'needs_review'; note?: string }>;
  /** Per stable key: BuhurtOS search words people use that the text does not (NOT official). */
  keywords?: Record<string, string[]>;
  topics?: Record<string, string[]>;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
export const fileKey = (key: string) => key.replace(/\//g, '__');
const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Where an official file is downloaded from: the site's own file address, or Google Drive's direct download for a shared Drive file. */
export function downloadUrl(d: Pick<InventoryDoc, 'host' | 'url' | 'ref'>): string | null {
  if (d.host === 'site_file') return d.url;
  if (d.host === 'drive_file') return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(d.ref)}&export=download&confirm=t`;
  return null;
}

/** A dollar-quote tag that does not occur in the payload, so the SQL is safe whatever the official text contains. */
export function dollarQuote(s: string): string {
  let tag = 'rules';
  for (let i = 1; s.includes(`$${tag}$`); i++) tag = `rules${i}`;
  return `$${tag}$${s}$${tag}$`;
}

export function inventoryPayload(inv: InventoryFile, classification: unknown, synthetic = false) {
  return { governing_body: inv.governing_body, page_url: inv.page_url, page_title: inv.page_title, snapshot: inv.snapshot, sections: inv.sections, documents: inv.documents, classification, synthetic };
}
export const inventorySql = (payload: unknown) => `select private.rules_import_inventory(${dollarQuote(JSON.stringify(payload))}::jsonb);\n`;
export const versionSql = (payload: unknown) => `select private.rules_import_version(${dollarQuote(JSON.stringify(payload))}::jsonb);\n`;

/** The stored version checksum: the provisions as the database will hold them (without the reconciliation-only line ids), in order. */
export function versionContentSha(provisions: Provision[]): string {
  return sha256(JSON.stringify(provisions.map(p => [p.ordinal, p.depth, p.kind, p.number, p.title, p.body, p.page_from, p.page_to, p.stable_key, p.parent_key])));
}

export function applyOverrides(provisions: Provision[], o: Overrides): Provision[] {
  return provisions.map(p => {
    const r = o.review?.[p.stable_key];
    return {
      ...p,
      review_status: r ? r.status : p.review_status,
      review_note: r ? (r.note ?? (r.status === 'verified' ? null : p.review_note)) : p.review_note,
      keywords: o.keywords?.[p.stable_key] ?? p.keywords,
      topics: o.topics?.[p.stable_key] ?? p.topics
    };
  });
}

function main(argv: string[]) {
  const [cmd, bodyDir, release, ...rest] = argv;
  if (!cmd || !bodyDir) { console.error('usage: release.ts <inventory-sql|fetch|extract|structure|reconcile|sql> <body-dir> [release] ...'); process.exit(2); }
  const inv = readJson<InventoryFile>(join(bodyDir, 'source-inventory.json'));
  const classification = existsSync(join(bodyDir, 'classification.json')) ? readJson<unknown>(join(bodyDir, 'classification.json')) : null;
  if (cmd === 'inventory-sql') {
    const out = release;
    if (!out) { console.error('usage: release.ts inventory-sql <body-dir> <out.sql>'); process.exit(2); }
    const head = `-- GENERATED by scripts/rules/release.ts inventory-sql from ${bodyDir}/source-inventory.json and classification.json. Do not edit by hand.\n` +
      `-- ${inv.governing_body}: ${inv.documents.length} entries on ${inv.page_url} (snapshot sha256 ${inv.snapshot.sha256_html}, captured ${inv.snapshot.captured_on}).\n` +
      `-- Document directory only: titles, committees and official links. No rule text is loaded by this file.\n`;
    writeFileSync(out, head + inventorySql(inventoryPayload(inv, classification)));
    console.log(`wrote ${out}`);
    return;
  }
  if (!release) { console.error('a release name is required'); process.exit(2); }
  const dir = join(bodyDir, 'releases', release);
  const rel = readJson<ReleaseFile>(join(dir, 'release.json'));
  const docs = inv.documents.filter(d => d.host !== 'drive_folder' && !rel.excluded.some(e => e.key === d.key));
  for (const sub of ['sources', 'text', 'structured', 'overrides']) mkdirSync(join(dir, sub), { recursive: true });
  const logPath = join(dir, 'fetch-log.json');
  const log: Record<string, { url: string; retrieved_at: string; sha256: string; bytes: number; content_type: string | null; supplied_by?: string }> = existsSync(logPath) ? readJson(logPath) : {};

  if (cmd === 'fetch') {
    const only = rest.filter(x => !x.startsWith('--'));
    return (async () => {
      for (const d of docs.filter(x => !only.length || only.includes(x.key))) {
        const url = downloadUrl(d);
        if (!url) continue;
        const res = await fetch(url, { redirect: 'follow' });
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.error(`FAIL ${d.key}: ${res.status} ${res.headers.get('content-type')} (not a PDF; a Drive file may need to be shared publicly)`); process.exitCode = 1; continue; }
        const target = join(dir, 'sources', `${fileKey(d.key)}.pdf`);
        const digest = createHash('sha256').update(buf).digest('hex');
        if (existsSync(target) && sha256File(target) !== digest) {
          // Never overwrite: the official file changed. Keep both and say so; the new one becomes a new version in a NEW release.
          writeFileSync(`${target}.${digest.slice(0, 12)}.new`, buf);
          console.error(`CHANGED ${d.key}: the official file differs from the one in this release; saved beside it. Start a new release for it.`);
          process.exitCode = 1; continue;
        }
        writeFileSync(target, buf);
        log[d.key] = { url, retrieved_at: new Date().toISOString(), sha256: digest, bytes: buf.length, content_type: res.headers.get('content-type') };
        console.log(`ok   ${d.key} ${buf.length} bytes ${digest.slice(0, 12)}`);
      }
      writeJson(logPath, log);
    })();
  }

  if (cmd === 'register') {
    const [key, file, ...by] = rest;
    const d = docs.find(x => x.key === key);
    if (!d || !file || !by.length) { console.error('usage: release.ts register <body-dir> <release> <inventory-key> <file.pdf> <supplied-by...>  (the key must be an inventory document in this release)'); process.exit(2); }
    const buf = readFileSync(file);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.error('not a PDF'); process.exit(1); }
    const target = join(dir, 'sources', `${fileKey(d.key)}.pdf`);
    const digest = createHash('sha256').update(buf).digest('hex');
    if (existsSync(target) && sha256File(target) !== digest) { console.error(`CHANGED ${d.key}: a different file is already in this release; start a new release for it`); process.exit(1); }
    if (!existsSync(target) || file !== target) writeFileSync(target, buf);
    log[d.key] = { url: d.url, retrieved_at: new Date().toISOString(), sha256: digest, bytes: buf.length, content_type: 'application/pdf', supplied_by: by.join(' ') };
    writeJson(logPath, log);
    console.log(`ok   ${d.key} registered ${digest.slice(0, 12)} (supplied by ${by.join(' ')}; the official link stays ${d.url})`);
    return;
  }

  if (cmd === 'extract') {
    const version = execFileSync('pdftotext', ['-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString() || '';
    const ver = (version.match(/pdftotext version ([\d.]+)/) ?? [])[1] ?? 'unknown';
    for (const d of docs) {
      const src = join(dir, 'sources', `${fileKey(d.key)}.pdf`);
      if (!existsSync(src)) { console.error(`MISSING ${d.key}: fetch it first`); process.exitCode = 1; continue; }
      const info = execFileSync('pdfinfo', [src], { encoding: 'utf8' });
      const field = (k: string) => (info.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) ?? [])[1]?.trim() || null;
      const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', src, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const pages: SourcePage[] = text.split('\f').map((t, i) => ({ page: i + 1, text: t }));
      const pageCount = Number(field('Pages'));
      if (pages.length > pageCount && !pages[pages.length - 1].text.trim()) pages.pop();
      writeJson(join(dir, 'text', `${fileKey(d.key)}.json`), {
        inventory_key: d.key, sha256: sha256File(src), extractor: `pdftotext ${ver} -layout -enc UTF-8`,
        pdfinfo: { pages: pageCount, title: field('Title'), creator: field('Creator'), producer: field('Producer'), created: field('CreationDate'), modified: field('ModDate') }, pages
      });
      console.log(`ok   ${d.key} ${pages.length} pages`);
    }
    return;
  }

  if (cmd === 'structure') {
    for (const d of docs) {
      const tp = join(dir, 'text', `${fileKey(d.key)}.json`);
      if (!existsSync(tp)) { console.error(`MISSING ${d.key}: extract it first`); process.exitCode = 1; continue; }
      const t = readJson<{ sha256: string; extractor: string; pdfinfo: { pages: number; title: string | null; modified: string | null }; pages: SourcePage[] }>(tp);
      const op = join(dir, 'overrides', `${fileKey(d.key)}.json`);
      const o: Overrides = existsSync(op) ? readJson(op) : {};
      const series = d.key.split('/').pop()!;
      const result = structureDocument(t.pages, series);
      const provisions = applyOverrides(result.provisions, o);
      const rec = reconcileDocument({ result, provisions, pages: t.pdfinfo.pages, versionConfirmed: !!(o.version && o.version_confirmed_by), sourceSha256: t.sha256, fetchedSha256: log[d.key]?.sha256 ?? null });
      if (!existsSync(op)) writeJson(op, { version: result.detected.version, published_on: result.detected.date, version_confirmed_by: null, confirmed_on: null, review: {}, keywords: {}, topics: {} });
      writeJson(join(dir, 'structured', `${fileKey(d.key)}.json`), {
        inventory_key: d.key,
        version: {
          version: o.version ?? result.detected.version ?? 'unconfirmed', title: o.title ?? t.pdfinfo.title ?? d.label, published_on: o.published_on ?? null, effective_from: o.effective_from ?? null,
          note: o.note ?? null, source_url: d.url, source_sha256: t.sha256, retrieved_at: log[d.key]?.retrieved_at ?? null, page_count: t.pdfinfo.pages, extractor: t.extractor,
          content_sha256: versionContentSha(provisions), detected: result.detected, confirmed_by: o.version_confirmed_by ?? null,
          reconciliation: { ...rec, unaccounted_lines: rec.unaccounted_lines.slice(0, 50), double_assigned_lines: rec.double_assigned_lines.slice(0, 50) }
        },
        provisions, furniture: result.furniture, rejected_numbers: result.rejected_numbers
      });
      console.log(`${rec.ok ? 'ok  ' : 'FAIL'} ${d.key}: ${provisions.length} provisions, ${rec.needs_review} to review, coverage ${(rec.char_coverage * 100).toFixed(2)}%${rec.errors.length ? ' · ' + rec.errors.join(' · ') : ''}`);
      if (!rec.ok) process.exitCode = 1;
    }
    return;
  }

  const structured = () => readdirSync(join(dir, 'structured')).filter(f => f.endsWith('.json')).map(f => readJson<{ inventory_key: string; version: { source_sha256: string; reconciliation: { ok: boolean } }; provisions: Provision[] }>(join(dir, 'structured', f)));
  if (cmd === 'reconcile') {
    const s = structured();
    const rr = reconcileRelease({ inventory: inv.documents, imported: s.map(x => ({ key: x.inventory_key, sha256: x.version.source_sha256, ok: x.version.reconciliation.ok })), excluded: rel.excluded });
    writeJson(join(dir, 'reconciliation.json'), rr);
    const lines = [`# ${rel.governing_body} · release ${rel.release} · reconciliation`, '', `Result: **${rr.ok && rr.documents_with_errors.length === 0 ? 'PASSED' : 'NOT PASSED'}**`, '',
      `Inventory documents: ${rr.inventory_documents} · imported: ${rr.imported.length} · excluded: ${rr.excluded.length} · missing: ${rr.missing.length}`, '',
      ...rr.errors.map(e => `- ERROR: ${e}`), '', '| Document | Provisions | To review | Coverage | Result |', '| --- | --- | --- | --- | --- |',
      ...s.map(x => { const r = x.version.reconciliation as unknown as { provisions: number; needs_review: number; char_coverage: number; ok: boolean }; return `| ${x.inventory_key} | ${r.provisions} | ${r.needs_review} | ${(r.char_coverage * 100).toFixed(2)}% | ${r.ok ? 'ok' : 'errors'} |`; }),
      '', '## Excluded', ...rr.excluded.map(e => `- ${e.key}: ${e.reason}`)];
    writeFileSync(join(dir, 'reconciliation.md'), lines.join('\n') + '\n');
    console.log(lines.slice(0, 6).join('\n'));
    if (!rr.ok || rr.documents_with_errors.length) process.exitCode = 1;
    return;
  }

  if (cmd === 'sql') {
    const out = rest.find(x => !x.startsWith('--'));
    const draft = rest.includes('--draft');
    if (!out) { console.error('usage: release.ts sql <body-dir> <release> <out.sql> [--draft]'); process.exit(2); }
    const rr = existsSync(join(dir, 'reconciliation.json')) ? readJson<{ ok: boolean; documents_with_errors: string[] }>(join(dir, 'reconciliation.json')) : null;
    if (!draft && (!rr || !rr.ok || rr.documents_with_errors.length)) { console.error('the release does not reconcile: run reconcile and fix the errors, or pass --draft to store owner-only drafts'); process.exit(1); }
    const parts = [`-- GENERATED by scripts/rules/release.ts sql from ${dir}. Do not edit by hand: change the release files and regenerate.\n`,
      `-- Loads ${rel.governing_body} release ${rel.release}. Published versions are never overwritten (private.rules_import_version refuses).\n`,
      inventorySql(inventoryPayload(inv, classification, !!rel.synthetic))];
    for (const x of structured()) {
      const v = { ...x.version } as Record<string, unknown>;
      if (draft) v.reconciliation = { ...(v.reconciliation as object), ok: false, stored_as_draft: true };
      parts.push(versionSql({ governing_body: rel.governing_body, release: rel.release, inventory_key: x.inventory_key, synthetic: !!rel.synthetic, version: v,
        provisions: x.provisions.map(({ lines: _lines, ...p }) => p) }));
    }
    writeFileSync(out, parts.join(''));
    console.log(`wrote ${out}`);
    return;
  }
  console.error(`unknown command ${cmd}`); process.exit(2);
}

if (process.argv[1] && /release\.ts$/.test(process.argv[1])) void main(process.argv.slice(2));
export { main };
