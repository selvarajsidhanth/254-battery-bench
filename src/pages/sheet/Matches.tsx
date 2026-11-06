/* Match logs: drop in a robot .wpilog after a match, get a post-match report,
   and save its summary against the battery that was in the robot. The log is
   read in the browser; only the summary (a few KB) is saved. */
import { useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Icon, StatusTag } from '../../components/ui';
import { MatchReportView } from '../../components/MatchReportView';
import { MatchVideoPanel } from '../../components/MatchVideo';
import { analyzeFile } from '../../lib/analyzeFile';
import type { MatchReport } from '../../lib/matchReport';
import { clock, fmt, shortDate } from '../../lib/format';
import type { MatchRun, MatchVideo } from '../../lib/types';
import { byStanding } from './shared';

export function Matches() {
  const { data } = useStore();
  const [report, setReport] = useState<MatchReport | null>(null);
  const logRuns = data.runs; // newest first

  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Match logs</h1><p>Drop in the robot log after a match, then pair the match video to watch it with the graph. Files are read on this computer and never uploaded. Only the summary is saved.</p></div>
      </div>
      {report
        ? <NewReport report={report} onClear={() => setReport(null)} />
        : <Upload onReport={setReport} />}
      {!report && <>
        <BatteryComparison runs={logRuns} />
        <section className="panel">
          <div className="ph"><h2>Saved reports</h2><span className="note">{logRuns.length} matches · newest first</span></div>
          <RunTable runs={logRuns} showBattery />
        </section>
      </>}
    </section>
  );
}

function Upload({ onReport }: { onReport: (r: MatchReport) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const go = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (!/\.wpilog$/i.test(f.name)) { setErr(`${f.name} isn't a .wpilog file. Use the AdvantageKit or WPILib log from the robot's logs folder (or the USB stick).`); return; }
    setName(f.name); setProgress(0);
    try {
      onReport(await analyzeFile(f, setProgress));
    } catch (e) {
      setErr(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="panel">
      <div className="ph"><h2>Analyze a log</h2><span className="note">.wpilog from AdvantageKit or WPILib DataLogManager</span></div>
      <div style={{ padding: 18 }}>
        {progress == null ? (
          <label className="drop" style={over ? { borderColor: 'var(--ink)', color: 'var(--ink)' } : undefined}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); go(e.dataTransfer.files[0]); }}>
            <input ref={input} type="file" accept=".wpilog" hidden onChange={(e) => { go(e.target.files?.[0]); e.target.value = ''; }} />
            <Icon name="upload" /> <b>Choose a .wpilog</b> or drop it here
            <div className="mute" style={{ fontSize: 12, marginTop: 6 }}>Battery sag and brownouts, power by subsystem, motor temps, disconnects, loop timing, and driving.</div>
          </label>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>Reading <b>{name}</b>…</span><span className="mute">{Math.round(progress * 100)}%</span></div>
            <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
          </div>
        )}
        {err && <p className="err-line" style={{ marginBottom: 0 }}>{err}</p>}
      </div>
    </section>
  );
}

