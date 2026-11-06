/* Pit mode: a glanceable wall display for the pit monitor.
   Practice view during build season, competition view at events. */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { BRAND } from '../../brand';
import { byStanding } from '../sheet/shared';
import { BatteryActions } from '../../components/BatteryActions';
import { Icon, useNow } from '../../components/ui';
import { chargeStatus } from '../../lib/domain';
import { planMatches, type PlanRow } from '../../lib/plan';
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

function Signals() {
  const { active, health } = useStore();
  const pulls = active.filter((b) => health[b.id].health === 'pull' && b.state !== 'shelf');
  const watches = active.filter((b) => health[b.id].health === 'watch' && b.state === 'ready');
  return (
    <div className="p-sigs">
      {pulls.map((b) => (
        <div key={b.id} className="p-sig" style={{ ['--c' as string]: 'var(--stop)' }}>
          <span className="sk">PULL</span><span className="sid">{b.label}</span>
          <span className="sd">{health[b.id].reasons.find((r) => r.level === 'pull')?.text ?? 'Failed a check'}. Don't use it.</span>
          <span className="sv">{fmt(health[b.id].ah, 1)} <span className="u">Ah</span></span>
        </div>
      ))}
      {watches.map((b) => (
        <div key={b.id} className="p-sig" style={{ ['--c' as string]: 'var(--warn)' }}>
          <span className="sk">PRACTICE</span><span className="sid">{b.label}</span>
          <span className="sd">{health[b.id].reasons[0]?.text ?? 'Below competition thresholds'}. Not for matches.</span>
          <span className="sv">{fmt(health[b.id].ah, 1)} <span className="u">Ah</span></span>
        </div>
      ))}
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
  const { active, health, data } = useStore();
  const ready = active.filter((b) => b.state === 'ready').sort(byStanding(health));
  const next = ready.find((b) => health[b.id].health === 'ok');
  const rest = ready.filter((b) => b !== next);
  const robot = active.filter((b) => b.state === 'robot');
  const nCharging = active.filter((b) => b.state === 'charging').length;
  const s = data.settings;

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
                    {h === 'watch' ? <em>PRACTICE ONLY</em> : h === 'pull' ? <em>NOT SUITABLE</em> : h === 'untested' ? <em>NEEDS TESTS</em> : null}
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
              <div className="sub">Swap before it sags</div>
            </div>
          )) : <div className="p-empty">No battery in the robot.</div>}
        </section>
      </main>
      <footer className="p-foot"><span>Competition <b>≥ {s.compMinAh} Ah · ≤ {s.compMaxRint} <span className="u">mΩ</span> · ≥ {s.compMinMca} MCA</b></span><span>Beak limit <b>{s.irMax} <span className="u">mΩ</span></b></span><span>Out of the robot <b>straight to a charger</b></span></footer>
    </div>
  );
}

const CHECKS = ['Beak tested fresh off the charger', 'Leads and case inspected', 'Main breaker OFF before seating', 'Anderson screw pin locked', 'Strapped down tight'];

