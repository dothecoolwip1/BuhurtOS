import { describe, it } from 'vitest';
import { hasToolDeps } from './deps';

// The real suite is controller.suite.ts. It needs this tool's own dependencies (npm ci in tools/obs-controller), which the repository's root install does not
// provide: without them this file is skipped (and says why) instead of failing the root test run.
if (hasToolDeps) await import('./controller.suite');
else describe('controller (needs: npm ci --prefix tools/obs-controller)', () => { it.skip('skipped: the Companion tool dependencies are not installed', () => undefined); });
