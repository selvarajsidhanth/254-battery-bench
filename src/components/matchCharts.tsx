/* Charts for match-log trends and comparisons, in the datasheet's black-and-white
   line language. Logs being compared are told apart by line pattern + a letter tag,
   never by color alone. */
import { useRef, useState, type MouseEvent } from 'react';
import { sampleAt } from './MatchReportView';

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
function ticks(lo: number, hi: number, count = 4) {
  const step = niceStep((hi - lo) / count);
  const out: number[] = [];
  for (let y = Math.ceil(lo / step) * step; y <= hi + 1e-9; y += step) out.push(+y.toFixed(6));
  return { out, step };
}
const tickText = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2));

/** Where the mouse is, in viewBox units. */
function svgX(e: MouseEvent<SVGElement>, svg: SVGSVGElement | null, W: number) {
  const box = svg?.getBoundingClientRect();
  return box ? ((e.clientX - box.left) / box.width) * W : 0;
}

/* ---------------- trends: one value per match, over many matches ---------------- */

export interface SeriesPoint { id: string; x: number; v: number; hl: boolean; tip: string[] }
export interface SeriesBand { from: number; to: number; label: string }
export interface SeriesGuide { v: number; label: string; strong?: boolean }

export function SeriesChart({ points, n, bands, guides = [], digits = 1, unit, bars, dimOthers, onPick }: {
  points: SeriesPoint[];
  n: number; // slots on the x axis (one per match)
  bands: SeriesBand[];
  guides?: SeriesGuide[];
  digits?: number;
  unit: string;
  bars?: boolean;
  /** a battery is highlighted: fade the rest and join its points */
  dimOthers?: boolean;
  onPick?: (id: string) => void;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!points.length) return <div className="empty">Not in these logs.</div>;
  const W = 600, H = 220, P = { l: 42, r: 14, t: 24, b: 12 };
  const vs = points.map((p) => p.v).concat(guides.map((g) => g.v));
  let lo = bars ? 0 : Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  if (!bars) lo -= pad;
  hi += pad;
  const slot = (W - P.l - P.r) / Math.max(1, n);
  const X = (x: number) => P.l + (x + 0.5) * slot;
  const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const yt = ticks(lo, hi);
  const at = new Map(points.map((p) => [p.x, p]));
  const hp = hov != null ? at.get(hov) : undefined;
  const lineOf = (pts: SeriesPoint[]) => pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');

  return (
    <div className="mc-wrap">
      <svg ref={ref} className="chart mc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unit} per match`}
        onMouseMove={(e) => { const i = Math.floor((svgX(e, ref.current, W) - P.l) / slot); setHov(i >= 0 && i < n ? i : null); }}
        onMouseLeave={() => setHov(null)}
        onClick={() => { if (hp && onPick) onPick(hp.id); }}
        style={{ cursor: hp && onPick ? 'pointer' : undefined }}>
        {bands.map((b, k) => {
          const x = P.l + b.from * slot, w = (b.to - b.from + 1) * slot;
          return (
            <g key={k}>
              {k % 2 === 1 && <rect x={x} y={P.t - 18} width={w} height={H - P.t - P.b + 18} fill="var(--surface-2)" />}
              {k > 0 && <line x1={x} x2={x} y1={P.t - 18} y2={H - P.b} stroke="var(--line-2)" strokeDasharray="2 3" />}
              {w > 40 && <text x={x + 5} y={P.t - 6} fontSize="10" fill="var(--ink-3)" className="mc-band">{fit(b.label, (w - 10) / 7.4)}</text>}
            </g>
          );
        })}
        {yt.out.map((y) => (
          <g key={y}>
            <line x1={P.l} x2={W - P.r} y1={Y(y)} y2={Y(y)} stroke="var(--line)" />
            <text x={P.l - 7} y={Y(y) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)">{tickText(y, yt.step)}</text>
          </g>
        ))}
        {guides.map((g) => (
          <g key={g.label}>
            <line x1={P.l} x2={W - P.r} y1={Y(g.v)} y2={Y(g.v)} stroke={g.strong ? 'var(--ink)' : 'var(--ink-3)'} strokeWidth={g.strong ? 1.4 : 1} strokeDasharray={g.strong ? undefined : '4 3'} />
            <text x={W - P.r - 3} y={Y(g.v) - 4} textAnchor="end" fontSize="10" fill={g.strong ? 'var(--ink)' : 'var(--ink-3)'} fontWeight={g.strong ? 700 : 400}>{g.label}</text>
          </g>
        ))}
        {hov != null && <rect x={P.l + hov * slot} y={P.t} width={slot} height={H - P.t - P.b} fill="var(--ink)" opacity={0.06} />}
        {bars
          ? points.map((p) => (
            <rect key={p.id} x={X(p.x) - Math.min(9, slot * 0.32)} width={Math.min(18, slot * 0.64)} y={Y(p.v)} height={Math.max(p.v > 0 ? 1.5 : 0, Y(0) - Y(p.v))}
              fill={dimOthers && !p.hl ? 'var(--line-2)' : 'var(--ink)'} />
          ))
          : <>
            {bands.map((b, k) => {
              const pts = points.filter((p) => p.x >= b.from && p.x <= b.to);
              return pts.length > 1 ? <polyline key={k} points={lineOf(pts)} fill="none" stroke={dimOthers ? 'var(--line-2)' : 'var(--ink-2)'} strokeWidth={1.2} strokeLinejoin="round" /> : null;
            })}
            {dimOthers && <polyline points={lineOf(points.filter((p) => p.hl))} fill="none" stroke="var(--ink)" strokeWidth={1.8} strokeDasharray="5 3" />}
            {points.map((p) => p.hl || !dimOthers
              ? <rect key={p.id} x={X(p.x) - 3} y={Y(p.v) - 3} width={6} height={6} fill={dimOthers ? 'var(--ink)' : 'var(--surface)'} stroke="var(--ink)" strokeWidth={1.5} />
              : <rect key={p.id} x={X(p.x) - 2} y={Y(p.v) - 2} width={4} height={4} fill="var(--line-2)" />)}
          </>}
        {hp && !bars && <rect x={X(hp.x) - 5} y={Y(hp.v) - 5} width={10} height={10} fill="var(--ink)" />}
      </svg>
      {hp && (
        <div className="mc-tip" style={{ left: `${(X(hp.x) / W) * 100}%`, transform: `translateX(${X(hp.x) > W * 0.6 ? 'calc(-100% - 10px)' : '10px'})` }}>
          <b>{hp.v.toFixed(digits)} {unit}</b>
          {hp.tip.map((t, k) => <span key={k}>{t}</span>)}
          {onPick && <em>Click to open</em>}
        </div>
      )}
    </div>
  );
}
const fit = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, Math.max(3, Math.floor(chars) - 1))}…` : s);

/* ---------------- compare: whole-match traces laid over each other ---------------- */

export const SERIES_STYLE = [
  { stroke: 'var(--ink)', dash: undefined, w: 2 },
  { stroke: 'var(--ink)', dash: '7 4', w: 1.7 },
  { stroke: 'var(--ink-2)', dash: '1.5 3', w: 2.2 },
  { stroke: 'var(--ink-3)', dash: '12 3 2 3', w: 1.8 },
];
export const TAGS = ['A', 'B', 'C', 'D'];

export function Swatch({ k }: { k: number }) {
  const s = SERIES_STYLE[k];
  return <svg className="mc-sw" viewBox="0 0 30 10" aria-hidden><line x1="1" x2="29" y1="5" y2="5" stroke={s.stroke} strokeWidth={s.w + 0.3} strokeDasharray={s.dash} /></svg>;
}

/** `end` = when the robot was last enabled (s); `auto` = the auto period, if the log had one */
export interface OverlaySeries { k: number; t: number[]; y: number[]; end?: number | null; auto?: [number, number] | null }

export function OverlayChart({ series, unit, digits = 1, zero, guides = [] }: {
  series: OverlaySeries[];
  unit: string;
  digits?: number;
  /** start the y axis at 0 */
  zero?: boolean;
  guides?: SeriesGuide[];
}) {
  const [hov, setHov] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const live = series.filter((s) => s.t.length > 1);
  if (!live.length) return <div className="empty">None of these logs have this trace.</div>;
  const W = 1000, H = 250, P = { l: 46, r: 30, t: 14, b: 28 };
  const x0 = Math.max(-5, Math.min(...live.map((s) => s.t[0])));
  // through the last enable of the longest log, plus the recovery after it
  const ends = live.map((s) => (s.end != null ? Math.min(s.t[s.t.length - 1], s.end + 10) : s.t[s.t.length - 1]));
  const x1 = Math.max(...ends);
  const autos = live.map((s) => s.auto).filter((a): a is [number, number] => !!a);
  const auto = autos.length ? [Math.min(...autos.map((a) => a[0])), Math.max(...autos.map((a) => a[1]))] : null;
  const inRange = (s: OverlaySeries) => s.y.filter((_, k) => s.t[k] >= x0 && s.t[k] <= x1);
  const all = live.flatMap(inRange).concat(guides.map((g) => g.v));
  let lo = zero ? 0 : Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.08;
  if (!zero) lo -= pad;
  hi += pad;
  const X = (x: number) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const yt = ticks(lo, hi, 5);
  const xt: number[] = [];
  const xs = x1 - x0 > 420 ? 60 : x1 - x0 > 200 ? 30 : 15;
  for (let x = Math.ceil(x0 / xs) * xs; x <= x1; x += xs) xt.push(x);
  const path = (s: OverlaySeries) => {
    let d = '';
    s.t.forEach((x, k) => { if (x < x0 || x > x1) return; d += `${d ? 'L' : 'M'}${X(x).toFixed(1)},${Y(s.y[k]).toFixed(1)}`; });
    return d;
  };
  const vals = hov != null ? live.map((s) => ({ k: s.k, v: s.t[0] <= hov && s.t[s.t.length - 1] >= hov ? s.y[sampleAt(s.t, hov)] : null })) : [];

  return (
    <div className="mc-wrap">
      <svg ref={ref} className="chart mc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unit} over the match`}
        onMouseMove={(e) => { const x = svgX(e, ref.current, W); setHov(x < P.l || x > W - P.r ? null : x0 + ((x - P.l) / (W - P.l - P.r)) * (x1 - x0)); }}
        onMouseLeave={() => setHov(null)}>
        {auto && <>
          <rect x={X(auto[0])} y={P.t} width={Math.max(0, X(auto[1]) - X(auto[0]))} height={H - P.t - P.b} fill="var(--surface-2)" />
          <text x={X(auto[0]) + 5} y={P.t + 12} fontSize="10" fill="var(--ink-3)" letterSpacing=".08em">AUTO</text>
        </>}
        {yt.out.map((y) => (
          <g key={y}>
            <line x1={P.l} x2={W - P.r} y1={Y(y)} y2={Y(y)} stroke="var(--line)" />
            <text x={P.l - 8} y={Y(y) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{tickText(y, yt.step)}</text>
          </g>
        ))}
        {xt.map((x) => (
          <g key={x}>
            <line x1={X(x)} x2={X(x)} y1={H - P.b} y2={H - P.b + 5} stroke="var(--ink-3)" />
            <text x={X(x)} y={H - P.b + 18} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{x < 0 ? `${x}s` : `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`}</text>
          </g>
        ))}
        {guides.map((g) => (
          <g key={g.label}>
            <line x1={P.l} x2={W - P.r} y1={Y(g.v)} y2={Y(g.v)} stroke="var(--ink-3)" strokeDasharray="4 3" />
            <text x={W - P.r - 4} y={Y(g.v) - 5} textAnchor="end" fontSize="10.5" fill="var(--ink-3)">{g.label}</text>
          </g>
        ))}
        {live.map((s) => {
          const st = SERIES_STYLE[s.k];
          return <path key={s.k} d={path(s)} fill="none" stroke={st.stroke} strokeWidth={st.w} strokeDasharray={st.dash} strokeLinejoin="round" />;
        })}
        {endTags(live, x1, X, Y, P.t + 8, H - P.b - 8).map(({ k, x, y }) => {
          return (
            <g key={`t${k}`}>
              <rect x={x + 3} y={y - 8} width={16} height={16} fill="var(--surface)" stroke="var(--ink)" />
              <text x={x + 11} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">{TAGS[k]}</text>
            </g>
          );
        })}
        {hov != null && <line x1={X(hov)} x2={X(hov)} y1={P.t} y2={H - P.b} stroke="var(--ink)" strokeWidth={1} />}
      </svg>
      {hov != null && (
        <div className="mc-tip" style={{ left: `${(X(hov) / W) * 100}%`, transform: `translateX(${X(hov) > W * 0.7 ? 'calc(-100% - 10px)' : '10px'})` }}>
          <em>{hov < 0 ? `${hov.toFixed(1)} s before enable` : `${Math.floor(hov / 60)}:${(hov % 60).toFixed(1).padStart(4, '0')} into the match`}</em>
          {vals.map((x) => <span key={x.k} className="mc-row"><Swatch k={x.k} /><b>{TAGS[x.k]}</b>{x.v != null ? `${x.v.toFixed(digits)} ${unit}` : '—'}</span>)}
        </div>
      )}
    </div>
  );
}

/** Letter tags at the end of each line, pushed apart so they never overlap. */
function endTags(live: OverlaySeries[], x1: number, X: (x: number) => number, Y: (v: number) => number, top: number, bot: number) {
  const tags = live.map((s) => {
    let k = s.t.length - 1;
    while (k > 0 && s.t[k] > x1) k--;
    return { k: s.k, x: X(s.t[k]), y: Y(s.y[k]) };
  }).sort((a, b) => a.y - b.y);
  const gap = 18;
  tags.forEach((t, i) => { t.y = Math.max(top, i ? Math.max(t.y, tags[i - 1].y + gap) : t.y); });
  // if they ran off the bottom, push the stack back up
  const over = tags.length ? tags[tags.length - 1].y - bot : 0;
  if (over > 0) tags.forEach((t) => { t.y -= over; });
  return tags;
}
