// OBS STAND-IN. NOT OBS.
// A small Node server that speaks the obs-websocket v5 protocol closely enough to test the BuhurtOS Broadcast Companion: the Hello / Identify / Identified
// handshake with the REAL challenge + salt SHA-256 authentication, Request / RequestResponse (with OBS's status codes), RequestBatch, the allow-listed requests
// with realistic response shapes, and the events the Companion listens to. It keeps scenes, inputs (mute, volume, filters, media state) and a program scene.
//
// WHAT IT PROVES: the Companion's protocol handling, its allow-list, its reconcile logic and its recovery behaviour, against something with real protocol manners.
// WHAT IT DOES NOT PROVE: anything about real OBS (rendering, cameras, audio DSP, ducking quality, firewall binding, Windows/macOS packaging). A run against this
// file is "stand-in verified", never "OBS verified".
//
// It also implements the requests the Companion must NEVER send (StartStream, GetStreamServiceSettings, ...) so that a mistake would actually happen here and show up in
// the request log. Test harnesses assert the log with `violations()`.
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { ALLOWED_REQUESTS, DANGEROUS_REQUESTS, violations as checkViolations } from './allowlist.mjs';

const requireFromTool = createRequire(new URL('../../tools/obs-controller/package.json', import.meta.url));
const { WebSocketServer, WebSocket } = requireFromTool('ws');

export const STANDIN_LABEL = 'OBS STAND-IN (not OBS)';
const RPC_VERSION = 1;
const SUB = { General: 1, Config: 2, Scenes: 4, Inputs: 8, Transitions: 16, Filters: 32, Outputs: 64, SceneItems: 128, MediaInputs: 256, Vendors: 512, Ui: 1024, InputVolumeMeters: 1 << 16 };
const STATUS = { Success: 100, UnknownRequestType: 204, MissingRequestField: 300, InvalidRequestField: 400, InvalidRequestFieldType: 401, RequestFieldOutOfRange: 402, ResourceNotFound: 600, InvalidResourceState: 604 };

class ReqError extends Error { constructor(code, comment) { super(comment); this.code = code; } }
const sha256b64 = (s) => crypto.createHash('sha256').update(s).digest('base64');
const mulToDb = (m) => (m > 0 ? 20 * Math.log10(m) : -100);
const dbToMul = (d) => 10 ** (d / 20);
const uuid = () => crypto.randomUUID();

