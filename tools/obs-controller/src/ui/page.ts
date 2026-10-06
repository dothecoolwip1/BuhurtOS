/**
 * The local screen (served at http://127.0.0.1:4777). One page, no framework, no external requests. Everything dynamic is built with textContent, never
 * innerHTML, so a scene or fighter name can never inject markup. Written for an operator in a hurry: big lights, one big Camera Off button.
 */
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>BuhurtOS Broadcast Companion</title>
<style>
:root { --bg:#10151d; --card:#19212c; --ink:#eef2f7; --mute:#9aa7b8; --line:#2b3645; --ok:#2ecc71; --warn:#f5b301; --bad:#ff4d5e; --accent:#4c8dff; color-scheme: dark; }
@media (prefers-color-scheme: light) { :root { --bg:#f3f5f8; --card:#fff; --ink:#111a26; --mute:#556376; --line:#d5dbe3; --ok:#0f9d58; --warn:#b07900; --bad:#c62828; --accent:#1f5fd6; color-scheme: light; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
header { display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); }
header h1 { font-size:18px; margin:0 8px 0 0; }
.lights { display:flex; gap:8px; flex-wrap:wrap; }
.light { display:flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:var(--card); border:1px solid var(--line); font-weight:600; }
.dot { width:14px; height:14px; border-radius:50%; background:var(--mute); }
.light.ok .dot { background:var(--ok); } .light.warn .dot { background:var(--warn); } .light.bad .dot { background:var(--bad); }
main { max-width:1100px; margin:0 auto; padding:16px; display:grid; gap:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
.card h2 { margin:0 0 8px; font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:var(--mute); }
.big { font-size:26px; font-weight:700; margin:0 0 4px; }
.sub { color:var(--mute); margin:0; }
button { font:inherit; font-weight:600; padding:10px 14px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; min-height:44px; }
button:hover { border-color:var(--accent); }
button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
button.danger { background:var(--bad); color:#fff; border-color:var(--bad); }
#camoff { width:100%; min-height:96px; font-size:28px; letter-spacing:.04em; }
#camoff.on { background:#000; border:3px solid var(--bad); color:var(--bad); }
.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
.banner { padding:10px 14px; border-radius:10px; font-weight:600; }
.banner.bad { background:rgba(255,77,94,.18); border:1px solid var(--bad); }
.banner.warn { background:rgba(245,179,1,.15); border:1px solid var(--warn); }
table { width:100%; border-collapse:collapse; } td,th { padding:6px 8px; text-align:left; border-bottom:1px solid var(--line); vertical-align:middle; }
select,input { font:inherit; padding:8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink); min-height:40px; max-width:100%; }
label { display:block; margin:8px 0 2px; color:var(--mute); font-size:14px; }
pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; max-height:260px; overflow:auto; font-size:12px; white-space:pre-wrap; margin:0; }
.pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid var(--line); font-size:13px; margin-right:6px; }
details > summary { cursor:pointer; font-weight:700; padding:6px 0; }
.problem { color:var(--warn); margin:4px 0; } .problem.error { color:var(--bad); }
</style>
</head>
<body>
<header>
  <h1>BuhurtOS Broadcast Companion</h1>
  <div class="lights" id="lights" aria-live="polite"></div>
  <span class="sub" id="ver"></span>
</header>
<main>
  <div id="banners"></div>
  <section class="grid2">
    <div class="card"><h2>On air</h2><p class="big" id="onair">…</p><p class="sub" id="why"></p><p class="sub" id="mode"></p>
      <div class="row" style="margin-top:12px"><button id="auto" class="primary">Return to Auto</button><button data-take="holding">Holding</button><button data-take="break">Break</button></div>
      <h2 style="margin-top:16px">Also live</h2><div id="also"></div></div>
    <div class="card"><h2>Camera Off (this laptop)</h2>
      <button id="camoff">CAMERA OFF</button>
      <p class="sub" id="camnote" style="margin-top:8px"></p>
      <div class="row" id="camclear" hidden style="margin-top:8px"><button id="clear" class="danger">Clear local Camera Off</button></div></div>
  </section>
  <section class="card"><h2>Lysts</h2><div id="fields"></div></section>
  <section class="grid2">
    <div class="card"><h2>Music and microphone</h2><div id="audio"></div>
      <div class="row" style="margin-top:8px"><button data-music="auto">Auto</button><button data-music="muted">Mute</button><button data-music="paused">Pause</button><button id="resume" hidden>Resume music (medical hold)</button></div></div>
    <div class="card"><h2>Test a scene</h2><p class="sub">Shows the scene for a few seconds, then Auto takes over again. Not available while Camera Off is on.</p><div class="row" id="tests"></div><p class="sub" id="testmsg"></p></div>
  </section>
  <details class="card"><summary>Scene mapping (setup)</summary><div id="mapping"></div></details>
  <details class="card"><summary>Audio setup</summary><div id="audiocfg"></div></details>
  <details class="card"><summary>Connections and codes (setup)</summary><div id="conn"></div></details>
  <section class="card"><h2>Log</h2><pre id="log"></pre></section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = null, editing = false;
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bos-companion': '1' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function fill(el, kids) { while (el.firstChild) el.removeChild(el.firstChild); kids.forEach(function (k) { if (k) el.appendChild(k); }); }
  function light(cls, text) { return h('span', { class: 'light ' + cls }, [h('span', { class: 'dot' }), h('span', { text: text })]); }
  function ago(s) { return s === null || s === undefined ? 'never' : s < 2 ? 'just now' : s + ' s ago'; }

  function render() {
    if (!S) return;
    var ml = S.mapping.problems.filter(function (p) { return p.severity === 'error'; }).length;
    var mw = S.mapping.problems.length - ml;
    var obsCls = S.obs.connected ? 'ok' : 'bad';
    var bos = S.bos;
    var bosCls = bos.session === 'ok' && bos.dataAgeSeconds !== null && !bos.stale ? 'ok' : bos.session === 'no_code' && bos.dataAgeSeconds !== null && !bos.stale ? 'warn' : 'bad';
    var bosText = bos.session === 'no_code' ? 'BuhurtOS: public data only' + (bos.stale ? ' (old)' : '') : bos.stale ? 'BuhurtOS: data is old' : bos.session === 'ok' ? 'BuhurtOS' : bos.session === 'rejected' ? 'BuhurtOS: code refused' : 'BuhurtOS: not connected';
    fill($('lights'), [
      light(obsCls, S.obs.connected ? 'OBS ' + (S.obs.version || '') : 'OBS: ' + (S.obs.state === 'waiting' ? 'not connected' : S.obs.state)),
      light(bosCls, bosText),
      light(ml ? 'bad' : mw ? 'warn' : 'ok', ml ? 'Scenes: ' + ml + ' problem' + (ml > 1 ? 's' : '') : mw ? 'Scenes: ' + mw + ' to check' : 'Scenes OK')
    ]);
    $('ver').textContent = 'v' + S.version;
    var b = [];
    if (S.camera.effective) b.push(h('div', { class: 'banner bad', text: 'CAMERAS ARE OFF' + (S.camera.reason ? ' (' + S.camera.reason.replace(/_/g, ' ') + ')' : '') + (S.camera.source === 'unknown_latched' ? ': cannot reach BuhurtOS, last known Off' : S.camera.local ? ': switched on from this laptop' : ': switched on in BuhurtOS') }));
    if (!S.obs.connected && S.obs.problem) b.push(h('div', { class: 'banner warn', text: 'OBS: ' + S.obs.problem }));
    if (bos.stale) b.push(h('div', { class: 'banner warn', text: 'BuhurtOS data is ' + ago(bos.dataAgeSeconds) + '. The scene stays as it is until the connection is back.' }));
    if (bos.dataError && !bos.stale) b.push(h('div', { class: 'banner warn', text: bos.dataError }));
    if (S.obs.streaming === false) { /* informational only: going live stays a human decision */ }
    fill($('banners'), b);

    var on = S.onAir;
    $('onair').textContent = !on ? 'Starting…' : S.camera.effective ? 'CAMERA OFF' : on.kind === 'lyst' ? (labelOf(on.field) + ' camera') : on.kind === 'holding' ? 'Holding' : on.kind === 'break' ? 'Break' : on.kind;
    $('why').textContent = on ? (on.reason + (on.scene ? '  ·  OBS scene: ' + on.scene : '')) : '';
    $('mode').textContent = (S.mode.effective === 'manual' ? 'MANUAL' : S.mode.effective === 'camera_off' ? 'CAMERA OFF' : 'AUTO') + (S.mode.local ? ' (chosen on this laptop)' : S.mode.controlSource === 'server' && S.mode.controlMode === 'manual' ? ' (chosen in BuhurtOS)' : '') + (S.mode.held && S.mode.held.by ? '  ·  waiting a few seconds before changing scene' : '');
    $('auto').disabled = S.mode.effective === 'auto';
    fill($('also'), S.alsoLive.length ? S.alsoLive.map(function (a) {
      return h('div', { class: 'row', style: 'margin:4px 0' }, [h('span', { text: a.label + (a.summary ? ': ' + a.summary : '') + (a.mapped ? '' : ' (no scene yet)') }), a.mapped ? h('button', { text: 'Take ' + a.label, onclick: function () { post('/api/take', { kind: 'lyst', field: a.field }); } }) : null]);
    }) : [h('p', { class: 'sub', text: 'No other Lyst is in a fight.' })]);

    var cam = $('camoff');
    cam.className = S.camera.local ? 'on' : 'danger';
    cam.textContent = S.camera.local ? 'CAMERAS OFF · ON THIS LAPTOP' : 'CAMERA OFF';
    $('camnote').textContent = S.camera.local ? 'Latched since ' + (S.camera.localSince || '').slice(11, 19) + '. It stays on through a restart and with no internet. Only this button clears it.' : S.camera.effective ? 'BuhurtOS has Camera Off on. Only an authorised person can release it there.' : 'Cuts to the Camera Off scene at once. Works with no internet.';
    $('camclear').hidden = !S.camera.local;

    fill($('fields'), [h('table', null, [h('tr', null, [h('th', { text: 'Lyst' }), h('th', { text: 'Now' }), h('th', { text: 'Fight' }), h('th', { text: 'Camera scene' }), h('th')])].concat(S.fields.map(function (f) {
      return h('tr', null, [h('td', { text: f.label }), h('td', null, [h('span', { class: 'pill', text: f.mode })]), h('td', { text: f.summary || '' }), h('td', { text: f.mapped ? 'set' : 'not set' }),
        h('td', null, [f.mapped ? h('button', { text: 'Take', onclick: function () { post('/api/take', { kind: 'lyst', field: f.key }); } }) : null])]);
    })))]);
    var au = S.audio, m = au.music;
    fill($('audio'), [
      h('p', { class: 'big', text: 'Music: ' + m.state }),
      h('p', { class: 'sub', text: 'Ducking: ' + m.ducking + '  ·  Announcer mic: ' + m.mic + (au.plan ? '  ·  ' + au.plan.reason : '') }),
      h('div', null, (au.plan ? au.plan.warnings : []).map(function (w) { return h('p', { class: 'problem', text: w.text }); })),
      au.lastError ? h('p', { class: 'problem error', text: 'Audio: ' + au.lastError }) : null
    ]);
    $('resume').hidden = !m.locked;
    var tests = $('tests'); if (!editing) fill(tests, S.obs.scenes.map(function (n) { return h('button', { text: n, onclick: function () { post('/api/test-scene', { scene: n }).then(function (r) { $('testmsg').textContent = r.message || r.error || ''; }); } }); }));
    $('log').textContent = S.log.join('\n');
    if (!editing) renderSetup();
  }
  function labelOf(key) { var f = S.fields.filter(function (x) { return x.key === key; })[0]; return f ? f.label : key; }

  var setupBuilt = false;
  function opts(list, current, none) {
    var seen = {}; var o = [h('option', { value: '', text: none || '(none)' })];
    list.concat(current && list.indexOf(current) < 0 ? [current] : []).forEach(function (n) { if (seen[n]) return; seen[n] = 1; o.push(h('option', { value: n, text: n + (list.indexOf(n) < 0 ? '  (not in OBS)' : ''), selected: n === current })); });
    return o;
  }
  function renderSetup() {
    if (setupBuilt) return;
    if (!S.obs.connected && S.obs.scenes.length === 0 && !S.mapping.config.holding) { /* still build, with free choices */ }
    setupBuilt = true;
    var scenes = S.obs.scenes, cfg = S.mapping.config;
    var keys = {}; S.fields.forEach(function (f) { keys[f.key] = f.label; }); Object.keys(cfg.lysts).forEach(function (k) { if (!keys[k]) keys[k] = k; });
    var sel = {};
    function pick(id, cur, none) { var s = h('select', { id: id }, opts(scenes, cur, none)); sel[id] = s; return s; }
    var rows = Object.keys(keys).sort().map(function (k) { var e = cfg.lysts[k] || {}; return h('tr', null, [h('td', { text: keys[k] }), h('td', null, [pick('live-' + k, e.live, '(no camera scene)')]), h('td', null, [pick('gfx-' + k, e.graphics, '(none)')])]); });
    fill($('mapping'), [
      h('p', { class: 'sub', text: 'Choose the OBS scene for each Lyst. A Lyst scene holds the camera and the BuhurtOS overlay for that Lyst. Scene names come only from here, never from BuhurtOS.' }),
      h('table', null, [h('tr', null, [h('th', { text: 'Lyst' }), h('th', { text: 'Camera scene' }), h('th', { text: 'Graphics scene (optional)' })])].concat(rows)),
      h('label', { text: 'Holding scene (between fights)' }), pick('m-holding', cfg.holding), h('label', { text: 'Break scene' }), pick('m-break', cfg.break),
      h('label', { text: 'Camera Off scene (no cameras: a still picture or text only)' }), pick('m-camoff', cfg.cameraOff),
      h('p', null, [h('button', { class: 'primary', text: 'Save scene mapping', onclick: function () {
        var lysts = {}; Object.keys(keys).forEach(function (k) { lysts[k] = { live: sel['live-' + k].value || null, graphics: sel['gfx-' + k].value || null }; });
        post('/api/mapping', { mapping: { lysts: lysts, holding: sel['m-holding'].value || null, break: sel['m-break'].value || null, cameraOff: sel['m-camoff'].value || null } }).then(function () { setupBuilt = false; });
      } })]),
      h('div', null, S.mapping.problems.map(function (p) { return h('p', { class: 'problem ' + p.severity, text: p.text }); }))
    ]);
    var a = S.audio.config, inp = S.audio.inputs;
    function dl(id, list) { return h('datalist', { id: id }, list.map(function (n) { return h('option', { value: n }); })); }
    var f = {};
    function field(label, key, list, type) { var i = h('input', { type: type || 'text', value: a[key] === null || a[key] === undefined ? '' : String(a[key]), list: list || null }); f[key] = i; return [h('label', { text: label }), i]; }
    var cb = h('input', { type: 'checkbox', checked: a.muteMusicWhenMicMissing });
    fill($('audiocfg'), [
      h('p', { class: 'sub', text: 'Millisecond ducking happens inside OBS (a Compressor on the music keyed to the announcer microphone, and a Noise Gate on the microphone). The Companion only checks it is there and sets the coarse rules.' }),
      dl('dl-inputs', inp), dl('dl-filters', S.audio.musicFilters)
    ].concat(field('Music source (OBS input)', 'musicSource', 'dl-inputs'), field('Announcer microphone (OBS input)', 'micSource', 'dl-inputs'), field('Ducking filter name (on the music source)', 'duckingFilter', 'dl-filters'),
      field('Media Source for real Play / Pause (optional)', 'mediaSource', 'dl-inputs'), field('Normal music level (dB, 0 = full)', 'normalLevelDb', null, 'number'), field('Fade time (ms)', 'fadeMs', null, 'number'),
      [h('label', null, [cb, h('span', { text: ' No microphone found: mute the music' })]),
       h('p', null, [h('button', { class: 'primary', text: 'Save audio setup', onclick: function () {
        var out = { musicSource: f.musicSource.value || null, micSource: f.micSource.value || null, duckingFilter: f.duckingFilter.value || null, mediaSource: f.mediaSource.value || null, normalLevelDb: Number(f.normalLevelDb.value), fadeMs: Number(f.fadeMs.value), muteMusicWhenMicMissing: cb.checked };
        post('/api/audio', { audio: out }).then(function () { setupBuilt = false; });
      } })])]));
    var c = S.bos;
    var url = h('input', { type: 'text', placeholder: 'https://your-project.supabase.co' }), key = h('input', { type: 'text', placeholder: 'publishable key' }), slug = h('input', { type: 'text', placeholder: 'event address (only if no controller code)' });
    var pw = h('input', { type: 'password', autocomplete: 'off', placeholder: 'OBS WebSocket password' }), code = h('input', { type: 'password', autocomplete: 'off', placeholder: 'controller code XXXX-XXXX-XXXX' });
    fill($('conn'), [
      h('p', { class: 'sub', text: 'Passwords and codes are kept only on this laptop, protected by the operating system, and are never shown again.' }),
      h('label', { text: 'OBS WebSocket password' }), pw, h('label', { text: 'Controller code (from the BuhurtOS Command Centre)' }), code,
      h('p', null, [h('button', { class: 'primary', text: 'Save', onclick: function () { post('/api/credentials', { obsPassword: pw.value || undefined, controllerCode: code.value || undefined }).then(function () { pw.value = ''; code.value = ''; }); } }),
        h('button', { text: 'Forget controller code', onclick: function () { post('/api/credentials', { clearControllerCode: true }); } })]),
      h('p', { class: 'sub', text: 'Status: ' + (c.session === 'ok' ? 'signed in as ' + (c.label || 'the stream controller') : c.session === 'no_code' ? 'no controller code (AUTO still works from public data; BuhurtOS cannot see this laptop)' : c.sessionProblem || c.session) }),
      h('label', { text: 'BuhurtOS address (changes apply after a restart)' }), url, h('label', { text: 'BuhurtOS publishable key' }), key, h('label', { text: 'Event address (slug)' }), slug,
      h('p', null, [h('button', { text: 'Save address', onclick: function () { post('/api/settings', { supabaseUrl: url.value || undefined, supabaseKey: key.value || undefined, eventSlug: slug.value || undefined }); } })])
    ]);
  }
  document.addEventListener('focusin', function (e) { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.closest('details')) editing = true; });
  document.addEventListener('focusout', function () { editing = false; });
  document.querySelectorAll('details').forEach(function (d) { d.addEventListener('toggle', function () { editing = d.open; }); });

  $('camoff').addEventListener('click', function () { post('/api/camera-off', {}); });
  $('clear').addEventListener('click', function () { if (confirm('Clear Camera Off on this laptop? The cameras will come back on air.')) post('/api/camera-off/clear', {}); });
  $('auto').addEventListener('click', function () { post('/api/auto', {}); });
  $('resume').addEventListener('click', function () { if (confirm('Resume the music after the medical hold?')) post('/api/resume-music', {}); });
  document.querySelectorAll('[data-take]').forEach(function (b) { b.addEventListener('click', function () { post('/api/take', { kind: b.getAttribute('data-take') }); }); });
  document.querySelectorAll('[data-music]').forEach(function (b) { b.addEventListener('click', function () { post('/api/music', { mode: b.getAttribute('data-music') }); }); });

  function poll() { fetch('/api/state').then(function (r) { return r.json(); }).then(function (j) { S = j; render(); }).catch(function () { }).then(function () { setTimeout(poll, 1000); }); }
  poll();
})();
</script>
</body>
</html>
`;
