import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { IrChart, MiniChart } from '../../components/charts';
import { BatteryActions } from '../../components/BatteryActions';
import { HEALTH_LABEL, Icon, Mk, Modal, StateLabel, StatusTag } from '../../components/ui';
import { chargeStatus, restRemainingMin } from '../../lib/domain';
import { DAY, ago, dateFar, dur, fmt, minutesSince, monthYear, shortDate } from '../../lib/format';

export function BatteryDetail() {
  const { id } = useParams();
  const { battery, health, testsBy, runsBy, data, now, isAdmin, act, toast } = useStore();
  const nav = useNavigate();
  const b = battery(id);
  const [actions, setActions] = useState(false);
  const [retiring, setRetiring] = useState<'retire' | 'flag' | null>(null);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  if (!b) return <Navigate to="/batteries" replace />;

  const a = health[b.id];
  const tests = testsBy[b.id] ?? [];
  const runs = runsBy[b.id] ?? [];
  const s = data.settings;
  const pendingFlag = data.flags.find((f) => f.batteryId === b.id && f.status === 'pending');
  const lastMca = [...tests].reverse().find((t) => t.mca != null);
  const firstMca = tests.find((t) => t.mca != null);

  const stateMeta = b.state === 'charging' ? `~${dur(chargeStatus(b, s, now).remainingMin)} to full`
    : b.state === 'resting' ? (restRemainingMin(b, s, now) > 0 ? `${Math.ceil(restRemainingMin(b, s, now))} min rest left` : 'rested')
    : dur(minutesSince(b.stateSince, now));

  const projDays = a.trend?.daysToLimit;
  const showProjection = !b.retired && a.trend && a.trend.perWeek > 0.05 && projDays != null && (a.ir ?? 0) < s.irMax;

  return (
    <section className="view">
      <div className="crumb"><Link to="/batteries">Batteries</Link><span>/</span><span>{b.label}</span></div>
      <div className="d-head">
        <div className="d-id">
          <div className="big">{b.label}</div>
          <div className="st">
            <StatusTag health={a.health} />
            {!b.retired && <StateLabel state={b.state} extra={<span className="mute">&nbsp;· {stateMeta}</span>} />}
          </div>
        </div>
        <div className="d-specs">
          <Spec k="Internal resistance" v={fmt(a.ir, 1)} u="mΩ" />
          <Spec k="Open-load voltage" v={fmt(a.v0, 2)} u="V" />
          <Spec k="State of charge" v={fmt(a.soc, 0)} u="%" />
          <Spec k="Cranking amps" v={fmt(a.mca, 0)} u="MCA" />
          <Spec k="Model" v={b.model || '—'} tx />
          <Spec k="In service" v={monthYear(b.inService)} tx />
          <Spec k="Robot cycles" v={String(b.cycles)} />
          <Spec k="Tests logged" v={String(tests.length)} />
        </div>
        <div className="d-actions">
          {!b.retired && <button className="btn primary block" onClick={() => nav(`/log?b=${b.id}`)}><Icon name="plus" />Log test</button>}
          {!b.retired && <button className="btn block" onClick={() => setActions(true)}>Move in rotation</button>}
          {!b.retired && (isAdmin
            ? <button className="btn block" onClick={() => { setReason(pendingFlag?.reason ?? ''); setRetiring('retire'); }}>Retire</button>
            : <button className="btn block" disabled={!!pendingFlag} onClick={() => { setReason(''); setRetiring('flag'); }}>{pendingFlag ? 'Retirement requested' : 'Flag for retirement'}</button>)}
          {b.retired && isAdmin && <button className="btn block" onClick={() => act.unretire(b).then(() => toast(`${b.label} back in service`))}>Return to service</button>}
          {isAdmin && <button className="btn block" onClick={() => setEditing(true)}>Edit details</button>}
        </div>
      </div>

      {b.retired && (
        <div className="callout inv"><Mk level="retired" lg /><div><div className="ct">Retired{b.retiredAt ? ` ${shortDate(b.retiredAt)}` : ''}</div><div className="cd">{b.retiredReason || 'No reason recorded.'}</div></div><div /></div>
      )}
      {pendingFlag && !b.retired && (
        <div className="callout"><Icon name="flag" /><div><div className="ct">Retirement requested by {pendingFlag.by}</div><div className="cd">“{pendingFlag.reason}” · {ago(pendingFlag.at, now)}{isAdmin ? '' : '. An admin will review it.'}</div></div>
          {isAdmin ? <div className="row-acts"><button className="btn sm" onClick={() => act.resolveFlag(pendingFlag, true).then(() => toast(`${b.label} retired`))}>Approve</button><button className="btn sm" onClick={() => act.resolveFlag(pendingFlag, false).then(() => toast('Dismissed'))}>Dismiss</button></div> : <div />}
        </div>
      )}
      {!b.retired && a.reasons.length > 0 && (
        <div className={`callout${a.health === 'pull' ? ' inv' : ''}`}>
          <Mk level={a.health} lg />
          <div><div className="ct">{a.health === 'pull' ? 'Pull this battery from match rotation' : 'On watch: practice only'}</div><div className="cd">{a.reasons.map((r) => r.text).join('. ')}.</div></div>
          {showProjection ? <div className="cbig"><b>≈ {dateFar(now + projDays! * DAY, now)}</b><span>Projected to hit limit</span></div> : <div />}
        </div>
      )}
      {!b.retired && a.health === 'ok' && showProjection && (
        <div className="callout"><Mk level="ok" lg /><div><div className="ct">Healthy, slowly aging</div><div className="cd">IR is rising {a.trend!.perWeek.toFixed(2)} mΩ per week.</div></div>
          <div className="cbig"><b>≈ {dateFar(now + projDays! * DAY, now)}</b><span>Projected to hit limit</span></div></div>
      )}

      <section className="panel">
        <div className="ph"><h2>Internal resistance over time</h2>
          <div className="legend"><span><i className="lg-line" />Measured</span><span><i className="lg-dash" />Projected trend</span><span><i className="lg-band" />Watch zone {s.irWatch}–{s.irMax} <span className="u">mΩ</span></span></div>
        </div>
        <div className="pb"><IrChart tests={tests} limit={s.irMax} watch={s.irWatch} now={now} trend={a.trend} /></div>
      </section>

      <div className="minis">
        <Mini name="Cranking amps" v={fmt(a.mca, 0)} u="MCA" cap={lastMca && firstMca && lastMca !== firstMca ? `AutoMeter, every ${s.mcaEvery} tests. ${firstMca.mca! - lastMca.mca! >= 0 ? 'Down' : 'Up'} ${Math.abs(firstMca.mca! - lastMca.mca!)} since ${shortDate(firstMca.at)}.` : `AutoMeter, every ${s.mcaEvery} tests.`}>
          <MiniChart tests={tests} field="mca" floor={s.mcaFloor} now={now} />
        </Mini>
        <Mini name="Open-load voltage" v={fmt(a.v0, 2)} u="V" cap={`Beak. Dashed line = ${s.v0Watch.toFixed(1)} V fresh-off-charger floor.`}>
          <MiniChart tests={tests} field="v0" floor={s.v0Watch} now={now} />
        </Mini>
        <Mini name="Charge at test" v={fmt(a.soc, 0)} u="%" cap={tests.some((t) => t.soc != null && t.soc < s.socMin) ? `Some tests were under ${s.socMin}%. Treat those readings with care.` : `Every test was taken at ≥ ${s.socMin}%. Readings are trustworthy.`}>
          <MiniChart tests={tests} field="soc" floor={s.socMin} now={now} />
        </Mini>
      </div>

      <div className="two">
        <section className="panel">
          <div className="ph"><h2>Test history</h2><span className="note">{tests.length} tests · newest first</span></div>
          {tests.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Date</th><th className="r">IR</th><th className="r">V₀</th><th className="r">SoC</th><th className="r">MCA</th><th>By</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {[...tests].reverse().map((t) => (
                  <tr key={t.id} title={t.notes || undefined}>
                    <td>{shortDate(t.at)}{t.notes ? <span className="mute"> ✎</span> : null}</td>
                    <td className="r"><b>{fmt(t.ir, 1)}</b></td><td className="r">{fmt(t.v0, 2)}</td>
                    <td className="r">{t.soc != null ? `${t.soc}%` : '—'}</td><td className="r">{fmt(t.mca, 0)}</td>
                    <td className="mute">{t.by || '—'}</td>
                    {isAdmin && <td><button className="x-btn" title="Delete this test" onClick={() => { if (confirm(`Delete the ${shortDate(t.at)} test?`)) act.deleteTest(t.id).then(() => toast('Test deleted')); }}><Icon name="x" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No tests yet. <Link to={`/log?b=${b.id}`}>Log the first one</Link>.</div>}
        </section>
        <section className="panel">
          <div className="ph"><h2>Match history</h2><span className="note">From robot logs</span></div>
          {runs.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Match</th><th className="r">Min V</th><th className="r">Peak A</th><th className="r">Used</th><th className="r">Brownouts</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}><td>{r.event ? `${r.event} · ` : ''}{r.match}</td>
                    <td className="r"><b>{fmt(r.minV, 1)}</b> V</td><td className="r">{fmt(r.peakA, 0)} A</td><td className="r">{fmt(r.energyWh, 1)} Wh</td>
                    <td className="r">{r.brownouts ? <span className="inv-tag">{r.brownouts}</span> : <span className="mute">{r.brownouts ?? '—'}</span>}</td></tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No match data yet.{isAdmin && <> Import a log summary on the <Link to="/imports">Import</Link> page.</>}</div>}
        </section>
      </div>

      {actions && <BatteryActions battery={b} onClose={() => setActions(false)} />}
      {retiring && (
        <Modal title={retiring === 'retire' ? `Retire ${b.label}` : `Flag ${b.label} for retirement`} onClose={() => setRetiring(null)}
          footer={<><button className="btn" onClick={() => setRetiring(null)}>Cancel</button>
            <button className="btn primary" disabled={retiring === 'flag' && !reason.trim()} onClick={async () => {
              if (retiring === 'retire') await act.retire(b, reason.trim());
              else await act.flag(b, reason.trim());
              toast(retiring === 'retire' ? `${b.label} retired` : 'Request sent to admins');
              setRetiring(null);
            }}>{retiring === 'retire' ? 'Retire' : 'Send request'}</button></>}>
          <p>{retiring === 'retire' ? 'It stays in the records and stats but leaves the rotation. Tag the case so nobody grabs it.' : 'An admin reviews the request. The battery stays in service until then.'}</p>
          <label className="lab"><span className="k-lab">Reason</span>
            <input className="in" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`IR past ${s.irMax} mΩ and climbing`} /></label>
          {a.health !== 'ok' && <p className="mute">Current status: {HEALTH_LABEL[a.health]}. {a.reasons.map((r) => r.text).join('. ')}</p>}
        </Modal>
      )}
      {editing && <EditBattery id={b.id} onClose={() => setEditing(false)} />}
    </section>
  );
}

function Spec({ k, v, u, tx }: { k: string; v: string; u?: string; tx?: boolean }) {
  return <div className="spec"><div className="k-lab">{k}</div><div className={`v${tx ? ' tx' : ''}`}>{v}{u && v !== '—' && <small className="u">{u}</small>}</div></div>;
}
function Mini({ name, v, u, cap, children }: { name: string; v: string; u: string; cap: string; children: React.ReactNode }) {
  return <div className="mini"><div className="mini-h"><span className="k-lab">{name}</span><b>{v}{v !== '—' && <small className="u">{u}</small>}</b></div>{children}<div className="cap">{cap}</div></div>;
}

function EditBattery({ id, onClose }: { id: string; onClose: () => void }) {
  const { battery, act, toast } = useStore();
  const b = battery(id)!;
  const [model, setModel] = useState(b.model ?? '');
  const [inService, setInService] = useState(b.inService ?? '');
  const [cycles, setCycles] = useState(String(b.cycles));
  const [notes, setNotes] = useState(b.notes ?? '');
  return (
    <Modal title={`Edit ${b.label}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => {
        await act.updateBattery(b.id, { model, inService, cycles: Math.max(0, parseInt(cycles) || 0), notes });
        toast('Saved'); onClose();
      }}>Save</button></>}>
      <label className="lab"><span className="k-lab">Model</span><input className="in" value={model} onChange={(e) => setModel(e.target.value)} /></label>
      <label className="lab"><span className="k-lab">In service since</span><input className="in" type="month" value={inService} onChange={(e) => setInService(e.target.value)} /></label>
      <label className="lab"><span className="k-lab">Robot cycles</span><input className="in" inputMode="numeric" value={cycles} onChange={(e) => setCycles(e.target.value)} /></label>
      <label className="lab"><span className="k-lab">Notes</span><textarea className="txt" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    </Modal>
  );
}
