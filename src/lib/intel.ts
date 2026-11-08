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
  /** TBA's live estimate of the start (ms), which moves as the event runs ahead or behind */
  estAt?: number | null;
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
  /** where win odds came from: Statbotics, or our own estimate from TBA OPR (offseason events) */
  odds: 'statbotics' | 'opr' | null;
  /** what the team rating column shows */
  rating: 'EPA' | 'OPR';
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
  time?: number | null; predicted_time?: number | null; actual_time?: number | null;
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
      const est = m.actual_time ?? m.predicted_time ?? null;
      matches[short(m.key)] = { red, blue, us: sideOf(team, red, blue), redWin: null, rp: [], pred: null, result: played ? { red: m.alliances.red.score, blue: m.alliances.blue.score } : null, estAt: est ? est * 1000 : null };
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

  // Statbotics skips offseason events. Estimate odds from TBA's OPRs instead.
  let odds: Intel['odds'] = Object.values(matches).some((m) => m.redWin != null) ? 'statbotics' : null;
  let rating: Intel['rating'] = 'EPA';
  const needOpr = !epa.size || Object.values(matches).some((m) => m.redWin == null && !m.result);
  if (needOpr) {
    try {
      const o = await tba<{ oprs?: Record<string, number> | null }>(`/event/${ev}/oprs`, key);
      const opr = new Map(Object.entries(o.oprs ?? {}).map(([k, v]) => [num(k), v]));
      if (opr.size) {
        if (!epa.size) { rating = 'OPR'; opr.forEach((v, k) => epa.set(k, v)); }
        Object.values(matches).forEach((m) => {
          if (m.redWin != null) return;
          const p = oprOdds(m.red, m.blue, opr);
          if (!p) return;
          m.redWin = p.redWin; m.pred = p.pred;
          odds = odds ?? 'opr';
        });
      }
    } catch (e) {
      errors.push(`OPR: ${e instanceof Error ? e.message : e}`);
    }
  }

  const rankings: IntelRank[] = ranks.status === 'fulfilled'
    ? (ranks.value.rankings ?? []).map((r) => ({
      rank: r.rank, team: num(r.team_key),
      wins: r.record?.wins ?? 0, losses: r.record?.losses ?? 0, ties: r.record?.ties ?? 0,
      rs: r.sort_orders?.[0] ?? null, epa: epa.get(num(r.team_key)) ?? null,
    }))
    : [];
  return { source: 'live', odds, rating, at: Date.now(), team, rankings, matches, errors };
}

/** Normal CDF (Abramowitz-Stegun), good to ~1e-7. */
function phi(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Win odds from OPR: each alliance's predicted score is the sum of its teams' OPRs. The spread
    of real results around that is roughly 0.42 x a typical alliance score (fit to 2026 events),
    so the chance red wins is the normal CDF of the predicted margin over that spread. */
export function oprOdds(red: string[], blue: string[], opr: Map<string, number>) {
  const sum = (l: string[]) => (l.every((t) => opr.has(t)) ? l.reduce((a, t) => a + opr.get(t)!, 0) : null);
  const r = sum(red), b = sum(blue);
  if (r == null || b == null) return null;
  const all = [...opr.values()];
  const typical = Math.max(1, (all.reduce((a, v) => a + v, 0) / all.length) * 3);
  return { redWin: phi((r - b) / (0.42 * typical)), pred: { red: r, blue: b } };
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
      estAt: new Date(m.time).getTime() + 6 * 60000, // the demo runs behind
    };
  }
  const r = rng('rank');
  const rankings: IntelRank[] = [...FAKE.slice(0, 2), team, ...FAKE.slice(2, 13)].map((t, i) => ({
    rank: i + 1, team: t, wins: Math.max(0, 6 - Math.floor(i / 3)), losses: Math.floor(i / 3) + (i % 2), ties: 0,
    rs: Math.round((4 - i * 0.14) * 100) / 100, epa: Math.round(180 + r() * 280),
  }));
  return { source: 'sample', odds: 'statbotics', rating: 'EPA', at: now, team, rankings, matches, errors: [] };
}

