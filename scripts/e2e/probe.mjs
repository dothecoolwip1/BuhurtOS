// Usage: TEXT=1800 node scripts/e2e/probe.mjs /path1 /path2 ...  (visits on desktop + mobile)
import { launch, newCtx, visit } from './lib.mjs';
const paths = process.argv.slice(2);
const b = await launch();
for (const kind of (process.env.KINDS ?? 'desktop,mobile').split(',')) {
  const { page } = await newCtx(b, kind);
  for (const p of paths) {
    const r = await visit(page, kind, p, p.replace(/[^a-z0-9]+/gi, '_'));
    console.log(`\n=== ${kind} ${p} hscroll=${r.hscroll}(${r.sw}/${r.iw}) smallTargets=${r.small} tinyText=${r.tiny} bad=${r.bad} issues=${JSON.stringify(r.issues)}`);
    if (process.env.TEXT && kind === (process.env.TEXTKIND ?? 'desktop')) console.log(r.text.slice(0, +process.env.TEXT));
  }
}
await b.close();
