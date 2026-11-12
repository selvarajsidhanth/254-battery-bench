/* Two to four match logs side by side: voltage, current and amp-hours laid over
   each other from the first enable, then every number in one table. Logs are
   tagged A–D with their own line pattern. */
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Icon } from '../../components/ui';
import { running } from '../../components/MatchReportView';
import { OverlayChart, Swatch, TAGS, type OverlaySeries } from '../../components/matchCharts';
import { shortDate } from '../../lib/format';
import type { MatchRun } from '../../lib/types';
import { MatchTabs, readPicked, savePicked, useSessions } from './Matches';

/** a moving average, so a noisy current trace reads as a shape */
function smooth(t: number[], y: number[], sec: number) {
  if (t.length < 3) return y;
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1) || 1;
  const h = Math.max(1, Math.round(sec / dt / 2));
  const out: number[] = [];
  let sum = 0, a = 0, b = -1;
  for (let k = 0; k < y.length; k++) {
    while (b < Math.min(y.length - 1, k + h)) sum += y[++b];
    while (a < k - h) sum -= y[a++];
    out.push(sum / (b - a + 1));
  }
  return out;
}

interface Row { k: string; d: number; unit: string; better: 'hi' | 'lo' | null; get: (r: MatchRun) => number | null | undefined }
const ROWS: Row[] = [
  { k: 'Voltage before', d: 2, unit: 'V', better: 'hi', get: (r) => r.restV },
  { k: 'Lowest voltage', d: 2, unit: 'V', better: 'hi', get: (r) => r.minV },
  { k: 'Average voltage', d: 2, unit: 'V', better: 'hi', get: (r) => r.report?.battery.avgV },
  { k: 'Voltage after', d: 2, unit: 'V', better: 'hi', get: (r) => r.endV },
  { k: 'Sag', d: 2, unit: 'V', better: 'lo', get: (r) => r.report?.battery.sagV },
  { k: 'Time under 10 V', d: 1, unit: 's', better: 'lo', get: (r) => r.report?.battery.under10Sec },
  { k: 'Time under 8 V', d: 1, unit: 's', better: 'lo', get: (r) => r.report?.battery.under8Sec },
  { k: 'Brownouts', d: 0, unit: '', better: 'lo', get: (r) => r.brownouts },
  { k: 'Effective resistance', d: 1, unit: 'mΩ', better: 'lo', get: (r) => r.sysR },
  { k: 'Amp-hours used', d: 2, unit: 'Ah', better: null, get: (r) => r.ahUsed },
  { k: 'Watt-hours used', d: 1, unit: 'Wh', better: null, get: (r) => r.energyWh },
  { k: 'Peak current', d: 0, unit: 'A', better: null, get: (r) => r.peakA },
  { k: 'Average current', d: 0, unit: 'A', better: null, get: (r) => r.report?.battery.avgA },
  { k: 'Hottest motor', d: 0, unit: '°C', better: 'lo', get: (r) => (r.report?.temps.length ? Math.max(...r.report.temps.map((t) => t.maxC)) : null) },
  { k: 'Loop overruns', d: 0, unit: '', better: 'lo', get: (r) => r.report?.health.overruns },
  { k: 'Distance driven', d: 0, unit: 'm', better: null, get: (r) => r.report?.drive.distanceM },
];

