/* Battery health rules. Everything here is pure so it can be unit tested.

   A battery's standing comes from its bench tests:
     CBA  (capacity discharge) → amp-hours + internal resistance before/after
     MCA  (cranking-amps load test) → one number
   Both must pass the team's thresholds. Batteries that pass the competition
   thresholds are ranked by capacity; the best `compCount` are competition
   batteries, the rest fall back to practice.

   A Battery Beak reading taken on the day can still pull or watch a battery
   (e.g. a pack that's fine on the bench but reads high IR in the pit). */
import type { Battery, Inspection, Settings, TestKind, TestRecord } from './types';
import { DAY, MIN, ms } from './format';

/** robotFor value for a quick systems check rather than a match */
export const SYSCHECK = 'Systems check';
/** Roughly what a pack still holds after a systems check, as a share of a full charge. */
export const SYSCHECK_LEFT = 0.9;
export const savedForComp = (b: Battery) => !!b.quarantined && b.quarantineFor !== 'hold';
export const heldOut = (b: Battery) => !!b.quarantined && b.quarantineFor === 'hold';

export const DEFAULT_SETTINGS: Settings = {
  compMinAh: 15.5,
  compMaxRint: 25,
  compMinMca: 225,
  compCbaMonths: 1,
  compMcaMonths: 2,
  compCount: 14,
  pracMinAh: 11,
  pracMaxRint: 35,
  pracMinMca: 210,
  pracCbaMonths: 6,
  pracMcaMonths: 6,
  irMax: 15,
  irWatch: 12,
  socTarget: 130,
  socMin: 125,
  v0Min: 12.6,
  v0Watch: 13.0,
  chargeMin: 90,
  queueLeadMin: 15,
  matchMin: 3,
  projectWeeks: 6,
};

export type Level = 'ok' | 'watch' | 'pull';
export type Health = Level | 'untested' | 'retired';
/** competition / practice / not suitable / still missing a CBA or MCA test */
export type Tier = 'competition' | 'practice' | 'none' | 'incomplete';
const RANK: Record<Level, number> = { ok: 0, watch: 1, pull: 2 };
export const worst = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);

export const sortByTime = <T extends { at: string }>(xs: T[]) => [...xs].sort((a, b) => ms(a.at) - ms(b.at));

/** Old records have no `kind`; work it out from which fields are filled. */
export function kindOf(t: TestRecord): TestKind {
  if (t.kind) return t.kind;
  if (t.ah != null || t.rintPre != null || t.rintPost != null || t.wh != null) return 'cba';
  if (t.mca != null && t.ir == null && t.soc == null && t.v0 == null) return 'mca';
  return 'beak';
}

type NumKey = 'ir' | 'v0' | 'soc' | 'mca' | 'ah' | 'wh' | 'rintPre' | 'rintPost';
export function latestValue(tests: TestRecord[], key: NumKey): { v: number; at: string } | null {
  for (let i = tests.length - 1; i >= 0; i--) {
    const v = tests[i][key];
    if (v != null && !Number.isNaN(v)) return { v, at: tests[i].at };
  }
  return null;
}
const lastOfKind = (tests: TestRecord[], k: TestKind) => {
  for (let i = tests.length - 1; i >= 0; i--) if (kindOf(tests[i]) === k) return tests[i];
  return null;
};

/** R_int typed as ohms (0.019) instead of milliohms (19)? Convert. */
export const toMilliohms = (v: number | null | undefined) => (v == null ? null : v > 0 && v < 1 ? +(v * 1000).toFixed(2) : v);

export function addMonths(iso: string, months: number): number {
  const d = new Date(iso);
  if (Number.isInteger(months)) { d.setMonth(d.getMonth() + months); return d.getTime(); }
  return d.getTime() + months * 30.44 * DAY;
}

export interface Trend {
  perWeek: number; // units per week
  n: number;
  nowValue: number; // fitted value at `now`
  /** days from `now` until the fit crosses `limit` (null if it isn't heading there) */
  daysToLimit: number | null;
}

