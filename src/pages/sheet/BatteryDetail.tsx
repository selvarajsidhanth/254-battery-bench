import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { MiniChart, TimeChart } from '../../components/charts';
import { BatteryActions } from '../../components/BatteryActions';
import { RunTable } from './Matches';
import { HEALTH_LABEL, Icon, Mk, Modal, StateLabel, StatusTag } from '../../components/ui';
import { chargeStatus, kindOf, restRemainingMin } from '../../lib/domain';
import { DAY, ago, dateFar, dur, fmt, minutesSince, monthYear, shortDate } from '../../lib/format';
import type { TestRecord } from '../../lib/types';

const series = (tests: TestRecord[], key: 'ah' | 'rintPre' | 'mca' | 'ir') =>
  tests.filter((t) => t[key] != null).map((t) => ({ at: t.at, v: t[key] as number }));

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

  const stateMeta = b.state === 'charging' ? `~${dur(chargeStatus(b, s, now).remainingMin)} to full`
    : b.state === 'resting' ? (restRemainingMin(b, s, now) > 0 ? `${Math.ceil(restRemainingMin(b, s, now))} min rest left` : 'rested')
    : b.state === 'shelf' ? '' : dur(minutesSince(b.stateSince, now));
  const capProj = a.capTrend?.daysToLimit;
  const showCapProj = !b.retired && a.capTrend && a.capTrend.perWeek < -0.01 && capProj != null && (a.ah ?? 0) >= s.compMinAh;
  const tierTitle = a.tier === 'competition' ? `Competition battery · rank #${a.rank} of ${s.compCount}`
    : a.tier === 'practice' ? 'Practice and prototype only'
    : a.tier === 'none' ? 'Not suitable for practice or competition'
    : 'Needs bench tests before it can be rated';

  return (
    <section className="view">
      <div className="crumb"><Link to="/batteries">Batteries</Link><span>/</span><span>{b.label}</span></div>
      <div className="d-head">
        <div className="d-id">
          <div className="big">{b.label}</div>
          <div className="st">
            <StatusTag health={a.health} />
            {b.quarantined && !b.retired && <span className="inv-tag">Quarantined</span>}
            {!b.retired && <StateLabel state={b.state} extra={stateMeta ? <span className="mute">&nbsp;· {stateMeta}</span> : null} />}
          </div>
        </div>
        <div className="d-specs">
          <Spec k="Capacity rank" v={a.rank != null ? `#${a.rank}` : '—'} />
          <Spec k="Capacity" v={fmt(a.ah, 2)} u="Ah" />
          <Spec k="R_int before CBA" v={fmt(a.rintPre, 0)} u="mΩ" />
          <Spec k="MCA" v={fmt(a.mca, 0)} />
          <Spec k="Last CBA" v={a.lastCbaAt ? shortDate(a.lastCbaAt) : 'Never'} tx due={a.cbaDue} />
          <Spec k="Last MCA" v={a.lastMcaAt ? shortDate(a.lastMcaAt) : 'Never'} tx due={a.mcaDue} />
          <Spec k="Location" v={b.location || '—'} tx />
          <Spec k="Make · lot" v={[b.manufacturer, b.lotCode].filter(Boolean).join(' · ') || '—'} tx />
        </div>
        <div className="d-actions">
          {!b.retired && <button className="btn primary block" onClick={() => nav(`/log?b=${b.id}`)}><Icon name="plus" />Log test</button>}
          {!b.retired && <button className="btn block" onClick={() => setActions(true)}>Move in rotation</button>}
          {!b.retired && (isAdmin
            ? <button className="btn block" onClick={() => { setReason(pendingFlag?.reason ?? ''); setRetiring('retire'); }}>Decommission</button>
            : <button className="btn block" disabled={!!pendingFlag} onClick={() => { setReason(''); setRetiring('flag'); }}>{pendingFlag ? 'Retirement requested' : 'Flag for retirement'}</button>)}
          {b.retired && isAdmin && <button className="btn block" onClick={() => act.unretire(b).then(() => toast(`${b.label} back in service`))}>Return to service</button>}
          {isAdmin && <button className="btn block" onClick={() => setEditing(true)}>Edit details</button>}
        </div>
      </div>

      {b.retired ? (
        <div className="callout inv"><Mk level="retired" lg /><div><div className="ct">Decommissioned{b.retiredAt ? ` ${shortDate(b.retiredAt)}` : ''}</div><div className="cd">{b.retiredReason || 'No reason recorded.'}</div></div><div /></div>
      ) : (
        <div className={`callout${a.health === 'pull' ? ' inv' : ''}`}>
          <Mk level={a.health} lg />
          <div><div className="ct">{tierTitle}</div>
            <div className="cd">{a.reasons.length ? a.reasons.map((r) => r.text).join('. ') + '.' : `Passes every competition threshold: ≥ ${s.compMinAh} Ah, ≤ ${s.compMaxRint} mΩ, ≥ ${s.compMinMca} MCA.`}
              {(a.cbaDue || a.mcaDue) && a.tier !== 'incomplete' && <b> {[a.cbaDue && 'CBA', a.mcaDue && 'MCA'].filter(Boolean).join(' and ')} test due.</b>}</div></div>
          {showCapProj ? <div className="cbig"><b>≈ {dateFar(now + capProj! * DAY, now)}</b><span>Capacity below {s.compMinAh} Ah</span></div> : <div />}
        </div>
      )}
      {pendingFlag && !b.retired && (
        <div className="callout"><Icon name="flag" /><div><div className="ct">Retirement requested by {pendingFlag.by}</div><div className="cd">“{pendingFlag.reason}” · {ago(pendingFlag.at, now)}{isAdmin ? '' : '. An admin will review it.'}</div></div>
          {isAdmin ? <div className="row-acts"><button className="btn sm" onClick={() => act.resolveFlag(pendingFlag, true).then(() => toast(`${b.label} retired`))}>Approve</button><button className="btn sm" onClick={() => act.resolveFlag(pendingFlag, false).then(() => toast('Dismissed'))}>Dismiss</button></div> : <div />}
        </div>
      )}

      <section className="panel">
        <div className="ph"><h2>Capacity over time</h2>
          <div className="legend"><span><i className="lg-line" />CBA amp-hours</span><span><i className="lg-dash" />Projected trend</span><span><i className="lg-band" />Practice only, {s.pracMinAh}–{s.compMinAh} Ah</span></div>
        </div>
        <div className="pb">
          <TimeChart points={series(tests, 'ah')} now={now} trend={a.capTrend} digits={2} emptyText="No CBA tests yet. Log one to start the capacity history."
            guides={[{ v: s.compMinAh, label: `COMPETITION ${s.compMinAh}`, strong: true }, { v: s.pracMinAh, label: `PRACTICE ${s.pracMinAh}` }]} />
        </div>
      </section>

      <div className="minis">
        <Mini name="R_int before CBA" v={fmt(a.rintPre, 0)} u="mΩ" cap={`Dashed line = ${s.compMaxRint} mΩ competition maximum (practice ${s.pracMaxRint}).`}>
          <MiniChart points={series(tests, 'rintPre')} floor={s.compMaxRint} now={now} />
        </Mini>
        <Mini name="Cranking amps" v={fmt(a.mca, 0)} u="MCA" cap={`Dashed line = ${s.compMinMca} competition minimum (practice ${s.pracMinMca}).`}>
          <MiniChart points={series(tests, 'mca')} floor={s.compMinMca} now={now} />
        </Mini>
        <Mini name="Beak IR" v={fmt(a.ir, 1)} u="mΩ" cap={a.lastBeakAt ? `Pit check. Dashed line = ${s.irMax} mΩ pit limit. Last ${shortDate(a.lastBeakAt)}.` : 'Pit check with the Battery Beak. None logged yet.'}>
          <MiniChart points={series(tests, 'ir')} floor={s.irMax} now={now} />
        </Mini>
      </div>

      <div className="two">
        <section className="panel">
          <div className="ph"><h2>Test history</h2><span className="note">{tests.length} tests · newest first</span></div>
          {tests.length ? (
            <div className="tablewrap"><table>
              <thead><tr><th>Date</th><th>Test</th><th>Result</th><th>By</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {[...tests].reverse().map((t) => (
                  <tr key={t.id} title={t.notes || undefined}>
                    <td>{shortDate(t.at)} <span className="mute">{new Date(t.at).getFullYear() !== new Date(now).getFullYear() ? new Date(t.at).getFullYear() : ''}</span></td>
                    <td><span className="out-tag">{kindOf(t) === 'cba' ? 'CBA' : kindOf(t) === 'mca' ? 'MCA' : 'Beak'}</span></td>
                    <td className="wrap"><TestResult t={t} />{t.notes ? <span className="mute"> · {t.notes}</span> : null}</td>
                    <td className="mute">{t.by || '—'}</td>
                    {isAdmin && <td><button className="x-btn" title="Delete this test" onClick={() => { if (confirm(`Delete the ${shortDate(t.at)} test?`)) act.deleteTest(t.id).then(() => toast('Test deleted')); }}><Icon name="x" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty">No tests yet. <Link to={`/log?b=${b.id}`}>Log the first one</Link>.</div>}
        </section>
        <section className="panel">
          <div className="ph"><h2>Match history</h2><span className="note"><Link to="/matches">From robot logs</Link></span></div>
          <RunTable runs={runs} />
        </section>
      </div>

      {actions && <BatteryActions battery={b} onClose={() => setActions(false)} />}
      {retiring && (
        <Modal title={retiring === 'retire' ? `Decommission ${b.label}` : `Flag ${b.label} for retirement`} onClose={() => setRetiring(null)}
          footer={<><button className="btn" onClick={() => setRetiring(null)}>Cancel</button>
            <button className="btn primary" disabled={retiring === 'flag' && !reason.trim()} onClick={async () => {
              if (retiring === 'retire') await act.retire(b, reason.trim());
              else await act.flag(b, reason.trim());
              toast(retiring === 'retire' ? `${b.label} decommissioned` : 'Request sent to admins');
              setRetiring(null);
            }}>{retiring === 'retire' ? 'Decommission' : 'Send request'}</button></>}>
          <p>{retiring === 'retire' ? 'It stays in the records but leaves the fleet. Tag the case so nobody grabs it.' : 'An admin reviews the request. The battery stays in service until then.'}</p>
          <label className="lab"><span className="k-lab">Reason</span>
            <input className="in" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Capacity under ${s.pracMinAh} Ah`} /></label>
          {a.health !== 'ok' && <p className="mute">Current status: {HEALTH_LABEL[a.health]}. {a.reasons.map((r) => r.text).join('. ')}</p>}
        </Modal>
      )}
      {editing && <EditBattery id={b.id} onClose={() => setEditing(false)} />}
    </section>
  );
}

function TestResult({ t }: { t: TestRecord }) {
  const k = kindOf(t);
  if (k === 'cba') return <><b>{fmt(t.ah, 2)} Ah</b> · R_int {fmt(t.rintPre, 0)} → {fmt(t.rintPost, 0)} mΩ{t.wh != null ? ` · ${t.wh.toFixed(1)} Wh` : ''}</>;
  if (k === 'mca') return <><b>{t.mca}</b> MCA</>;
  const parts = [t.ir != null && `IR ${t.ir.toFixed(1)} mΩ`, t.soc != null && `${t.soc}%`, t.v0 != null && `${t.v0.toFixed(2)} V`, t.mca != null && `${t.mca} MCA`].filter(Boolean);
  return <>{parts.join(' · ') || '—'}</>;
}

function Spec({ k, v, u, tx, due }: { k: string; v: string; u?: string; tx?: boolean; due?: boolean }) {
  return <div className="spec"><div className="k-lab">{k}{due && <span className="inv-tag" style={{ marginLeft: 6 }}>Due</span>}</div><div className={`v${tx ? ' tx' : ''}`}>{v}{u && v !== '—' && <small className="u">{u}</small>}</div></div>;
}
function Mini({ name, v, u, cap, children }: { name: string; v: string; u: string; cap: string; children: React.ReactNode }) {
  return <div className="mini"><div className="mini-h"><span className="k-lab">{name}</span><b>{v}{v !== '—' && <small className="u">{u}</small>}</b></div>{children}<div className="cap">{cap}</div></div>;
}

const LOCATIONS = ['AR Charger', 'Shop - TBT', 'Pit'];
function EditBattery({ id, onClose }: { id: string; onClose: () => void }) {
  const { battery, act, toast } = useStore();
  const b = battery(id)!;
  const [f, setF] = useState({
    manufacturer: b.manufacturer ?? '', lotCode: b.lotCode ?? '', location: b.location ?? '', quarantined: !!b.quarantined,
    inService: b.inService ?? '', cycles: String(b.cycles), notes: b.notes ?? '',
  });
  return (
    <Modal title={`Edit ${b.label}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => {
        await act.updateBattery(b.id, { ...f, cycles: Math.max(0, parseInt(f.cycles) || 0) });
        toast('Saved'); onClose();
      }}>Save</button></>}>
      <div className="form-grid">
        <label className="lab"><span className="k-lab">Manufacturer</span><input className="in" value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} /></label>
        <label className="lab"><span className="k-lab">Lot code</span><input className="in" value={f.lotCode} onChange={(e) => setF({ ...f, lotCode: e.target.value })} /></label>
      </div>
      <label className="lab"><span className="k-lab">Location</span>
        <input className="in" list="locations" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        <datalist id="locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist></label>
      <button className="ck" onClick={() => setF({ ...f, quarantined: !f.quarantined })}><span className={`box${f.quarantined ? ' on' : ''}`}>{f.quarantined && <Icon name="tick" />}</span>Quarantined for competition (kept for matches only)</button>
      <div className="form-grid">
        <label className="lab"><span className="k-lab">In service since</span><input className="in" type="month" value={f.inService} onChange={(e) => setF({ ...f, inService: e.target.value })} /></label>
        <label className="lab"><span className="k-lab">Robot cycles</span><input className="in" inputMode="numeric" value={f.cycles} onChange={(e) => setF({ ...f, cycles: e.target.value })} /></label>
      </div>
      <label className="lab"><span className="k-lab">Notes</span><textarea className="txt" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="mute" style={{ fontSize: 12 }}>In service: {monthYear(f.inService)}</p>
    </Modal>
  );
}
