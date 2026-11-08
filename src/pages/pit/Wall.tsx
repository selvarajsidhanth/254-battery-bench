/* Competition view ("pit wall"): install the next battery on the left, our matches with
   alliances, win odds and the battery for each in the middle, rankings and chargers on the right. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Icon } from '../../components/ui';
import { byStanding } from '../sheet/shared';
import { SYSCHECK, chargeStatus, heldOut, savedForComp, type Assessment } from '../../lib/domain';
import { availableAt, pickSystemsCheck, planMatches, type PlanRow } from '../../lib/plan';
import { clock, fmt, minutesSince, mmss, ms, MIN } from '../../lib/format';
import { saveTbaCreds, tbaCreds } from '../../lib/tba';
import type { Intel, IntelMatch } from '../../lib/intel';
import type { Battery, EventConfig } from '../../lib/types';
import { ChargingList, Signals, SystemsCheck } from './Pit';

type Pick = (b: Battery) => void;

/** chance our alliance wins, 0-1 */
export const ourWin = (m?: IntelMatch) => (m?.us && m.redWin != null ? (m.us === 'red' ? m.redWin : 1 - m.redWin) : null);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const likelyRp = (m?: IntelMatch) => (m ? m.rp.filter((p) => p >= 0.5).length : 0);

/** Batteries the planner may use: the event pool, or every competition-ready one when no pool is set. */
export function poolOf(batteries: Battery[], health: Record<string, Assessment>, ev: EventConfig) {
  const ok = batteries.filter((b) => !b.retired && !heldOut(b) && health[b.id]?.health === 'ok');
  return ev.pool.length ? ok.filter((b) => ev.pool.includes(b.id)) : ok;
}

