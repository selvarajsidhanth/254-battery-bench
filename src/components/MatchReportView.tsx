/* The post-match report, rendered the same way for a freshly analyzed log and
   for one saved to the match history. */
import type { MatchReport, Phase, ReportEvent } from '../lib/matchReport';
import { clock, fmt, mmss, shortDate } from '../lib/format';

const HOT_C = 80;
const WARM_C = 65;

/** "Auto 0:03", "Teleop 1:42", or "+2:10" between/after phases */
export function matchClock(t: number, phases: Phase[]) {
  const p = phases.find((x) => t >= x.start - 0.05 && t <= x.end + 0.05);
  if (p) return `${p.mode === 'auto' ? 'Auto' : p.mode === 'test' ? 'Test' : 'Teleop'} ${mmss(t - p.start)}`;
  return t < 0 ? `−${mmss(-t)}` : `+${mmss(t)}`;
}

interface Finding { level: 'bad' | 'warn' | 'ok'; text: string }

/** The handful of things worth saying out loud after a match. */
export function findings(r: MatchReport, capacityAh?: number | null): Finding[] {
  const out: Finding[] = [];
  const b = r.battery;
  if (!r.enabled) out.push({ level: 'warn', text: 'The robot was never enabled in this log.' });
  if (b.minV != null) {
    const lowTime = b.under10Sec > 0 ? ` and spent ${Math.round(b.under10Sec)} s of ${Math.round(r.enabledSec)} s under 10 V` : '';
    out.push({
      level: b.brownouts > 0 || b.minV < 7 ? 'bad' : b.minV < 9 ? 'warn' : 'ok',
      text: `Battery dropped to ${b.minV.toFixed(2)} V${b.brownouts ? ` with ${b.brownouts} brownout${b.brownouts > 1 ? 's' : ''}` : ''}${lowTime}.`,
    });
  }
  if (b.ah != null) {
    const pctUsed = capacityAh ? ` (${Math.round((b.ah / capacityAh) * 100)}% of this battery's ${capacityAh.toFixed(1)} Ah)` : '';
    out.push({ level: 'ok', text: `Motors drew ${b.ah.toFixed(2)} Ah${pctUsed}, averaging ${fmt(b.avgA, 0)} A with peaks of ${fmt(b.peakA, 0)} A.` });
  }
  const top = r.subsystems[0];
  if (top && top.share > 0.35) out.push({ level: 'ok', text: `${top.name} used ${Math.round(top.share * 100)}% of the motor power.` });
  if (b.loadShedSec > 0) out.push({ level: 'warn', text: `Load shedding was on for ${Math.round(b.loadShedSec)} s (${b.loadShedCount} times).` });
  const hot = r.temps.filter((m) => m.maxC >= WARM_C);
  if (hot.length) out.push({ level: hot.some((m) => m.maxC >= HOT_C) ? 'bad' : 'warn', text: `${hot.length} motor${hot.length > 1 ? 's' : ''} got hot: ${hot.slice(0, 3).map((m) => `${m.name} ${Math.round(m.maxC)} °C`).join(', ')}.` });
  else if (r.temps[0]) out.push({ level: 'ok', text: `Hottest motor: ${r.temps[0].name} at ${Math.round(r.temps[0].maxC)} °C.` });
  const disc = r.events.filter((e) => e.kind === 'disconnect' || e.kind === 'ds');
  if (disc.length) out.push({ level: 'bad', text: `${disc.length} disconnect${disc.length > 1 ? 's' : ''}: ${disc.slice(0, 2).map((e) => e.text).join('; ')}.` });
  if (r.drive.tips) out.push({ level: 'warn', text: `The code flagged the robot as tipping ${r.drive.tips} time${r.drive.tips > 1 ? 's' : ''}.` });
  const h = r.health;
  if (h.overrunPct != null && h.overrunPct >= 1) out.push({ level: 'warn', text: `${h.overrunPct}% of loops overran ${h.loopPeriodMs} ms (worst ${h.loopMaxMs} ms).` });
  return out;
}

