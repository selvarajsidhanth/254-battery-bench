/* Sample fleet for demo mode. Fake data, generated relative to "now" so
   timers and trends always look current. */
import type { Col, Doc } from './backend';
import { DAY, MIN, uid } from '../lib/format';

type Spec = {
  n: number; mfr: 'M' | 'E'; ahStart: number; ahEnd: number; rint: number; mca: number;
  state: 'shelf' | 'charging' | 'ready' | 'robot'; sinceMin: number; cycles: number;
  cbaDaysAgo: number | null; mcaDaysAgo: number | null; beakIr?: number; retired?: string; quarantined?: boolean;
};

// fake fleet: a spread of competition, practice, failing and untested packs
const SPECS: Spec[] = [
  { n: 1, mfr: 'E', ahStart: 19.9, ahEnd: 19.5, rint: 17, mca: 290, state: 'ready', sinceMin: 38, cycles: 46, cbaDaysAgo: 12, mcaDaysAgo: 20, beakIr: 8.4, quarantined: true },
  { n: 2, mfr: 'M', ahStart: 16.9, ahEnd: 16.4, rint: 18, mca: 275, state: 'robot', sinceMin: 1, cycles: 52, cbaDaysAgo: 18, mcaDaysAgo: 25, beakIr: 9.4, quarantined: true },
  { n: 3, mfr: 'M', ahStart: 16.3, ahEnd: 15.6, rint: 22, mca: 262, state: 'charging', sinceMin: 6, cycles: 88, cbaDaysAgo: 9, mcaDaysAgo: 30, beakIr: 15.8, quarantined: true },
  { n: 4, mfr: 'E', ahStart: 18.9, ahEnd: 18.6, rint: 16, mca: 300, state: 'ready', sinceMin: 22, cycles: 18, cbaDaysAgo: 6, mcaDaysAgo: 6, beakIr: 7.6, quarantined: true },
  { n: 5, mfr: 'M', ahStart: 16.6, ahEnd: 16.2, rint: 18, mca: 281, state: 'charging', sinceMin: 56, cycles: 21, cbaDaysAgo: 40, mcaDaysAgo: 45, quarantined: true },
  { n: 6, mfr: 'M', ahStart: 15.9, ahEnd: 15.3, rint: 21, mca: 268, state: 'charging', sinceMin: 11, cycles: 49, cbaDaysAgo: 15, mcaDaysAgo: 15 },
  { n: 7, mfr: 'M', ahStart: 17.0, ahEnd: 15.9, rint: 19, mca: 270, state: 'ready', sinceMin: 65, cycles: 79, cbaDaysAgo: 4, mcaDaysAgo: 33, beakIr: 11.0, quarantined: true },
  { n: 8, mfr: 'E', ahStart: 18.3, ahEnd: 18.1, rint: 17, mca: 287, state: 'charging', sinceMin: 22, cycles: 24, cbaDaysAgo: 20, mcaDaysAgo: 20 },
  { n: 9, mfr: 'M', ahStart: 16.4, ahEnd: 16.1, rint: 18, mca: 275, state: 'ready', sinceMin: 12, cycles: 41, cbaDaysAgo: 22, mcaDaysAgo: 22, beakIr: 9.1, quarantined: true },
  { n: 10, mfr: 'M', ahStart: 15.2, ahEnd: 14.8, rint: 21, mca: 287, state: 'shelf', sinceMin: 600, cycles: 16, cbaDaysAgo: 30, mcaDaysAgo: 30 },
  { n: 11, mfr: 'M', ahStart: 16.2, ahEnd: 16.0, rint: 78, mca: 242, state: 'shelf', sinceMin: 900, cycles: 55, cbaDaysAgo: 34, mcaDaysAgo: 34 },
  { n: 12, mfr: 'E', ahStart: 0, ahEnd: 0, rint: 0, mca: 268, state: 'charging', sinceMin: 84, cycles: 0, cbaDaysAgo: null, mcaDaysAgo: 4 },
  { n: 13, mfr: 'E', ahStart: 0, ahEnd: 0, rint: 0, mca: 0, state: 'shelf', sinceMin: 2000, cycles: 0, cbaDaysAgo: null, mcaDaysAgo: null },
  { n: 14, mfr: 'M', ahStart: 9.9, ahEnd: 8.4, rint: 18, mca: 270, state: 'shelf', sinceMin: 60 * 24 * 20, cycles: 131, cbaDaysAgo: 22, mcaDaysAgo: 27 },
  { n: 15, mfr: 'M', ahStart: 11.0, ahEnd: 9.9, rint: 19, mca: 250, state: 'shelf', sinceMin: 60 * 24 * 40, cycles: 140, cbaDaysAgo: 30, mcaDaysAgo: 60, retired: 'Capacity under 11 Ah' },
];
const NAMES = ['E. Gu', 'A. Martinez', 'J. Lee', 'R. Patel'];

