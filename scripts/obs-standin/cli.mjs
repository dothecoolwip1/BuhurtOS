// Run the OBS STAND-IN (not OBS) by hand, with a tiny loopback HTTP control API so you can drive faults while watching the Companion:
//   node scripts/obs-standin/cli.mjs [--port 4455] [--password secret] [--control-port 4456]
//   curl -s localhost:4456/state          scenes, program scene, inputs, ever-streamed flag
//   curl -s localhost:4456/log            every request the Companion has sent (a denied request shows up as "violations")
//   curl -s -X POST localhost:4456/drop   drop all connections        POST /restart  POST /exit  POST /start
//   curl -s -X POST localhost:4456/remove-scene -d '{"name":"Lyst 2 Live"}'   POST /add-scene   POST /program   POST /password   POST /meter   POST /latency
import http from 'node:http';
import { startStandIn } from './server.mjs';

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const so = await startStandIn({ port: Number(arg('port', 4455)), password: arg('password', 'standin-password') });
console.log(`${so.label} listening on ${so.url}  (password: ${arg('password', 'standin-password')})`);

const ctl = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* none */ }
  const out = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o, null, 2)); };
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/state') return out({ program: so.state.program, scenes: so.state.scenes.map((s) => s.name), inputs: Object.fromEntries([...so.state.inputs].map(([k, v]) => [k, { muted: v.muted, volumeDb: v.volumeDb, filters: v.filters.map((f) => ({ name: f.filterName, enabled: f.filterEnabled })), media: v.media?.state }])), streaming: so.state.streaming, everStreamStarted: so.state.everStreamStarted, dangerousSeen: so.state.dangerousSeen, identified: so.identifiedSessions() });
  if (p === '/log') return out({ requests: so.requests(), violations: so.violations() });
  if (p === '/drop') { so.dropConnections(); return out({ ok: true }); }
  if (p === '/restart') { await so.restart(body); return out({ ok: true }); }
  if (p === '/exit') { await so.exit(); return out({ ok: true }); }
  if (p === '/start') { await so.start(); return out({ ok: true }); }
  if (p === '/remove-scene') { so.removeScene(body.name); return out({ ok: true }); }
  if (p === '/add-scene') { so.addScene(body.name); return out({ ok: true }); }
  if (p === '/program') { so.setProgramByHand(body.name); return out({ ok: true }); }
  if (p === '/password') { so.setPassword(body.password, body); return out({ ok: true }); }
  if (p === '/meter') { so.injectMeter(body.input ?? 'Announcer Mic', body); return out({ ok: true }); }
  if (p === '/latency') { so.setLatency(Number(body.ms ?? 0), body.type ?? null); return out({ ok: true }); }
  res.writeHead(404); res.end('not found');
});
ctl.listen(Number(arg('control-port', 4456)), '127.0.0.1', () => console.log(`control API on http://127.0.0.1:${arg('control-port', 4456)}`));
