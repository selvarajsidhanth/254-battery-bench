/* Trends across saved match logs: one point per match, oldest to newest, with
   events and practice days marked. Highlight a battery to follow it through. */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { StatusTag } from '../../components/ui';
import { Spark } from '../../components/charts';
import { SeriesChart, type SeriesBand, type SeriesGuide, type SeriesPoint } from '../../components/matchCharts';
import { sessionStats, type Session } from '../../lib/sessions';
import { avgVolts, fmt, shortDate } from '../../lib/format';
import type { MatchRun } from '../../lib/types';
import { GroupChips, KIND_LABEL, MatchTabs, countText, spanText, useSessions } from './Matches';

const maxTemp = (r: MatchRun) => (r.report?.temps.length ? Math.max(...r.report.temps.map((t) => t.maxC)) : null);

interface Metric { key: string; title: string; note: string; unit: string; digits: number; get: (r: MatchRun) => number | null | undefined; guides?: SeriesGuide[]; bars?: boolean }
const METRICS: Metric[] = [
  { key: 'min', title: 'Lowest voltage', note: 'Higher is better. Under ~6.8 V the robot browns out.', unit: 'V', digits: 2, get: (r) => r.minV, guides: [{ v: 6.8, label: 'brownout', strong: true }] },
  { key: 'start', title: 'Voltage before the match', note: 'How charged the battery was when it went in.', unit: 'V', digits: 2, get: (r) => r.restV },
  { key: 'r', title: 'Effective resistance', note: 'Battery + wiring under load. Creeping up = battery or connector aging.', unit: 'mΩ', digits: 1, get: (r) => r.sysR },
  { key: 'ah', title: 'Amp-hours used', note: 'How hard the match was on the battery.', unit: 'Ah', digits: 2, get: (r) => r.ahUsed },
  { key: 'wh', title: 'Energy used', note: 'Watt-hours: the energy the robot actually got.', unit: 'Wh', digits: 1, get: (r) => r.energyWh },
  { key: 'avgv', title: 'Average voltage', note: 'Wh ÷ Ah across the match. Lower = more sag for the same work.', unit: 'V', digits: 2, get: (r) => avgVolts(r.energyWh, r.ahUsed) },
  { key: 'brown', title: 'Brownouts', note: 'Per match.', unit: '', digits: 0, get: (r) => r.brownouts, bars: true },
  { key: 'temp', title: 'Hottest motor', note: 'Max motor temperature in the match.', unit: '°C', digits: 0, get: maxTemp, guides: [{ v: 65, label: 'warm' }, { v: 80, label: 'hot', strong: true }] },
];

export function MatchTrends() {
  const { data } = useStore();
  const { list } = useSessions();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const g = list.some((s) => s.key === params.get('g')) ? params.get('g')! : '';
  const [hl, setHl] = useState(params.get('b') ?? '');
  const label = (id: string) => data.batteries.find((b) => b.id === id)?.label ?? '—';

  // oldest group first, so time runs left to right
  const sessions = useMemo(() => (g ? list.filter((s) => s.key === g) : [...list].sort((a, b) => a.first.localeCompare(b.first))), [list, g]);
  const { slots, bands } = useMemo(() => {
    const slots: { run: MatchRun; s: Session }[] = [];
    const bands: SeriesBand[] = [];
    for (const s of sessions) {
      const from = slots.length;
      s.runs.forEach((run) => slots.push({ run, s }));
      bands.push({ from, to: slots.length - 1, label: s.name });
    }
    return { slots, bands };
  }, [sessions]);
  const batteries = [...new Set(slots.map((x) => x.run.batteryId).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b)));

  const points = (m: Metric): SeriesPoint[] => slots.flatMap(({ run, s }, x) => {
    const v = m.get(run);
    return v == null ? [] : [{ id: run.id, x, v, hl: !!hl && run.batteryId === hl, tip: [`${run.match} · ${s.name}`, `${run.batteryId ? `Battery ${label(run.batteryId)}` : 'No battery'} · ${shortDate(run.at)}`] }];
  });

  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Match trends</h1><p>One point per match, oldest on the left. Hover for details, click a point to open that log.</p></div>
        <MatchTabs />
      </div>
      {!slots.length ? <section className="panel"><div className="empty">No match logs yet. Trends show up once a few logs are saved.</div></section> : <>
        <div className="ml-filter">
          <GroupChips list={list} value={g} onChange={(k) => setParams(k ? { g: k } : {}, { replace: true })} />
          <label className="ml-hl"><span className="k-lab">Highlight battery</span>
            <select className="in" value={hl} onChange={(e) => setHl(e.target.value)}>
              <option value="">None</option>
              {batteries.map((id) => <option key={id} value={id}>{label(id)}</option>)}
            </select></label>
        </div>
        <section className="panel">
          <div className="ph"><h2>Per match</h2><span className="note">{slots.length} logs · {sessions.length} group{sessions.length === 1 ? '' : 's'}{hl ? ` · ${label(hl)} highlighted` : ''}</span></div>
          <div className="mt-grid">
            {METRICS.map((m) => (
              <div key={m.key} className="mt-cell">
                <div className="mt-h"><b>{m.title}</b>{m.unit && <span className="mute"> · {m.unit}</span>}<p>{m.note}</p></div>
                <SeriesChart points={points(m)} n={slots.length} bands={bands} guides={m.guides} digits={m.digits} unit={m.unit} bars={m.bars} dimOthers={!!hl} onPick={(id) => nav(`/matches/${id}`)} />
              </div>
            ))}
          </div>
        </section>
        <GroupTable sessions={[...sessions].reverse()} />
        <BatteryTrends runs={slots.map((x) => x.run)} />
      </>}
    </section>
  );
}

