/* Showcase layouts for the competition pit screen, made to be read from across the venue.
   "wall": the screen turns our alliance color. "broadcast": motorsport TV graphics.
   Both use the same plan and live data as the classic pit wall (useCompModel). */
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Icon } from '../../components/ui';
import { clock, mmss } from '../../lib/format';
import type { Intel } from '../../lib/intel';
import type { PlanRow } from '../../lib/plan';
import type { Battery } from '../../lib/types';
import { BatteryMenu, PoolPicker, Rankings, TeamBtn, TeamCard, TeamTap, ourWin, pct, likelyRp, useCompModel } from './Wall';
import '../../styles/showcase.css';

type Props = { now: number; onPick: (b: Battery) => void; intel: Intel | null; needs: 'event' | 'creds' | null; onCreds: () => void };

/** Characters that flip in when they change (each char remounts on change, replaying the animation). */
function Flip({ text, cls }: { text: string; cls?: string }) {
  return <span className={`sc-flip${cls ? ` ${cls}` : ''}`}>{text.split('').map((c, i) => <span key={`${i}-${c}`} className={c === ':' ? 'col' : 'ch'}>{c}</span>)}</span>;
}

/** Shared overlays + team-card plumbing for both layouts. */
function useOverlays(intel: Intel | null, rows: PlanRow[], event: string) {
  const [team, setTeam] = useState<{ team: string; rect: DOMRect } | null>(null);
  const [pool, setPool] = useState(false);
  const tap = (t: string, el: HTMLElement) => setTeam(team?.team === t ? null : { team: t, rect: el.getBoundingClientRect() });
  const overlays = <>
    {pool && <PoolPicker onClose={() => setPool(false)} />}
    {team && intel && <TeamCard team={team.team} rect={team.rect} intel={intel} event={event} rows={rows} onClose={() => setTeam(null)} />}
  </>;
  return { tap, overlays, openPool: () => setPool(true) };
}

function NoSchedule() {
  const { isAdmin } = useStore();
  return (
    <div className="sc-empty">
      <b>No schedule yet</b>
      <span>{isAdmin ? <>Load it in <Link to="/settings?tab=event">Settings → Event</Link>.</> : 'Ask an admin to load the match schedule.'}</span>
    </div>
  );
}

const qualName = (label: string) => (/^Q\d+$/.test(label) ? `Qualification ${label.slice(1)}` : label);

/* ============================== ALLIANCE WALL ============================== */

