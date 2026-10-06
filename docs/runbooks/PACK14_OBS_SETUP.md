# Pack 14: livestream and OBS overlay: setup and real-device checklist

The overlay is a public, read-only web page. It follows the real fight by itself: nobody operates it. If it looks wrong, the *data* is wrong or old; there is no overlay state to fix.

## Set up (organizer, once per event, about 5 minutes)
1. **Publish the event.** The overlay and the livestream block only show for published events (a draft shows nothing publicly).
2. **Manage › More options › Broadcast.** (Also reachable from *Event day › More tools › Livestream and OBS overlay*.)
3. Paste the **livestream link** (YouTube, Twitch or Vimeo, https only). A normal watch or live link plays inside the public event page; a link that cannot be embedded (for example a YouTube `@handle`) becomes a "Watch the stream" button. Optionally a title.
4. Choose corners (red/blue or each team's colours), whether to show records, photos / crests, sponsors, and how long each group of sponsors stays up. **Save.**
5. **Sponsors** (optional): name, title or partner, optional logo (PNG / JPEG / WebP, shrunk in the browser to 640 px). *Hide* keeps a sponsor but takes it off the overlay.
6. **OBS overlay:** pick the field, what to draw (everything / score bug only / fight order only / sponsors only) and the background. **Copy link.**

## In OBS (on the streaming computer)
1. Sources › **+** › **Browser**. Paste the link.
2. Width **1920**, height **1080** (the page scales itself if you use another size, letterboxed).
3. Leave *Shutdown source when not visible* **off** (so it keeps its state) and *Refresh browser when scene becomes active* **off**. Do not sign in: the link is public and cannot change anything.
4. Background is transparent: place the source above your video. For a hardware keyer or chroma key choose *Green screen* when copying the link.
5. One source per field. Use `layout=bug` as a second, always-on source and `layout=queue` / `layout=sponsors` as extra scenes if you want to place them yourself.
6. **Preview in a new tab** (admin) shows the same page on a dark background, with a small status dot (`?status=1`).

## What the operator sees on air (scenes, derived, never operated)
Stand by · Next fight coming up · Now on the field · Get ready (clock armed) · Live · Clock paused · Break / "Scores being confirmed…" · Equipment timeout · Disqualification countdown · Disqualification · Match complete (first 8 s) · Winner / result (about 25 s, the next fight announced beside it) · Up next.

## If something looks wrong
| On screen | Cause | Do |
| --- | --- | --- |
| Nothing at all, or "event not public" (preview) | event is a draft / organization disabled | publish the event |
| Old fight / frozen clock | the overlay lost the network. It marks itself stale after 20 s and re-reads the server on its own when the network returns | check the streaming computer's connection; in OBS right-click the source › Interact › reload only if it does not recover |
| Wrong fighter or score | the tablet (marshal) state is wrong | fix it on the lyst screen; the overlay follows within seconds |
| No logo | the picture could not load | re-upload the logo (Broadcast › Sponsors) |

## Real-device / real-OBS checklist (NOT performed in this pack: run it before relying on the overlay at an event)
- [ ] OBS (Windows or Mac) browser source at 1920×1080 loads the link; transparent background composites over a camera feed.
- [ ] A real live fight: score changes, penalties and the clock follow the tablet within about 3 s (with realtime) or 5 s (polling fallback).
- [ ] Unplug the streaming computer's network for 30 s mid-fight and reconnect: the overlay returns to the true clock and score without a refresh.
- [ ] Each of the scenes above appears at the right moment on a real field.
- [ ] YouTube and Twitch embeds play on the public event page on a phone (iOS Safari, Android Chrome); the live score updates beside the player.
- [ ] A sponsor logo with transparency looks right on the white sponsor strip; the longest real fighter and team names fit.
- [ ] The admin Broadcast screen is usable one-handed on a phone and tablet.
- [ ] Two overlays (Field 1, Field 2) in one OBS run side by side without interfering.

**Pack 18.1 addition:** the Companion (`tools/obs-controller`) is the automated way to switch these scenes and handle Camera Off and the music; its setup is `PACK181_EVENT_LAPTOP.md`.
