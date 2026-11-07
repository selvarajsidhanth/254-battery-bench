import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, assessFleet, chargeStatus, checkReading, fitTrend, kindOf, toMilliohms } from './domain';
import { pickSystemsCheck, planMatches } from './plan';
import { guessMapping, normalizeLabel, parseDate, parseTestRows, TEST_FIELDS } from './csv';
import { parseScheduleLines } from './schedule';
import { detectSheet, parseConfig, parseTeamSheet } from './teamSheets';
import type { Battery, EventConfig, TestRecord } from './types';
import { buildWpilog, readWpilog } from './wpilog';
import { analyzeLog, motorName, pairs } from './matchReport';

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
  it('keeps a battery installed after the last match for the next one', () => {
    const e = ev([-20, 30, 80]);
    const inRobot = bat('b', { state: 'robot', stateSince: iso(NOW - 5 * MIN) });
    const rows = planMatches([bat('a'), inRobot], health(['a', 'b'], [2, 1]), S, e, NOW);
    expect(rows[0]).toMatchObject({ batteryId: 'b', status: 'installed' });
    expect(rows[1].batteryId).toBe('a');
    // still in from the last match: that one isn't counted as installed
    const stale = planMatches([bat('a'), bat('b', { state: 'robot', stateSince: iso(NOW - 40 * MIN) })], health(['a', 'b'], [2, 1]), S, e, NOW);
    expect(stale[0]).toMatchObject({ batteryId: 'a', status: 'ready' });
  });
  it('does not count a systems-check battery as installed for a match', () => {
    const rows = planMatches([bat('a'), bat('b', { state: 'robot', stateSince: iso(NOW - 2 * MIN), robotFor: 'Systems check' })], health(['a', 'b'], [2, 1]), S, ev([30]), NOW);
    expect(rows[0]).toMatchObject({ batteryId: 'a', status: 'ready' });
  });
  it('picks the worse batteries for systems checks and leaves saved ones alone', () => {
    const bats = [bat('good'), bat('prac'), bat('saved', { quarantined: true, quarantineFor: 'comp' }), bat('held', { quarantined: true, quarantineFor: 'hold' })];
    const h = { good: { health: 'ok', rank: 1, ah: 18 }, prac: { health: 'watch', rank: null, ah: 14 }, saved: { health: 'watch', ah: 13 }, held: { health: 'pull', ah: 12 } } as never;
    expect(pickSystemsCheck(bats, h, [])?.id).toBe('prac');
    expect(pickSystemsCheck([bats[0], bats[2], bats[3]], h, [])?.id).toBe('good');
    expect(pickSystemsCheck([bats[0]], h, [{ batteryId: 'good' } as never])).toBeNull();
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

describe('robot log analysis', () => {
  const src = (u8: Uint8Array, name = 'akit_26-03-14_10-00-00.wpilog') => ({
    size: u8.length, name,
    slice: (a: number, b: number) => ({ arrayBuffer: async () => u8.slice(a, Math.min(b, u8.length)).buffer }),
  });
  // 5 s disabled at 12.9 V, 15 s auto, 2 s gap, 30 s teleop with a load step and a brownout
  const defs = [
    { name: '/DriverStation/Enabled', type: 'boolean' },
    { name: '/DriverStation/RobotMode', type: 'string' },
    { name: '/SystemStats/BatteryVoltage', type: 'double' },
    { name: '/Shooter/CurrentSupplyAmps', type: 'double' },
    { name: '/DriveInputs/DriveSupplyCurrentAmps', type: 'double[]' },
    { name: '/SystemStats/Faults/Brownout', type: 'boolean' },
    { name: '/Shooter/MotorTempCelsius', type: 'double' },
  ];
  const recs: { entry: number; t: number; v: number | boolean | string | number[] }[] = [
    { entry: 1, t: 0, v: false }, { entry: 2, t: 0, v: 'AUTONOMOUS' }, { entry: 3, t: 0, v: 12.9 },
    { entry: 4, t: 0, v: 0 }, { entry: 5, t: 0, v: [0, 0] }, { entry: 6, t: 0, v: false }, { entry: 7, t: 0, v: 25 },
    { entry: 1, t: 5, v: true },
    { entry: 4, t: 5, v: 40 }, { entry: 5, t: 5, v: [30, 30] }, { entry: 3, t: 5, v: 11.5 }, // 100 A → 1.4 V sag
    { entry: 1, t: 20, v: false }, { entry: 4, t: 20, v: 0 }, { entry: 5, t: 20, v: [0, 0] }, { entry: 3, t: 20, v: 12.7 },
    { entry: 2, t: 21, v: 'TELEOPERATED' },
    { entry: 1, t: 22, v: true },
    { entry: 4, t: 22, v: 100 }, { entry: 5, t: 22, v: [50, 50] }, { entry: 3, t: 22, v: 9.7 }, // 200 A → 3 V sag
    { entry: 6, t: 30, v: true }, { entry: 3, t: 30, v: 6.4 }, { entry: 6, t: 30.05, v: false }, { entry: 3, t: 30.05, v: 9.7 },
    { entry: 7, t: 40, v: 71 },
    { entry: 1, t: 52, v: false }, { entry: 4, t: 52, v: 0 }, { entry: 5, t: 52, v: [0, 0] }, { entry: 3, t: 52, v: 12.4 },
    { entry: 3, t: 70, v: 12.45 },
  ];
  const log = buildWpilog(defs, recs);

  it('ignores an empty PDH that only logged zeros', async () => {
    // robots without a PDH still log /PowerDistribution/* once, as 0; they come first in the log
    const pdhDefs = [{ name: '/PowerDistribution/Voltage', type: 'double' }, { name: '/PowerDistribution/TotalCurrent', type: 'double' }, { name: '/PowerDistribution/Temperature', type: 'double' }];
    const r = await analyzeLog(src(buildWpilog([...pdhDefs, ...defs], [
      { entry: 1, t: 0, v: 0 }, { entry: 2, t: 0, v: 0 }, { entry: 3, t: 0, v: 0 },
      ...recs.map((x) => ({ ...x, entry: x.entry + 3 })),
    ])));
    expect(r.battery.restV).toBeCloseTo(12.9, 1);
    expect(r.battery.minV).toBeLessThan(10);
    expect(r.battery.currentSource).toBe('motor-supply');
    expect(r.battery.peakA).toBeGreaterThan(150);
    expect(r.temps.some((t) => /power/i.test(t.name))).toBe(false);
  });

  it('reads entries and values across chunk boundaries', async () => {
    const seen: number[] = [];
    const r = await readWpilog(src(log), { want: (e) => e.name.endsWith('BatteryVoltage'), onValue: (_e, _t, v) => seen.push(v as number), chunkBytes: 64 });
    expect(r.entries.length).toBe(defs.length);
    expect(seen[0]).toBeCloseTo(12.9);
    expect(seen.length).toBe(recs.filter((x) => x.entry === 3).length);
  });

  it('builds a report: phases, sag, amp-hours, brownouts, temps', async () => {
    const r = await analyzeLog(src(log));
    expect(r.phases.map((p) => p.mode)).toEqual(['auto', 'teleop']);
    expect(r.enabledSec).toBeCloseTo(45, 0);
    expect(r.battery.restV).toBeCloseTo(12.9);
    expect(r.battery.minV).toBeCloseTo(6.4);
    expect(r.battery.brownouts).toBe(1);
    // 100 A × 15 s + 200 A × 30 s = 7500 A·s ≈ 2.08 Ah
    expect(r.battery.ah!).toBeCloseTo(2.08, 1);
    expect(r.battery.peakA).toBe(200);
    expect(r.battery.systemRmOhm!).toBeGreaterThan(10);
    expect(r.subsystems[0].name).toBe('Drive');
    expect(r.subsystems.find((s) => s.name === 'Shooter')!.motors).toBe(1);
    expect(r.temps[0]).toMatchObject({ name: 'Shooter', maxC: 71 });
    expect(r.match.label).toBe('Practice run');
    expect(new Date(r.logStart!).getMonth()).toBe(2); // from the AdvantageKit file name
    expect(r.events.some((e) => e.kind === 'brownout' && e.t > 24 && e.t < 26)).toBe(true);
  });

  it('records when things happened so the chart can point at them', async () => {
    const r = await analyzeLog(src(log));
    const m = r.battery.marks!;
    expect(m.minT).toBeCloseTo(25, 1); // the 6.4 V dip, 25 s after the first enable
    expect(m.peakT).toBeCloseTo(17, 1); // teleop's 200 A starts at 22 s − 5 s
    expect(pairs(m.brownouts)).toHaveLength(1);
    expect(pairs(m.brownouts)[0][0]).toBeCloseTo(25, 1);
    // one stretch under 10 V covering all of teleop; spans are stored flat for Firestore
    expect(pairs(m.under10)).toHaveLength(1);
    expect(m.under10.every((x) => typeof x === 'number')).toBe(true);
    const [a, b] = pairs(m.under10)[0];
    expect(b - a).toBeCloseTo(r.battery.under10Sec, 0);
    // running amp-hours end at the total
    expect(r.trace.ah!.length).toBe(r.trace.t.length);
    expect(r.trace.ah![r.trace.ah!.length - 1]).toBeCloseTo(r.battery.ah!, 2);
  });

  it('names motors from their log keys', () => {
    const cur = /(supply)?[ _]?current[ _]?(supply)?[ _]?(amps)?$/i;
    expect(motorName('/Shooter/follower0/CurrentSupplyAmps', null, cur).motor).toBe('Shooter follower 0');
    expect(motorName('/DriveInputs/DriveSupplyCurrentAmps', 2, cur)).toEqual({ subsystem: 'Drive', motor: 'Drive 3' });
    expect(motorName('/DriveInputs/SteerSupplyCurrentAmps', 0, cur).motor).toBe('Drive Steer 1');
    expect(motorName('NT:/AdvantageKit/RealOutputs/Hopper_Floor_Left/CurrentSupplyAmps', null, cur).subsystem).toBe('Hopper Floor Left');
  });
});
