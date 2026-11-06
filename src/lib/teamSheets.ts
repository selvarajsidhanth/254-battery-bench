/* Reads the team's existing Google Sheet tabs (exported as CSV) as-is:
     Inventory      Name, Status, Location, Manufacturer, Lot Code, …
     CBA results    Google Form: Timestamp, Battery Name, Pre-test R_int, Amp-Hours, Post-test R_int, Your Name, Watt-Hours
     MCA results    Google Form: Timestamp, Battery Name, Your Name, MCA Test Result
     Config         the thresholds tab ("15.5, Minimum Amp-Hours …")
   The Schedule tab is recognised and skipped: the app works that out itself. */
import Papa from 'papaparse';
import { normalizeLabel, parseDate, parseNum } from './csv';
import { toMilliohms } from './domain';
import type { Settings } from './types';

export type SheetKind = 'inventory' | 'cba' | 'mca' | 'config' | 'schedule' | 'unknown';

export interface InventoryRow {
  label: string;
  manufacturer?: string;
  lotCode?: string;
  location?: string;
  quarantined: boolean;
  quarantineFor: 'comp' | 'hold';
  retired: boolean;
}
export interface CbaRow { label: string; at: string; rintPre: number | null; ah: number | null; rintPost: number | null; wh: number | null; by: string }
export interface McaRow { label: string; at: string; mca: number; by: string }

export interface ParsedSheet {
  name: string;
  kind: SheetKind;
  inventory?: InventoryRow[];
  cba?: CbaRow[];
  mca?: McaRow[];
  config?: Partial<Settings>;
  skipped: { row: number; msg: string }[];
}

const MFR: Record<string, string> = { M: 'MK', E: 'Energizer' };
/** "2026-31m" → "2026-31M"; plain numbers still become "B-07". */
export const teamLabel = (v: unknown) => normalizeLabel(v);
export const manufacturerFromLabel = (label: string) => MFR[label.slice(-1).toUpperCase()];

const find = (headers: string[], ...starts: string[]) =>
  headers.find((h) => starts.some((s) => h.toLowerCase().trim().startsWith(s)));

export function detectSheet(text: string, headers: string[]): SheetKind {
  if (/Minimum Amp-Hours/i.test(text)) return 'config';
  if (/Due for CBA Testing/i.test(text)) return 'schedule';
  // inventory first: it also has R_int and Amp-Hours summary columns
  if (find(headers, 'name') && find(headers, 'status') && find(headers, 'location')) return 'inventory';
  if (find(headers, 'pre-test r_int') && find(headers, 'amp-hours')) return 'cba';
  if (find(headers, 'mca test result')) return 'mca';
  return 'unknown';
}

export function parseTeamSheet(text: string, name: string): ParsedSheet {
  const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const headers = res.meta.fields ?? [];
  const kind = detectSheet(text, headers);
  const skipped: ParsedSheet['skipped'] = [];
  const out: ParsedSheet = { name, kind, skipped };

  if (kind === 'inventory') {
    const H = { name: find(headers, 'name')!, status: find(headers, 'status')!, loc: find(headers, 'location')!, mfr: find(headers, 'manufacturer'), lot: find(headers, 'lot') };
    out.inventory = [];
    res.data.forEach((r) => {
      const label = teamLabel(r[H.name]);
      if (!label) return;
      const status = (r[H.status] ?? '').toLowerCase();
      out.inventory!.push({
        label,
        manufacturer: (H.mfr && r[H.mfr]?.trim()) || manufacturerFromLabel(label),
        lotCode: (H.lot && r[H.lot]?.trim()) || undefined,
        location: r[H.loc]?.trim() || undefined,
        quarantined: status.includes('quarantine'),
        // "Quarantined for Competition" is a good thing; anything else quarantined is held out
        quarantineFor: status.includes('quarantine') && !status.includes('comp') ? 'hold' : 'comp',
        retired: status.includes('decom') || status.includes('retired'),
      });
    });
  } else if (kind === 'cba') {
    const H = { at: find(headers, 'timestamp', 'date')!, name: find(headers, 'battery')!, pre: find(headers, 'pre-test r_int')!, ah: find(headers, 'amp-hours')!, post: find(headers, 'post-test r_int'), wh: find(headers, 'watt-hours'), by: find(headers, 'your name', 'name') };
    out.cba = [];
    res.data.forEach((r, i) => {
      const label = teamLabel(r[H.name]);
      const at = parseDate(r[H.at]);
      if (!label) return skipped.push({ row: i + 2, msg: 'No battery' });
      if (!at) return skipped.push({ row: i + 2, msg: 'Unreadable date' });
      out.cba!.push({
        label, at: at.toISOString(),
        rintPre: toMilliohms(parseNum(r[H.pre])), ah: parseNum(r[H.ah]),
        rintPost: H.post ? toMilliohms(parseNum(r[H.post])) : null, wh: H.wh ? parseNum(r[H.wh]) : null,
        by: (H.by && r[H.by]?.trim()) || '',
      });
    });
  } else if (kind === 'mca') {
    const H = { at: find(headers, 'timestamp', 'date')!, name: find(headers, 'battery')!, mca: find(headers, 'mca test result')!, by: find(headers, 'your name') };
    out.mca = [];
    res.data.forEach((r, i) => {
      const label = teamLabel(r[H.name]);
      const at = parseDate(r[H.at]);
      const mca = parseNum(r[H.mca]);
      if (!label) return skipped.push({ row: i + 2, msg: 'No battery' });
      if (!at) return skipped.push({ row: i + 2, msg: 'Unreadable date' });
      if (mca == null) return skipped.push({ row: i + 2, msg: 'No MCA number' });
      out.mca!.push({ label, at: at.toISOString(), mca, by: (H.by && r[H.by]?.trim()) || '' });
    });
  } else if (kind === 'config') {
    out.config = parseConfig(text);
  }
  return out;
}

/** The thresholds tab: a "Suitable for Competition" block, then a "Suitable for Testing" block. */
export function parseConfig(text: string): Partial<Settings> {
  const rows = Papa.parse<string[]>(text.trim(), { skipEmptyLines: false }).data;
  const out: Partial<Settings> = {};
  let block: 'comp' | 'prac' | null = null;
  for (const [a = '', b = ''] of rows) {
    const label = `${a} ${b}`.toLowerCase();
    if (label.includes('suitable for competition') && !b) { block = 'comp'; continue; }
    if ((label.includes('suitable for testing') || label.includes('suitable for practice')) && !b) { block = 'prac'; continue; }
    const v = parseNum(a);
    if (v == null) continue;
    const t = b.toLowerCase();
    if (t.includes('number of batteries')) { out.compCount = v; continue; }
    if (!block) continue;
    const p = block === 'comp' ? 'comp' : 'prac';
    // check "recency" first: "MCA Test Recency" also contains "MCA"
    if (t.includes('recency')) {
      if (t.includes('cba')) out[`${p}CbaMonths`] = v;
      else if (t.includes('mca')) out[`${p}McaMonths`] = v;
    } else if (t.includes('amp-hours')) out[`${p}MinAh`] = v;
    else if (t.includes('r_int')) out[`${p}MaxRint`] = toMilliohms(v) ?? v;
    else if (t.includes('cca') || t.includes('mca')) out[`${p}MinMca`] = v;
  }
  return out;
}
