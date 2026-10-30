# Custom domain: buhurt-os.app

Registrar and DNS: Porkbun (nameservers stay at Porkbun). Hosting: Vercel project `buhurt-os`.
`https://buhurt-os.app` is the primary address; `www.buhurt-os.app` redirects to it (308).
`https://buhurt-os.vercel.app` keeps working throughout and is not redirected until the owner says so.

## Status (2026-10-30)

| Step | State |
| --- | --- |
| a. Vercel domains | `buhurt-os.app` and `www.buhurt-os.app` (→ apex, 308) added to the project. Waiting on Porkbun DNS. |
| a. Porkbun DNS | Owner to enter (below). |
| b. Supabase Auth URLs | Owner to enter in the dashboard (no connector access to Auth config). |
| c. Google OAuth origins | Owner to enter in Google Cloud. |
| d. `DEVICE_ALLOWED_ORIGINS` | Needs owner go-ahead; set value below. |
| e. Email sender | Owner to choose provider and add DNS records. |
| f. Hard-coded links | All app links (QR, device, check-in, calendar, share, overlays, auth redirects, push clicks) are built from `window.location.origin` or relative routes. Only `index.html` social preview images and the calendar fallback origin were hard-coded; both now use `buhurt-os.app`. `private.push_config.vapid_subject` on hosted is still `https://buhurt-os.vercel.app/` (a contact URI only; harmless). |
| g. Live verification | Not done. |

## Porkbun DNS

Delete Porkbun's default parking records first (the `ALIAS`/`A` on the bare domain and the `CNAME` on `*` / `www` pointing at `pixie.porkbun.com`). Then add:

| Type | Host | Answer | TTL |
| --- | --- | --- | --- |
| A | (blank) | 216.198.79.1 | 600 |
| CNAME | www | cname.vercel-dns.com | 600 |

Vercel issues HTTPS on its own once these resolve.

## Supabase Auth → URL Configuration

- Site URL: `https://buhurt-os.app`
- Redirect URLs (keep the existing vercel.app entries): `https://buhurt-os.app/**`, `https://www.buhurt-os.app/**`

## Google Cloud OAuth client

Authorized JavaScript origins: add `https://buhurt-os.app` and `https://www.buhurt-os.app` (only if the list is used). The redirect URI stays `https://mvbxlebznlgroptwwdsm.supabase.co/auth/v1/callback`.

## Edge function secret

`DEVICE_ALLOWED_ORIGINS=https://buhurt-os.app,https://www.buhurt-os.app,https://buhurt-os.vercel.app`

## Things that do not carry across origins

Browsers keep these per address, so a phone that moves from vercel.app to buhurt-os.app starts fresh:
sign-in session, installed PWA, push subscription, and the IndexedDB scoring outbox.
Never move a scoring tablet or counter phone to the new address while it has unsynced work; let it sync first.
Fighters who installed the app or turned on notifications need to do it again on the new address.
