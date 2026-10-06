/**
 * THE ALLOW-LIST. Every request the Companion sends to OBS goes through `checkRequest` first, in the client, before anything touches the socket,
 * and every request inside a batch is checked the same way (one bad request rejects the whole batch). Default deny: a request type that is not
 * listed here cannot be sent, whatever the caller (or the server) asks for.
 *
 * Never allowed, by omission: starting or stopping the stream or the recording, any other output (virtual camera, replay buffer), GetStreamServiceSettings
 * (it RETURNS THE STREAM KEY), SetStreamServiceSettings, profile / scene-collection / video-settings changes, creating or removing anything, renaming,
 * SetInputSettings, projectors and dialogs, vendor requests, hotkeys, custom events, Sleep, persistent data, screenshots. The stream is only ever
 * started and stopped by a person in OBS.
 */

export const ALLOWED_REQUESTS = [
  'GetVersion', 'GetStats', 'GetSceneList', 'GetCurrentProgramScene', 'SetCurrentProgramScene', 'GetStudioModeEnabled',
  'GetInputList', 'GetInputMute', 'SetInputMute', 'GetInputVolume', 'SetInputVolume',
  'GetSourceFilterList', 'GetSourceFilter', 'SetSourceFilterEnabled', 'SetSourceFilterSettings',
  'GetMediaInputStatus', 'TriggerMediaInputAction', 'GetStreamStatus', 'GetRecordStatus'
] as const;
export type AllowedRequest = (typeof ALLOWED_REQUESTS)[number];
const ALLOWED = new Set<string>(ALLOWED_REQUESTS);
export const isAllowedRequest = (t: unknown): t is AllowedRequest => typeof t === 'string' && ALLOWED.has(t);

/** What a request may touch. The caller supplies the configured names; everything else is refused. */
export interface ObsPolicy {
  /** Inputs the Companion may mute / unmute (the music source, and the camera audio inputs that Camera Off mutes when there is no Camera Off scene). */
  mutableInputs: readonly string[];
  /** The one input whose volume may be changed (the music). */
  volumeInput: string | null;
  /** The one source that carries the ducking filter. */
  duckingSource: string | null;
  /** The one ducking filter. */
  duckingFilter: string | null;
  /** The one Media Source that may be played / paused. */
  mediaSource: string | null;
}
export const EMPTY_POLICY: ObsPolicy = { mutableInputs: [], volumeInput: null, duckingSource: null, duckingFilter: null, mediaSource: null };

export const MEDIA_ACTIONS = ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'] as const;

export class ObsRequestDenied extends Error {
  constructor(readonly requestType: string, readonly why: string) { super(`OBS request "${String(requestType).slice(0, 60)}" refused by the Companion: ${why}`); this.name = 'ObsRequestDenied'; }
}

type Data = Record<string, unknown>;
const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const isObj = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);
const SETTING_KEY = /^[A-Za-z0-9_]{1,40}$/;

