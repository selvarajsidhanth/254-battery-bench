/* The event at a glance on the datasheet: every match and its time, which
   battery plays it, and which batteries are kept for systems checks. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Mk } from '../../components/ui';
import { chargeStatus } from '../../lib/domain';
import { planMatches, systemsCheckPool, type PlanRow } from '../../lib/plan';
import { clock, dur, fmt, ms, shortDate } from '../../lib/format';
import type { Battery } from '../../lib/types';

export function EventPlan() {
  const { data, health, now, battery, isAdmin } = useStore();
  const ev = data.event;
  const s = data.settings;
  const rows = useMemo(() => planMatches(data.batteries, health, s, ev, now), [data.batteries, health, s, ev, now]);
  const pool = useMemo(() => systemsCheckPool(data.batteries, health), [data.batteries, health]);
  if (!ev.matches.length) return null;

  const plan = new Map(rows.map((r) => [r.match.key, r]));
  const matches = [...ev.matches].sort((a, b) => ms(a.time) - ms(b.time));
  // who played the matches that are over, from the rotation log
  const played = (label: string) => data.events.filter((e) => e.to === 'robot' && e.match === label).pop()?.batteryId;
  const days = new Set(matches.map((m) => shortDate(m.time))).size;

  // match batteries in order of first use, with how many matches each covers
  const game: { b: Battery; n: number }[] = [];
  rows.forEach((r) => {
    const b = r.batteryId ? battery(r.batteryId) : undefined;
    if (!b) return;
    const g = game.find((x) => x.b.id === b.id);
    if (g) g.n++; else game.push({ b, n: 1 });
  });

  const state = (b: Battery) =>
    b.state === 'charging' ? `charging · ${chargeStatus(b, s, now).remainingMin <= 0 ? 'full' : `~${dur(chargeStatus(b, s, now).remainingMin)}`}`
    : b.state === 'robot' ? 'in robot' : b.state;

  return (
    <section className="panel ev-plan">
      <div className="ph"><h2>{ev.name || 'Event'}</h2>
        <span className="note">{matches.length} matches · {rows.filter((r) => r.status !== 'field').length} to go{isAdmin ? <> · <Link to="/settings?tab=event">edit schedule</Link></> : null}</span></div>
      <div className="ev-grid">
        <div className="tablewrap"><table className="ev-table">
          <thead><tr><th>Match</th><th>Time</th><th>Battery</th><th className="r">Status</th></tr></thead>
          <tbody>
            {matches.map((m, i) => {
              const r = plan.get(m.key);
              const b = battery(r ? r.batteryId ?? undefined : played(m.label));
              return (
                <tr key={m.key} className={!r ? 'done' : r.status === 'field' ? 'live' : ''} style={{ ['--i' as string]: Math.min(i, 20) }}>
                  <td><b>{m.label}</b></td>
                  <td>{days > 1 ? <span className="mute">{shortDate(m.time)} · </span> : null}{clock(m.time)}</td>
                  <td>{b ? <Link to={`/b/${b.id}`} className="lbl">{b.label}</Link> : <span className="mute">—</span>}</td>
                  <td className="r">{r ? <Status r={r} /> : <span className="mute">Played</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>

        <div className="ev-side">
          <div className="k-lab">Match batteries</div>
          <div className="chips">
            {game.map(({ b, n }, i) => (
              <Link key={b.id} to={`/b/${b.id}`} className="chip" style={{ ['--i' as string]: i }}>
                <b>{b.label}</b><span>{fmt(health[b.id]?.ah, 1)} Ah · {n} match{n > 1 ? 'es' : ''}</span><em>{state(b)}</em>
              </Link>
            ))}
            {!game.length && <span className="mute">No competition battery is usable.</span>}
          </div>
          <div className="k-lab" style={{ marginTop: 18 }}>Systems check batteries</div>
          <div className="chips">
            {pool.map((b, i) => (
              <Link key={b.id} to={`/b/${b.id}`} className="chip sys" style={{ ['--i' as string]: game.length + i }}>
                <b>{b.label}</b><span><Mk level={health[b.id].health} /> {health[b.id].health === 'watch' ? 'practice' : 'failed a check'} · {fmt(health[b.id]?.ah, 1)} Ah</span><em>{state(b)}</em>
              </Link>
            ))}
            {!pool.length && <span className="mute">No practice-tier batteries. The pit will pick the lowest-capacity free competition battery.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Status({ r }: { r: PlanRow }) {
  if (r.status === 'field') return <span className="inv-tag">On field</span>;
  if (r.status === 'installed') return <b>In robot</b>;
  if (r.status === 'ready') return <span>Ready</span>;
  if (r.status === 'charging') return <span className="mute">Full by {clock(r.readyAt!)}</span>;
  if (r.status === 'tight') return <span className="out-tag">{Math.ceil(r.lateMin)} min late</span>;
  return <span className="inv-tag">No battery</span>;
}
