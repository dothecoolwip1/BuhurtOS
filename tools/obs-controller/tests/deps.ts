import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Companion tool has its own dependencies (ws, esbuild). The repository's root install does not include them: suites that need them skip themselves. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const hasToolDeps = existsSync(join(root, 'node_modules', 'ws', 'package.json')) && existsSync(join(root, 'node_modules', 'esbuild', 'package.json'));
