/* The testing queue: which batteries are due for a CBA or MCA test, in the
   order to test them. Replaces the "Schedule" tab of the old sheet. */
import { Link } from 'react-router-dom';
import { useStore } from '../../data/store';
import { StateLabel, StatusTag } from '../../components/ui';
import { addMonths } from '../../lib/domain';
import { ago, ms, shortDate } from '../../lib/format';
import type { Battery } from '../../lib/types';

export function Testing() {
  const { active, health, data, now } = useStore();
  const s = data.settings;

  const queue = (kind: 'cba' | 'mca') => {
    const dueKey = kind === 'cba' ? 'cbaDue' : 'mcaDue';
    const lastKey = kind === 'cba' ? 'lastCbaAt' : 'lastMcaAt';
    const charged = (b: Battery) => b.state === 'ready' || b.state === 'charging';
    return active
      .filter((b) => health[b.id][dueKey])
      .sort((a, b) => {
        // like the old sheet: charged batteries first, then never-tested, then most overdue, then competition before practice
        const x = health[a.id], y = health[b.id];
        return Number(charged(b)) - Number(charged(a))
          || Number(!y[lastKey]) - Number(!x[lastKey])
          || ms(x[lastKey] ?? 0) - ms(y[lastKey] ?? 0)
          || (x.rank ?? 999) - (y.rank ?? 999);
      });
  };
  const cba = queue('cba');
  const mca = queue('mca');

  const List = ({ kind, list }: { kind: 'cba' | 'mca'; list: Battery[] }) => {
    const lastKey = kind === 'cba' ? 'lastCbaAt' : 'lastMcaAt';
    return list.length ? (
      <div className="tablewrap"><table className="clickable">
        <thead><tr><th>#</th><th>Battery</th><th>Last {kind.toUpperCase()}</th><th>Why</th><th>Rotation</th><th /></tr></thead>
        <tbody>
          {list.map((b, i) => {
            const a = health[b.id];
            const last = a[lastKey];
            const months = a.tier === 'competition' ? (kind === 'cba' ? s.compCbaMonths : s.compMcaMonths) : (kind === 'cba' ? s.pracCbaMonths : s.pracMcaMonths);
            const why = !last ? 'Never tested' : `Over ${months} ${months === 1 ? 'month' : 'months'} (${a.tier === 'competition' ? 'competition' : 'practice'}), due ${shortDate(addMonths(last, months))}`;
            const charged = b.state === 'ready' || b.state === 'charging';
            return (
              <tr key={b.id}>
                <td className="mute">{i + 1}</td>
                <td><Link to={`/b/${b.id}`} style={{ textDecoration: 'none' }}><span className="lbl" style={{ fontWeight: charged ? 800 : 600, color: charged ? 'var(--ink)' : 'var(--ink-2)' }}>{b.label}</span></Link> <StatusTag health={a.health} /></td>
                <td>{last ? <>{shortDate(last)} <span className="mute">· {ago(last, now)}</span></> : <span className="mute">Never</span>}</td>
                <td className="wrap mute" style={{ fontSize: 12.5 }}>{why}</td>
                <td><StateLabel state={b.state} /></td>
                <td className="r"><Link className="btn sm" to={`/log?b=${b.id}&t=${kind}`}>Log {kind.toUpperCase()}</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    ) : <div className="empty">Nothing is due for {kind.toUpperCase()} testing.</div>;
  };

  return (
    <section className="view">
      <div className="page-h"><div><h1>Testing queue</h1><p>Test from the top. Batteries that are charged (bold) go first, then ones that have never been tested, then the most overdue.</p></div></div>
      <section className="panel">
        <div className="ph"><h2>Due for CBA</h2><span className="note">{cba.length} batteries · competition every {s.compCbaMonths} mo, practice every {s.pracCbaMonths} mo</span></div>
        <List kind="cba" list={cba} />
      </section>
      <section className="panel">
        <div className="ph"><h2>Due for MCA</h2><span className="note">{mca.length} batteries · competition every {s.compMcaMonths} mo, practice every {s.pracMcaMonths} mo</span></div>
        <List kind="mca" list={mca} />
      </section>
    </section>
  );
}
