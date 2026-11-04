/* Sample fleet for demo mode. Fake data, generated relative to "now" so
   timers and trends always look current. */
import type { Col, Doc } from './backend';
import { DAY, MIN, uid } from '../lib/format';

type Spec = {
  n: number; yr: number; model: string; irStart: number; irEnd: number;
  state: 'charging' | 'resting' | 'ready' | 'robot'; sinceMin: number; cycles: number;
  lastTestDaysAgo?: number; retired?: string;
};

const SPECS: Spec[] = [
  { n: 1, yr: 2024, model: 'MK ES17-12', irStart: 8.0, irEnd: 8.7, state: 'ready', sinceMin: 38, cycles: 46 },
  { n: 2, yr: 2024, model: 'MK ES17-12', irStart: 8.9, irEnd: 9.6, state: 'robot', sinceMin: 1, cycles: 52 },
  { n: 3, yr: 2023, model: 'MK ES17-12', irStart: 11.2, irEnd: 15.8, state: 'resting', sinceMin: 6, cycles: 88 },
  { n: 4, yr: 2025, model: 'MK ES17-12', irStart: 7.4, irEnd: 7.6, state: 'ready', sinceMin: 22, cycles: 18 },
  { n: 5, yr: 2025, model: 'MK ES17-12', irStart: 7.8, irEnd: 8.2, state: 'charging', sinceMin: 56, cycles: 21 },
  { n: 6, yr: 2024, model: 'Duracell Ultra', irStart: 9.4, irEnd: 10.2, state: 'resting', sinceMin: 11, cycles: 49 },
  { n: 7, yr: 2023, model: 'MK ES17-12', irStart: 9.0, irEnd: 13.1, state: 'ready', sinceMin: 65, cycles: 79 },
  { n: 8, yr: 2025, model: 'MK ES17-12', irStart: 8.2, irEnd: 8.7, state: 'charging', sinceMin: 22, cycles: 24 },
  { n: 9, yr: 2024, model: 'Duracell Ultra', irStart: 8.7, irEnd: 9.1, state: 'ready', sinceMin: 12, cycles: 41 },
  { n: 10, yr: 2025, model: 'MK ES17-12', irStart: 7.6, irEnd: 8.0, state: 'resting', sinceMin: 19, cycles: 16 },
  { n: 11, yr: 2024, model: 'MK ES17-12', irStart: 9.8, irEnd: 10.4, state: 'charging', sinceMin: 84, cycles: 55, lastTestDaysAgo: 9 },
  { n: 12, yr: 2022, model: 'MK ES17-12', irStart: 12.4, irEnd: 16.2, state: 'resting', sinceMin: 60 * 24 * 40, cycles: 131, lastTestDaysAgo: 41, retired: 'IR over 15 mΩ and climbing' },
];
const NAMES = ['E. Gu', 'A. Martinez', 'J. Lee', 'R. Patel'];

/* deterministic pseudo-random so the demo looks the same every reset */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function generateSeed(now = Date.now()): Partial<Record<Col, Record<string, Doc>>> {
  const r = rng(254);
  const batteries: Record<string, Doc> = {};
  const tests: Record<string, Doc> = {};
  const runs: Record<string, Doc> = {};
  const events: Record<string, Doc> = {};
  const flags: Record<string, Doc> = {};

  for (const s of SPECS) {
    const label = `B-${String(s.n).padStart(2, '0')}`;
    const id = label.toLowerCase();
    const isoAt = (t: number) => new Date(t).toISOString();
    batteries[id] = {
      label, model: s.model, inService: `${s.yr}-0${(s.n % 9) + 1}`, retired: !!s.retired,
      retiredReason: s.retired ?? null, retiredAt: s.retired ? isoAt(now - 40 * DAY) : null,
      state: s.state, stateSince: isoAt(now - s.sinceMin * MIN), chargeCheck: null, cycles: s.cycles,
      createdAt: isoAt(now - 120 * DAY),
    };
    // ~weekly tests for 10 weeks, a little noise, MCA every 3rd test
    const lastDays = s.lastTestDaysAgo ?? (s.state === 'ready' ? s.sinceMin / 1440 + 0.01 : 2 + r() * 3);
    const count = 11;
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const daysAgo = lastDays + (count - 1 - i) * 6.5 + r() * 1.5;
      const ir = +(s.irStart + (s.irEnd - s.irStart) * Math.pow(frac, 1.15) + (r() - 0.5) * 0.25).toFixed(1);
      const tid = uid();
      tests[tid] = {
        batteryId: id, at: isoAt(now - daysAgo * DAY), ir: i === count - 1 ? s.irEnd : ir,
        soc: Math.round(128 + r() * 5), v0: +(13.36 - (ir - 7) * 0.035 + (r() - 0.5) * 0.02).toFixed(2),
        mca: i % 3 === 0 ? Math.round(1040 - (ir - 7) * 16 + (r() - 0.5) * 8) : null,
        temp: r() < 0.08 ? 'cold' : 'room', offChargerMin: Math.round(1 + r() * 7),
        inspection: { leads: true, crimps: true, case: true, anderson: true },
        by: NAMES[Math.floor(r() * NAMES.length)], notes: '', source: 'app',
      };
    }
  }
  tests[uid()] = { ...tests[Object.keys(tests).find((k) => tests[k].batteryId === 'b-03')!], at: new Date(now - 30 * MIN).toISOString(), ir: 15.8, notes: 'Felt weak at the end of the last run.' };

  // robot-log summaries for B-07 from an offseason event
  const at0 = now - 38 * DAY;
  [['SF 3', 7.4, 214, 4.1, 1], ['Q 31', 7.9, 198, 3.8, 0], ['Q 22', 8.1, 192, 3.7, 0], ['Q 14', 8.3, 187, 3.6, 0], ['Q 6', 8.4, 185, 3.5, 0]]
    .forEach(([m, v, a, wh, bo], i) => {
      runs[uid()] = { batteryId: 'b-07', at: new Date(at0 + (5 - i) * 2 * 3600_000).toISOString(), event: 'Chezy Champs', match: m, minV: v, peakA: a, energyWh: wh, brownouts: bo, source: 'csv' };
    });

  flags[uid()] = {
    batteryId: 'b-03', at: new Date(now - 25 * MIN).toISOString(), by: 'A. Martinez', status: 'pending',
    reason: 'IR is past 15 mΩ and it felt weak in the last practice run.',
  };
  events[uid()] = { batteryId: 'b-02', at: new Date(now - MIN).toISOString(), from: 'ready', to: 'robot', by: 'J. Lee', match: null };

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