/* deterministic pseudo-random so the demo looks the same every reset */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function generateSeed(now = Date.now()): Partial<Record<Col, Record<string, Doc>>> {
  const r = rng(4242);
  const batteries: Record<string, Doc> = {};
  const tests: Record<string, Doc> = {};
  const runs: Record<string, Doc> = {};
  const events: Record<string, Doc> = {};
  const flags: Record<string, Doc> = {};
  const isoAt = (t: number) => new Date(t).toISOString();
  const who = () => NAMES[Math.floor(r() * NAMES.length)];

  for (const s of SPECS) {
    const label = `2026-${String(s.n).padStart(2, '0')}${s.mfr}`;
    const id = label.toLowerCase();
    batteries[id] = {
      label, manufacturer: s.mfr === 'M' ? 'MK' : 'Energizer', lotCode: s.mfr === 'M' ? 'BD' : null,
      location: s.state === 'charging' ? 'AR Charger' : s.state === 'shelf' ? 'Shop - TBT' : 'Pit', quarantined: !!s.quarantined,
      inService: '2026-01', retired: !!s.retired, retiredReason: s.retired ?? null, retiredAt: s.retired ? isoAt(now - 20 * DAY) : null,
      state: s.state, stateSince: isoAt(now - s.sinceMin * MIN), chargeCheck: null, cycles: s.cycles, createdAt: isoAt(now - 150 * DAY),
    };
    // monthly CBA discharges, capacity fading from ahStart to ahEnd
    if (s.cbaDaysAgo != null) {
      for (let i = 0; i < 4; i++) {
        const frac = i / 3;
        const ah = +(s.ahStart + (s.ahEnd - s.ahStart) * frac + (r() - 0.5) * 0.08).toFixed(3);
        const pre = +(s.rint - 2 + frac * 2 + (r() - 0.5)).toFixed(0);
        tests[uid()] = { batteryId: id, kind: 'cba', at: isoAt(now - (s.cbaDaysAgo + (3 - i) * 31) * DAY), ah: i === 3 ? s.ahEnd : ah,
          rintPre: i === 3 ? s.rint : pre, rintPost: (i === 3 ? s.rint : pre) + 9 + Math.round(r() * 4), wh: +((i === 3 ? s.ahEnd : ah) * 12.1).toFixed(1), by: who(), source: 'app' };
      }
    }
    if (s.mcaDaysAgo != null) {
      for (let i = 0; i < 2; i++) {
        tests[uid()] = { batteryId: id, kind: 'mca', at: isoAt(now - (s.mcaDaysAgo + (1 - i) * 62) * DAY), mca: i === 1 ? s.mca : s.mca + 6, by: who(), source: 'app' };
      }
    }
    // a few Beak pit checks on the batteries in the active rotation
    if (s.beakIr != null) {
      for (let i = 0; i < 4; i++) {
        tests[uid()] = { batteryId: id, kind: 'beak', at: isoAt(now - (i * 6 + 0.5) * DAY - s.sinceMin * MIN), ir: i === 0 ? s.beakIr : +(s.beakIr - 0.3 * i + (r() - 0.5) * 0.2).toFixed(1),
          soc: Math.round(128 + r() * 5), v0: +(13.3 - (s.beakIr - 7) * 0.03).toFixed(2), inspection: { leads: true, crimps: true, case: true, anderson: true }, by: who(), source: 'app' };
      }
    }
  }
  const b07 = '2026-07m', b03 = '2026-03m';
  // robot-log summaries for B-07 from an offseason event
  const at0 = now - 38 * DAY;
  [['SF 3', 7.4, 214, 4.1, 1], ['Q 31', 7.9, 198, 3.8, 0], ['Q 22', 8.1, 192, 3.7, 0], ['Q 14', 8.3, 187, 3.6, 0], ['Q 6', 8.4, 185, 3.5, 0]]
    .forEach(([m, v, a, wh, bo], i) => {
      runs[uid()] = { batteryId: b07, at: new Date(at0 + (5 - i) * 2 * 3600_000).toISOString(), event: 'Offseason', match: m, minV: v, peakA: a, energyWh: wh, brownouts: bo, source: 'csv' };
    });

  flags[uid()] = {
    batteryId: b03, at: new Date(now - 25 * MIN).toISOString(), by: 'A. Martinez', status: 'pending',
    reason: 'Beak IR read 15.8 mΩ and it felt weak in the last practice run.',
  };
  events[uid()] = { batteryId: '2026-02m', at: new Date(now - MIN).toISOString(), from: 'ready', to: 'robot', by: 'J. Lee', match: null };

  // a qualification schedule around "now" so competition mode has something to show
  const q = [[38, -1], [42, 19], [47, 52], [53, 88], [58, 125], [63, 161], [68, 197], [73, 233]];
  const config: Record<string, Doc> = {
    event: {
      mode: 'practice', name: 'Demo Regional',
      matches: q.map(([n, off]) => ({ key: `qm${n}`, label: `Q${n}`, time: new Date(now + off * MIN).toISOString() })),
      assignments: {},
    },
  };
  return { batteries, tests, runs, flags, events, config };
}
