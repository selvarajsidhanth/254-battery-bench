/* Competition match planner.
   Walks the upcoming schedule in order and gives each match the best battery
   that will be charged and tested in time (competition-tier only,
   best capacity rank first). A battery comes back into
   the pool after its match + a full charge. */
import type { Battery, EventConfig, ScheduledMatch, Settings } from './types';
import { SYSCHECK, chargeStatus, heldOut, type Assessment } from './domain';
import { MIN, ms } from './format';

export type PlanStatus = 'field' | 'installed' | 'ready' | 'charging' | 'tight' | 'none' | 'manual';

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
  const usable = batteries.filter((b) => !b.retired && !heldOut(b) && health[b.id]?.health === 'ok');
  const pool: PoolItem[] = usable.map((b) => ({
    id: b.id,
    score: health[b.id]?.rank ?? 99, // lower rank = more capacity = better
    availableAt: availableAt(b, s, now),
    state: b.state,
  }));
  const inRobot = batteries.find((b) => b.state === 'robot' && !b.retired);
  const all = [...ev.matches].sort((a, b) => ms(a.time) - ms(b.time));
  const matches = all.filter((m) => ms(m.time) + s.matchMin * MIN > now);
  const lastPlayed = all.filter((m) => ms(m.time) + s.matchMin * MIN <= now).pop();
  // a battery put in after the last match ended is already installed for the next one
  const installed = inRobot && inRobot.robotFor !== SYSCHECK && (!lastPlayed || ms(inRobot.stateSince) >= ms(lastPlayed.time) + s.matchMin * MIN)
    ? pool.find((p) => p.id === inRobot.id) : undefined;
  if (installed) installed.availableAt = now;
  let first = true;
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
    const isFirst = first;
    first = false;
    if (isFirst && installed && (!manualId || manualId === installed.id)) {
      rows.push({ match: m, batteryId: installed.id, needBy, readyAt: now, status: 'installed', lateMin: 0, manual: !!manualId });
      installed.availableAt = start + (s.matchMin + s.chargeMin) * MIN;
      installed.state = 'charging';
      continue;
    }
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

/** A battery for a quick systems check: worse batteries first (practice-tier, then ones that
    failed a check), never one saved or held out, never one the next few matches need. */
export function pickSystemsCheck(batteries: Battery[], health: Record<string, Assessment>, rows: PlanRow[]): Battery | null {
  const soon = new Set(rows.slice(0, 3).map((r) => r.batteryId));
  const group: Record<string, number> = { watch: 0, pull: 1, ok: 2 };
  const ok = batteries.filter((b) => !b.retired && !b.quarantined && b.state === 'ready' && !soon.has(b.id) && group[health[b.id]?.health] != null);
  const ah = (b: Battery) => health[b.id]?.ah ?? 0;
  return ok.sort((a, b) => group[health[a.id].health] - group[health[b.id].health] || ah(a) - ah(b))[0] ?? null;
}
