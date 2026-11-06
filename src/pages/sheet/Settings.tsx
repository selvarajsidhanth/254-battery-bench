import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Imports } from './Imports';
import { TBA_KEY, TEAM_KEY } from '../../lib/tba';
import { useStore } from '../../data/store';
import { Icon } from '../../components/ui';
import { DEFAULT_SETTINGS } from '../../lib/domain';
import { clock, ms, shortDate } from '../../lib/format';
import { parseScheduleLines } from '../../lib/schedule';
import type { EventConfig, Member, Settings } from '../../lib/types';

type Field = { key: keyof Settings; title: string; desc: string; unit: string };
const GROUPS: { title: string; note: string; fields: Field[] }[] = [
  { title: 'Suitable for competition', note: 'All must pass; then the best by capacity are competition batteries', fields: [
    { key: 'compMinAh', title: 'Minimum capacity', desc: 'Amp-hours reported by the CBA.', unit: 'Ah' },
    { key: 'compMaxRint', title: 'Maximum R_int', desc: 'Pre-test internal resistance recorded with the CBA test.', unit: 'mΩ' },
    { key: 'compMinMca', title: 'Minimum cranking amps', desc: 'Reported by the MCA tester.', unit: 'MCA' },
    { key: 'compCbaMonths', title: 'CBA test recency', desc: 'A competition battery is due for a CBA after this long.', unit: 'months' },
    { key: 'compMcaMonths', title: 'MCA test recency', desc: 'A competition battery is due for an MCA after this long.', unit: 'months' },
    { key: 'compCount', title: 'Competition batteries', desc: 'How many top-ranked batteries count as competition batteries.', unit: 'batteries' },
  ] },
  { title: 'Suitable for practice and prototype', note: 'Batteries that miss competition but pass these', fields: [
    { key: 'pracMinAh', title: 'Minimum capacity', desc: 'Amp-hours reported by the CBA.', unit: 'Ah' },
    { key: 'pracMaxRint', title: 'Maximum R_int', desc: 'Pre-test internal resistance recorded with the CBA test.', unit: 'mΩ' },
    { key: 'pracMinMca', title: 'Minimum cranking amps', desc: 'Reported by the MCA tester.', unit: 'MCA' },
    { key: 'pracCbaMonths', title: 'CBA test recency', desc: 'A practice battery is due for a CBA after this long.', unit: 'months' },
    { key: 'pracMcaMonths', title: 'MCA test recency', desc: 'A practice battery is due for an MCA after this long.', unit: 'months' },
  ] },
  { title: 'Battery Beak pit check', note: 'A recent Beak reading can still pull a battery for the day', fields: [
    { key: 'irMax', title: 'Beak IR limit', desc: 'At or above this, the battery is pulled from the day’s rotation.', unit: 'mΩ' },
    { key: 'irWatch', title: 'Beak IR watch zone', desc: 'Between this and the limit, keep it out of elims.', unit: 'mΩ' },
    { key: 'socTarget', title: 'Charge target', desc: 'What a full battery reads on the Beak straight off the charger.', unit: '%' },
    { key: 'socMin', title: 'Minimum charge to test', desc: 'Below this, Beak readings aren’t trustworthy. Recharge and retest.', unit: '%' },
    { key: 'v0Watch', title: 'Open-load voltage, watch', desc: 'Fresh off the charger, a healthy battery reads at least this.', unit: 'V' },
    { key: 'v0Min', title: 'Open-load voltage, pull', desc: 'Below this, the battery is undercharged or losing capacity.', unit: 'V' },
  ] },
  { title: 'Rotation and events', note: 'Drives the countdowns and the match planner', fields: [
    { key: 'chargeMin', title: 'Typical full charge', desc: 'Drives every charging countdown. Time one real charge.', unit: 'min' },
    { key: 'queueLeadMin', title: 'Queue lead time', desc: 'At events, the robot must be in queue this long before its match.', unit: 'min' },
    { key: 'projectWeeks', title: 'Early warning', desc: 'Flag a competition battery whose capacity trend drops below the minimum within this many weeks.', unit: 'weeks' },
  ] },
];
const FIELDS = GROUPS.flatMap((g) => g.fields);

type Tab = 'thresholds' | 'event' | 'members' | 'import';

export function SettingsPage() {
  const { mode, data } = useStore();
  const [params, setParams] = useSearchParams();
  const tabs: { id: Tab; label: string }[] = [
    { id: 'thresholds', label: 'Thresholds' },
    { id: 'event', label: 'Event & schedule' },
    ...(mode === 'cloud' ? [{ id: 'members' as Tab, label: 'Members' }] : []),
    { id: 'import', label: 'Import & backup' },
  ];
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'thresholds';
  const u = data.settingsUpdated;
  return (
    <section className="view">
      <div className="page-h"><div><h1>Settings</h1>
        <p>Thresholds last updated {u ? <b>{new Date(u.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{u.by ? ` by ${u.by}` : ''}</b> : '—'}</p></div></div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''}
            onClick={() => setParams(t.id === 'thresholds' ? {} : { tab: t.id }, { replace: true })}>{t.label}</button>
        ))}
      </div>
      {tab === 'thresholds' && <Thresholds />}
      {tab === 'event' && <EventSettings />}
      {tab === 'members' && <Members />}
      {tab === 'import' && <Imports />}
    </section>
  );
}

