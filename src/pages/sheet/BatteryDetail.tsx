import { useState } from 'react';
import { NTAG213_BYTES, tagBytes, tagUrl } from '../../lib/nfc';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { MiniChart, TimeChart } from '../../components/charts';
import { BatteryActions } from '../../components/BatteryActions';
import { RunTable } from './Matches';
import { HEALTH_LABEL, Icon, Mk, Modal, StateLabel, StatusTag } from '../../components/ui';
import { chargeStatus, kindOf } from '../../lib/domain';
import { DAY, ago, dateFar, dur, fmt, minutesSince, monthYear, shortDate, avgVolts } from '../../lib/format';
import type { TestRecord } from '../../lib/types';

const series = (tests: TestRecord[], key: 'ah' | 'wh' | 'rintPre' | 'mca' | 'ir') =>
  tests.filter((t) => t[key] != null).map((t) => ({ at: t.at, v: t[key] as number }));

export function BatteryDetail() {
  const { id } = useParams();
  const { battery, health, testsBy, runsBy, data, now, isAdmin, act, toast } = useStore();
  const nav = useNavigate();
  const b = battery(id);
  // opened from the battery's NFC tag (…#/b/<id>?tap): go straight to the actions
  const [params, setParams] = useSearchParams();
  const [actions, setActions] = useState(() => params.has('tap'));
  const [tagOpen, setTagOpen] = useState(false);
  const closeActions = () => { setActions(false); if (params.has('tap')) setParams({}, { replace: true }); };
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
            {b.quarantined && !b.retired && <span className="inv-tag" title={b.quarantineFor === 'hold' ? 'Quarantined: held out, don’t use' : 'Quarantined: saved for competition matches'}>{b.quarantineFor === 'hold' ? 'Held out' : 'Comp only'}</span>}
            {b.warnAck && !b.retired && <span className="out-tag" title={`Dismissed by ${b.warnAck.by || 'someone'} ${shortDate(b.warnAck.at)}: ${b.warnAck.text}`}>Pit warning dismissed</span>}
            {!b.retired && <StateLabel state={b.state} extra={stateMeta ? <span className="mute">&nbsp;· {stateMeta}</span> : null} />}
          </div>
        </div>
        <div className="d-specs">
          <Spec k="Capacity rank" v={a.rank != null ? `#${a.rank}` : '—'} />
          <Spec k="Capacity" v={fmt(a.ah, 2)} u="Ah" />
          <Spec k="Energy" v={fmt(a.wh, 1)} u="Wh" />
          <Spec k="Avg voltage (Wh ÷ Ah)" v={fmt(avgVolts(a.wh, a.ah), 2)} u="V" />
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
          {isAdmin && !b.retired && <button className="btn block" onClick={() => setTagOpen(true)}><Icon name="nfc" />NFC tag</button>}
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
        <Mini name="Energy (CBA)" v={fmt(a.wh, 1)} u="Wh" cap={avgVolts(a.wh, a.ah) != null ? `What the motors actually get. Average ${avgVolts(a.wh, a.ah)!.toFixed(2)} V over the last discharge; a falling average means more sag.` : 'What the motors actually get. Enter watt-hours from the CBA when you log a test.'}>
          <MiniChart points={series(tests, 'wh')} floor={null} now={now} />
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
          <div className="ph"><h2>Match history</h2><span className="note"><Link to="/matches">From robot logs</Link>{runs.length > 1 && <> · <Link to={`/matches/trends?b=${encodeURIComponent(b.id)}`}>Trends</Link></>}</span></div>
          <RunTable runs={runs} showGroup />
        </section>
      </div>

      {actions && <BatteryActions battery={b} onClose={closeActions} tap={params.has('tap')} />}
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
      {tagOpen && <TagSetup id={b.id} label={b.label} onClose={() => setTagOpen(false)} />}
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
    manufacturer: b.manufacturer ?? '', lotCode: b.lotCode ?? '', location: b.location ?? '', quarantined: !!b.quarantined, quarantineFor: b.quarantineFor ?? 'comp',
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
      <label className="lab"><span className="k-lab">Quarantine</span>
        <div className="seg">
          <button className={!f.quarantined ? 'on' : ''} onClick={() => setF({ ...f, quarantined: false })}>None</button>
          <button className={f.quarantined && f.quarantineFor === 'comp' ? 'on' : ''} onClick={() => setF({ ...f, quarantined: true, quarantineFor: 'comp' })}>Saved for competition</button>
          <button className={f.quarantined && f.quarantineFor === 'hold' ? 'on' : ''} onClick={() => setF({ ...f, quarantined: true, quarantineFor: 'hold' })}>Held out, don’t use</button>
        </div>
        <span className="mute" style={{ fontSize: 11.5 }}>{!f.quarantined ? 'In normal rotation.' : f.quarantineFor === 'comp' ? 'Kept for matches: not suggested for practice or systems checks.' : 'Never suggested for anything, e.g. while deciding whether to decommission it.'}</span>
      </label>
      <div className="form-grid">
        <label className="lab"><span className="k-lab">In service since</span><input className="in" type="month" value={f.inService} onChange={(e) => setF({ ...f, inService: e.target.value })} /></label>
        <label className="lab"><span className="k-lab">Robot cycles</span><input className="in" inputMode="numeric" value={f.cycles} onChange={(e) => setF({ ...f, cycles: e.target.value })} /></label>
      </div>
      <label className="lab"><span className="k-lab">Notes</span><textarea className="txt" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="mute" style={{ fontSize: 12 }}>In service: {monthYear(f.inService)}</p>
    </Modal>
  );
}

/** Admin: the link to write on this battery's NFC tag, and how to write it from an iPhone. */
function TagSetup({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const { toast } = useStore();
  const url = tagUrl(id);
  const bytes = tagBytes(url);
  const fits = bytes <= NTAG213_BYTES;
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast('Tag link copied'), () => toast('Couldn’t copy. Select the link and copy it.'));
  return (
    <Modal title={`NFC tag · ${label}`} onClose={onClose}
      footer={<><a className="btn sm" href={url.replace(/^.*#/, '#')} onClick={onClose}>Try the tap screen</a><button className="btn sm primary" onClick={copy}>Copy link</button></>}>
      <p>Write this link onto the tag. Any iPhone (XS or newer) that touches the tag opens {label} with its rotation actions. Android works too with NFC on.</p>
      <div className="tag-url"><code>{url}</code></div>
      <p className={`tag-fit${fits ? '' : ' warn'}`}>{bytes} of {NTAG213_BYTES} bytes on an NTAG213 · {fits ? 'fits' : 'too long for an NTAG213'}</p>
      <ol className="tag-steps">
        <li>On an iPhone, install the free <b>NFC Tools</b> app.</li>
        <li><b>Write</b> → <b>Add a record</b> → <b>URL / URI</b>, then paste the link (Copy link below).</li>
        <li>Tap <b>Write</b> and hold the top back of the phone to the tag until it says it’s done.</li>
        <li>Test it: lock the phone screen off and on, hold it to the tag, and tap the banner. {label} should open.</li>
        <li>Once it works, lock the tag (<b>Other</b> → <b>Lock tag</b>) so nobody overwrites it. Locking is permanent.</li>
      </ol>
      <p className="mute" style={{ fontSize: 12 }}>On-metal tags read from about 1–2 cm. Put the tag where a phone can reach it with the battery in the robot.</p>
    </Modal>
  );
}
