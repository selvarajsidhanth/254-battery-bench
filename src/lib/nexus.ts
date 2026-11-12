/* FRC Nexus (frc.nexus): live queuing status from the event's queuers, for events that queue with Nexus.
   The API key is per-device (localStorage), like the TBA key. Nexus allows browser calls (CORS).
   Without Nexus, the pit falls back to the schedule: queue time = match time minus the queue lead. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ms, MIN } from './format';
import type { ScheduledMatch } from './types';
import type { Intel } from './intel';

export const NEXUS_KEY = 'bb2:nexusKey';
const API = 'https://frc.nexus/api/v1';
const get = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
export const nexusKey = () => get(NEXUS_KEY);
export const saveNexusKey = (v: string) => { try { localStorage.setItem(NEXUS_KEY, v.trim()); } catch { /* private mode */ } };

export type Phase = 'later' | 'soon' | 'queuing' | 'deck' | 'field';

export interface NexusMatch {
  label: string;
  red: string[];
  blue: string[];
  phase: Phase | null;
  queueAt: number | null;
  deckAt: number | null;
  fieldAt: number | null;
  startAt: number | null;
}

export interface Nexus {
  source: 'live' | 'sample';
  at: number;
  /** label of the match the queuers are calling now, in our format ("Q58") */
  nowQueuing: string | null;
  /** by our match label ("Q63", "SF4", "F1") */
  matches: Record<string, NexusMatch>;
}

/** "Qualification 24" → "Q24", "Playoff 4" → "SF4", "Final 2" → "F2". Practice matches aren't on our schedule. */
export function nexusLabel(l: string | null | undefined): string | null {
  const m = /^(Qualification|Playoffs?|Finals?)\s+(\d+)/i.exec((l ?? '').trim());
  if (!m) return null;
  const k = m[1].toLowerCase();
  return (k.startsWith('q') ? 'Q' : k.startsWith('p') ? 'SF' : 'F') + m[2];
}

export function nexusPhase(status: string | null | undefined): Phase | null {
  const s = (status ?? '').toLowerCase();
  return s.includes('field') ? 'field' : s.includes('deck') ? 'deck' : s.includes('now queuing') ? 'queuing' : s.includes('soon') ? 'soon' : null;
}

interface NexusEvent {
  dataAsOfTime: number;
  nowQueuing: string | null;
  matches: { label: string; status: string | null; replayOf?: unknown; redTeams?: (string | null)[] | null; blueTeams?: (string | null)[] | null;
    times?: { estimatedQueueTime?: number | null; estimatedOnDeckTime?: number | null; estimatedOnFieldTime?: number | null; estimatedStartTime?: number | null; actualQueueTime?: number | null } }[];
}

export async function loadNexus(event: string, key: string): Promise<Nexus> {
  const r = await fetch(`${API}/event/${event.trim().toLowerCase()}`, { headers: { 'Nexus-Api-Key': key.trim() } });
  if (r.status === 401 || r.status === 403) throw new Error('Nexus rejected the API key');
  if (r.status === 404) throw new Error('Nexus doesn’t have this event');
  if (!r.ok) throw new Error(`Nexus returned ${r.status}`);
  const d = (await r.json()) as NexusEvent;
  const matches: Record<string, NexusMatch> = {};
  for (const m of d.matches ?? []) {
    const label = nexusLabel(m.label);
    if (!label) continue;
    const t = m.times ?? {};
    // a replay keeps the label; the later entry wins
    matches[label] = {
      label, phase: nexusPhase(m.status),
      red: (m.redTeams ?? []).filter((t): t is string => !!t).map(String), blue: (m.blueTeams ?? []).filter((t): t is string => !!t).map(String),
      queueAt: t.actualQueueTime ?? t.estimatedQueueTime ?? null,
      deckAt: t.estimatedOnDeckTime ?? null, fieldAt: t.estimatedOnFieldTime ?? null, startAt: t.estimatedStartTime ?? null,
    };
  }
  return { source: 'live', at: d.dataAsOfTime ?? Date.now(), nowQueuing: nexusLabel(d.nowQueuing), matches };
}

/** The demo event runs a few minutes behind, like a real one. */
export const DEMO_BEHIND = 6;

/** Demo: queuing timed off the schedule so every phase shows up. */
export function sampleNexus(schedule: ScheduledMatch[], lead: number, now: number): Nexus {
  const matches: Record<string, NexusMatch> = {};
  let nowQueuing: string | null = null;
  for (const m of [...schedule].sort((a, b) => ms(a.time) - ms(b.time))) {
    const startAt = ms(m.time) + DEMO_BEHIND * MIN;
    const queueAt = startAt - lead * MIN, deckAt = startAt - Math.min(8, lead / 2) * MIN, fieldAt = startAt - 3 * MIN;
    const phase: Phase | null = now >= startAt + 3 * MIN ? null : now >= fieldAt ? 'field' : now >= deckAt ? 'deck' : now >= queueAt ? 'queuing' : now >= queueAt - 15 * MIN ? 'soon' : null;
    if (now >= queueAt && now < startAt) nowQueuing = m.label;
    matches[m.label] = { label: m.label, red: [], blue: [], phase, queueAt, deckAt, fieldAt, startAt };
  }
  return { source: 'sample', at: now, nowQueuing, matches };
}

