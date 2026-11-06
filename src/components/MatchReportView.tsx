/* The post-match report, rendered the same way for a freshly analyzed log and
   for one saved to the match history.

   When a report opens, the panels settle in, the numbers count up and the
   chart plots itself left to right. Every battery number is a button: click it
   and the chart shows where that number came from (the dip, the stretches under
   10 V, the running amp-hour total, …). Timeline rows do the same for events. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { pairs, type BatteryMarks, type MatchReport, type Phase, type ReportEvent, type Span } from '../lib/matchReport';
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

/* ---------- tracing a number on the chart ---------- */

type StatKey = 'before' | 'min' | 'avgV' | 'after' | 'sag' | 'under10' | 'under8' | 'brownouts' | 'ah' | 'wh' | 'avgA' | 'peak' | 'resistance' | 'loadshed';
/** a battery number, or `ev3` for the fourth timeline event */
export type Focus = StatKey | `ev${number}`;

const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Older saved reports have no marks: rebuild rough ones from the chart trace. */
function marksOf(r: MatchReport): BatteryMarks {
  if (r.battery.marks) return r.battery.marks;
  const { t, v, i } = r.trace;
  const on = (x: number) => r.phases.some((p) => x >= p.start && x < p.end);
  let minT: number | null = null, peakT: number | null = null, lo = Infinity, hi = -1;
  t.forEach((x, k) => {
    if (!on(x)) return;
    if (v[k] < lo) { lo = v[k]; minT = x; }
    if (i[k] > hi) { hi = i[k]; peakT = x; }
  });
  const below = (lim: number) => {
    const out: number[] = [];
    let a: number | null = null;
    t.forEach((x, k) => {
      const inside = on(x) && v[k] < lim;
      if (inside && a == null) a = x;
      if (!inside && a != null) { out.push(a, x); a = null; }
    });
    if (a != null) out.push(a, t[t.length - 1]);
    return out;
  };
  const at = (kind: ReportEvent['kind'], w: number) => r.events.filter((e) => e.kind === kind).flatMap((e) => [e.t, e.t + w]);
  return { minT, peakT, peak1sT: peakT, under10: below(10), under8: below(8), brownouts: at('brownout', 0.1), loadShed: at('loadshed', 1) };
}

/** Running amp-hour or watt-hour total at each trace point. */
export function running(r: MatchReport, key: 'ah' | 'wh'): number[] {
  const tr = r.trace;
  const have = tr[key];
  if (have && have.length === tr.t.length) return have;
  // older reports: integrate the trace, then scale to the exact total
  const on = (x: number) => r.phases.some((p) => x >= p.start && x < p.end);
  const out: number[] = [];
  let acc = 0;
  tr.t.forEach((x, k) => {
    if (k && on(x)) acc += ((key === 'ah' ? tr.i[k] : tr.i[k] * tr.v[k]) * (x - tr.t[k - 1])) / 3600;
    out.push(acc);
  });
  const total = key === 'ah' ? r.battery.ah : r.battery.wh;
  return total && acc > 0 ? out.map((x) => (x * total) / acc) : out;
}

const sum = (xs: Span[]) => xs.reduce((n, [a, b]) => n + b - a, 0);

