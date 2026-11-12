/* Match logs: drop in robot .wpilog files after matches, get post-match reports,
   and save their summaries against the battery that was in the robot. Saved logs
   are grouped by event and practice day. The logs are read in the browser; only
   the summary (a few KB) is saved. */
import { useMemo, useState } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Icon, StatusTag } from '../../components/ui';
import { MatchReportView } from '../../components/MatchReportView';
import { MatchVideoPanel } from '../../components/MatchVideo';
import { deleteVideoFile } from '../../data/firebase';
import type { MatchReport } from '../../lib/matchReport';
import { groupRuns, sessionOf, sessionStats, type Session, type SessionOpts } from '../../lib/sessions';
import { clock, fmt, shortDate } from '../../lib/format';
import type { MatchRun } from '../../lib/types';
import { byStanding } from './shared';
import { BatchReview, GroupPicker, NewReport, Upload } from './MatchUpload';

/** Saved runs grouped into events and practice days (newest first). */
export function useSessions() {
  const { data } = useStore();
  return useMemo(() => {
    const opts: SessionOpts = { eventName: data.event.name, tbaEvent: data.event.tbaEvent };
    const list = groupRuns(data.runs, opts);
    const of = new Map<string, Session>();
    list.forEach((s) => s.runs.forEach((r) => of.set(r.id, s)));
    return { list, of, opts };
  }, [data.runs, data.event.name, data.event.tbaEvent]);
}

export const KIND_LABEL: Record<Session['kind'], string> = { event: 'Event', practice: 'Practice', imports: 'Imports' };
export const spanText = (s: Session) => (shortDate(s.first) === shortDate(s.last) ? shortDate(s.first) : `${shortDate(s.first)} – ${shortDate(s.last)}`);
export const countText = (s: Session) => `${s.runs.length} ${s.kind === 'event' ? 'match' : 'run'}${s.runs.length === 1 ? '' : s.kind === 'event' ? 'es' : 's'}`;

const PICKED = 'bb2:compare';
export const readPicked = (): string[] => { try { return JSON.parse(localStorage.getItem(PICKED) ?? '[]'); } catch { return []; } };
export const savePicked = (ids: string[]) => { try { localStorage.setItem(PICKED, JSON.stringify(ids)); } catch { /* private mode */ } };

export function MatchTabs() {
  return (
    <nav className="seg ml-tabs" aria-label="Match log views">
      <NavLink to="/matches" end>Logs</NavLink>
      <NavLink to="/matches/trends">Trends</NavLink>
      <NavLink to="/matches/compare">Compare</NavLink>
    </nav>
  );
}

/** One row of filter chips: All plus each group. */
export function GroupChips({ list, value, onChange }: { list: Session[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="ml-chips" role="tablist">
      <button role="tab" aria-selected={!value} className={!value ? 'on' : ''} onClick={() => onChange('')}>All <i>{list.reduce((n, s) => n + s.runs.length, 0)}</i></button>
      {list.map((s) => (
        <button key={s.key} role="tab" aria-selected={value === s.key} className={value === s.key ? 'on' : ''} onClick={() => onChange(s.key)}>
          {s.name} <i>{s.runs.length}</i>
        </button>
      ))}
    </div>
  );
}

export function Matches() {
  const { data } = useStore();
  const { list } = useSessions();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const g = list.some((s) => s.key === params.get('g')) ? params.get('g')! : '';
  const setG = (k: string) => setParams(k ? { g: k } : {}, { replace: true });
  const [reports, setReports] = useState<MatchReport[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const shown = g ? list.filter((s) => s.key === g) : list;
  const runs = g ? shown.flatMap((s) => s.runs) : data.runs;
  const videoMb = data.runs.reduce((n, r) => n + (r.video?.mb ?? 0), 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));

  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Match logs</h1><p>Drop in the robot logs after matches or a practice day. Logs are grouped by event and practice day. Files are read on this computer and never uploaded; only the summary is saved.</p></div>
        <MatchTabs />
      </div>
      {reports
        ? reports.length === 1
          ? <NewReport report={reports[0]} onClear={() => setReports(null)} />
          : <BatchReview reports={reports} onDone={(key) => { setReports(null); if (key) setG(key); }} />
        : <Upload onReports={setReports} />}
      {!reports && <>
        {list.length > 0 && (
          <div className="ml-filter">
            <GroupChips list={list} value={g} onChange={setG} />
            {videoMb > 0 && <span className="note">Videos {videoMb >= 1000 ? `${(videoMb / 1000).toFixed(1)} GB` : `${Math.round(videoMb)} MB`} of ~5 GB free</span>}
          </div>
        )}
        {!list.length && <section className="panel"><div className="empty">No match logs yet. Drop the .wpilog files above after the next match or practice.</div></section>}
        {shown.map((s, k) => <GroupPanel key={s.key} s={s} initiallyOpen={!!g || k === 0} pick={{ ids: picked, toggle }} />)}
        <BatteryComparison runs={runs} scope={g ? shown[0]?.name : null} />
      </>}
      {picked.length > 0 && !reports && (
        <div className="ml-pickbar" role="region" aria-label="Logs picked to compare">
          <span><b>{picked.length}</b> of 4 picked to compare</span>
          <button className="btn" onClick={() => setPicked([])}>Clear</button>
          <button className="btn primary" disabled={picked.length < 2} onClick={() => { savePicked(picked); nav(`/matches/compare?ids=${picked.join(',')}`); }}>
            Compare{picked.length < 2 ? ' (pick 2+)' : ''}
          </button>
        </div>
      )}
    </section>
  );
}

