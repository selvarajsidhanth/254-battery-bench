/* Competition match planner.
   Walks the upcoming schedule in order and gives each match the best battery
   that will be charged and tested in time (competition-tier only,
   best capacity rank first). A battery comes back into
   the pool after its match + a full charge. */
import type { Battery, EventConfig, ScheduledMatch, Settings } from './types';
import { chargeStatus, type Assessment } from './domain';
import { MIN, ms } from './format';

export type PlanStatus = 'field' | 'ready' | 'charging' | 'tight' | 'none' | 'manual';

export interface PlanRow {
  match: ScheduledMatch;
  batteryId: string | null;
  needBy: number; // must be installed & in queue by this time
  readyAt: number | null;
  status: PlanStatus;
  lateMin: number;
  manual: boolean;
}

interface PoolItem { id: string; score: number; availableAt: number; state: Battery['state'] }

export function availableAt(b: Battery, s: Settings, now: number): number {
  switch (b.state) {
    case 'shelf': return now + s.chargeMin * MIN;
    case 'ready': return now;
    case 'charging': return now + chargeStatus(b, s, now).remainingMin * MIN;
    case 'robot': return now + (s.matchMin + s.chargeMin) * MIN;
  }
}

export function planMatches(
  batteries: Battery[],
  health: Record<string, Assessment>,
  s: Settings,
  ev: EventConfig,
  now: number,
): PlanRow[] {
  const usable = batteries.filter((b) => !b.retired && health[b.id]?.health === 'ok');
  const pool: PoolItem[] = usable.map((b) => ({
    id: b.id,
    score: health[b.id]?.rank ?? 99, // lower rank = more capacity = better
    availableAt: availableAt(b, s, now),
    state: b.state,
  }));
  const inRobot = batteries.find((b) => b.state === 'robot' && !b.retired);
  const matches = [...ev.matches].sort((a, b) => ms(a.time) - ms(b.time)).filter((m) => ms(m.time) + s.matchMin * MIN > now);
  const rows: PlanRow[] = [];

  for (const m of matches) {
    const start = ms(m.time);
    const needBy = start - s.queueLeadMin * MIN;
    const onField = start <= now && now < start + s.matchMin * MIN;
    if (onField) {
      rows.push({ match: m, batteryId: inRobot?.id ?? null, needBy, readyAt: null, status: 'field', lateMin: 0, manual: false });
      continue;
    }
    const manualId = ev.assignments[m.key];
    let pick: PoolItem | undefined;
    if (manualId) pick = pool.find((p) => p.id === manualId);
    if (!pick) {
      const inTime = pool.filter((p) => p.availableAt <= needBy).sort((a, b) => a.score - b.score);
      pick = inTime[0] ?? [...pool].sort((a, b) => a.availableAt - b.availableAt)[0];
    }
    if (!pick) {
      rows.push({ match: m, batteryId: manualId ?? null, needBy, readyAt: null, status: 'none', lateMin: 0, manual: !!manualId });
      continue;
    }
    const late = Math.max(0, (pick.availableAt - needBy) / MIN);
    const status: PlanStatus =
      late > 0 ? 'tight'
      : pick.availableAt <= now ? 'ready'
      : 'charging';
    rows.push({ match: m, batteryId: pick.id, needBy, readyAt: pick.availableAt, status, lateMin: late, manual: !!manualId && pick.id === manualId });
    pick.availableAt = Math.max(pick.availableAt, start) + (s.matchMin + s.chargeMin) * MIN;
    pick.state = 'charging';
  }
  return rows;
}