export function AllianceWall({ now, onPick, intel, needs, onCreds }: Props) {
  const { data } = useStore();
  const m = useCompModel(now, intel);
  const o = useOverlays(intel, m.rows, m.ev.tbaEvent);
  const [menu, setMenu] = useState<string | null>(null);
  if (!m.ev.matches.length) return <NoSchedule />;
  const side = m.side;
  const word = side === 'red' ? 'Red' : side === 'blue' ? 'Blue' : 'Next';
  const later = m.rows.filter((r) => r.status !== 'field' && r !== m.next);
  const rank = intel?.rankings ?? [];

  return (
    <TeamTap.Provider value={o.tap}>
      <div className={`aw ${side ?? 'none'}${m.late ? ' late' : ''}`}>
        <section className="aw-main">
          <div className="aw-ghost" aria-hidden="true">{word}</div>
          <div className="aw-top">
            <span>{data.event.name || 'Competition'}</span><i>/</i><span>{m.next ? qualName(m.next.match.label) : 'Done'}</span>
            {m.onField && <span className="aw-field">On field: {m.onField.match.label}</span>}
            <span className="aw-clock">{clock(now)}</span>
          </div>

          <div className="aw-head">
            <b>{m.next?.match.label ?? '—'}</b>
            <span>{side ? `${side} alliance` : needs ? 'Side unknown' : 'Waiting for TBA'}</span>
            <em>{m.next ? clock(m.next.match.time) : ''}</em>
          </div>

          <div className="aw-q">
            <div className="k">{m.late ? 'Queue overdue' : 'Queue in'}</div>
            <Flip text={m.queueIn != null ? mmss(Math.abs(m.queueIn)) : '—'} cls="aw-count" />
          </div>

          <div className="aw-teams">
            <div className="aw-al">
              <div className="row"><span className="k">With</span>
                {m.partners.map((t) => <TeamBtn key={t} t={t} cls="aw-plate" />)}
                {side && <span className="aw-plate us">{intel?.team === 'US' ? 'US' : intel?.team}</span>}
                {!side && <span className="aw-dim">—</span>}
              </div>
              <div className="row"><span className="k">VS</span>
                {m.opponents.length ? m.opponents.map((t) => <TeamBtn key={t} t={t} cls="aw-plate opp" />) : <span className="aw-dim">—</span>}
              </div>
            </div>
            <div className="aw-win">
              <b>{m.win != null ? pct(m.win) : '—'}</b>
              <span>{m.win != null ? <>to win{m.nextIntel?.pred ? ` · predicted ${Math.round(side === 'red' ? m.nextIntel.pred.red : m.nextIntel.pred.blue)}–${Math.round(side === 'red' ? m.nextIntel.pred.blue : m.nextIntel.pred.red)}` : ''}{m.nextIntel?.rp.length ? ` · ${likelyRp(m.nextIntel)} bonus RP likely` : ''}</> : 'win chance'}</span>
            </div>
          </div>

          <div className="aw-bat">
            <div className="info">
              <span className="k">Battery</span>
              {m.nb ? <>
                <b onClick={() => onPick(m.nb!)}>{m.nb.label}</b>
                <span>#{m.nh?.rank ?? '—'} · {m.nh?.ah != null ? m.nh.ah.toFixed(1) : '—'} Ah · {m.nbState}</span>
              </> : <span>No usable battery. Check the pool.</span>}
              {m.stillIn && <button className="aw-out" onClick={() => onPick(m.stillIn!)}>{m.stillIn.label} still in the robot</button>}
            </div>
            {m.nb && (m.isInstalled
              ? <div className="aw-go done"><Icon name="tick" />In the robot</div>
              : <button className="aw-go" onClick={m.installNext}>It’s in the robot now</button>)}
          </div>
        </section>

        <aside className="aw-side">
          {intel ? <>
            <div className="aw-rank">
              <div className="k">Standings</div>
              <div className="big"><b>{m.us ? `#${m.us.rank}` : '—'}</b>{m.us && <span>{m.us.wins}-{m.us.losses}-{m.us.ties}{m.us.rs != null ? ` · RS ${m.us.rs.toFixed(2)}` : ''}</span>}</div>
            </div>
            <div className="aw-list">
              {rank.filter((r) => r.rank <= 12 || r.team === intel.team).map((r) => (
                <div key={r.team} className={`aw-r${r.team === intel.team ? ' us' : ''}`}>
                  <span className="n">{r.rank}</span>
                  {r.team === intel.team ? <b>{r.team === 'US' ? 'Us' : r.team}</b> : <b><TeamBtn t={r.team} /></b>}
                  <span>{r.wins}-{r.losses}-{r.ties}</span><span className="rs">{r.rs != null ? r.rs.toFixed(2) : '—'}</span>
                </div>
              ))}
            </div>
          </> : <div className="aw-setup"><Rankings intel={null} needs={needs} onCreds={onCreds} /></div>}

          <div className="aw-then">
            <div className="k">Then <button className="aw-pool" onClick={o.openPool}>Battery pool · {m.pool.length}</button></div>
            {later.slice(0, 3).map((r) => {
              const im = intel?.matches[r.match.key];
              const w = ourWin(im);
              const b = r.batteryId ? data.batteries.find((x) => x.id === r.batteryId) : undefined;
              return (
                <div key={r.match.key} className="aw-t">
                  <b>{r.match.label}</b><span>{clock(r.match.time)}</span>
                  {im?.us && <em className={im.us}>{im.us}{w != null ? ` · ${pct(w)}` : ''}</em>}
                  <span className="aw-tb">
                    <button className={`aw-bbtn${r.status === 'tight' || r.status === 'none' ? ' warn' : ''}${r.manual ? ' locked' : ''}`} onClick={() => setMenu(menu === r.match.key ? null : r.match.key)}>
                      {b?.label ?? 'No battery'}<small>{r.manual ? 'locked' : r.status === 'ready' ? 'ready' : r.status === 'charging' ? `full ${clock(r.readyAt!)}` : r.status === 'tight' ? `${Math.ceil(r.lateMin)}m late` : ''}</small>
                    </button>
                    {menu === r.match.key && <BatteryMenu r={r} i={m.rows.indexOf(r)} rows={m.rows} pool={m.pool} now={now}
                      onPick={(id) => { setMenu(null); m.setAssign(r.match.key, id); }} onClose={() => setMenu(null)} />}
                  </span>
                </div>
              );
            })}
            {!later.length && <div className="aw-dim">Last match of the event.</div>}
          </div>
        </aside>
        {o.overlays}
      </div>
    </TeamTap.Provider>
  );
}

