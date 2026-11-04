import { useEffect, useState } from 'react';
import { useStore } from '../../data/store';
import { Icon } from '../../components/ui';
import { DEFAULT_SETTINGS } from '../../lib/domain';
import { clock, ms, shortDate } from '../../lib/format';
import { parseScheduleLines } from '../../lib/schedule';
import type { EventConfig, Member, Settings } from '../../lib/types';

const FIELDS: { key: keyof Settings; title: string; desc: string; unit: string; step?: number; nullable?: boolean }[] = [
  { key: 'irMax', title: 'Internal-resistance limit', desc: 'At or above this, a battery is pulled from match rotation.', unit: 'mΩ', step: 0.1 },
  { key: 'irWatch', title: 'Watch zone starts', desc: 'Between this and the limit, a battery is practice-only.', unit: 'mΩ', step: 0.1 },
  { key: 'projectWeeks', title: 'Early warning', desc: 'Put a battery on watch if its IR trend reaches the limit within this many weeks.', unit: 'weeks' },
  { key: 'socTarget', title: 'Charge target', desc: 'What a full battery reads on the Beak straight off the charger.', unit: '%' },
  { key: 'socMin', title: 'Minimum charge to test', desc: 'Below this, IR and voltage readings aren’t trustworthy. Recharge and retest.', unit: '%' },
  { key: 'v0Watch', title: 'Open-load voltage, watch', desc: 'Fresh off the charger, a healthy battery reads at least this.', unit: 'V', step: 0.01 },
  { key: 'v0Min', title: 'Open-load voltage, pull', desc: 'Below this, the battery is undercharged or losing capacity.', unit: 'V', step: 0.01 },
  { key: 'mcaFloor', title: 'Cranking-amps floor', desc: 'AutoMeter pass/fail. Leave blank until the team sets it.', unit: 'MCA', nullable: true },
  { key: 'mcaEvery', title: 'MCA check interval', desc: 'The AutoMeter eats surface charge, so ask for it every Nth test.', unit: 'tests' },
  { key: 'restMin', title: 'Rest before charging', desc: 'Never recharge a hot battery.', unit: 'min' },
  { key: 'chargeMin', title: 'Typical full charge', desc: 'Drives every charging countdown. Time one real charge on the GoCharge.', unit: 'min' },
  { key: 'staleDays', title: 'Test reminder', desc: 'Flag batteries that haven’t been tested in this long.', unit: 'days' },
  { key: 'queueLeadMin', title: 'Queue lead time', desc: 'At events, the robot must be in queue this long before its match.', unit: 'min' },
];

export function SettingsPage() {
  const { mode } = useStore();
  return (
    <section className="view">
      <div className="page-h"><div><h1>Settings</h1><p>Thresholds every verdict is measured against, the event schedule, and who has access.</p></div></div>
      <Thresholds />
      <EventSettings />
      {mode === 'cloud' && <Members />}
    </section>
  );
}

function Thresholds() {
  const { data, isAdmin, act, toast } = useStore();
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, data.settings[f.key] == null ? '' : String(data.settings[f.key])])));
  }, [data.settings]);
  const save = async () => {
    const next = { ...data.settings } as Record<string, number | null>;
    for (const f of FIELDS) {
      const v = form[f.key].trim();
      if (v === '' && f.nullable) { next[f.key] = null; continue; }
      const n = parseFloat(v);
      if (Number.isNaN(n)) return toast(`${f.title} needs a number`);
      next[f.key] = n;
    }
    if ((next.irWatch as number) >= (next.irMax as number)) return toast('The watch zone has to start below the limit');
    await act.saveSettings(next as unknown as Settings);
    toast('Thresholds saved');
  };
  return (
    <section className="panel">
      <div className="ph"><h2>Thresholds</h2><span className="note">{isAdmin ? 'Applies to the whole fleet' : 'Only admins can change these'}</span></div>
      {FIELDS.map((f) => (
        <div className="set-row" key={f.key}>
          <div><div className="st">{f.title}</div><div className="sd">{f.desc} <span className="mute">Default {DEFAULT_SETTINGS[f.key] ?? 'not set'}.</span></div></div>
          <label className="inp" style={{ padding: '6px 10px' }}>
            <input style={{ fontSize: 18 }} inputMode="decimal" disabled={!isAdmin} value={form[f.key] ?? ''} placeholder={f.nullable ? 'not set' : ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            <span className="u">{f.unit}</span>
          </label>
        </div>
      ))}
      {isAdmin && <div className="pb row-acts" style={{ borderTop: '1px solid var(--ink)' }}>
        <button className="btn primary" onClick={save}>Save thresholds</button>
        <button className="btn" onClick={() => setForm(Object.fromEntries(FIELDS.map((f) => [f.key, DEFAULT_SETTINGS[f.key] == null ? '' : String(DEFAULT_SETTINGS[f.key])])))}>Reset to defaults</button>
      </div>}
    </section>
  );
}

