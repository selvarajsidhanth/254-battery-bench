import { parseDate } from './csv';
import type { ScheduledMatch } from './types';

/** "Q12 10:34", "Q12, 3/14 10:34 AM", "SF3 2026-04-18 14:05" */
export function parseScheduleLines(text: string, today = new Date()): ScheduledMatch[] {
  const out: ScheduledMatch[] = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Za-z]{1,3}\s?\d{1,3})[\s,;\t]+(.+)$/);
    if (!m) continue;
    const label = m[1].replace(/\s+/g, ' ').toUpperCase();
    const rest = m[2].trim();
    let when: Date | null = null;
    const t = rest.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (t) {
      let h = Number(t[1]);
      if (t[3]) h = (h % 12) + (t[3].toLowerCase() === 'pm' ? 12 : 0);
      when = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, Number(t[2]));
    } else {
      when = parseDate(rest.replace(/^(\d{1,2}\/\d{1,2})(\s)/, `$1/${today.getFullYear()}$2`));
    }
    if (when) out.push({ key: label.toLowerCase().replace(/\s/g, ''), label, time: when.toISOString() });
  }
  return out;
}
