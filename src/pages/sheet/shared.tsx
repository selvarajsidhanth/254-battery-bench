import { useNavigate } from 'react-router-dom';
import { useStore } from '../../data/store';
import { Spark } from '../../components/charts';
import { StateLabel, StatusTag } from '../../components/ui';
import { chargeStatus, restRemainingMin, type Health } from '../../lib/domain';
import { ago, fmt } from '../../lib/format';
import type { Battery, Flag } from '../../lib/types';

export function FleetTable({ batteries }: { batteries: Battery[] }) {
  const { health, testsBy, data, now } = useStore();
  const nav = useNavigate();
  const s = data.settings;
  const scaleMax = Math.max(20, s.irMax / 0.75);
  if (!batteries.length) return <div className="empty">No batteries match.</div>;
  return (
    <div className="tablewrap">
      <table className="fleet-t clickable">
        <thead><tr>
          <th>Battery</th><th>State</th><th>Internal resistance</th><th>Trend</th><th className="r">Change / wk</th>
          <th className="r">SoC</th><th className="r">V₀</th><th className="r">Cycles</th><th>Last test</th><th>Status</th>
        </tr></thead>
        <tbody>
          {batteries.map((b) => {
            const a = health[b.id];
            const irs = (testsBy[b.id] ?? []).filter((t) => t.ir != null).slice(-8).map((t) => t.ir as number);
            const pw = a.trend?.perWeek ?? null;
            const extra = b.retired ? null
              : b.state === 'charging' ? <span className="mute"> {Math.round(chargeStatus(b, s, now).soc)}%</span>
              : b.state === 'resting' ? <span className="mute"> {Math.ceil(restRemainingMin(b, s, now))}m</span> : null;
            return (
              <tr key={b.id} className={b.retired ? 'retired' : ''} onClick={() => nav(`/b/${b.id}`)}>
                <td><span className="lbl">{b.label}</span>{b.inService && <span className="yr">{b.inService.slice(0, 4)}</span>}</td>
                <td>{b.retired ? <span className="mute">—</span> : <StateLabel state={b.state} extra={extra} />}</td>
                <td>
                  <div className="irbar">
                    <span className={`v${a.health === 'pull' ? ' pull' : ''}`}>{fmt(a.ir, 1)}</span>
                    <span className="track">
                      {a.ir != null && <i className={a.health} style={{ width: `${Math.min(100, (a.ir / scaleMax) * 100)}%` }} />}
                      <b style={{ left: `${(s.irMax / scaleMax) * 100}%` }} />
                    </span>
                  </div>
                </td>
                <td><Spark values={irs} limit={s.irMax} health={a.health} /></td>
                <td className="r">{pw == null ? <span className="mute">—</span> : <><span className={`delta${pw > 0.5 ? ' hot' : pw > 0.15 ? ' up' : ''}`}>{pw >= 0 ? '+' : ''}{pw.toFixed(2)}</span> <span className="mute">mΩ</span></>}</td>
                <td className="r">{a.soc != null ? `${a.soc}%` : '—'}</td>
                <td className="r">{fmt(a.v0, 2)}</td>
                <td className="r">{b.cycles}</td>
                <td className={a.stale && !b.retired ? '' : 'mute'}>{a.stale && !b.retired && a.lastTestAt ? <b>{ago(a.lastTestAt, now)}</b> : ago(a.lastTestAt, now)}</td>
                <td><StatusTag health={a.health} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface AlertItem {
  key: string;
  batteryId: string;
  kind: 'pull' | 'watch' | 'stale' | 'flag';
  title: string;
  detail: string;
  flag?: Flag;
}

/** Everything a person should do something about, worst first. */
export function useAlerts(): AlertItem[] {
  const { active, health, data, now } = useStore();
  const out: AlertItem[] = [];
  const pending = data.flags.filter((f) => f.status === 'pending');
  const order: Record<Health, number> = { pull: 0, watch: 1, untested: 2, ok: 3, retired: 4 };
  for (const b of [...active].sort((x, y) => order[health[x.id].health] - order[health[y.id].health])) {
    const a = health[b.id];
    const flag = pending.find((f) => f.batteryId === b.id);
    if (flag) {
      out.push({ key: `f-${flag.id}`, batteryId: b.id, kind: 'flag', title: `${b.label} flagged for retirement`, detail: `${flag.by}: “${flag.reason}”`, flag });
    }
    if (a.health === 'pull') {
      out.push({ key: `p-${b.id}`, batteryId: b.id, kind: 'pull', title: `${b.label} should come out of rotation`, detail: a.reasons.filter((r) => r.level === 'pull').map((r) => r.text).join('. ') + '. Don’t charge it for match use.' });
    } else if (a.health === 'watch') {
      out.push({ key: `w-${b.id}`, batteryId: b.id, kind: 'watch', title: `${b.label} is on watch`, detail: a.reasons.map((r) => r.text).join('. ') + '. Practice only, keep it out of elims.' });
    }
    if (a.health === 'untested') {
      out.push({ key: `u-${b.id}`, batteryId: b.id, kind: 'stale', title: `${b.label} has never been tested`, detail: 'Beak it right off the charger to start its record.' });
    } else if (a.stale && a.lastTestAt) {
      out.push({ key: `s-${b.id}`, batteryId: b.id, kind: 'stale', title: `${b.label} hasn’t been tested in ${Math.round((now - Date.parse(a.lastTestAt)) / 86_400_000)} days`, detail: 'Test it the next time it comes off the charger.' });
    }
  }
  return out;
}
