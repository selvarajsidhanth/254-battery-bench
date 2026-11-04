/* Hand-rolled SVG charts so they match the datasheet line language exactly. */
import type { Health } from '../lib/domain';
import type { TestRecord } from '../lib/types';
import { DAY, ms, shortDate } from '../lib/format';

/** Sparkline of IR across a battery's recent tests, on a shared 6–17 mΩ scale. */
export function Spark({ values, limit, health }: { values: number[]; limit: number; health: Health }) {
  const W = 120, H = 30, P = 4, lo = 6, hi = Math.max(17, limit + 2);
  if (values.length < 2) return <span className="mute" style={{ fontSize: 12 }}>—</span>;
  const X = (i: number) => P + (i / (values.length - 1)) * (W - 2 * P);
  const Y = (v: number) => P + (H - 2 * P) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
  const last = values[values.length - 1];
  const hollow = health === 'pull' || health === 'retired';
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <line x1={P} x2={W - P} y1={Y(limit)} y2={Y(limit)} stroke="var(--ink-3)" strokeDasharray="2 3" />
      <polyline points={values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={1.4} strokeLinejoin="round" />
      {hollow
        ? <circle cx={X(values.length - 1)} cy={Y(last)} r={3.4} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />
        : <circle cx={X(values.length - 1)} cy={Y(last)} r={health === 'watch' ? 3.2 : 2.6} fill="var(--ink)" />}
    </svg>
  );
}