/** Polls live intel every 30 s while the pit is open. Sample data in the demo. */
export function useIntel(event: string, schedule: ScheduledMatch[], demo: boolean, now: number) {
  const [intel, setIntel] = useState<Intel | null>(null);
  const [creds, setCreds] = useState(tbaCreds);
  const ready = !!(event && creds.key && creds.team);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const go = () => loadIntel(event, creds.team.trim(), creds.key).then((i) => live && setIntel(i)).catch(() => { /* keep the last good data */ });
    go();
    const t = window.setInterval(go, 30_000);
    return () => { live = false; window.clearInterval(t); };
  }, [event, creds.key, creds.team, ready]);
  const minute = Math.floor(now / 60000) * 60000;
  const sample = useMemo(() => (demo && !ready ? sampleIntel(schedule, minute) : null), [demo, ready, schedule, minute]);
  return { intel: ready ? intel : sample, ready, needs: !event ? 'event' as const : !creds.key || !creds.team ? 'creds' as const : null, refreshCreds: () => setCreds(tbaCreds()) };
}

/* ---------- one team's details, for the team card ---------- */

export interface TeamInfo {
  name: string | null;
  place: string | null;
  /** this event's scoring breakdown (TBA component OPRs), largest first */
  parts: { label: string; value: number }[];
}

const names = new Map<string, Promise<{ nickname?: string; city?: string; state_prov?: string } | null>>();
const coprs = new Map<string, Promise<Record<string, Record<string, number>> | null>>();

const nice = (k: string) => k.replace(/Points?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).trim();

/** Team name and scoring breakdown at this event. Cached; failures just leave parts empty. */
export async function teamInfo(event: string, team: string, key = tbaCreds().key): Promise<TeamInfo> {
  const base = team.replace(/\D+$/, ''); // offseason second robots: "581B" → 581
  if (!names.has(base)) names.set(base, tba<{ nickname?: string; city?: string; state_prov?: string }>(`/team/frc${base}/simple`, key).catch(() => null));
  const ev = event.trim().toLowerCase();
  if (!coprs.has(ev)) coprs.set(ev, tba<Record<string, Record<string, number>>>(`/event/${ev}/coprs`, key).catch(() => null));
  const [n, c] = await Promise.all([names.get(base)!, coprs.get(ev)!]);
  const keyOf = `frc${team}`;
  const all = Object.entries(c ?? {})
    .filter(([k, v]) => v && typeof v[keyOf] === 'number' && !/total|foul|tiebreak|rp|rank/i.test(k))
    .map(([k, v]) => ({ label: nice(k), value: v[keyOf] }));
  // prefer the auto / teleop / endgame split when the game reports it
  const phases = all.filter((p) => /^(auto|teleop|tele op|end ?game)$/i.test(p.label));
  const parts = (phases.length >= 2 ? phases : all.sort((a, b) => b.value - a.value)).slice(0, 4);
  return {
    name: n?.nickname ?? null,
    place: n ? [n.city, n.state_prov].filter(Boolean).join(', ') || null : null,
    parts,
  };
}

/** Our team for the pit header: number from this device's TBA settings, nickname from TBA.
    Nothing team-specific is in the code; without settings the app stays neutral. */
export function useTeamBrand(fallback: { mark: string; name: string }) {
  const { team, key } = tbaCreds();
  const base = team.trim();
  const [nick, setNick] = useState<string | null>(null);
  useEffect(() => {
    if (!base || !key) return;
    let on = true;
    if (!names.has(base)) names.set(base, tba<{ nickname?: string; city?: string; state_prov?: string }>(`/team/frc${base}/simple`, key).catch(() => null));
    names.get(base)!.then((n) => on && setNick(n?.nickname ?? null));
    return () => { on = false; };
  }, [base, key]);
  return base ? { mark: base, name: nick ?? 'Battery Bench' } : fallback;
}