export function Comp({ now, onPick, intel, needs, onCreds }: {
  now: number; onPick: Pick; intel: Intel | null; needs: 'event' | 'creds' | null; onCreds: () => void;
}) {
  const { data, health, battery, act, toast, active, isAdmin } = useStore();
  const s = data.settings;
  const ev = data.event;
  const [open, setOpen] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  // re-plan every 15 s, not every tick
  const planNow = Math.floor(now / 15000) * 15000;
  const rows = useMemo(() => planMatches(data.batteries, health, s, ev, planNow), [data.batteries, health, s, ev, planNow]);

  const onField = rows.find((r) => r.status === 'field');
  const next = rows.find((r) => r.status !== 'field');
  const robot = active.find((b) => b.state === 'robot');
  const matchesLeft = rows.filter((r) => r.status !== 'field').length;
  const pool = poolOf(data.batteries, health, ev);

  if (!ev.matches.length) {
    return (
      <div className="pv comp">
        <div className="pp" style={{ gridRow: '1 / -1' }}>
          <div className="pp-h">No schedule</div>
          <div className="p-empty">{isAdmin ? <>Add the match schedule in <Link to="/settings?tab=event">Settings → Event</Link> (or pull it from The Blue Alliance), then this screen plans a battery for every match.</> : 'No match schedule yet. Ask an admin to add it in Settings.'}</div>
        </div>
      </div>
    );
  }

  const nb = next?.batteryId ? battery(next.batteryId) : undefined;
  const isInstalled = next?.status === 'installed';
  const queueIn = next ? (next.needBy - now) / 1000 : null;
  const nextIntel = next ? intel?.matches[next.match.key] : undefined;
  const win = ourWin(nextIntel);
  const sys = robot?.robotFor === SYSCHECK ? null : pickSystemsCheck(active, health, rows);
  const install = (b: Battery, forWhat: string, msg: string) => {
    const prev = active.find((x) => x.state === 'robot' && x.id !== b.id);
    (prev ? act.move(prev, 'charging') : Promise.resolve()).then(() => act.move(b, 'robot', forWhat)).then(() => toast(msg));
  };
  const setAssign = (key: string, batteryId: string) => {
    setOpen(null);
    const assignments = { ...ev.assignments };
    if (batteryId) assignments[key] = batteryId; else delete assignments[key];
    act.saveEvent({ ...ev, assignments }).then(() => toast(batteryId ? `${battery(batteryId)?.label ?? 'Battery'} locked in` : 'Back to auto'));
  };
  const partners = nextIntel?.us ? nextIntel[nextIntel.us].filter((t) => t !== intel?.team) : [];

  return (
    <div className="pv comp">
      <div className="p-timing">
        <div className={`p-tc${robot ? ' tap' : ''}`} onClick={() => robot && onPick(robot)} title={robot ? `${robot.label} is in the robot` : undefined}><div className="tk">{onField ? 'On field' : 'In robot'}</div><div className="tv">{onField ? <>{onField.match.label}<small>{onField.batteryId ? battery(onField.batteryId)?.label : ''}</small></> : robot ? <>{robot.label}<small>{robot.robotFor === SYSCHECK ? 'systems check' : 'tap to take out'}</small></> : <>—</>}</div></div>
        <div className="p-tc p-tc-next"><div><div className="tk">Next match</div><div className="tv">{next ? <>{next.match.label}<small>{clock(next.match.time)}</small></> : '—'}</div></div>
          {nextIntel?.us && <span className={`p-side-badge ${nextIntel.us}`}>{nextIntel.us}</span>}</div>
        <div className={`p-tc${queueIn != null && queueIn < 0 ? ' late' : ' go'}`}><div className="tk">{queueIn != null && queueIn < 0 ? 'Queue overdue' : 'Queue in'}</div><div className="tv">{queueIn != null ? mmss(Math.abs(queueIn)) : '—'}</div></div>
        <div className="p-tc"><div className="tk">Win chance</div><div className="tv">{win != null ? <>{pct(win)}<small>{likelyRp(nextIntel)} bonus RP likely</small></> : '—'}</div></div>
        <div className="p-tc"><div className="tk">Matches left</div><div className="tv">{matchesLeft}<small>of {ev.matches.length}</small></div></div>
      </div>
      <Signals />
      <main className="cg">
        <section className="pp accent">
          <div className="pp-h"><span className="ix">01</span>{isInstalled ? 'Installed for' : 'Install for'} {next?.match.label ?? '—'}</div>
          {nextIntel?.us && (
            <div className={`p-ally ${nextIntel.us}`}><i /><b>{nextIntel.us} alliance</b>{partners.length > 0 && <span>with {partners.join(' · ')}</span>}</div>
          )}
          {nb && isInstalled ? <>
            <div className="p-id sm" onClick={() => onPick(nb)}>{nb.label}</div>
            <Stats b={nb} third={<><b>{mmss(minutesSince(nb.stateSince, now) * 60)}</b><span>In robot for</span></>} />
            <div className="p-done"><Icon name="tick" />In the robot. Queue by {clock(next!.needBy)}.</div>
          </> : nb ? <>
            <div className="p-id sm" onClick={() => onPick(nb)}>{nb.label}</div>
            <Stats b={nb} third={<><b>{nb.state === 'ready' ? mmss(minutesSince(nb.stateSince, now) * 60) : nb.state === 'charging' ? `${Math.ceil(chargeStatus(nb, s, now).remainingMin)}m` : '—'}</b><span>{nb.state === 'ready' ? 'Ready for' : nb.state === 'charging' ? 'To full' : nb.state}</span></>} />
            <button className="p-install big" onClick={() => install(nb, next!.match.label, `${nb.label} is in the robot for ${next!.match.label}`)}>
              It’s in the robot now</button>
          </> : <div className="p-empty">No usable battery for the next match. Check the charging list or the battery pool.</div>}
          <SystemsCheck robot={robot} pick={sys} busy={isInstalled} now={now} onPick={onPick}
            onUse={(b) => install(b, SYSCHECK, `${b.label} is in for a systems check`)}
            onDone={(b) => act.move(b, 'charging').then(() => toast(`${b.label} back on a charger (nearly full)`))} />
        </section>

        <section className="pp p-matches">
          <div className="pp-h"><span className="ix">02</span>Our matches
            <span className="p-pool-note">Picking from <b>{pool.length} {pool.length === 1 ? 'battery' : 'batteries'}</b>{ev.pool.length ? '' : ' (all competition)'}</span>
            <button className="p-btn acc" onClick={() => setPoolOpen(true)}>Edit pool</button>
          </div>
          <div className="p-mt-wrap">
            <div className={`p-mt${intel ? '' : ' bare'}`}>
              <div className="p-mh"><span>Match</span><span>Time</span>{intel && <><span>Us</span><span>Red</span><span>Blue</span><span title="Chance of each bonus ranking point">RP</span><span>Win</span></>}<span>Battery</span></div>
              {rows.map((r, i) => (
                <MatchRow key={r.match.key} r={r} i={i} rows={rows} isNext={r === next} full={!!intel} im={intel?.matches[r.match.key]} us={intel?.team}
                  open={open === r.match.key} onToggle={() => setOpen(open === r.match.key ? null : r.match.key)} onClose={() => setOpen(null)} onAssign={setAssign} pool={pool} now={now} />
              ))}
            </div>
          </div>
        </section>

        <section className="p-side">
          <Rankings intel={intel} needs={needs} onCreds={onCreds} />
          <div className="pp p-charge">
            <div className="pp-h"><span className="ix">04</span>Charging<span className="n">{active.filter((b) => b.state === 'charging').length}</span></div>
            <ChargingList now={now} onPick={onPick} compact />
          </div>
        </section>
      </main>
      {poolOpen && <PoolPicker onClose={() => setPoolOpen(false)} />}
    </div>
  );
}

