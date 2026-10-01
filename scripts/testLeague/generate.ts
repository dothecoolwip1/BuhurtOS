/**
 * Generator entry point. Deterministic: same roster.md + same code (+ same stats.json) = byte-identical files.
 *   npm run nacl:gen            writes supabase/seed/nacl_test/*.sql (bios use scripts/testLeague/stats.json when it exists)
 * Two-pass bios: load the SQL into a scratch database once, run scripts/testLeague/export_stats.sql to read the product's own statistics
 * into stats.json, then generate again so the bios describe exactly what the views report.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { buildWorld } from './world';
import { coreFile, eventFile, fighterFile } from './sql';
import { makeBios, type Stats } from './bios';

const OUT = process.env.NACL_OUT ?? 'supabase/seed/nacl_test';
const STATS = process.env.NACL_STATS ?? 'scripts/testLeague/stats.json';
const MAX_BYTES = 380_000;

export function generate(stats: Stats | null): { name: string; sql: string }[] {
  const w = buildWorld();
  const bios = makeBios(w.teams, w.fighters, stats);
  const files: { name: string; sql: string }[] = [{ name: '00_core.sql', sql: coreFile(w) }];
  const per = 40;
  for (let i = 0; i * per < w.fighters.length; i++) files.push({ name: `01_fighters_${String.fromCharCode(97 + i)}.sql`, sql: fighterFile(w, w.fighters.slice(i * per, (i + 1) * per), bios) });
  const hostOf = (n: string | null): string | null => (n ? w.teams.find(t => t.name === n)!.id : null);
  w.events.forEach((ew, i) => files.push({ name: `${String(10 + i).padStart(2, '0')}_event_${String(i + 1).padStart(2, '0')}_${ew.event.slug}.sql`, sql: eventFile(w, ew, hostOf(ew.event.host)) }));
  if (w.addon.length) files.push({ name: '25_addon_female_3v3_historical.sql', sql: w.addon.map(a => eventFile(w, a, null, true)).join('\n') });
  files.push({ name: `30_event_current_${w.rumble.event.slug}.sql`, sql: eventFile(w, w.rumble, hostOf(w.rumble.event.host)) });
  for (const f of files) if (Buffer.byteLength(f.sql) > MAX_BYTES) throw new Error(`${f.name} is ${Buffer.byteLength(f.sql)} bytes, over the chunk limit`);
  return files;
}

export function writeAll(files: { name: string; sql: string }[], dir = OUT): void {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (/^\d\d_.*\.sql$/.test(f)) rmSync(`${dir}/${f}`);
  for (const f of files) writeFileSync(`${dir}/${f.name}`, f.sql.endsWith('\n') ? f.sql : `${f.sql}\n`);
}

if (process.argv[1] && /generate\.(ts|js|mjs)$/.test(process.argv[1])) {
  const stats = existsSync(STATS) ? (JSON.parse(readFileSync(STATS, 'utf8')) as Stats) : null;
  const files = generate(stats);
  writeAll(files);
  console.log(`wrote ${files.length} files to ${OUT} (bios ${stats ? 'from ' + STATS : 'placeholder, no stats.json yet'})`);
  for (const f of files) console.log(`  ${f.name.padEnd(64)} ${(Buffer.byteLength(f.sql) / 1024).toFixed(1)} KB`);
}
