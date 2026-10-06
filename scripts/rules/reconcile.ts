/**
 * Pack 22 importer, step 4: the evidence that an import matches the official material.
 *
 * Per document: every non-empty line of the extracted source is either inside exactly one provision or recorded as page furniture; the characters of
 * the provisions add up to the characters of those lines; numbering gaps, numbers printed twice, identical texts, unreadable pages and lines that
 * looked like headings but did not fit are listed; the version label has been confirmed by a person; the file is the one that was fetched.
 * Per release: every document in the source inventory is either imported or explicitly excluded with a reason, and no file is imported twice.
 *
 * ok = no errors. Warnings do not block storage but every provision they concern is needs_review, and a version is publishable only when none is.
 */
import type { Provision, StructureResult } from './structure';

export interface DocReconciliation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  pages: number;
  source_lines: number;
  assigned_lines: number;
  furniture_lines: number;
  unaccounted_lines: string[];
  double_assigned_lines: string[];
  char_coverage: number;
  provisions: number;
  numbered: number;
  needs_review: number;
  verified: number;
  empty_pages: number[];
  rejected_numbers: number;
  duplicate_numbers: string[];
  duplicate_texts: string[][];
  version_confirmed: boolean;
  source_sha256_matches: boolean | null;
}

const chars = (s: string) => s.replace(/\s+/g, '').length;

export function reconcileDocument(input: {
  result: StructureResult; provisions: Provision[]; pages: number; versionConfirmed: boolean; sourceSha256?: string | null; fetchedSha256?: string | null; textFixes?: number;
}): DocReconciliation {
  const { result, provisions } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const nonEmpty = result.lines.filter(l => l.text.trim());
  const furnitureIds = new Set(result.furniture.map(f => f.id));
  const owner = new Map<string, number>();
  const double: string[] = [];
  for (const p of provisions) for (const id of p.lines) { if (owner.has(id)) double.push(id); owner.set(id, p.ordinal); }
  const unaccounted = nonEmpty.filter(l => !owner.has(l.id) && !furnitureIds.has(l.id)).map(l => l.id);
  const inBoth = result.furniture.filter(f => owner.has(f.id)).map(f => f.id);
  if (unaccounted.length) errors.push(`${unaccounted.length} source line(s) are in no provision and are not page furniture: ${unaccounted.slice(0, 8).join(', ')}`);
  if (double.length) errors.push(`${double.length} source line(s) are in more than one provision: ${double.slice(0, 8).join(', ')}`);
  if (inBoth.length) errors.push(`${inBoth.length} line(s) are both furniture and provision text`);

  const srcChars = nonEmpty.filter(l => !furnitureIds.has(l.id)).reduce((n, l) => n + chars(l.text), 0);
  // The printed number's punctuation ("4." / "1.2.") is not stored, so allow for it.
  const numberPunct = provisions.filter(p => p.number && p.kind !== 'appendix').length;
  const provChars = provisions.filter(p => p.kind !== 'figure').reduce((n, p) => n + chars(`${p.number ?? ''}${p.title ?? ''}${p.body}`), 0);
  const coverage = srcChars === 0 ? (provChars === 0 ? 1 : 0) : Math.min(provChars, srcChars) / srcChars;
  const overflow = provChars - srcChars;
  if (srcChars > 0 && coverage < 0.98) errors.push(`provisions hold only ${(coverage * 100).toFixed(2)}% of the source characters`);
  else if (srcChars > 0 && coverage < 0.995 && provChars + numberPunct < srcChars * 0.995) warnings.push(`provisions hold ${(coverage * 100).toFixed(2)}% of the source characters`);
  if (overflow > 0 && !(input.textFixes && input.textFixes > 0)) errors.push(`provisions hold ${overflow} more characters than the source: text was added`);

  const numbers = provisions.filter(p => p.number).map(p => p.number!);
  const dupNumbers = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i && !provisions.find(p => p.number === n && p.kind === 'appendix')))];
  if (dupNumbers.length) warnings.push(`number(s) printed more than once: ${dupNumbers.slice(0, 10).join(', ')}`);
  const byText = new Map<string, string[]>();
  for (const p of provisions) if (p.body.length >= 40) { const k = p.body.replace(/\s+/g, ' ').toLowerCase(); byText.set(k, [...(byText.get(k) ?? []), p.stable_key]); }
  const dupTexts = [...byText.values()].filter(v => v.length > 1);
  if (dupTexts.length) warnings.push(`${dupTexts.length} text(s) appear in more than one provision`);
  if (result.empty_pages.length) warnings.push(`page(s) without extractable text: ${result.empty_pages.join(', ')}`);
  if (result.rejected_numbers.length) warnings.push(`${result.rejected_numbers.length} line(s) looked like a numbered heading but did not fit the sequence`);
  const needs = provisions.filter(p => p.review_status === 'needs_review').length;
  if (needs) warnings.push(`${needs} provision(s) need review against the official document`);
  if (!input.versionConfirmed) errors.push('the version label and date have not been confirmed by a person (overrides: version_confirmed_by)');
  if (!provisions.length) errors.push('no provisions');
  let shaOk: boolean | null = null;
  if (input.fetchedSha256 !== undefined || input.sourceSha256 !== undefined) {
    shaOk = !!input.sourceSha256 && input.sourceSha256 === input.fetchedSha256;
    if (!shaOk) errors.push('the source file checksum does not match the fetched file');
  }
  const ords = provisions.map(p => p.ordinal);
  if (ords.some((o, i) => o !== i + 1)) errors.push('provisions are not numbered 1..n in reading order');
  const keys = provisions.map(p => p.stable_key);
  if (new Set(keys).size !== keys.length) errors.push('two provisions share a stable key');
  const known = new Set(keys);
  const orphans = provisions.filter(p => p.parent_key && (!known.has(p.parent_key) || keys.indexOf(p.parent_key) > keys.indexOf(p.stable_key)));
  if (orphans.length) errors.push(`${orphans.length} provision(s) name a parent that does not come before them`);

  return {
    ok: errors.length === 0, errors, warnings, pages: input.pages, source_lines: nonEmpty.length, assigned_lines: owner.size, furniture_lines: result.furniture.length,
    unaccounted_lines: unaccounted, double_assigned_lines: double, char_coverage: Number(coverage.toFixed(5)), provisions: provisions.length,
    numbered: numbers.length, needs_review: needs, verified: provisions.filter(p => p.review_status === 'verified').length, empty_pages: result.empty_pages,
    rejected_numbers: result.rejected_numbers.length, duplicate_numbers: dupNumbers, duplicate_texts: dupTexts, version_confirmed: input.versionConfirmed, source_sha256_matches: shaOk
  };
}