export async function startStandIn(opts = {}) {
  const host = '127.0.0.1';
  let port = opts.port ?? 0;
  let password = opts.password ?? 'standin-password';
  const sessions = new Set();
  const log = [];
  let seq = 0;
  const behaviours = { latencyMs: 0, latencyByType: new Map(), hangNext: new Set(), failNext: new Map(), dropResponses: false };

  const state = {
    obsVersion: opts.obsVersion ?? '32.0.0',
    scenes: (opts.scenes ?? ['Holding', 'Break', 'Camera Off', 'Lyst 1 Live', 'Lyst 2 Live', 'Lyst 3 Live']).map((n) => ({ name: n, uuid: uuid() })),
    program: null,
    studioMode: false,
    streaming: false, everStreamStarted: false, recording: false, everRecordStarted: false,
    inputs: new Map(),
    meters: new Map(),                // inputName -> { mul, until }
    dangerousSeen: []                  // dangerous requests that actually executed
  };
  const addInput = (name, kind = 'wasapi_input_capture', extra = {}) => {
    state.inputs.set(name, { uuid: uuid(), kind, muted: false, volumeDb: 0, filters: [], media: kind === 'ffmpeg_source' ? { state: 'OBS_MEDIA_STATE_STOPPED', cursor: 0, duration: 180000 } : null, ...extra });
  };
  for (const i of opts.inputs ?? [
    { name: 'Music', kind: 'ffmpeg_source', filters: [{ name: 'Ducking', kind: 'compressor_filter', enabled: true, settings: { ratio: 10, threshold: -30, attack_time: 10, release_time: 1000, output_gain: 0, sidechain_source: 'Announcer Mic' } }] },
    { name: 'Announcer Mic', kind: 'wasapi_input_capture', filters: [{ name: 'Gate', kind: 'noise_gate_filter', enabled: true, settings: { open_threshold: -26, close_threshold: -32 } }] },
    { name: 'Camera 1 Audio', kind: 'wasapi_input_capture' }
  ]) { addInput(i.name, i.kind, { filters: (i.filters ?? []).map((f, n) => ({ filterName: f.name, filterKind: f.kind, filterEnabled: f.enabled ?? true, filterIndex: n, filterSettings: { ...f.settings } })) }); if (i.muted) state.inputs.get(i.name).muted = true; if (i.volumeDb !== undefined) state.inputs.get(i.name).volumeDb = i.volumeDb; }
  state.program = opts.program ?? state.scenes[0]?.name ?? null;

  // ------------------------------------------------------------------ events
  const emit = (eventType, intent, eventData) => {
    for (const s of sessions) if (s.identified && (s.subs & intent) !== 0 && s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: intent, eventData } }));
  };
  const sceneNamed = (n) => state.scenes.find((s) => s.name === n);
  const inputNamed = (n) => state.inputs.get(n);
  const setProgram = (name, announce = true) => { if (state.program === name) return; state.program = name; if (announce) emit('CurrentProgramSceneChanged', SUB.Scenes, { sceneName: name, sceneUuid: sceneNamed(name)?.uuid ?? '' }); };

  // ------------------------------------------------------------------ request handlers (OBS-like shapes and errors)
  const needInput = (d) => {
    if (typeof d.inputName !== 'string' && typeof d.inputUuid !== 'string') throw new ReqError(STATUS.MissingRequestField, 'Your request is missing the `inputName` or `inputUuid` field.');
    const name = d.inputName ?? [...state.inputs].find(([, v]) => v.uuid === d.inputUuid)?.[0];
    const i = name !== undefined ? inputNamed(name) : undefined;
    if (!i) throw new ReqError(STATUS.ResourceNotFound, `No input was found by the name of \`${d.inputName ?? d.inputUuid}\`.`);
    return { name, input: i };
  };
  const needFilter = (d) => {
    const sourceName = d.sourceName ?? [...state.inputs].find(([, v]) => v.uuid === d.sourceUuid)?.[0];
    if (typeof sourceName !== 'string') throw new ReqError(STATUS.MissingRequestField, 'Your request is missing the `sourceName` or `sourceUuid` field.');
    const src = inputNamed(sourceName);
    if (!src) throw new ReqError(STATUS.ResourceNotFound, `No source was found by the name of \`${sourceName}\`.`);
    return { sourceName, src };
  };
  const filterOut = (f) => ({ filterEnabled: f.filterEnabled, filterIndex: f.filterIndex, filterKind: f.filterKind, filterName: f.filterName, filterSettings: f.filterSettings });
  const H = {
    GetVersion: () => ({ obsVersion: state.obsVersion, obsWebSocketVersion: '5.5.0', rpcVersion: RPC_VERSION, availableRequests: Object.keys(H), supportedImageFormats: ['png', 'jpg'], platform: 'linux', platformDescription: STANDIN_LABEL }),
    GetStats: () => ({ cpuUsage: 3.2, memoryUsage: 210.5, availableDiskSpace: 100000, activeFps: 60, averageFrameRenderTime: 1.1, renderSkippedFrames: 0, renderTotalFrames: 1000, outputSkippedFrames: 0, outputTotalFrames: 1000, webSocketSessionIncomingMessages: 1, webSocketSessionOutgoingMessages: 1 }),
    GetSceneList: () => ({ currentProgramSceneName: state.program, currentProgramSceneUuid: sceneNamed(state.program)?.uuid ?? null, currentPreviewSceneName: null, currentPreviewSceneUuid: null, scenes: state.scenes.map((s, i) => ({ sceneIndex: state.scenes.length - 1 - i, sceneName: s.name, sceneUuid: s.uuid })).reverse() }),
    GetCurrentProgramScene: () => ({ sceneName: state.program, sceneUuid: sceneNamed(state.program)?.uuid ?? null, currentProgramSceneName: state.program, currentProgramSceneUuid: sceneNamed(state.program)?.uuid ?? null }),
    SetCurrentProgramScene: (d) => {
      if (typeof d.sceneName !== 'string' && typeof d.sceneUuid !== 'string') throw new ReqError(STATUS.MissingRequestField, 'Your request is missing the `sceneName` or `sceneUuid` field.');
      const s = d.sceneName !== undefined ? sceneNamed(d.sceneName) : state.scenes.find((x) => x.uuid === d.sceneUuid);
      if (!s) throw new ReqError(STATUS.ResourceNotFound, `No scene was found by the name of \`${d.sceneName ?? d.sceneUuid}\`.`);
      setProgram(s.name); return undefined;
    },
    GetStudioModeEnabled: () => ({ studioModeEnabled: state.studioMode }),
    GetInputList: (d) => ({ inputs: [...state.inputs].filter(([, v]) => !d.inputKind || v.kind === d.inputKind).map(([name, v]) => ({ inputName: name, inputUuid: v.uuid, inputKind: v.kind, unversionedInputKind: v.kind.replace(/_v\d+$/, '') })) }),
    GetInputMute: (d) => ({ inputMuted: needInput(d).input.muted }),
    SetInputMute: (d) => {
      const { name, input } = needInput(d);
      if (typeof d.inputMuted !== 'boolean') throw new ReqError(STATUS.InvalidRequestFieldType, 'Your request has an invalid `inputMuted` field type: expected a boolean.');
      if (input.muted !== d.inputMuted) { input.muted = d.inputMuted; emit('InputMuteStateChanged', SUB.Inputs, { inputName: name, inputUuid: input.uuid, inputMuted: input.muted }); }
      return undefined;
    },
    GetInputVolume: (d) => { const { input } = needInput(d); return { inputVolumeMul: dbToMul(input.volumeDb), inputVolumeDb: input.volumeDb }; },
    SetInputVolume: (d) => {
      const { name, input } = needInput(d);
      const hasDb = d.inputVolumeDb !== undefined, hasMul = d.inputVolumeMul !== undefined;
      if (!hasDb && !hasMul) throw new ReqError(STATUS.MissingRequestField, 'Your request is missing the `inputVolumeMul` or `inputVolumeDb` field.');
      if (hasDb && hasMul) throw new ReqError(STATUS.InvalidRequestField, 'You may only specify one of `inputVolumeMul` or `inputVolumeDb`.');
      if (hasDb) { if (typeof d.inputVolumeDb !== 'number') throw new ReqError(STATUS.InvalidRequestFieldType, 'Your request has an invalid `inputVolumeDb` field type: expected a number.'); if (d.inputVolumeDb < -100 || d.inputVolumeDb > 26) throw new ReqError(STATUS.RequestFieldOutOfRange, 'Your request has an out of range `inputVolumeDb` field: -100 to 26.'); input.volumeDb = d.inputVolumeDb; }
      else { if (typeof d.inputVolumeMul !== 'number') throw new ReqError(STATUS.InvalidRequestFieldType, 'Your request has an invalid `inputVolumeMul` field type: expected a number.'); if (d.inputVolumeMul < 0 || d.inputVolumeMul > 20) throw new ReqError(STATUS.RequestFieldOutOfRange, 'Your request has an out of range `inputVolumeMul` field: 0 to 20.'); input.volumeDb = mulToDb(d.inputVolumeMul); }
      emit('InputVolumeChanged', SUB.Inputs, { inputName: name, inputUuid: input.uuid, inputVolumeMul: dbToMul(input.volumeDb), inputVolumeDb: input.volumeDb });
      return undefined;
    },
    GetSourceFilterList: (d) => ({ filters: needFilter(d).src.filters.map(filterOut) }),
    GetSourceFilter: (d) => {
      const { src } = needFilter(d);
      const f = src.filters.find((x) => x.filterName === d.filterName);
      if (!f) throw new ReqError(STATUS.ResourceNotFound, `No filter was found by the name of \`${d.filterName}\`.`);
      return filterOut(f);
    },
    SetSourceFilterEnabled: (d) => {
      const { sourceName, src } = needFilter(d);
      const f = src.filters.find((x) => x.filterName === d.filterName);
      if (!f) throw new ReqError(STATUS.ResourceNotFound, `No filter was found by the name of \`${d.filterName}\`.`);
      if (typeof d.filterEnabled !== 'boolean') throw new ReqError(STATUS.InvalidRequestFieldType, 'Your request has an invalid `filterEnabled` field type: expected a boolean.');
      if (f.filterEnabled !== d.filterEnabled) { f.filterEnabled = d.filterEnabled; emit('SourceFilterEnableStateChanged', SUB.Filters, { sourceName, filterName: f.filterName, filterEnabled: f.filterEnabled }); }
      return undefined;
    },
    SetSourceFilterSettings: (d) => {
      const { src } = needFilter(d);
      const f = src.filters.find((x) => x.filterName === d.filterName);
      if (!f) throw new ReqError(STATUS.ResourceNotFound, `No filter was found by the name of \`${d.filterName}\`.`);
      if (typeof d.filterSettings !== 'object' || d.filterSettings === null) throw new ReqError(STATUS.InvalidRequestFieldType, 'Your request has an invalid `filterSettings` field type: expected an object.');
      f.filterSettings = d.overlay === false ? { ...d.filterSettings } : { ...f.filterSettings, ...d.filterSettings };
      return undefined;
    },
    GetMediaInputStatus: (d) => { const { input } = needInput(d); if (!input.media) throw new ReqError(STATUS.InvalidResourceState, 'The specified input is not a media input.'); return { mediaState: input.media.state, mediaDuration: input.media.duration, mediaCursor: input.media.cursor }; },
    TriggerMediaInputAction: (d) => {
      const { name, input } = needInput(d);
      if (!input.media) throw new ReqError(STATUS.InvalidResourceState, 'The specified input is not a media input.');
      if (typeof d.mediaAction !== 'string') throw new ReqError(STATUS.MissingRequestField, 'Your request is missing the `mediaAction` field.');
      const next = { OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY: 'OBS_MEDIA_STATE_PLAYING', OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE: 'OBS_MEDIA_STATE_PAUSED', OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP: 'OBS_MEDIA_STATE_STOPPED', OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART: 'OBS_MEDIA_STATE_PLAYING' }[d.mediaAction];
      if (!next) throw new ReqError(STATUS.InvalidRequestField, 'Your request has an invalid `mediaAction` field.');
      input.media.state = next;
      emit('MediaInputActionTriggered', SUB.MediaInputs, { inputName: name, inputUuid: input.uuid, mediaAction: d.mediaAction });
      return undefined;
    },
    GetStreamStatus: () => ({ outputActive: state.streaming, outputReconnecting: false, outputTimecode: '00:00:00.000', outputDuration: 0, outputCongestion: 0, outputBytes: 0, outputSkippedFrames: 0, outputTotalFrames: 0 }),
    GetRecordStatus: () => ({ outputActive: state.recording, outputPaused: false, outputTimecode: '00:00:00.000', outputDuration: 0, outputBytes: 0 }),
    // ---- the requests the Companion must never send. They DO work here, so a mistake would be visible.
    StartStream: () => { state.streaming = true; state.everStreamStarted = true; state.dangerousSeen.push('StartStream'); return undefined; },
    StopStream: () => { state.streaming = false; state.dangerousSeen.push('StopStream'); return undefined; },
    ToggleStream: () => { state.streaming = !state.streaming; state.everStreamStarted ||= state.streaming; state.dangerousSeen.push('ToggleStream'); return { outputActive: state.streaming }; },
    GetStreamServiceSettings: () => { state.dangerousSeen.push('GetStreamServiceSettings'); return { streamServiceType: 'rtmp_custom', streamServiceSettings: { server: 'rtmp://standin.invalid/live', key: 'STAND-IN-FAKE-STREAM-KEY-do-not-use' } }; },
    SetStreamServiceSettings: () => { state.dangerousSeen.push('SetStreamServiceSettings'); return undefined; },
    StartRecord: () => { state.recording = true; state.everRecordStarted = true; state.dangerousSeen.push('StartRecord'); return undefined; },
    StopRecord: () => { state.recording = false; state.dangerousSeen.push('StopRecord'); return { outputPath: '/dev/null' }; },
    RemoveScene: (d) => { state.dangerousSeen.push('RemoveScene'); state.scenes = state.scenes.filter((s) => s.name !== d.sceneName); return undefined; },
    SetInputSettings: () => { state.dangerousSeen.push('SetInputSettings'); return undefined; },
    TriggerHotkeyByName: () => { state.dangerousSeen.push('TriggerHotkeyByName'); return undefined; },
    CallVendorRequest: () => { state.dangerousSeen.push('CallVendorRequest'); return { vendorName: 'x', requestType: 'x', responseData: {} }; },
    Sleep: () => { state.dangerousSeen.push('Sleep'); return undefined; }
  };
  for (const t of DANGEROUS_REQUESTS) if (!H[t]) H[t] = () => { state.dangerousSeen.push(t); return undefined; };
  // the allow-list must be fully implemented
  for (const t of ALLOWED_REQUESTS) if (!H[t]) throw new Error(`stand-in is missing a handler for ${t}`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runRequest(type, data, ctx) {
    const entry = { seq: ++seq, at: Date.now(), type, data: data ?? undefined, session: ctx.id, viaBatch: !!ctx.batch, ok: false, code: 0 };
    log.push(entry);
    const delay = behaviours.latencyByType.get(type) ?? behaviours.latencyMs;
    if (delay) await sleep(delay);
    if (behaviours.hangNext.has(type)) { behaviours.hangNext.delete(type); entry.hung = true; return { hang: true }; }
    const fail = behaviours.failNext.get(type);
    if (fail) { behaviours.failNext.delete(type); entry.code = fail.code; return { requestType: type, requestStatus: { result: false, code: fail.code, comment: fail.comment } }; }
    const h = H[type];
    if (!h) { entry.code = STATUS.UnknownRequestType; return { requestType: type, requestStatus: { result: false, code: STATUS.UnknownRequestType, comment: `Unknown request type \`${type}\`.` } }; }
    try {
      const out = h(data ?? {});
      entry.ok = true; entry.code = STATUS.Success;
      return { requestType: type, requestStatus: { result: true, code: STATUS.Success }, ...(out !== undefined ? { responseData: out } : {}) };
    } catch (e) {
      if (!(e instanceof ReqError)) throw e;
      entry.code = e.code;
      return { requestType: type, requestStatus: { result: false, code: e.code, comment: e.message } };
    }
  }

  // ------------------------------------------------------------------ the server
  let httpServer = null, wss = null;
  let nextSession = 0;
  function onConnection(ws) {
    const s = { id: ++nextSession, ws, identified: false, subs: 0, challenge: null, salt: null, helloAt: Date.now() };
    sessions.add(s);
    ws.on('close', () => sessions.delete(s));
    ws.on('error', () => undefined);
    const hello = { obsWebSocketVersion: '5.5.0', rpcVersion: RPC_VERSION };
    if (password) { s.challenge = crypto.randomBytes(32).toString('base64'); s.salt = crypto.randomBytes(32).toString('base64'); hello.authentication = { challenge: s.challenge, salt: s.salt }; }
    ws.send(JSON.stringify({ op: 0, d: hello }));
    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return ws.close(4002, 'Unable to decode the message.'); }
      const d = m.d ?? {};
      if (m.op === 1) {
        if (s.identified) return ws.close(4008, 'You have already identified.');
        if (typeof d.rpcVersion !== 'number') return ws.close(4003, 'Your request is missing the `rpcVersion` field.');
        if (d.rpcVersion !== RPC_VERSION) return ws.close(4010, 'Your client RPC version is unsupported.');
        if (password) {
          const expect = sha256b64(sha256b64(password + s.salt) + s.challenge);
          if (d.authentication !== expect) { s.badAuth = true; return ws.close(4009, 'Authentication failed.'); }
        }
        s.identified = true; s.subs = d.eventSubscriptions ?? (SUB.General | SUB.Config | SUB.Scenes | SUB.Inputs | SUB.Transitions | SUB.Filters | SUB.Outputs | SUB.SceneItems | SUB.MediaInputs | SUB.Vendors | SUB.Ui);
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: RPC_VERSION } }));
        return undefined;
      }
      if (!s.identified) return ws.close(4007, 'You attempted to send a non-Identify message while not identified.');
      if (m.op === 3) { s.subs = d.eventSubscriptions ?? s.subs; return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: RPC_VERSION } })); }
      if (m.op === 6) {
        const r = await runRequest(d.requestType, d.requestData, { id: s.id });
        if (r.hang || behaviours.dropResponses) return undefined;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 7, d: { requestType: d.requestType, requestId: d.requestId, requestStatus: r.requestStatus, ...(r.responseData !== undefined ? { responseData: r.responseData } : {}) } }));
        return undefined;
      }
      if (m.op === 8) {
        if (!Array.isArray(d.requests)) return ws.close(4003, 'Your request is missing the `requests` field.');
        const results = [];
        for (const rq of d.requests) {
          const r = await runRequest(rq.requestType, rq.requestData, { id: s.id, batch: true });
          if (r.hang) continue;
          results.push({ requestType: rq.requestType, ...(rq.requestId ? { requestId: rq.requestId } : {}), requestStatus: r.requestStatus, ...(r.responseData !== undefined ? { responseData: r.responseData } : {}) });
          if (d.haltOnFailure && !r.requestStatus.result) break;
        }
        if (ws.readyState === WebSocket.OPEN && !behaviours.dropResponses) ws.send(JSON.stringify({ op: 9, d: { requestId: d.requestId, results } }));
        return undefined;
      }
      return ws.close(4006, 'Unknown OpCode.');
    });
  }

  function listen() {
    return new Promise((resolve, reject) => {
      httpServer = http.createServer((_req, res) => { res.writeHead(426); res.end('this is the OBS stand-in: WebSocket only'); });
      wss = new WebSocketServer({ server: httpServer, handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false) });
      wss.on('connection', onConnection);
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => { port = httpServer.address().port; resolve(); });
    });
  }
  function closeServer() {
    return new Promise((resolve) => {
      for (const s of sessions) s.ws.terminate();
      sessions.clear();
      if (!httpServer) return resolve();
      const h = httpServer, w = wss; httpServer = null; wss = null;
      w.close(); h.close(() => resolve()); h.closeAllConnections?.();
    });
  }
  await listen();

  // meters: ~20 per second to sessions that asked for them (and only for them)
  const meterTimer = setInterval(() => {
    const now = Date.now();
    for (const [name, m] of state.meters) if (m.until < now) state.meters.delete(name);
    const subs = [...sessions].filter((s) => s.identified && (s.subs & SUB.InputVolumeMeters) && s.ws.readyState === WebSocket.OPEN);
    if (!subs.length) return;
    const inputs = [...state.inputs.keys()].map((name) => { const mul = state.meters.get(name)?.mul ?? 0; return { inputName: name, inputUuid: state.inputs.get(name).uuid, inputLevelsMul: [[mul, mul, mul], [mul, mul, mul]] }; });
    const payload = JSON.stringify({ op: 5, d: { eventType: 'InputVolumeMeters', eventIntent: SUB.InputVolumeMeters, eventData: { inputs } } });
    for (const s of subs) s.ws.send(payload);
  }, 50);
  meterTimer.unref?.();

  const api = {
    label: STANDIN_LABEL,
    get port() { return port; },
    get url() { return `ws://${host}:${port}`; },
    state, log,
    /** Requests seen, optionally of one type (or batch only). */
    requests: (type) => (type ? log.filter((e) => e.type === type) : [...log]),
    count: (type) => log.filter((e) => e.type === type).length,
    clearLog: () => { log.length = 0; },
    /** Entries that are not allowed (see allowlist.mjs). `scope` adds the configured-source rules. */
    violations: (scope = null) => checkViolations(log, scope),
    identifiedSessions: () => [...sessions].filter((s) => s.identified).length,
    sessionCount: () => sessions.size,
    // ---- control API for tests
    dropConnections: () => { for (const s of sessions) s.ws.terminate(); },
    /** OBS quits: ExitStarted, then the socket closes and the port stops answering until `start()`. */
    async exit() { emit('ExitStarted', SUB.General, {}); await sleep(30); await closeServer(); },
    async start() { if (!httpServer) await listen(); },
    /** Close and listen again (an OBS restart). By default OBS comes back on its first scene, like a freshly opened profile. */
    async restart({ downMs = 200, resetProgram = true } = {}) {
      await api.exit(); await sleep(downMs);
      if (resetProgram) state.program = state.scenes[0]?.name ?? null;
      await listen();
    },
    addScene: (name) => { if (!sceneNamed(name)) { state.scenes.push({ name, uuid: uuid() }); emit('SceneCreated', SUB.Scenes, { sceneName: name, sceneUuid: sceneNamed(name).uuid, isGroup: false }); emit('SceneListChanged', SUB.Scenes, { scenes: state.scenes.map((s) => ({ sceneName: s.name, sceneUuid: s.uuid })) }); } },
    removeScene: (name) => {
      const s = sceneNamed(name); if (!s) return;
      state.scenes = state.scenes.filter((x) => x !== s);
      emit('SceneRemoved', SUB.Scenes, { sceneName: name, sceneUuid: s.uuid, isGroup: false });
      emit('SceneListChanged', SUB.Scenes, { scenes: state.scenes.map((x) => ({ sceneName: x.name, sceneUuid: x.uuid })) });
      if (state.program === name) setProgram(state.scenes[0]?.name ?? null);
    },
    /** An operator switches scene by hand in OBS. */
    setProgramByHand: (name) => setProgram(name),
    setStudioMode: (on) => { state.studioMode = !!on; },
    removeInput: (name) => { const i = inputNamed(name); if (i) { state.inputs.delete(name); emit('InputRemoved', SUB.Inputs, { inputName: name, inputUuid: i.uuid }); } },
    addInput: (name, kind, extra) => { addInput(name, kind, extra); emit('InputCreated', SUB.Inputs, { inputName: name, inputUuid: inputNamed(name).uuid, inputKind: kind ?? 'wasapi_input_capture' }); },
    removeFilter: (source, filter) => { const s = inputNamed(source); if (s) s.filters = s.filters.filter((f) => f.filterName !== filter); },
    setFilterEnabledByHand: (source, filter, on) => { const f = inputNamed(source)?.filters.find((x) => x.filterName === filter); if (f && f.filterEnabled !== on) { f.filterEnabled = on; emit('SourceFilterEnableStateChanged', SUB.Filters, { sourceName: source, filterName: filter, filterEnabled: on }); } },
    setMutedByHand: (name, muted) => { const i = inputNamed(name); if (i && i.muted !== muted) { i.muted = muted; emit('InputMuteStateChanged', SUB.Inputs, { inputName: name, inputUuid: i.uuid, inputMuted: muted }); } },
    setVolumeByHand: (name, db) => { const i = inputNamed(name); if (i) { i.volumeDb = db; emit('InputVolumeChanged', SUB.Inputs, { inputName: name, inputUuid: i.uuid, inputVolumeMul: dbToMul(db), inputVolumeDb: db }); } },
    /** Change the password; `kick` drops existing connections (as restarting the WebSocket server in OBS does). */
    setPassword: (pw, { kick = true } = {}) => { password = pw; if (kick) api.dropConnections(); },
    /** The microphone (or any input) is at this level for `ms` milliseconds. */
    injectMeter: (inputName, { db = -20, mul, ms = 500 } = {}) => { state.meters.set(inputName, { mul: mul ?? dbToMul(db), until: Date.now() + ms }); },
    setLatency: (ms, type = null) => { if (type) behaviours.latencyByType.set(type, ms); else behaviours.latencyMs = ms; },
    /** The next request of this type is never answered. */
    hangNext: (type) => behaviours.hangNext.add(type),
    failNext: (type, code = 702, comment = 'The request failed (stand-in)') => behaviours.failNext.set(type, { code, comment }),
    dropResponses: (on) => { behaviours.dropResponses = !!on; },
    async close() { clearInterval(meterTimer); await closeServer(); }
  };
  return api;
}
