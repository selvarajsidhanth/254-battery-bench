/* Live event intel for the pit: rankings and alliances from The Blue Alliance,
   win odds and ranking-point chances from Statbotics (free, no key, browser-friendly).
   Everything here is read-only and per-device; nothing is saved to the team database. */
import { useEffect, useMemo, useState } from 'react';
import { tba, tbaCreds } from './tba';
import type { ScheduledMatch } from './types';

export type Side = 'red' | 'blue';

export interface IntelMatch {
  red: string[];
  blue: string[];
  /** our alliance, when we're in it */
  us: Side | null;
  /** chance red wins, 0-1 (Statbotics) */
  redWin: number | null;
  /** chance our alliance earns each bonus ranking point, 0-1 */
  rp: number[];
  pred: { red: number; blue: number } | null;
  result: { red: number; blue: number } | null;
}

export interface IntelRank {
  rank: number;
  team: string;
  wins: number; losses: number; ties: number;
  rs: number | null;
  /** Statbotics EPA: expected points the team adds to its alliance */
  epa: number | null;
}

export interface Intel {
  source: 'live' | 'sample';
  at: number;
  team: string;
  rankings: IntelRank[];
  /** by schedule match key, e.g. "qm42" */
  matches: Record<string, IntelMatch>;
  errors: string[];
}

const SB = 'https://api.statbotics.io/v3';
const num = (t: string) => t.replace(/^frc/, '');

interface TbaRankings {
  rankings: { rank: number; team_key: string; record: { wins: number; losses: number; ties: number } | null; sort_orders: number[] | null }[] | null;
}
interface TbaSimple {
  key: string;
  alliances: { red: { team_keys: string[]; score: number }; blue: { team_keys: string[]; score: number } };
}
interface SbMatch {
  key: string;
  alliances: { red: { team_keys: (number | string)[] }; blue: { team_keys: (number | string)[] } };
  pred?: Record<string, number | string | null>;
}
interface SbTeamEvent { team: number | string; epa?: { total_points?: number } }

async function sb<T>(path: string): Promise<T> {
  const r = await fetch(SB + path);
  if (!r.ok) throw new Error(`Statbotics returned ${r.status}`);
  return r.json() as Promise<T>;
}

const sideOf = (team: string, red: string[], blue: string[]): Side | null =>
  red.includes(team) ? 'red' : blue.includes(team) ? 'blue' : null;

