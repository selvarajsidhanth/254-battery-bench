import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../../data/store';
import { TrendWithNew } from '../../components/charts';
import { Icon, Mk, STATE_META } from '../../components/ui';
import { checkReading, chargeStatus, latestValue, toMilliohms, type Level } from '../../lib/domain';
import type { Inspection, TestKind } from '../../lib/types';

const INSPECT: [keyof Inspection, string][] = [
  ['leads', 'Leads and insulation intact'],
  ['crimps', 'Crimps tight, no movement'],
  ['case', 'Case not cracked or swollen'],
  ['anderson', 'Anderson SB-50 clean, pin seats'],
];
const KINDS: { k: TestKind; label: string; hint: string }[] = [
  { k: 'cba', label: 'CBA', hint: 'Capacity discharge: amp-hours, R_int before and after, watt-hours' },
  { k: 'mca', label: 'MCA', hint: 'Cranking-amps load test' },
  { k: 'beak', label: 'Beak check', hint: 'Quick pit check right off the charger' },
];
const num = (s: string) => (s.trim() === '' || Number.isNaN(parseFloat(s)) ? null : parseFloat(s));
const lastTesterKey = 'bb2:tester';
const EMPTY = { soc: '', ir: '', v0: '', mca: '', ah: '', wh: '', rintPre: '', rintPost: '' };