/** Least-squares trend over real time (not test count), last 180 days. */
export function fitTrend(points: { at: string; v: number }[], limit: number, worseWhen: 'up' | 'down', now: number): Trend | null {
  const pts = points.filter((p) => now - ms(p.at) <= 180 * DAY).map((p) => ({ x: (ms(p.at) - now) / DAY, y: p.v }));
  if (pts.length < 3) return null;
  const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  if (span < 4) return null; // a burst of same-day tests says nothing about aging
  const n = pts.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - m * sx) / n;
  const heading = worseWhen === 'up' ? m > 0.005 : m < -0.005;
  const daysToLimit = heading ? Math.max(0, (limit - b) / m) : null;
  return { perWeek: m * 7, n, nowValue: b, daysToLimit };
}
/** Beak IR trend (kept for the pit check). */
export const irTrend = (tests: TestRecord[], limit: number, now: number) =>
  fitTrend(tests.filter((t) => t.ir != null).map((t) => ({ at: t.at, v: t.ir as number })), limit, 'up', now);

export interface Assessment {
  health: Health;
  tier: Tier;
  rank: number | null; // 1 = best capacity among batteries that pass competition thresholds
  reasons: { level: Level; text: string }[];
  ah: number | null;
  wh: number | null;
  rintPre: number | null;
  rintPost: number | null;
  mca: number | null;
  ir: number | null; // Beak
  v0: number | null;
  soc: number | null;
  lastCbaAt: string | null;
  lastMcaAt: string | null;
  lastBeakAt: string | null;
  lastTestAt: string | null;
  cbaDue: boolean;
  mcaDue: boolean;
  /** true when either bench test is due */
  stale: boolean;
  capTrend: Trend | null; // CBA amp-hours over time
  irTrend: Trend | null; // Beak IR over time
}

interface Base {
  b: Battery;
  ah: number | null; rintPre: number | null; mca: number | null;
  passComp: boolean; passPrac: boolean;
  compMiss: string[]; pracMiss: string[]; missing: string[];
}

function bench(b: Battery, tests: TestRecord[], s: Settings): Base {
  const cba = lastOfKind(tests, 'cba');
  const mcaT = [...tests].reverse().find((t) => t.mca != null) ?? null;
  const ah = cba?.ah ?? null;
  const rintPre = cba?.rintPre ?? null;
  const mca = mcaT?.mca ?? null;
  const compMiss: string[] = [], pracMiss: string[] = [], missing: string[] = [];
  if (!cba) missing.push('Needs a CBA test');
  if (mca == null) missing.push('Needs an MCA test');
  if (ah != null) {
    if (ah < s.compMinAh) compMiss.push(`Capacity ${ah.toFixed(2)} Ah is under the ${s.compMinAh} Ah competition minimum`);
    if (ah < s.pracMinAh) pracMiss.push(`Capacity ${ah.toFixed(2)} Ah is under the ${s.pracMinAh} Ah practice minimum`);
  }
  if (rintPre != null) {
    if (rintPre > s.compMaxRint) compMiss.push(`CBA R_int ${rintPre.toFixed(0)} mΩ is over the ${s.compMaxRint} mΩ competition maximum`);
    if (rintPre > s.pracMaxRint) pracMiss.push(`CBA R_int ${rintPre.toFixed(0)} mΩ is over the ${s.pracMaxRint} mΩ practice maximum`);
  }
  if (mca != null) {
    if (mca < s.compMinMca) compMiss.push(`MCA ${mca} is under the ${s.compMinMca} competition minimum`);
    if (mca < s.pracMinMca) pracMiss.push(`MCA ${mca} is under the ${s.pracMinMca} practice minimum`);
  }
  const complete = missing.length === 0;
  return { b, ah, rintPre, mca, passComp: complete && compMiss.length === 0, passPrac: complete && pracMiss.length === 0, compMiss, pracMiss, missing };
}