function Comp({ now, onPick }: { now: number; onPick: Pick }) {
  const { data, health, battery, act, toast, active, isAdmin } = useStore();
  const s = data.settings;
  const ev = data.event;
  // re-plan every 15 s, not every tick
  const planNow = Math.floor(now / 15000) * 15000;
  const rows = useMemo(() => planMatches(data.batteries, health, s, ev, planNow), [data.batteries, health, s, ev, planNow]);
  const [checks, setChecks] = useState<Record<string, boolean[]>>({});

  const onField = rows.find((r) => r.status === 'field');
  const next = rows.find((r) => r.status !== 'field');
  const robot = active.find((b) => b.state === 'robot');
  const matchesLeft = rows.filter((r) => r.status !== 'field').length;

  if (!ev.matches.length) {
    return (
      <div className="pv comp">
        <div className="pp" style={{ gridRow: '1 / -1' }}>
          <div className="pp-h">No schedule</div>
          <div className="p-empty">{isAdmin ? 'Add the match schedule in Settings → Event (or pull it from The Blue Alliance), then this screen plans a battery for every match.' : 'No match schedule yet. Ask an admin to add it in Settings.'}</div>
        </div>
      </div>
    );
  }

  const nb = next?.batteryId ? battery(next.batteryId) : undefined;
  const queueIn = next ? (next.needBy - now) / 1000 : null;
  const ck = next ? checks[next.match.key] ?? CHECKS.map((_, i) => i < 2 && nb?.state === 'ready') : [];
  const setCk = (i: number) => next && setChecks({ ...checks, [next.match.key]: ck.map((v, j) => (j === i ? !v : v)) });

  const setAssign = (key: string, batteryId: string) => {
    const assignments = { ...ev.assignments };
    if (batteryId) assignments[key] = batteryId; else delete assignments[key];
    act.saveEvent({ ...ev, assignments }).then(() => toast(batteryId ? 'Assignment locked' : 'Back to auto'));
  };

  return (
    <div className="pv comp">
      <div className="p-timing">
        <div className="p-tc"><div className="tk">On field</div><div className="tv">{onField ? <>{onField.match.label}<small>{onField.batteryId ? battery(onField.batteryId)?.label : ''}</small></> : <>—<small>{robot ? `${robot.label} in robot` : ''}</small></>}</div></div>
        <div className="p-tc"><div className="tk">Next match</div><div className="tv">{next ? <>{next.match.label}<small>{clock(next.match.time)}</small></> : '—'}</div></div>
        <div className={`p-tc${queueIn != null && queueIn < 0 ? ' late' : ' go'}`}><div className="tk">{queueIn != null && queueIn < 0 ? 'Queue overdue' : 'Queue in'}</div><div className="tv">{queueIn != null ? mmss(Math.abs(queueIn)) : '—'}</div></div>
        <div className="p-tc"><div className="tk">Install</div><div className="tv">{nb ? <>{nb.label}<small>by {clock(next!.needBy)}</small></> : '—'}</div></div>
        <div className="p-tc"><div className="tk">Matches left</div><div className="tv">{matchesLeft}<small>of {ev.matches.length}</small></div></div>
      </div>
      <Signals />
      <main className="cg">
        <section className="pp accent">
          <div className="pp-h"><span className="ix">01</span>Install for {next?.match.label ?? '—'}</div>
          {nb ? <>
            <div className="p-id sm" onClick={() => onPick(nb)}>{nb.label}</div>
            <div className="p-stats">
              <div className="p-stat"><b>#{health[nb.id].rank}</b><span>Capacity rank</span></div>
              <div className="p-stat"><b>{fmt(health[nb.id].ah, 1)}</b><span>Amp-hours</span></div>
              <div className="p-stat"><b>{nb.state === 'ready' ? mmss(minutesSince(nb.stateSince, now) * 60) : nb.state === 'charging' ? `${Math.ceil(chargeStatus(nb, s, now).remainingMin)}m` : '—'}</b><span>{nb.state === 'ready' ? 'Ready for' : nb.state === 'charging' ? 'To full' : nb.state}</span></div>
            </div>
            <div className="p-checks">
              {CHECKS.map((c, i) => <button key={c} className={`p-ck${ck[i] ? ' on' : ''}`} onClick={() => setCk(i)}><i>{ck[i] && <Icon name="tick" />}</i>{c}</button>)}
            </div>
            <button className="p-install" disabled={nb.state !== 'ready' || !ck.every(Boolean)} onClick={() => {
              const prev = active.find((b) => b.state === 'robot');
              const ops = prev ? act.move(prev, 'charging') : Promise.resolve();
              ops.then(() => act.move(nb, 'robot', next!.match.label)).then(() => toast(`${nb.label} installed for ${next!.match.label}`));
            }}>{nb.state !== 'ready' ? `${nb.label} isn't ready yet` : ck.every(Boolean) ? `Installed for ${next!.match.label}` : 'Finish the checklist'}</button>
          </> : <div className="p-empty">No usable battery for the next match. Check the charging list.</div>}
        </section>

        <section className="pp">
          <div className="pp-h"><span className="ix">02</span>Match plan<span className="n">Auto</span></div>
          <div style={{ overflow: 'auto', minHeight: 0 }}>
            <table className="plan"><thead><tr><th>Match</th><th>Time</th><th>Battery</th><th>Ah</th><th>Status</th></tr></thead>
              <tbody>{rows.slice(0, 10).map((r) => <PlanLine key={r.match.key} r={r} isNext={r === next} onAssign={setAssign} />)}</tbody>
            </table>
          </div>
          <div className="p-sub-h" style={{ marginTop: 'auto', paddingTop: 14 }}>
            Plan uses competition batteries only{data.batteries.some((b) => b.quarantined && !b.retired) ? ` · ${data.batteries.filter((b) => b.quarantined && !b.retired).length} quarantined` : ''}
          </div>
        </section>

        <section className="pp">
          <div className="pp-h"><span className="ix">03</span>Charging<span className="n">{active.filter((b) => b.state === 'charging').length}</span></div>
          <ChargingList now={now} onPick={onPick} compact />
        </section>
      </main>
      <footer className="p-foot"><span>Plan gives every battery <b>a full charge</b> between matches</span><span>In queue <b>{s.queueLeadMin} min</b> before each match</span><span>Watch batteries <b>practice only</b></span></footer>
    </div>
  );
}

function PlanLine({ r, isNext, onAssign }: { r: PlanRow; isNext: boolean; onAssign: (key: string, id: string) => void }) {
  const { battery, health, active } = useStore();
  const b = r.batteryId ? battery(r.batteryId) : undefined;
  const cls = r.status === 'field' ? 'cur' : isNext ? 'nextm' : r.status === 'tight' ? 'tight' : r.status === 'none' ? 'none' : '';
  const [label, color] =
    r.status === 'field' ? ['On field', 'var(--ink-2)']
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