function NewReport({ report, onClear }: { report: MatchReport; onClear: () => void }) {
  const { data, active, health, act, toast } = useStore();
  const nav = useNavigate();
  const guess = useMemo(() => {
    if (report.batteryName) {
      const b = data.batteries.find((x) => x.label.toUpperCase() === report.batteryName!.trim().toUpperCase());
      if (b) return { id: b.id, why: 'named in the log' };
    }
    const inRobot = active.filter((b) => b.state === 'robot');
    if (inRobot.length === 1) return { id: inRobot[0].id, why: 'in the robot right now' };
    return { id: '', why: '' };
  }, [report, data.batteries, active]);
  const [batteryId, setBatteryId] = useState(guess.id);
  const [match, setMatch] = useState(report.match.label);
  const [event, setEvent] = useState(report.match.event || data.event.name || '');
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<MatchVideo | null>(null);
  const dupe = data.runs.find((r) => r.report?.fileName === report.fileName && r.report?.logStart === report.logStart);
  const choices = [...active].sort(byStanding(health));
  const cap = batteryId ? health[batteryId]?.ah : null;

  return (
    <>
      <section className="panel">
        <div className="ph"><h2>Save to match history</h2><span className="note">{dupe ? 'This log is already saved' : 'Pick the battery that was in the robot'}</span></div>
        {dupe ? (
          <div className="save-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <span>Saved as <b>{dupe.match}</b> on {shortDate(dupe.at)}{dupe.by ? ` by ${dupe.by}` : ''}.</span>
            <Link className="btn" to={`/matches/${dupe.id}`}>Open saved report</Link>
            <button className="btn" onClick={onClear}>Analyze another log</button>
          </div>
        ) : (
          <div className="save-row">
            <label className="lab"><span className="k-lab">Battery{guess.id && batteryId === guess.id ? ` · ${guess.why}` : ''}</span>
              <select className="in" value={batteryId} onChange={(e) => setBatteryId(e.target.value)}>
                <option value="">Not sure / no battery</option>
                {choices.map((b) => <option key={b.id} value={b.id}>{b.label}{health[b.id].rank != null ? ` · #${health[b.id].rank}` : ''}{b.state === 'robot' ? ' · in robot' : ''}</option>)}
              </select></label>
            <label className="lab"><span className="k-lab">Match</span><input className="in" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Q12" /></label>
            <label className="lab"><span className="k-lab">Event</span><input className="in" value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Practice field" /></label>
            <div className="mr-head">
              <button className="btn" onClick={onClear}>Discard</button>
              <button className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const id = await act.saveMatchReport(report, { batteryId, match, event, video });
                  toast(`Saved ${match || report.match.label}${batteryId ? ` for ${data.batteries.find((b) => b.id === batteryId)?.label}` : ''}`);
                  nav(`/matches/${id}`);
                } catch (e) {
                  toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
                  setBusy(false);
                }
              }}><Icon name="plus" />Save report</button>
            </div>
          </div>
        )}
      </section>
      {!dupe && <MatchVideoPanel r={report} video={video} onChange={setVideo} />}
      <MatchReportView r={report} capacityAh={cap} />
    </>
  );
}

