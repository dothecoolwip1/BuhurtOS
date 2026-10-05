# Real-device checklist: install, alerts, tap

CI and the sandbox cannot prove that a physical phone receives a push. These steps can only be done by a person with a phone.
**Nothing below has been performed. Do not tick a box unless you actually did it, and write the date, device and OS version beside it.**

Before you start: production must be on a build that includes Pack 12, and the hosted database must have the Pack 12 migrations (see
`PACK12_HOSTED_ROLLOUT.md`). Use a real account, or one of the test accounts for a first run (test events never push, but "Send me a test" always does).

## Android (Chrome)
- [ ] Open the site in Chrome. An "Install BuhurtOS" card shows on Home or Account; install it (or Chrome menu → Install app).
- [ ] Launch from the home screen: opens full screen with no browser bar (standalone), BuhurtOS icon and name.
- [ ] Sign in. Open Account → Notifications. Press **Turn on alerts on this device**; Android asks for permission; allow it.
- [ ] Account shows "Alerts are on for this device" and the device is listed as "This device".
- [ ] Press **Send me a test**. Swipe the app away (close it) and lock the phone.
- [ ] The test notification arrives on the lock screen without the app open. Tap it: BuhurtOS opens on Account.
- [ ] Event-day rehearsal: register with a test account in a test event is NOT enough (test events never push). Use a real or practice event with the organizer moving your fight to **in the hole**, **on deck**, **now**. Each should arrive once, with the right field.
- [ ] Tap an alert while the app is closed: it opens My next fight for that event. Tap one while the app is open: it routes in place.
- [ ] Switch the "Fights" group off, trigger a fight alert: nothing arrives; the bell still lists it.
- [ ] Turn airplane mode on and open the app: the shell opens and says "You are offline".
- [ ] Update behaviour: after a new release, the app shows "A new version is ready" and does not reload while you are scoring.

## iPhone / iPad (Safari, iOS 16.4 or later)
- [ ] In Safari, open the site, Share → Add to Home Screen. The Home Screen icon is the BuhurtOS shield.
- [ ] In Safari (not installed), Account → Notifications says alerts need the Home Screen app first.
- [ ] Launch from the Home Screen icon (standalone). Sign in.
- [ ] Account → Notifications → **Turn on alerts on this device**; iOS asks permission; allow it.
- [ ] Close the app, lock the phone, press **Send me a test** from another device signed in as the same person (or before closing). The notification arrives.
- [ ] Tap it: BuhurtOS opens on the destination.
- [ ] Event rehearsal as above (in the hole, on deck, now).

## Both
- [ ] Sign out on the phone: no further alerts for that person arrive on it. Sign in as someone else on the same phone: they get only their own.
- [ ] A fighter without an account is simply not alerted; nothing breaks for the others.
- [ ] If an alert does not arrive, the fighter's place in the line is still correct on My next fight, and the event runs normally.
