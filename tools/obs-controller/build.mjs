// Bundles the Companion into ONE file: dist/companion.mjs (no node_modules needed on the laptop, just Node 22).
//   node build.mjs
// The app's own pure modules (src/lib/arena.ts, src/lib/broadcast/*, src/data/*) are bundled UNCHANGED. The one thing replaced is src/lib/supabase.ts
// (the browser client): the bundle gets src/shim/supabase.ts instead, a supabase-js client that uses the Companion's controller session token.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoSrc = path.resolve(here, '../../src');
const shim = path.resolve(here, 'src/shim/supabase.ts');
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

const swapSupabase = {
  name: 'swap-app-supabase-client',
  setup(b) {
    b.onResolve({ filter: /(^|\/)lib\/supabase$|^\.\/supabase$/ }, args => {
      const resolved = path.resolve(args.resolveDir, args.path);
      return resolved === path.join(repoSrc, 'lib/supabase') ? { path: shim } : null;
    });
  }
};

mkdirSync(path.join(here, 'dist'), { recursive: true });
const result = await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'dist/companion.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false, minify: false, legalComments: 'none',
  external: ['bufferutil', 'utf-8-validate'],       // optional native speed-ups of `ws`: not used
  plugins: [swapSupabase],
  banner: { js: "import { createRequire as __bosCreateRequire } from 'node:module'; const require = __bosCreateRequire(import.meta.url);" },
  define: { 'import.meta.env': '{}' },
  logLevel: 'warning', metafile: true
});
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some(i => i.endsWith('src/lib/supabase.ts') && !i.includes('shim'))) { console.error('the browser supabase client was bundled: the swap did not apply'); process.exit(1); }
console.log(`built dist/companion.mjs v${pkg.version}  ${(statSync(path.join(here, 'dist/companion.mjs')).size / 1024).toFixed(0)} KB  from ${inputs.length} files`);