export function LogTest() {
  const { active, testsBy, health, data, now, session, mode, act, toast, battery } = useStore();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const id = params.get('b') ?? '';
  const kind = (params.get('t') as TestKind | null) ?? 'cba';
  const b = battery(id);
  const s = data.settings;
  const setQ = (next: { b?: string; t?: TestKind }) => setParams({ b: next.b ?? id, t: next.t ?? kind }, { replace: true });

  const [vals, setVals] = useState(EMPTY);
  const [insp, setInsp] = useState<Inspection>({ leads: false, crimps: false, case: false, anderson: false });
  const [by, setBy] = useState(() => {
    if (mode === 'cloud') return session.name;
    try { return localStorage.getItem(lastTesterKey) || ''; } catch { return ''; }
  });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const tests = testsBy[id] ?? [];
  const reading = kind === 'cba'
    ? { ah: num(vals.ah), rintPre: toMilliohms(num(vals.rintPre)), rintPost: toMilliohms(num(vals.rintPost)), wh: num(vals.wh), inspection: insp }
    : kind === 'mca' ? { mca: num(vals.mca), inspection: insp }
    : { soc: num(vals.soc), ir: num(vals.ir), v0: num(vals.v0), inspection: insp };
  const verdict = checkReading(kind, reading, s);
  const any = Object.entries(reading).some(([k, v]) => k !== 'inspection' && v != null);
  const lowSoc = kind === 'beak' && 'soc' in reading && reading.soc != null && reading.soc < s.socMin;
  const set = (k: keyof typeof EMPTY) => (v: string) => setVals({ ...vals, [k]: v });

  const cmp = (key: 'soc' | 'ir' | 'v0' | 'mca' | 'ah' | 'rintPre', d: number) => {
    const v = (reading as unknown as Record<string, number | null | undefined>)[key];
    const last = latestValue(tests, key);
    if (v == null || !last) return '';
    const diff = v - last.v;
    return `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(d)} vs last`;
  };

  const save = async (after: 'ready' | 'keep' | 'pull' | 'charge') => {
    if (!b) return toast('Pick a battery first');
    if (!any) return toast('Enter at least one reading');
    setBusy(true);
    try {
      if (mode === 'local' && by) { try { localStorage.setItem(lastTesterKey, by); } catch { /* ignore */ } }
      const pullWhy = verdict.checks.filter((c) => c.level === 'pull').map((c) => `${c.label} ${c.value}`).join(', ');
      await act.logTest({ batteryId: b.id, kind, ...reading, by: by.trim() || session.name, notes: notes.trim() },
        after, pullWhy ? `Failed ${kind.toUpperCase()} test: ${pullWhy}.` : undefined);
      toast(after === 'ready' ? `Logged. ${b.label} marked ready.` : after === 'charge' ? `Logged. ${b.label} is on a charger.` : after === 'pull' ? `Logged. ${b.label} flagged for retirement.` : 'Test logged.');
      nav(`/b/${b.id}`);
    } catch (e) {
      toast(`Couldn't save: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  const bench = kind !== 'beak';
  const WORD: Record<Level, string> = bench ? { ok: 'Competition', watch: 'Practice', pull: 'Not suitable' } : { ok: 'Ready', watch: 'Watch', pull: 'Pull' };
  const word = !any ? '—' : WORD[verdict.level];
  const sub = !b ? 'Pick a battery to start.'
    : !any ? 'Enter the readings. The verdict updates as you type.'
    : bench ? (verdict.level === 'ok' ? 'Meets the competition thresholds.' : verdict.level === 'watch' ? 'Good enough for practice and prototype, not competition.' : 'Below the practice thresholds. Retest it, or flag it for retirement.')
    : verdict.level === 'pull' ? 'Don’t field this battery today. Logging it can pull it from rotation.'
    : lowSoc ? `Charge is under ${s.socMin}%, so these numbers aren't trustworthy. Put it back on the charger and retest.`
    : verdict.level === 'watch' ? 'Usable, but something is in the watch zone. Keep it out of elims.'
    : 'Every reading passes. Good for matches.';

  const due = (x: string) => (kind === 'cba' ? health[x]?.cbaDue : kind === 'mca' ? health[x]?.mcaDue : false);
  const chips = [...active].sort((x, y) => Number(due(y.id)) - Number(due(x.id)) || x.label.localeCompare(y.label, undefined, { numeric: true }));

  const trend = kind === 'cba'
    ? { label: 'Capacity with this test', values: tests.filter((t) => t.ah != null).slice(-7).map((t) => t.ah as number), next: reading.ah ?? null, limit: s.compMinAh, digits: 2 }
    : kind === 'mca'
    ? { label: 'MCA with this test', values: tests.filter((t) => t.mca != null).slice(-7).map((t) => t.mca as number), next: reading.mca ?? null, limit: s.compMinMca, digits: 0 }
    : { label: 'Beak IR with this test', values: tests.filter((t) => t.ir != null).slice(-7).map((t) => t.ir as number), next: reading.ir ?? null, limit: s.irMax, digits: 1 };

  return (
    <section className="view">
      <div className="log">
        <section className="panel">
          <div className="ph"><h2>Log a test</h2>
            <div className="seg">{KINDS.map((x) => <button key={x.k} className={kind === x.k ? 'on' : ''} onClick={() => { setQ({ t: x.k }); setVals(EMPTY); }}>{x.label}</button>)}</div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">A</span><h3>Battery</h3><span className="hint">{bench ? `Batteries due for ${kind.toUpperCase()} are listed first` : 'Test right off the charger'}</span></div>
            <div className="bchips">
              {chips.map((x) => (
                <button key={x.id} className={`bchip${x.id === id ? ' sel' : ''}${x.state === 'robot' ? ' dim' : ''}`} onClick={() => setQ({ b: x.id })}>
                  <b>{x.label}</b>
                  <span>{due(x.id) ? 'Due' : STATE_META[x.state].label}{x.state === 'charging' ? ` ${Math.round(chargeStatus(x, s, now).soc)}%` : ''}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">B</span><h3>Readings</h3><span className="hint">{KINDS.find((x) => x.k === kind)!.hint}</span></div>
            {kind === 'cba' && (
              <div className="fields">
                <Field label="Amp-hours" unit="Ah" src="CBA" value={vals.ah} onChange={set('ah')} cmp={cmp('ah', 2)} placeholder="16.20" />
                <Field label="R_int before" unit="mΩ" src="Before the discharge (0.019 Ω works too)" value={vals.rintPre} onChange={set('rintPre')} cmp={cmp('rintPre', 0)} placeholder="18" />
                <Field label="R_int after" unit="mΩ" src="After the discharge" value={vals.rintPost} onChange={set('rintPost')} cmp="" placeholder="28" />
                <Field label="Watt-hours" unit="Wh" src="CBA" value={vals.wh} onChange={set('wh')} cmp="" placeholder="195" />
              </div>
            )}
            {kind === 'mca' && (
              <div className="fields">
                <Field label="Cranking amps" unit="MCA" src="MCA tester" value={vals.mca} onChange={set('mca')} cmp={cmp('mca', 0)} placeholder="270" />
              </div>
            )}
            {kind === 'beak' && (
              <div className="fields">
                <Field label="State of charge" unit="%" src="Battery Beak" value={vals.soc} onChange={set('soc')} cmp={cmp('soc', 0)} placeholder={String(s.socTarget)} />
                <Field label="Internal resistance" unit="mΩ" src="Battery Beak" value={vals.ir} onChange={set('ir')} cmp={cmp('ir', 1)} placeholder="9.5" />
                <Field label="Open-load voltage" unit="V" src="Battery Beak" value={vals.v0} onChange={set('v0')} cmp={cmp('v0', 2)} placeholder="13.20" />
              </div>
            )}
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">C</span><h3>Inspection</h3><span className="hint">Carry it by the case, never the leads</span></div>
            <div className="checks">
              {INSPECT.map(([k, l]) => (
                <button key={k} className="ck" onClick={() => setInsp({ ...insp, [k]: !insp[k] })}>
                  <span className={`box${insp[k] ? ' on' : ''}`}>{insp[k] && <Icon name="tick" />}</span>{l}
                </button>
              ))}
            </div>
          </div>

          <div className="fsec">
            <div className="fsec-h"><span className="n">D</span><h3>Sign-off</h3></div>
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
            <div className="k-lab">{kind === 'beak' ? 'Beak check' : kind.toUpperCase()} verdict{b ? ` · ${b.label}` : ''}</div>
            <div className="v-word">{any && <Mk level={verdict.level} lg />}<b>{word}</b></div>
            <div className="v-sub">{sub}</div>
          </div>
          {verdict.checks.map((c) => (
            <div className="vrow" key={c.key}><Mk level={c.level} /><div><div className="nm">{c.label}</div><div className="th">{c.rule}</div></div><div className="vv">{c.value}</div></div>
          ))}
          <div className="v-trend">
            <div className="k-lab" style={{ marginBottom: 8 }}>{trend.label}</div>
            <TrendWithNew values={trend.values} next={trend.next} limit={trend.limit} digits={trend.digits} />
          </div>
          <div className="v-acts">
            {kind === 'cba' ? <>
              <button className="btn primary block" disabled={busy || !b || !any} onClick={() => save('charge')}>Log CBA &amp; put on a charger</button>
              {verdict.level === 'pull' && any
                ? <button className="btn block" disabled={busy || !b} onClick={() => save('pull')}>Log &amp; flag for retirement</button>
                : <button className="btn block" disabled={busy || !b || !any} onClick={() => save('keep')}>Log CBA only</button>}
            </> : kind === 'mca' ? <>
              <button className="btn primary block" disabled={busy || !b || !any} onClick={() => save('keep')}>Log MCA</button>
              {verdict.level === 'pull' && any
                ? <button className="btn block" disabled={busy || !b} onClick={() => save('pull')}>Log &amp; flag for retirement</button>
                : <button className="btn block" disabled={busy || !b || !any} onClick={() => save('charge')}>Log MCA &amp; put on a charger</button>}
            </> : verdict.level === 'pull' && any ? <>
              <button className="btn primary block" disabled={busy || !b} onClick={() => save('pull')}>Log &amp; pull from rotation</button>
              <button className="btn block" disabled={busy || !b} onClick={() => save('keep')}>Log check only</button>
            </> : lowSoc ? <>
              <button className="btn primary block" disabled={busy || !b} onClick={() => save('charge')}>Log &amp; keep charging</button>
              <button className="btn block" disabled={busy || !b} onClick={() => save('ready')}>Log &amp; mark ready anyway</button>
            </> : <>
              <button className="btn primary block" disabled={busy || !b || !any} onClick={() => save('ready')}>Log check &amp; mark ready</button>
              <button className="btn block" disabled={busy || !b || !any} onClick={() => save('keep')}>Log check only</button>
            </>}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Field({ label, unit, src, value, onChange, cmp, placeholder }: {
  label: string; unit: string; src: string; value: string; onChange: (v: string) => void; cmp: string; placeholder?: string;
}) {
  return (
    <div className="field">
      <div className="fl"><span className="k-lab">{label}</span></div>
      <label className="inp"><input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /><span className="u">{unit}</span></label>
      <div className="src">{src}</div>
      <div className="cmp">{cmp}</div>
    </div>
  );
}
