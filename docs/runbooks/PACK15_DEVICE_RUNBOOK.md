# Pack 15: checking alerts on a real phone (Android first, then iPhone / iPad)

Automated tests prove the alert logic, the database, the service worker and the screens. They cannot prove that Google's or Apple's push
service delivers to YOUR phone. This list does. It takes about 15 minutes. Nothing here changes real results.

Before you start: Pack 15 must be released (merged, deployed, and its migration applied to the hosted database). Use the production address,
`https://dothecoolwip1.github.io/BuhurtOS/`.

## Android (Chrome)
1. **Open** the production address in Chrome on the phone.
2. **Install.** Use the "Install BuhurtOS" card, or Chrome's menu ⋮ → *Install app* / *Add to Home screen* → Install. An icon called BuhurtOS
   appears on the home screen. Open it from there: it should open full screen, with no address bar.
3. **Sign in** inside the installed app, with your email code or Google. You stay signed in when you close and reopen it.
4. **Turn on alerts.** Account → Notifications → *Turn on alerts on this device* → Allow. The status should read
   *Browser permission: Allowed* and *BuhurtOS alerts on this device: On*, and this phone appears under *Your devices* as "Android phone".
5. **Confirm the subscription.** Press *Send me a test*. Within a few seconds a "BuhurtOS test" notification arrives.
   Close the app completely (swipe it away), press *Send me a test* from another device or a browser tab signed in as you, and check it still
   arrives. Under *Your devices* the phone now shows "Last alert just now".
6. **Use a safe test event.** Use an event marked as test data (for example "Test stuff test"), or create a new event, publish it, and add
   yourself as a fighter in a duel with two or three other fights on the same field. Test events show alerts in the bell but do **not** push.
   To check a real push, use a normal (non-test) event that nobody else is using, then cancel it afterwards.
7. **Trigger the alerts** from another device signed in as the organizer, on Manage › Event day:
   - Start the field. If you are in the third fight, you get **"You're 2 fights away"**.
   - Record a result for the first fight. You get **"You're up next · Report to Field 1 and be ready to fight"**.
   - Record the next result. You get **"Your fight is ready · Report to Field 1 now"**.
   - Move your fight to another field (Event day → the fight → field). You get **"Your fight changed field"**.
   - Send an announcement from Event day → *Announce to the event*. You get it, titled with the event name.
8. **Check with the app closed / in the background** (screen locked, app swiped away). Each alert must still appear on the lock screen.
   A newer alert for the same fight replaces the older one.
9. **Tap** the alert.
10. **Check where it opens.** A fight alert opens the event at *My next fight*. An announcement opens the event, and a team alert opens the team.
    If you were signed out, the event page asks you to sign in right where *My next fight* is, and shows it after you sign in.

Also try:
- **Block notifications** for BuhurtOS in Android settings, then open the app. The status reads *Blocked*, and the phone drops off *Your devices* (no alerts are sent to it).
- **Flight mode** for a minute while the organizer moves the line. The app says *You are offline*. When signal returns, the bell shows what you missed without a refresh, and nothing appears twice.

## iPhone and iPad (iOS / iPadOS 16.4 or newer)
- **Push only works for the Home Screen app, never in a Safari tab.** That is Apple's rule, not a BuhurtOS one. Settings will say *Add BuhurtOS to your Home Screen first*.
- To install: Safari → Share (the square with an arrow) → *Add to Home Screen* → Add. Open BuhurtOS **from the Home Screen icon**.
- Sign in again inside the Home Screen app. It keeps its own sign-in, separate from Safari.
- Then follow Android steps 4 to 10. The permission prompt only appears after you press *Turn on alerts*.
- Known iOS limits:
  - There is no install button: the steps are shown instead.
  - Alerts may be grouped or delayed by Focus modes.
  - Removing the Home Screen app removes its alerts.

## What to write down
For each step: passed or failed, the phone model, the Android or iOS version and the browser. Note the time an alert arrived compared with when the organizer acted. Record the results in `STATUS.md` (Pack 15, "physical device").
