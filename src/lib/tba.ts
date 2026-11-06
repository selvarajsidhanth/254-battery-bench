/* The Blue Alliance: schedules and match videos. The read key and team number
   are per-device (localStorage), never saved to the team database. */
import type { MatchReport } from './matchReport';

export const TBA_KEY = 'bb2:tbaKey';
export const TEAM_KEY = 'bb2:teamNumber';
const API = 'https://www.thebluealliance.com/api/v3';

const get = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
export const tbaCreds = () => ({ key: get(TBA_KEY), team: get(TEAM_KEY) });
export const saveTbaCreds = (key: string, team: string) => { put(TBA_KEY, key.trim()); put(TEAM_KEY, team.trim()); };

export async function tba<T>(path: string, key = tbaCreds().key): Promise<T> {
  const r = await fetch(API + path, { headers: { 'X-TBA-Auth-Key': key.trim() } });
  if (r.status === 401) throw new Error('TBA rejected the read key');
  if (r.status === 404) throw new Error('TBA doesn’t know that event');
  if (!r.ok) throw new Error(`TBA returned ${r.status}`);
  return r.json() as Promise<T>;
}

export interface TbaMatch {
  key: string; comp_level: string; set_number: number; match_number: number;
  time: number | null; predicted_time: number | null; actual_time?: number | null;
  videos?: { type: string; key: string }[];
}

const LVL: Record<string, string> = { qm: 'Q', ef: 'EF', qf: 'QF', sf: 'SF', f: 'F' };
export const tbaLabel = (m: TbaMatch) =>
  m.comp_level === 'qm' ? `Q${m.match_number}` : m.comp_level === 'f' ? `F${m.match_number}` : `${LVL[m.comp_level] ?? m.comp_level.toUpperCase()}${m.set_number}${m.comp_level === 'sf' ? '' : '-' + m.match_number}`;
const ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
export const byPlayOrder = (a: TbaMatch, b: TbaMatch) =>
  (ORDER[a.comp_level] ?? 9) - (ORDER[b.comp_level] ?? 9) || a.set_number - b.set_number || a.match_number - b.match_number;

/** FMS writes the event code (e.g. "CASJ") into the log; TBA keys are year + code. */
export function guessEventKey(r: MatchReport): string {
  const code = r.match.event.trim().toLowerCase();
  if (!/^[a-z0-9]{2,10}$/.test(code)) return '';
  const year = r.logStart ? new Date(r.logStart).getFullYear() : new Date().getFullYear();
  return /^\d{4}/.test(code) ? code : `${year}${code}`;
}

/** The TBA match this log is from, if the log says. Playoff numbering differs by year, so elims also match by time. */
export function pickMatch(list: TbaMatch[], r: MatchReport): TbaMatch | null {
  const n = r.match.number;
  if (r.match.type === 'qual' && n != null) return list.find((m) => m.comp_level === 'qm' && m.match_number === n) ?? null;
  if (r.match.type === 'elim' && r.logStart) {
    const at = new Date(r.logStart).getTime() / 1000;
    const near = list.filter((m) => m.comp_level !== 'qm' && (m.actual_time ?? m.time))
      .map((m) => ({ m, d: Math.abs(((m.actual_time ?? m.time) as number) - at) }))
      .sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 15 * 60) return near.m;
  }
  return null;
}

export function teamMatches(event: string, team = tbaCreds().team) {
  return tba<TbaMatch[]>(`/team/frc${team.trim()}/event/${event.trim().toLowerCase()}/matches`).then((l) => l.sort(byPlayOrder));
}

/** "dQw4w9WgXcQ", "dQw4w9WgXcQ?t=12", full youtube.com / youtu.be links → id + start seconds */
export function parseYoutube(s: string): { id: string; start: number } | null {
  const t = s.trim();
  const start = Number(t.match(/[?&#]t=(\d+)/)?.[1] ?? 0);
  const id = t.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/)?.[1] ?? t.match(/^([\w-]{11})(?:$|[?&#])/)?.[1];
  return id ? { id, start } : null;
}
