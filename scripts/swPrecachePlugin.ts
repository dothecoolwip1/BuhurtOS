import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Writes the built asset list into sw.js and gives each build its own cache name, so old caches are dropped. */
export function swPrecachePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'buhurtos-sw-precache',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const dir = path.resolve(outDir);
      const swPath = path.join(dir, 'sw.js');
      const assets = path.join(dir, 'assets');
      if (!fs.existsSync(swPath) || !fs.existsSync(assets)) return;
      const list = fs.readdirSync(assets).filter(f => /\.(js|css)$/.test(f)).sort().map(f => `assets/${f}`);
      list.push('favicon.svg');
      const id = createHash('sha256').update(list.join('|')).digest('hex').slice(0, 10);
      const src = fs.readFileSync(swPath, 'utf8')
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(list)};`)
        .replace("const BUILD_ID = 'dev';", `const BUILD_ID = '${id}';`);
      fs.writeFileSync(swPath, src);
    }
  };
}
