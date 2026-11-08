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
      Q63: { label: 'Q63', phase: 'deck', queueAt: t0 + 30 * M, deckAt: t0 + 45 * M, fieldAt: t0 + 52 * M, startAt: t0 + 56 * M },
    } };
    const s = liveStatus(match, t0 + 40 * M, nexus, t0 + 47 * M)!;
    expect(s).toMatchObject({ phase: 'deck', label: 'On deck', countLabel: 'On field in', countTo: t0 + 52 * M, queueAt: t0 + 30 * M, source: 'nexus' });
  });
});
