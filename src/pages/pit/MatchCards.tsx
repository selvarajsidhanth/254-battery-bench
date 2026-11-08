/* "Our matches" for the classic pit wall: one animated card per match.
   Each card: the match and a live countdown, the alliances, win odds that count up,
   ranking-point pips, and the battery with a charge timeline (will it be full before queue?). */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../data/store';
import { clock, ms, MIN } from '../../lib/format';
import type { Intel, IntelMatch } from '../../lib/intel';
import type { PlanRow } from '../../lib/plan';
import type { Battery } from '../../lib/types';
import { BatteryMenu, TeamBtn, ourWin } from './Wall';

/** Animates a number from its last value to the new one. */
export function CountUp({ value, digits = 0, suffix = '', ms: dur = 900 }: { value: number; digits?: number; suffix?: string; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return <>{shown.toFixed(digits)}{suffix}</>;
}

const until = (t: number, now: number) => {
  const m = Math.max(0, Math.round((t - now) / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m % 60).padStart(2, '0')}m`;
};

export function MatchCards({ rows, next, intel, now, pool, onAssign }: {
  rows: PlanRow[]; next?: PlanRow; intel: Intel | null; now: number; pool: Battery[]; onAssign: (key: string, id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const n = rows.length;
  const k = n <= 1 ? 2.4 : n <= 2 ? 2.1 : n <= 3 ? 1.7 : n <= 4 ? 1.4 : n <= 6 ? 1.15 : 1;
  const wins = rows.filter((r) => r.status !== 'field').map((r) => ourWin(intel?.matches[r.match.key])).filter((x): x is number => x != null);
  const late = rows.filter((r) => r.status === 'tight' || r.status === 'none').length;
  const upcoming = rows.filter((r) => r.status !== 'field').length;

  return (
    <div className="om" style={{ ['--k' as string]: k }}>
      <div className="om-sum">
        <div className="om-stat"><b><CountUp value={upcoming} /></b><span>{upcoming === 1 ? 'match left' : 'matches left'}</span></div>
        <div className="om-stat"><b>{wins.length ? <CountUp value={(wins.reduce((a, x) => a + x, 0) / wins.length) * 100} suffix="%" /> : '—'}</b><span>average win chance</span></div>
        <div className={`om-stat${late ? ' warn' : ' go'}`}><b>{late ? <CountUp value={late} /> : <CountUp value={upcoming} />}</b><span>{late ? (late === 1 ? 'battery running late' : 'batteries running late') : 'batteries on time'}</span></div>
      </div>
      <div className="om-list">
        {rows.map((r, i) => (
          <MatchCard key={r.match.key} r={r} i={i} rows={rows} isNext={r === next} im={intel?.matches[r.match.key]} us={intel?.team} now={now}
            pool={pool} open={open === r.match.key} onToggle={() => setOpen(open === r.match.key ? null : r.match.key)} onClose={() => setOpen(null)}
            onAssign={(id) => { setOpen(null); onAssign(r.match.key, id); }} />
        ))}
      </div>
    </div>
  );
}

function Plates({ list, us }: { list?: string[]; us?: string }) {
  if (!list?.length) return <span className="om-none">—</span>;
  return <>{list.map((t) => (t === us ? <span key={t} className="om-plate us">{t === 'US' ? 'US' : t}</span> : <TeamBtn key={t} t={t} cls="om-plate" />))}</>;
}

function MatchCard({ r, i, rows, isNext, im, us, now, pool, open, onToggle, onClose, onAssign }: {
  r: PlanRow; i: number; rows: PlanRow[]; isNext: boolean; im?: IntelMatch; us?: string; now: number; pool: Battery[];
  open: boolean; onToggle: () => void; onClose: () => void; onAssign: (id: string) => void;
}) {
  const { battery, data } = useStore();
  const s = data.settings;
  const b = r.batteryId ? battery(r.batteryId) : undefined;
  const start = ms(r.match.time);
  const field = r.status === 'field';
  const side = im?.us ?? null;
  const win = ourWin(im);
  const redPct = im?.redWin != null ? Math.round(im.redWin * 100) : null;
  const mates = side ? im![side] : [];
  const opp = side ? im![side === 'red' ? 'blue' : 'red'] : [];
  const cls = `om-card${open ? ' open' : ''}${field ? ' field' : ''}${isNext ? ' next' : ''}${r.status === 'tight' ? ' tight' : ''}${r.status === 'none' ? ' none' : ''} ${side ?? ''}`;

  // charge timeline: now → queue time. Where does "full" land?
  const span = Math.max(1, r.needBy - now);
  const fullAt = r.readyAt ?? now;
  const fullPos = Math.min(100, Math.max(0, ((fullAt - now) / span) * 100));
  const lateBy = Math.max(0, fullAt - r.needBy);
  const charged = fullAt <= now; // "tight" can also just mean the queue time already passed
  const [stateText, stateCls] =
    r.status === 'installed' ? ['In the robot', 'go']
    : r.status === 'ready' ? ['Ready now', 'go']
    : r.status === 'charging' ? [`Full ${clock(fullAt)}`, '']
    : r.status === 'tight' && charged ? ['Ready · queue now', 'warn']
    : r.status === 'tight' ? [`${Math.ceil(lateBy / MIN)} min late`, 'warn']
    : r.status === 'none' ? ['No battery', 'stop'] : ['', ''];

  return (
    <article className={cls} style={{ ['--i' as string]: i }}>
      <i className="om-band" aria-hidden="true" />

      <div className="om-id">
        <div className="om-label">{field && <span className="om-live"><i />On field</span>}{isNext && <span className="om-next">Next</span>}</div>
        <b>{r.match.label}</b>
        <span className="om-time">{clock(r.match.time)}</span>
        {!field && <span className="om-in">in <strong>{until(start, now)}</strong></span>}
        {field && (
          <span className="om-prog"><i style={{ width: `${Math.min(100, Math.max(0, ((now - start) / (s.matchMin * MIN)) * 100))}%` }} /></span>
        )}
      </div>

      <div className="om-teams">
        {side ? <>
          <div className="om-al"><span className={`om-side ${side}`}>{side}</span><Plates list={mates} us={us} /></div>
          <div className="om-al opp"><span className={`om-side ${side === 'red' ? 'blue' : 'red'}`}>vs</span><Plates list={opp} us={us} /></div>
        </> : <span className="om-none">Alliances not posted</span>}
      </div>

      <div className="om-win">
        {win != null && redPct != null ? <>
          <b className={side ?? ''}><CountUp value={win * 100} suffix="%" /></b>
          <div className="om-bar" aria-label={`Red ${redPct}%, blue ${100 - redPct}%`}><i className="r" style={{ width: `${redPct}%` }} /><i className="b" /></div>
          <div className="om-meta">
            {im!.rp.length > 0 && <span className={`om-pips ${side ?? ''}`} title={im!.rp.map((p, k) => `Bonus RP ${k + 1}: ${Math.round(p * 100)}%`).join('\n')}>
              {im!.rp.map((p, k) => <i key={k} className={p >= 0.5 ? 'on' : ''} style={{ ['--j' as string]: k }} />)}</span>}
            {im!.pred && <span>{Math.round(side === 'blue' ? im!.pred.blue : im!.pred.red)}–{Math.round(side === 'blue' ? im!.pred.red : im!.pred.blue)}</span>}
          </div>
        </> : <span className="om-none">{im?.result ? `${im.result.red}–${im.result.blue}` : 'No odds yet'}</span>}
      </div>

      <div className="om-bat">
        {field ? <div className="om-bfield"><b>{b?.label ?? '—'}</b><span>on the field</span></div> : <>
          <button className={`om-bbtn${open ? ' open' : ''}${r.manual ? ' locked' : ''}`} onClick={onToggle} aria-expanded={open}>
            <span className="l"><b>{b?.label ?? 'No battery'}</b><em>{r.manual ? 'Locked' : 'Auto'}</em></span>
            <span className={`st ${stateCls}`}>{stateText}</span>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
          </button>
          {b && r.status !== 'installed' && (
            <div className={`om-track${charged ? ' ready' : fullAt > r.needBy ? ' late' : ''}`} title={`Charging until ${clock(fullAt)} · queue by ${clock(r.needBy)}`}>
              <i className="chg" style={{ width: `${fullPos}%` }} />
              <i className="ok" style={{ left: `${fullPos}%` }} />
              <span className="q">queue {clock(r.needBy)}</span>
            </div>
          )}
          {open && <BatteryMenu r={r} i={i} rows={rows} pool={pool} now={now} onPick={onAssign} onClose={onClose} />}
        </>}
      </div>
    </article>
  );
}
