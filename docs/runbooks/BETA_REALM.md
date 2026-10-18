# The beta realm (build flag) and the Announcer's hype calls

Status date: 2026-10-18. First piece of the beta realm (owner notes, 2026-10-17): a build flag that marks a deployment as **beta**, and the first
tester-only feature behind it. The separate beta Supabase project, tester accounts and the "what needs testing" scroll are not built yet; this is the
switch they will hang off.

## The flag

`VITE_REALM=beta` at build time makes a **beta** build. Unset, or any other value, is **live**. Read through `src/lib/realm.ts` (`isBeta()`), nowhere else.

- Vercel: set `VITE_REALM` = `beta` as an environment variable on the beta project (or the Preview environment), leave it unset on production.
- GitHub Pages (production): nothing to set; the workflow does not pass it, so Pages is always live.
- Locally: `VITE_REALM=beta npm run dev`.

The flag only changes what the screen shows. It is never a security boundary: every permission stays in the database, exactly as on live. A beta build
pointed at the live Supabase project is still the live database with extra buttons, so the beta build should only ever be deployed against the beta
project once that exists.

## Hype calls (Announcer, beta only)

On a beta build the Announcer view (`/events/<event>/announcer`) shows a **Hype calls** row under the top bar: big buttons, each a short pre-recorded
ring-announcer line ("Ladies and gentlemen", "Now fighting", "Up next", "In the hole", "Red corner", "Blue corner", "Fight!", "And the winner is",
"Let's get ready to buhurt"). One tap plays the call at full volume through whatever the tablet is plugged into; a second tap restarts it; a new call
cuts the one still playing. The lit button shows which call is playing. Taps are recorded as the `announcer_sound` action (clip id only).

Why pre-recorded: the day must not depend on a speech service, a key or a good connection. The clips are plain files under `public/announcer/`, load
with the app and are kept by the service worker once played (cache first, like every built file). That also means a replaced clip needs a **new file
name**, or phones keep serving the old one.

Files: `src/lib/announcer/sounds.ts` (the list and the player), `src/components/AnnouncerSounds.tsx` (the row), `src/styles/announcer.css` (bottom),
`src/lib/announcer/sounds.test.ts` (every listed clip must exist in the repo; the player's cut/restart rules).

### How the clips were made, and how to add one

ElevenLabs, model `eleven_v4`, library voice **World Wrestling Announcer** (voice id `LG95yZDEHg6fCZdQjLqj`), prompt `[shouting] [excited] <LINE>` with
the big words in capitals and `...` for a beat. Output MP3, 128 kbps mono, 1.5 to 3 seconds, about 40 credits (under half a cent) each.

To add a call: generate the clip the same way, save it as `public/announcer/<kebab-name>.mp3`, add a row to `ANNOUNCER_SOUNDS` in
`src/lib/announcer/sounds.ts` (id in `snake_case`, the label as the button should read), run `npm test`. Nothing else to wire.

Two longer demo reads (a full fight introduction in two voices) were made on 2026-10-18 and are not shipped; they live in the owner's chat history.
