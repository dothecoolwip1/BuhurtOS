# OBS stand-in (NOT OBS)

`server.mjs` is a small Node server that speaks the obs-websocket v5 protocol so the BuhurtOS Broadcast Companion (`tools/obs-controller`) can be tested without OBS.

**It is a stand-in.** A run against it is "stand-in verified", never "OBS verified". It proves protocol handling, the request allow-list, the reconcile logic and recovery behaviour. It proves nothing about real OBS: rendering, cameras, audio ducking quality, the WebSocket bind address, the firewall, or Windows/macOS packaging. Those are in the physical checklist (`docs/claude-packs/PACK_18_1_CONTROLLER.md`).

What it implements: Hello / Identify / Identified with the real challenge + salt SHA-256 authentication; `Request` / `RequestResponse` with OBS status codes; `RequestBatch`; every allow-listed request with realistic response shapes; the events the Companion listens to (`CurrentProgramSceneChanged`, `InputMuteStateChanged`, `InputVolumeChanged`, `SourceFilterEnableStateChanged`, `MediaInputActionTriggered`, `ExitStarted`, scene / input list changes, `InputVolumeMeters` for clients that subscribe to them).

It also implements the requests the Companion must never send (`StartStream`, `GetStreamServiceSettings`, ...) **so that a mistake would really happen here** and show in the log. `startStandIn().violations()` checks the request log against an independent copy of the allow-list (`allowlist.mjs`).

Fault injection: `dropConnections()`, `exit()` / `start()` / `restart()`, `removeScene()`, `removeInput()`, `removeFilter()`, `setPassword()`, `injectMeter()`, `setLatency()`, `hangNext()`, `failNext()`, `dropResponses()`, and "operator by hand" helpers (`setProgramByHand`, `setMutedByHand`, ...).

By hand: `node scripts/obs-standin/cli.mjs --port 4455 --password secret` (control API on 4456, see the header of `cli.mjs`). Needs `npm install` in `tools/obs-controller` (it borrows `ws` from there).
