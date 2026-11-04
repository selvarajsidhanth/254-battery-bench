import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../data/store';
import { BatteryActions } from '../../components/BatteryActions';
import { Icon, Mk, STATE_META, HEALTH_LABEL, type IconName } from '../../components/ui';
import { chargeStatus, restRemainingMin } from '../../lib/domain';
import { dur, fmt, minutesSince } from '../../lib/format';
import type { Battery, RotationState } from '../../lib/types';
import { FleetTable, byStanding, useAlerts } from './shared';

export function Overview() {
  const { active, health, data, now, isAdmin, act, toast, battery } = useStore();
  const nav = useNavigate();
  const alerts = useAlerts();
  const [sel, setSel] = useState<Battery | null>(null);
  const s = data.settings;
  const by = (st: RotationState) => active.filter((b) => b.state === st);

  const ready = by('ready').sort(byStanding(health));
  const nextIdx = ready.findIndex((b) => health[b.id].health === 'ok');
  const charging = by('charging').map((b) => ({ b, c: chargeStatus(b, s, now) })).sort((x, y) => x.c.remainingMin - y.c.remainingMin);
  const resting = by('resting').map((b) => ({ b, left: restRemainingMin(b, s, now) })).sort((x, y) => x.left - y.left);
  const robot = by('robot');
  const tierCount = (t: string) => active.filter((b) => health[b.id].tier === t).length;
  const due = active.filter((b) => health[b.id].stale).length;

  const lanes: { st: RotationState; rule: string; items: { b: Battery; meta: string; prog?: number; action?: [string, () => void] }[] }[] = [
    { st: 'charging', rule: `Sorted by time to full. Test right off the charger.`,
      items: charging.map(({ b, c }) => ({ b, meta: c.remainingMin <= 0 ? 'likely full' : `~${dur(c.remainingMin)}`, prog: (c.soc / s.socTarget) * 100, action: ['Test', () => nav(`/log?b=${b.id}`)] })) },
    { st: 'resting', rule: `Rest ${s.restMin} min before it goes back on a charger.`,
      items: resting.map(({ b, left }) => ({ b, meta: left <= 0 ? 'rested' : `${Math.ceil(left)} min left`, prog: 100 - (left / s.restMin) * 100,
        action: left <= 0 && health[b.id].health !== 'pull' ? ['Charge', () => act.move(b, 'charging').then(() => toast(`${b.label} → Charging`))] : undefined })) },
    { st: 'ready', rule: 'Tested and cleared for the robot.',
      items: ready.map((b) => ({ b, meta: health[b.id].rank && health[b.id].tier === 'competition' ? `#${health[b.id].rank} · ${fmt(health[b.id].ah, 1)} Ah` : `${fmt(health[b.id].ah, 1)} Ah`, action: ['Install', () => setSel(b)] })) },
    { st: 'robot', rule: 'Swap it out before it sags too low.',
      items: robot.map((b) => ({ b, meta: dur(minutesSince(b.stateSince, now)), action: ['Take out', () => act.move(b, 'resting').then(() => toast(`${b.label} → Resting`))] })) },
  ];

  const next = charging[0];
  const nextRest = resting.find((r) => r.left > 0);

  return (
    <section className="view">
      <section className="summary">
        {[
          ['Competition', `${tierCount('competition')}`, `/ ${s.compCount}`], ['Practice', `${tierCount('practice')}`], ['Not suitable', `${tierCount('none')}`],
          ['Ready now', `${ready.length}`],
        ].map(([k, v, sub]) => <div className="sum" key={k}><div className="k">{k}</div><div className="v">{v}{sub && <small>{sub}</small>}</div></div>)}
        <Link to="/testing" className="sum" style={{ color: 'inherit', textDecoration: 'none' }}><div className="k">Tests due</div><div className="v">{due}</div></Link>
        <div className={`sum${alerts.length ? ' inv' : ''}`}><div className="k">Need attention</div><div className="v">{alerts.length}</div></div>
      </section>

      <div className="main">
        <div className="col">
          <section className="panel">
            <div className="ph"><h2>Ready to grab</h2><span className="note">Competition batteries first, by capacity rank</span></div>
            <div className="pb">
              {ready.length ? (
                <div className={`tiles${nextIdx === 0 ? ' has-next' : ''}`}>
                  {ready.map((b, i) => {
                    const a = health[b.id];
                    const isNext = i === nextIdx && i === 0;
                    return (
                      <button key={b.id} className={`tile${isNext ? ' next' : ''}`} onClick={() => setSel(b)}>
                        <div className="tile-top"><span className="lab">{b.label}</span>
                          {isNext ? <span className="tag"><Mk level="ok" />Next up</span>
                            : a.health !== 'ok' ? <span className="tag"><Mk level={a.health} />{HEALTH_LABEL[a.health]}</span> : null}
                        </div>
                        <div className="irv">{fmt(a.ah, 2)}<small className="u">Ah</small></div>
                        <div className="meta"><span>{a.tier === 'competition' ? `Rank #${a.rank}` : HEALTH_LABEL[a.health]}</span><span>ready {dur(minutesSince(b.stateSince, now))}</span></div>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="empty">Nothing is ready. Test the battery closest to full on the charger.</div>}
            </div>
          </section>

          <section className="panel">
            <div className="ph"><h2>Rotation</h2><span className="note">Charge → rest → ready → robot{by('shelf').length ? ` · ${by('shelf').length} on the shelf` : ''}</span></div>
            <div className="lanes">
              {lanes.map((l) => (
                <div className="lane" key={l.st}>
                  <div className="lane-h"><Icon name={STATE_META[l.st].icon as IconName} />{STATE_META[l.st].label}<span className="n">{l.items.length}</span></div>
                  {l.items.map(({ b, meta, prog, action }) => (
                    <div key={b.id} className={`item${health[b.id].health === 'pull' ? ' warn' : ''}`}>
                      <div className="item-row"><b onClick={() => setSel(b)}>{b.label}</b><span>{meta}</span></div>
                      {prog != null && <div className="prog"><i style={{ width: `${Math.max(4, Math.min(100, prog))}%` }} /></div>}
                      {action && <div className="mini-act"><button onClick={action[1]}>{action[0]}</button></div>}
                    </div>
                  ))}
                  <div className="lane-rule">{l.rule}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="panel">
          <div className="ph"><h2>Needs attention</h2><span className="note">{alerts.length} items</span></div>
          {alerts.length === 0 && <div className="empty">Nothing needs attention. Every battery is healthy and tested.</div>}
          {alerts.map((x) => (
            <div key={x.key} className={`alert${x.kind === 'pull' || x.kind === 'flag' ? ' critical' : ''}`}>
              <div className="ic"><Icon name={x.kind === 'flag' ? 'flag' : x.kind === 'pull' ? 'alert' : x.kind === 'watch' ? 'trend' : 'list'} /></div>
              <div className="t">{x.title}</div>
              <div className="d">{x.detail}</div>
              <div className="acts">
                {x.flag && isAdmin && <>
                  <button className="btn sm" onClick={() => act.resolveFlag(x.flag!, true).then(() => toast(`${battery(x.batteryId)?.label} retired`))}>Approve &amp; retire</button>
                  <button className="btn sm" onClick={() => act.resolveFlag(x.flag!, false).then(() => toast('Request dismissed'))}>Dismiss</button>
                </>}
                <Link className="btn sm" to={x.link ?? `/b/${x.batteryId}`}>{x.link ? 'Testing queue' : 'Open'}</Link>
              </div>
            </div>
          ))}
          {(next || nextRest) && (
            <div className="foresee">
              {next && <>Next full: <b>{next.b.label}</b> {next.c.remainingMin <= 0 ? 'now' : `in ~${dur(next.c.remainingMin)}`}. </>}
              {nextRest && <><b>{nextRest.b.label}</b> finishes resting in {Math.ceil(nextRest.left)} min.</>}
            </div>
          )}
        </aside>
      </div>

      <section className="panel">
        <div className="ph"><h2>Fleet</h2><Link className="btn sm" to="/batteries">All batteries</Link></div>
        <FleetTable batteries={active} />
      </section>
      <div className="sheetfoot">
        <span>Dwg BB-FLT-01</span><span>Rev D</span><span>Competition ≥ {s.compMinAh} Ah · ≤ {s.compMaxRint} <span className="u">mΩ</span> · ≥ {s.compMinMca} MCA</span><span>Practice ≥ {s.pracMinAh} Ah</span><span>{data.event.mode === 'comp' ? `Event: ${data.event.name || 'competition'}` : 'Practice'}</span>
      </div>

      {sel && <BatteryActions battery={sel} onClose={() => setSel(null)} />}
    </section>
  );
}
