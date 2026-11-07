/* Pit mode: a glanceable wall display for the pit monitor.
   Practice view during build season, competition view at events. */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { BRAND } from '../../brand';
import { byStanding } from '../sheet/shared';
import { BatteryActions } from '../../components/BatteryActions';
import { Icon, useNow } from '../../components/ui';
import { SYSCHECK, chargeStatus, heldOut, savedForComp } from '../../lib/domain';
import { pickSystemsCheck, planMatches, type PlanRow } from '../../lib/plan';
import { clock, fmt, minutesSince, mmss } from '../../lib/format';
import type { Battery } from '../../lib/types';

export function Pit() {
  const { data, mode } = useStore();
  const [params, setParams] = useSearchParams();
  const now = useNow(1000);
  const [sel, setSel] = useState<Battery | null>(null);
  const view = (params.get('view') as 'practice' | 'comp' | null) ?? data.event.mode;
  const toggle = () => setParams({ view: view === 'comp' ? 'practice' : 'comp' }, { replace: true });

  return (
    <div className="pit">
      <header className="p-top">
        <div className="p-cell"><span className="p-mark">{BRAND.mark}</span><span className="p-name">{BRAND.name}</span></div>
        <div className="p-cell"><button className={`p-session${view === 'comp' ? ' live' : ''}`} onClick={toggle} title="Switch view">
          {view === 'comp' ? (data.event.name || 'Competition') : 'Practice'}</button></div>
        <div className="sp" />
        <div className="p-cell"><button className="p-link" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()}><Icon name="expand" /></button></div>
        <div className="p-cell"><Link className="p-link" to="/">Datasheet</Link></div>
        <div className="p-cell"><span className={`p-sync${mode === 'local' ? ' local' : ''}`}><i />{mode === 'cloud' ? 'Live' : 'Demo'}</span></div>
        <div className="p-cell p-clock">{clock(now)}</div>
      </header>
      {view === 'comp' ? <Comp now={now} onPick={setSel} /> : <Practice now={now} onPick={setSel} />}
      {sel && <BatteryActions battery={sel} onClose={() => setSel(null)} dark />}
    </div>
  );
}

type Pick = (b: Battery) => void;

/** Battery warnings across the top. Each can be dismissed (it comes back if the warning changes),
    and dismissed ones stay listed behind a toggle. */
function Signals() {
  const { active, health, act, toast } = useStore();
  const [open, setOpen] = useState(false);
  const items = [
    ...active.filter((b) => health[b.id].health === 'pull' && b.state !== 'shelf' && !heldOut(b))
      .map((b) => ({ b, pull: true, text: health[b.id].reasons.find((r) => r.level === 'pull')?.text ?? 'Failed a check' })),
    ...active.filter((b) => health[b.id].health === 'watch' && b.state === 'ready' && !heldOut(b))
      .map((b) => ({ b, pull: false, text: health[b.id].reasons[0]?.text ?? 'Below competition thresholds' })),
  ];
  const shown = items.filter((x) => x.b.warnAck?.text !== x.text);
  const hidden = items.filter((x) => x.b.warnAck?.text === x.text);
  const row = (x: (typeof items)[number], dismissed: boolean) => (
    <div key={x.b.id} className={`p-sig${dismissed ? ' off' : ''}`} style={{ ['--c' as string]: x.pull ? 'var(--stop)' : 'var(--warn)' }}>
      <span className="sk">{x.pull ? 'PULL' : 'PRACTICE'}</span><span className="sid">{x.b.label}</span>
      <span className="sd">{x.text}. {x.pull ? 'Not for matches; fine for a systems check.' : 'Not for matches.'}
        {dismissed && x.b.warnAck && <em> Dismissed by {x.b.warnAck.by || 'someone'} at {clock(x.b.warnAck.at)}.</em>}</span>
      <span className="sv">{fmt(health[x.b.id].ah, 1)} <span className="u">Ah</span></span>
      <button className="p-x" title={dismissed ? 'Show this warning again' : 'Dismiss'} onClick={() =>
        act.ackWarning(x.b, dismissed ? null : x.text).then(() => toast(dismissed ? `${x.b.label} warning is back` : `${x.b.label} warning dismissed`))}>
        {dismissed ? 'Show again' : <Icon name="x" />}</button>
    </div>
  );
  if (!items.length) return <div className="p-sigs" />;
  return (
    <div className="p-sigs">
      {shown.map((x) => row(x, false))}
      {hidden.length > 0 && (
        <button className="p-sig-more" onClick={() => setOpen(!open)}>
          {hidden.length} dismissed warning{hidden.length > 1 ? 's' : ''} · {open ? 'hide' : 'show'}
        </button>
      )}
      {open && hidden.map((x) => row(x, true))}
    </div>
  );
}