const TBA_KEY = 'bb2:tbaKey';
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function EventSettings() {
  const { data, act, toast, now } = useStore();
  const [ev, setEv] = useState<EventConfig>(data.event);
  const [paste, setPaste] = useState('');
  const [tbaEvent, setTbaEvent] = useState('');
  const [tbaKey, setTbaKey] = useState(() => { try { return localStorage.getItem(TBA_KEY) ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  useEffect(() => setEv(data.event), [data.event]);
  const dirty = JSON.stringify(ev) !== JSON.stringify(data.event);
  const sorted = [...ev.matches].sort((a, b) => ms(a.time) - ms(b.time));
  const save = async (next = ev) => { await act.saveEvent(next); toast('Event saved'); };

  const fromTba = async () => {
    setBusy(true);
    try {
      try { localStorage.setItem(TBA_KEY, tbaKey); } catch { /* ignore */ }
      const key = tbaEvent.trim().toLowerCase();
      const r = await fetch(`https://www.thebluealliance.com/api/v3/team/frc254/event/${key}/matches/simple`, { headers: { 'X-TBA-Auth-Key': tbaKey.trim() } });
      if (!r.ok) throw new Error(r.status === 401 ? 'TBA rejected the API key' : `TBA returned ${r.status}`);
      const list = (await r.json()) as { key: string; comp_level: string; set_number: number; match_number: number; time: number | null; predicted_time: number | null }[];
      const lvl: Record<string, string> = { qm: 'Q', ef: 'EF', qf: 'QF', sf: 'SF', f: 'F' };
      const matches = list.filter((m) => m.predicted_time || m.time).map((m) => ({
        key: m.key.split('_')[1] ?? m.key,
        label: m.comp_level === 'qm' ? `Q${m.match_number}` : m.comp_level === 'f' ? `F${m.match_number}` : `${lvl[m.comp_level] ?? m.comp_level.toUpperCase()}${m.set_number}${m.comp_level === 'sf' ? '' : '-' + m.match_number}`,
        time: new Date(((m.predicted_time ?? m.time) as number) * 1000).toISOString(),
      }));
      if (!matches.length) throw new Error('No scheduled matches for 254 at that event yet');
      const next = { ...ev, matches, name: ev.name || key.toUpperCase() };
      setEv(next);
      await save(next);
      toast(`Loaded ${matches.length} matches from The Blue Alliance`);
    } catch (e) {
      toast(`Couldn't load: ${e instanceof Error ? e.message : e}`);
    }
    setBusy(false);
  };

  return (
    <section className="panel">
      <div className="ph"><h2>Event &amp; schedule</h2><span className="note">Competition mode plans a battery for every match</span></div>
      <div className="pb" style={{ display: 'grid', gap: 16 }}>
        <div className="form-grid">
          <label className="lab"><span className="k-lab">Mode</span>
            <div className="seg">
              <button className={ev.mode === 'practice' ? 'on' : ''} onClick={() => setEv({ ...ev, mode: 'practice' })}>Practice</button>
              <button className={ev.mode === 'comp' ? 'on' : ''} onClick={() => setEv({ ...ev, mode: 'comp' })}>Competition</button>
            </div>
          </label>
          <label className="lab"><span className="k-lab">Event name</span><input className="in" value={ev.name} placeholder="Silicon Valley Regional" onChange={(e) => setEv({ ...ev, name: e.target.value })} /></label>
        </div>

        <div className="tablewrap" style={{ border: '1px solid var(--line-2)' }}>
          <table>
            <thead><tr><th>Match</th><th>Start</th><th /><th /></tr></thead>
            <tbody>
              {sorted.length === 0 && <tr><td colSpan={4} className="mute">No matches yet. Add them below, paste a list, or load from The Blue Alliance.</td></tr>}
              {sorted.map((m) => (
                <tr key={m.key}>
                  <td><input className="in" style={{ width: 90 }} value={m.label} onChange={(e) => setEv({ ...ev, matches: ev.matches.map((x) => x.key === m.key ? { ...x, label: e.target.value } : x) })} /></td>
                  <td><input className="in" type="datetime-local" style={{ width: 220 }} value={toLocalInput(m.time)} onChange={(e) => e.target.value && setEv({ ...ev, matches: ev.matches.map((x) => x.key === m.key ? { ...x, time: new Date(e.target.value).toISOString() } : x) })} /></td>
                  <td className="mute">{ms(m.time) < now ? 'played' : `${shortDate(m.time)} · ${clock(m.time)}`}{ev.assignments[m.key] ? ' · battery locked' : ''}</td>
                  <td className="r"><button className="x-btn" onClick={() => {
                    const assignments = { ...ev.assignments }; delete assignments[m.key];
                    setEv({ ...ev, matches: ev.matches.filter((x) => x.key !== m.key), assignments });
                  }}><Icon name="x" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-acts">
          <button className="btn sm" onClick={() => {
            const last = sorted[sorted.length - 1];
            const n = last ? (parseInt(last.label.replace(/\D/g, '')) || 0) + 1 : 1;
            const t = last ? ms(last.time) + 8 * 60000 : Math.ceil(now / 300000) * 300000 + 3600000;
            setEv({ ...ev, matches: [...ev.matches, { key: `qm${n}-${Date.now() % 10000}`, label: `Q${n}`, time: new Date(t).toISOString() }] });
          }}><Icon name="plus" />Add match</button>
          {sorted.length > 0 && <button className="btn sm" onClick={() => setEv({ ...ev, matches: [], assignments: {} })}>Clear schedule</button>}
        </div>

        <div className="form-grid">
          <label className="lab" style={{ gridColumn: 'span 2' }}><span className="k-lab">Paste a schedule</span>
            <textarea className="txt" rows={3} value={paste} placeholder={'Q12 10:34\nQ19 11:22 AM\nQ26 3/14 1:05 PM'} onChange={(e) => setPaste(e.target.value)} />
            <button className="btn sm" style={{ justifySelf: 'start' }} disabled={!paste.trim()} onClick={() => {
              const add = parseScheduleLines(paste);
              if (!add.length) return toast('Couldn’t read any lines. Use “Q12 10:34”.');
              const keys = new Set(add.map((m) => m.key));
              setEv({ ...ev, matches: [...ev.matches.filter((m) => !keys.has(m.key)), ...add] });
              setPaste('');
              toast(`Added ${add.length} matches. Save to apply.`);
            }}>Add these</button>
          </label>
          <label className="lab"><span className="k-lab">The Blue Alliance event key</span>
            <input className="in" value={tbaEvent} placeholder="2027casj" onChange={(e) => setTbaEvent(e.target.value)} />
            <input className="in" type="password" value={tbaKey} placeholder="TBA read API key" onChange={(e) => setTbaKey(e.target.value)} />
            <button className="btn sm" style={{ justifySelf: 'start' }} disabled={busy || !tbaEvent || !tbaKey} onClick={fromTba}>Load 254's matches</button>
            <span className="mute" style={{ fontSize: 11.5 }}>Your read key (from thebluealliance.com/account) stays on this device.</span>
          </label>
        </div>

        <div className="row-acts" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
          <button className="btn primary" disabled={!dirty} onClick={() => save()}>Save event</button>
          {dirty && <button className="btn" onClick={() => setEv(data.event)}>Discard changes</button>}
        </div>
      </div>
    </section>
  );
}

function Members() {
  const { data, isAdmin, act, toast, session } = useStore();
  const [m, setM] = useState<Member>({ email: '', name: '', role: 'member' });
  return (
    <section className="panel">
      <div className="ph"><h2>Members</h2><span className="note">Only people on this list can open the app</span></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Google account</th><th>Role</th><th /></tr></thead>
        <tbody>
          {data.members.length === 0 && <tr><td colSpan={4} className="mute">Nobody added yet. You're in as a bootstrap admin.</td></tr>}
          {data.members.map((x) => (
            <tr key={x.email}><td><b>{x.name}</b></td><td className="mute">{x.email}</td>
              <td>{isAdmin && x.email !== session.email
                ? <select className="sel" style={{ width: 120, padding: '4px 8px' }} value={x.role} onChange={(e) => act.setMember({ ...x, role: e.target.value as Member['role'] }).then(() => toast('Role updated'))}><option value="member">Member</option><option value="admin">Admin</option></select>
                : x.role === 'admin' ? 'Admin' : 'Member'}</td>
              <td className="r">{isAdmin && x.email !== session.email && <button className="x-btn" title="Remove" onClick={() => { if (confirm(`Remove ${x.name}?`)) act.removeMember(x.email).then(() => toast('Removed')); }}><Icon name="x" /></button>}</td></tr>
          ))}
        </tbody>
      </table></div>
      {isAdmin && (
        <div className="pb" style={{ borderTop: '1px solid var(--ink)', display: 'grid', gap: 12 }}>
          <div className="form-grid">
            <label className="lab"><span className="k-lab">Name</span><input className="in" value={m.name} placeholder="Alex Martinez" onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
            <label className="lab"><span className="k-lab">Google account email</span><input className="in" type="email" value={m.email} placeholder="name@gmail.com" onChange={(e) => setM({ ...m, email: e.target.value })} /></label>
            <label className="lab"><span className="k-lab">Role</span><select className="sel" value={m.role} onChange={(e) => setM({ ...m, role: e.target.value as Member['role'] })}><option value="member">Member</option><option value="admin">Admin</option></select></label>
          </div>
          <div><button className="btn primary" disabled={!/^\S+@\S+\.\S+$/.test(m.email) || !m.name.trim()} onClick={() => act.setMember({ ...m, email: m.email.toLowerCase().trim() }).then(() => { toast(`Added ${m.name}`); setM({ email: '', name: '', role: 'member' }); })}><Icon name="plus" />Add member</button></div>
        </div>
      )}
    </section>
  );
}
