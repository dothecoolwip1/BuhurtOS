# Rehearsal checklist: do this once, at home, before the Rumble (about 30 minutes)

Use a **test event** with today's date through tomorrow, published. You need: your phone (organizer), three spare phones or tablets, one more tablet, and the OBS laptop. Tick each box; if a box fails, write down what you saw on the screen and tell me.

## 1. Organizer phone: make the devices (5 minutes)
1. Sign in to BuhurtOS as yourself. Open the event → **Command Centre** → tap **Event devices (phones and tablets)**.
2. Tap **Add the usual set for an event**. A sheet of codes with QR pictures appears. Screenshot it or print it.
   - [ ] All eight stations have a name, a role and a code. (Counter Phone 1 to 4, Secretary Tablet, Marshal Phone, Announcer Tablet, Event Admin Tablet.)
3. Close the sheet.
   - [ ] The list now shows every device as **Active**. The codes are NOT shown again. (That is correct. If you lose one, tap **New code**.)

## 2. Each device: sign in once (2 minutes each)
On the device open the BuhurtOS app or website, then **scan the QR** (or go to the address ending in `/device` and type the code).
Check that the **blue bar at the top** says: the event name · Temporary Device · the station name · **Role: …** · when access ends.

| Device | You should land on | Do this | You should see |
| --- | --- | --- | --- |
| **Scorekeeper** (give it the Secretary Tablet code if you have only one) | the event's field list or Command Centre | open a field; start a round on the test fight; score a point | the clock runs, the score changes; there is a red **CAMERA OFF** button; no account or settings menus |
| **Secretary** (a second tablet with a Scorekeeper/Secretary code) | same as above | move a fight up or down the order; send a test announcement | both work; it can read the Command Centre but has no "Event devices" section |
| **Announcer** | the Announcer screen | watch the live fight | fights, scores, the next fights and "Ready / Not yet ready" are shown; nothing to tap except **CAMERA OFF** |
| **Temporary Organizer** (the Event Admin Tablet) | the Command Centre | open Broadcast; change the mode; open a field | works; **no** "Event devices" section (only you can make or cancel device codes) |

- [ ] Each device shows the right station and role, and nothing about a personal account.
- [ ] Close the app completely on one device, reopen it, and wait a minute. It is **still signed in** (no code asked).
- [ ] Turn one device's Wi-Fi off for two minutes, then on. It carries on by itself.

## 3. Camera Off (2 minutes)
- [ ] On the Announcer tablet tap **CAMERA OFF**, pick a reason. The banner says cameras are off and who did it.
- [ ] The Announcer tablet has **no** button to turn cameras back on. On your phone (or the Event Admin tablet) turn them **on**. The banner clears on every device within a few seconds.

## 4. If something goes wrong (practice these once)
- [ ] **Lost phone:** Command Centre → Event devices → that device → **Revoke**. That phone says its access has ended within about a minute. The others keep working.
- [ ] **Lost or photographed code:** tap **New code** on that device. The old code stops working; type or scan the new one.
- [ ] **Everything looks wrong:** tap **Sign out all temporary devices**. Sign each device in again with its code (use **New code** first if you want fresh codes).

## 5. OBS laptop (15 minutes; the first real OBS test)
Follow `PACK181_EVENT_LAPTOP.md` sections 2 to 6 first (OBS WebSocket password, your scenes, microphone and music). Then:
1. Event devices → **Make a code for the stream laptop**. Paste it into the Companion screen (`http://127.0.0.1:4777` on the laptop).
   - [ ] The Command Centre **Broadcast** section says the stream controller is connected.
2. With a test fight running:
   - [ ] The camera scene follows the fight and stays on it until it ends. Score and clock changes do not flip scenes.
   - [ ] **Take**, **Holding**, **Break** and **Return to Auto** (from the Command Centre) behave.
   - [ ] **Camera Off** from any device switches to the Camera Off scene at once and **stays** off when you start the next fight. Only releasing it from an allowed device brings the cameras back.
   - [ ] Quit OBS and reopen it; quit the Companion and reopen it; unplug the laptop's internet for a minute and plug it back in. The right scene is back each time, and Camera Off is still on if it was on.
   - [ ] Music: quiet when the announcer mic is silent (normal level), drops while you talk and comes back after you stop; music is silent during a fight and while cameras are off.
   - [ ] What the room hears and what the stream hears is what you want (PA vs stream).
   - [ ] **The Companion never started or stopped the stream by itself.**

If every box is ticked you are ready. After the event the codes stop working by themselves 24 hours after the last day ends.