/** What the highlighted thing is, in plain words, under the chart. */
function explain(f: Focus, r: MatchReport, m: BatteryMarks): { title: string; text: string } {
  const b = r.battery;
  const when = (t: number | null) => (t == null ? '' : ` at ${matchClock(t, r.phases)}`);
  if (f.startsWith('ev')) {
    const e = r.events[Number(f.slice(2))];
    return e ? { title: `${KIND[e.kind]} · ${matchClock(e.t, r.phases)}`, text: e.text } : { title: 'Event', text: '' };
  }
  switch (f as StatKey) {
    case 'before': return { title: `Before enable · ${fmt(b.restV, 2)} V`, text: 'The battery while the robot sat disabled in the 5 s before the match. With almost no current flowing, this is close to the battery’s open-circuit voltage: its starting point.' };
    case 'min': return { title: `Lowest · ${fmt(b.minV, 2)} V${when(m.minT)}`, text: 'The bottom of the deepest dip. Dips line up with current spikes: the harder the motors pull, the further the voltage drops.' };
    case 'avgV': return { title: `Average enabled · ${fmt(b.avgV, 2)} V`, text: 'The voltage averaged over every moment the robot was enabled. Comparing it with the starting voltage shows how much the robot lived under load.' };
    case 'after': return { title: `Recovered after · ${fmt(b.endV, 2)} V`, text: 'Measured 3–15 s after the robot was disabled. Once the load stops the voltage bounces back; how high it recovers hints at how much charge is left.' };
    case 'sag': return { title: `Sag · ${fmt(b.sagV, 2)} V`, text: `Starting voltage minus the lowest point (${fmt(b.restV, 2)} − ${fmt(b.minV, 2)}). The bracket shows the drop.` };
    case 'under10': { const s = pairs(m.under10); return { title: `Under 10 V · ${fmt(b.under10Sec, 0)} s`, text: `Shaded: ${s.length} stretch${s.length === 1 ? '' : 'es'} below 10 V. Down here motors are noticeably weaker, and the controller is getting close to browning out.` }; }
    case 'under8': { const s = pairs(m.under8); return { title: `Under 8 V · ${fmt(b.under8Sec, 0)} s`, text: s.length ? `Shaded: ${s.length} stretch${s.length === 1 ? '' : 'es'} below 8 V. This is brownout territory.` : 'The battery never went below 8 V.' }; }
    case 'brownouts': return { title: `Brownouts · ${b.brownouts}`, text: b.brownouts ? 'Each line is a brownout: the voltage fell so low that the controller cut motor output to protect itself, so the robot went limp for a moment.' : 'No brownouts this match.' };
    case 'ah': return { title: `Used · ${fmt(b.ah, 2)} Ah`, text: 'The line is a running total of the charge taken out of the battery. Steep parts are hard driving; flat parts are the robot sitting still.' };
    case 'wh': return { title: `Energy · ${fmt(b.wh, 1)} Wh`, text: 'Running total of energy (volts × amps over time). It climbs like amp-hours but counts each amp a little less when the voltage is low.' };
    case 'avgA': return { title: `Average draw · ${fmt(b.avgA, 0)} A`, text: 'The dashed line is the average current while enabled. The grey area above and below it shows how spiky the draw really was.' };
    case 'peak': return { title: `Peak · ${fmt(b.peakA, 0)} A${when(m.peakT)}`, text: `The dot is the highest instant current. The dark band is the hardest one-second stretch, averaging ${fmt(b.peak1sA, 0)} A: peaks that short are mostly motors starting up or pushing.` };
    case 'resistance': return { title: `Effective resistance · ${fmt(b.systemRmOhm, 1)} mΩ`, text: `Dotted line: what the battery would read with no load as it slowly drains. Dashed line: that minus ${fmt(b.systemRmOhm, 1)} mΩ × the current. If the dashed line follows the real one closely, this one number explains the sag.` };
    case 'loadshed': return { title: `Load shedding · ${fmt(b.loadShedSec, 0)} s`, text: sum(pairs(m.loadShed)) ? 'Shaded: when the robot code’s load shedding was on, cutting power to some mechanisms to hold the voltage up.' : 'Load shedding never turned on.' };
  }
}

/* ---------- the report ---------- */

/** Counts up from 0 the first time it shows, like an instrument settling. */
function Num({ v, d = 0, delay = 0 }: { v: number | null | undefined; d?: number; delay?: number }) {
  const [x, setX] = useState<number | null>(() => (v == null || reduceMotion() ? v ?? null : 0));
  useEffect(() => {
    if (v == null || reduceMotion()) { setX(v ?? null); return; }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / 900));
      setX(v * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v, delay]);
  return <>{fmt(x, d)}</>;
}

