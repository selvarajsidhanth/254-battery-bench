import { useState } from 'react';
import { useStore } from '../../data/store';
import { Icon, Modal } from '../../components/ui';
import type { Health } from '../../lib/domain';
import type { RotationState } from '../../lib/types';
import { FleetTable } from './shared';

type Filter = 'all' | 'active' | Health;

export function Batteries() {
  const { data, health, act, toast } = useStore();
  const [f, setF] = useState<Filter>('active');
  const [adding, setAdding] = useState(false);
  const count = (fn: (h: Health, retired: boolean) => boolean) => data.batteries.filter((b) => fn(health[b.id].health, b.retired)).length;
  const filters: [Filter, string, number][] = [
    ['active', 'Active', count((_, r) => !r)],
    ['ok', 'Match-ready', count((h) => h === 'ok')],
    ['watch', 'Watch', count((h) => h === 'watch')],
    ['pull', 'Pull', count((h) => h === 'pull')],
    ['untested', 'Untested', count((h) => h === 'untested')],
    ['retired', 'Retired', count((_, r) => r)],
    ['all', 'All', data.batteries.length],
  ];
  const shown = data.batteries.filter((b) =>
    f === 'all' ? true : f === 'active' ? !b.retired : health[b.id].health === f);

  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Batteries</h1><p>Every pack we own, newest readings first. Click a row for its full record.</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add battery</button>
      </div>
      <section className="panel">
        <div className="ph"><h2>Fleet</h2>
          <div className="filters">
            {filters.map(([k, l, n]) => <button key={k} className={`chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} {n}</button>)}
          </div>
        </div>
        <FleetTable batteries={shown} />
      </section>
      {adding && <AddBattery onClose={() => setAdding(false)} onAdd={async (v) => {
        try { await act.addBattery(v); toast(`Added ${v.label.toUpperCase()}`); setAdding(false); }
        catch (e) { toast(e instanceof Error ? e.message : String(e)); }
      }} />}
    </section>
  );
}

function AddBattery({ onClose, onAdd }: { onClose: () => void; onAdd: (v: { label: string; model: string; inService: string; state: RotationState }) => void }) {
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('MK ES17-12');
  const [inService, setInService] = useState(new Date().toISOString().slice(0, 7));
  const [state, setState] = useState<RotationState>('charging');
  return (
    <Modal title="Add a battery" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!label.trim()} onClick={() => onAdd({ label, model, inService, state })}>Add</button></>}>
      <p>Use the number written on the case.</p>
      <label className="lab"><span className="k-lab">Label</span><input className="in" autoFocus placeholder="B-13" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <label className="lab"><span className="k-lab">Model</span><input className="in" value={model} onChange={(e) => setModel(e.target.value)} /></label>
      <label className="lab"><span className="k-lab">In service since</span><input className="in" type="month" value={inService} onChange={(e) => setInService(e.target.value)} /></label>
      <label className="lab"><span className="k-lab">Where is it now?</span>
        <select className="sel" value={state} onChange={(e) => setState(e.target.value as RotationState)}>
          <option value="charging">On a charger</option><option value="resting">Resting</option><option value="ready">Charged and tested</option>
        </select>
      </label>
    </Modal>
  );
}
