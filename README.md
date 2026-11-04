

## Two modes

- **Datasheet** (black and white): the working app for build season and testing.
  - Overview: the ready list, the rotation, alerts, and the fleet.
  - Battery pages: IR over time with a projected date for hitting the limit, plus MCA, V₀ and SoC history and match history.
  - Log test: a live verdict as you type.
  - Import / export, and settings.
- **Pit mode** (dark): a wall display for the pit monitor. It's readable from across the pit and ticks live.
  - **Practice view:** what to grab next, plus charging, resting, and in-robot countdowns.
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

## Setup checklist (one time)

1. **Firestore rules.** Firebase console → Firestore → Rules → paste [`firestore.rules`](firestore.rules) → Publish.
2. **Sign-in.** Firebase console → Authentication → Sign-in method → enable **Google**. Then Settings → Authorized domains → add `selvarajsidhanth.github.io` (sign-in fails with `auth/unauthorized-domain` until you do).
3. **Old v1 data.** Delete the fake test data from the July app: the `batteries`, `tests`, `flags` and `meta` collections.
4. **Members.** Sign in (the bootstrap admin UID is in `src/firebase-config.ts`), then add teammates in Settings → Members using their Google account emails.
5. **History.** In the Battery Inventory Testing sheet, download each tab (File → Download → CSV), then choose them all at once in Import → Battery Inventory Testing sheet. The importer reads the Inventory, CBA results, MCA results and thresholds tabs, and skips duplicates.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173/?demo uses local sample data
npm test             # domain logic, planner, CSV import
npm run build
```

Pushing to `main` runs the tests and deploys to GitHub Pages.

## Layout

```
src/lib/        pure logic: health rules, IR trend, match planner, CSV parsing
src/data/       Firestore + demo (localStorage) backends, store, sample data
src/pages/      sheet/ (datasheet screens) and pit/ (pit display)
src/styles/     sheet.css (B&W) and pit.css (dark)
src/brand.ts    the name and badge shown in the app
```