/** Polls Nexus every 15 s while the pit is open. Sample data in the demo. */
export function useNexus(event: string, schedule: ScheduledMatch[], lead: number, demo: boolean, now: number) {
  const [live, setLive] = useState<Nexus | null>(null);
  const [key, setKey] = useState(nexusKey);
  const ready = !!(event && key);
  useEffect(() => {
    if (!ready) { setLive(null); return; }
    let on = true;
    const go = () => loadNexus(event, key).then((n) => on && setLive(n)).catch(() => { /* keep the last good data */ });
    go();
    const t = window.setInterval(go, 15_000);
    return () => { on = false; window.clearInterval(t); };
  }, [event, key, ready]);
  const tick = Math.floor(now / 5000) * 5000;
  const sample = useMemo(() => (demo && !ready ? sampleNexus(schedule, lead, tick) : null), [demo, ready, schedule, lead, tick]);
  return { nexus: ready ? live : sample, refresh: () => setKey(nexusKey()) };
}

export const NexusCtx = createContext<Nexus | null>(null);
export const useNexusData = () => useContext(NexusCtx);

export interface LiveStatus {
  phase: Phase;
  /** what's happening: "Queuing soon", "Now queuing", "On deck", "On field" */
  label: string;
  /** what the countdown counts to */
  countLabel: string;
  countTo: number | null;
  queueAt: number;
  source: 'nexus' | 'schedule';
  nowQueuing: string | null;
}

export const PHASES: { p: Phase; t: string; s: string }[] = [
  { p: 'soon', t: 'Queuing soon', s: 'Soon' }, { p: 'queuing', t: 'Now queuing', s: 'Queuing' }, { p: 'deck', t: 'On deck', s: 'On deck' }, { p: 'field', t: 'On field', s: 'On field' },
];
export const NEAR_MIN = 15;

/** Where our next match is in the queue. Nexus when it has the match, else the schedule. */
export function liveStatus(match: ScheduledMatch | undefined, needBy: number | undefined, nexus: Nexus | null, now: number): LiveStatus | null {
  if (!match) return null;
  const n = nexus?.matches[match.label];
  const queueAt = n?.queueAt ?? needBy ?? ms(match.time);
  const nq = nexus?.nowQueuing ?? null;
  if (n?.phase === 'field') return { phase: 'field', label: 'On field', countLabel: now < (n.startAt ?? 0) ? 'Match starts in' : 'Match running', countTo: n.startAt && now < n.startAt ? n.startAt : null, queueAt, source: 'nexus', nowQueuing: nq };
  if (n?.phase === 'deck') return { phase: 'deck', label: 'On deck', countLabel: 'On field in', countTo: n.fieldAt, queueAt, source: 'nexus', nowQueuing: nq };
  if (n?.phase === 'queuing') return { phase: 'queuing', label: 'Now queuing', countLabel: n.deckAt ? 'On deck in' : 'Get to queue', countTo: n.deckAt, queueAt, source: 'nexus', nowQueuing: nq };
  const src = n ? 'nexus' as const : 'schedule' as const;
  if (!n && now >= queueAt) return { phase: 'queuing', label: 'Queue now', countLabel: 'Queue overdue by', countTo: queueAt, queueAt, source: src, nowQueuing: nq };
  const soon = n?.phase === 'soon' || queueAt - now <= NEAR_MIN * MIN;
  const min = Math.max(0, Math.ceil((queueAt - now) / MIN));
  return {
    phase: soon ? 'soon' : 'later',
    label: soon ? (min <= 1 ? 'Queuing any minute' : `${min} min to queuing`) : 'Queuing later',
    countLabel: 'Queuing in', countTo: queueAt, queueAt, source: src, nowQueuing: nq,
  };
}

/** When a match will really start: Nexus's estimate, else TBA's predicted time, else the printed schedule.
    Events drift behind (or catch up), so the pit plans and counts down from this, not the original time. */
export function estimatedStart(m: ScheduledMatch, intel: Intel | null, nexus: Nexus | null): number {
  // once TBA has the score, the match is over: use when it actually ran, never a still-moving estimate
  const t = intel?.matches[m.key];
  if (t?.result) return t.estAt ?? ms(m.time);
  const n = nexus?.matches[m.label];
  return n?.startAt ?? n?.fieldAt ?? intel?.matches[m.key]?.estAt ?? ms(m.time);
}

