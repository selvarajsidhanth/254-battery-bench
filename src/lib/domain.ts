/* Battery health rules. Everything here is pure so it can be unit tested. */
import type { Battery, Inspection, Settings, TestRecord } from './types';
import { DAY, MIN, ms } from './format';

export const DEFAULT_SETTINGS: Settings = {
  irMax: 15,
  irWatch: 12,
  socTarget: 130,
  socMin: 125,
  v0Min: 12.6,
  v0Watch: 13.0,
  mcaFloor: null,
  mcaEvery: 3,
  restMin: 20,
  chargeMin: 90,
  staleDays: 7,
  queueLeadMin: 15,
  matchMin: 3,
  projectWeeks: 6,
};

export type Level = 'ok' | 'watch' | 'pull';
export type Health = Level | 'untested' | 'retired';
const RANK: Record<Level, number> = { ok: 0, watch: 1, pull: 2 };
export const worst = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);

export const sortByTime = <T extends { at: string }>(xs: T[]) => [...xs].sort((a, b) => ms(a.at) - ms(b.at));

export function latestValue(tests: TestRecord[], key: 'ir' | 'v0' | 'soc' | 'mca'): { v: number; at: string } | null {
  for (let i = tests.length - 1; i >= 0; i--) {
    const v = tests[i][key];
    if (v != null && !Number.isNaN(v)) return { v, at: tests[i].at };
  }
  return null;
}

export interface Trend {
  perWeek: number; // mΩ per week
  n: number;
  /** fitted IR value at `now` */
  nowValue: number;
  /** days from `now` until the fit reaches `limit` (null if it isn't rising) */
  daysToLimit: number | null;
}

/** Least-squares IR trend over real time (not test count), using the last 90 days. */
export function irTrend(tests: TestRecord[], limit: number, now: number): Trend | null {
  const pts = tests
    .filter((t) => t.ir != null && now - ms(t.at) <= 90 * DAY)
    .map((t) => ({ x: (ms(t.at) - now) / DAY, y: t.ir as number }));
  if (pts.length < 3) return null;
  const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  if (span < 4) return null; // a burst of same-day tests says nothing about aging
  const n = pts.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - m * sx) / n; // value at x=0 (now)
  const daysToLimit = m > 0.005 ? Math.max(0, (limit - b) / m) : null;
  return { perWeek: m * 7, n, nowValue: b, daysToLimit };
}

export interface Assessment {
  health: Health;
  reasons: { level: Level; text: string }[];
  ir: number | null;
  v0: number | null;
  soc: number | null;
  mca: number | null;
  lastTestAt: string | null;
  trend: Trend | null;
  stale: boolean;
}

export function assess(b: Battery, tests: TestRecord[], s: Settings, now: number): Assessment {
  const ir = latestValue(tests, 'ir');
  const v0 = latestValue(tests, 'v0');
  const soc = latestValue(tests, 'soc');
  const mca = latestValue(tests, 'mca');
  const lastTestAt = tests.length ? tests[tests.length - 1].at : null;
  const trend = irTrend(tests, s.irMax, now);
  const stale = !b.retired && (!lastTestAt || now - ms(lastTestAt) > s.staleDays * DAY);
  const base = { ir: ir?.v ?? null, v0: v0?.v ?? null, soc: soc?.v ?? null, mca: mca?.v ?? null, lastTestAt, trend, stale };

  if (b.retired) return { ...base, health: 'retired', reasons: [] };
  if (!tests.length) return { ...base, health: 'untested', reasons: [] };

  const reasons: Assessment['reasons'] = [];
  if (ir) {
    if (ir.v >= s.irMax) reasons.push({ level: 'pull', text: `IR ${ir.v.toFixed(1)} mΩ is over the ${s.irMax} mΩ limit` });
    else if (ir.v >= s.irWatch) reasons.push({ level: 'watch', text: `IR ${ir.v.toFixed(1)} mΩ is in the watch zone` });
  }
  if (trend && trend.daysToLimit != null && (ir?.v ?? 0) < s.irMax && trend.daysToLimit <= s.projectWeeks * 7) {
    reasons.push({ level: 'watch', text: `IR climbing ${trend.perWeek.toFixed(2)} mΩ/week, reaches ${s.irMax} mΩ in about ${Math.max(1, Math.round(trend.daysToLimit / 7))} weeks` });
  }
  if (v0) {
    if (v0.v < s.v0Min) reasons.push({ level: 'pull', text: `Open-load voltage ${v0.v.toFixed(2)} V is below ${s.v0Min} V` });
    else if (v0.v < s.v0Watch) reasons.push({ level: 'watch', text: `Open-load voltage ${v0.v.toFixed(2)} V is under ${s.v0Watch} V` });
  }
  if (mca && s.mcaFloor != null) {
    if (mca.v < s.mcaFloor) reasons.push({ level: 'pull', text: `Cranking amps ${mca.v} below the ${s.mcaFloor} floor` });
    else if (mca.v < s.mcaFloor * 1.1) reasons.push({ level: 'watch', text: `Cranking amps ${mca.v} close to the ${s.mcaFloor} floor` });
  }
  const health = reasons.reduce<Level>((acc, r) => worst(acc, r.level), 'ok');
  return { ...base, health, reasons };
}

