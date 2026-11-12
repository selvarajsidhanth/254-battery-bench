import { describe, expect, it } from 'vitest';
import { liveStatus, nexusLabel, nexusPhase, type Nexus } from './nexus';

const M = 60000;
const t0 = Date.parse('2026-11-08T12:00:00Z');
const match = { key: 'qm63', label: 'Q63', time: new Date(t0 + 60 * M).toISOString() };

describe('nexus', () => {
  it('maps Nexus labels and statuses to ours', () => {
    expect(nexusLabel('Qualification 24')).toBe('Q24');
    expect(nexusLabel('Playoff 4')).toBe('SF4');
    expect(nexusLabel('Final 2')).toBe('F2');
    expect(nexusLabel('Practice 3')).toBeNull();
    expect(nexusPhase('Queuing soon')).toBe('soon');
    expect(nexusPhase('Now queuing')).toBe('queuing');
    expect(nexusPhase('On deck')).toBe('deck');
    expect(nexusPhase('On field')).toBe('field');
    expect(nexusPhase(null)).toBeNull();
  });

  it('falls back to the schedule: later, then 15 min out, then queue now', () => {
    const needBy = t0 + 40 * M;
    expect(liveStatus(match, needBy, null, t0)!.phase).toBe('later');
    const soon = liveStatus(match, needBy, null, t0 + 26 * M)!;
    expect(soon.phase).toBe('soon');
    expect(soon.label).toBe('14 min to queuing');
    expect(liveStatus(match, needBy, null, t0 + 41 * M)!.phase).toBe('queuing');
  });

  it('prefers Nexus status and times', () => {
    const nexus: Nexus = { source: 'live', at: t0, nowQueuing: 'Q63', matches: {
      Q63: { label: 'Q63', red: [], blue: [], phase: 'deck', queueAt: t0 + 30 * M, deckAt: t0 + 45 * M, fieldAt: t0 + 52 * M, startAt: t0 + 56 * M },
    } };
    const s = liveStatus(match, t0 + 40 * M, nexus, t0 + 47 * M)!;
    expect(s).toMatchObject({ phase: 'deck', label: 'On deck', countLabel: 'On field in', countTo: t0 + 52 * M, queueAt: t0 + 30 * M, source: 'nexus' });
  });
});

describe('estimated start', () => {
  it('uses Nexus, then TBA predicted time, then the printed schedule', async () => {
    const { estimatedStart } = await import('./nexus');
    const printed = Date.parse(match.time);
    expect(estimatedStart(match, null, null)).toBe(printed);
    const intel = { matches: { qm63: { estAt: printed + 12 * M } } } as never;
    expect(estimatedStart(match, intel, null)).toBe(printed + 12 * M);
    const nexus = { source: 'live', at: t0, nowQueuing: null, matches: { Q63: { label: 'Q63', red: [], blue: [], phase: null, queueAt: null, deckAt: null, fieldAt: null, startAt: printed + 20 * M } } } as Nexus;
    expect(estimatedStart(match, intel, nexus)).toBe(printed + 20 * M);
  });
});

describe('playoffs', () => {
  it('adds our playoff matches from Nexus and TBA to the saved quals', async () => {
    const { fullSchedule, withNexusAlliances, keyForLabel, nexusLabel: nl } = await import('./nexus');
    expect(nl('Playoff 7')).toBe('SF7');
    expect(nl('Finals 2')).toBe('F2');
    expect(keyForLabel('SF7')).toBe('sf7m1');
    expect(keyForLabel('F2')).toBe('f1m2');
    const quals = [{ key: 'qm9', label: 'Q9', time: new Date(t0).toISOString() }];
    const intel = { source: 'live', team: '9999', matches: {
      qm9: { red: ['9999'], blue: [], us: 'red', redWin: null, rp: [], pred: null, result: null, label: 'Q9', time: t0 },
      sf2m1: { red: ['9999', '1', '2'], blue: ['3', '4', '5'], us: 'red', redWin: null, rp: [], pred: null, result: null, label: 'SF2', time: t0 + 90 * M },
    } } as never;
    const nexus: Nexus = { source: 'live', at: t0, nowQueuing: null, matches: {
      SF2: { label: 'SF2', red: ['9999', '1', '2'], blue: ['3', '4', '5'], phase: null, queueAt: null, deckAt: null, fieldAt: null, startAt: t0 + 95 * M },
      SF7: { label: 'SF7', red: ['6', '7', '8'], blue: ['9999', '1', '2'], phase: 'soon', queueAt: t0 + 120 * M, deckAt: null, fieldAt: null, startAt: t0 + 140 * M },
      SF8: { label: 'SF8', red: ['9', '10', '11'], blue: ['12', '13', '14'], phase: null, queueAt: null, deckAt: null, fieldAt: null, startAt: t0 + 150 * M },
    } };
    const all = fullSchedule(quals, intel, nexus, '9999', t0);
    expect(all.map((m) => m.key)).toEqual(['qm9', 'sf2m1', 'sf7m1']);
    const merged = withNexusAlliances(intel, nexus, all, '9999')!;
    expect(merged.matches.sf7m1).toMatchObject({ us: 'blue', red: ['6', '7', '8'] });
  });

  it('drops matches that won’t be played once the event moves past them', async () => {
    const { fullSchedule, liveSchedule } = await import('./nexus');
    const res = (red: number, blue: number) => ({ red: ['9999'], blue: ['1'], us: 'red', redWin: null, rp: [], pred: null, result: { red, blue } });
    // finals won 2-0: F3 never happens, even though Nexus keeps estimating it
    const intel = { source: 'live', team: '9999', matches: {
      f1m1: { ...res(150, 120), label: 'F1', time: t0, estAt: t0 },
      f1m2: { ...res(140, 130), label: 'F2', time: t0 + 15 * M, estAt: t0 + 15 * M },
      f1m3: { red: ['9999'], blue: ['1'], us: 'red', redWin: null, rp: [], pred: null, result: null, label: 'F3', time: t0 + 30 * M, estAt: t0 + 60 * M },
    } } as never;
    const nexus: Nexus = { source: 'live', at: t0, nowQueuing: null, matches: {
      F2: { label: 'F2', red: ['9999'], blue: ['1'], phase: 'field', queueAt: null, deckAt: null, fieldAt: null, startAt: t0 + 50 * M },
      F3: { label: 'F3', red: ['9999'], blue: ['1'], phase: 'soon', queueAt: null, deckAt: null, fieldAt: null, startAt: t0 + 60 * M },
    } };
    const now = t0 + 40 * M;
    const all = fullSchedule([], intel, nexus, '9999', now);
    expect(all.map((m) => m.label)).toEqual(['F1', 'F2']);
    // a played match uses when it actually ran, not Nexus's stuck "on field" estimate
    expect(liveSchedule(all, intel, nexus).map((m) => Date.parse(m.time))).toEqual([t0, t0 + 15 * M]);
    // an unplayed qual long past its printed time is gone too
    const q = [{ key: 'qm70', label: 'Q70', time: new Date(t0).toISOString() }];
    expect(fullSchedule(q, null, null, '', t0 + 5 * 60 * M)).toEqual([]);
    expect(fullSchedule(q, null, null, '', t0 + 60 * M)).toHaveLength(1);
  });
});