export function MatchDetail() {
  const { id } = useParams();
  const { data, health, active, isAdmin, act, toast } = useStore();
  const nav = useNavigate();
  const run = data.runs.find((r) => r.id === id);
  if (!run) return <Navigate to="/matches" replace />;
  const b = data.batteries.find((x) => x.id === run.batteryId);
  const choices = [...active].sort(byStanding(health));
  return (
    <section className="view">
      <div className="crumb"><Link to="/matches">Match logs</Link><span>/</span><span>{run.event ? `${run.event} · ` : ''}{run.match}</span></div>
      <div className="page-h">
        <div>
          <h1>{run.match}</h1>
          <p>{shortDate(run.at)} · {clock(run.at)}{run.event ? ` · ${run.event}` : ''}{run.by ? ` · saved by ${run.by}` : ''}</p>
        </div>
        <div className="mr-head">
          {b ? <Link className="btn" to={`/b/${b.id}`}>Battery {b.label} <StatusTag health={health[b.id]?.health ?? 'untested'} /></Link> : <span className="mute">No battery recorded</span>}
          {isAdmin && (
            <select className="in" style={{ width: 'auto' }} value={run.batteryId} title="Change the battery" onChange={(e) => act.updateRun(run.id, { batteryId: e.target.value }).then(() => toast('Battery updated'))}>
              <option value="">No battery</option>
              {choices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          )}
          {isAdmin && <button className="btn" onClick={() => { if (confirm(`Delete the ${run.match} report?`)) act.deleteRun(run.id).then(() => { toast('Report deleted'); nav('/matches'); }); }}>Delete</button>}
        </div>
      </div>
      {run.report && <MatchVideoPanel r={run.report} video={run.video} onChange={(v) => act.setRunVideo(run.id, v).catch((e) => toast(`Couldn't save the video: ${e instanceof Error ? e.message : e}`))} />}
      {run.report ? <MatchReportView r={run.report} capacityAh={b ? health[b.id]?.ah : null} /> : (
        <section className="panel"><div className="empty">This match came from a summary import, so there's no full report. Min {fmt(run.minV, 1)} V · peak {fmt(run.peakA, 0)} A · {fmt(run.energyWh, 1)} Wh.</div></section>
      )}
    </section>
  );
}

/** Saved match runs; used here and on each battery's page. */
export function RunTable({ runs, showBattery }: { runs: MatchRun[]; showBattery?: boolean }) {
  const { data } = useStore();
  const nav = useNavigate();
  const label = (id: string) => data.batteries.find((b) => b.id === id)?.label;
  if (!runs.length) return <div className="empty">No match logs yet. Drop a .wpilog above after the next match.</div>;
  return (
    <div className="tablewrap"><table className="clickable">
      <thead><tr><th>Date</th><th>Match</th>{showBattery && <th>Battery</th>}<th className="r">Start V</th><th className="r">Min V</th><th className="r">Used</th><th className="r">Eff. R</th><th className="r">Brownouts</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} onClick={() => nav(`/matches/${r.id}`)}>
            <td>{shortDate(r.at)} <span className="mute">{clock(r.at)}</span></td>
            <td>{r.event ? <span className="mute">{r.event} · </span> : null}<b>{r.match}</b></td>
            {showBattery && <td>{label(r.batteryId) ?? <span className="mute">—</span>}</td>}
            <td className="r">{fmt(r.restV, 2)}</td>
            <td className="r"><b>{fmt(r.minV, 2)}</b></td>
            <td className="r">{r.ahUsed != null ? `${r.ahUsed.toFixed(2)} Ah` : r.energyWh != null ? `${fmt(r.energyWh, 1)} Wh` : '—'}</td>
            <td className="r">{r.sysR != null ? `${r.sysR.toFixed(1)} mΩ` : '—'}</td>
            <td className="r">{r.brownouts ? <span className="inv-tag">{r.brownouts}</span> : <span className="mute">{r.brownouts ?? '—'}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

/** How each battery has held up in real matches, worst first. */
function BatteryComparison({ runs }: { runs: MatchRun[] }) {
  const { data, health } = useStore();
  const rows = useMemo(() => {
    const m = new Map<string, MatchRun[]>();
    runs.forEach((r) => { if (r.batteryId && r.minV != null) (m.get(r.batteryId) ?? m.set(r.batteryId, []).get(r.batteryId)!).push(r); });
    const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return [...m.entries()].map(([id, rs]) => ({
      id, label: data.batteries.find((b) => b.id === id)?.label ?? id, n: rs.length,
      rest: avg(rs.map((r) => r.restV)), min: avg(rs.map((r) => r.minV)), worst: Math.min(...rs.map((r) => r.minV!)),
      r: avg(rs.map((r) => r.sysR)), browns: rs.reduce((n, r) => n + (r.brownouts ?? 0), 0),
    })).sort((a, b) => (a.min ?? 99) - (b.min ?? 99));
  }, [runs, data.batteries]);
  if (rows.length < 2) return null;
  return (
    <section className="panel">
      <div className="ph"><h2>Batteries in matches</h2><span className="note">Averages from saved logs · lowest voltage first</span></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Battery</th><th>Status</th><th className="r">Matches</th><th className="r">Avg rest V</th><th className="r">Avg min V</th><th className="r">Worst min V</th><th className="r">Avg eff. R</th><th className="r">Brownouts</th><th className="r">CBA</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <td><Link to={`/b/${x.id}`} className="lbl">{x.label}</Link></td>
              <td>{health[x.id] ? <StatusTag health={health[x.id].health} /> : null}</td>
              <td className="r">{x.n}</td>
              <td className="r">{fmt(x.rest, 2)}</td>
              <td className="r"><b>{fmt(x.min, 2)}</b></td>
              <td className="r">{fmt(x.worst, 2)}</td>
              <td className="r">{x.r != null ? `${x.r.toFixed(1)} mΩ` : '—'}</td>
              <td className="r">{x.browns ? <span className="inv-tag">{x.browns}</span> : <span className="mute">0</span>}</td>
              <td className="r mute">{health[x.id]?.ah != null ? `${health[x.id].ah!.toFixed(2)} Ah` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