function Stats({ b, third }: { b: Battery; third: ReactNode }) {
  const { health } = useStore();
  const h = health[b.id];
  return (
    <div className="p-stats">
      <div className="p-stat"><b>#{h.rank ?? '—'}</b><span>Capacity rank</span></div>
      <div className="p-stat"><b>{fmt(h.ah, 1)}</b><span>Amp-hours</span></div>
      <div className="p-stat">{third}</div>
    </div>
  );
}

function Teams({ list, us }: { list?: string[]; us?: string }) {
  if (!list?.length) return <span className="p-teams mute">—</span>;
  return <span className="p-teams">{list.map((t) => <span key={t} className={t === us ? 'us' : ''}>{t}</span>)}</span>;
}

function WinBar({ m }: { m?: IntelMatch }) {
  if (!m || m.redWin == null) return <span className="p-win none">—</span>;
  const red = Math.round(m.redWin * 100);
  return (
    <span className="p-win" title={`Red ${red}% · Blue ${100 - red}%${m.pred ? ` · predicted ${Math.round(m.pred.red)}–${Math.round(m.pred.blue)}` : ''}`}>
      <span className="r" style={{ width: `${red}%` }}>{red >= 50 ? `${red}%` : ''}</span>
      <span className="b">{red < 50 ? `${100 - red}%` : ''}</span>
    </span>
  );
}

