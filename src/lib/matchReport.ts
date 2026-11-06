/* Turns a robot log into a post-match report: battery behaviour first, then
   where the power went, motor temperatures, faults, code health and driving.

   Signals are found by name pattern rather than hard-coded keys so the same
   analyzer keeps working as the robot code changes (and on plain WPILib
   DataLogManager logs). AdvantageKit only writes a value when it changes, so
   every signal is treated as sample-and-hold. */

import { readWpilog, type ByteSource, type LogEntryInfo, type LogValue } from './wpilog';

export interface ReportEvent {
  t: number; // seconds from the first enable (negative = before the match)
  kind: 'brownout' | 'loadshed' | 'tip' | 'disconnect' | 'ds' | 'alert' | 'console' | 'mode';
  text: string;
  level: 'info' | 'warn' | 'bad';
}

export interface Phase {
  mode: 'auto' | 'teleop' | 'test';
  start: number; // seconds from first enable
  end: number;
}

export interface SubsystemPower {
  name: string;
  ah: number;
  share: number; // 0..1 of all logged motor Ah
  peakA: number;
  avgA: number;
  motors: number;
}

export interface MotorTemp {
  name: string;
  subsystem: string;
  maxC: number;
  endC: number;
}

export interface MatchReport {
  version: 1;
  fileName: string;
  logStart: string | null; // real-world time of the first enable (ISO), if the log knows it
  match: { label: string; type: 'none' | 'practice' | 'qual' | 'elim'; number: number | null; replay: number | null; event: string; station: string; fms: boolean };
  robot: { project: string; branch: string; sha: string; dirty: boolean; built: string; auto: string };
  batteryName: string | null; // if the robot code logs the battery it's running on
  enabled: boolean;
  phases: Phase[];
  enabledSec: number;
  logSec: number;
  battery: {
    restV: number | null;
    minV: number | null;
    avgV: number | null;
    endV: number | null;
    sagV: number | null;
    under10Sec: number;
    under8Sec: number;
    ah: number | null;
    wh: number | null;
    peakA: number | null;
    peak1sA: number | null;
    avgA: number | null;
    systemRmOhm: number | null; // battery + wiring + breaker, from V vs I while enabled
    ocvV: number | null; // intercept of the same fit
    brownouts: number;
    brownoutSec: number;
    loadShedCount: number;
    loadShedSec: number;
    currentSource: 'pdh' | 'motor-supply' | 'motor-other' | 'none';
    /** when things happened, in seconds from the first enable (added after v1 shipped, so optional) */
    marks?: BatteryMarks;
  };
  subsystems: SubsystemPower[];
  temps: MotorTemp[];
  health: {
    loopPeriodMs: number | null;
    loopMedianMs: number | null;
    loopP99Ms: number | null;
    loopMaxMs: number | null;
    overruns: number;
    overrunPct: number | null;
    consoleOverruns: number;
    watchdog: number;
    cpuMaxPct: number | null;
    cpuMaxC: number | null;
    memMaxPct: number | null;
    canMaxPct: number | null;
    gcMs: number | null;
  };
  drive: { distanceM: number | null; topSpeedMps: number | null; tips: number };
  events: ReportEvent[];
  // downsampled for charts; ah/wh are running totals at the end of each slice (newer reports only)
  trace: { t: number[]; v: number[]; i: number[]; ah?: number[]; wh?: number[] };
  signals: number; // how many log entries were used
}

export type Span = [number, number];
/** Spans are stored flat ([start0, end0, start1, end1, …]) because Firestore can't hold nested arrays. */
export interface BatteryMarks {
  minT: number | null;
  peakT: number | null;
  peak1sT: number | null; // start of the best 1-second window
  under10: number[];
  under8: number[];
  brownouts: number[];
  loadShed: number[];
}
export const pairs = (flat: number[] | undefined): Span[] => {
  const out: Span[] = [];
  if (flat) for (let k = 0; k + 1 < flat.length; k += 2) out.push([flat[k], flat[k + 1]]);
  return out;
};

/* ---------- signal roles ---------- */

const clean = (name: string) => name.replace(/^NT:/, '').replace(/^\/AdvantageKit/, '').replace(/^\/(Real|Replay)Outputs(?=\/)/, '');
const isNum = (t: string) => t === 'double' || t === 'float' || t === 'int64';
const isNumArr = (t: string) => t === 'double[]' || t === 'float[]' || t === 'int64[]';

type Role =
  | 'voltage' | 'pdhTotal' | 'supply' | 'otherCurrent' | 'temp' | 'enabled' | 'mode' | 'autoFlag' | 'testFlag'
  | 'event' | 'matchType' | 'matchNumber' | 'replay' | 'station' | 'fms' | 'ds' | 'brownout' | 'brownoutCount'
  | 'loadshed' | 'tip' | 'connected' | 'cycle' | 'cpu' | 'cpuTemp' | 'mem' | 'can' | 'gc' | 'console' | 'alertErr'
  | 'alertWarn' | 'meta' | 'auto' | 'pose' | 'speed' | 'batteryName' | 'epoch';

