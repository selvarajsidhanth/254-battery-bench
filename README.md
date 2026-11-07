

## Two modes

- **Datasheet** (black and white): the working app for build season and testing.
  - Overview: the ready list, the rotation, alerts, and the fleet.
  - Battery pages: IR over time with a projected date for hitting the limit, plus MCA, V₀ and SoC history and match history.
  - Log test: a live verdict as you type.
  - Match logs: drop in a robot `.wpilog` after a match for a post-match report, then save it against the battery that was in the robot.
  - Settings: thresholds, event schedule, members, and import & backup (exact JSON backups that can be restored).
- **Pit mode** (dark): a wall display for the pit monitor. It's readable from across the pit and ticks live.
  - At events: one button to confirm the battery is in the robot, a systems-check pick (worse batteries first; it goes back on the charger nearly full), and battery warnings that can be dismissed and reviewed later.
  - Quarantine has two meanings: **saved for competition** (kept for matches, never the practice pick) or **held out** (never suggested, e.g. pending decommission).
  - **Practice view:** what to grab next, plus charging and in-robot countdowns.
  - **Competition view:** queue countdown, an install checklist, and an auto-planned battery for every upcoming match.

## How health is judged

Three kinds of test, all logged in the app:

- **CBA** (capacity discharge): amp-hours, R_int before and after, watt-hours.
- **MCA** (cranking-amps load test).
- **Beak check** (quick pit check: IR, SoC, open-load voltage).

Thresholds are editable in Settings, and can be imported from the team sheet's thresholds tab.

| | Competition | Practice and prototype |
|---|---|---|
| Capacity (CBA) | ≥ 15.5 Ah | ≥ 11 Ah |
| R_int before CBA | ≤ 25 mΩ | ≤ 35 mΩ |
| MCA | ≥ 225 | ≥ 210 |
| CBA due after | 1 month | 6 months |
| MCA due after | 2 months | 6 months |

- **Rank:** batteries that pass every competition threshold are ranked by capacity. The top 14 are competition batteries; the rest drop to practice.
- **Not rated yet:** a battery needs both a CBA and an MCA before it can be rated.
- **Beak override:** a Beak reading from the last two weeks at ≥ 15 mΩ (or open-load voltage < 12.6 V) pulls a battery for the day, whatever its bench results.
- **Capacity trend:** fitted over real time. A competition battery is flagged if it's projected to drop below 15.5 Ah within 6 weeks.

## Match logs

Drop an AdvantageKit or WPILib `.wpilog` on the Match logs page. The file is read in the browser (a Web Worker; a 120 MB log takes under a second) and never uploaded. Only the summary, about 10 KB, is saved. Anyone on the team can save one; only admins can reassign or delete them.

- **Battery:** voltage before the match was enabled, lowest voltage, time under 10 V and 8 V, brownouts, recovered voltage after, amp-hours and watt-hours used, peak and average draw, load shedding, and an effective resistance (voltage sag per amp, fitted while enabled) for comparing batteries from match to match.
- **Where the power went:** amp-hours by subsystem.
- **Motor temperatures:** max and end temperature for every motor, flagged warm at 65 °C and hot at 80 °C.
- **Timeline:** auto/teleop, brownouts, load shedding, tipping, CAN and device disconnects, driver-station drops, and robot alerts.
- **Robot and code:** loop time and overruns, CPU, memory, CAN, garbage collection, distance driven, top speed, branch and commit.
- **Batteries in matches:** each battery's average and worst match voltage across every saved log.
- **Match playback:** pair a video (found on The Blue Alliance for FMS matches, a YouTube link, or a video file), sync it once at the start of auto, and the graph, voltage, current and amp-hours follow the video. Click the graph to jump the video. Video files are trimmed to the match, re-encoded to 720p in the browser (about 45 MB for a match) and uploaded to Cloud Storage so every device can play them. Members can attach or re-sync a video on a saved report.

Signals are found by name pattern (`BatteryVoltage`, `*SupplyCurrent*`, `*Temp*`, `/DriverStation/*`, `/SystemStats/*`, …), so renaming subsystems doesn't break the reports. If the robot code logs a string ending in `BatteryName`/`BatteryId`, the battery is picked automatically. Otherwise the battery in the robot (per the rotation) is suggested.

## Setup checklist (one time)

1. **Firestore rules.** Firebase console → Firestore → Rules → paste [`firestore.rules`](firestore.rules) → Publish.
2. **Sign-in.** Firebase console → Authentication → Sign-in method → enable **Google**. Then Settings → Authorized domains → add `selvarajsidhanth.github.io` (sign-in fails with `auth/unauthorized-domain` until you do).
3. **Old v1 data.** Delete the fake test data from the July app: the `batteries`, `tests`, `flags` and `meta` collections.
4. **Members.** Sign in (the bootstrap admin UID is in `src/firebase-config.ts`), then add teammates in Settings → Members using their Google account emails.
5. **Match videos.** Uploads need Cloud Storage, which needs the Blaze (pay-as-you-go) plan: Firebase console → Upgrade, then Storage → Get started. The free tier covers about 5 GB stored and 1 GB downloaded a day. Then Storage → Rules → paste `storage.rules` → Publish (allow it to read Firestore when asked). Setting a budget alert in Google Cloud Billing is a good idea.
6. **History.** In the Battery Inventory Testing sheet, download each tab (File → Download → CSV), then choose them all at once in Settings → Import & backup → Battery Inventory Testing sheet. Download a backup first (same tab). The importer reads the Inventory, CBA results, MCA results and thresholds tabs, and skips duplicates.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173/?demo uses local sample data
npm test             # domain logic, planner, CSV import, log analysis
npm run build
```

Pushing to `main` runs the tests and deploys to GitHub Pages.

## Layout

```
src/lib/        pure logic: health rules, IR trend, match planner, CSV parsing, .wpilog reader and match reports
src/data/       Firestore + demo (localStorage) backends, store, sample data
src/pages/      sheet/ (datasheet screens) and pit/ (pit display)
src/styles/     sheet.css (B&W) and pit.css (dark)
src/brand.ts    the name and badge shown in the app
```