function MatchRow({ r, i, rows, isNext, full, im, us, open, onToggle, onClose, onAssign, pool, now }: {
  r: PlanRow; i: number; rows: PlanRow[]; isNext: boolean; full: boolean; im?: IntelMatch; us?: string; open: boolean;
  onToggle: () => void; onClose: () => void; onAssign: (key: string, id: string) => void; pool: Battery[]; now: number;
}) {
  const { battery } = useStore();
  const b = r.batteryId ? battery(r.batteryId) : undefined;
  const cls = r.status === 'field' ? 'cur' : isNext ? 'nextm' : r.status === 'tight' ? 'tight' : r.status === 'none' ? 'none' : '';
  const [state, warn] =
    r.status === 'installed' ? ['In the robot', false]
    : r.status === 'ready' ? ['Ready', false]
    : r.status === 'charging' ? [`Full by ${clock(r.readyAt!)}`, false]
    : r.status === 'tight' ? [`Tight · ${Math.ceil(r.lateMin)} min late`, true]
    : ['No battery', true];
  return (
    <div className={`p-mr ${cls}`}>
      <b className="m">{r.match.label}</b>
      <span className="t">{clock(r.match.time)}</span>
      {full ? <>
        <span className={`p-us ${im?.us ?? ''}`}>{im?.us ? im.us[0].toUpperCase() : '—'}</span>
        <span className="red"><Teams list={im?.red} us={us} /></span>
        <span className="blue"><Teams list={im?.blue} us={us} /></span>
        <span className={`p-rp ${im?.us ?? ''}`} title={im?.rp.length ? im.rp.map((p, k) => `Bonus RP ${k + 1}: ${pct(p)}`).join('\n') : undefined}>
          {im?.rp.length ? im.rp.map((p, k) => <i key={k} className={p >= 0.5 ? 'on' : ''} />) : '—'}</span>
        <WinBar m={im} />
      </> : null}
      <span className="p-bcell">
        {r.status === 'field' ? <span className="p-bfield"><b>{b?.label ?? '—'}</b>on field</span> : <>
          <button className={`p-bbtn${open ? ' open' : ''}${r.manual ? ' locked' : ''}${warn ? ' warn' : ''}`} onClick={onToggle} aria-expanded={open}>
            <span className="l"><b>{b?.label ?? '—'}</b><em>{r.manual ? 'Locked' : 'Auto'}</em></span>
            <span className="s">{state}</span>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
          </button>
          {open && <BatteryMenu r={r} i={i} rows={rows} pool={pool} now={now} onPick={(id) => onAssign(r.match.key, id)} onClose={onClose} />}
        </>}
      </span>
    </div>
  );
}

/** The per-match battery picker: auto, the pool (best first), then anything else that's competition-ready. */
function BatteryMenu({ r, i, rows, pool, now, onPick, onClose }: {
  r: PlanRow; i: number; rows: PlanRow[]; pool: Battery[]; now: number; onPick: (id: string) => void; onClose: () => void;
}) {
  const { data, health, active } = useStore();
  const s = data.settings;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement!.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  // when each battery is free for this match, counting matches it's already planned for before it
  const freeAt = (b: Battery) => {
    const prev = rows.slice(0, i).filter((x) => x.batteryId === b.id).pop();
    return prev ? Math.max(ms(prev.match.time), now) + (s.matchMin + s.chargeMin) * MIN : availableAt(b, s, now);
  };
  const when = (b: Battery) => {
    const at = freeAt(b);
    const late = (at - r.needBy) / MIN;
    if (late > 0) return { text: `${Math.ceil(late)} min late`, cls: 'warn' };
    if (b.state === 'robot') return { text: 'in robot', cls: '' };
    return at <= now ? { text: 'ready now', cls: 'go' } : { text: `full ${clock(at)}`, cls: '' };
  };
  const inPool = new Set(pool.map((b) => b.id));
  const others = active.filter((b) => !inPool.has(b.id) && !heldOut(b) && health[b.id].health === 'ok').sort(byStanding(health));
  const item = (b: Battery) => {
    const h = health[b.id];
    const w = when(b);
    return (
      <button key={b.id} className={`p-opt${r.batteryId === b.id ? ' on' : ''}`} onClick={() => onPick(b.id)}>
        <b>{b.label}</b>
        <span>#{h.rank ?? '—'} · {fmt(h.ah, 1)} Ah · {fmt(h.rintPre)} mΩ · {h.mca ?? '—'} A</span>
        <em className={w.cls}>{w.text}</em>
      </button>
    );
  };
  return (
    <div className="p-menu" ref={ref} role="menu">
      <div className="p-menu-h">Battery for {r.match.label}</div>
      <button className={`p-opt${!r.manual ? ' on' : ''}`} onClick={() => onPick('')}><b>Auto</b><span>Let the planner choose</span><em /></button>
      {[...pool].sort(byStanding(health)).map(item)}
      {others.length > 0 && <><div className="p-menu-h sub">Not in the pool</div>{others.map(item)}</>}
    </div>
  );
}

