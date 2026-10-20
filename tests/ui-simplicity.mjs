// A fixed local validation entry point for the Codex/Claude collaboration runner. No network, credentials or mutation commands.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
for (const args of [
  ['node_modules/typescript/bin/tsc', '-b', '--pretty', 'false'],
  ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/eventPhaseView.test.ts', 'src/lib/eventFilters.test.ts', 'src/content/tiers.test.ts']
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
