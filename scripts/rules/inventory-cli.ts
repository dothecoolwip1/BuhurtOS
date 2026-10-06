/**
 * Prints the source inventory for a saved rules page (plain .html or gzipped .html.gz), with the snapshot's checksum.
 *   node scripts/rules/inventory-cli.ts <snapshot> [captured_on YYYY-MM-DD] [captured_by] > source-inventory.json
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseRulesPage } from './inventory.ts';

const [file, capturedOn = null, capturedBy = null] = process.argv.slice(2);
if (!file) { console.error('usage: inventory-cli.ts <snapshot.html|snapshot.html.gz> [captured_on] [captured_by]'); process.exit(2); }
const raw = readFileSync(file);
const html = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
const inv = parseRulesPage(html);
const out = {
  governing_body: 'Buhurt International',
  snapshot: { file: basename(file), sha256_html: createHash('sha256').update(html, 'utf8').digest('hex'), captured_on: capturedOn, captured_by: capturedBy },
  ...inv,
  counts: {
    documents: inv.documents.filter(d => d.host !== 'drive_folder').length,
    archive_folders: inv.documents.filter(d => d.host === 'drive_folder').length,
    by_committee: Object.fromEntries(inv.sections.map(s => [s.key, inv.documents.filter(d => d.committee === s.key && d.host !== 'drive_folder').length]))
  }
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