export function roleOf(e: LogEntryInfo): Role | null {
  const n = clean(e.name);
  const t = e.type;
  const last = n.slice(n.lastIndexOf('/') + 1);
  if (isNum(t) && /(^|\/)(BatteryVoltage|PowerDistribution\/Voltage)$/i.test(n)) return 'voltage';
  if (isNum(t) && /PowerDistribution\/TotalCurrent$/i.test(n)) return 'pdhTotal';
  if ((isNum(t) || isNumArr(t)) && !/limit|total|\/API\/|threshold|setpoint/i.test(n)) {
    if (/supply.?current|current.?supply/i.test(last)) return 'supply';
    if (/current/i.test(last) && !/stator|torque/i.test(last) && !/PowerDistribution|SystemStats/i.test(n)) return 'otherCurrent';
    if (/temp/i.test(last) && !/SystemStats|CPU|limit/i.test(n)) return 'temp';
  }
  if (t === 'boolean' && /(\/DriverStation\/Enabled|^DS:enabled)$/i.test(n)) return 'enabled';
  if (t === 'string' && /\/DriverStation\/RobotMode$/i.test(n)) return 'mode';
  if (t === 'boolean' && /(\/DriverStation\/Autonomous|^DS:autonomous)$/i.test(n)) return 'autoFlag';
  if (t === 'boolean' && /(\/DriverStation\/Test|^DS:test)$/i.test(n)) return 'testFlag';
  if (t === 'string' && /\/DriverStation\/EventName$/i.test(n)) return 'event';
  if (isNum(t) && /\/DriverStation\/MatchType$/i.test(n)) return 'matchType';
  if (isNum(t) && /\/DriverStation\/MatchNumber$/i.test(n)) return 'matchNumber';
  if (isNum(t) && /\/DriverStation\/ReplayNumber$/i.test(n)) return 'replay';
  if (isNum(t) && /\/DriverStation\/AllianceStation$/i.test(n)) return 'station';
  if (t === 'boolean' && /\/DriverStation\/FMSAttached$/i.test(n)) return 'fms';
  if (t === 'boolean' && /\/DriverStation\/DSAttached$/i.test(n)) return 'ds';
  if (t === 'boolean' && /\/SystemStats\/(Faults\/Brownout|BrownedOut)$/i.test(n)) return 'brownout';
  if (isNum(t) && /\/SystemStats\/FaultCounts\/Brownout$/i.test(n)) return 'brownoutCount';
  if (t === 'boolean' && /load.?shed/i.test(last)) return 'loadshed';
  if (t === 'boolean' && /tipp(ed|ing)/i.test(last)) return 'tip';
  if (t === 'boolean' && !/NTClients|\/Network\//i.test(n) && (/connected$/i.test(last) || /\/CANstatus\//i.test(n))) return 'connected';
  if (isNum(t) && /LoggedRobot\/FullCycleMS$/i.test(n)) return 'cycle';
  if (isNum(t) && /SystemStats\/CPU\/Utilization$/i.test(n)) return 'cpu';
  if (isNum(t) && /SystemStats\/CPU\/Temperature$/i.test(n)) return 'cpuTemp';
  if (isNum(t) && /SystemStats\/Memory\/Utilization$/i.test(n)) return 'mem';
  if (isNum(t) && /SystemStats\/(CANBus|Network\/CAN\d*)\/Utilization$/i.test(n)) return 'can';
  if (isNum(t) && /LoggedRobot\/GCTimeMS$/i.test(n)) return 'gc';
  if (t === 'string' && /(^|\/)console$/i.test(n)) return 'console';
  if (t === 'string[]' && /Alerts\/errors$/i.test(n)) return 'alertErr';
  if (t === 'string[]' && /Alerts\/warnings$/i.test(n)) return 'alertWarn';
  if (t === 'string' && /Metadata\/(GitSHA|GitBranch|GitDirty|BuildDate|ProjectName)$/i.test(n)) return 'meta';
  if (t === 'string' && /(SelectedRoutine|Auto ?Choices?|AutoSelector|AutoRoutine)/i.test(n) && !/options|default/i.test(n)) return 'auto';
  if (t === 'struct:Pose2d' && /(^\/Drive(Inputs)?\/Pose|\/Odometry\/Robot|\/RobotPose)$/i.test(n)) return 'pose';
  if ((t === 'struct:ChassisVelocities' || t === 'struct:ChassisSpeeds') && /measured.*robot.?relative|\/MeasuredSpeeds$/i.test(n)) return 'speed';
  if (t === 'string' && /battery.?(name|id|serial|label)$/i.test(last)) return 'batteryName';
  if (isNum(t) && /SystemStats\/EpochTime$/i.test(n)) return 'epoch';
  return null;
}

/* ---------- collection ---------- */

interface Series { info: LogEntryInfo; role: Role; t: number[]; v: LogValue[] }

export async function analyzeLog(src: ByteSource & { name?: string; lastModified?: number }, onProgress?: (f: number) => void): Promise<MatchReport> {
  const series = new Map<number, Series>();
  const res = await readWpilog(src, {
    want: (e) => roleOf(e) != null,
    onEntry: (e) => {
      const role = roleOf(e);
      if (role) series.set(e.id, { info: e, role, t: [], v: [] });
    },
    onValue: (e, t, v) => {
      const s = series.get(e.id);
      if (s) { s.t.push(t); s.v.push(v); }
    },
    onProgress,
  });
  return buildReport([...series.values()], res.firstT, res.lastT, src.name ?? 'robot.wpilog', src.lastModified);
}

/* ---------- helpers ---------- */

/** value of a step signal at time t (last sample at or before t) */
function holdAt(s: Series | undefined, t: number): LogValue | undefined {
  if (!s || !s.t.length || t < s.t[0]) return undefined;
  let lo = 0, hi = s.t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.t[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return s.v[lo];
}

/** walk a step signal along an increasing time grid */
function cursor(s: Series) {
  let k = -1;
  return (t: number): LogValue | undefined => {
    while (k + 1 < s.t.length && s.t[k + 1] <= t) k++;
    return k >= 0 ? s.v[k] : undefined;
  };
}

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a: number[], p: number) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const maxOf = (s: Series | undefined, from = -Infinity, to = Infinity): number | null => {
  if (!s) return null;
  let m: number | null = null;
  s.v.forEach((v, i) => { if (typeof v === 'number' && s.t[i] >= from && s.t[i] <= to && (m == null || v > m)) m = v; });
  return m;
};
const round = (n: number | null, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

function prettyPart(p: string) {
  return p.replace(/Inputs$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

/** "/Shooter/follower0/CurrentSupplyAmps" → { subsystem: "Shooter", motor: "Shooter follower 0" } */
export function motorName(name: string, index: number | null, field: RegExp) {
  const parts = clean(name).split('/').filter(Boolean);
  const subsystem = prettyPart(parts[0] ?? 'Robot') || 'Robot';
  const lastRaw = parts[parts.length - 1] ?? '';
  const stripped = lastRaw.replace(field, '').trim();
  const mids = parts.slice(1, -1).map((p) => prettyPart(p).replace(/^follower ?(\d+)$/i, 'follower $1'));
  const bits = [subsystem, ...mids];
  if (stripped && stripped.toLowerCase() !== subsystem.toLowerCase()) bits.push(prettyPart(stripped));
  let motor = bits.join(' ');
  if (index != null) motor += ` ${index + 1}`;
  // "Drive Drive 1" → "Drive 1", "Drive Steer 1" stays
  motor = motor.replace(/^(\w+) \1\b/i, '$1');
  return { subsystem, motor };
}

const STATIONS = ['—', 'Red 1', 'Red 2', 'Red 3', 'Blue 1', 'Blue 2', 'Blue 3'];

/* ---------- the report ---------- */

export function buildReport(all: Series[], firstT: number, lastT: number, fileName: string, lastModified?: number): MatchReport {
  const by = (r: Role) => all.filter((s) => s.role === r);
  const one = (r: Role) => all.find((s) => s.role === r && s.t.length) ?? all.find((s) => s.role === r);

  const volt = one('voltage');
  const enabledS = one('enabled');
  const modeS = one('mode');

  /* enabled spans */
  const spans: { a: number; b: number }[] = [];
  if (enabledS) {
    let on: number | null = null;
    enabledS.v.forEach((v, i) => {
      if (v === true && on == null) on = enabledS.t[i];
      if (v === false && on != null) { spans.push({ a: on, b: enabledS.t[i] }); on = null; }
    });
    if (on != null) spans.push({ a: on, b: lastT });
  }
  const t0 = spans.length ? spans[0].a : firstT;
  const tEnd = spans.length ? spans[spans.length - 1].b : lastT;
  const rel = (t: number) => Math.round((t - t0) * 100) / 100;
  const inSpan = (t: number) => spans.some((s) => t >= s.a && t < s.b);

  const modeAt = (t: number): Phase['mode'] => {
    const m = holdAt(modeS, t + 0.001);
    if (typeof m === 'string') return /auto/i.test(m) ? 'auto' : /test/i.test(m) ? 'test' : 'teleop';
    if (holdAt(one('autoFlag'), t + 0.001) === true) return 'auto';
    if (holdAt(one('testFlag'), t + 0.001) === true) return 'test';
    return 'teleop';
  };
  const phases: Phase[] = spans.map((s) => ({ mode: modeAt(s.a), start: rel(s.a), end: rel(s.b) }));
  const enabledSec = spans.reduce((n, s) => n + s.b - s.a, 0);

  /* current sources */
  const pdh = one('pdhTotal');
  let currents = by('supply');
  let currentSource: MatchReport['battery']['currentSource'] = pdh ? 'pdh' : currents.length ? 'motor-supply' : 'none';
  if (!pdh && !currents.length && by('otherCurrent').length) { currents = by('otherCurrent'); currentSource = 'motor-other'; }

  // each motor channel (array signals split per element)
  interface Chan { s: Series; idx: number | null; subsystem: string; motor: string }
  const chans: Chan[] = [];
  for (const s of currents) {
    const width = s.v.reduce<number>((w, v) => (Array.isArray(v) ? Math.max(w, v.length) : w), 0);
    const field = /(supply)?[ _]?current[ _]?(supply)?[ _]?(amps)?$/i;
    if (isNumArr(s.info.type)) for (let k = 0; k < width; k++) chans.push({ s, idx: k, ...motorName(s.info.name, k, field) });
    else chans.push({ s, idx: null, ...motorName(s.info.name, null, field) });
  }

  /* resample everything we need on a 20 ms grid over the enabled spans */
  const DT = 0.02;
  const vCur = volt ? cursor(volt) : null;
  const pdhCur = pdh ? cursor(pdh) : null;
  const chanCur = chans.map((c) => ({ c, at: cursor(c.s) }));
  const subsAh = new Map<string, { ah: number; peak: number; sumA: number; n: number; motors: Set<string> }>();
  chans.forEach((c) => {
    const e = subsAh.get(c.subsystem) ?? { ah: 0, peak: 0, sumA: 0, n: 0, motors: new Set<string>() };
    e.motors.add(c.motor);
    subsAh.set(c.subsystem, e);
  });

  let ah = 0, wh = 0, peakA = 0, sumA = 0, sumV = 0, nV = 0, n = 0, minV = Infinity, under10 = 0, under8 = 0;
  let minT: number | null = null, peakT: number | null = null;
  const cumAh: number[] = [], cumWh: number[] = [];
  const fitI: number[] = [], fitV: number[] = [], fitT: number[] = [];
  const gridT: number[] = [], gridV: (number | null)[] = [], gridI: number[] = [];
  for (const s of spans) {
    for (let t = s.a; t < s.b; t += DT) {
      const v = vCur ? (vCur(t) as number | undefined) : undefined;
      let i = 0;
      const perSub = new Map<string, number>();
      for (const { c, at } of chanCur) {
        const raw = at(t);
        const x = c.idx == null ? (typeof raw === 'number' ? raw : 0) : (Array.isArray(raw) ? Number(raw[c.idx] ?? 0) : 0);
        const a = Math.max(0, Number.isFinite(x) ? x : 0);
        i += a;
        perSub.set(c.subsystem, (perSub.get(c.subsystem) ?? 0) + a);
      }
      if (pdhCur) { const p = pdhCur(t); if (typeof p === 'number') i = p; }
      perSub.forEach((a, k) => {
        const e = subsAh.get(k)!;
        e.ah += (a * DT) / 3600; e.sumA += a; e.n++; if (a > e.peak) e.peak = a;
      });
      ah += (i * DT) / 3600;
      sumA += i; n++;
      if (i > peakA) { peakA = i; peakT = t; }
      if (typeof v === 'number' && v > 1) {
        wh += (v * i * DT) / 3600;
        sumV += v; nV++;
        if (v < minV) { minV = v; minT = t; }
        if (v < 10) under10 += DT;
        if (v < 8) under8 += DT;
        fitI.push(i); fitV.push(v); fitT.push(t);
      }
      gridT.push(t); gridV.push(typeof v === 'number' ? v : null); gridI.push(i); cumAh.push(ah); cumWh.push(wh);
    }
  }
  // best 1-second average current
  let peak1s = 0, peak1sT: number | null = null;
  { const w = Math.round(1 / DT); let acc = 0; for (let k = 0; k < gridI.length; k++) { acc += gridI[k]; if (k >= w) acc -= gridI[k - w]; if (k >= w - 1 && acc / w > peak1s) { peak1s = acc / w; peak1sT = gridT[k - w + 1]; } } }
  // stretches of the grid below a voltage, merged across gaps under 0.25 s
  const below = (lim: number): Span[] => {
    const out: Span[] = [];
    let a: number | null = null, last = 0;
    gridV.forEach((v, k) => {
      const t = gridT[k];
      if (v != null && v > 1 && v < lim) {
        if (a == null) a = t;
        else if (t - last > 0.25) { out.push([a, last + DT]); a = t; }
        last = t;
      }
    });
    if (a != null) out.push([a, last + DT]);
    return out;
  };

  // V = a + b·t − R·I: the time term soaks up the slow voltage drop as the
  // battery discharges, so R reflects the instant sag under load (battery +
  // wiring + breaker). Needs a real spread of current to mean anything.
  let systemR: number | null = null, ocv: number | null = null;
  if (fitI.length > 100 && currentSource !== 'none') {
    const N = fitI.length;
    const mi = fitI.reduce((a, b) => a + b, 0) / N;
    const mv = fitV.reduce((a, b) => a + b, 0) / N;
    const mt = fitT.reduce((a, b) => a + b, 0) / N;
    let sii = 0, stt = 0, sit = 0, siv = 0, stv = 0;
    for (let k = 0; k < N; k++) {
      const di = fitI[k] - mi, dt = fitT[k] - mt, dv = fitV[k] - mv;
      sii += di * di; stt += dt * dt; sit += di * dt; siv += di * dv; stv += dt * dv;
    }
    const det = sii * stt - sit * sit;
    if (det > 0 && Math.sqrt(sii / N) > 10) {
      const c = (siv * stt - stv * sit) / det; // volts per amp
      if (c < 0) { systemR = -c * 1000; ocv = mv - c * mi; }
    }
  }

  // resting voltage: median of the 5 s before the first enable; recovered voltage 3–15 s after the last disable
  const vIn = (a: number, b: number) => (volt ? volt.v.filter((v, k) => typeof v === 'number' && volt.t[k] >= a && volt.t[k] < b) as number[] : []);
  let restV = median(vIn(t0 - 5, t0));
  if (restV == null && volt && spans.length) { const r = holdAt(volt, t0); restV = typeof r === 'number' ? r : null; }
  if (!spans.length && volt) restV = median(volt.v.filter((v): v is number => typeof v === 'number'));
  const endV = spans.length ? median(vIn(tEnd + 3, tEnd + 15)) : null;

  /* brownouts and load shedding */
  const edges = (s: Series | undefined) => {
    const out: { a: number; b: number }[] = [];
    if (!s) return out;
    let on: number | null = null;
    s.v.forEach((v, k) => {
      if (v === true && on == null) on = s.t[k];
      if (v === false && on != null) { out.push({ a: on, b: s.t[k] }); on = null; }
    });
    if (on != null) out.push({ a: on, b: lastT });
    return out;
  };
  const browns = edges(one('brownout'));
  const bc = one('brownoutCount');
  const bcDelta = bc && bc.v.length ? (Number(bc.v[bc.v.length - 1]) || 0) - (Number(bc.v[0]) || 0) : 0;
  const shed = edges(one('loadshed')).filter((e) => inSpan(e.a));
  const spanRel = (xs: { a: number; b: number }[] | Span[]): number[] =>
    xs.slice(0, 300).flatMap((x) => (Array.isArray(x) ? [rel(x[0]), rel(x[1])] : [rel(x.a), rel(x.b)]));
  const marks: BatteryMarks = {
    minT: minT == null ? null : rel(minT),
    peakT: peakT == null || currentSource === 'none' ? null : rel(peakT),
    peak1sT: peak1sT == null || currentSource === 'none' ? null : rel(peak1sT),
    under10: spanRel(below(10)),
    under8: spanRel(below(8)),
    brownouts: spanRel(browns),
    loadShed: spanRel(shed),
  };

  /* subsystems */
  const totalSubAh = [...subsAh.values()].reduce((x, e) => x + e.ah, 0);
  const subsystems: SubsystemPower[] = [...subsAh.entries()]
    .map(([name, e]) => ({ name, ah: round(e.ah, 3)!, share: totalSubAh ? round(e.ah / totalSubAh, 4)! : 0, peakA: round(e.peak, 0)!, avgA: round(e.n ? e.sumA / e.n : 0, 1)!, motors: e.motors.size }))
    .filter((s) => s.ah > 0.0005 || s.peakA > 0)
    .sort((a, b) => b.ah - a.ah);

  /* motor temperatures */
  const temps: MotorTemp[] = [];
  for (const s of by('temp')) {
    const field = /(motor)?[ _]?temp(erature)?[ _]?(celsius|c)?$/i;
    if (isNumArr(s.info.type)) {
      const width = s.v.reduce<number>((w, v) => (Array.isArray(v) ? Math.max(w, v.length) : w), 0);
      for (let k = 0; k < width; k++) {
        const vals = s.v.map((v) => (Array.isArray(v) ? Number(v[k]) : NaN)).filter(Number.isFinite);
        if (!vals.length) continue;
        const { subsystem, motor } = motorName(s.info.name, k, field);
        temps.push({ name: motor, subsystem, maxC: round(Math.max(...vals), 1)!, endC: round(vals[vals.length - 1], 1)! });
      }
    } else {
      const vals = s.v.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (!vals.length) continue;
      const { subsystem, motor } = motorName(s.info.name, null, field);
      temps.push({ name: motor, subsystem, maxC: round(Math.max(...vals), 1)!, endC: round(vals[vals.length - 1], 1)! });
    }
  }
  temps.sort((a, b) => b.maxC - a.maxC);

  /* events */
  const events: ReportEvent[] = [];
  phases.forEach((p) => events.push({ t: p.start, kind: 'mode', level: 'info', text: `${p.mode === 'auto' ? 'Auto' : p.mode === 'test' ? 'Test' : 'Teleop'} enabled (${Math.round(p.end - p.start)} s)` }));
  browns.forEach((b) => {
    const v = vIn(b.a - 0.2, b.b + 0.2);
    events.push({ t: rel(b.a), kind: 'brownout', level: 'bad', text: `Brownout for ${Math.max(0.01, b.b - b.a).toFixed(2)} s${v.length ? `, battery at ${Math.min(...v).toFixed(2)} V` : ''}` });
  });
  if (!browns.length && bcDelta > 0) events.push({ t: 0, kind: 'brownout', level: 'bad', text: `${bcDelta} brownout faults counted` });
  // load shedding: one line per burst of activations within 5 s of each other
  for (let k = 0; k < shed.length;) {
    let j = k; let secs = 0;
    while (j < shed.length && (j === k || shed[j].a - shed[j - 1].b < 5)) { secs += shed[j].b - shed[j].a; j++; }
    events.push({ t: rel(shed[k].a), kind: 'loadshed', level: 'warn', text: `Load shedding on ${j - k > 1 ? `${j - k} times over ${Math.round(shed[j - 1].b - shed[k].a)} s` : `for ${secs.toFixed(1)} s`}` });
    k = j;
  }
  const tips = edges(one('tip')).filter((e) => inSpan(e.a));
  tips.forEach((e) => events.push({ t: rel(e.a), kind: 'tip', level: 'warn', text: `Robot tipping detected (${(e.b - e.a).toFixed(1)} s)` }));
  for (const s of by('connected')) {
    let seenTrue = false;
    s.v.forEach((v, k) => {
      if (v === true) seenTrue = true;
      else if (v === false && seenTrue && s.t[k] >= t0 - 30 && s.t[k] <= tEnd + 5) {
        const back = s.v.findIndex((x, q) => q > k && x === true);
        const name = clean(s.info.name).split('/').filter(Boolean).map(prettyPart).join(' ').replace(/ ?connected$/i, '').replace(/^CANstatus /i, '').replace(/ID(\d+)$/, ' (CAN $1)');
        events.push({ t: rel(s.t[k]), kind: 'disconnect', level: 'bad', text: `${name} disconnected${back > 0 ? ` for ${(s.t[back] - s.t[k]).toFixed(1)} s` : ' and never came back'}` });
      }
    });
  }
  const ds = one('ds');
  if (ds) ds.v.forEach((v, k) => { if (v === false && inSpan(ds.t[k])) events.push({ t: rel(ds.t[k]), kind: 'ds', level: 'bad', text: 'Driver station connection lost while enabled' }); });
  for (const [role, level] of [['alertErr', 'bad'], ['alertWarn', 'warn']] as const) {
    const s = one(role);
    if (!s) continue;
    const seen = new Set<string>();
    // alerts raised before the match only count if they were still up when it started
    const live = holdAt(s, t0 + 0.001);
    const activeAtStart = new Set(Array.isArray(live) ? (live as string[]) : []);
    s.v.forEach((v, k) => {
      if (!Array.isArray(v)) return;
      for (const msg of v as string[]) {
        if (seen.has(msg)) continue;
        if (s.t[k] < t0 && !activeAtStart.has(msg)) continue;
        seen.add(msg);
        events.push({ t: s.t[k] < t0 ? 0 : rel(s.t[k]), kind: 'alert', level, text: (s.t[k] < t0 ? 'Active at the start: ' : '') + (msg.length > 160 ? `${msg.slice(0, 157)}…` : msg) });
      }
    });
  }
  // console: count the noisy kinds, surface the first few real errors
  let consoleOverruns = 0, watchdog = 0;
  const con = one('console');
  if (con) {
    const errs = new Set<string>();
    con.v.forEach((v, k) => {
      if (typeof v !== 'string') return;
      for (const line of v.split('\n')) {
        if (/loop (time of .* )?overrun|loop overrun/i.test(line)) { consoleOverruns++; continue; }
        if (/watchdog not fed/i.test(line)) { watchdog++; continue; }
        if (/^(error|exception)|\berror at\b|exception in|unhandled exception|CAN frame not received|stale|timed out/i.test(line.trim()) && errs.size < 8) {
          const key = line.trim().slice(0, 140);
          if (!errs.has(key) && con.t[k] >= t0 - 60) { errs.add(key); events.push({ t: rel(con.t[k]), kind: 'console', level: 'warn', text: key }); }
        }
      }
    });
  }
  events.sort((a, b) => a.t - b.t);
  const capped = events.slice(0, 80);

  /* code health */
  const cyc = one('cycle');
  let loopPeriodMs: number | null = null, loopMedianMs = null, loopP99Ms = null, loopMaxMs = null, overruns = 0, overrunPct: number | null = null;
  if (cyc && cyc.t.length > 10) {
    const gaps: number[] = [];
    for (let k = 1; k < Math.min(cyc.t.length, 2000); k++) gaps.push((cyc.t[k] - cyc.t[k - 1]) * 1000);
    loopPeriodMs = Math.max(5, Math.round(median(gaps) ?? 20));
    const vals = cyc.v.filter((v, k): v is number => typeof v === 'number' && inSpan(cyc.t[k]));
    if (vals.length) {
      loopMedianMs = round(median(vals), 2); loopP99Ms = round(pct(vals, 0.99), 2); loopMaxMs = round(Math.max(...vals), 1);
      overruns = vals.filter((v) => v > loopPeriodMs! * 1.05).length;
      overrunPct = round((overruns / vals.length) * 100, 2);
    }
  }
  const gc = one('gc');
  const gcMs = gc ? round(gc.v.filter((v, k): v is number => typeof v === 'number' && inSpan(gc.t[k])).reduce((a, b) => a + b, 0), 0) : null;
  const canMax = by('can').map((s) => maxOf(s, t0, tEnd)).filter((x): x is number => x != null);
  const canMaxPct = canMax.length ? Math.max(...canMax) : null;

  /* driving */
  let distanceM: number | null = null, topSpeed: number | null = null;
  const pose = by('pose').sort((a, b) => b.t.length - a.t.length)[0];
  if (pose) {
    distanceM = 0;
    let prev: number[] | null = null;
    pose.v.forEach((v, k) => {
      if (!Array.isArray(v) || !inSpan(pose.t[k])) { prev = null; return; }
      const p = v as number[];
      if (prev) { const d = Math.hypot(p[0] - prev[0], p[1] - prev[1]); if (d < 0.5) distanceM! += d; }
      prev = p;
    });
  }
  const speed = one('speed');
  if (speed) {
    let m = 0;
    speed.v.forEach((v, k) => { if (Array.isArray(v) && inSpan(speed.t[k])) { const sp = Math.hypot(Number(v[0]), Number(v[1])); if (sp < 10) m = Math.max(m, sp); } });
    topSpeed = m;
  } else if (pose) {
    let m = 0;
    for (let k = 0, j = 0; k < pose.t.length; k++) {
      while (pose.t[k] - pose.t[j] > 0.25) j++;
      const a = pose.v[j] as number[] | null, b = pose.v[k] as number[] | null;
      if (a && b && pose.t[k] - pose.t[j] > 0.1 && inSpan(pose.t[k])) { const sp = Math.hypot(b[0] - a[0], b[1] - a[1]) / (pose.t[k] - pose.t[j]); if (sp < 10) m = Math.max(m, sp); }
    }
    topSpeed = m;
  }

  /* match + robot info (values as of the first enable) */
  const at = (r: Role) => holdAt(one(r), t0 + 0.001) ?? (one(r)?.v.at(-1));
  const mt = Number(at('matchType') ?? 0);
  const mn = Number(at('matchNumber') ?? 0) || null;
  const type: MatchReport['match']['type'] = mt === 1 ? 'practice' : mt === 2 ? 'qual' : mt === 3 ? 'elim' : 'none';
  const label = type === 'none' || !mn ? 'Practice run' : `${type === 'practice' ? 'P' : type === 'qual' ? 'Q' : 'E'}${mn}`;
  const meta = (k: string) => {
    const s = by('meta').find((x) => x.info.name.endsWith(k));
    const v = s?.v.at(-1);
    return typeof v === 'string' ? v : '';
  };
  let auto = '';
  for (const s of by('auto')) {
    const v = holdAt(s, phases.find((p) => p.mode === 'auto') ? t0 : tEnd);
    if (typeof v === 'string' && v.trim()) { auto = v.trim(); break; }
  }
  const bn = one('batteryName');
  const batteryName = bn ? (bn.v.filter((v): v is string => typeof v === 'string' && !!v.trim()).at(-1) ?? null) : null;

  // when did this happen in the real world?
  let logStart: string | null = null;
  const ep = one('epoch');
  if (ep) {
    const k = ep.t.findIndex((t, q) => t >= t0 && typeof ep.v[q] === 'number' && (ep.v[q] as number) > 1.5e15);
    if (k >= 0) logStart = new Date((ep.v[k] as number) / 1000 - (ep.t[k] - t0) * 1000).toISOString();
  }
  if (!logStart) {
    const m = fileName.match(/(\d{2})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (m) logStart = new Date(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
    else if (lastModified) logStart = new Date(lastModified).toISOString();
  }

  /* chart trace: ~360 points from 5 s before the first enable to 10 s after the last disable */
  const trace = { t: [] as number[], v: [] as number[], i: [] as number[], ah: [] as number[], wh: [] as number[] };
  if (volt) {
    const a = spans.length ? t0 - 5 : firstT, b = spans.length ? tEnd + 10 : lastT;
    const buckets = 360, w = (b - a) / buckets;
    const vc = cursor(volt);
    let gi = 0;
    for (let k = 0; k < buckets; k++) {
      const ta = a + k * w, tb = ta + w;
      let vmin = Infinity;
      for (let t = ta; t < tb; t += Math.min(w, DT)) { const v = vc(t); if (typeof v === 'number' && v < vmin) vmin = v; }
      // include raw samples inside the bucket so short dips aren't missed
      let lo = 0, hi = volt.t.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (volt.t[mid] < ta) lo = mid + 1; else hi = mid; }
      for (let q = lo; q < volt.t.length && volt.t[q] < tb; q++) { const v = volt.v[q]; if (typeof v === 'number' && v < vmin) vmin = v; }
      let imax = 0;
      while (gi < gridT.length && gridT[gi] < ta) gi++;
      let q = gi;
      for (; q < gridT.length && gridT[q] < tb; q++) imax = Math.max(imax, gridI[q]);
      if (vmin === Infinity) continue;
      const last = q - 1; // running totals at the end of this slice
      trace.t.push(round(ta - t0, 2)!); trace.v.push(round(vmin, 2)!); trace.i.push(round(imax, 0)!);
      trace.ah.push(last >= 0 ? round(cumAh[last], 3)! : 0); trace.wh.push(last >= 0 ? round(cumWh[last], 2)! : 0);
    }
  }

  return {
    version: 1,
    fileName,
    logStart,
    match: { label, type, number: mn, replay: Number(at('replay') ?? 0) || null, event: String(at('event') ?? '').trim(), station: STATIONS[Number(at('station') ?? 0)] ?? '—', fms: at('fms') === true },
    robot: { project: meta('ProjectName'), branch: meta('GitBranch'), sha: meta('GitSHA').slice(0, 8), dirty: /uncommitted|dirty|true/i.test(meta('GitDirty')), built: meta('BuildDate'), auto },
    batteryName,
    enabled: spans.length > 0,
    phases,
    enabledSec: round(enabledSec, 1)!,
    logSec: round(lastT - firstT, 1)!,
    battery: {
      restV: round(restV, 2), minV: minV === Infinity ? null : round(minV, 2), avgV: nV ? round(sumV / nV, 2) : null, endV: round(endV, 2),
      sagV: restV != null && minV !== Infinity ? round(restV - minV, 2) : null,
      under10Sec: round(under10, 1)!, under8Sec: round(under8, 1)!,
      ah: currentSource === 'none' ? null : round(ah, 3), wh: currentSource === 'none' || !volt ? null : round(wh, 1),
      peakA: currentSource === 'none' ? null : round(peakA, 0), peak1sA: currentSource === 'none' ? null : round(peak1s, 0),
      avgA: currentSource === 'none' || !n ? null : round(sumA / n, 1),
      systemRmOhm: round(systemR, 1), ocvV: round(ocv, 2),
      brownouts: browns.length || (bcDelta > 0 ? 1 : 0), brownoutSec: round(browns.reduce((x, b) => x + b.b - b.a, 0), 2)!,
      loadShedCount: shed.length, loadShedSec: round(shed.reduce((x, e) => x + e.b - e.a, 0), 1)!,
      currentSource,
      marks,
    },
    subsystems,
    temps,
    health: {
      loopPeriodMs, loopMedianMs, loopP99Ms, loopMaxMs, overruns, overrunPct, consoleOverruns, watchdog,
      cpuMaxPct: round(maxOf(one('cpu'), t0, tEnd), 0), cpuMaxC: round(maxOf(one('cpuTemp')), 1), memMaxPct: round(maxOf(one('mem')), 0),
      canMaxPct: canMaxPct ? round(canMaxPct <= 1 ? canMaxPct * 100 : canMaxPct, 0) : null, gcMs,
    },
    drive: { distanceM: round(distanceM, 1), topSpeedMps: round(topSpeed, 2), tips: tips.length },
    events: capped,
    trace,
    signals: all.length,
  };
}
