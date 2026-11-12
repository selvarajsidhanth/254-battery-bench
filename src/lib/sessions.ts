/* Groups saved match logs into events and practice days.

   - A run with `group` set was filed by hand (or picked at save time): that name wins.
   - A log from the field (FMS attached, or a qual/playoff match) goes under its event.
   - Any other robot log is a practice day, by the local calendar date.
   - Old summary imports with an event go under that event; without one, "Older imports".

   Event names are merged loosely ("CASJ", "casj", "2026casj" and the Settings event
   name all land together when the TBA key matches). No stored data is rewritten. */
import type { MatchRun, RotationEvent } from './types';

export type SessionKind = 'event' | 'practice' | 'imports';

export interface Session {
  key: string;
  name: string;
  kind: SessionKind;
  /** in reading order: match order at events, time order on practice days */
  runs: MatchRun[];
  first: string;
  last: string;
  /** an auto practice day (no name stored yet) */
  auto: boolean;
}

export interface SessionOpts { eventName?: string; tbaEvent?: string }

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** YYYY-MM-DD in the device's time zone, so an evening session doesn't split at midnight UTC. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `Practice · ${dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

const FIELD_LABEL = /^(q|qm|sf|f|e)\s*\d/i;

/** Was this run on the field at an event (not a practice-field run)? */
export function isField(r: MatchRun): boolean {
  if (r.report) return r.report.match.fms || r.report.match.type === 'qual' || r.report.match.type === 'elim';
  return FIELD_LABEL.test(r.match.trim());
}

/** Sort key for match labels: practice, quals, playoffs, finals. null if it isn't a match label. */
export function matchOrder(label: string): number | null {
  const m = /^(p|q|qm|sf|e|f)\s*(\d+)(?:\s*(?:m|-|\.)\s*(\d+))?/i.exec(label.trim());
  if (!m) return null;
  const lvl = { p: 0, q: 1, qm: 1, sf: 2, e: 2, f: 3 }[m[1].toLowerCase() as 'p'] ?? 1;
  return lvl * 1e6 + Number(m[2]) * 100 + Number(m[3] ?? 0);
}

function aliasFor(opts: SessionOpts) {
  const name = opts.eventName?.trim();
  const key = norm(opts.tbaEvent ?? '');
  const code = key.replace(/^\d{4}/, '');
  return (s: string) => {
    const n = norm(s);
    if (name && (n === norm(name) || (key && (n === key || n === code)))) return name;
    return s.trim();
  };
}

/** Which group a run belongs in (key and the name it would show). */
export function sessionOf(r: MatchRun, opts: SessionOpts = {}): { key: string; name: string; auto: boolean } {
  const alias = aliasFor(opts);
  const named = (s: string) => { const n = alias(s); return { key: `n:${norm(n)}`, name: n, auto: false }; };
  if (r.group?.trim()) return named(r.group);
  if (r.report) {
    if (isField(r)) return named(r.event || r.report.match.event || opts.eventName || 'Event');
    const day = localDay(r.at);
    return { key: `d:${day}`, name: dayName(day), auto: true };
  }
  if (r.event?.trim()) return named(r.event);
  return { key: 'imports', name: 'Older imports', auto: false };
}

export function groupRuns(runs: MatchRun[], opts: SessionOpts = {}): Session[] {
  const m = new Map<string, { runs: MatchRun[]; names: Map<string, number>; auto: boolean }>();
  for (const r of runs) {
    const s = sessionOf(r, opts);
    const g = m.get(s.key) ?? m.set(s.key, { runs: [], names: new Map(), auto: s.auto }).get(s.key)!;
    g.runs.push(r);
    g.names.set(s.name, (g.names.get(s.name) ?? 0) + 1);
  }
  const out: Session[] = [];
  for (const [key, g] of m) {
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const kind: SessionKind = key === 'imports' ? 'imports' : g.runs.some(isField) ? 'event' : 'practice';
    const byTime = (a: MatchRun, b: MatchRun) => a.at.localeCompare(b.at);
    const sorted = [...g.runs].sort(kind === 'event' ? (a, b) => {
      const x = matchOrder(a.match), y = matchOrder(b.match);
      if (x != null && y != null && x !== y) return x - y;
      if (x != null && y == null) return -1;
      if (x == null && y != null) return 1;
      return byTime(a, b);
    } : byTime);
    const times = g.runs.map((r) => r.at).sort();
    out.push({ key, name, kind, runs: sorted, first: times[0], last: times[times.length - 1], auto: g.auto });
  }
  return out.sort((a, b) => (a.kind === 'imports' ? 1 : 0) - (b.kind === 'imports' ? 1 : 0) || b.last.localeCompare(a.last));
}

/** The next free "Run N" among a day's practice runs. */
export function nextRunNumber(runs: MatchRun[] = []): number {
  const nums = runs.map((r) => /^run\s*(\d+)$/i.exec(r.match.trim())?.[1]).filter(Boolean).map(Number);
  return Math.max(runs.length, ...nums, 0) + 1;
}

/** Battery that was in the robot at a moment, from the rotation history. The most recent install wins if two were in. */
export function inRobotAt(events: RotationEvent[], at: string): string | null {
  const t = new Date(at).getTime();
  const last = new Map<string, RotationEvent>();
  for (const e of events) {
    if (new Date(e.at).getTime() > t) continue;
    const p = last.get(e.batteryId);
    if (!p || p.at <= e.at) last.set(e.batteryId, e);
  }
  const inRobot = [...last.values()].filter((e) => e.to === 'robot').sort((a, b) => b.at.localeCompare(a.at));
  return inRobot[0]?.batteryId ?? null;
}

export interface SessionStats { n: number; avgMin: number | null; worstMin: number | null; browns: number; lowest: string | null }
export function sessionStats(runs: MatchRun[]): SessionStats {
  const mins = runs.filter((r) => r.minV != null);
  const worst = mins.reduce<MatchRun | null>((w, r) => (!w || r.minV! < w.minV! ? r : w), null);
  return {
    n: runs.length,
    avgMin: mins.length ? mins.reduce((n, r) => n + r.minV!, 0) / mins.length : null,
    worstMin: worst?.minV ?? null,
    browns: runs.reduce((n, r) => n + (r.brownouts ?? 0), 0),
    lowest: worst?.batteryId || null,
  };
}