export function MatchCompare() {
  const { data } = useStore();
  const { list, of } = useSessions();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('ids');
  const ids = (fromUrl != null ? fromUrl.split(',') : readPicked()).filter((id) => data.runs.some((r) => r.id === id)).slice(0, 4);
  const runs = ids.map((id) => data.runs.find((r) => r.id === id)!);
  const setIds = (next: string[]) => { savePicked(next); setParams(next.length ? { ids: next.join(',') } : {}, { replace: true }); };
  const label = (id: string) => data.batteries.find((b) => b.id === id)?.label;

  const series = useMemo(() => {
    const v: OverlaySeries[] = [], i: OverlaySeries[] = [], ah: OverlaySeries[] = [];
    runs.forEach((r, k) => {
      const tr = r.report?.trace;
      if (!r.report || !tr || tr.t.length < 2) return;
      const ph = r.report.phases;
      const a = ph.find((p) => p.mode === 'auto');
      const shape = { end: ph.length ? Math.max(...ph.map((p) => p.end)) : null, auto: a ? [a.start, a.end] as [number, number] : null };
      v.push({ k, t: tr.t, y: tr.v, ...shape });
      i.push({ k, t: tr.t, y: smooth(tr.t, tr.i, 2), ...shape });
      // running amp-hours from the first enable
      const run = running(r.report, 'ah');
      const z = run[Math.max(0, tr.t.findIndex((x) => x >= 0))] ?? 0;
      ah.push({ k, t: tr.t, y: run.map((x) => Math.max(0, x - z)), ...shape });
    });
    return { v, i, ah };
  }, [runs.map((r) => r.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const noTrace = runs.filter((r) => !r.report).map((r) => r.match);

  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Compare logs</h1><p>Up to four logs, lined up at the first enable. Pick them here or tick them on the Logs tab.</p></div>
        <MatchTabs />
      </div>

      <section className="panel">
        <div className="ph"><h2>Logs</h2><span className="note">{runs.length} of 4</span></div>
        <div className="cmp-legend">
          {runs.map((r, k) => (
            <div key={r.id} className="cmp-chip">
              <span className="cmp-tag">{TAGS[k]}</span>
              <Swatch k={k} />
              <span className="cmp-what">
                <Link to={`/matches/${r.id}`}><b>{r.match}</b></Link>
                <span className="mute" title={`${of.get(r.id)?.name ?? ''} · ${shortDate(r.at)}`}>{r.batteryId ? `Battery ${label(r.batteryId) ?? '—'}` : 'No battery'} · {of.get(r.id)?.name ?? shortDate(r.at)}</span>
              </span>
              <button className="btn sm" title={`Remove ${r.match}`} aria-label={`Remove ${r.match}`} onClick={() => setIds(ids.filter((x) => x !== r.id))}><Icon name="x" /></button>
            </div>
          ))}
          {runs.length < 4 && (
            <label className="cmp-add"><span className="k-lab">{runs.length ? 'Add a log' : 'Pick a log'}</span>
              <select className="in" value="" onChange={(e) => e.target.value && setIds([...ids, e.target.value])}>
                <option value="">Choose…</option>
                {list.map((s) => (
                  <optgroup key={s.key} label={s.name}>
                    {s.runs.filter((r) => !ids.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.match}{r.batteryId ? ` · ${label(r.batteryId) ?? ''}` : ''}</option>)}
                  </optgroup>
                ))}
              </select></label>
          )}
        </div>
      </section>

      {runs.length < 2 ? (
        <section className="panel"><div className="empty">{runs.length ? 'Add one more log to compare.' : 'Pick two to four logs to compare.'}{' '}Tip: compare the same battery across matches, or two batteries in similar matches.</div></section>
      ) : <>
        <section className="panel">
          <div className="ph"><h2>Battery voltage</h2><span className="note">Hover to read every log at that moment{noTrace.length ? ` · no trace for ${noTrace.join(', ')} (summary import)` : ''}</span></div>
          <div className="cmp-chart"><OverlayChart series={series.v} unit="V" digits={2} guides={[{ v: 6.8, label: 'brownout ≈ 6.8 V' }]} /></div>
        </section>
        <div className="two">
          <section className="panel">
            <div className="ph"><h2>Current draw</h2><span className="note">2-second average</span></div>
            <div className="cmp-chart"><OverlayChart series={series.i} unit="A" digits={0} zero /></div>
          </section>
          <section className="panel">
            <div className="ph"><h2>Amp-hours used</h2><span className="note">Running total from the first enable</span></div>
            <div className="cmp-chart"><OverlayChart series={series.ah} unit="Ah" digits={2} zero /></div>
          </section>
        </div>
        <StatTable runs={runs} />
        <SubsystemTable runs={runs} />
        <TempTable runs={runs} />
      </>}
    </section>
  );
}

function Head({ runs }: { runs: MatchRun[] }) {
  return <thead><tr><th></th>{runs.map((r, k) => <th key={r.id} className="r"><span className="cmp-th"><Swatch k={k} /><b>{TAGS[k]}</b> {r.match}</span></th>)}</tr></thead>;
}

function StatTable({ runs }: { runs: MatchRun[] }) {
  return (
    <section className="panel">
      <div className="ph"><h2>Numbers</h2><span className="note">Best in each row is marked · small numbers are the difference from A</span></div>
      <div className="tablewrap"><table className="cmp-table">
        <Head runs={runs} />
        <tbody>
          {ROWS.map((row) => {
            const vals = runs.map((r) => row.get(r) ?? null);
            const have = vals.filter((x): x is number => x != null);
            if (!have.length) return null;
            const best = row.better && have.length > 1 && Math.max(...have) !== Math.min(...have) ? (row.better === 'hi' ? Math.max(...have) : Math.min(...have)) : null;
            return (
              <tr key={row.k}>
                <th scope="row">{row.k}{row.unit && <span className="mute"> · {row.unit}</span>}</th>
                {vals.map((v, k) => {
                  const d = k > 0 && v != null && vals[0] != null ? v - vals[0] : null;
                  return (
                    <td key={k} className={`r${best != null && v === best ? ' cmp-best' : ''}`}>
                      {v == null ? <span className="mute">—</span> : v.toFixed(row.d)}
                      {best != null && v === best && <span className="cmp-mark">best</span>}
                      {d != null && Math.abs(d) >= Math.pow(10, -row.d) / 2 && <small>{d > 0 ? '+' : '−'}{Math.abs(d).toFixed(row.d)}</small>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}

function SubsystemTable({ runs }: { runs: MatchRun[] }) {
  const names = [...new Set(runs.flatMap((r) => r.report?.subsystems.map((s) => s.name) ?? []))];
  if (!names.length) return null;
  const val = (r: MatchRun, n: string) => r.report?.subsystems.find((s) => s.name === n)?.ah ?? null;
  const max = Math.max(...runs.flatMap((r) => names.map((n) => val(r, n) ?? 0)), 0.001);
  names.sort((a, b) => Math.max(...runs.map((r) => val(r, b) ?? 0)) - Math.max(...runs.map((r) => val(r, a) ?? 0)));
  return (
    <section className="panel">
      <div className="ph"><h2>Where the power went</h2><span className="note">Amp-hours by subsystem</span></div>
      <div className="tablewrap"><table className="cmp-table">
        <Head runs={runs} />
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <th scope="row">{n}</th>
              {runs.map((r) => {
                const v = val(r, n);
                return <td key={r.id} className="r">{v == null ? <span className="mute">—</span> : <span className="cmp-bar"><i style={{ width: `${(v / max) * 100}%` }} /><span>{v.toFixed(2)}</span></span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

function TempTable({ runs }: { runs: MatchRun[] }) {
  const names = [...new Set(runs.flatMap((r) => r.report?.temps.map((t) => t.name) ?? []))];
  if (!names.length) return null;
  const val = (r: MatchRun, n: string) => r.report?.temps.find((t) => t.name === n)?.maxC ?? null;
  const top = names.sort((a, b) => Math.max(...runs.map((r) => val(r, b) ?? 0)) - Math.max(...runs.map((r) => val(r, a) ?? 0))).slice(0, 10);
  return (
    <section className="panel">
      <div className="ph"><h2>Motor temperatures</h2><span className="note">Max per match · hottest {top.length} motors · warm ≥ 65 °C, hot ≥ 80 °C</span></div>
      <div className="tablewrap"><table className="cmp-table">
        <Head runs={runs} />
        <tbody>
          {top.map((n) => (
            <tr key={n}>
              <th scope="row">{n}</th>
              {runs.map((r) => {
                const v = val(r, n);
                return <td key={r.id} className="r">{v == null ? <span className="mute">—</span> : v >= 80 ? <b className="inv-tag">{v.toFixed(0)} hot</b> : v >= 65 ? <b>{v.toFixed(0)} warm</b> : v.toFixed(0)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