export function MatchReportView({ r, capacityAh }: { r: MatchReport; capacityAh?: number | null }) {
  const b = r.battery;
  const f = findings(r, capacityAh);
  const auto = r.phases.find((p) => p.mode === 'auto');
  const tele = r.phases.filter((p) => p.mode === 'teleop').reduce((n, p) => n + p.end - p.start, 0);
  const [focus, setFocus] = useState<Focus | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const hasChart = r.trace.t.length >= 2;
  const m = useMemo(() => marksOf(r), [r]);

  const pick = (k: Focus, scroll = false) => {
    setFocus((cur) => (cur === k ? null : k));
    const el = chartRef.current;
    if (scroll && el) {
      // bring the chart into view only when most of it is off screen
      const rc = el.getBoundingClientRect();
      const seen = Math.min(rc.bottom, window.innerHeight) - Math.max(rc.top, 0);
      if (seen < rc.height * 0.6) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    }
  };

  const specs: { id: StatKey; k: string; v: number | null; d?: number; u?: string; flag?: boolean; body?: ReactNode }[] = [
    { id: 'before', k: 'Before enable', v: b.restV, d: 2, u: 'V' },
    { id: 'min', k: 'Lowest', v: b.minV, d: 2, u: 'V', flag: b.minV != null && b.minV < 7 },
    { id: 'avgV', k: 'Average enabled', v: b.avgV, d: 2, u: 'V' },
    { id: 'after', k: 'Recovered after', v: b.endV, d: 2, u: 'V' },
    { id: 'sag', k: 'Sag', v: b.sagV, d: 2, u: 'V' },
    { id: 'under10', k: 'Under 10 V', v: b.under10Sec, u: 's' },
    { id: 'under8', k: 'Under 8 V', v: b.under8Sec, u: 's', flag: b.under8Sec > 0 },
    { id: 'brownouts', k: 'Brownouts', v: b.brownouts, flag: b.brownouts > 0 },
    { id: 'ah', k: 'Used', v: b.ah, d: 2, u: 'Ah' },
    { id: 'wh', k: 'Energy', v: b.wh, d: 1, u: 'Wh' },
    { id: 'avgA', k: 'Average draw', v: b.avgA, u: 'A' },
    { id: 'peak', k: 'Peak · best 1 s', v: b.peakA, u: 'A' },
    { id: 'resistance', k: 'Effective resistance', v: b.systemRmOhm, d: 1, u: 'mΩ' },
    { id: 'loadshed', k: 'Load shedding', v: b.loadShedSec, u: 's' },
  ];
  const ex = focus ? explain(focus, r, m) : null;

  return (
    <div className="mr-anim">
      <section className="panel" style={{ ['--i' as string]: 0 }}>
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
          {f.map((x, i) => <li key={i} className={x.level} style={{ ['--i' as string]: i }}><i />{x.text}</li>)}
        </ul>
      </section>

      <section className="panel" style={{ ['--i' as string]: 1 }}>
        <div className="ph"><h2>Battery</h2><span className="note">{currentNote(b.currentSource)}</span></div>
        <div className="mr-specs">
          {specs.map((s, i) => {
            const on = focus === s.id;
            const can = hasChart && s.v != null;
            return (
              <button key={s.id} type="button" className={`spec pick${s.flag ? ' flag' : ''}${on ? ' on' : ''}`} disabled={!can}
                aria-pressed={on} title={can ? (on ? 'Hide from the graph' : 'Show on the graph') : undefined} onClick={() => pick(s.id, true)}>
                <div className="k-lab">{s.k}</div>
                <div className="v">
                  {s.id === 'peak' && b.peakA != null
                    ? <><Num v={b.peakA} delay={250 + i * 45} /> · <Num v={b.peak1sA} delay={250 + i * 45} /></>
                    : <Num v={s.v} d={s.d} delay={250 + i * 45} />}
                  {s.u && s.v != null && <small className="u">{s.u}</small>}
                </div>
              </button>
            );
          })}
        </div>
        <div ref={chartRef}><TraceChart r={r} focus={focus} marks={m} /></div>
        {ex ? (
          <div className="mr-focus" key={focus}>
            <div><b>{ex.title}</b><span>{ex.text}</span></div>
            <button className="btn sm" onClick={() => setFocus(null)}>Clear</button>
          </div>
        ) : (
          <p className="mr-cap">
            <b className="mr-hint">Click any number above, or a row in the timeline, to trace it on the graph. Hover the graph to read exact values.</b>{' '}
            Black line: battery voltage (lowest in each slice). Grey: summed motor current. Dashed: 10 V. Ticks on the axis mark brownouts. Effective resistance is how hard the voltage sags per amp on this robot: use it to compare batteries match to match. It includes wiring and the main breaker, so it isn’t the same number as the CBA R_int.
          </p>
        )}
      </section>

      <div className="two even">
        <section className="panel" style={{ ['--i' as string]: 2 }}>
          <div className="ph"><h2>Where the power went</h2><span className="note">Share of motor amp-hours</span></div>
          {r.subsystems.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Subsystem</th><th>Share</th><th className="r">Ah</th><th className="r">Avg A</th><th className="r">Peak A</th></tr></thead>
              <tbody>
                {r.subsystems.map((s, i) => (
                  <tr key={s.name}>
                    <td>{s.name} <span className="mute">· {s.motors}</span></td>
                    <td><span className="share"><i style={{ width: `${Math.max(1, s.share * 100)}%`, ['--i' as string]: i }} /></span> <span className="mute">{Math.round(s.share * 100)}%</span></td>
                    <td className="r">{s.ah.toFixed(2)}</td><td className="r">{fmt(s.avgA, 0)}</td><td className="r">{fmt(s.peakA, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No motor current in this log.</div>}
        </section>
        <section className="panel" style={{ ['--i' as string]: 3 }}>
          <div className="ph"><h2>Motor temperatures</h2><span className="note">Warm ≥ {WARM_C} °C · hot ≥ {HOT_C} °C</span></div>
          {r.temps.length ? (
            <div className="tablewrap mr-scroll"><table>
              <thead><tr><th>Motor</th><th>Max</th><th className="r">End</th></tr></thead>
              <tbody>
                {r.temps.map((t, i) => (
                  <tr key={t.name}>
                    <td>{t.name}{t.maxC >= HOT_C ? <span className="inv-tag" style={{ marginLeft: 6 }}>Hot</span> : t.maxC >= WARM_C ? <span className="out-tag" style={{ marginLeft: 6 }}>Warm</span> : null}</td>
                    <td><span className="share temp"><i style={{ width: `${Math.min(100, (t.maxC / 100) * 100)}%`, ['--i' as string]: Math.min(i, 12) }} /><b style={{ left: `${WARM_C}%` }} /><b style={{ left: `${HOT_C}%` }} /></span> {t.maxC.toFixed(0)} °C</td>
                    <td className="r mute">{t.endC.toFixed(0)} °C</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No motor temperatures in this log.</div>}
        </section>
      </div>

      <div className="two even">
        <section className="panel" style={{ ['--i' as string]: 4 }}>
          <div className="ph"><h2>Timeline</h2><span className="note">{r.events.length} events{hasChart && r.events.length ? ' · click one to see it on the graph' : ''}</span></div>
          {r.events.length ? (
            <ol className="tl">
              {r.events.map((e, i) => <EventRow key={i} i={i} e={e} phases={r.phases} on={focus === `ev${i}`} onPick={hasChart ? () => pick(`ev${i}`, true) : undefined} />)}
            </ol>
          ) : <div className="empty">Nothing notable happened.</div>}
        </section>
        <section className="panel" style={{ ['--i' as string]: 5 }}>
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
    </div>
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
function KV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
function EventRow({ e, i, phases, on, onPick }: { e: ReportEvent; i: number; phases: Phase[]; on: boolean; onPick?: () => void }) {
  const key = (ev: KeyboardEvent) => { if (onPick && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onPick(); } };
  return (
    <li className={`tl-${e.level}${onPick ? ' pick' : ''}${on ? ' on' : ''}`} style={{ ['--i' as string]: Math.min(i, 16) }}
      onClick={onPick} onKeyDown={key} tabIndex={onPick ? 0 : undefined} role={onPick ? 'button' : undefined} aria-pressed={onPick ? on : undefined}>
      <span className="tl-t">{matchClock(e.t, phases)}</span>
      <span className="tl-k">{KIND[e.kind]}</span>
      <span className="tl-x">{e.text}</span>
    </li>
  );
}
const KIND: Record<ReportEvent['kind'], string> = {
  brownout: 'Brownout', loadshed: 'Load shed', tip: 'Tip', disconnect: 'Disconnect', ds: 'Comms', alert: 'Alert', console: 'Console', mode: 'Mode',
};

/* ---------- chart ---------- */

/** Voltage (line) and current (area) over match time, with auto/teleop bands,
    a hover readout, and an overlay for whichever number is in focus. */
/** Index of the trace sample nearest to time tt. */
export function sampleAt(t: number[], tt: number) {
  let lo = 0, hi = t.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < tt) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(t[lo - 1] - tt) < Math.abs(t[lo] - tt)) lo--;
  return lo;
}

export function TraceChart({ r, focus = null, marks, playhead = null, onSeek }: {
  r: MatchReport; focus?: Focus | null; marks?: BatteryMarks;
  /** playback position in log seconds: draws a cursor and fades what hasn't happened yet */
  playhead?: number | null;
  onSeek?: (t: number) => void;
}) {
  const { t, v, i } = r.trace;
  const [hov, setHov] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const m = useMemo(() => marks ?? marksOf(r), [marks, r]);
  if (t.length < 2) return <div className="empty">No battery voltage in this log.</div>;

  const b = r.battery;
  const W = 1000, H = 290, P = { l: 44, r: 50, t: 18, b: 28 };
  const top = P.t, bot = H - P.b, left = P.l, right = W - P.r;
  const x0 = t[0], x1 = t[t.length - 1];
  const vLo = Math.min(6, Math.floor(Math.min(...v)) - 0.5), vHi = 13.5;
  const iHi = Math.max(50, Math.ceil(Math.max(...i) / 50) * 50);
  const X = (x: number) => left + ((Math.min(x1, Math.max(x0, x)) - x0) / (x1 - x0)) * (right - left);
  const YV = (y: number) => top + (1 - (Math.min(vHi, Math.max(vLo, y)) - vLo) / (vHi - vLo)) * (bot - top);
  const YI = (y: number) => top + (1 - y / iHi) * (bot - top);
  const vt: number[] = [];
  for (let y = Math.ceil(vLo); y <= vHi; y += vHi - vLo > 6 ? 2 : 1) vt.push(y);
  const xt: number[] = [];
  const step = x1 - x0 > 200 ? 30 : 15;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) xt.push(x);
  const area = `M${X(t[0])},${YI(0)} ` + t.map((x, k) => `L${X(x).toFixed(1)},${YI(i[k]).toFixed(1)}`).join(' ') + ` L${X(t[t.length - 1])},${YI(0)} Z`;
  const vPath = 'M' + t.map((x, k) => `${X(x).toFixed(1)},${YV(v[k]).toFixed(1)}`).join(' L');
  const browns = r.events.filter((e) => e.kind === 'brownout');

  const ov = focus ? overlay(focus) : null;

  function overlay(f: Focus): { el: ReactNode; dim: 'v' | 'i' | 'both' | null } {
    const tag = (x: number, y: number, text: string, anchor?: 'start' | 'end' | 'middle') => (
      <text x={x} y={y} className="mr-tag" textAnchor={anchor ?? (x > right - 160 ? 'end' : 'start')}>{text}</text>
    );
    const hline = (y: number, dash = '6 4', w = 1.5) => <line x1={left} x2={right} y1={y} y2={y} stroke="var(--ink)" strokeWidth={w} strokeDasharray={dash} />;
    const bands = (s: Span[], fill = 'var(--ink)', op = 0.16) => s.map(([a, c], k) => <rect key={k} x={X(a)} y={top} width={Math.max(1.5, X(c) - X(a))} height={bot - top} fill={fill} opacity={op} />);
    const dot = (x: number, y: number) => <circle cx={x} cy={y} r={5.5} fill="var(--surface)" stroke="var(--ink)" strokeWidth={2.2} />;
    const enabledEnd = r.phases.length ? r.phases[r.phases.length - 1].end : 0;

    if (f.startsWith('ev')) {
      const e = r.events[Number(f.slice(2))];
      if (!e) return { el: null, dim: null };
      const x = X(e.t);
      return { el: <><line x1={x} x2={x} y1={top} y2={bot} stroke="var(--ink)" strokeWidth={2} />{tag(x + (x > right - 160 ? -6 : 6), top + 14, `${KIND[e.kind]} · ${matchClock(e.t, r.phases)}`)}</>, dim: null };
    }
    switch (f as StatKey) {
      case 'before': {
        if (b.restV == null) break;
        return { el: <>{bands([[x0, 0]], 'var(--ink)', 0.1)}{hline(YV(b.restV))}{tag(X(0) + 6, YV(b.restV) - 7, `${b.restV.toFixed(2)} V before enable`)}</>, dim: 'i' };
      }
      case 'min': {
        if (b.minV == null || m.minT == null) break;
        const x = X(m.minT), y = YV(b.minV);
        return { el: <>{hline(y, '2 4', 1)}<line x1={x} x2={x} y1={top} y2={bot} stroke="var(--ink)" strokeDasharray="2 4" />{dot(x, y)}{tag(x + (x > right - 160 ? -10 : 10), y - 9, `${b.minV.toFixed(2)} V lowest`)}</>, dim: 'i' };
      }
      case 'avgV': {
        if (b.avgV == null) break;
        return { el: <>{hline(YV(b.avgV))}{tag(right - 4, YV(b.avgV) - 7, `${b.avgV.toFixed(2)} V average`, 'end')}</>, dim: 'i' };
      }
      case 'after': {
        if (b.endV == null) break;
        const a = enabledEnd + 3, c = Math.min(x1, enabledEnd + 15);
        return { el: <>{bands([[a, c]], 'var(--ink)', 0.12)}{hline(YV(b.endV))}{tag(X(a) - 6, YV(b.endV) - 7, `${b.endV.toFixed(2)} V recovered`, 'end')}</>, dim: 'i' };
      }
      case 'sag': {
        if (b.restV == null || b.minV == null || m.minT == null) break;
        const x = X(m.minT), y0 = YV(b.restV), y1 = YV(b.minV);
        return {
          el: <>
            <line x1={left} x2={x} y1={y0} y2={y0} stroke="var(--ink)" strokeDasharray="6 4" strokeWidth={1.5} />
            <line x1={x} x2={x} y1={y0} y2={y1} stroke="var(--ink)" strokeWidth={2.5} />
            <line x1={x - 7} x2={x + 7} y1={y0} y2={y0} stroke="var(--ink)" strokeWidth={2.5} />
            <line x1={x - 7} x2={x + 7} y1={y1} y2={y1} stroke="var(--ink)" strokeWidth={2.5} />
            {dot(x, y1)}
            {tag(x + (x > right - 160 ? -12 : 12), (y0 + y1) / 2 + 4, `−${(b.restV - b.minV).toFixed(2)} V sag`)}
          </>, dim: 'i',
        };
      }
      case 'under10':
      case 'under8': {
        const lim = f === 'under10' ? 10 : 8;
        const s = pairs(f === 'under10' ? m.under10 : m.under8);
        return { el: <>{bands(s)}{hline(YV(lim), '0', 1.8)}{tag(left + 6, YV(lim) - 7, `${lim} V · ${Math.round(f === 'under10' ? b.under10Sec : b.under8Sec)} s below`)}</>, dim: 'i' };
      }
      case 'brownouts': {
        const s = pairs(m.brownouts);
        return { el: <>{s.map(([a], k) => <g key={k}><line x1={X(a)} x2={X(a)} y1={top} y2={bot} stroke="var(--ink)" strokeWidth={2.5} />{tag(X(a) + (X(a) > right - 160 ? -6 : 6), top + 14 + (k % 3) * 15, `Brownout ${k + 1}`)}</g>)}</>, dim: null };
      }
      case 'loadshed': {
        return { el: <>{bands(pairs(m.loadShed), 'url(#mr-hatch-dark)', 1)}</>, dim: null };
      }
      case 'ah':
      case 'wh': {
        const run = running(r, f as 'ah' | 'wh');
        const max = run[run.length - 1] || 1;
        const Y = (y: number) => bot - (y / max) * (bot - top) * 0.88; // headroom for the label
        const d = 'M' + t.map((x, k) => `${X(x).toFixed(1)},${Y(run[k]).toFixed(1)}`).join(' L');
        const total = f === 'ah' ? b.ah : b.wh;
        const label = f === 'ah' ? `${fmt(total, 2)} Ah used` : `${fmt(total, 1)} Wh used`;
        return {
          el: <>
            <path d={d} fill="none" stroke="var(--ink)" strokeWidth={2.4} pathLength={1} className="mr-draw fast" />
            {[0.25, 0.5, 0.75].map((q) => <text key={q} x={right + 6} y={Y(max * q) + 4} className="ax">{(max * q).toFixed(f === 'ah' ? 1 : 0)}</text>)}
            {dot(X(t[t.length - 1]), Y(max))}
            {tag(X(t[t.length - 1]) - 10, Y(max) - 10, label, 'end')}
          </>, dim: 'both',
        };
      }
      case 'avgA': {
        if (b.avgA == null) break;
        return { el: <>{hline(YI(b.avgA))}{tag(right - 4, YI(b.avgA) - 7, `${b.avgA.toFixed(0)} A average`, 'end')}</>, dim: 'v' };
      }
      case 'peak': {
        if (b.peakA == null || m.peakT == null) break;
        const x = X(m.peakT), y = YI(b.peakA);
        return {
          el: <>
            {m.peak1sT != null && bands([[m.peak1sT, m.peak1sT + 1]], 'var(--ink)', 0.35)}
            {m.peak1sT != null && b.peak1sA != null && tag(X(m.peak1sT + 1) + 6, bot - 10, `best 1 s: ${b.peak1sA.toFixed(0)} A`, X(m.peak1sT) > right - 160 ? 'end' : 'start')}
            {dot(x, y)}
            {tag(x + (x > right - 160 ? -10 : 10), y + 4, `${b.peakA.toFixed(0)} A peak`)}
          </>, dim: 'v',
        };
      }
      case 'resistance': {
        if (b.systemRmOhm == null) break;
        const R = b.systemRmOhm / 1000;
        const on = (x: number) => r.phases.some((p) => x >= p.start && x < p.end);
        const idx = t.map((x, k) => (on(x) ? k : -1)).filter((k) => k >= 0);
        if (idx.length < 3) break;
        // fit the no-load line a + c·t to v + R·i, the same model the analyzer uses
        const ys = idx.map((k) => v[k] + R * i[k]), xs = idx.map((k) => t[k]);
        const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
        let sxy = 0, sxx = 0;
        xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; });
        const c = sxx ? sxy / sxx : 0, a = my - c * mx;
        const seg = (y: (k: number) => number) => {
          let d = '', prev = -2;
          for (const k of idx) { d += `${k === prev + 1 ? 'L' : 'M'}${X(t[k]).toFixed(1)},${YV(y(k)).toFixed(1)} `; prev = k; }
          return d;
        };
        const noLoad = seg((k) => a + c * t[k]);
        const model = seg((k) => a + c * t[k] - R * i[k]);
        const lastK = idx[idx.length - 1];
        return {
          el: <>
            <path d={model} fill="none" stroke="var(--ink)" strokeWidth={1.4} strokeDasharray="5 3" />
            <path d={noLoad} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="1.5 3.5" />
            {tag(X(t[lastK]) - 6, YV(a + c * t[lastK]) - 9, `no load ≈ ${(a + c * t[lastK]).toFixed(1)} V`, 'end')}
          </>, dim: 'i',
        };
      }
    }
    return { el: null, dim: null };
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rc = svgRef.current?.getBoundingClientRect();
    if (!rc) return;
    const x = ((e.clientX - rc.left) / rc.width) * W;
    if (x < left || x > right) { setHov(null); return; }
    setHov(sampleAt(t, x0 + ((x - left) / (right - left)) * (x1 - x0)));
  };
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const rc = svgRef.current?.getBoundingClientRect();
    if (!onSeek || !rc) return;
    const x = ((e.clientX - rc.left) / rc.width) * W;
    if (x >= left && x <= right) onSeek(x0 + ((x - left) / (right - left)) * (x1 - x0));
  };
  const ph = playhead != null && playhead >= x0 && playhead <= x1 ? playhead : null;
  const pk = ph != null ? sampleAt(t, ph) : 0;
  const hx = hov != null ? X(t[hov]) : 0;
  const dimV = ov?.dim === 'v' || ov?.dim === 'both';
  const dimI = ov?.dim === 'i' || ov?.dim === 'both';

  return (
    <div className={`mr-plot${onSeek ? ' seek' : ''}`}>
      <svg ref={svgRef} className="chart mr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Battery voltage and current over the match"
        onPointerMove={onMove} onPointerLeave={() => setHov(null)} onClick={onClick}>
        <defs>
          <pattern id="mr-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="2" /></pattern>
          <pattern id="mr-hatch-dark" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink)" strokeWidth="1.6" opacity=".55" /></pattern>
        </defs>
        <g className="mr-fade">
          {r.phases.map((p, k) => (
            <g key={k}>
              <rect x={X(p.start)} y={top} width={Math.max(0, X(p.end) - X(p.start))} height={bot - top} fill={p.mode === 'auto' ? 'url(#mr-hatch)' : 'var(--surface-2)'} />
              <text x={X(p.start) + 4} y={top + 11} className="ax" style={{ textTransform: 'uppercase' }}>{p.mode}</text>
            </g>
          ))}
          {vt.map((y) => <g key={y}><line x1={left} x2={right} y1={YV(y)} y2={YV(y)} stroke="var(--line)" /><text x={left - 6} y={YV(y) + 4} textAnchor="end" className="ax">{y} V</text></g>)}
          {ov?.dim !== 'both' && [0, iHi / 2, iHi].map((y) => <text key={y} x={right + 6} y={YI(y) + 4} className="ax">{y} A</text>)}
          {xt.map((x) => <text key={x} x={X(x)} y={H - 8} textAnchor="middle" className="ax">{x < 0 ? '−' : ''}{mmss(Math.abs(x))}</text>)}
        </g>
        <g className={`lay${dimI ? ' dim' : ''}`}><g className="mr-wipe"><path d={area} fill="var(--ink-3)" opacity={0.35} /></g></g>
        <g className={`lay${dimV ? ' dim' : ''}`}>
          <line x1={left} x2={right} y1={YV(10)} y2={YV(10)} stroke="var(--ink)" strokeDasharray="5 4" className="mr-fade late" />
          <path d={vPath} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinejoin="round" pathLength={1} className="mr-draw" />
        </g>
        {browns.map((e, k) => <line key={k} x1={X(e.t)} x2={X(e.t)} y1={bot} y2={bot + 8} stroke="var(--ink)" strokeWidth={3} className="mr-fade late" />)}
        <line x1={left} x2={right} y1={bot} y2={bot} stroke="var(--ink)" />
        {ov?.el && <g className="ov" key={focus}>{ov.el}</g>}
        {ph != null && (
          <g pointerEvents="none">
            <rect x={X(ph)} y={top - 2} width={right - X(ph)} height={bot - top + 2} fill="var(--surface)" opacity={0.62} />
            <line x1={X(ph)} x2={X(ph)} y1={top - 6} y2={bot} stroke="var(--ink)" strokeWidth={2} />
            <polygon points={`${X(ph) - 5},${top - 10} ${X(ph) + 5},${top - 10} ${X(ph)},${top - 3}`} fill="var(--ink)" />
            <circle cx={X(ph)} cy={YI(i[pk])} r={4} fill="var(--ink-3)" stroke="var(--surface)" strokeWidth={1.5} />
            <circle cx={X(ph)} cy={YV(v[pk])} r={5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={1.5} />
          </g>
        )}
        {hov != null && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={top} y2={bot} stroke="var(--ink)" strokeWidth={1} />
            {!dimI && <circle cx={hx} cy={YI(i[hov])} r={3.5} fill="var(--ink-3)" stroke="var(--surface)" strokeWidth={1.5} />}
            {!dimV && <circle cx={hx} cy={YV(v[hov])} r={4} fill="var(--ink)" stroke="var(--surface)" strokeWidth={1.5} />}
          </g>
        )}
      </svg>
      {hov != null && (
        <div className={`mr-read${hx > W * 0.72 ? ' flip' : ''}`} style={{ left: `${(hx / W) * 100}%` }}>
          <b>{matchClock(t[hov], r.phases)}</b>
          {v[hov].toFixed(2)} V · {i[hov].toFixed(0)} A
        </div>
      )}
    </div>
  );
}