function ChargingList({ now, onPick, compact }: { now: number; onPick: Pick; compact?: boolean }) {
  const { active, data, health } = useStore();
  const s = data.settings;
  const rows = active.filter((b) => b.state === 'charging').map((b) => ({ b, c: chargeStatus(b, s, now) })).sort((x, y) => x.c.remainingMin - y.c.remainingMin);
  if (!rows.length) return <div className="p-empty">Nothing on the chargers.</div>;
  return <>{rows.map(({ b, c }) => {
    const left = c.remainingMin;
    const stale = health[b.id].stale;
    const val = left <= 0 ? <>FULL</> : left < 60 ? <>{Math.ceil(left)}<small>min</small></> : <>{Math.floor(left / 60)}h {Math.ceil(left % 60)}<small>m</small></>;
    return (
      <div key={b.id} className={`p-row${left <= 10 ? ' go' : ''}${stale ? ' warn' : ''}`} onClick={() => onPick(b)}>
        <div className="p-row-top"><b>{b.label}</b><span className="val">{val}</span></div>
        <div className="p-bar"><i style={{ width: `${Math.max(3, (c.soc / s.socTarget) * 100)}%` }} /></div>
        {!compact && <div className="sub">{stale ? (health[b.id].lastTestAt ? 'Overdue for a test. Test it when it comes off.' : 'Never tested. Test it when it comes off.') : `${Math.round(c.soc)}%${c.checked ? ' (Beak check)' : ' est.'} · test right off the charger`}</div>}
      </div>
    );
  })}</>;
}

