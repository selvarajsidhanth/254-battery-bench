import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, assess, chargeStatus, checkReading, irTrend, mcaDue, restRemainingMin } from './domain';
import { planMatches } from './plan';
import { guessMapping, normalizeLabel, parseDate, parseTestRows, TEST_FIELDS } from './csv';
import { parseScheduleLines } from './schedule';
import type { Battery, EventConfig, TestRecord } from './types';

const NOW = Date.UTC(2026, 10, 3, 18, 0);
const DAY = 86_400_000, MIN = 60_000;
const S = DEFAULT_SETTINGS;
const iso = (t: number) => new Date(t).toISOString();

function bat(id: string, over: Partial<Battery> = {}): Battery {
  return { id, label: id.toUpperCase(), retired: false, state: 'ready', stateSince: iso(NOW - 10 * MIN), cycles: 0, createdAt: iso(NOW - 100 * DAY), ...over };
}
function weekly(id: string, irs: number[], extra: Partial<TestRecord> = {}): TestRecord[] {
  return irs.map((ir, i) => ({ id: `${id}-${i}`, batteryId: id, at: iso(NOW - (irs.length - 1 - i) * 7 * DAY - DAY), ir, soc: 130, v0: 13.2, ...extra }));
}

describe('IR trend', () => {
  it('measures change per week over real time, not per test', () => {
    const t = irTrend(weekly('a', [9, 9.5, 10, 10.5, 11]), 15, NOW)!;
    expect(t.perWeek).toBeCloseTo(0.5, 2);
    expect(t.daysToLimit! / 7).toBeCloseTo((15 - 11.07) / 0.5, 0);
  });
  it('ignores a burst of same-day tests', () => {
    const burst = [9, 9.4, 9.9].map((ir, i) => ({ id: String(i), batteryId: 'a', at: iso(NOW - i * 60 * MIN), ir }));
    expect(irTrend(burst, 15, NOW)).toBeNull();
  });
});

describe('health', () => {
  it('pulls a battery over the IR limit', () => {
    expect(assess(bat('a'), weekly('a', [12, 13, 14, 15.4]), S, NOW).health).toBe('pull');
  });
  it('watches a battery that is fine today but projected to cross the limit soon', () => {
    const a = assess(bat('a'), weekly('a', [9, 9.6, 10.2, 10.8, 11.4]), S, NOW);
    expect(a.ir).toBe(11.4);
    expect(a.health).toBe('watch');
  });
  it('calls a flat, low battery match-ready', () => {
    expect(assess(bat('a'), weekly('a', [7.5, 7.6, 7.5, 7.6]), S, NOW).health).toBe('ok');
  });
  it('pulls on low open-load voltage even when IR is fine', () => {
    expect(assess(bat('a'), weekly('a', [8, 8, 8], { v0: 12.4 }), S, NOW).health).toBe('pull');
  });
  it('marks untested and retired batteries', () => {
    expect(assess(bat('a'), [], S, NOW).health).toBe('untested');
    expect(assess(bat('a', { retired: true }), weekly('a', [8]), S, NOW).health).toBe('retired');
  });
  it('flags stale batteries', () => {
    const t = [{ id: 'x', batteryId: 'a', at: iso(NOW - 10 * DAY), ir: 8 }];
    expect(assess(bat('a'), t, S, NOW).stale).toBe(true);
  });
});

describe('log-test verdict', () => {
  it('treats low charge as "retest", not a failure', () => {
    const v = checkReading({ soc: 118, ir: 9, v0: 13.1 }, S);
    expect(v.level).toBe('watch');
    expect(v.checks.find((c) => c.key === 'soc')!.level).toBe('watch');
  });
  it('fails on IR', () => expect(checkReading({ soc: 130, ir: 15.2 }, S).level).toBe('pull'));
  it('skips MCA until the team sets a floor', () =>
    expect(checkReading({ mca: 500 }, S).checks.find((c) => c.key === 'mca')!.level).toBe('na'));
  it('asks for MCA every Nth test', () => {
    const t = (mca: number | null, i: number): TestRecord => ({ id: String(i), batteryId: 'a', at: iso(NOW - i * DAY), mca });
    expect(mcaDue([], S).due).toBe(true);
    expect(mcaDue([t(900, 3)], S).due).toBe(false);
    expect(mcaDue([t(900, 3), t(null, 2), t(null, 1)], S).due).toBe(true);
  });
});