function Rankings({ intel, needs, onCreds }: { intel: Intel | null; needs: 'event' | 'creds' | null; onCreds: () => void }) {
  const { isAdmin } = useStore();
  const [key, setKey] = useState(() => tbaCreds().key);
  const [team, setTeam] = useState(() => tbaCreds().team);
  const head = (
    <div className="pp-h"><span className="ix">03</span>Rankings
      <span className="p-src">{intel?.source === 'sample' ? 'Sample data' : intel ? (intel.odds === 'opr' ? 'TBA · odds from OPR' : 'TBA · Statbotics') : ''}</span></div>
  );
  if (!intel) {
    return (
      <div className="pp p-ranks">
        {head}
        {needs === 'event' ? <div className="p-empty">Add the event’s TBA key (like 2026casj) in {isAdmin ? <Link to="/settings?tab=event">Settings → Event</Link> : 'Settings → Event (ask an admin)'} to see live rankings, alliances and win odds.</div>
          : needs === 'creds' ? (
            <form className="p-creds" onSubmit={(e) => { e.preventDefault(); saveTbaCreds(key, team); onCreds(); }}>
              <div className="p-empty">This screen needs a TBA read key and your team number. They stay on this device.</div>
              <input className="in" placeholder="TBA read key" value={key} onChange={(e) => setKey(e.target.value)} aria-label="TBA read key" />
              <input className="in" placeholder="Team number" value={team} inputMode="numeric" onChange={(e) => setTeam(e.target.value)} aria-label="Team number" />
              <button className="p-btn acc" type="submit" disabled={!key.trim() || !team.trim()}>Save</button>
            </form>
          ) : <div className="p-empty">Loading rankings…</div>}
      </div>
    );
  }
  const list = intel.rankings;
  const mine = list.find((r) => r.team === intel.team);
  const shown = list.slice(0, 10);
  if (mine && mine.rank > 10) shown.push(mine);
  const epas = list.map((r) => r.epa).filter((x): x is number => x != null).sort((a, b) => a - b);
  const tier = (x: number | null) => {
    if (x == null || !epas.length) return '';
    const q = epas.findIndex((v) => v >= x) / epas.length;
    return q >= 0.9 ? 't4' : q >= 0.7 ? 't3' : q >= 0.4 ? 't2' : 't1';
  };
  return (
    <div className="pp p-ranks">
      {head}
      {!list.length ? <div className="p-empty">No rankings yet. They show up after the first qualification match.{intel.errors.length ? ` (${intel.errors[0]})` : ''}</div> : <>
        <div className="p-rk h"><span>#</span><span>Team</span><span>W-L-T</span><span>RS</span><span title={intel.rating === 'OPR' ? 'TBA OPR: points a team adds to its alliance, from this event’s scores' : 'Statbotics EPA: points a team adds to its alliance'}>{intel.rating}</span></div>
        {shown.map((r) => (
          <div key={r.team} className={`p-rk${r.team === intel.team ? ' us' : ''}`}>
            <span className="n">{r.rank}</span><b>{r.team === 'US' ? 'Us' : r.team}</b>
            <span>{r.wins}-{r.losses}-{r.ties}</span><span>{r.rs != null ? r.rs.toFixed(2) : '—'}</span>
            <span className={`epa ${tier(r.epa)}`}>{r.epa != null ? Math.round(r.epa) : '—'}</span>
          </div>
        ))}
      </>}
    </div>
  );
}