type Spec = { keys: readonly string[]; check?: (d: Data, p: ObsPolicy) => string | null };
const none: Spec = { keys: [] };
const SPECS: Record<AllowedRequest, Spec> = {
  GetVersion: none, GetStats: none, GetSceneList: none, GetCurrentProgramScene: none, GetStudioModeEnabled: none, GetStreamStatus: none, GetRecordStatus: none,
  GetInputList: { keys: ['inputKind'], check: d => (d.inputKind === undefined || isName(d.inputKind) ? null : 'inputKind must be text') },
  SetCurrentProgramScene: { keys: ['sceneName', 'sceneUuid'], check: d => (isName(d.sceneName) !== isName(d.sceneUuid) ? null : 'name the scene by sceneName or sceneUuid (one of them)') },
  GetInputMute: { keys: ['inputName', 'inputUuid'], check: d => (isName(d.inputName) !== isName(d.inputUuid) ? null : 'name the input') },
  GetInputVolume: { keys: ['inputName', 'inputUuid'], check: d => (isName(d.inputName) !== isName(d.inputUuid) ? null : 'name the input') },
  GetMediaInputStatus: { keys: ['inputName', 'inputUuid'], check: d => (isName(d.inputName) !== isName(d.inputUuid) ? null : 'name the input') },
  SetInputMute: {
    keys: ['inputName', 'inputMuted'],
    check: (d, p) => (!isName(d.inputName) ? 'inputName is required (an input is muted by its name)' : typeof d.inputMuted !== 'boolean' ? 'inputMuted must be true or false' : p.mutableInputs.includes(d.inputName) ? null : 'only the configured music source (and the configured camera audio inputs) may be muted')
  },
  SetInputVolume: {
    keys: ['inputName', 'inputVolumeDb', 'inputVolumeMul'],
    check: (d, p) => {
      if (!isName(d.inputName)) return 'inputName is required';
      if (p.volumeInput !== d.inputName) return 'only the configured music source may have its volume changed';
      const db = d.inputVolumeDb, mul = d.inputVolumeMul;
      if ((typeof db === 'number') === (typeof mul === 'number')) return 'send inputVolumeDb or inputVolumeMul (one of them, a number)';
      if (typeof db === 'number' && !(db >= -100 && db <= 0)) return 'volume must be between -100 dB and 0 dB';
      if (typeof mul === 'number' && !(mul >= 0 && mul <= 1)) return 'volume must be between 0 and 1';
      return null;
    }
  },
  GetSourceFilterList: { keys: ['sourceName', 'sourceUuid'], check: d => (isName(d.sourceName) !== isName(d.sourceUuid) ? null : 'name the source') },
  GetSourceFilter: { keys: ['sourceName', 'sourceUuid', 'filterName'], check: d => ((isName(d.sourceName) !== isName(d.sourceUuid)) && isName(d.filterName) ? null : 'name the source and the filter') },
  SetSourceFilterEnabled: {
    keys: ['sourceName', 'filterName', 'filterEnabled'],
    check: (d, p) => (!isName(d.sourceName) || !isName(d.filterName) ? 'name the source and the filter' : typeof d.filterEnabled !== 'boolean' ? 'filterEnabled must be true or false'
      : d.sourceName === p.duckingSource && d.filterName === p.duckingFilter && p.duckingSource && p.duckingFilter ? null : 'only the configured ducking filter on the configured music source may be switched')
  },
  SetSourceFilterSettings: {
    keys: ['sourceName', 'filterName', 'filterSettings', 'overlay'],
    check: (d, p) => {
      if (!isName(d.sourceName) || !isName(d.filterName)) return 'name the source and the filter';
      if (!(d.sourceName === p.duckingSource && d.filterName === p.duckingFilter && p.duckingSource && p.duckingFilter)) return 'only the configured ducking filter on the configured music source may be changed';
      if (!isObj(d.filterSettings)) return 'filterSettings must be an object';
      for (const [k, v] of Object.entries(d.filterSettings)) { if (!SETTING_KEY.test(k) || !(typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) return 'filter settings are plain numbers, text or true/false'; }
      if (d.overlay !== undefined && typeof d.overlay !== 'boolean') return 'overlay must be true or false';
      return null;
    }
  },
  TriggerMediaInputAction: {
    keys: ['inputName', 'mediaAction'],
    check: (d, p) => (!isName(d.inputName) ? 'inputName is required' : !(MEDIA_ACTIONS as readonly unknown[]).includes(d.mediaAction) ? 'only play and pause are allowed' : p.mediaSource && d.inputName === p.mediaSource ? null : 'only the configured Media Source may be played or paused')
  }
};

/** null = allowed. Otherwise the reason (plain words). Never throws, whatever it is given. */
export function checkRequest(type: unknown, data: unknown, policy: ObsPolicy): string | null {
  if (typeof type !== 'string' || !ALLOWED.has(type)) return `"${String(type).slice(0, 60)}" is not a request the Companion may send`;
  const spec = SPECS[type as AllowedRequest];
  const d: Data = data === undefined || data === null ? {} : (data as Data);
  if (!isObj(d)) return 'request data must be an object';
  for (const k of Object.keys(d)) if (!spec.keys.includes(k)) return `"${k.slice(0, 40)}" is not a field this request may carry`;
  return spec.check ? spec.check(d, policy) : null;
}

export function assertRequestAllowed(type: unknown, data: unknown, policy: ObsPolicy): asserts type is AllowedRequest {
  const why = checkRequest(type, data, policy);
  if (why) throw new ObsRequestDenied(String(type), why);
}

export interface BatchItem { requestType: string; requestData?: Data }
/** A batch is checked as a whole BEFORE anything is sent. */
export function assertBatchAllowed(items: unknown, policy: ObsPolicy): asserts items is BatchItem[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new ObsRequestDenied('RequestBatch', 'a batch is 1 to 50 requests');
  for (const it of items) {
    if (!isObj(it)) throw new ObsRequestDenied('RequestBatch', 'every batch item must be an object');
    for (const k of Object.keys(it)) if (k !== 'requestType' && k !== 'requestData' && k !== 'requestId') throw new ObsRequestDenied(String(it.requestType), `"${k.slice(0, 40)}" is not a field a batch item may carry`);
    assertRequestAllowed(it.requestType, it.requestData, policy);
  }
}
