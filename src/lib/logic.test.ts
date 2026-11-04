import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, assessFleet, chargeStatus, checkReading, fitTrend, kindOf, restRemainingMin, toMilliohms } from './domain';
import { planMatches } from './plan';
import { guessMapping, normalizeLabel, parseDate, parseTestRows, TEST_FIELDS } from './csv';
import { parseScheduleLines } from './schedule';
import { detectSheet, parseConfig, parseTeamSheet } from './teamSheets';
import type { Battery, EventConfig, TestRecord } from './types';

const NOW = Date.UTC(2026, 10, 3, 18, 0);
const DAY = 86_400_000, MIN = 60_000;
const S = DEFAULT_SETTINGS;
const iso = (t: number) => new Date(t).toISOString();

function bat(id: string, over: Partial<Battery> = {}): Battery {
  return { id, label: id.toUpperCase(), retired: false, state: 'ready', stateSince: iso(NOW - 10 * MIN), cycles: 0, createdAt: iso(NOW - 100 * DAY), ...over };
}
const cba = (id: string, daysAgo: number, ah: number, rintPre = 18): TestRecord => ({ id: `${id}-c${daysAgo}`, batteryId: id, kind: 'cba', at: iso(NOW - daysAgo * DAY), ah, rintPre, rintPost: rintPre + 10 });
const mca = (id: string, daysAgo: number, v: number): TestRecord => ({ id: `${id}-m${daysAgo}`, batteryId: id, kind: 'mca', at: iso(NOW - daysAgo * DAY), mca: v });
const beak = (id: string, daysAgo: number, ir: number): TestRecord => ({ id: `${id}-b${daysAgo}`, batteryId: id, kind: 'beak', at: iso(NOW - daysAgo * DAY), ir, soc: 130, v0: 13.2 });

function fleet(spec: Record<string, TestRecord[]>, settings = S, over: Record<string, Partial<Battery>> = {}) {
  const bs = Object.keys(spec).map((id) => bat(id, over[id]));
  return assessFleet(bs, spec, settings, NOW);
}