function GroupPanel({ s, initiallyOpen, pick }: { s: Session; initiallyOpen: boolean; pick: { ids: string[]; toggle: (id: string) => void } }) {
  const [open, setOpen] = useState(initiallyOpen);
  const { data, isAdmin, act, toast } = useStore();
  const st = sessionStats(s.runs);
  const low = st.lowest ? data.batteries.find((b) => b.id === st.lowest)?.label : null;
  const rename = () => {
    const name = prompt(s.auto ? `Name this practice day (e.g. "Auto tuning"):` : `Rename "${s.name}" to:`, s.auto ? '' : s.name);
    if (name == null || !name.trim() || name.trim() === s.name) return;
    act.fileRuns(s.runs.map((r) => r.id), name).then(() => toast(`Renamed to ${name.trim()}`), (e) => toast(`Couldn't rename: ${e instanceof Error ? e.message : e}`));
  };
  return (
    <section className={`panel ml-group${open ? ' open' : ''}`}>
      <div className="ph ml-gh">
        <h2><button onClick={() => setOpen(!open)} aria-expanded={open}><span className="ml-caret" aria-hidden>{open ? '▾' : '▸'}</span>{s.name}</button></h2>
        <span className="ml-kind">{KIND_LABEL[s.kind]}</span>
        <span className="note">{spanText(s)} · {countText(s)}</span>
        <span className="ml-gstats">
          {st.avgMin != null && <span>avg min <b>{st.avgMin.toFixed(2)} V</b></span>}
          {st.worstMin != null && <span>lowest <b>{st.worstMin.toFixed(2)} V</b>{low ? ` (${low})` : ''}</span>}
          <span>{st.browns ? <b className="inv-tag">{st.browns} brownout{st.browns === 1 ? '' : 's'}</b> : 'no brownouts'}</span>
        </span>
      </div>
      {open && <>
        <RunTable runs={s.runs} showBattery pick={pick} time={s.kind === 'practice' && shortDate(s.first) === shortDate(s.last) ? 'clock' : 'full'} />
        <div className="ml-gfoot">
          <Link to={`/matches/trends?g=${encodeURIComponent(s.key)}`}><Icon name="trend" />Trends for this group</Link>
          {isAdmin && s.kind !== 'imports' && <button className="linkish" onClick={rename}>{s.auto ? 'Name this day' : 'Rename group'}</button>}
        </div>
      </>}
    </section>
  );
}