/** Full IR history over real time with watch band, limit, and projected trend. */
export function IrChart({ tests, limit, watch, now, trend }: {
  tests: TestRecord[]; limit: number; watch: number; now: number;
  trend: { perWeek: number; nowValue: number; daysToLimit: number | null } | null;
}) {
  const pts = tests.filter((t) => t.ir != null).map((t) => ({ x: (ms(t.at) - now) / DAY, y: t.ir as number }));
  if (!pts.length) return <div className="empty">No internal-resistance readings yet.</div>;
  const W = 1000, H = 300, P = { l: 46, r: 118, t: 18, b: 34 };
  const projDays = trend?.daysToLimit != null && trend.daysToLimit < 120 ? trend.daysToLimit : null;
  const xmin = Math.min(-14, Math.floor(Math.min(...pts.map((p) => p.x))) - 3);
  const xmax = Math.max(3, projDays != null ? Math.ceil(projDays) + 6 : 3);
  const lo = Math.min(6, Math.floor(Math.min(...pts.map((p) => p.y)) - 1));
  const hi = Math.max(limit + 2, Math.ceil(Math.max(...pts.map((p) => p.y)) + 1));
  const X = (x: number) => P.l + ((x - xmin) / (xmax - xmin)) * (W - P.l - P.r);
  const Y = (y: number) => P.t + (1 - (y - lo) / (hi - lo)) * (H - P.t - P.b);
  const yTicks: number[] = [];
  for (let y = Math.ceil(lo / 2) * 2; y <= hi; y += 2) yTicks.push(y);
  const span = xmax - xmin;
  const step = span > 150 ? 28 : span > 60 ? 14 : 7;
  const xTicks: number[] = [];
  for (let x = Math.ceil(xmin / step) * step; x <= xmax; x += step) xTicks.push(x);
  const lastPt = pts[pts.length - 1];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Internal resistance over time">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-2)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={P.l} y={Y(limit)} width={W - P.l - P.r} height={Y(watch) - Y(limit)} fill="url(#hatch)" />
      {yTicks.map((y) => (
        <g key={y}>
          <line x1={P.l} x2={W - P.r} y1={Y(y)} y2={Y(y)} stroke="var(--line)" />
          <text x={P.l - 10} y={Y(y) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{y}</text>
        </g>
      ))}
      {xTicks.map((x) => (
        <g key={x}>
          <line x1={X(x)} x2={X(x)} y1={H - P.b} y2={H - P.b + 5} stroke="var(--ink-3)" />
          <text x={X(x)} y={H - P.b + 19} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{shortDate(now + x * DAY)}</text>
        </g>
      ))}
      <line x1={X(0)} x2={X(0)} y1={P.t} y2={H - P.b} stroke="var(--ink-3)" strokeDasharray="2 3" />
      <text x={X(0) + 6} y={P.t + 10} fontSize="10.5" fill="var(--ink-3)" letterSpacing=".08em">TODAY</text>
      <line x1={P.l} x2={W - P.r} y1={Y(limit)} y2={Y(limit)} stroke="var(--ink)" strokeWidth={1.5} />
      <text x={W - P.r + 8} y={Y(limit) + 4} fontSize="11" fontWeight="700" fill="var(--ink)">LIMIT {limit.toFixed(1)}</text>
      <text x={W - P.r + 8} y={Y(watch) + 4} fontSize="11" fill="var(--ink-3)">WATCH {watch.toFixed(1)}</text>
      <polyline points={pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeLinejoin="round" />
      {trend && projDays != null && (
        <g>
          <line x1={X(lastPt.x)} y1={Y(trend.nowValue + (trend.perWeek / 7) * lastPt.x)} x2={X(projDays)} y2={Y(limit)} stroke="var(--ink)" strokeWidth={1.75} strokeDasharray="6 4" />
          <circle cx={X(projDays)} cy={Y(limit)} r={6} fill="var(--ink)" />
          <text x={X(projDays)} y={Y(limit) - 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">≈ {shortDate(now + projDays * DAY)}</text>
        </g>
      )}
      {pts.map((p, i) => <rect key={i} x={X(p.x) - 3} y={Y(p.y) - 3} width={6} height={6} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />)}
    </svg>
  );
}

export function MiniChart({ tests, field, floor, now }: { tests: TestRecord[]; field: 'mca' | 'v0' | 'soc'; floor: number | null; now: number }) {
  const pts = tests.filter((t) => t[field] != null).map((t) => ({ x: (ms(t.at) - now) / DAY, y: t[field] as number }));
  if (pts.length < 2) return <div className="empty" style={{ padding: '22px 0' }}>Not enough readings yet.</div>;
  const W = 320, H = 90, P = 8;
  const ys = pts.map((p) => p.y).concat(floor != null ? [floor] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.15; lo -= pad; hi += pad;
  const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(0, ...pts.map((p) => p.x));
  const X = (x: number) => P + ((x - xmin) / (xmax - xmin || 1)) * (W - 2 * P);
  const Y = (y: number) => P + (1 - (y - lo) / (hi - lo)) * (H - 2 * P);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {floor != null && <line x1={P} x2={W - P} y1={Y(floor)} y2={Y(floor)} stroke="var(--ink-3)" strokeDasharray="3 3" />}
      <polyline points={pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
      {pts.map((p, i) => <rect key={i} x={X(p.x) - 2.5} y={Y(p.y) - 2.5} width={5} height={5} fill="var(--ink)" />)}
    </svg>
  );
}

/** Last few IR readings plus the one being entered. */
export function TrendWithNew({ values, next, limit }: { values: number[]; next: number | null; limit: number }) {
  const vals = next != null ? [...values, next] : values;
  if (vals.length < 1) return <div className="mute" style={{ fontSize: 12 }}>No earlier IR readings.</div>;
  const W = 320, H = 70, P = 8;
  let lo = Math.min(...vals, limit) - 1, hi = Math.max(...vals, limit) + 1;
  if (hi - lo < 4) { lo -= 1; hi += 1; }
  const X = (i: number) => (vals.length === 1 ? W / 2 : P + (i / (vals.length - 1)) * (W - 2 * P));
  const Y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <line x1={P} x2={W - P} y1={Y(limit)} y2={Y(limit)} stroke="var(--ink)" />
      <polyline points={vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} />
      {vals.map((v, i) => {
        const isNew = next != null && i === vals.length - 1;
        return isNew
          ? <g key={i}><rect x={X(i) - 5} y={Y(v) - 5} width={10} height={10} fill="var(--ink)" /><text x={X(i) - 10} y={Y(v) + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--ink)">new</text></g>
          : <rect key={i} x={X(i) - 2.5} y={Y(v) - 2.5} width={5} height={5} fill="var(--ink-2)" />;
      })}
    </svg>
  );
}
