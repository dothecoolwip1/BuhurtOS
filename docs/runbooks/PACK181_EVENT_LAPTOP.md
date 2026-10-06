# The streaming laptop: OBS, the Broadcast Companion and the music (Pack 18.1)

For Garrett (or whoever runs the stream). No source editing. **Nothing in this runbook has been done on real OBS, real cameras, a real microphone or a real venue network: the pack was built and tested against an OBS stand-in. Every box in section 10 is yours to tick before an event depends on it.**

The tournament never depends on any of this. Timer, rounds, scoring, queue and results (Pack 13) and **Camera Off in BuhurtOS** work with the Companion, OBS and the laptop completely absent. If the automation fails you operate OBS by hand and the stream carries on.

## 0. What each piece does
| Piece | Does | Never does |
| --- | --- | --- |
| **OBS** | the stream, the scenes, the audio mixing and the music ducking (all millisecond-level audio is OBS's own) | |
| **Broadcast Companion** (`tools/obs-controller`) | follows the real fight and puts the right scene on air; shows the Camera Off scene the instant it is asked; mutes/restores the music by fight state; reports its health to the Command Centre | start or stop the stream (**going live stays your decision**), read your stream key, change OBS settings, accept commands from the internet |
| **Command Centre → Broadcast** | shows whether the Companion is alive; lets an organizer / Event Admin choose Auto or Manual, which Lyst, Holding or Break, and music mode | |
| **Camera Off** | the safety switch: everyone on the staff list who may protect the broadcast can turn the cameras off; only the head marshal, Event Admin, organizer or owner can turn them back on | |

The Companion is the **stream laptop's own identity** (a "controller" code), not a ninth staff device.

## 1. Software on the laptop
Current stable OBS Studio (32.x at the time of writing), a browser, **Node 22** and the Companion folder (`tools/obs-controller`, built once with `npm ci && npm run build`, which produces the single file `dist/companion.mjs`). Nothing else. Windows and macOS launchers exist (`.bat`, `.command`) but **have not been run on Windows or macOS**: try them at home first.

## 2. OBS: WebSocket (once)
1. OBS → **Tools → WebSocket Server Settings** → Enable, **long password**, note the port (default 4455).
2. **Firewall:** block inbound 4455 from everything except this laptop. The Companion only ever talks to OBS on `127.0.0.1`. Check: a phone on the venue Wi-Fi must fail to connect to `<laptop-ip>:4455`.
3. The password is pasted into the Companion once and stored with the operating system's protection (Windows DPAPI, macOS Keychain, else an owner-only file). It is never shown again, logged or sent anywhere.

## 3. OBS: scenes (once per event)
Build these scenes and name them anything you like (the Companion asks you to map them):
- **Lyst N Live** for each Lyst: that Lyst's camera + the Pack 14 overlay as a Browser source (1920×1080; *Shutdown source when not visible* **off**; do not sign in, the overlay link is public). See `PACK14_OBS_SETUP.md`.
- **Holding** (logo or "next fight soon"), **Break**.
- **Camera Off**: a **static image only**, no camera, no live audio from a camera.
Test each camera before the event.

## 4. OBS: audio (once)
- Sources: **Announcer Mic** (the wireless receiver) and **Music**.
- **Mic Noise Gate** (so breaths and room noise do not trip the ducking).
- **Compressor on Music, sidechain = Announcer Mic.** This is the ducking, done inside OBS. Starting values (engineering judgement, **tune with your real wireless mic**): threshold about −30 dB, ratio 6–10, attack 10–20 ms, release 1000 ms (OBS caps release at 1000 ms), output gain 0. Aim for the music dropping to roughly 10–20 % under speech and coming back within 1–2 s of the mic going quiet.
- The Companion screen has **Audio setup** (check the sources and the ducking filter exist) and the mapping fields. It cannot create filters; you do that in OBS.

### Which music? (no scraping, no ripping, no workarounds)
1. **Recommended, guaranteed:** local licensed or stream-safe tracks in an OBS **Media Source** playlist. The Companion can play/pause, mute and fade it.
2. An app or browser playlist that **a person starts**, captured by OBS (Windows Application Audio Capture, or a macOS routing source). The Companion can mute, fade and duck it but cannot press play; "Pause" then means Mute.
3. A mixer line-in.
**Spotify and YouTube are not automated.** Their terms do not cover public or commercial playback or separating the audio, and a recording on a livestream risks muted VODs and strikes. In the venue it is a public performance (in Canada SOCAN and Re:Sound, usually held by the venue): **ask the venue; do not assume it has a licence.** Treat anything on the livestream as stream-safe only.

### Where the sound goes ("which do I have?")
- **A. PA fed from the OBS monitor output.** OBS has one monitoring device; per source: Off / Monitor only / Monitor and output. Music: both. The announcer mic normally goes to the PA **directly**, not through OBS (feedback).
- **B. PA fed by the mixer;** OBS has its own mic/mixer feed; music in OBS is stream-only; venue music is separate.
- **C. Virtual audio cable** (VB-Cable / BlackHole / Loopback, not official OBS features) for a second mix.
Test: play music, speak into the mic, and listen in the room **and** on the stream. The Companion has no routing control; routing is one-time OBS setup. Menu labels may differ on your OBS version.

## 5. The controller code
Command Centre → **Event devices → Stream laptop → Create** (organizer only). The code is shown once. Lost it? **Replace** (the old one dies immediately). Stolen laptop? **Revoke**. It can only read public data, read its own instructions and report that it is alive.

## 6. Start the Companion
Run `start/start-broadcast.sh` (Linux), `Start BuhurtOS Broadcast.command` (macOS) or `Start BuhurtOS Broadcast.bat` (Windows). The loop restarts it a couple of seconds after any crash (it comes back with its settings and **its Camera Off latch**); **Quit** on its screen (or Ctrl+C) stops the loop.
Open **http://127.0.0.1:4777** on the laptop (that is the only address it answers). First run: paste the OBS password and the controller code, set the BuhurtOS address and key, map the scenes in the wizard (each Lyst lights green), press **Test** on each scene, test **Camera Off** and the on-laptop clear. The lights show OBS, BuhurtOS and scenes.

## 7. During the event
- **AUTO** (default): the camera follows the live fight. It stays on the current fight until it is over (no thrashing), and moves to another Lyst only when that fight ends (earliest-started, then your priority order). Score, clock and penalty changes **never** change the scene. Fight over → winner screen → next called fight; "Holding" shows only when no fight is called on the Lyst.
- **Manual** (organizer / Event Admin in Command Centre → Broadcast, or **Take / Holding / Break** on the laptop): you choose; **Return to Auto** hands control back without replaying anything.
- **A scene changed by hand in OBS is put back within about a second** (that is what reconciling means; Camera Off in particular must be). To take over by hand quit the Companion (the stream carries on) or press a local **Take**.
- **Camera Off:** anyone allowed taps it → the Companion switches to the Camera Off scene and mutes the camera audio inputs you listed. It stays off through new fights, AUTO changes, OBS restarting, the Companion restarting and the laptop losing internet, until an authorized person releases it in BuhurtOS **and** (if it was pressed on the laptop) the laptop's confirmed clear. A **medical** Camera Off also locks the music muted until someone chooses Resume (or sets Music Muted then Auto in the Command Centre).
- **Music:** muted during a fight and its pauses; on between fights and in breaks; muted under Camera Off (it never switches music on by itself); Auto Duck off shows a warning.
- The Command Centre shows **Stream controller not connected** or **Silent for N s** when the laptop is gone; the old values are dimmed.

## 8. Failure drills (each must end with the stream correct)
Quit OBS mid-fight · close and reopen the Companion · unplug the network 60 s · unplug a camera · wrong OBS password · microphone unplugged (music mutes rather than becoming un-duckable) · Camera Off through each of the above.

## 9. If it all fails
Use OBS by hand (the scene list); the stream and the tournament carry on unchanged. Camera Off can still be pressed in BuhurtOS (by anyone allowed) and on the laptop's local screen. To tell BuhurtOS's state from OBS's: the Companion screen shows both ("on air", and why).

## 10. Physical checklist (NOT performed by the build: tick before relying on it)
- [ ] OBS WebSocket reachable from the Companion; a phone on venue Wi-Fi **cannot** reach 4455
- [ ] Real obs-websocket accepts the Companion's requests (scene list, switch, input list, mute, volume, filter list/enable, media play/pause, stream/record **status reads**) and the stream was never started or stopped by it
- [ ] Each camera, each Lyst scene, the overlay on air; the Camera Off scene shows no camera
- [ ] Real fight, AUTO: the scene follows; the second Lyst does not steal the shot; manual Take / Holding / Break / Return to Auto
- [ ] Camera Off pressed by a Marshal phone, Announcer tablet, Secretary tablet and the laptop; released by Head Marshal / Event Admin / organizer; a Counter has no button
- [ ] Camera Off stays through: next fight, OBS quit and reopen, Companion kill and restart, network unplugged
- [ ] Wireless mic: ducking depth, attack, release, no pumping between words, the gate ignores breaths; mic unplugged
- [ ] Venue PA vs livestream routing (A/B/C) checked by ear in the room and on the stream
- [ ] Windows or macOS launcher and credential store (DPAPI / Keychain) work on the actual laptop
- [ ] The eight devices (`PACK181_DEVICES.md`): four Counter phones, Secretary/Scorekeeper tablet, Marshal phone, Announcer tablet, Event Admin tablet on the venue network; one revoked; one replaced
- [ ] Hosted checks in `PACK181_HOSTED_ROLLOUT.md` section 6 (device token accepted by hosted Supabase, signing key, Edge Function CORS)