describe('rotation timing', () => {
  it('estimates charge from time on the charger', () => {
    const c = chargeStatus(bat('a', { state: 'charging', stateSince: iso(NOW - 45 * MIN) }), S, NOW);
    expect(c.soc).toBeCloseTo(65, 0);
    expect(c.remainingMin).toBeCloseTo(45, 0);
  });
  it('uses a Beak check when there is one', () => {
    const c = chargeStatus(bat('a', { state: 'charging', stateSince: iso(NOW - 45 * MIN), chargeCheck: { soc: 110, at: iso(NOW) } }), S, NOW);
    expect(c.checked).toBe(true);
    expect(c.remainingMin).toBeCloseTo((20 / 130) * 90, 0);
  });
  it('counts down the rest period', () => {
    expect(restRemainingMin(bat('a', { state: 'resting', stateSince: iso(NOW - 5 * MIN) }), S, NOW)).toBeCloseTo(15, 5);
  });
});

describe('match planner', () => {
  const ev = (mins: number[]): EventConfig => ({ mode: 'comp', name: 'T', assignments: {}, matches: mins.map((m, i) => ({ key: `qm${i}`, label: `Q${i}`, time: iso(NOW + m * MIN) })) });
  const health = (ids: string[], irs: number[], h: 'ok' | 'watch' = 'ok') =>
    Object.fromEntries(ids.map((id, i) => [id, { health: h, ir: irs[i] } as never]));

  it('gives the next match the lowest-IR ready battery and never reuses one too soon', () => {
    const bs = [bat('a'), bat('b'), bat('c')];
    const rows = planMatches(bs, health(['a', 'b', 'c'], [9, 7.5, 8]), S, ev([30, 40, 50]), NOW);
    expect(rows.map((r) => r.batteryId)).toEqual(['b', 'c', 'a']);
    expect(rows.every((r) => r.status === 'ready')).toBe(true);
  });
  it('marks a match tight when nothing can be charged in time', () => {
    const bs = [bat('a')];
    const rows = planMatches(bs, health(['a'], [8]), S, ev([30, 45]), NOW);
    expect(rows[0].status).toBe('ready');
    expect(rows[1].status).toBe('tight');
    expect(rows[1].lateMin).toBeGreaterThan(60);
  });
  it('holds back watch batteries', () => {
    const rows = planMatches([bat('a')], health(['a'], [13], 'watch'), S, ev([30]), NOW);
    expect(rows[0].status).toBe('none');
  });
  it('respects a manual assignment', () => {
    const e = ev([30]);
    e.assignments.qm0 = 'a';
    const rows = planMatches([bat('a'), bat('b')], health(['a', 'b'], [9, 7]), S, e, NOW);
    expect(rows[0].batteryId).toBe('a');
    expect(rows[0].manual).toBe(true);
  });
});

describe('CSV import', () => {
  it('guesses columns from typical sheet headers', () => {
    const m = guessMapping(['Battery #', 'Date Tested', 'IR (mOhm)', 'SoC %', 'Voltage', 'MCA', 'Tested By', 'Notes'], TEST_FIELDS);
    expect(m).toMatchObject({ battery: 'Battery #', date: 'Date Tested', ir: 'IR (mOhm)', soc: 'SoC %', v0: 'Voltage', mca: 'MCA', by: 'Tested By', notes: 'Notes' });
  });
  it('normalizes battery labels', () => {
    expect(normalizeLabel('7')).toBe('B-07');
    expect(normalizeLabel('b7')).toBe('B-07');
    expect(normalizeLabel('Battery 12')).toBe('B-12');
    expect(normalizeLabel('2024-03')).toBe('2024-03');
  });
  it('reads US dates with times', () => {
    const d = parseDate('9/14/2026 4:05 PM')!;
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([8, 14, 16, 5]);
  });
  it('parses rows and reports bad ones', () => {
    const map = { battery: 'b', date: 'd', ir: 'ir', soc: null, v0: null, mca: null, by: null, notes: null };
    const r = parseTestRows([{ b: '3', d: '9/1/2026', ir: '9.4 mΩ' }, { b: '', d: '9/1/2026', ir: '9' }, { b: '4', d: 'soon', ir: '9' }], map);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ label: 'B-03', ir: 9.4 });
    expect(r.errors.map((e) => e.msg)).toEqual(['No battery', 'Unreadable date']);
  });
});

describe('schedule paste', () => {
  it('reads "Q12 10:34" style lines', () => {
    const today = new Date(2026, 2, 14);
    const m = parseScheduleLines('Q12 10:34\nq19, 1:22 PM\nnonsense', today);
    expect(m.map((x) => x.label)).toEqual(['Q12', 'Q19']);
    expect(new Date(m[1].time).getHours()).toBe(13);
  });
});