/* ============================== RACE BROADCAST ============================== */

export function Broadcast({ now, onPick, intel, needs, onCreds }: Props) {
  const { data } = useStore();
  const m = useCompModel(now, intel);
  const o = useOverlays(intel, m.rows, m.ev.tbaEvent);
  if (!m.ev.matches.length) return <NoSchedule />;
  const rank = intel?.rankings ?? [];
  const lead = rank[0]?.rs ?? null;
  const rating = new Map(rank.map((r) => [r.team, r.epa]));
  const side = m.side;
  const other = side === 'red' ? 'blue' : 'red';
  const later = m.rows.filter((r) => r.status !== 'field' && r !== m.next);
  const redWin = m.nextIntel?.redWin;

  const plates = (list: string[], mine: boolean) => list.map((t) => {
    const us = t === intel?.team;
    const v = rating.get(t);
    const inner = <><b>{t === 'US' ? 'US' : t}</b>{v != null && <small>{Math.round(v)}</small>}</>;
    return us ? <span key={t} className="rb-plate us">{inner}</span>
      : <TeamTapPlate key={t} t={t} cls={`rb-plate${mine ? ' mine' : ''}`}>{inner}</TeamTapPlate>;
  });
  const ticker = [
    ...later.slice(0, 3).map((r) => {
      const im = intel?.matches[r.match.key];
      const w = ourWin(im);
      const b = r.batteryId ? data.batteries.find((x) => x.id === r.batteryId)?.label : null;
      const mates = im?.us ? im[im.us].filter((t) => t !== intel?.team) : [];
      const vs = im?.us ? im[im.us === 'red' ? 'blue' : 'red'] : [];
      return `${r.match.label} · ${clock(r.match.time)}${im?.us ? ` · ${im.us.toUpperCase()}` : ''}${mates.length ? ` WITH ${mates.join(' · ')}` : ''}${vs.length ? ` VS ${vs.join(' · ')}` : ''}${w != null ? ` · ${pct(w)} TO WIN` : ''}${b ? ` · BATTERY ${b} ${r.status === 'ready' ? 'READY' : r.status === 'charging' ? `FULL ${clock(r.readyAt!)}` : ''}` : ''}`;
    }),
    ...(rank[0] ? [`LEADER ${rank[0].team} · ${rank[0].wins}-${rank[0].losses}-${rank[0].ties}${rank[0].rs != null ? ` · RS ${rank[0].rs.toFixed(2)}` : ''}`] : []),
    ...(m.us ? [`WE ARE P${m.us.rank} · ${m.us.wins}-${m.us.losses}-${m.us.ties}${m.us.rs != null ? ` · RS ${m.us.rs.toFixed(2)}` : ''}`] : []),
  ];
  const board = m.nb ? (m.isInstalled ? 'IN ROBOT' : m.nb.state === 'ready' ? 'READY' : m.nb.state === 'charging' ? `FULL ${clock(m.next!.readyAt ?? now)}` : m.nb.state.toUpperCase()) : '';

  return (
    <TeamTap.Provider value={o.tap}>
      <div className={`rb${m.late ? ' late' : ''}`}>
        <aside className="rb-tower">
          <div className="rb-ev"><b>{(data.event.name || 'Event').split(' ')[0]}</b><span>Quals · standings</span></div>
          {intel ? rank.map((r) => (
            <div key={r.team} className={`rb-row${r.team === intel.team ? ' us' : ''}`}>
              <span className="pos">{r.rank}</span><i />
              <b>{r.team === intel.team ? (r.team === 'US' ? 'US' : r.team) : <TeamBtn t={r.team} />}</b>
              <span className="gap">{r.rank === 1 ? 'LEADER' : lead != null && r.rs != null ? `+${(lead - r.rs).toFixed(2)}` : ''}</span>
            </div>
          )) : <div className="rb-setup"><Rankings intel={null} needs={needs} onCreds={onCreds} /></div>}
        </aside>

        <main className="rb-main">
          <div className="rb-bar">
            <span className="rb-slab acc">{m.onField ? 'ON TRACK' : 'NEXT UP'}</span>
            <span className="rb-slab white">{m.next ? qualName(m.next.match.label) : 'Done'}<em>{m.next ? clock(m.next.match.time) : ''}</em></span>
            <span className="rb-meta">{m.us && <>RANK <b>P{m.us.rank}</b></>}<strong>{clock(now)}</strong></span>
          </div>

          <div className="rb-hero">
            <div className="rb-left">
              <div className="k">{m.late ? 'Queue overdue' : 'Time to queue'}</div>
              <Flip text={m.queueIn != null ? mmss(Math.abs(m.queueIn)) : '—'} cls="rb-count" />
              <div className="rb-grid">
                {side ? <>
                  <span className={`rb-side ${side}`}>{side}</span><div className={`rb-plates ${side}`}>{plates([...m.partners, intel!.team], true)}</div>
                  <span className={`rb-side ${other}`}>{other}</span><div className={`rb-plates ${other}`}>{plates(m.opponents, false)}</div>
                </> : <span className="rb-dim">{needs ? 'Set up live data to see alliances' : 'Alliances not posted yet'}</span>}
              </div>
              {m.win != null && redWin != null && (
                <div className="rb-odds">
                  <div className="l"><span className="red">{pct(redWin)}</span><em>win probability{m.nextIntel?.pred ? ` · ${Math.round(m.nextIntel.pred.red)}–${Math.round(m.nextIntel.pred.blue)}` : ''}</em><span className="blue">{pct(1 - redWin)}</span></div>
                  <div className="bar"><i className="red" style={{ width: `${Math.round(redWin * 100)}%` }} /><i className="blue" /></div>
                </div>
              )}
            </div>

            <div className="rb-right">
              {m.nb ? <div className="rb-board" onClick={() => onPick(m.nb!)}>
                <span className="t">BOX · {m.next?.match.label}</span>
                <b>{m.nb.label}</b>
                <span className="s">P{m.nh?.rank ?? '—'} · {m.nh?.ah != null ? m.nh.ah.toFixed(1) : '—'} AH</span>
                <i />
                <strong>{board}</strong>
              </div> : <div className="rb-board empty"><span className="t">BOX</span><strong>NO BATTERY</strong></div>}
              {m.nb && (m.isInstalled
                ? <div className="rb-go done"><Icon name="tick" />IN THE ROBOT</div>
                : <button className="rb-go" onClick={m.installNext}>IT’S IN THE ROBOT</button>)}
              <button className="rb-pool" onClick={o.openPool}>Battery pool · {m.pool.length}</button>
            </div>
          </div>
        </main>

        <div className="rb-ticker">
          <span className="lab">THEN</span>
          <div className="win"><div className="run">{[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}</div></div>
        </div>
        {o.overlays}
      </div>
    </TeamTap.Provider>
  );
}

/** A team plate that opens the team card. */
function TeamTapPlate({ t, cls, children }: { t: string; cls: string; children: ReactNode }) {
  const tap = useContext(TeamTap);
  return <button type="button" className={`${cls} p-team`} onClick={(e) => tap(t, e.currentTarget)}>{children}</button>;
}

/** Small floating switcher between the pit layouts. Fades out until you move the mouse. */
export function LayoutSwitch({ skin, onSkin }: { skin: string; onSkin: (s: string) => void }) {
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let t = window.setTimeout(() => setAwake(false), 3000);
    const wake = () => { setAwake(true); window.clearTimeout(t); t = window.setTimeout(() => setAwake(false), 3000); };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    return () => { window.clearTimeout(t); window.removeEventListener('mousemove', wake); window.removeEventListener('touchstart', wake); };
  }, []);
  return (
    <div className={`sc-switch${awake ? '' : ' sleep'}`}>
      {[['classic', 'Classic'], ['wall', 'Wall'], ['broadcast', 'Broadcast']].map(([k, l]) => (
        <button key={k} className={skin === k ? 'on' : ''} onClick={() => onSkin(k)}>{l}</button>
      ))}
      <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())} aria-label="Full screen"><Icon name="expand" /></button>
      <Link to="/">Datasheet</Link>
    </div>
  );
}