export function MatchReportView({ r, capacityAh }: { r: MatchReport; capacityAh?: number | null }) {
  const b = r.battery;
  const f = findings(r, capacityAh);
  const auto = r.phases.find((p) => p.mode === 'auto');
  const tele = r.phases.filter((p) => p.mode === 'teleop').reduce((n, p) => n + p.end - p.start, 0);
  return (
    <>
      <section className="panel">
        <div className="ph"><h2>Summary</h2><span className="note">{r.fileName}</span></div>
        <div className="mr-meta">
          <Meta k="Match" v={r.match.label + (r.match.replay && r.match.replay > 1 ? ` (replay ${r.match.replay})` : '')} />
          <Meta k="When" v={r.logStart ? `${shortDate(r.logStart)} · ${clock(r.logStart)}` : '—'} />
          <Meta k="Station" v={`${r.match.station}${r.match.fms ? ' · FMS' : ''}`} />
          <Meta k="Enabled" v={r.enabled ? `${auto ? `${Math.round(auto.end - auto.start)} s auto · ` : ''}${Math.round(tele)} s teleop` : 'Never'} />
          <Meta k="Auto" v={r.robot.auto || '—'} wide />
          <Meta k="Code" v={r.robot.branch ? `${r.robot.branch} @ ${r.robot.sha}${r.robot.dirty ? ' (uncommitted changes)' : ''}` : '—'} wide />
        </div>
        <ul className="findings">
          {f.map((x, i) => <li key={i} className={x.level}><i />{x.text}</li>)}
        </ul>
      </section>

      <section className="panel">
        <div className="ph"><h2>Battery</h2><span className="note">{currentNote(b.currentSource)}</span></div>
        <div className="mr-specs">
          <Spec k="Resting before" v={fmt(b.restV, 2)} u="V" />
          <Spec k="Lowest" v={fmt(b.minV, 2)} u="V" flag={b.minV != null && b.minV < 7} />
          <Spec k="Average enabled" v={fmt(b.avgV, 2)} u="V" />
          <Spec k="Recovered after" v={fmt(b.endV, 2)} u="V" />
          <Spec k="Sag" v={fmt(b.sagV, 2)} u="V" />
          <Spec k="Under 10 V" v={fmt(b.under10Sec, 0)} u="s" />
          <Spec k="Under 8 V" v={fmt(b.under8Sec, 0)} u="s" flag={b.under8Sec > 0} />
          <Spec k="Brownouts" v={String(b.brownouts)} flag={b.brownouts > 0} />
          <Spec k="Used" v={fmt(b.ah, 2)} u="Ah" />
          <Spec k="Energy" v={fmt(b.wh, 1)} u="Wh" />
          <Spec k="Average draw" v={fmt(b.avgA, 0)} u="A" />
          <Spec k="Peak · best 1 s" v={b.peakA != null ? `${fmt(b.peakA, 0)} · ${fmt(b.peak1sA, 0)}` : '—'} u="A" />
          <Spec k="Effective resistance" v={fmt(b.systemRmOhm, 1)} u="mΩ" />
          <Spec k="Load shedding" v={b.loadShedSec ? fmt(b.loadShedSec, 0) : '0'} u="s" />
        </div>
        <TraceChart r={r} />
        <p className="mr-cap">Black line: battery voltage (lowest in each slice). Grey: summed motor current. Dashed: 10 V. Ticks on the axis mark brownouts. Effective resistance is how hard the voltage sags per amp on this robot: use it to compare batteries match to match. It includes wiring and the main breaker, so it isn't the same number as the CBA R_int.</p>
      </section>

      <div className="two even">
        <section className="panel">
          <div className="ph"><h2>Where the power went</h2><span className="note">Share of motor amp-hours</span></div>
          {r.subsystems.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Subsystem</th><th>Share</th><th className="r">Ah</th><th className="r">Avg A</th><th className="r">Peak A</th></tr></thead>
              <tbody>
                {r.subsystems.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name} <span className="mute">· {s.motors}</span></td>
                    <td><span className="share"><i style={{ width: `${Math.max(1, s.share * 100)}%` }} /></span> <span className="mute">{Math.round(s.share * 100)}%</span></td>
                    <td className="r">{s.ah.toFixed(2)}</td><td className="r">{fmt(s.avgA, 0)}</td><td className="r">{fmt(s.peakA, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No motor current in this log.</div>}
        </section>
        <section className="panel">
          <div className="ph"><h2>Motor temperatures</h2><span className="note">Warm ≥ {WARM_C} °C · hot ≥ {HOT_C} °C</span></div>
          {r.temps.length ? (
            <div className="tablewrap mr-scroll"><table>
              <thead><tr><th>Motor</th><th>Max</th><th className="r">End</th></tr></thead>
              <tbody>
                {r.temps.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name}{m.maxC >= HOT_C ? <span className="inv-tag" style={{ marginLeft: 6 }}>Hot</span> : m.maxC >= WARM_C ? <span className="out-tag" style={{ marginLeft: 6 }}>Warm</span> : null}</td>
                    <td><span className="share temp"><i style={{ width: `${Math.min(100, (m.maxC / 100) * 100)}%` }} /><b style={{ left: `${WARM_C}%` }} /><b style={{ left: `${HOT_C}%` }} /></span> {m.maxC.toFixed(0)} °C</td>
                    <td className="r mute">{m.endC.toFixed(0)} °C</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No motor temperatures in this log.</div>}
        </section>
      </div>

      <div className="two even">
        <section className="panel">
          <div className="ph"><h2>Timeline</h2><span className="note">{r.events.length} events</span></div>
          {r.events.length ? (
            <ol className="tl">
              {r.events.map((e, i) => <EventRow key={i} e={e} phases={r.phases} />)}
            </ol>
          ) : <div className="empty">Nothing notable happened.</div>}
        </section>
        <section className="panel">
          <div className="ph"><h2>Robot and code</h2><span className="note">While enabled</span></div>
          <dl className="kv">
            <KV k="Loop time" v={r.health.loopMedianMs != null ? `${r.health.loopMedianMs} ms median · ${r.health.loopP99Ms} ms p99 · ${r.health.loopMaxMs} ms worst` : '—'} />
            <KV k="Loop overruns" v={r.health.loopPeriodMs ? `${r.health.overruns} over ${r.health.loopPeriodMs} ms (${r.health.overrunPct ?? 0}%)` : '—'} />
            <KV k="Console warnings" v={`${r.health.consoleOverruns} loop overrun, ${r.health.watchdog} watchdog`} />
            <KV k="CPU" v={r.health.cpuMaxPct != null ? `${r.health.cpuMaxPct}% peak${r.health.cpuMaxC != null ? ` · ${r.health.cpuMaxC} °C` : ''}` : '—'} />
            <KV k="Memory" v={r.health.memMaxPct != null ? `${r.health.memMaxPct}% peak` : '—'} />
            <KV k="CAN bus" v={r.health.canMaxPct != null ? `${r.health.canMaxPct}% peak` : 'Not logged'} />
            <KV k="Garbage collection" v={r.health.gcMs != null ? `${r.health.gcMs} ms total` : '—'} />
            <KV k="Distance driven" v={r.drive.distanceM != null ? `${r.drive.distanceM} m` : '—'} />
            <KV k="Top speed" v={r.drive.topSpeedMps != null ? `${r.drive.topSpeedMps} m/s` : '—'} />
            <KV k="Project" v={r.robot.project ? `${r.robot.project}${r.robot.built ? ` · built ${r.robot.built}` : ''}` : '—'} />
          </dl>
        </section>
      </div>
    </>
  );
}

function currentNote(src: MatchReport['battery']['currentSource']) {
  if (src === 'pdh') return 'Current from the power distribution hub';
  if (src === 'motor-supply') return 'Current = sum of logged motor supply currents (radio, controllers and sensors not included)';
  if (src === 'motor-other') return 'Current from motor current signals (may be stator current, read with care)';
  return 'No current signals in this log';
}

function Meta({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return <div className={`mr-m${wide ? ' wide' : ''}`}><div className="k-lab">{k}</div><div className="v" title={v}>{v}</div></div>;
}
function Spec({ k, v, u, flag }: { k: string; v: string; u?: string; flag?: boolean }) {
  return <div className={`spec${flag ? ' flag' : ''}`}><div className="k-lab">{k}</div><div className="v">{v}{u && v !== '—' && <small className="u">{u}</small>}</div></div>;
}
function KV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
function EventRow({ e, phases }: { e: ReportEvent; phases: Phase[] }) {
  return (
    <li className={`tl-${e.level}`}>
      <span className="tl-t">{matchClock(e.t, phases)}</span>
      <span className="tl-k">{KIND[e.kind]}</span>
      <span className="tl-x">{e.text}</span>
    </li>
  );
}
const KIND: Record<ReportEvent['kind'], string> = {
  brownout: 'Brownout', loadshed: 'Load shed', tip: 'Tip', disconnect: 'Disconnect', ds: 'Comms', alert: 'Alert', console: 'Console', mode: 'Mode',
};

/** Voltage (line) and current (area) over match time, with auto/teleop bands. */
export function TraceChart({ r, compact }: { r: MatchReport; compact?: boolean }) {
  const { t, v, i } = r.trace;
  if (t.length < 2) return <div className="empty">No battery voltage in this log.</div>;
  const W = 1000, H = compact ? 150 : 270, P = { l: 44, r: 50, t: 16, b: 28 };
  const x0 = t[0], x1 = t[t.length - 1];
  const vLo = Math.min(6, Math.floor(Math.min(...v)) - 0.5), vHi = 13.5;
  const iHi = Math.max(50, Math.ceil(Math.max(...i) / 50) * 50);
  const X = (x: number) => P.l + ((x - x0) / (x1 - x0)) * (W - P.l - P.r);
  const YV = (y: number) => P.t + (1 - (y - vLo) / (vHi - vLo)) * (H - P.t - P.b);
  const YI = (y: number) => P.t + (1 - y / iHi) * (H - P.t - P.b);
  const vt: number[] = [];
  for (let y = Math.ceil(vLo); y <= vHi; y += vHi - vLo > 6 ? 2 : 1) vt.push(y);
  const xt: number[] = [];
  const step = x1 - x0 > 200 ? 30 : 15;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) xt.push(x);
  const area = `M${X(t[0])},${YI(0)} ` + t.map((x, k) => `L${X(x).toFixed(1)},${YI(i[k]).toFixed(1)}`).join(' ') + ` L${X(t[t.length - 1])},${YI(0)} Z`;
  const line = t.map((x, k) => `${X(x).toFixed(1)},${YV(v[k]).toFixed(1)}`).join(' ');
  const browns = r.events.filter((e) => e.kind === 'brownout');
  return (
    <svg className="chart mr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Battery voltage and current over the match">
      <defs>
        <pattern id="mr-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="2" /></pattern>
      </defs>
      {r.phases.map((p, k) => (
        <g key={k}>
          <rect x={X(p.start)} y={P.t} width={Math.max(0, X(p.end) - X(p.start))} height={H - P.t - P.b} fill={p.mode === 'auto' ? 'url(#mr-hatch)' : 'var(--surface-2)'} />
          {!compact && <text x={X(p.start) + 4} y={P.t + 11} className="ax" style={{ textTransform: 'uppercase' }}>{p.mode}</text>}
        </g>
      ))}
      {vt.map((y) => <g key={y}><line x1={P.l} x2={W - P.r} y1={YV(y)} y2={YV(y)} stroke="var(--line)" /><text x={P.l - 6} y={YV(y) + 4} textAnchor="end" className="ax">{y} V</text></g>)}
      {[0, iHi / 2, iHi].map((y) => <text key={y} x={W - P.r + 6} y={YI(y) + 4} className="ax">{y} A</text>)}
      {xt.map((x) => <text key={x} x={X(x)} y={H - 8} textAnchor="middle" className="ax">{x < 0 ? '−' : ''}{mmss(Math.abs(x))}</text>)}
      <path d={area} fill="var(--ink-3)" opacity={0.35} />
      <line x1={P.l} x2={W - P.r} y1={YV(10)} y2={YV(10)} stroke="var(--ink)" strokeDasharray="5 4" />
      <polyline points={line} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinejoin="round" />
      {browns.map((e, k) => <line key={k} x1={X(e.t)} x2={X(e.t)} y1={H - P.b} y2={H - P.b + 8} stroke="var(--ink)" strokeWidth={3} />)}
      <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--ink)" />
    </svg>
  );
}
