import { useNavigate } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Spark } from '../../components/charts';
import { StateLabel, StatusTag } from '../../components/ui';
import { chargeStatus, type Assessment, type Health } from '../../lib/domain';
import { fmt, shortDate } from '../../lib/format';
import type { Battery, Flag } from '../../lib/types';

const ORDER: Record<Health, number> = { ok: 0, watch: 1, untested: 2, pull: 3, retired: 4 };
/** Competition by rank, then practice by capacity, then the rest. */
export function byStanding(health: Record<string, Assessment>) {
  return (a: Battery, b: Battery) => {
    const x = health[a.id], y = health[b.id];
    return ORDER[x.health] - ORDER[y.health] || (x.rank ?? 999) - (y.rank ?? 999) || (y.ah ?? -1) - (x.ah ?? -1) || a.label.localeCompare(b.label, undefined, { numeric: true });
  };
}

export function FleetTable({ batteries }: { batteries: Battery[] }) {
  const { health, testsBy, data, now } = useStore();
  const nav = useNavigate();
  const s = data.settings;
  const AH_MAX = 21;
  if (!batteries.length) return <div className="empty">No batteries match.</div>;
  return (
    <div className="tablewrap">
      <table className="fleet-t clickable">
        <thead><tr>
          <th className="r">Rank</th><th>Battery</th><th>Status</th><th>Capacity</th><th>Trend</th><th className="r">R_int</th><th className="r">MCA</th>
          <th>Last CBA</th><th>Last MCA</th><th>Location</th><th>Rotation</th>
        </tr></thead>
        <tbody>
          {[...batteries].sort(byStanding(health)).map((b) => {
            const a = health[b.id];
            const ahs = (testsBy[b.id] ?? []).filter((t) => t.ah != null).slice(-8).map((t) => t.ah as number);
            const extra = b.retired ? null
              : b.state === 'charging' ? <span className="mute"> {Math.round(chargeStatus(b, s, now).soc)}%</span> : null;
            const capCls = a.tier === 'competition' ? 'cap-comp' : a.tier === 'practice' ? 'cap-prac' : 'cap-none';
            return (
              <tr key={b.id} className={b.retired ? 'retired' : ''} onClick={() => nav(`/b/${b.id}`)}>
                <td className="r">{a.rank != null && a.rank <= s.compCount ? <b>{a.rank}</b> : <span className="mute">{a.rank ?? '—'}</span>}</td>
                <td><span className="lbl">{b.label}</span>{b.quarantined && !b.retired && <span className={b.quarantineFor === 'hold' ? 'out-tag' : 'inv-tag'} style={{ marginLeft: 7 }} title={b.quarantineFor === 'hold' ? 'Quarantined: held out, don’t use' : 'Quarantined: saved for competition'}>{b.quarantineFor === 'hold' ? 'Hold' : 'Comp'}</span>}</td>
                <td><StatusTag health={a.health} /></td>
                <td>
                  <div className="irbar">
                    <span className="v">{fmt(a.ah, 2)}</span>
                    <span className="track">
                      {a.ah != null && <i className={capCls} style={{ width: `${Math.min(100, (a.ah / AH_MAX) * 100)}%` }} />}
                      <b style={{ left: `${(s.compMinAh / AH_MAX) * 100}%` }} title={`Competition ${s.compMinAh} Ah`} />
                      <b className="thin" style={{ left: `${(s.pracMinAh / AH_MAX) * 100}%` }} title={`Practice ${s.pracMinAh} Ah`} />
                    </span>
                  </div>
                </td>
                <td><Spark values={ahs} lines={[s.compMinAh]} health={a.health} lo={Math.min(s.pracMinAh, ...ahs) - 0.5} hi={Math.max(20, ...ahs) + 0.5} /></td>
                <td className="r">{a.rintPre != null ? <span className={a.rintPre > s.compMaxRint ? 'num-flag' : ''}>{a.rintPre.toFixed(0)}<span className="mute u"> mΩ</span></span> : <span className="mute">—</span>}</td>
                <td className="r">{a.mca != null ? <span className={a.mca < s.compMinMca ? 'num-flag' : ''}>{a.mca}</span> : <span className="mute">—</span>}</td>
                <td><Due at={a.lastCbaAt} due={a.cbaDue} /></td>
                <td><Due at={a.lastMcaAt} due={a.mcaDue} /></td>
                <td className="mute">{b.location || '—'}</td>
                <td>{b.retired ? <span className="mute">—</span> : <StateLabel state={b.state} extra={extra} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Due({ at, due }: { at: string | null; due: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span className={at ? '' : 'mute'}>{at ? shortDate(at) : 'Never'}</span>
      {due && <span className="inv-tag">Due</span>}
    </span>
  );
}

export interface AlertItem {
  key: string;
  batteryId?: string;
  kind: 'pull' | 'watch' | 'due' | 'flag';
  title: string;
  detail: string;
  flag?: Flag;
  link?: string;
}

/** What someone should act on, worst first. Routine "practice tier" status isn't an alert. */
export function useAlerts(): AlertItem[] {
  const { active, health, data } = useStore();
  const out: AlertItem[] = [];
  const pending = data.flags.filter((f) => f.status === 'pending');
  for (const b of [...active].sort(byStanding(health))) {
    const a = health[b.id];
    const flag = pending.find((f) => f.batteryId === b.id);
    if (flag) out.push({ key: `f-${flag.id}`, batteryId: b.id, kind: 'flag', title: `${b.label} flagged for retirement`, detail: `${flag.by}: “${flag.reason}”`, flag });
    if (a.health === 'pull') {
      out.push({ key: `p-${b.id}`, batteryId: b.id, kind: 'pull', title: `${b.label} isn't suitable for practice or competition`,
        detail: a.reasons.filter((r) => r.level === 'pull').map((r) => r.text).join('. ') + '. Retest it or decommission it.' });
    } else if (a.tier === 'competition' && a.health !== 'ok') {
      out.push({ key: `w-${b.id}`, batteryId: b.id, kind: 'watch', title: `${b.label} (rank #${a.rank}) needs a look`, detail: a.reasons.map((r) => r.text).join('. ') + '.' });
    } else if (a.tier === 'competition' && a.reasons.length) {
      out.push({ key: `t-${b.id}`, batteryId: b.id, kind: 'watch', title: `${b.label} (rank #${a.rank}) is trending down`, detail: a.reasons.map((r) => r.text).join('. ') + '.' });
    }
  }
  const cba = active.filter((b) => health[b.id].cbaDue).length;
  const mca = active.filter((b) => health[b.id].mcaDue).length;
  if (cba || mca) {
    out.push({ key: 'due', kind: 'due', link: '/testing',
      title: `${cba + mca} bench tests due`,
      detail: [cba && `${cba} ${cba === 1 ? 'battery needs' : 'batteries need'} a CBA test`, mca && `${mca} ${mca === 1 ? 'needs' : 'need'} an MCA test`].filter(Boolean).join(', ') + '.' });
  }
  return out;
}