export function MatchDetail() {
  const { id } = useParams();
  const { data, health, isAdmin, act, toast } = useStore();
  const { list, of } = useSessions();
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const run = data.runs.find((r) => r.id === id);
  if (!run) return <Navigate to="/matches" replace />;
  const s = of.get(run.id);
  const k = s ? s.runs.findIndex((r) => r.id === run.id) : -1;
  const prev = s && k > 0 ? s.runs[k - 1] : null;
  const next = s && k >= 0 && k < s.runs.length - 1 ? s.runs[k + 1] : null;
  const b = data.batteries.find((x) => x.id === run.batteryId);
  return (
    <section className="view">
      <div className="crumb">
        <Link to="/matches">Match logs</Link><span>/</span>
        {s ? <Link to={`/matches?g=${encodeURIComponent(s.key)}`}>{s.name}</Link> : <span>{run.event}</span>}<span>/</span>
        <span>{run.match}</span>
      </div>
      <div className="page-h">
        <div>
          <h1>{run.match}</h1>
          <p>{shortDate(run.at)} · {clock(run.at)}{s ? ` · ${s.name}` : ''}{run.by ? ` · saved by ${run.by}` : ''}</p>
        </div>
        <div className="mr-head">
          {s && s.runs.length > 1 && (
            <span className="ml-step">
              <button className="btn" disabled={!prev} onClick={() => prev && nav(`/matches/${prev.id}`)} title={prev ? `Previous: ${prev.match}` : undefined}>← {prev?.match ?? 'Prev'}</button>
              <span className="mute">{k + 1} of {s.runs.length}</span>
              <button className="btn" disabled={!next} onClick={() => next && nav(`/matches/${next.id}`)} title={next ? `Next: ${next.match}` : undefined}>{next?.match ?? 'Next'} →</button>
            </span>
          )}
          {b ? <Link className="btn" to={`/b/${b.id}`}>Battery {b.label} <StatusTag health={health[b.id]?.health ?? 'untested'} /></Link> : <span className="mute">No battery recorded</span>}
          <button className="btn" onClick={() => { const ids = [run.id]; savePicked(ids); nav(`/matches/compare?ids=${ids.join(',')}`); }}>Compare…</button>
          {isAdmin && <button className={`btn${edit ? ' primary' : ''}`} onClick={() => setEdit(!edit)}>Edit</button>}
          {isAdmin && <button className="btn" onClick={() => {
            if (!confirm(`Delete the ${run.match} report${run.video?.path ? ' and its uploaded video' : ''}?`)) return;
            if (run.video?.path) deleteVideoFile(run.video.path).catch(() => { /* already gone */ });
            act.deleteRun(run.id).then(() => { toast('Report deleted'); nav(s && s.runs.length > 1 ? `/matches?g=${encodeURIComponent(s.key)}` : '/matches'); });
          }}>Delete</button>}
        </div>
      </div>
      {edit && isAdmin && <EditRun key={run.id} run={run} sessions={list} autoName={s?.name ?? ''} onDone={() => setEdit(false)} />}
      {run.report && <MatchVideoPanel r={run.report} video={run.video} onChange={(v) => act.setRunVideo(run.id, v).catch((e) => toast(`Couldn't save the video: ${e instanceof Error ? e.message : e}`))} />}
      {run.report ? <MatchReportView r={run.report} capacityAh={b ? health[b.id]?.ah : null} /> : (
        <section className="panel"><div className="empty">This match came from a summary import, so there's no full report. Min {fmt(run.minV, 1)} V · peak {fmt(run.peakA, 0)} A · {fmt(run.energyWh, 1)} Wh.</div></section>
      )}
    </section>
  );
}