describe('competition / practice tiers', () => {
  it('ranks batteries that pass competition thresholds by capacity', () => {
    const h = fleet({ a: [cba('a', 5, 16.2), mca('a', 5, 270)], b: [cba('b', 5, 19.6), mca('b', 5, 287)], c: [cba('c', 5, 15.5), mca('c', 5, 262)] });
    expect([h.b.rank, h.a.rank, h.c.rank]).toEqual([1, 2, 3]);
    expect(h.c.tier).toBe('competition'); // 15.5 Ah is exactly the minimum
  });
  it('only the top N by capacity are competition; the rest fall back to practice', () => {
    const h = fleet({ a: [cba('a', 5, 18), mca('a', 5, 270)], b: [cba('b', 5, 17), mca('b', 5, 270)], c: [cba('c', 5, 16), mca('c', 5, 270)] }, { ...S, compCount: 2 });
    expect(h.c.tier).toBe('practice');
    expect(h.c.reasons[0].text).toMatch(/Ranked #3/);
  });
  it('puts a 15.46 Ah battery in practice, not competition', () => {
    const h = fleet({ a: [cba('a', 5, 15.457, 22), mca('a', 5, 262)] });
    expect(h.a.tier).toBe('practice');
    expect(h.a.health).toBe('watch');
  });
  it('fails a battery whose R_int is over the practice maximum, whatever its capacity', () => {
    const h = fleet({ a: [cba('a', 5, 16.0, 78), mca('a', 5, 242)] });
    expect(h.a.tier).toBe('none');
    expect(h.a.health).toBe('pull');
  });
  it('needs both a CBA and an MCA before it can be rated', () => {
    const h = fleet({ a: [cba('a', 5, 16.4)] });
    expect(h.a.tier).toBe('incomplete');
    expect(h.a.mcaDue).toBe(true);
    expect(h.a.cbaDue).toBe(false);
  });
  it('fails on capacity below the practice minimum', () => {
    expect(fleet({ a: [cba('a', 5, 8.36), mca('a', 5, 270)] }).a.tier).toBe('none');
  });
  it('retired batteries are never rated or scheduled', () => {
    const h = fleet({ a: [cba('a', 400, 18), mca('a', 400, 280)] }, S, { a: { retired: true } });
    expect(h.a.health).toBe('retired');
    expect(h.a.stale).toBe(false);
  });
});

describe('test schedule', () => {
  it('competition batteries need a CBA every month', () => {
    const h = fleet({ a: [cba('a', 34, 17), mca('a', 10, 280)], b: [cba('b', 20, 17), mca('b', 10, 280)] });
    expect(h.a.cbaDue).toBe(true);
    expect(h.b.cbaDue).toBe(false);
  });
  it('practice batteries only every six months', () => {
    const h = fleet({ a: [cba('a', 40, 15), mca('a', 40, 280)] });
    expect(h.a.tier).toBe('practice');
    expect(h.a.cbaDue).toBe(false);
  });
  it('failed batteries are not scheduled', () => {
    const h = fleet({ a: [cba('a', 300, 9), mca('a', 300, 280)] });
    expect(h.a.stale).toBe(false);
  });
  it('never-tested batteries are due for both', () => {
    const h = fleet({ a: [] });
    expect([h.a.cbaDue, h.a.mcaDue, h.a.health]).toEqual([true, true, 'untested']);
  });
});

describe('Beak pit check', () => {
  it('a high Beak reading pulls a competition battery for the day', () => {
    const h = fleet({ a: [cba('a', 5, 18), mca('a', 5, 280), beak('a', 0.1, 15.8)] });
    expect(h.a.tier).toBe('competition');
    expect(h.a.health).toBe('pull');
  });
  it('old Beak readings do not count', () => {
    expect(fleet({ a: [cba('a', 5, 18), mca('a', 5, 280), beak('a', 30, 15.8)] }).a.health).toBe('ok');
  });
});

describe('trends', () => {
  it('measures capacity loss per week over real time', () => {
    const pts = [0, 1, 2, 3].map((i) => ({ at: iso(NOW - (90 - i * 30) * DAY), v: 17 - i * 0.3 }));
    const t = fitTrend(pts, 15.5, 'down', NOW)!;
    expect(t.perWeek).toBeCloseTo((-0.3 / 30) * 7, 3);
    expect(t.daysToLimit).toBeGreaterThan(0);
  });
  it('ignores a burst of same-day tests', () => {
    expect(fitTrend([1, 2, 3].map((i) => ({ at: iso(NOW - i * MIN), v: i })), 5, 'up', NOW)).toBeNull();
  });
});

describe('log-test verdicts', () => {
  it('CBA: competition, practice or not suitable', () => {
    expect(checkReading('cba', { ah: 16.2, rintPre: 18 }, S).level).toBe('ok');
    expect(checkReading('cba', { ah: 14.8, rintPre: 21 }, S).level).toBe('watch');
    expect(checkReading('cba', { ah: 16, rintPre: 78 }, S).level).toBe('pull');
  });
  it('MCA thresholds', () => {
    expect(checkReading('mca', { mca: 230 }, S).level).toBe('ok');
    expect(checkReading('mca', { mca: 212 }, S).level).toBe('watch');
    expect(checkReading('mca', { mca: 200 }, S).level).toBe('pull');
  });
  it('Beak: low charge means retest, not fail', () => {
    const v = checkReading('beak', { soc: 118, ir: 9, v0: 13.1 }, S);
    expect(v.level).toBe('watch');
  });
  it('accepts R_int in ohms or milliohms', () => {
    expect(toMilliohms(0.019)).toBe(19);
    expect(toMilliohms(19)).toBe(19);
  });
  it('works out the kind of old records', () => {
    expect(kindOf({ id: '1', batteryId: 'a', at: iso(NOW), ah: 16 })).toBe('cba');
    expect(kindOf({ id: '1', batteryId: 'a', at: iso(NOW), mca: 270 })).toBe('mca');
    expect(kindOf({ id: '1', batteryId: 'a', at: iso(NOW), ir: 9, mca: 900 })).toBe('beak');
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
  const health = (ids: string[], ranks: number[], h: 'ok' | 'watch' = 'ok') =>
    Object.fromEntries(ids.map((id, i) => [id, { health: h, rank: ranks[i] } as never]));

  it('gives the next match the best-ranked ready battery and never reuses one too soon', () => {
    const rows = planMatches([bat('a'), bat('b'), bat('c')], health(['a', 'b', 'c'], [3, 1, 2]), S, ev([30, 40, 50]), NOW);
    expect(rows.map((r) => r.batteryId)).toEqual(['b', 'c', 'a']);
    expect(rows.every((r) => r.status === 'ready')).toBe(true);
  });
  it('marks a match tight when nothing can be charged in time', () => {
    const rows = planMatches([bat('a')], health(['a'], [1]), S, ev([30, 45]), NOW);
    expect(rows[1].status).toBe('tight');
    expect(rows[1].lateMin).toBeGreaterThan(60);
  });
  it('holds back practice-tier batteries', () => {
    expect(planMatches([bat('a')], health(['a'], [20], 'watch'), S, ev([30]), NOW)[0].status).toBe('none');
  });
  it('respects a manual assignment', () => {
    const e = ev([30]);
    e.assignments.qm0 = 'a';
    const rows = planMatches([bat('a'), bat('b')], health(['a', 'b'], [2, 1]), S, e, NOW);
    expect(rows[0].batteryId).toBe('a');
    expect(rows[0].manual).toBe(true);
  });
});

describe('team sheet import', () => {
  const inv = 'Name,Status,Location,Manufacturer,Lot Code,Rank\n2026-01M,Active - Quarantined for Competition,Pit,MK,BD,1\n2026-02e,Active - Practice and Prototype,AR Charger,Energizer,,\n2026-03M,Decomissioned,,MK,BD,';
  const cbaCsv = 'Timestamp,Battery Name (example: 2026-01),Pre-test R_int (example: 0.016),Amp-Hours (example: 14.9),Post-test R_int (example: 0.016),Your Name (first and last),Watt-Hours (example: 197.4)\n9/26/2026 15:47:17,2026-01M,0.019,15.562,0.032,Test Person,194.272';
  const mcaCsv = 'Timestamp,Battery Name (Example: 2026-01),Your Name (first and last),MCA Test Result (example: 237)\n9/28/2026 18:35:36,2026-02e,Test Person,212';
  const config = 'Suitable for Competition,\n15.5,Minimum Amp-Hours (reported by CBA)\n0.025,Maximum pre-test R_int (recorded before and after CBA test)\n,\n225,Minimum CCA (reported by MCA tester)\n1,CBA Test Recency (months)\n2,MCA Test Recency (months)\n,\nSuitable for Testing,\n11.0,Minimum Amp-Hours (reported by CBA)\n0.035,Maximum pre-test R_int (recorded before and after CBA test)\n,\n210,Minimum CCA (reported by MCA tester)\n6,CBA Test Recency (months)\n6,MCA Test Recency (months)\n,\n14,Number of batteries suitable for competition';

  it('recognises each tab', () => {
    expect(parseTeamSheet(inv, 'a').kind).toBe('inventory');
    expect(parseTeamSheet(cbaCsv, 'b').kind).toBe('cba');
    expect(parseTeamSheet(mcaCsv, 'c').kind).toBe('mca');
    expect(parseTeamSheet(config, 'd').kind).toBe('config');
    expect(detectSheet('"If there is a battery name in dark text"\nDue for CBA Testing:,Last CBA Test:', [])).toBe('schedule');
  });
  it('does not mistake the inventory (which has R_int and Ah columns) for CBA results', () => {
    const header = 'Name,Status,Location,Manufacturer,Lot Code,Rank,Suitable for Competition?,Suitable for Practice/Prototype?,Due for MCA Test?,Due for CBA Test?,Last MCA Test Date,MCA Tested By,MCA Result,Last CBA Test Date,CBA Tested By,Pre-test R_int,Amp-Hours (Ah)';
    expect(parseTeamSheet(`${header}\n2026-01M,Active - Practice and Prototype,Pit,MK,,,,,,,,,,,,0.016,17.9`, 'x').kind).toBe('inventory');
  });
  it('reads the inventory', () => {
    const rows = parseTeamSheet(inv, 'a').inventory!;
    expect(rows.map((r) => r.label)).toEqual(['2026-01M', '2026-02E', '2026-03M']);
    expect(rows[0]).toMatchObject({ quarantined: true, location: 'Pit', lotCode: 'BD', retired: false });
    expect(rows[2].retired).toBe(true);
  });
  it('reads CBA results and converts R_int from ohms', () => {
    expect(parseTeamSheet(cbaCsv, 'b').cba![0]).toMatchObject({ label: '2026-01M', ah: 15.562, rintPre: 19, rintPost: 32, wh: 194.272, by: 'Test Person' });
  });
  it('reads MCA results', () => {
    expect(parseTeamSheet(mcaCsv, 'c').mca![0]).toMatchObject({ label: '2026-02E', mca: 212 });
  });
  it('reads the thresholds tab into settings', () => {
    expect(parseConfig(config)).toEqual({
      compMinAh: 15.5, compMaxRint: 25, compMinMca: 225, compCbaMonths: 1, compMcaMonths: 2,
      pracMinAh: 11, pracMaxRint: 35, pracMinMca: 210, pracCbaMonths: 6, pracMcaMonths: 6, compCount: 14,
    });
  });
});

describe('generic CSV import', () => {
  it('guesses columns from typical sheet headers', () => {
    const m = guessMapping(['Battery #', 'Date Tested', 'IR (mOhm)', 'SoC %', 'Voltage', 'MCA', 'Tested By', 'Notes'], TEST_FIELDS);
    expect(m).toMatchObject({ battery: 'Battery #', date: 'Date Tested', ir: 'IR (mOhm)', soc: 'SoC %', v0: 'Voltage', mca: 'MCA', by: 'Tested By', notes: 'Notes' });
  });
  it('normalizes battery labels', () => {
    expect(normalizeLabel('7')).toBe('B-07');
    expect(normalizeLabel('2026-17e')).toBe('2026-17E');
  });
  it('reads US dates with times', () => {
    const d = parseDate('9/14/2026 4:05 PM')!;
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([8, 14, 16, 5]);
  });
  it('parses rows and reports bad ones', () => {
    const map = { battery: 'b', date: 'd', ir: 'ir', soc: null, v0: null, mca: null, by: null, notes: null };
    const r = parseTestRows([{ b: '3', d: '9/1/2026', ir: '9.4 mΩ' }, { b: '', d: '9/1/2026', ir: '9' }, { b: '4', d: 'soon', ir: '9' }], map);
    expect(r.ok).toHaveLength(1);
    expect(r.errors.map((e) => e.msg)).toEqual(['No battery', 'Unreadable date']);
  });
});

describe('schedule paste', () => {
  it('reads "Q12 10:34" style lines', () => {
    const m = parseScheduleLines('Q12 10:34\nq19, 1:22 PM\nnonsense', new Date(2026, 2, 14));
    expect(m.map((x) => x.label)).toEqual(['Q12', 'Q19']);
    expect(new Date(m[1].time).getHours()).toBe(13);
  });
});
