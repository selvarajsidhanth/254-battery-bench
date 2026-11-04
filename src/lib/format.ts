export const MIN = 60_000;
export const DAY = 86_400_000;

export const ms = (iso: string | number | Date) => (typeof iso === 'number' ? iso : new Date(iso).getTime());
export const minutesSince = (iso: string, now: number) => (now - ms(iso)) / MIN;

export function fmt(n: number | null | undefined, digits = 0): string {
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

/** "12 min", "1h 5m" */
export function dur(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** "4:07", "1:02:30" */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const m = minutesSince(iso, now);
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export const shortDate = (t: string | number) =>
  new Date(ms(t)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** Short date, adding the year when it's far from today. */
export const dateFar = (t: string | number, now = Date.now()) =>
  Math.abs(ms(t) - now) > 300 * DAY
    ? new Date(ms(t)).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : shortDate(t);
export const clock = (t: string | number) =>
  new Date(ms(t)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const monthYear = (ym?: string) => {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  if (!y) return ym;
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const uid = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

export const byLabel = <T extends { label: string }>(a: T, b: T) =>
  a.label.localeCompare(b.label, undefined, { numeric: true });
