/* CSV import for test history (e.g. exported from the team Google Sheet)
   and for match-log summaries. Column names are guessed, then editable. */

export const TEST_FIELDS = [
  { key: 'battery', label: 'Battery', required: true, hints: ['battery', 'batt', 'label', 'id', 'number', 'name'] },
  { key: 'date', label: 'Date / time', required: true, hints: ['date', 'time', 'timestamp', 'when', 'tested'] },
  { key: 'ir', label: 'Internal resistance (mΩ)', required: false, hints: ['ir', 'resist', 'mohm', 'mΩ', 'rint'] },
  { key: 'soc', label: 'State of charge (%)', required: false, hints: ['soc', 'charge', '%', 'percent'] },
  { key: 'v0', label: 'Open-load voltage (V)', required: false, hints: ['v0', 'voltage', 'volts', 'open', 'vol'] },
  { key: 'mca', label: 'Cranking amps (MCA)', required: false, hints: ['mca', 'crank', 'cca', 'amps'] },
  { key: 'by', label: 'Tested by', required: false, hints: ['by', 'tester', 'who', 'person', 'tested by'] },
  { key: 'notes', label: 'Notes', required: false, hints: ['note', 'comment', 'remarks'] },
] as const;

export const RUN_FIELDS = [
  { key: 'battery', label: 'Battery', required: true, hints: ['battery', 'batt', 'label'] },
  { key: 'match', label: 'Match', required: true, hints: ['match', 'qual', 'run'] },
  { key: 'date', label: 'Date / time', required: false, hints: ['date', 'time', 'timestamp'] },
  { key: 'event', label: 'Event', required: false, hints: ['event', 'comp', 'competition'] },
  { key: 'minV', label: 'Min voltage (V)', required: false, hints: ['min', 'lowest', 'sag'] },
  { key: 'peakA', label: 'Peak current (A)', required: false, hints: ['peak', 'current', 'amps', 'max a'] },
  { key: 'energyWh', label: 'Energy used (Wh)', required: false, hints: ['energy', 'wh', 'used'] },
  { key: 'brownouts', label: 'Brownouts', required: false, hints: ['brown'] },
] as const;

export type FieldDef = { key: string; label: string; required: boolean; hints: readonly string[] };
export type Mapping = Record<string, string | null>; // field key → CSV header

export function guessMapping(headers: string[], fields: readonly FieldDef[]): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  for (const f of fields) {
    const norm = (h: string) => h.toLowerCase().trim();
    // exact-ish match first, then substring
    let hit = headers.find((h) => !used.has(h) && f.hints.some((x) => norm(h) === x));
    if (!hit) hit = headers.find((h) => !used.has(h) && f.hints.some((x) => norm(h).includes(x)));
    out[f.key] = hit ?? null;
    if (hit) used.add(hit);
  }
  return out;
}

export function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Accepts ISO, "M/D/YYYY", "M/D/YYYY H:MM", "M/D/YY" and Google-Sheets style strings. */
export function parseDate(v: unknown): Date | null {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (us) {
    let [, mo, d, y, h, mi, se, ap] = us;
    let year = Number(y);
    if (year < 100) year += 2000;
    let hour = h ? Number(h) : 12;
    if (ap) hour = (hour % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0);
    const dt = new Date(year, Number(mo) - 1, Number(d), hour, mi ? Number(mi) : 0, se ? Number(se) : 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Battery labels in sheets come as "7", "B7", "b-07", "Battery 7"… normalize to "B-07". */
export function normalizeLabel(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(?:battery\s*|batt\s*|b\s*-?\s*)?(\d{1,3})$/i);
  if (m) return `B-${m[1].padStart(2, '0')}`;
  return s.toUpperCase();
}

export interface ParsedTestRow {
  row: number;
  label: string;
  at: string;
  ir: number | null;
  soc: number | null;
  v0: number | null;
  mca: number | null;
  by: string;
  notes: string;
}

export function parseTestRows(rows: Record<string, string>[], map: Mapping) {
  const ok: ParsedTestRow[] = [];
  const errors: { row: number; msg: string }[] = [];
  rows.forEach((r, i) => {
    const get = (k: string) => (map[k] ? r[map[k] as string] : undefined);
    const label = normalizeLabel(get('battery'));
    const date = parseDate(get('date'));
    const rec = {
      ir: parseNum(get('ir')), soc: parseNum(get('soc')), v0: parseNum(get('v0')), mca: parseNum(get('mca')),
    };
    if (!label && !date && Object.values(rec).every((v) => v == null)) return; // blank line
    if (!label) return errors.push({ row: i + 2, msg: 'No battery' });
    if (!date) return errors.push({ row: i + 2, msg: 'Unreadable date' });
    if (Object.values(rec).every((v) => v == null)) return errors.push({ row: i + 2, msg: 'No readings' });
    ok.push({ row: i + 2, label, at: date.toISOString(), ...rec, by: String(get('by') ?? '').trim(), notes: String(get('notes') ?? '').trim() });
  });
  return { ok, errors };
}

export interface ParsedRunRow {
  row: number;
  label: string;
  match: string;
  at: string;
  event: string;
  minV: number | null;
  peakA: number | null;
  energyWh: number | null;
  brownouts: number | null;
}

export function parseRunRows(rows: Record<string, string>[], map: Mapping, fallbackDate: Date) {
  const ok: ParsedRunRow[] = [];
  const errors: { row: number; msg: string }[] = [];
  rows.forEach((r, i) => {
    const get = (k: string) => (map[k] ? r[map[k] as string] : undefined);
    const label = normalizeLabel(get('battery'));
    const match = String(get('match') ?? '').trim();
    if (!label && !match) return;
    if (!label) return errors.push({ row: i + 2, msg: 'No battery' });
    if (!match) return errors.push({ row: i + 2, msg: 'No match' });
    const date = parseDate(get('date')) ?? fallbackDate;
    ok.push({
      row: i + 2, label, match, at: date.toISOString(), event: String(get('event') ?? '').trim(),
      minV: parseNum(get('minV')), peakA: parseNum(get('peakA')), energyWh: parseNum(get('energyWh')), brownouts: parseNum(get('brownouts')),
    });
  });
  return { ok, errors };
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