function Practice({ now, onPick }: { now: number; onPick: Pick }) {
  const { active, health } = useStore();
  const ready = active.filter((b) => b.state === 'ready').sort(byStanding(health));
  // batteries saved for competition (or held out) are never the practice pick
  const next = ready.find((b) => health[b.id].health === 'ok' && !b.quarantined);
  const rest = ready.filter((b) => b !== next);
  const robot = active.filter((b) => b.state === 'robot');
  const nCharging = active.filter((b) => b.state === 'charging').length;

  return (
    <div className="pv practice">
      <Signals />
      <main className="pg">
        <section className="pp accent hero">
          <div className="pp-h"><span className="ix">01</span>Grab next</div>
          {next ? <>
            <div className="p-id" onClick={() => onPick(next)}>{next.label}</div>
            <div className="p-stats">
              <div className="p-stat"><b>#{health[next.id].rank}</b><span>Capacity rank</span></div>
              <div className="p-stat"><b>{fmt(health[next.id].ah, 1)}</b><span>Amp-hours</span></div>
              <div className="p-stat"><b>{mmss(minutesSince(next.stateSince, now) * 60)}</b><span>Ready for</span></div>
            </div>
          </> : <div className="p-empty" style={{ marginTop: 8 }}>Nothing is match-ready. Test the battery closest to full.</div>}
          {rest.length > 0 && (
            <div className="p-then"><div className="p-sub-h">{next ? 'Then' : 'Ready, but not for matches'}</div>
              {rest.map((b) => {
                const h = health[b.id].health;
                return (
                  <div key={b.id} className="p-line" onClick={() => onPick(b)} style={{ ['--c' as string]: h === 'pull' ? 'var(--stop)' : 'var(--warn)' }}>
                    <b>{b.label}</b><span>{health[b.id].rank && health[b.id].tier === 'competition' ? `#${health[b.id].rank} · ` : ''}{fmt(health[b.id].ah, 1)} <span className="u">Ah</span></span>
                    {heldOut(b) ? <em>HELD OUT</em> : savedForComp(b) ? <em style={{ color: 'var(--go)' }}>SAVED FOR COMP</em> : h === 'watch' ? <em>PRACTICE ONLY</em> : h === 'pull' ? <em>NOT SUITABLE</em> : h === 'untested' ? <em>NEEDS TESTS</em> : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="pp charging"><div className="pp-h"><span className="ix">02</span>Charging<span className="n">{nCharging}</span></div><ChargingList now={now} onPick={onPick} /></section>
        <section className="pp">
          <div className="pp-h"><span className="ix">03</span>In robot<span className="n">{robot.length}</span></div>
          {robot.length ? robot.map((b) => (
            <div key={b.id} className="p-row" onClick={() => onPick(b)}>
              <div className="p-row-top"><b>{b.label}</b><span className="val">{mmss(minutesSince(b.stateSince, now) * 60)}</span></div>
              <div className="sub">{b.robotFor === SYSCHECK ? 'Systems check · back on a charger after' : 'Swap before it sags'}</div>
            </div>
          )) : <div className="p-empty">No battery in the robot.</div>}
        </section>
      </main>
    </div>
  );
}

function Comp({ now, onPick }: { now: number; onPick: Pick }) {
  const { data, health, battery, act, toast, active, isAdmin } = useStore();
  const s = data.settings;
  const ev = data.event;
  // re-plan every 15 s, not every tick
  const planNow = Math.floor(now / 15000) * 15000;
  const rows = useMemo(() => planMatches(data.batteries, health, s, ev, planNow), [data.batteries, health, s, ev, planNow]);

  const onField = rows.find((r) => r.status === 'field');
  const next = rows.find((r) => r.status !== 'field');
  const robot = active.find((b) => b.state === 'robot');
  const matchesLeft = rows.filter((r) => r.status !== 'field').length;

  if (!ev.matches.length) {
    return (
      <div className="pv comp">
        <div className="pp" style={{ gridRow: '1 / -1' }}>
          <div className="pp-h">No schedule</div>
          <div className="p-empty">{isAdmin ? <>Add the match schedule in Settings → Event (or pull it from The Blue Alliance), then this screen plans a battery for every match.</> : 'No match schedule yet. Ask an admin to add it in Settings.'}</div>
        </div>
      </div>
    );
  }

  const nb = next?.batteryId ? battery(next.batteryId) : undefined;
  const isInstalled = next?.status === 'installed';
  const queueIn = next ? (next.needBy - now) / 1000 : null;
  const sys = robot?.robotFor === SYSCHECK ? null : pickSystemsCheck(active, health, rows);
  const install = (b: Battery, forWhat: string, msg: string) => {
    const prev = active.find((x) => x.state === 'robot' && x.id !== b.id);
    (prev ? act.move(prev, 'charging') : Promise.resolve()).then(() => act.move(b, 'robot', forWhat)).then(() => toast(msg));
  };

  const setAssign = (key: string, batteryId: string) => {
    const assignments = { ...ev.assignments };
    if (batteryId) assignments[key] = batteryId; else delete assignments[key];
    act.saveEvent({ ...ev, assignments }).then(() => toast(batteryId ? 'Assignment locked' : 'Back to auto'));
  };

  return (
    <div className="pv comp">
      <div className="p-timing">
        <div className={`p-tc${robot ? ' tap' : ''}`} onClick={() => robot && onPick(robot)} title={robot ? `${robot.label} is in the robot` : undefined}><div className="tk">{onField ? 'On field' : 'In robot'}</div><div className="tv">{onField ? <>{onField.match.label}<small>{onField.batteryId ? battery(onField.batteryId)?.label : ''}</small></> : robot ? <>{robot.label}<small>{robot.robotFor === SYSCHECK ? 'systems check' : 'tap to take out'}</small></> : <>—</>}</div></div>
        <div className="p-tc"><div className="tk">Next match</div><div className="tv">{next ? <>{next.match.label}<small>{clock(next.match.time)}</small></> : '—'}</div></div>
        <div className={`p-tc${queueIn != null && queueIn < 0 ? ' late' : ' go'}`}><div className="tk">{queueIn != null && queueIn < 0 ? 'Queue overdue' : 'Queue in'}</div><div className="tv">{queueIn != null ? mmss(Math.abs(queueIn)) : '—'}</div></div>
        <div className="p-tc"><div className="tk">{isInstalled ? 'Installed' : 'Install'}</div><div className="tv">{nb ? <>{nb.label}<small>{isInstalled ? 'in robot' : `by ${clock(next!.needBy)}`}</small></> : '—'}</div></div>
        <div className="p-tc"><div className="tk">Matches left</div><div className="tv">{matchesLeft}<small>of {ev.matches.length}</small></div></div>
      </div>
      <Signals />
      <main className="cg">
        <section className="pp accent">
          <div className="pp-h"><span className="ix">01</span>{next?.status === 'installed' ? 'Installed for' : 'Install for'} {next?.match.label ?? '—'}</div>
          {nb && next?.status === 'installed' ? <>
            <div className="p-id sm" onClick={() => onPick(nb)}>{nb.label}</div>
            <div className="p-stats">
              <div className="p-stat"><b>#{health[nb.id].rank}</b><span>Capacity rank</span></div>
              <div className="p-stat"><b>{fmt(health[nb.id].ah, 1)}</b><span>Amp-hours</span></div>
              <div className="p-stat"><b>{mmss(minutesSince(nb.stateSince, now) * 60)}</b><span>In robot for</span></div>
            </div>
            <div className="p-done"><Icon name="tick" />In the robot. Queue by {clock(next.needBy)}.</div>
          </> : nb ? <>
            <div className="p-id sm" onClick={() => onPick(nb)}>{nb.label}</div>
            <div className="p-stats">
              <div className="p-stat"><b>#{health[nb.id].rank}</b><span>Capacity rank</span></div>
              <div className="p-stat"><b>{fmt(health[nb.id].ah, 1)}</b><span>Amp-hours</span></div>
              <div className="p-stat"><b>{nb.state === 'ready' ? mmss(minutesSince(nb.stateSince, now) * 60) : nb.state === 'charging' ? `${Math.ceil(chargeStatus(nb, s, now).remainingMin)}m` : '—'}</b><span>{nb.state === 'ready' ? 'Ready for' : nb.state === 'charging' ? 'To full' : nb.state}</span></div>
            </div>
            {nb.state !== 'ready' && <div className="p-note">{nb.state === 'charging' ? `Still charging: about ${Math.max(1, Math.ceil(chargeStatus(nb, s, now).remainingMin))} min to full. Test it before it goes in.` : `It's ${nb.state === 'shelf' ? 'on the shelf' : 'not marked ready'}.`}</div>}
            <button className="p-install big" onClick={() => install(nb, next!.match.label, `${nb.label} is in the robot for ${next!.match.label}`)}>
              It’s in the robot now</button>
          </> : <div className="p-empty">No usable battery for the next match. Check the charging list.</div>}
          <SystemsCheck robot={robot} pick={sys} busy={isInstalled} now={now} onPick={onPick}
            onUse={(b) => install(b, SYSCHECK, `${b.label} is in for a systems check`)}
            onDone={(b) => act.move(b, 'charging').then(() => toast(`${b.label} back on a charger (nearly full)`))} />
        </section>

        <section className="pp">
          <div className="pp-h"><span className="ix">02</span>Match plan<span className="n">Auto</span></div>
          <div style={{ overflow: 'auto', minHeight: 0 }}>
            <table className="plan"><thead><tr><th>Match</th><th>Time</th><th>Battery</th><th>Ah</th><th>Status</th></tr></thead>
              <tbody>{rows.slice(0, 10).map((r) => <PlanLine key={r.match.key} r={r} isNext={r === next} onAssign={setAssign} />)}</tbody>
            </table>
          </div>
        </section>

        <section className="pp">
          <div className="pp-h"><span className="ix">03</span>Charging<span className="n">{active.filter((b) => b.state === 'charging').length}</span></div>
          <ChargingList now={now} onPick={onPick} compact />
        </section>
      </main>
    </div>
  );
}

/** Systems checks use a worse battery: in, one check, out, back on a charger (it refills fast). */
function SystemsCheck({ robot, pick, busy, now, onPick, onUse, onDone }: {
  robot?: Battery; pick: Battery | null; busy: boolean; now: number; onPick: Pick; onUse: Pick; onDone: Pick;
}) {
  const { health } = useStore();
  if (robot?.robotFor === SYSCHECK) {
    return (
      <div className="p-sys on">
        <div className="p-sub-h">Systems check running</div>
        <div className="p-sys-row"><b onClick={() => onPick(robot)}>{robot.label}</b><span>{mmss(minutesSince(robot.stateSince, now) * 60)} in the robot</span></div>
        <button className="p-install" onClick={() => onDone(robot)}>Done → back on a charger</button>
      </div>
    );
  }
  if (!pick) return null;
  const h = health[pick.id];
  const why = h.health === 'watch' ? 'practice battery' : h.health === 'pull' ? 'failed a check, fine for this' : 'lowest capacity that’s free';
  return (
    <div className="p-sys">
      <div className="p-sub-h">Systems check</div>
      <div className="p-sys-row"><b onClick={() => onPick(pick)}>{pick.label}</b><span>{fmt(h.ah, 1)} Ah · {why}</span></div>
      <button className="p-install" disabled={busy} title={busy ? 'The match battery is already in' : undefined} onClick={() => onUse(pick)}>
        {busy ? 'Match battery is in' : 'In for a systems check'}</button>
    </div>
  );
}

function PlanLine({ r, isNext, onAssign }: { r: PlanRow; isNext: boolean; onAssign: (key: string, id: string) => void }) {
  const { battery, health, active } = useStore();
  const b = r.batteryId ? battery(r.batteryId) : undefined;
  const cls = r.status === 'field' ? 'cur' : isNext ? 'nextm' : r.status === 'tight' ? 'tight' : r.status === 'none' ? 'none' : '';
  const [label, color] =
    r.status === 'field' ? ['On field', 'var(--ink-2)']
    : r.status === 'installed' ? ['Installed', 'var(--go)']
    : r.status === 'ready' ? ['Ready', 'var(--go)']
    : r.status === 'charging' ? [`Full by ${clock(r.readyAt!)}`, 'var(--ink-2)']
    : r.status === 'tight' ? [`Tight · ${Math.ceil(r.lateMin)} min late`, 'var(--warn)']
    : ['No battery', 'var(--stop)'];
  return (
    <tr className={cls}>
      <td className="m">{r.match.label}</td>
      <td>{clock(r.match.time)}</td>
      <td className="bt">
        {r.status === 'field' ? (b?.label ?? '—') : (
          <select value={r.manual ? r.batteryId ?? '' : ''} onChange={(e) => onAssign(r.match.key, e.target.value)} title="Change battery">
            <option value="">{b ? b.label : '—'}</option>
            {active.filter((x) => health[x.id].health !== 'pull').sort(byStanding(health)).map((x) => <option key={x.id} value={x.id}>{x.label}{health[x.id].health === 'watch' ? ' (practice)' : health[x.id].rank ? ` (#${health[x.id].rank})` : ''}</option>)}
          </select>
        )}
        {r.manual && <span className="st" style={{ marginLeft: 6 }}>Locked</span>}
      </td>
      <td>{b ? fmt(health[b.id].ah, 1) : '—'}</td>
      <td className="st" style={{ ['--c' as string]: color }}>{label}</td>
    </tr>
  );
}