export interface ReleaseReconciliation {
  ok: boolean;
  errors: string[];
  inventory_documents: number;
  imported: string[];
  excluded: { key: string; reason: string }[];
  missing: string[];
  unknown: string[];
  same_file_twice: string[][];
  documents_ok: number;
  documents_with_errors: string[];
}

/** Every document in the inventory is accounted for: imported, or excluded with a stated reason. Archive folders are excluded by kind. */
export function reconcileRelease(input: {
  inventory: { key: string; host: string }[];
  imported: { key: string; sha256: string | null; ok: boolean }[];
  excluded: { key: string; reason: string }[];
}): ReleaseReconciliation {
  const errors: string[] = [];
  const invKeys = new Set(input.inventory.map(d => d.key));
  const excluded = [...input.excluded, ...input.inventory.filter(d => d.host === 'drive_folder' && !input.excluded.some(e => e.key === d.key))
    .map(d => ({ key: d.key, reason: 'archive folder of earlier versions, not a current document' }))];
  const imported = input.imported.map(d => d.key);
  const unknown = [...imported, ...input.excluded.map(e => e.key)].filter(k => !invKeys.has(k));
  if (unknown.length) errors.push(`not in the inventory: ${unknown.join(', ')}`);
  const both = imported.filter(k => excluded.some(e => e.key === k));
  if (both.length) errors.push(`both imported and excluded: ${both.join(', ')}`);
  const badReason = input.excluded.filter(e => e.reason.trim().length < 10);
  if (badReason.length) errors.push(`an exclusion needs a real reason: ${badReason.map(e => e.key).join(', ')}`);
  const missing = input.inventory.map(d => d.key).filter(k => !imported.includes(k) && !excluded.some(e => e.key === k));
  if (missing.length) errors.push(`${missing.length} inventory document(s) neither imported nor excluded: ${missing.join(', ')}`);
  const bySha = new Map<string, string[]>();
  for (const d of input.imported) if (d.sha256) bySha.set(d.sha256, [...(bySha.get(d.sha256) ?? []), d.key]);
  const twice = [...bySha.values()].filter(v => v.length > 1);
  if (twice.length) errors.push(`the same file is imported under more than one document: ${twice.map(v => v.join(' = ')).join('; ')}`);
  const bad = input.imported.filter(d => !d.ok).map(d => d.key);
  return {
    ok: errors.length === 0, errors, inventory_documents: input.inventory.length, imported, excluded, missing, unknown, same_file_twice: twice,
    documents_ok: input.imported.length - bad.length, documents_with_errors: bad
  };
}
