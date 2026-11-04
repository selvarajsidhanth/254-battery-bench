import { useState } from 'react';
import { useStore } from '../../data/store';
import { Icon, Modal } from '../../components/ui';
import type { Tier } from '../../lib/domain';
import type { RotationState } from '../../lib/types';
import { FleetTable } from './shared';

type Filter = 'active' | Tier | 'quarantined' | 'due' | 'retired' | 'all';
const LOCATIONS = ['AR Charger', 'Shop - TBT', 'Pit'];

export function Batteries() {
  const { data, health, act, toast } = useStore();
  const [f, setF] = useState<Filter>('active');
  const [adding, setAdding] = useState(false);
  const live = data.batteries.filter((b) => !b.retired);
  const match = (k: Filter) => (b: (typeof data.batteries)[number]) =>
    k === 'all' ? true : k === 'retired' ? b.retired : b.retired ? false
    : k === 'active' ? true : k === 'quarantined' ? !!b.quarantined : k === 'due' ? health[b.id].stale : health[b.id].tier === k;
  const filters: [Filter, string][] = [
    ['active', 'Active'], ['competition', 'Competition'], ['practice', 'Practice'], ['none', 'Not suitable'],
    ['incomplete', 'Needs tests'], ['quarantined', 'Quarantined'], ['due', 'Tests due'], ['retired', 'Decommissioned'], ['all', 'All'],
  ];
  const shown = data.batteries.filter(match(f));

  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Batteries</h1></div>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add battery</button>
      </div>
      <section className="panel">
        <div className="ph"><h2>Fleet</h2>
          <div className="filters">
            {filters.map(([k, l]) => <button key={k} className={`chip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} {(k === 'all' || k === 'retired' ? data.batteries : live).filter(match(k)).length}</button>)}
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

function AddBattery({ onClose, onAdd }: { onClose: () => void; onAdd: (v: { label: string; manufacturer: string; lotCode: string; location: string; inService: string; state: RotationState }) => void }) {
  const [label, setLabel] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [location, setLocation] = useState('Shop - TBT');
  const [inService, setInService] = useState(new Date().toISOString().slice(0, 7));
  const [state, setState] = useState<RotationState>('shelf');
  const mfr = manufacturer || ({ M: 'MK', E: 'Energizer' } as Record<string, string>)[label.trim().slice(-1).toUpperCase()] || '';
  return (
    <Modal title="Add a battery" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!label.trim()} onClick={() => onAdd({ label, manufacturer: mfr, lotCode, location, inService, state })}>Add</button></>}>
      <p>Use the name written on the case, like 2026-31M (year, number, M for MK or E for Energizer).</p>
      <label className="lab"><span className="k-lab">Name</span><input className="in" autoFocus placeholder="2026-47M" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <div className="form-grid">
        <label className="lab"><span className="k-lab">Manufacturer</span><input className="in" placeholder={mfr || 'MK'} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></label>
        <label className="lab"><span className="k-lab">Lot code</span><input className="in" value={lotCode} onChange={(e) => setLotCode(e.target.value)} /></label>
      </div>
      <div className="form-grid">
        <label className="lab"><span className="k-lab">Location</span>
          <input className="in" list="add-locations" value={location} onChange={(e) => setLocation(e.target.value)} />
          <datalist id="add-locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist></label>
        <label className="lab"><span className="k-lab">In service since</span><input className="in" type="month" value={inService} onChange={(e) => setInService(e.target.value)} /></label>
      </div>
      <label className="lab"><span className="k-lab">Rotation</span>
        <select className="sel" value={state} onChange={(e) => setState(e.target.value as RotationState)}>
          <option value="shelf">On the shelf</option><option value="charging">On a charger</option><option value="ready">Charged and tested</option>
        </select>
      </label>
    </Modal>
  );
}
