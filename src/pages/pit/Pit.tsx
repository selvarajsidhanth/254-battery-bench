/* Pit mode: a glanceable wall display for the pit monitor.
   Practice view during build season, competition view at events. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { BRAND } from '../../brand';
import { byStanding } from '../sheet/shared';
import { BatteryActions } from '../../components/BatteryActions';
import { Icon, useNow } from '../../components/ui';
import { SYSCHECK, chargeStatus, heldOut, savedForComp } from '../../lib/domain';
import { MIN, clock, fmt, minutesSince, mmss, ms } from '../../lib/format';
import { NexusCtx, fullSchedule, liveSchedule, liveStatus, useNexus, withNexusAlliances } from '../../lib/nexus';
import { useIntel, useTeamBrand } from '../../lib/intel';
import { tbaCreds } from '../../lib/tba';
import { Comp } from './Wall';
import { AllianceWall, Broadcast, LayoutSwitch } from './Showcase';
import { WinParty } from './WinParty';
import type { Battery } from '../../lib/types';

export function Pit() {
  const { data, mode } = useStore();
  const [params, setParams] = useSearchParams();
  const now = useNow(1000);
  const [sel, setSel] = useState<Battery | null>(null);
  const view = (params.get('view') as 'practice' | 'comp' | null) ?? data.event.mode;
  const comp = view === 'comp';
  // competition layout: classic pit wall, or a showcase one. Remembered per device.
  const saved = (() => { try { return localStorage.getItem('bb2:pitSkin') ?? 'classic'; } catch { return 'classic'; } })();
  const skin = params.get('skin') ?? saved;
  const toggle = () => setParams({ view: view === 'comp' ? 'practice' : 'comp', ...(params.get('skin') ? { skin } : {}) }, { replace: true });
  const setSkin = (k: string) => {
    try { localStorage.setItem('bb2:pitSkin', k); } catch { /* private mode */ }
    setParams({ view: 'comp', skin: k }, { replace: true });
  };
  const brand = useTeamBrand(BRAND);
  const [pulse, setPulse] = useState(0);
  // L flips between the classic pit wall and the alliance wall
  useEffect(() => {
    if (!comp) return;
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'l' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      setSkin(skin === 'wall' ? 'classic' : 'wall');
      setPulse((n) => n + 1);
      auto.current.on = false; // a manual pick wins until the next match
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const { intel: tbaIntel, needs, refreshCreds } = useIntel(comp ? data.event.tbaEvent : '', data.event.matches, comp && mode === 'local', now);
  const s = data.settings;
  const { nexus } = useNexus(comp ? data.event.tbaEvent : '', data.event.matches, s.queueLeadMin, comp && mode === 'local', now);
  // playoffs: our matches TBA / Nexus know about that the saved schedule doesn't (alliances from Nexus if TBA lags)
  const team = tbaCreds().team;
  const full = useMemo(() => fullSchedule(data.event.matches, tbaIntel, nexus, team), [data.event.matches, tbaIntel, nexus, team]);
  const intel = useMemo(() => withNexusAlliances(tbaIntel, nexus, full, team), [tbaIntel, nexus, full, team]);
  const us = intel?.rankings.find((r) => r.team === intel.team);
  const party = comp && <WinParty intel={intel} event={data.event.tbaEvent} now={now} test={params.has('party')}
    labels={Object.fromEntries(full.map((m) => [m.key, m.label]))} />;

  // ~15 min before we queue (or once Nexus calls us), jump to the Wall; go back to Classic after the match.
  const sched = liveSchedule(full, intel, nexus).sort((a, b) => ms(a.time) - ms(b.time));
  const playing = sched.find((m) => ms(m.time) <= now && ms(m.time) + s.matchMin * MIN > now);
  const upcoming = sched.find((m) => ms(m.time) > now);
  const upLive = upcoming ? liveStatus(upcoming, ms(upcoming.time) - s.queueLeadMin * MIN, nexus, now) : null;
  const upNear = !!upLive && upLive.phase !== 'later';
  // the match that makes it "near": the next one once it's close, else the one on the field
  const cur = upNear ? upcoming : playing;
  const curLive = upNear ? upLive : playing ? { label: 'On the field now' } : null;
  const near = !!cur;
  const auto = useRef<{ for: string | null; on: boolean }>({ for: (() => { try { return localStorage.getItem('bb2:autoWallFor'); } catch { return null; } })(), on: false });
  const [flash, setFlash] = useState<{ n: number; label: string; text: string } | null>(null);
  useEffect(() => {
    if (!comp) return;
    if (near && cur && auto.current.for !== cur.key) {
      auto.current.for = cur.key;
      try { localStorage.setItem('bb2:autoWallFor', cur.key); } catch { /* private mode */ }
      if (skin === 'classic') {
        auto.current.on = true;
        setSkin('wall');
        setFlash((f) => ({ n: (f?.n ?? 0) + 1, label: cur.label, text: curLive!.label }));
      }
    } else if (!near && auto.current.on && skin === 'wall') {
      auto.current.on = false;
      setSkin('classic');
    }
  }, [comp, near, cur?.key, skin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (comp && (skin === 'wall' || skin === 'broadcast')) {
    const Skin = skin === 'wall' ? AllianceWall : Broadcast;
    return (
      <NexusCtx.Provider value={nexus}>
      <div className="pit sc-root">
        <Skin now={now} onPick={setSel} intel={intel} needs={needs} onCreds={refreshCreds} />
        {flash && <div className="sc-near" key={flash.n} role="status"><span>Match near</span><b>{flash.label}</b><em>{flash.text}</em></div>}
        <LayoutSwitch skin={skin} onSkin={setSkin} pulse={pulse} />
        {party}
        {sel && <BatteryActions battery={sel} onClose={() => setSel(null)} dark />}
      </div>
      </NexusCtx.Provider>
    );
  }

  return (
    <NexusCtx.Provider value={nexus}>
    <div className="pit">
      <header className="p-top">
        <div className="p-cell"><span className="p-mark">{brand.mark}</span><span className="p-name">{brand.name}</span></div>
        <div className="p-cell"><button className={`p-session${view === 'comp' ? ' live' : ''}`} onClick={toggle} title="Switch view">
          {view === 'comp' ? (data.event.name || 'Competition') : 'Practice'}</button></div>
        {comp && us && (
          <div className="p-cell p-rank"><span className="k">Rank</span><b>#{us.rank}</b>
            <span className="d">{us.wins}-{us.losses}-{us.ties}{us.rs != null ? <> · RS {us.rs.toFixed(2)}</> : null}</span></div>
        )}
        <div className="sp" />
        <div className="p-cell"><button className="p-link" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()}><Icon name="expand" /></button></div>
        <div className="p-cell"><Link className="p-link" to="/">Datasheet</Link></div>
        <div className="p-cell"><span className={`p-sync${mode === 'local' ? ' local' : ''}`}><i aria-hidden="true" />{mode === 'cloud' ? 'Live' : 'Demo'}</span></div>
        <div className="p-cell p-clock">{clock(now)}</div>
      </header>
      {comp ? <Comp now={now} onPick={setSel} intel={intel} needs={needs} onCreds={refreshCreds} /> : <Practice now={now} onPick={setSel} />}
      {comp && <LayoutSwitch skin="classic" onSkin={setSkin} pulse={pulse} />}
      {party}
      {sel && <BatteryActions battery={sel} onClose={() => setSel(null)} dark />}
    </div>
    </NexusCtx.Provider>
  );
}

type Pick = (b: Battery) => void;

/** Battery warnings across the top. Each can be dismissed (it comes back if the warning changes),
    and dismissed ones stay listed behind a toggle. */
export function Signals() {
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

export function ChargingList({ now, onPick, compact }: { now: number; onPick: Pick; compact?: boolean }) {
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

/** Systems checks use a worse battery: in, one check, out, back on a charger (it refills fast). */
export function SystemsCheck({ robot, pick, busy, now, onPick, onUse, onDone }: {
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
