# Real-phone rehearsal checklist (required human verification)

**Status: NOT EXECUTED.** No physical phone was available to the coding session. The checks below were exercised only in desktop Chromium (a phone-sized
viewport with touch emulation) against a mocked backend, which proves the app's logic but not iOS Safari, Android Chrome, real radios, or battery and
background behaviour. Fill in the result column on real devices; do not mark Pack 04 verified on phones until every row is done.

Devices: at least one iPhone (Safari and, if used, the home-screen app) and one Android phone. Accounts: one scorekeeper, one second scorekeeper, one head marshal.
Use a throwaway event (the fictional test event) on the build that is actually deployed; write its build label (page footer) here: ____________________

| # | Step | Expected | Result / date / device |
|---|------|----------|------------------------|
| 1 | Open the field screen, sign in as scorekeeper A, open a match | Board opens; chip says "Pending: not official until you save" | |
| 2 | Score some strikes, then switch on **airplane mode** (screen stays open) | Chip shows "Pending: N score actions saved on this device"; scoring keeps working | |
| 3 | Finish the match and press Save while still in airplane mode | "Pending: NOT official yet" with the paper-sheet instruction; nothing says Official | |
| 4 | Write the result on the paper sheet | Paper sheet is the official fallback | |
| 5 | Close the browser completely, reopen the field screen **with signal back** | Half-scored board comes back; pending actions are delivered once (chip returns to "All score actions confirmed") | |
| 6 | Press Save again | "Official: saved on the server"; the head marshal list shows one result | |
| 7 | Sign in as scorekeeper B **on the same phone** while A still had pending actions | B sees "belong to another account"; nothing of A's is sent as B | |
| 8 | Two phones: A and B score the same match differently, both save | The second one sees "Needs review: not changed"; the official result is the first one | |
| 9 | Head marshal opens the field screen | "Needs review" lists both results; choosing one needs a note; afterwards one official result remains | |
| 10 | Head marshal enters a result from the paper sheet | Appears as official; correcting an existing result keeps the old value in the history | |
| 11 | Deploy a new build while a phone is mid-scoring (or simulate: publish a new build, leave the phone on the scoring screen) | Banner "A new version is ready ... will not replace this version while ..."; scoring is not interrupted | |
| 12 | Finish scoring, wait for the queue to clear | Banner offers "Update now"; tapping it reloads onto the new build, no work lost | |
| 13 | Repeat 11, then use "Update anyway (emergency)" with a pending action | Confirmation shown; after reload the pending action is still there and is delivered once | |
| 14 | Spectator phone on the event page, then switch to airplane mode for 1 minute, then back | Shows "Reconnecting ... last information" (not "Live") while offline; after signal returns it re-reads and shows "Live" again | |
| 15 | Lock the screen for 5 minutes mid-match, unlock | Board and queue intact; iOS may suspend the page, so confirm no data is lost | |
| 16 | iOS only: leave the installed home-screen app unused for several days, then open it | Note whether stored scoring data survived (iOS can evict site data); paper stays primary | |

Pass rule: rows 1 to 14 pass on both an iPhone and an Android phone, and any failure is written up before the freeze starts.