const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function GroupTable({ sessions }: { sessions: Session[] }) {
  if (sessions.length < 2) return null;
  return (
    <section className="panel">
      <div className="ph"><h2>By group</h2><span className="note">Averages per event or practice day · newest first</span></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Group</th><th>Kind</th><th>When</th><th className="r">Logs</th><th className="r">Avg start V</th><th className="r">Avg min V</th><th className="r">Lowest V</th><th className="r">Avg Ah used</th><th className="r">Avg Wh used</th><th className="r">Avg eff. R</th><th className="r">Brownouts</th><th className="r">Hottest motor</th></tr></thead>
        <tbody>
          {sessions.map((s) => {
            const st = sessionStats(s.runs);
            const temps = s.runs.map(maxTemp).filter((x): x is number => x != null);
            return (
              <tr key={s.key}>
                <td><Link className="lbl" to={`/matches?g=${encodeURIComponent(s.key)}`}>{s.name}</Link></td>
                <td className="mute">{KIND_LABEL[s.kind]}</td>
                <td className="mute">{spanText(s)}</td>
                <td className="r">{countText(s)}</td>
                <td className="r">{fmt(avg(s.runs.map((r) => r.restV)), 2)}</td>
                <td className="r"><b>{fmt(st.avgMin, 2)}</b></td>
                <td className="r">{fmt(st.worstMin, 2)}</td>
                <td className="r">{fmt(avg(s.runs.map((r) => r.ahUsed)), 2)}</td>
                <td className="r">{fmt(avg(s.runs.map((r) => r.energyWh)), 1)}</td>
                <td className="r">{fmt(avg(s.runs.map((r) => r.sysR)), 1)}</td>
                <td className="r">{st.browns ? <span className="inv-tag">{st.browns}</span> : <span className="mute">0</span>}</td>
                <td className="r">{temps.length ? `${Math.max(...temps).toFixed(0)} °C` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}

/** Each battery's effective resistance over its matches, biggest rise first. */
function BatteryTrends({ runs }: { runs: MatchRun[] }) {
  const { data, health } = useStore();
  const rows = useMemo(() => {
    const m = new Map<string, MatchRun[]>();
    [...runs].sort((a, b) => a.at.localeCompare(b.at)).forEach((r) => { if (r.batteryId) (m.get(r.batteryId) ?? m.set(r.batteryId, []).get(r.batteryId)!).push(r); });
    return [...m.entries()].map(([id, rs]) => {
      const rr = rs.map((r) => r.sysR).filter((x): x is number => x != null);
      const head = avg(rr.slice(0, Math.min(3, Math.ceil(rr.length / 2))));
      const tail = avg(rr.slice(-Math.min(3, Math.ceil(rr.length / 2))));
      return {
        id, label: data.batteries.find((b) => b.id === id)?.label ?? id, n: rs.length, rr,
        first: head, last: tail, change: rr.length >= 2 && head != null && tail != null ? tail - head : null,
        min: avg(rs.map((r) => r.minV)), browns: rs.reduce((n, r) => n + (r.brownouts ?? 0), 0),
      };
    }).sort((a, b) => (b.change ?? -99) - (a.change ?? -99));
  }, [runs, data.batteries]);
  if (!rows.length) return null;
  const all = rows.flatMap((x) => x.rr);
  const lo = Math.min(...all, 99), hi = Math.max(...all, 0);
  return (
    <section className="panel">
      <div className="ph"><h2>Batteries over time</h2><span className="note">Effective resistance, first matches vs latest · biggest rise first</span></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Battery</th><th>Status</th><th className="r">Matches</th><th className="r">Eff. R early</th><th className="r">Eff. R latest</th><th className="r">Change</th><th>Trend</th><th className="r">Avg min V</th><th className="r">Brownouts</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td><Link to={`/b/${x.id}`} className="lbl">{x.label}</Link></td>
              <td>{health[x.id] ? <StatusTag health={health[x.id].health} /> : null}</td>
              <td className="r">{x.n}</td>
              <td className="r">{x.first != null ? `${x.first.toFixed(1)} mΩ` : '—'}</td>
              <td className="r">{x.last != null ? `${x.last.toFixed(1)} mΩ` : '—'}</td>
              <td className="r">{x.change == null ? <span className="mute">—</span> : x.change >= 1.5 ? <b className="inv-tag">+{x.change.toFixed(1)}</b> : <span className={Math.abs(x.change) < 0.5 ? 'mute' : ''}>{x.change > 0 ? '+' : ''}{x.change.toFixed(1)}</span>}</td>
              <td>{x.rr.length > 1 ? <Spark values={x.rr} health={health[x.id]?.health ?? 'untested'} lo={lo - 1} hi={hi + 1} /> : <span className="mute">—</span>}</td>
              <td className="r"><b>{fmt(x.min, 2)}</b></td>
              <td className="r">{x.browns ? <span className="inv-tag">{x.browns}</span> : <span className="mute">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