export async function loadIntel(event: string, team: string, key: string): Promise<Intel> {
  const ev = event.trim().toLowerCase();
  const errors: string[] = [];
  const [ranks, simple, sbm, sbt] = await Promise.allSettled([
    tba<TbaRankings>(`/event/${ev}/rankings`, key),
    tba<TbaSimple[]>(`/team/frc${team}/event/${ev}/matches/simple`, key),
    sb<SbMatch[]>(`/matches?event=${ev}&team=${team}&limit=200`),
    sb<SbTeamEvent[]>(`/team_events?event=${ev}&limit=200`),
  ]);
  const fail = (r: PromiseSettledResult<unknown>, what: string) => {
    if (r.status === 'rejected') errors.push(`${what}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  };
  fail(ranks, 'Rankings'); fail(simple, 'Alliances'); fail(sbm, 'Win odds'); fail(sbt, 'Team ratings');

  const epa = new Map<string, number>();
  if (sbt.status === 'fulfilled') for (const t of sbt.value) if (t.epa?.total_points != null) epa.set(String(t.team), t.epa.total_points);

  const matches: Record<string, IntelMatch> = {};
  const short = (k: string) => k.split('_')[1] ?? k;
  if (simple.status === 'fulfilled') {
    for (const m of simple.value) {
      const red = m.alliances.red.team_keys.map(num);
      const blue = m.alliances.blue.team_keys.map(num);
      const played = m.alliances.red.score >= 0 && m.alliances.blue.score >= 0;
      matches[short(m.key)] = { red, blue, us: sideOf(team, red, blue), redWin: null, rp: [], pred: null, result: played ? { red: m.alliances.red.score, blue: m.alliances.blue.score } : null };
    }
  }
  if (sbm.status === 'fulfilled') {
    for (const m of sbm.value) {
      const k = short(m.key);
      const red = m.alliances.red.team_keys.map(String);
      const blue = m.alliances.blue.team_keys.map(String);
      const x = matches[k] ?? (matches[k] = { red, blue, us: sideOf(team, red, blue), redWin: null, rp: [], pred: null, result: null });
      const p = m.pred ?? {};
      const n = (f: string) => (typeof p[f] === 'number' ? (p[f] as number) : null);
      x.redWin = n('red_win_prob');
      const rs = n('red_score'), bs = n('blue_score');
      x.pred = rs != null && bs != null ? { red: rs, blue: bs } : null;
      if (x.us) x.rp = [1, 2, 3].map((i) => n(`${x.us}_rp_${i}`)).filter((v): v is number => v != null);
    }
  }

  const rankings: IntelRank[] = ranks.status === 'fulfilled'
    ? (ranks.value.rankings ?? []).map((r) => ({
      rank: r.rank, team: num(r.team_key),
      wins: r.record?.wins ?? 0, losses: r.record?.losses ?? 0, ties: r.record?.ties ?? 0,
      rs: r.sort_orders?.[0] ?? null, epa: epa.get(num(r.team_key)) ?? null,
    }))
    : [];
  return { source: 'live', at: Date.now(), team, rankings, matches, errors };
}

/* ---------- sample data so the demo shows the whole screen ---------- */

const FAKE = ['8812', '3176', '6401', '2290', '5519', '7043', '1187', '9356', '4628', '3381', '6075', '2734', '5102', '7710', '2468', '1357'];

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function sampleIntel(schedule: ScheduledMatch[], now: number): Intel {
  const team = 'US';
  const matches: Record<string, IntelMatch> = {};
  for (const m of schedule) {
    const r = rng(m.key);
    const pool = [...FAKE].sort(() => r() - 0.5).slice(0, 5);
    const us: Side = r() < 0.5 ? 'red' : 'blue';
    const mine = [team, pool[0], pool[1]];
    const theirs = pool.slice(2, 5);
    const red = us === 'red' ? mine : theirs;
    const blue = us === 'red' ? theirs : mine;
    const ourWin = 0.35 + r() * 0.62;
    const redWin = us === 'red' ? ourWin : 1 - ourWin;
    const base = 300 + r() * 150;
    const pred = { red: Math.round(us === 'red' ? base + ourWin * 120 : base + (1 - ourWin) * 120), blue: Math.round(us === 'blue' ? base + ourWin * 120 : base + (1 - ourWin) * 120) };
    const played = new Date(m.time).getTime() + 3 * 60000 < now;
    matches[m.key] = {
      red, blue, us, redWin, pred,
      rp: [Math.min(0.98, ourWin + 0.1), r(), r() * 0.4],
      result: played ? { red: pred.red + Math.round((r() - 0.5) * 80), blue: pred.blue + Math.round((r() - 0.5) * 80) } : null,
    };
  }
  const r = rng('rank');
  const rankings: IntelRank[] = [...FAKE.slice(0, 2), team, ...FAKE.slice(2, 13)].map((t, i) => ({
    rank: i + 1, team: t, wins: Math.max(0, 6 - Math.floor(i / 3)), losses: Math.floor(i / 3) + (i % 2), ties: 0,
    rs: Math.round((4 - i * 0.14) * 100) / 100, epa: Math.round(180 + r() * 280),
  }));
  return { source: 'sample', at: now, team, rankings, matches, errors: [] };
}

/** Polls live intel once a minute while the pit is open. Sample data in the demo. */
export function useIntel(event: string, schedule: ScheduledMatch[], demo: boolean, now: number) {
  const [intel, setIntel] = useState<Intel | null>(null);
  const [creds, setCreds] = useState(tbaCreds);
  const ready = !!(event && creds.key && creds.team);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const go = () => loadIntel(event, creds.team.trim(), creds.key).then((i) => live && setIntel(i)).catch(() => { /* keep the last good data */ });
    go();
    const t = window.setInterval(go, 60_000);
    return () => { live = false; window.clearInterval(t); };
  }, [event, creds.key, creds.team, ready]);
  const minute = Math.floor(now / 60000) * 60000;
  const sample = useMemo(() => (demo && !ready ? sampleIntel(schedule, minute) : null), [demo, ready, schedule, minute]);
  return { intel: ready ? intel : sample, ready, needs: !event ? 'event' as const : !creds.key || !creds.team ? 'creds' as const : null, refreshCreds: () => setCreds(tbaCreds()) };
}
