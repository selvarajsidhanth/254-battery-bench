/* Hand-rolled SVG charts so they match the datasheet line language exactly. */
import type { Health, Trend } from '../lib/domain';
import { DAY, dateFar, ms, shortDate } from '../lib/format';

/** Tiny trend line for table rows. `lines` are threshold guides. */
export function Spark({ values, lines = [], health, lo, hi }: { values: number[]; lines?: number[]; health: Health; lo: number; hi: number }) {
  const W = 110, H = 28, P = 4;
  if (values.length < 2) return <span className="mute" style={{ fontSize: 12 }}>—</span>;
  const X = (i: number) => P + (i / (values.length - 1)) * (W - 2 * P);
  const Y = (v: number) => P + (H - 2 * P) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
  const last = values[values.length - 1];
  const hollow = health === 'pull' || health === 'retired';
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {lines.map((l) => <line key={l} x1={P} x2={W - P} y1={Y(l)} y2={Y(l)} stroke="var(--ink-3)" strokeDasharray="2 3" />)}
      <polyline points={values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={1.4} strokeLinejoin="round" />
      {hollow
        ? <circle cx={X(values.length - 1)} cy={Y(last)} r={3.4} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2} />
        : <circle cx={X(values.length - 1)} cy={Y(last)} r={health === 'watch' ? 3.2 : 2.6} fill="var(--ink)" />}
    </svg>
  );
}

export interface Guide { v: number; label: string; strong?: boolean }

/** A metric over real time, with threshold guides, a hatched zone between the
    two guides, and an optional projected trend to the strong guide. */
export function TimeChart({ points, guides, now, trend, digits = 1, emptyText }: {
  points: { at: string; v: number }[];
  guides: Guide[];
  now: number;
  trend?: Trend | null;
  digits?: number;
  emptyText: string;
}) {
  if (!points.length) return <div className="empty">{emptyText}</div>;
  const pts = points.map((p) => ({ x: (ms(p.at) - now) / DAY, y: p.v }));
  const strong = guides.find((g) => g.strong);
  const projDays = trend?.daysToLimit != null && trend.daysToLimit < 240 ? trend.daysToLimit : null;
  const W = 1000, H = 300, P = { l: 52, r: 150, t: 22, b: 34 };
  const xmin = Math.min(-14, Math.floor(Math.min(...pts.map((p) => p.x))) - 4);
  const xmax = Math.max(4, projDays != null ? Math.ceil(projDays) + 8 : 4);
  const ys = pts.map((p) => p.y).concat(guides.map((g) => g.v));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  lo -= pad; hi += pad;
  const X = (x: number) => P.l + ((x - xmin) / (xmax - xmin)) * (W - P.l - P.r);
  const Y = (y: number) => P.t + (1 - (y - lo) / (hi - lo)) * (H - P.t - P.b);
  const step = niceStep((hi - lo) / 5);
  const yTicks: number[] = [];
  for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) yTicks.push(+y.toFixed(6));
  const span = xmax - xmin;
  const xstep = span > 150 ? 28 : span > 60 ? 14 : 7;
  const xTicks: number[] = [];
  for (let x = Math.ceil(xmin / xstep) * xstep; x <= xmax; x += xstep) xTicks.push(x);
  const g2 = guides.slice(0, 2).map((g) => g.v);
  const last = pts[pts.length - 1];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-2)" strokeWidth="1" />
        </pattern>
      </defs>
      {g2.length === 2 && <rect x={P.l} y={Y(Math.max(...g2))} width={W - P.l - P.r} height={Math.abs(Y(g2[0]) - Y(g2[1]))} fill="url(#hatch)" />}
      {yTicks.map((y) => (
        <g key={y}>
          <line x1={P.l} x2={W - P.r} y1={Y(y)} y2={Y(y)} stroke="var(--line)" />
          <text x={P.l - 10} y={Y(y) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{fmtTick(y, step)}</text>
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
      {guides.map((g) => (
        <g key={g.label}>
          <line x1={P.l} x2={W - P.r} y1={Y(g.v)} y2={Y(g.v)} stroke={g.strong ? 'var(--ink)' : 'var(--ink-3)'} strokeWidth={g.strong ? 1.5 : 1} strokeDasharray={g.strong ? undefined : '4 3'} />
          <text x={W - P.r + 8} y={Y(g.v) + 4} fontSize="11" fontWeight={g.strong ? 700 : 400} fill={g.strong ? 'var(--ink)' : 'var(--ink-3)'}>{g.label}</text>
        </g>
      ))}
      {pts.length > 1 && <polyline points={pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeLinejoin="round" />}
      {trend && projDays != null && strong && (
        <g>
          <line x1={X(last.x)} y1={Y(trend.nowValue + (trend.perWeek / 7) * last.x)} x2={X(projDays)} y2={Y(strong.v)} stroke="var(--ink)" strokeWidth={1.75} strokeDasharray="6 4" />
          <circle cx={X(projDays)} cy={Y(strong.v)} r={6} fill="var(--ink)" />
          <text x={X(projDays)} y={Y(strong.v) - 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">≈ {dateFar(now + projDays * DAY, now)}</text>
        </g>
      )}
      {pts.map((p, i) => (
        <g key={i}>
          <rect x={X(p.x) - 3} y={Y(p.y) - 3} width={6} height={6} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
          {pts.length <= 6 && <text x={X(p.x)} y={Y(p.y) - 9} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">{p.y.toFixed(digits)}</text>}
        </g>
      ))}
    </svg>
  );
}
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
const fmtTick = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2));

export function MiniChart({ points, floor, now }: { points: { at: string; v: number }[]; floor: number | null; now: number }) {
  if (points.length < 2) {
    return <div className="empty" style={{ padding: '22px 0' }}>{points.length === 1 ? 'One reading so far.' : 'No readings yet.'}</div>;
  }
  const pts = points.map((p) => ({ x: (ms(p.at) - now) / DAY, y: p.v }));
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

/** Earlier readings of one metric plus the one being entered. */
export function TrendWithNew({ values, next, limit, digits = 1 }: { values: number[]; next: number | null; limit: number | null; digits?: number }) {
  const vals = next != null ? [...values, next] : values;
  if (vals.length < 1) return <div className="mute" style={{ fontSize: 12 }}>No earlier readings.</div>;
  const W = 320, H = 70, P = 8;
  const all = limit != null ? [...vals, limit] : vals;
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.2; lo -= pad; hi += pad;
  const X = (i: number) => (vals.length === 1 ? W / 2 : P + (i / (vals.length - 1)) * (W - 2 * P));
  const Y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {limit != null && <line x1={P} x2={W - P} y1={Y(limit)} y2={Y(limit)} stroke="var(--ink)" />}
      <polyline points={vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} />
      {vals.map((v, i) => {
        const isNew = next != null && i === vals.length - 1;
        return isNew
          ? <g key={i}><rect x={X(i) - 5} y={Y(v) - 5} width={10} height={10} fill="var(--ink)" /><text x={X(i) - 10} y={Y(v) + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--ink)">{v.toFixed(digits)}</text></g>
          : <rect key={i} x={X(i) - 2.5} y={Y(v) - 2.5} width={5} height={5} fill="var(--ink-2)" />;
      })}
    </svg>
  );
}