function Thresholds() {
  const { data, isAdmin, act, toast } = useStore();
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(data.settings[f.key])])));
  }, [data.settings]);
  const save = async () => {
    const next = { ...data.settings } as Record<string, number>;
    for (const f of FIELDS) {
      const n = parseFloat(form[f.key]);
      if (Number.isNaN(n)) return toast(`${f.title} needs a number`);
      next[f.key] = n;
    }
    if (next.irWatch >= next.irMax) return toast('The Beak watch zone has to start below the limit');
    if (next.pracMinAh > next.compMinAh) return toast('The practice capacity minimum can’t be above the competition one');
    await act.saveSettings(next as unknown as Settings);
    toast('Thresholds saved');
  };
  return (
    <>
      {GROUPS.map((g) => (
        <section className="panel" key={g.title}>
          <div className="ph"><h2>{g.title}</h2><span className="note">{isAdmin ? g.note : 'Only admins can change these'}</span></div>
          {g.fields.map((f) => (
            <div className="set-row" key={f.key}>
              <div><div className="st">{f.title}</div><div className="sd">{f.desc} <span className="mute">Default {DEFAULT_SETTINGS[f.key]}.</span></div></div>
              <label className="inp" style={{ padding: '6px 10px' }}>
                <input style={{ fontSize: 18 }} inputMode="decimal" disabled={!isAdmin} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                <span className="u">{f.unit}</span>
              </label>
            </div>
          ))}
        </section>
      ))}
      {isAdmin && <div className="row-acts" style={{ marginBottom: 20 }}>
        <button className="btn primary" onClick={save}>Save thresholds</button>
        <button className="btn" onClick={() => setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(DEFAULT_SETTINGS[f.key])])))}>Reset to defaults</button>
      </div>}
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function EventSettings() {
  const { data, act, toast, now } = useStore();
  const [ev, setEv] = useState<EventConfig>(data.event);
  const [paste, setPaste] = useState('');
  const [tbaEvent, setTbaEvent] = useState('');
  const [tbaKey, setTbaKey] = useState(() => { try { return localStorage.getItem(TBA_KEY) ?? ''; } catch { return ''; } });
  const [team, setTeam] = useState(() => { try { return localStorage.getItem(TEAM_KEY) ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  useEffect(() => setEv(data.event), [data.event]);
  const dirty = JSON.stringify(ev) !== JSON.stringify(data.event);
  const sorted = [...ev.matches].sort((a, b) => ms(a.time) - ms(b.time));
  const save = async (next = ev) => { await act.saveEvent(next); toast('Event saved'); };

  const fromTba = async () => {
    setBusy(true);
    try {
      try { localStorage.setItem(TBA_KEY, tbaKey); localStorage.setItem(TEAM_KEY, team); } catch { /* ignore */ }
      const key = tbaEvent.trim().toLowerCase();
      const r = await fetch(`https://www.thebluealliance.com/api/v3/team/frc${team.trim()}/event/${key}/matches/simple`, { headers: { 'X-TBA-Auth-Key': tbaKey.trim() } });
      if (!r.ok) throw new Error(r.status === 401 ? 'TBA rejected the API key' : `TBA returned ${r.status}`);
      const list = (await r.json()) as { key: string; comp_level: string; set_number: number; match_number: number; time: number | null; predicted_time: number | null }[];
      const lvl: Record<string, string> = { qm: 'Q', ef: 'EF', qf: 'QF', sf: 'SF', f: 'F' };
      const matches = list.filter((m) => m.predicted_time || m.time).map((m) => ({
        key: m.key.split('_')[1] ?? m.key,
        label: m.comp_level === 'qm' ? `Q${m.match_number}` : m.comp_level === 'f' ? `F${m.match_number}` : `${lvl[m.comp_level] ?? m.comp_level.toUpperCase()}${m.set_number}${m.comp_level === 'sf' ? '' : '-' + m.match_number}`,
        time: new Date(((m.predicted_time ?? m.time) as number) * 1000).toISOString(),
      }));
      if (!matches.length) throw new Error(`No scheduled matches for team ${team.trim()} at that event yet`);
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
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="in" style={{ width: 110 }} inputMode="numeric" value={team} placeholder="Team #" onChange={(e) => setTeam(e.target.value.replace(/\D/g, ''))} />
              <input className="in" value={tbaEvent} placeholder="Event key, e.g. 2027casj" onChange={(e) => setTbaEvent(e.target.value)} />
            </div>
            <input className="in" type="password" value={tbaKey} placeholder="TBA read API key" onChange={(e) => setTbaKey(e.target.value)} />
            <button className="btn sm" style={{ justifySelf: 'start' }} disabled={busy || !tbaEvent || !tbaKey || !team} onClick={fromTba}>Load our matches</button>
            <span className="mute" style={{ fontSize: 11.5 }}>Team number and read key (from thebluealliance.com/account) stay on this device.</span>
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
