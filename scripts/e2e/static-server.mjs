// A tiny static server whose served build can be switched while a browser is connected: that is how a deployment is simulated in tests.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

export function startStaticServer(initialDir) {
  const state = { dir: initialDir, hits: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    state.hits.push(url.pathname);
    let file = path.join(state.dir, decodeURIComponent(url.pathname));
    if (!file.startsWith(state.dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(state.dir, 'index.html');   // single-page app fallback
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    state, base: `http://127.0.0.1:${server.address().port}`, switchTo(dir) { state.dir = dir; }, close: () => new Promise(r => server.close(() => r()))
  })));
}
