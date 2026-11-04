

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

All of these thresholds are editable in Settings.

| Reading | Match-ready | Watch (practice only) | Pull |
|---|---|---|---|
| Internal resistance | < 12 mΩ | 12–15 mΩ, or trending to 15 mΩ within 6 weeks | ≥ 15 mΩ |
| Open-load voltage (fresh) | ≥ 13.0 V | 12.6–13.0 V | < 12.6 V |
| Cranking amps | ≥ floor × 1.1 | within 10% of floor | < floor (floor not set yet) |
| SoC at test | ≥ 125% | below 125% means "recharge and retest" | — |

- **IR trend:** a least-squares fit over real time (the last 90 days), not over the number of tests. A burst of tests on one day doesn't count as aging.
- **MCA:** the app asks for it every 3rd test.

## Setup checklist (one time)

1. **Firestore rules.** Firebase console → Firestore → Rules → paste [`firestore.rules`](firestore.rules) → Publish.
2. **Sign-in.** Firebase console → Authentication → Sign-in method → enable **Google**. Then Settings → Authorized domains → add `selvarajsidhanth.github.io` (sign-in fails with `auth/unauthorized-domain` until you do).
3. **Old v1 data.** Delete the fake test data from the July app: the `batteries`, `tests`, `flags` and `meta` collections.
4. **Members.** Sign in (the bootstrap admin UID is in `src/firebase-config.ts`), then add teammates in Settings → Members using their Google account emails.
5. **History.** Import the Google Sheet: File → Download → CSV, then Import in the app.

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