/** The schedule with every time moved to its live estimate. For planning and display only; never saved. */
export function liveSchedule(matches: ScheduledMatch[], intel: Intel | null, nexus: Nexus | null): ScheduledMatch[] {
  return matches.map((m) => {
    const at = estimatedStart(m, intel, nexus);
    return at === ms(m.time) ? m : { ...m, time: new Date(at).toISOString() };
  });
}

/** Our schedule key for a label: Q12 → qm12, SF4 → sf4m1, F2 → f1m2 (TBA's keys). */
export function keyForLabel(label: string): string {
  const q = /^Q(\d+)$/.exec(label), sf = /^SF(\d+)$/.exec(label), f = /^F(\d+)$/.exec(label);
  return q ? `qm${q[1]}` : sf ? `sf${sf[1]}m1` : f ? `f1m${f[1]}` : label.toLowerCase();
}

/** The saved schedule plus our matches that only TBA or Nexus know about yet: playoffs, which get
    scheduled after alliance selection. Read-only; nothing is saved. */
export function fullSchedule(saved: ScheduledMatch[], intel: Intel | null, nexus: Nexus | null, team: string, now = Date.now()): ScheduledMatch[] {
  return dropUnplayable(withPlayoffs(saved, intel, nexus, team), intel, now);
}

/** An unplayed match this long past its printed time is over or isn't happening (its live estimate can keep sliding). */
export const STALE_MS = 4 * 3600_000;

/** Take out matches that won't be played: the rest of a best-of series once someone has won it
    (F3 after a 2-0 final), and unplayed matches long past their printed time. Without this the
    pit keeps counting down to a match that never comes. */
export function dropUnplayable(schedule: ScheduledMatch[], intel: Intel | null, now: number): ScheduledMatch[] {
  const wins = new Map<string, { red: number; blue: number }>();
  for (const [key, m] of Object.entries(intel?.matches ?? {})) {
    const set = /^((?:qf|sf|f)\d+)m\d+$/.exec(key)?.[1];
    if (!set || !m.result) continue;
    const w = wins.get(set) ?? { red: 0, blue: 0 };
    if (m.result.red > m.result.blue) w.red++; else if (m.result.blue > m.result.red) w.blue++;
    wins.set(set, w);
  }
  return schedule.filter((m) => {
    if (intel?.matches[m.key]?.result) return true; // played: keep it in the history
    const set = /^((?:qf|sf|f)\d+)m\d+$/.exec(m.key)?.[1];
    const w = set ? wins.get(set) : undefined;
    if (w && Math.max(w.red, w.blue) >= 2) return false;
    return now - ms(m.time) < STALE_MS;
  });
}

function withPlayoffs(saved: ScheduledMatch[], intel: Intel | null, nexus: Nexus | null, team: string): ScheduledMatch[] {
  const out = [...saved];
  const keys = new Set(saved.map((m) => m.key)), labels = new Set(saved.map((m) => m.label));
  const add = (key: string, label: string, at: number | null | undefined) => {
    if (!at || keys.has(key) || labels.has(label)) return;
    keys.add(key); labels.add(label);
    out.push({ key, label, time: new Date(at).toISOString() });
  };
  if (intel?.source === 'live') for (const [key, m] of Object.entries(intel.matches)) if (m.label) add(key, m.label, m.time ?? m.estAt);
  const t = team.trim().toUpperCase();
  if (t) for (const n of Object.values(nexus?.matches ?? {})) {
    if (![...n.red, ...n.blue].some((x) => x.toUpperCase() === t)) continue;
    add(keyForLabel(n.label), n.label, n.startAt ?? n.fieldAt ?? n.queueAt);
  }
  return out.sort((a, b) => ms(a.time) - ms(b.time));
}

/** Alliances from Nexus for matches TBA hasn't posted yet (playoffs at offseason events). */
export function withNexusAlliances(intel: Intel | null, nexus: Nexus | null, schedule: ScheduledMatch[], team: string): Intel | null {
  if (!intel || !nexus || nexus.source !== 'live') return intel;
  const t = team.trim().toUpperCase();
  let matches = intel.matches;
  for (const m of schedule) {
    const n = nexus.matches[m.label];
    const have = matches[m.key];
    if (!n || (!n.red.length && !n.blue.length) || (have && (have.red.length || have.blue.length))) continue;
    const us = n.red.some((x) => x.toUpperCase() === t) ? 'red' as const : n.blue.some((x) => x.toUpperCase() === t) ? 'blue' as const : null;
    if (matches === intel.matches) matches = { ...matches };
    matches[m.key] = { ...(have ?? { redWin: null, rp: [], pred: null, result: null }), red: n.red, blue: n.blue, us };
  }
  return matches === intel.matches ? intel : { ...intel, matches };
}