/** Pick which batteries the planner can suggest for matches. */
function PoolPicker({ onClose }: { onClose: () => void }) {
  const { data, health, active, act, toast, now } = useStore();
  const ev = data.event;
  const usable = (b: Battery) => !heldOut(b) && health[b.id].health === 'ok';
  const fleet = [...active].sort(byStanding(health));
  const all = fleet.filter(usable).map((b) => b.id);
  const [sel, setSel] = useState<string[]>(() => (ev.pool.length ? ev.pool.filter((id) => all.includes(id)) : all));
  const [filter, setFilter] = useState<'all' | 'comp' | 'practice' | 'held'>('all');
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const kind = (b: Battery) => (heldOut(b) ? 'held' : health[b.id].health === 'ok' ? 'comp' : 'practice');
  const shown = fleet.filter((b) => filter === 'all' || kind(b) === filter);
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  // what the planner would do with this pool
  const preview = useMemo(() => {
    const rows = planMatches(data.batteries, health, data.settings, { ...ev, pool: sel.length ? sel : ['∅'] }, now);
    return rows.filter((r) => r.status === 'tight' || r.status === 'none').length;
  }, [sel, data, health, ev, now]);
  const save = () => {
    const same = sel.length === all.length;
    act.saveEvent({ ...ev, pool: same ? [] : sel }).then(() => { toast(same ? 'Planner uses every competition battery' : `Battery pool set: ${sel.length}`); onClose(); });
  };
  const tag = (b: Battery) => {
    const h = health[b.id].health;
    if (heldOut(b)) return ['Held out', 'stop'];
    if (h === 'watch') return ['Practice', 'warn'];
    if (h === 'pull') return ['Failed check', 'stop'];
    if (h !== 'ok') return ['Needs tests', ''];
    return savedForComp(b) ? ['Saved', 'go'] : ['Comp', 'acc'];
  };
  const stateText = (b: Battery) => (b.state === 'charging' ? 'Charging' : b.state === 'robot' ? 'In robot' : b.state === 'ready' ? 'Ready' : 'Shelf');

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="p-pool" role="dialog" aria-modal aria-label="Battery pool">
        <div className="p-pool-h">
          <div>
            <div className="k">Battery pool</div>
            <h3>Which batteries can the planner pick for matches?</h3>
            <p>Tap a battery to add or remove it. You can still lock any competition battery to one match from the match list.</p>
          </div>
          <button className="x-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="p-pool-bar">
          {([['all', `All ${fleet.length}`], ['comp', 'Competition'], ['practice', 'Practice / failed'], ['held', 'Held out']] as const).map(([k, l]) => (
            <button key={k} className={`p-chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
          <span className="sp" />
          <button className="p-chip" onClick={() => setSel(all.slice(0, 8))}>Top 8</button>
          <button className="p-chip" onClick={() => setSel(all)}>All competition</button>
          <button className="p-chip" onClick={() => setSel([])}>Clear</button>
        </div>
        <div className="p-pool-grid">
          {shown.map((b) => {
            const h = health[b.id];
            const can = usable(b);
            const on = sel.includes(b.id);
            const [t, c] = tag(b);
            return (
              <button key={b.id} className={`p-card${on ? ' on' : ''}`} disabled={!can} aria-pressed={on} onClick={() => toggle(b.id)}
                title={can ? undefined : 'Only competition-ready batteries can be picked for matches'}>
                <span className="top"><b>{b.label}</b><em className={c}>{t}</em><i className="ck">{on && <Icon name="tick" />}</i></span>
                <span className="facts">
                  <span><b>{h.rank ? `#${h.rank}` : '—'}</b>Rank</span>
                  <span><b>{fmt(h.ah, 1)}</b>Amp-hrs</span>
                  <span><b>{fmt(h.rintPre)}</b>IR mΩ</span>
                  <span><b>{h.mca ?? '—'}</b>MCA A</span>
                </span>
                <span className="st">{stateText(b)}</span>
              </button>
            );
          })}
          {!shown.length && <div className="p-empty">Nothing here.</div>}
        </div>
        <div className="p-pool-f">
          <b className="cnt">{sel.length}</b>
          <span>selected · {sel.length === 0 ? <em className="warn">pick at least one</em> : preview ? <em className="warn">{preview} {preview === 1 ? 'match' : 'matches'} would be tight or without a battery</em> : <em className="go">every match gets a charged battery</em>}</span>
          <span className="sp" />
          <button className="p-btn" onClick={onClose}>Cancel</button>
          <button className="p-btn acc" disabled={!sel.length} onClick={save}>Save pool</button>
        </div>
      </div>
    </div>
  );
}

