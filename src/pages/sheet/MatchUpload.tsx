/* Getting robot logs in: drop one or many .wpilog files, check the battery, match
   and group the app filled in, then save. One log shows the full report before
   saving; several show a review list with Save all. */
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Icon } from '../../components/ui';
import { MatchReportView } from '../../components/MatchReportView';
import { MatchVideoPanel } from '../../components/MatchVideo';
import { analyzeFile } from '../../lib/analyzeFile';
import type { MatchReport } from '../../lib/matchReport';
import { inRobotAt, isField, localDay, nextRunNumber, norm, sessionOf, type Session } from '../../lib/sessions';
import { clock, shortDate } from '../../lib/format';
import type { MatchRun, MatchVideo } from '../../lib/types';
import { byStanding } from './shared';
import { useSessions } from './Matches';

export function Upload({ onReports }: { onReports: (r: MatchReport[]) => void }) {
  const [progress, setProgress] = useState<{ k: number; n: number; p: number; name: string } | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const go = async (list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const bad: string[] = [];
    const logs = files.filter((f) => /\.wpilog$/i.test(f.name) || (bad.push(`${f.name} isn't a .wpilog file. Use the AdvantageKit or WPILib log from the robot's logs folder (or the USB stick).`), false));
    const out: MatchReport[] = [];
    for (let k = 0; k < logs.length; k++) {
      const f = logs[k];
      setProgress({ k, n: logs.length, p: 0, name: f.name });
      try {
        out.push(await analyzeFile(f, (p) => setProgress({ k, n: logs.length, p, name: f.name })));
      } catch (e) {
        bad.push(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    setProgress(null);
    setErrs(bad);
    if (out.length) onReports(out.sort((a, b) => (a.logStart ?? '').localeCompare(b.logStart ?? '')));
  };

  return (
    <section className="panel">
      <div className="ph"><h2>Add logs</h2><span className="note">.wpilog from AdvantageKit or WPILib · drop a whole practice day at once</span></div>
      <div style={{ padding: 18 }}>
        {progress == null ? (
          <label className={`drop${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); go(e.dataTransfer.files); }}>
            <input ref={input} type="file" accept=".wpilog" multiple hidden onChange={(e) => { go(e.target.files); e.target.value = ''; }} />
            <Icon name="upload" /> <b>Choose .wpilog files</b> or drop them here
            <div className="mute" style={{ fontSize: 12, marginTop: 6 }}>Battery sag and brownouts, power by subsystem, motor temps, disconnects, loop timing, and driving.</div>
          </label>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>Reading <b>{progress.name}</b>{progress.n > 1 ? ` (${progress.k + 1} of ${progress.n})` : ''}…</span>
              <span className="mute">{Math.round(((progress.k + progress.p) / progress.n) * 100)}%</span>
            </div>
            <div className="progress"><i style={{ width: `${((progress.k + progress.p) / progress.n) * 100}%` }} /></div>
          </div>
        )}
        {errs.map((e, k) => <p key={k} className="err-line" style={{ marginBottom: 0 }}>{e}</p>)}
      </div>
    </section>
  );
}

/** Pick the group a log goes in. '' = automatic (the event for field matches, the practice day otherwise). */
export function GroupPicker({ value, onChange, autoName, sessions }: { value: string; onChange: (v: string) => void; autoName: string; sessions: Session[] }) {
  const named = sessions.filter((s) => !s.auto && s.kind !== 'imports' && norm(s.name) !== norm(autoName));
  const match = named.find((s) => norm(s.name) === norm(value));
  const [customMode, setCustom] = useState(false);
  const custom = customMode || (!!value && !match && norm(value) !== norm(autoName));
  if (custom) {
    return (
      <span className="ml-newgroup">
        <input className="in" autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="Group name, e.g. Auto tuning" />
        <button className="btn" title="Back to the list" onClick={() => { setCustom(false); onChange(''); }}><Icon name="x" /></button>
      </span>
    );
  }
  return (
    <select className="in" value={match?.name ?? ''} onChange={(e) => {
      if (e.target.value === '\u0000new') { setCustom(true); onChange(''); } else onChange(e.target.value);
    }}>
      <option value="">{autoName} (automatic)</option>
      {named.map((s) => <option key={s.key} value={s.name}>{s.name}</option>)}
      <option value={'\u0000new'}>New group…</option>
    </select>
  );
}

const isFieldLog = (r: MatchReport) => r.match.fms || r.match.type === 'qual' || r.match.type === 'elim';

/** What the save form starts with for one log. */
function useDefaults() {
  const { data, active } = useStore();
  const { opts } = useSessions();
  return useMemo(() => {
    const robotNow = active.filter((b) => b.state === 'robot');
    return (r: MatchReport, runsBefore: Record<string, number> = {}) => {
      // battery: named in the log, else the rotation history at log time, else what's in the robot now (fresh logs only)
      let battery = { id: '', why: '' };
      const named = r.batteryName && data.batteries.find((x) => x.label.toUpperCase() === r.batteryName!.trim().toUpperCase());
      const hist = r.logStart ? inRobotAt(data.events, r.logStart) : null;
      if (named) battery = { id: named.id, why: 'named in the log' };
      else if (hist && active.some((b) => b.id === hist)) battery = { id: hist, why: 'in the robot at log time' };
      else if (robotNow.length === 1 && (!r.logStart || Date.now() - Date.parse(r.logStart) < 12 * 3600_000)) battery = { id: robotNow[0].id, why: 'in the robot right now' };

      const field = isFieldLog(r);
      const event = field ? (r.match.event || data.event.name || '') : '';
      let match = r.match.label;
      if (!field && /^practice run$/i.test(match)) {
        // number runs across the whole day, even ones already filed into a named group
        const day = localDay(r.logStart ?? new Date().toISOString());
        const sameDay = data.runs.filter((x) => x.report && !isField(x) && localDay(x.at) === day);
        const n = nextRunNumber(sameDay) + (runsBefore[day] ?? 0);
        runsBefore[day] = (runsBefore[day] ?? 0) + 1;
        match = `Run ${n}`;
      }
      const probe: MatchRun = { id: '', batteryId: '', at: r.logStart ?? new Date().toISOString(), event, match, report: r, source: 'log' };
      return { battery, event, match, autoName: sessionOf(probe, opts).name };
    };
  }, [data.batteries, data.events, data.event.name, data.runs, active, opts]);
}

function BatterySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { active, health } = useStore();
  const choices = [...active].sort(byStanding(health));
  return (
    <select className="in" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not sure / no battery</option>
      {choices.map((b) => <option key={b.id} value={b.id}>{b.label}{health[b.id].rank != null ? ` · #${health[b.id].rank}` : ''}{b.state === 'robot' ? ' · in robot' : ''}</option>)}
    </select>
  );
}

const dupeOf = (runs: MatchRun[], r: MatchReport) => runs.find((x) => x.report?.fileName === r.fileName && x.report?.logStart === r.logStart);

/** One log: the full report, with the save form on top. */
export function NewReport({ report, onClear }: { report: MatchReport; onClear: () => void }) {
  const { data, health, act, toast } = useStore();
  const { list } = useSessions();
  const nav = useNavigate();
  const d = useDefaults()(report);
  const [batteryId, setBatteryId] = useState(d.battery.id);
  const [match, setMatch] = useState(d.match);
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<MatchVideo | null>(null);
  const dupe = dupeOf(data.runs, report);
  const cap = batteryId ? health[batteryId]?.ah : null;

  return (
    <>
      <section className="panel">
        <div className="ph"><h2>Save to match history</h2><span className="note">{dupe ? 'This log is already saved' : 'Check the battery that was in the robot'}</span></div>
        {dupe ? (
          <div className="save-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <span>Saved as <b>{dupe.match}</b> on {shortDate(dupe.at)}{dupe.by ? ` by ${dupe.by}` : ''}.</span>
            <Link className="btn" to={`/matches/${dupe.id}`}>Open saved report</Link>
            <button className="btn" onClick={onClear}>Add other logs</button>
          </div>
        ) : (
          <div className="save-row">
            <label className="lab"><span className="k-lab">Battery{d.battery.id && batteryId === d.battery.id ? ` · ${d.battery.why}` : ''}</span>
              <BatterySelect value={batteryId} onChange={setBatteryId} /></label>
            <label className="lab"><span className="k-lab">Match</span><input className="in" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Q12" /></label>
            <label className="lab"><span className="k-lab">Group</span><GroupPicker value={group} onChange={setGroup} autoName={d.autoName} sessions={list} /></label>
            <div className="mr-head">
              <button className="btn" onClick={onClear}>Discard</button>
              <button className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const id = await act.saveMatchReport(report, { batteryId, match, event: d.event, group, video });
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

interface Row { report: MatchReport; batteryId: string; why: string; match: string; group: string; event: string; autoName: string; dupe: MatchRun | undefined; skip: boolean }

/** Several logs at once: a review list, then Save all. */
export function BatchReview({ reports, onDone }: { reports: MatchReport[]; onDone: (savedGroup?: string) => void }) {
  const { data, health, act, toast } = useStore();
  const { list, opts } = useSessions();
  const defaults = useDefaults();
  const [bulk, setBulk] = useState('');
  const [rows, setRows] = useState<Row[]>(() => {
    const before: Record<string, number> = {};
    return reports.map((report) => {
      const dupe = dupeOf(data.runs, report);
      const d = defaults(report, dupe ? {} : before);
      return { report, batteryId: d.battery.id, why: d.battery.why, match: d.match, group: '', event: d.event, autoName: d.autoName, dupe, skip: !!dupe };
    });
  });
  const [view, setView] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const todo = rows.filter((r) => !r.skip);
  const autoNames = [...new Set(rows.map((r) => r.autoName))];

  const saveAll = async () => {
    let n = 0;
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      if (r.skip) continue;
      setBusy(n);
      try {
        await act.saveMatchReport(r.report, { batteryId: r.batteryId, match: r.match, event: r.event, group: r.group });
        n++;
      } catch (e) {
        toast(`Couldn't save ${r.match}: ${e instanceof Error ? e.message : e}`);
        setBusy(null);
        setRows((rs) => rs.map((x, i) => (i < k ? { ...x, skip: true } : x))); // the ones before are in
        return;
      }
    }
    toast(`Saved ${n} log${n === 1 ? '' : 's'}`);
    const first = rows.find((r) => !r.skip);
    onDone(first ? sessionOf({ id: '', batteryId: '', at: first.report.logStart ?? new Date().toISOString(), event: first.event, group: first.group || undefined, match: first.match, report: first.report, source: 'log' }, opts).key : undefined);
  };

  return (
    <>
      <section className="panel">
        <div className="ph"><h2>Review {rows.length} logs</h2><span className="note">The app filled these in. Check the batteries, then save.</span></div>
        <div className="ml-bulk">
          <label className="lab"><span className="k-lab">Group for all</span>
            <GroupPicker value={bulk} onChange={(g) => { setBulk(g); setRows((rs) => rs.map((r) => ({ ...r, group: g }))); }} autoName={autoNames.length === 1 ? autoNames[0] : 'Each log’s own'} sessions={list} /></label>
          <div className="mr-head">
            <button className="btn" onClick={() => onDone()} disabled={busy != null}>Discard all</button>
            <button className="btn primary" disabled={busy != null || !todo.length} onClick={saveAll}>
              <Icon name="plus" />{busy != null ? `Saving ${busy + 1} of ${todo.length}…` : `Save ${todo.length} log${todo.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
        <div className="tablewrap"><table className="ml-batch">
          <thead><tr><th></th><th>Log</th><th>Battery</th><th>Match</th><th>Group</th><th className="r">Min V</th><th className="r">Brownouts</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k} className={r.skip ? 'off' : ''}>
                <td><input type="checkbox" checked={!r.skip} disabled={!!r.dupe} title={r.dupe ? 'Already saved' : 'Save this log'} onChange={(e) => set(k, { skip: !e.target.checked })} /></td>
                <td><b>{r.report.logStart ? clock(r.report.logStart) : '—'}</b> <span className="mute">{r.report.logStart ? shortDate(r.report.logStart) : ''}</span>
                  <div className="mute ml-file">{r.dupe ? <Link to={`/matches/${r.dupe.id}`}>Already saved as {r.dupe.match}</Link> : r.report.fileName}</div></td>
                <td>{r.dupe ? <span className="mute">—</span> : <><BatterySelect value={r.batteryId} onChange={(v) => set(k, { batteryId: v, why: '' })} />{r.why && <div className="mute ml-file">{r.why}</div>}</>}</td>
                <td>{r.dupe ? <span className="mute">{r.dupe.match}</span> : <input className="in" value={r.match} onChange={(e) => set(k, { match: e.target.value })} />}</td>
                <td>{r.dupe ? <span className="mute">—</span> : <GroupPicker value={r.group} onChange={(g) => set(k, { group: g })} autoName={r.autoName} sessions={list} />}</td>
                <td className="r"><b>{r.report.battery.minV?.toFixed(2) ?? '—'}</b></td>
                <td className="r">{r.report.battery.brownouts ? <span className="inv-tag">{r.report.battery.brownouts}</span> : <span className="mute">0</span>}</td>
                <td><button className="btn sm" onClick={() => setView(view === k ? null : k)}>{view === k ? 'Hide' : 'View'}</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {view != null && rows[view] && <MatchReportView key={view} r={rows[view].report} capacityAh={rows[view].batteryId ? health[rows[view].batteryId]?.ah : null} />}
    </>
  );
}