/** Admin: fix the battery, the match name, or move the log to another group. */
function EditRun({ run, sessions, autoName, onDone }: { run: MatchRun; sessions: Session[]; autoName: string; onDone: () => void }) {
  const { active, health, act, toast } = useStore();
  const { opts } = useSessions();
  const [batteryId, setBatteryId] = useState(run.batteryId);
  const [match, setMatch] = useState(run.match);
  const [group, setGroup] = useState(run.group ?? '');
  const [busy, setBusy] = useState(false);
  const choices = [...active].sort(byStanding(health));
  // what "automatic" would be for this run, without any hand-picked group
  const auto = run.group ? sessionOf({ ...run, group: undefined }, opts).name : autoName;
  return (
    <section className="panel">
      <div className="ph"><h2>Edit this log</h2><span className="note">Admins only</span></div>
      <div className="save-row">
        <label className="lab"><span className="k-lab">Battery</span>
          <select className="in" value={batteryId} onChange={(e) => setBatteryId(e.target.value)}>
            <option value="">No battery</option>
            {choices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select></label>
        <label className="lab"><span className="k-lab">Match</span><input className="in" value={match} onChange={(e) => setMatch(e.target.value)} /></label>
        <label className="lab"><span className="k-lab">Group</span><GroupPicker value={group} onChange={setGroup} autoName={auto} sessions={sessions} /></label>
        <div className="mr-head">
          <button className="btn" onClick={onDone}>Cancel</button>
          <button className="btn primary" disabled={busy || !match.trim()} onClick={() => {
            setBusy(true);
            act.updateRun(run.id, { batteryId, match: match.trim(), group: group.trim() })
              .then(() => { toast('Log updated'); onDone(); }, (e) => { toast(`Couldn't save: ${e instanceof Error ? e.message : e}`); setBusy(false); });
          }}>Save</button>
        </div>
      </div>
    </section>
  );
}

/** Saved match runs; used in each group here and on each battery's page. */
export function RunTable({ runs, showBattery, showGroup, pick, time = 'full' }: {
  runs: MatchRun[];
  showBattery?: boolean;
  showGroup?: boolean;
  pick?: { ids: string[]; toggle: (id: string) => void };
  time?: 'full' | 'clock';
}) {
  const { data } = useStore();
  const { of } = useSessions();
  const nav = useNavigate();
  const label = (id: string) => data.batteries.find((b) => b.id === id)?.label;
  if (!runs.length) return <div className="empty">No match logs yet. Drop a .wpilog on the Match logs page after the next match.</div>;
  return (
    <div className="tablewrap"><table className="clickable">
      <thead><tr>{pick && <th className="ml-pick"><span className="sr">Compare</span></th>}<th>{time === 'clock' ? 'Time' : 'Date'}</th><th>Match</th>{showGroup && <th>Group</th>}{showBattery && <th>Battery</th>}<th className="r">Start V</th><th className="r">Min V</th><th className="r">Used</th><th className="r">Eff. R</th><th className="r">Brownouts</th></tr></thead>
      <tbody>
        {runs.map((r) => {
          const on = pick?.ids.includes(r.id);
          return (
            <tr key={r.id} onClick={() => nav(`/matches/${r.id}`)} className={on ? 'picked' : ''}>
              {pick && (
                <td className="ml-pick" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Compare ${r.match}`} checked={!!on} disabled={!on && pick.ids.length >= 4} onChange={() => pick.toggle(r.id)} />
                </td>
              )}
              <td>{time === 'clock' ? clock(r.at) : <>{shortDate(r.at)} <span className="mute">{clock(r.at)}</span></>}</td>
              <td><b>{r.match}</b></td>
              {showGroup && <td>{of.get(r.id)?.name ?? <span className="mute">—</span>}</td>}
              {showBattery && <td>{label(r.batteryId) ?? <span className="mute">—</span>}</td>}
              <td className="r">{fmt(r.restV, 2)}</td>
              <td className="r"><b>{fmt(r.minV, 2)}</b></td>
              <td className="r">{r.ahUsed != null ? `${r.ahUsed.toFixed(2)} Ah` : r.energyWh != null ? `${fmt(r.energyWh, 1)} Wh` : '—'}</td>
              <td className="r">{r.sysR != null ? `${r.sysR.toFixed(1)} mΩ` : '—'}</td>
              <td className="r">{r.brownouts ? <span className="inv-tag">{r.brownouts}</span> : <span className="mute">{r.brownouts ?? '—'}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
}

/** How each battery has held up in real matches, worst first. */
function BatteryComparison({ runs, scope }: { runs: MatchRun[]; scope: string | null }) {
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
      <div className="ph"><h2>Batteries in matches</h2><span className="note">{scope ? `${scope} only` : 'Every saved log'} · averages · lowest voltage first</span></div>
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