/** Assess every battery at once (rank depends on the whole fleet). */
export function assessFleet(batteries: Battery[], testsBy: Record<string, TestRecord[]>, s: Settings, now: number): Record<string, Assessment> {
  const bases = batteries.map((b) => bench(b, testsBy[b.id] ?? [], s));
  const ranked = bases.filter((x) => !x.b.retired && x.passComp).sort((a, b) => (b.ah ?? 0) - (a.ah ?? 0));
  const rankOf = new Map(ranked.map((x, i) => [x.b.id, i + 1]));
  const out: Record<string, Assessment> = {};

  for (const x of bases) {
    const { b } = x;
    const tests = testsBy[b.id] ?? [];
    const cba = lastOfKind(tests, 'cba');
    const beak = lastOfKind(tests, 'beak');
    const mcaT = [...tests].reverse().find((t) => t.mca != null) ?? null;
    const rank = rankOf.get(b.id) ?? null;

    let tier: Tier;
    const reasons: Assessment['reasons'] = [];
    if (rank != null && rank <= s.compCount) tier = 'competition';
    else if (x.passPrac) {
      tier = 'practice';
      if (rank != null) reasons.push({ level: 'watch', text: `Ranked #${rank} by capacity; only the top ${s.compCount} run at competition` });
      x.compMiss.forEach((t) => reasons.push({ level: 'watch', text: t }));
    } else if (x.pracMiss.length) {
      tier = 'none';
      x.pracMiss.forEach((t) => reasons.push({ level: 'pull', text: t }));
    } else {
      tier = 'incomplete';
      x.missing.forEach((t) => reasons.push({ level: 'watch', text: t }));
    }

    // when each bench test is due again (decommissioned and failed batteries aren't scheduled)
    const months = (k: 'cba' | 'mca') => tier === 'competition' ? (k === 'cba' ? s.compCbaMonths : s.compMcaMonths) : (k === 'cba' ? s.pracCbaMonths : s.pracMcaMonths);
    const due = (last: string | null, k: 'cba' | 'mca') =>
      !b.retired && tier !== 'none' && (!last || now >= addMonths(last, months(k)));
    const cbaDue = due(cba?.at ?? null, 'cba');
    const mcaDue = due(mcaT?.at ?? null, 'mca');

    let health: Health = b.retired ? 'retired'
      : tier === 'competition' ? 'ok' : tier === 'practice' ? 'watch' : tier === 'none' ? 'pull' : 'untested';

    // a recent Beak reading can still pull or downgrade a battery for the day
    const ir = latestValue(tests, 'ir');
    const v0 = latestValue(tests, 'v0');
    const recentBeak = beak && now - ms(beak.at) <= 14 * DAY;
    if (!b.retired && recentBeak) {
      let lvl: Level = 'ok';
      if (beak.ir != null && beak.ir >= s.irMax) { lvl = 'pull'; reasons.unshift({ level: 'pull', text: `Beak IR ${beak.ir.toFixed(1)} mΩ is over the ${s.irMax} mΩ pit limit` }); }
      else if (beak.ir != null && beak.ir >= s.irWatch) { lvl = 'watch'; reasons.push({ level: 'watch', text: `Beak IR ${beak.ir.toFixed(1)} mΩ is in the watch zone` }); }
      if (beak.v0 != null && beak.v0 < s.v0Min) { lvl = 'pull'; reasons.unshift({ level: 'pull', text: `Open-load voltage ${beak.v0.toFixed(2)} V is below ${s.v0Min} V` }); }
      if (lvl !== 'ok' && (health === 'ok' || health === 'watch' || health === 'untested')) {
        health = health === 'untested' ? (lvl === 'pull' ? 'pull' : 'untested') : worst(health, lvl);
      }
    }

    const capPts = tests.filter((t) => t.ah != null).map((t) => ({ at: t.at, v: t.ah as number }));
    const capTrend = fitTrend(capPts, s.compMinAh, 'down', now);
    if (!b.retired && tier === 'competition' && capTrend?.daysToLimit != null && capTrend.daysToLimit <= s.projectWeeks * 7) {
      reasons.push({ level: 'watch', text: `Capacity dropping ${Math.abs(capTrend.perWeek).toFixed(2)} Ah/week, below ${s.compMinAh} Ah in about ${Math.max(1, Math.round(capTrend.daysToLimit / 7))} weeks` });
    }

    out[b.id] = {
      health, tier, rank, reasons,
      ah: x.ah, wh: cba?.wh ?? null, rintPre: x.rintPre, rintPost: cba?.rintPost ?? null, mca: x.mca,
      ir: ir?.v ?? null, v0: v0?.v ?? null, soc: latestValue(tests, 'soc')?.v ?? null,
      lastCbaAt: cba?.at ?? null, lastMcaAt: mcaT?.at ?? null, lastBeakAt: beak?.at ?? null,
      lastTestAt: tests.length ? tests[tests.length - 1].at : null,
      cbaDue, mcaDue, stale: cbaDue || mcaDue,
      capTrend, irTrend: irTrend(tests, s.irMax, now),
    };
  }
  return out;
}

