import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { TrendWithNew } from '../../components/charts';
import { Icon, Mk, STATE_META } from '../../components/ui';
import { checkReading, chargeStatus, latestValue, mcaDue } from '../../lib/domain';
import { minutesSince } from '../../lib/format';
import type { Inspection, Temp } from '../../lib/types';

const INSPECT: [keyof Inspection, string][] = [
  ['leads', 'Leads and insulation intact'],
  ['crimps', 'Crimps tight, no movement'],
  ['case', 'Case not cracked or swollen'],
  ['anderson', 'Anderson SB-50 clean, pin seats'],
];
const num = (s: string) => (s.trim() === '' || Number.isNaN(parseFloat(s)) ? null : parseFloat(s));
const lastTesterKey = 'bb2:tester';

export function LogTest() {
  const { active, testsBy, data, now, session, mode, act, toast, battery } = useStore();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const id = params.get('b') ?? '';
  const b = battery(id);
  const s = data.settings;

  const [vals, setVals] = useState({ soc: '', ir: '', v0: '', mca: '' });
  const [temp, setTemp] = useState<Temp>('room');
  const [offOverride, setOffOverride] = useState<string | null>(null);
  const [insp, setInsp] = useState<Inspection>({ leads: false, crimps: false, case: false, anderson: false });
  const [by, setBy] = useState(() => {
    if (mode === 'cloud') return session.name;
    try { return localStorage.getItem(lastTesterKey) || ''; } catch { return ''; }
  });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const tests = testsBy[id] ?? [];
  const due = mcaDue(tests, s);
  const reading = { soc: num(vals.soc), ir: num(vals.ir), v0: num(vals.v0), mca: num(vals.mca), inspection: insp };
  const verdict = checkReading(reading, s);
  const any = reading.soc != null || reading.ir != null || reading.v0 != null || reading.mca != null;
  const lowSoc = reading.soc != null && reading.soc < s.socMin;

  const autoOff = useMemo(() => {
    if (!b) return null;
    if (b.state === 'charging') return { min: 0, text: <>On the charger now ({Math.round(chargeStatus(b, s, now).soc)}% estimated). Pull it and test right away.</> };
    if (b.state === 'ready') { const m = Math.round(minutesSince(b.stateSince, now)); return { min: m, text: <>Came off the charger <b>{m} min ago</b>{m > 30 ? '. Surface charge has faded, so expect lower numbers.' : ', fresh enough to test.'}</> }; }
    return { min: null, text: <>It's {STATE_META[b.state].label.toLowerCase()}, not freshly charged. Readings will run low.</> };
  }, [b, s, now]);
  const offMin = offOverride != null ? num(offOverride) : autoOff?.min ?? null;

  const cmp = (key: 'soc' | 'ir' | 'v0' | 'mca', d: number) => {
    const v = reading[key];
    const last = latestValue(tests, key);
    if (v == null || !last) return '';
    const diff = v - last.v;
    return `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(d)} vs last${key === 'mca' ? ' check' : ''}`;
  };

  const save = async (after: 'ready' | 'keep' | 'pull') => {
    if (!b) return toast('Pick a battery first');
    if (!any) return toast('Enter at least one reading');
    setBusy(true);
    try {
      if (mode === 'local' && by) { try { localStorage.setItem(lastTesterKey, by); } catch { /* ignore */ } }
      const pullWhy = verdict.checks.filter((c) => c.level === 'pull').map((c) => `${c.label} ${c.value}`).join(', ');
      await act.logTest({ batteryId: b.id, ...reading, temp, offChargerMin: offMin, inspection: insp, by: by.trim() || session.name, notes: notes.trim() },
        after, pullWhy ? `Failed test: ${pullWhy}.` : undefined);
      toast(after === 'ready' ? `Logged. ${b.label} marked ready.` : after === 'pull' ? `Logged. ${b.label} pulled and flagged.` : 'Test logged.');
      nav(`/b/${b.id}`);
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  const word = !any ? '—' : verdict.level === 'ok' ? 'Ready' : verdict.level === 'watch' ? 'Watch' : 'Pull';
  const sub = !b ? 'Pick a battery to start.'
    : !any ? 'Enter the Beak readings. The verdict updates as you type.'
    : verdict.level === 'pull' ? 'Don’t field this battery. Logging moves it to resting and sends a retirement request to the admins.'
    : lowSoc ? `Charge is under ${s.socMin}%, so these numbers aren't trustworthy. Put it back on the charger and retest.`
    : verdict.level === 'watch' ? 'Usable, but something is in the watch zone. Fine for practice; keep it out of elims.'
    : 'Every reading passes. Good for matches.';

  return (
    <section className="view">
      <div className="log">
        <section className="panel">
          <div className="ph"><h2>Log a test</h2><span className="note">Beak it right off the charger, then the AutoMeter if it's due</span></div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">A</span><h3>Battery</h3><span className="hint">Batteries on a charger are listed first</span></div>
            <div className="bchips">
              {[...active].sort((x, y) => (x.state === 'charging' ? 0 : 1) - (y.state === 'charging' ? 0 : 1) || x.label.localeCompare(y.label, undefined, { numeric: true })).map((x) => (
                <button key={x.id} className={`bchip${x.id === id ? ' sel' : ''}${x.state === 'robot' ? ' dim' : ''}`}
                  onClick={() => { setParams({ b: x.id }, { replace: true }); setOffOverride(null); }}>
                  <b>{x.label}</b><span>{STATE_META[x.state].label}{x.state === 'charging' ? ` ${Math.round(chargeStatus(x, s, now).soc)}%` : ''}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">B</span><h3>Conditions</h3><span className="hint">Cold packs read high IR. Let them warm up and retest.</span></div>
            <div className="cond">
              <div className="auto"><Icon name="clock" />
                {autoOff ? <span>{autoOff.text}</span> : <span className="mute">Pick a battery.</span>}
                <span style={{ flex: 1 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>Min off charger
                  <input className="in" style={{ width: 64, padding: '4px 8px' }} inputMode="numeric" value={offOverride ?? (autoOff?.min ?? '')} onChange={(e) => setOffOverride(e.target.value)} /></label>
              </div>
              <div className="seg">
                {(['room', 'cold', 'warm'] as Temp[]).map((t) => <button key={t} className={temp === t ? 'on' : ''} onClick={() => setTemp(t)}>{t === 'room' ? 'Room temp' : t[0].toUpperCase() + t.slice(1)}</button>)}
              </div>
            </div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">C</span><h3>Readings</h3></div>
            <div className="fields">
              <Field label="State of charge" unit="%" src="Battery Beak" value={vals.soc} onChange={(v) => setVals({ ...vals, soc: v })} cmp={cmp('soc', 0)} placeholder={String(s.socTarget)} />
              <Field label="Internal resistance" unit="mΩ" src="Battery Beak" value={vals.ir} onChange={(v) => setVals({ ...vals, ir: v })} cmp={cmp('ir', 1)} placeholder="9.5" />
              <Field label="Open-load voltage" unit="V" src="Battery Beak" value={vals.v0} onChange={(v) => setVals({ ...vals, v0: v })} cmp={cmp('v0', 2)} placeholder="13.20" />
              <Field label="Cranking amps" unit="MCA" src={`AutoMeter · every ${s.mcaEvery === 1 ? '' : s.mcaEvery + ' '}test${s.mcaEvery === 1 ? '' : 's'}`} value={vals.mca} onChange={(v) => setVals({ ...vals, mca: v })} cmp={cmp('mca', 0)} placeholder={due.due ? 'due' : 'optional'}
                tag={b ? (due.due ? <span className="inv-tag">Due</span> : <span className="out-tag">Optional</span>) : null} />
            </div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">D</span><h3>Inspection</h3><span className="hint">Carry it by the case, never the leads</span></div>
            <div className="checks">
              {INSPECT.map(([k, l]) => (
                <button key={k} className="ck" onClick={() => setInsp({ ...insp, [k]: !insp[k] })}>
                  <span className={`box${insp[k] ? ' on' : ''}`}>{insp[k] && <Icon name="tick" />}</span>{l}
                </button>
              ))}
            </div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">E</span><h3>Sign-off</h3></div>
            <div className="row2">
              <label className="lab"><span className="k-lab">Tested by</span>
                <input className="in" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" disabled={mode === 'cloud'} /></label>
              <label className="lab"><span className="k-lab">Notes</span>
                <textarea className="txt" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything odd? Case scuff, slow charge, felt weak last run…" /></label>
            </div>
          </div>
        </section>

        <aside className="panel verdict">
          <div className="v-top">
            <div className="k-lab">Verdict{b ? ` · ${b.label}` : ''}</div>
            <div className="v-word">{any && <Mk level={verdict.level} lg />}<b>{word}</b></div>
            <div className="v-sub">{sub}</div>
          </div>
          {verdict.checks.map((c) => (
            <div className="vrow" key={c.key}><Mk level={c.level} /><div><div className="nm">{c.label}</div><div className="th">{c.rule}</div></div><div className="vv">{c.value}</div></div>
          ))}
          <div className="v-trend">
            <div className="k-lab" style={{ marginBottom: 8 }}>IR with this test</div>
            <TrendWithNew values={tests.filter((t) => t.ir != null).slice(-7).map((t) => t.ir as number)} next={reading.ir} limit={s.irMax} />
          </div>
          <div className="v-acts">
            {verdict.level === 'pull' && any ? <>
              <button className="btn primary block" disabled={busy || !b} onClick={() => save('pull')}>Log test &amp; pull from rotation</button>
              <button className="btn block" disabled={busy || !b} onClick={() => save('keep')}>Log test only</button>
            </> : lowSoc ? <>
              <button className="btn primary block" disabled={busy || !b} onClick={() => save('keep')}>Log test &amp; keep charging</button>
              <button className="btn block" disabled={busy || !b} onClick={() => save('ready')}>Log &amp; mark ready anyway</button>
            </> : <>
              <button className="btn primary block" disabled={busy || !b || !any} onClick={() => save('ready')}>Log test &amp; mark ready</button>
              <button className="btn block" disabled={busy || !b || !any} onClick={() => save('keep')}>Log test only</button>
            </>}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Field({ label, unit, src, value, onChange, cmp, placeholder, tag }: {
  label: string; unit: string; src: string; value: string; onChange: (v: string) => void; cmp: string; placeholder?: string; tag?: React.ReactNode;
}) {
  return (
    <div className="field">
      <div className="fl"><span className="k-lab">{label}</span>{tag}</div>
      <label className="inp"><input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /><span>{unit}</span></label>
      <div className="src">{src}</div>
      <div className="cmp">{cmp}</div>
    </div>
  );
}