/* ---------- a single new reading, for the Log Test verdict ---------- */
export interface Reading {
  soc?: number | null;
  ir?: number | null;
  v0?: number | null;
  mca?: number | null;
  inspection?: Inspection | null;
}
export interface Check {
  key: string;
  label: string;
  rule: string;
  value: string;
  level: Level | 'na';
}

export function checkReading(r: Reading, s: Settings): { level: Level; checks: Check[] } {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  add({
    key: 'soc', label: 'State of charge', rule: `≥ ${s.socMin}% to trust the reading`,
    value: r.soc != null ? `${r.soc}%` : '—',
    level: r.soc == null ? 'na' : r.soc < s.socMin ? 'watch' : 'ok',
  });
  add({
    key: 'ir', label: 'Internal resistance', rule: `limit ${s.irMax} · watch from ${s.irWatch}`,
    value: r.ir != null ? `${r.ir.toFixed(1)} mΩ` : '—',
    level: r.ir == null ? 'na' : r.ir >= s.irMax ? 'pull' : r.ir >= s.irWatch ? 'watch' : 'ok',
  });
  add({
    key: 'v0', label: 'Open-load voltage', rule: `≥ ${s.v0Watch.toFixed(1)} V fresh off charger`,
    value: r.v0 != null ? `${r.v0.toFixed(2)} V` : '—',
    level: r.v0 == null ? 'na' : r.v0 < s.v0Min ? 'pull' : r.v0 < s.v0Watch ? 'watch' : 'ok',
  });
  add({
    key: 'mca', label: 'Cranking amps', rule: s.mcaFloor != null ? `floor ${s.mcaFloor}` : 'team floor not set yet',
    value: r.mca != null ? String(r.mca) : '—',
    level: r.mca == null || s.mcaFloor == null ? 'na' : r.mca < s.mcaFloor ? 'pull' : r.mca < s.mcaFloor * 1.1 ? 'watch' : 'ok',
  });
  if (r.inspection) {
    const n = Object.values(r.inspection).filter(Boolean).length;
    // nothing ticked = not done yet; some ticked but not all = something looked wrong
    add({ key: 'insp', label: 'Inspection', rule: `${n} of 4 checked`, value: n === 4 ? 'Clear' : n === 0 ? 'Not done' : 'Open', level: n === 4 ? 'ok' : n === 0 ? 'na' : 'watch' });
  }
  const level = checks.reduce<Level>((acc, c) => (c.level === 'na' ? acc : worst(acc, c.level)), 'ok');
  return { level, checks };
}

/** Is an AutoMeter (MCA) reading due on this battery's next test? */
export function mcaDue(tests: TestRecord[], s: Settings): { due: boolean; testsSince: number } {
  let since = 0;
  for (let i = tests.length - 1; i >= 0; i--) {
    if (tests[i].mca != null) return { due: since >= s.mcaEvery - 1, testsSince: since };
    since++;
  }
  return { due: true, testsSince: since };
}

/* ---------- rotation timing ---------- */
export function chargeStatus(b: Battery, s: Settings, now: number): { soc: number; remainingMin: number; checked: boolean } {
  const rate = s.socTarget / s.chargeMin; // % per minute, linear approximation
  const check = b.chargeCheck && ms(b.chargeCheck.at) >= ms(b.stateSince) ? b.chargeCheck : null;
  const soc = check
    ? check.soc + (rate * (now - ms(check.at))) / MIN
    : (rate * (now - ms(b.stateSince))) / MIN;
  const capped = Math.min(s.socTarget, Math.max(0, soc));
  return { soc: capped, remainingMin: Math.max(0, (s.socTarget - capped) / rate), checked: !!check };
}

export function restRemainingMin(b: Battery, s: Settings, now: number): number {
  return Math.max(0, s.restMin - (now - ms(b.stateSince)) / MIN);
}
