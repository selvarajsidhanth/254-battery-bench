import { describe, expect, it } from 'vitest';
import { groupRuns, inRobotAt, isField, localDay, matchOrder, nextRunNumber, sessionOf } from './sessions';
import type { MatchReport } from './matchReport';
import type { MatchRun, RotationEvent } from './types';

const at = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m).toISOString();
const rep = (type: MatchReport['match']['type'], fms: boolean, event = '') =>
  ({ version: 1, match: { label: '', type, number: 1, replay: null, event, station: '', fms } } as unknown as MatchReport);
let n = 0;
const run = (p: Partial<MatchRun>): MatchRun => ({ id: `r${n++}`, batteryId: '', at: at(14, 10), match: '', source: 'log', ...p });

describe('match log groups', () => {
  it('orders match labels: practice, quals, playoffs, finals', () => {
    const labels = ['F1', 'SF2', 'Q12', 'Q 3', 'P1', 'SF10', 'QM40'];
    expect([...labels].sort((a, b) => matchOrder(a)! - matchOrder(b)!)).toEqual(['P1', 'Q 3', 'Q12', 'QM40', 'SF2', 'SF10', 'F1']);
    expect(matchOrder('Run 2')).toBeNull();
  });

  it('puts field logs under their event and merges spellings with the TBA key', () => {
    const opts = { eventName: 'Silicon Valley Regional', tbaEvent: '2026casj' };
    const a = run({ match: 'Q12', event: 'CASJ', report: rep('qual', true, 'CASJ') });
    const b = run({ match: 'Q3', event: 'Silicon Valley Regional', report: rep('qual', true) });
    const c = run({ match: 'SF1', event: 'casj', report: rep('elim', true) });
    const g = groupRuns([a, b, c], opts);
    expect(g).toHaveLength(1);
    expect(g[0].name).toBe('Silicon Valley Regional');
    expect(g[0].kind).toBe('event');
    expect(g[0].runs.map((r) => r.match)).toEqual(['Q3', 'Q12', 'SF1']);
  });

  it('groups practice logs by local day, whatever the event field says', () => {
    const a = run({ at: at(14, 9), match: 'Practice run', event: 'Demo', report: rep('none', false) });
    const b = run({ at: at(14, 23, 30), match: 'Practice run', report: rep('none', false) });
    const c = run({ at: at(15, 8), match: 'Practice run', report: rep('none', false) });
    const g = groupRuns([a, b, c]);
    expect(g.map((s) => s.key)).toEqual([`d:${localDay(at(15, 8))}`, `d:${localDay(at(14, 9))}`]);
    expect(g[1].runs).toHaveLength(2);
    expect(g[1].kind).toBe('practice');
    expect(g[1].auto).toBe(true);
    expect(g[1].name).toMatch(/^Practice · /);
  });

  it('a hand-picked group wins, and a named practice session stays a practice kind', () => {
    const a = run({ group: 'Auto tuning', report: rep('none', false) });
    const b = run({ group: 'auto  tuning', at: at(15, 9), report: rep('none', false) });
    const g = groupRuns([a, b]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ name: 'Auto tuning', kind: 'practice', auto: false });
  });

  it('old summary imports go under their event or "Older imports" (always last)', () => {
    const a = run({ source: 'csv', event: 'Offseason', match: 'Q 6', at: at(1, 10) });
    const b = run({ source: 'csv', match: 'Run', at: at(20, 10) });
    const c = run({ at: at(10, 10), report: rep('none', false) });
    const g = groupRuns([a, b, c]);
    expect(g.map((s) => s.name)).toEqual([expect.stringMatching(/^Practice/), 'Offseason', 'Older imports']);
    expect(g[1].kind).toBe('event');
    expect(isField(a)).toBe(true);
    expect(sessionOf(b).key).toBe('imports');
  });

  it('numbers practice runs after the highest one', () => {
    expect(nextRunNumber([run({ match: 'Run 1' }), run({ match: 'Run 4' })])).toBe(5);
    expect(nextRunNumber([run({ match: 'Practice run' }), run({ match: 'Practice run' })])).toBe(3);
    expect(nextRunNumber()).toBe(1);
  });

  it('finds the battery that was in the robot when a log was recorded', () => {
    const ev = (batteryId: string, t: string, to: RotationEvent['to']): RotationEvent => ({ id: `${batteryId}${t}`, batteryId, at: t, from: null, to });
    const events = [ev('A', at(14, 9), 'robot'), ev('A', at(14, 10), 'charging'), ev('B', at(14, 10), 'robot'), ev('B', at(14, 12), 'charging')];
    expect(inRobotAt(events, at(14, 9, 30))).toBe('A');
    expect(inRobotAt(events, at(14, 11))).toBe('B');
    expect(inRobotAt(events, at(14, 13))).toBeNull();
  });
});
