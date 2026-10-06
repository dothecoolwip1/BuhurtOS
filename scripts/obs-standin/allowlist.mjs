// An INDEPENDENT copy of the request allow-list (the Companion has its own in tools/obs-controller/src/obs/allowlist.ts). The stand-in's test harness checks its
// request log against THIS copy, so a request the Companion should never send is caught even if the Companion's own list were wrong. A unit test also asserts
// the two lists are identical.
export const ALLOWED_REQUESTS = [
  'GetVersion', 'GetStats', 'GetSceneList', 'GetCurrentProgramScene', 'SetCurrentProgramScene', 'GetStudioModeEnabled',
  'GetInputList', 'GetInputMute', 'SetInputMute', 'GetInputVolume', 'SetInputVolume',
  'GetSourceFilterList', 'GetSourceFilter', 'SetSourceFilterEnabled', 'SetSourceFilterSettings',
  'GetMediaInputStatus', 'TriggerMediaInputAction', 'GetStreamStatus', 'GetRecordStatus'
];
export const ALLOWED_MEDIA_ACTIONS = ['OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'];

/** Requests that would be a serious problem if the Companion ever sent one. The stand-in implements them (so a mistake WOULD show up) and flags them. */
export const DANGEROUS_REQUESTS = [
  'StartStream', 'StopStream', 'ToggleStream', 'GetStreamServiceSettings', 'SetStreamServiceSettings', 'StartRecord', 'StopRecord', 'ToggleRecord',
  'StartVirtualCam', 'StopVirtualCam', 'StartReplayBuffer', 'SaveReplayBuffer', 'RemoveScene', 'CreateScene', 'RemoveInput', 'CreateInput', 'SetInputSettings', 'SetInputName',
  'SetSceneName', 'SetCurrentProfile', 'SetCurrentSceneCollection', 'SetVideoSettings', 'TriggerHotkeyByName', 'TriggerHotkeyByKeySequence', 'CallVendorRequest',
  'BroadcastCustomEvent', 'Sleep', 'SetPersistentData', 'SaveSourceScreenshot', 'OpenInputPropertiesDialog', 'OpenVideoMixProjector', 'SetStudioModeEnabled', 'TriggerStudioModeTransition',
  'RemoveSourceFilter', 'CreateSourceFilter', 'SetCurrentPreviewScene'
];

/**
 * Check a request log against the allow-list. `scope` (optional) adds the Companion's narrower rules: which inputs may be muted / have a volume change,
 * which source+filter may be switched, which Media Source may be played or paused.
 * Returns the offending entries (empty = clean).
 */
export function violations(log, scope = null) {
  const bad = [];
  for (const e of log) {
    const why = [];
    if (!ALLOWED_REQUESTS.includes(e.type)) why.push('request type is not on the allow-list');
    const d = e.data ?? {};
    if (e.type === 'TriggerMediaInputAction' && !ALLOWED_MEDIA_ACTIONS.includes(d.mediaAction)) why.push('media action is not play/pause');
    if (scope) {
      if (e.type === 'SetInputMute' && !(scope.mutable ?? []).includes(d.inputName)) why.push('muted an input outside the configured set');
      if (e.type === 'SetInputVolume' && d.inputName !== scope.music) why.push('changed the volume of an input other than the music source');
      if ((e.type === 'SetSourceFilterEnabled' || e.type === 'SetSourceFilterSettings') && !(d.sourceName === scope.music && d.filterName === scope.filter)) why.push('changed a filter other than the configured ducking filter');
      if (e.type === 'TriggerMediaInputAction' && d.inputName !== scope.media) why.push('triggered media on an input other than the configured Media Source');
    }
    if (why.length) bad.push({ ...e, why });
  }
  return bad;
}
