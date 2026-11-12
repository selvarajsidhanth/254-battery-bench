/* Made-up robot-log reports for the demo, so match groups, trends and comparisons
   have something to show. Nothing here is real team data. */
import type { MatchReport, ReportEvent, SubsystemPower } from '../lib/matchReport';

export interface SampleOpts {
  label: string;
  type: MatchReport['match']['type'];
  fms: boolean;
  event: string;
  at: string;
  /** battery + wiring resistance, mΩ */
  r: number;
  /** open-circuit voltage at the start */
  ocv: number;
  /** how hard the drivers pushed, ~0.8–1.2 */
  effort: number;
}

const SUBS: [string, number, number][] = [['Drive', 0.52, 4], ['Shooter', 0.2, 2], ['Intake', 0.1, 1], ['Elevator', 0.12, 2], ['Climber', 0.06, 1]];

export function sampleReport(o: SampleOpts, rnd: () => number): MatchReport {
  const dt = 0.5;
  const t: number[] = [], v: number[] = [], i: number[] = [];
  const phases = [{ mode: 'auto' as const, start: 0, end: 15 }, { mode: 'teleop' as const, start: 18, end: 153 }];
  const on = (x: number) => phases.some((p) => x >= p.start && x < p.end);
  let ocv = o.ocv, burst = 0;
  for (let x = -6; x <= 162; x += dt) {
    let a = 2.5;
    if (on(x)) {
      if (burst <= 0 && rnd() < 0.09) burst = 1 + rnd() * 3;
      const base = x < 15 ? 70 : 55;
      a = base * o.effort + (burst > 0 ? (90 + rnd() * 170) * o.effort : rnd() * 40);
      if (x > 140) a *= 1.25; // the end-game climb
      a = Math.min(a, 215);
      burst -= dt;
    }
    ocv -= (a * dt) / 3600 * 0.055; // the rest voltage drifts down as charge leaves
    t.push(+x.toFixed(2));
    i.push(+a.toFixed(1));
    v.push(+(ocv - (a * o.r) / 1000 + (rnd() - 0.5) * 0.06).toFixed(3));
  }
  const ah: number[] = [], wh: number[] = [];
  let A = 0, W = 0;
  t.forEach((_, k) => { A += (i[k] * dt) / 3600; W += (i[k] * v[k] * dt) / 3600; ah.push(+A.toFixed(4)); wh.push(+W.toFixed(3)); });
  const enIdx = t.map((x, k) => (on(x) ? k : -1)).filter((k) => k >= 0);
  const enV = enIdx.map((k) => v[k]), enI = enIdx.map((k) => i[k]);
  const minV = Math.min(...enV), peakA = Math.max(...enI);
  const avg = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const under = (lim: number) => enV.filter((x) => x < lim).length * dt;
  const restV = v[0], endV = v[v.length - 1];
  const browns = enIdx.filter((k) => v[k] < 6.9).map((k) => t[k]);
  const events: ReportEvent[] = [
    { t: 0, kind: 'mode', level: 'info', text: 'Auto enabled (15 s)' },
    { t: 18, kind: 'mode', level: 'info', text: 'Teleop enabled (135 s)' },
    ...browns.slice(0, 3).map((x): ReportEvent => ({ t: x, kind: 'brownout', level: 'bad', text: 'Brownout for 0.05 s' })),
  ];
  const motorAh = A * 0.92;
  const subsystems: SubsystemPower[] = SUBS.map(([name, share, motors]) => {
    const s = share * (0.85 + rnd() * 0.3);
    return { name, ah: +(motorAh * s).toFixed(3), share: s, peakA: Math.round(peakA * s * 1.4), avgA: +(avg(enI) * s).toFixed(1), motors };
  });
  const tot = subsystems.reduce((n, s) => n + s.share, 0);
  subsystems.forEach((s) => { s.share = s.share / tot; s.ah = +(motorAh * s.share).toFixed(3); });
  const temp = (base: number) => +(base * o.effort + rnd() * 12).toFixed(1);
  return {
    version: 1,
    fileName: `akit_${o.at.slice(2, 10)}_${o.label.replace(/\W/g, '')}.wpilog`,
    logStart: o.at,
    match: { label: o.label, type: o.type, number: Number(/\d+/.exec(o.label)?.[0] ?? 0) || null, replay: null, event: o.event, station: 'Blue 2', fms: o.fms },
    robot: { project: 'Robot', branch: 'main', sha: 'a1b2c3d', dirty: false, built: o.at, auto: 'Center 3 piece' },
    batteryName: null,
    enabled: true,
    phases,
    enabledSec: 150,
    logSec: t[t.length - 1] - t[0],
    battery: {
      restV, minV, avgV: +avg(enV).toFixed(2), endV, sagV: +(restV - minV).toFixed(2),
      under10Sec: under(10), under8Sec: under(8),
      ah: +A.toFixed(3), wh: +W.toFixed(2), peakA, peak1sA: Math.round(peakA * 0.8), avgA: +avg(enI).toFixed(1),
      systemRmOhm: +(o.r + (rnd() - 0.5)).toFixed(1), ocvV: +o.ocv.toFixed(2),
      brownouts: Math.min(3, browns.length), brownoutSec: Math.min(3, browns.length) * 0.05,
      loadShedCount: 0, loadShedSec: 0, currentSource: 'pdh',
    },
    subsystems,
    temps: [
      { name: 'Drive FL', subsystem: 'Drive', maxC: temp(48), endC: temp(44) },
      { name: 'Drive FR', subsystem: 'Drive', maxC: temp(47), endC: temp(43) },
      { name: 'Shooter top', subsystem: 'Shooter', maxC: temp(55), endC: temp(50) },
      { name: 'Elevator', subsystem: 'Elevator', maxC: temp(42), endC: temp(38) },
      { name: 'Climber', subsystem: 'Climber', maxC: temp(40), endC: temp(39) },
    ],
    health: {
      loopPeriodMs: 20, loopMedianMs: +(11 + rnd() * 3).toFixed(1), loopP99Ms: +(17 + rnd() * 6).toFixed(1), loopMaxMs: +(24 + rnd() * 30).toFixed(1),
      overruns: Math.round(rnd() * 14), overrunPct: +(rnd() * 1.6).toFixed(2), consoleOverruns: 0, watchdog: 0,
      cpuMaxPct: Math.round(55 + rnd() * 25), cpuMaxC: Math.round(50 + rnd() * 10), memMaxPct: Math.round(40 + rnd() * 10), canMaxPct: Math.round(45 + rnd() * 20), gcMs: +(rnd() * 40).toFixed(0),
    },
    drive: { distanceM: Math.round(280 + rnd() * 160) * o.effort, topSpeedMps: +(4.2 + rnd() * 0.6).toFixed(2), tips: 0 },
    events,
    trace: { t, v, i, ah, wh },
    signals: 412,
  };
}
