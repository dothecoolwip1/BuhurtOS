# BuhurtOS Broadcast Companion

A small local process that sits beside OBS on the streaming laptop. It follows the real fight (from the same public data the Pack 14 overlay reads), puts the right OBS scene on air, applies **Camera Off** the instant it is asked, and keeps the music sensible. It **never starts or stops the stream**: going live stays a human decision.

The tournament never depends on it. Pack 13 (timer, rounds, scoring, queue, results) and Camera Off in BuhurtOS work with the Companion and OBS completely absent.

Full description, what was verified and what was not: `docs/claude-packs/PACK_18_1_CONTROLLER.md`. Setup for the operator: the event-laptop runbook (`docs/runbooks/PACK181_EVENT_LAPTOP.md`, written later in the pack).

## Run it

```
cd tools/obs-controller
npm ci                 # ws + @supabase/supabase-js (bundled in) + esbuild (build only)
npm run build          # -> dist/companion.mjs  (ONE file; the laptop only needs Node 22)
start/start-broadcast.sh        # Linux; macOS: "Start BuhurtOS Broadcast.command"; Windows: "Start BuhurtOS Broadcast.bat"
```

The start scripts are a crash-safe loop: a crash restarts the Companion after a couple of seconds (it comes back with its saved settings, its Camera Off latch and its credentials, and reconciles to the current truth); **Quit** on its screen (exit code 64) or Ctrl+C stops the loop. A shipped zip would put a pinned Node in `node/` (the scripts use it when present); there is no unsigned `.exe`.

Open **http://127.0.0.1:4777** (loopback only: any other address or Host name is refused). First run: paste the OBS WebSocket password and the controller code (from the BuhurtOS Command Centre), set the BuhurtOS address and key, and map the scenes in the wizard.

## What it needs

| Setting | Where | Note |
| --- | --- | --- |
| OBS WebSocket password | screen, stored with OS protection | never shown again, never logged, never sent anywhere |
| Controller code `XXXX-XXXX-XXXX` | screen, stored with OS protection | optional: without it AUTO still runs from public data and the laptop's own buttons work, it just cannot be commanded or monitored from BuhurtOS |
| BuhurtOS address + publishable key | screen / `BUHURTOS_SUPABASE_URL`, `BUHURTOS_SUPABASE_KEY` | identify the project; public by design |
| Event address (slug) | screen / `BUHURTOS_EVENT_SLUG` | only when there is no controller code (the code names the event) |
| Scene mapping, audio names | screen | stored in `config.json` (owner-only), no secrets in it |

Files live in `~/.buhurtos-broadcast` (or `BUHURTOS_COMPANION_HOME`): `config.json`, `state.json` (Camera Off latch, last known BuhurtOS answers, first-live times), `credentials.json` (only when the OS has no better store), `companion.log` (redacted). Credential stores: Windows DPAPI (PowerShell, value on stdin), macOS Keychain (`security -i`, value on stdin), else an owner-only 0600 file; environment variables `BUHURTOS_OBS_PASSWORD` / `BUHURTOS_CONTROLLER_CODE` are read-only and the weakest option.

## Safety, in one place

* **OBS requests are default-deny** (`src/obs/allowlist.ts`): 19 requests (version, stats, scene list/get/set, studio-mode read, input list/mute/volume, source filter list/get/enable/settings, media status/play-pause, stream and record status as READS). Everything else is refused **in the client before it is sent**, including each request inside a batch (one bad request refuses the whole batch). The stream is never started or stopped; `GetStreamServiceSettings` (which returns the stream key) cannot be called. Mute / volume / filter / media requests are further limited to the configured music source, the one ducking filter on it, and the one Media Source.
* **Loopback only**: the Companion connects only to OBS on this laptop (127.0.0.1) and listens only on 127.0.0.1:4777. It is not a remote agent: it makes outbound requests only, and the server sends it a closed vocabulary (AUTO/MANUAL, which Lyst, Camera Off, music mode, Auto Duck, priority order), never scene names, files or commands.
* **Camera Off** = BuhurtOS's state OR the local latch. Latched through new fights, fights ending, AUTO changes, OBS drop / restart, a Companion crash and restart, and loss of the internet ("unknown" is treated as "still off" if the last known answer was Off). Only an authorised release in BuhurtOS clears the server state, and only the local button clears the local latch.
* **Controller credential** (role `bos_controller`) can read public data, call `controller_state()` and report `broadcast_controller_heartbeat(...)`. Nothing else.

## Tests

`npm test` (inside this folder) or `npx vitest run tools/obs-controller` from the repo root (once the root vitest config includes `tools/**`). The tests run the real reader / decision / reconcile loop / audio policy against the **OBS stand-in** (`scripts/obs-standin`, NOT OBS) and a fake BuhurtOS. The real-stack scenario is `scripts/e2e/obs-live.sh`. **None of this is a real-OBS result.**