/* ---------- a single new reading, for the Log Test verdict ---------- */
export interface Reading {
  soc?: number | null;
  ir?: number | null;
  v0?: number | null;
  mca?: number | null;
  ah?: number | null;
  rintPre?: number | null;
  rintPost?: number | null;
  wh?: number | null;
  inspection?: Inspection | null;
}
export interface Check {
  key: string;
  label: string;
  rule: string;
  value: string;
  level: Level | 'na';
}

/** Bench thresholds: meets competition → ok, meets practice → watch, else pull. */
const tierLevel = (v: number, comp: number, prac: number, higherBetter: boolean): Level =>
  higherBetter ? (v >= comp ? 'ok' : v >= prac ? 'watch' : 'pull') : (v <= comp ? 'ok' : v <= prac ? 'watch' : 'pull');

export function checkReading(kind: TestKind, r: Reading, s: Settings): { level: Level; checks: Check[] } {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  if (kind === 'cba') {
    add({ key: 'ah', label: 'Capacity', rule: `competition ≥ ${s.compMinAh} · practice ≥ ${s.pracMinAh} Ah`,
      value: r.ah != null ? `${r.ah.toFixed(2)} Ah` : '—', level: r.ah == null ? 'na' : tierLevel(r.ah, s.compMinAh, s.pracMinAh, true) });
    add({ key: 'rintPre', label: 'R_int before', rule: `competition ≤ ${s.compMaxRint} · practice ≤ ${s.pracMaxRint} mΩ`,
      value: r.rintPre != null ? `${r.rintPre.toFixed(0)} mΩ` : '—', level: r.rintPre == null ? 'na' : tierLevel(r.rintPre, s.compMaxRint, s.pracMaxRint, false) });
    add({ key: 'rintPost', label: 'R_int after', rule: 'recorded for the trend',
      value: r.rintPost != null ? `${r.rintPost.toFixed(0)} mΩ` : '—', level: 'na' });
    const v = r.wh != null && r.ah != null && r.ah > 0.05 ? r.wh / r.ah : null;
    add({ key: 'wh', label: 'Energy', rule: 'what the motors get · Wh ÷ Ah = average voltage', value: r.wh != null ? `${r.wh.toFixed(1)} Wh${v != null && v > 6 && v < 15 ? ` · avg ${v.toFixed(2)} V` : ''}` : '—', level: 'na' });
  } else if (kind === 'mca') {
    add({ key: 'mca', label: 'Cranking amps', rule: `competition ≥ ${s.compMinMca} · practice ≥ ${s.pracMinMca}`,
      value: r.mca != null ? String(r.mca) : '—', level: r.mca == null ? 'na' : tierLevel(r.mca, s.compMinMca, s.pracMinMca, true) });
  } else {
    add({ key: 'soc', label: 'State of charge', rule: `≥ ${s.socMin}% to trust the reading`,
      value: r.soc != null ? `${r.soc}%` : '—', level: r.soc == null ? 'na' : r.soc < s.socMin ? 'watch' : 'ok' });
    add({ key: 'ir', label: 'Internal resistance', rule: `pull at ${s.irMax} · watch from ${s.irWatch} mΩ`,
      value: r.ir != null ? `${r.ir.toFixed(1)} mΩ` : '—', level: r.ir == null ? 'na' : r.ir >= s.irMax ? 'pull' : r.ir >= s.irWatch ? 'watch' : 'ok' });
    add({ key: 'v0', label: 'Open-load voltage', rule: `≥ ${s.v0Watch.toFixed(1)} V fresh off charger`,
      value: r.v0 != null ? `${r.v0.toFixed(2)} V` : '—', level: r.v0 == null ? 'na' : r.v0 < s.v0Min ? 'pull' : r.v0 < s.v0Watch ? 'watch' : 'ok' });
  }
  if (r.inspection) {
    const n = Object.values(r.inspection).filter(Boolean).length;
    // nothing ticked = not done yet; some ticked but not all = something looked wrong
    add({ key: 'insp', label: 'Inspection', rule: `${n} of 4 checked`, value: n === 4 ? 'Clear' : n === 0 ? 'Not done' : 'Open', level: n === 4 ? 'ok' : n === 0 ? 'na' : 'watch' });
  }
  const level = checks.reduce<Level>((acc, c) => (c.level === 'na' ? acc : worst(acc, c.level)), 'ok');
  return { level, checks };
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

