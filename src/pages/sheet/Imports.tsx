import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { useStore } from '../../data/store';
import { Icon, download } from '../../components/ui';
import {
  RUN_FIELDS, TEST_FIELDS, guessMapping, parseRunRows, parseTestRows, toCSV, type FieldDef, type Mapping,
} from '../../lib/csv';
import { shortDate } from '../../lib/format';

interface Sheet { name: string; headers: string[]; rows: Record<string, string>[] }

function parseCSV(text: string, name: string): Sheet {
  const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  return { name, headers: res.meta.fields ?? [], rows: res.data };
}

export function Imports() {
  const { data, testsBy } = useStore();
  return (
    <section className="view">
      <div className="page-h">
        <div><h1>Import &amp; export</h1><p>Bring in the history from the team Google Sheet and match-log summaries, or take a backup.</p></div>
      </div>
      <TestImport />
      <RunImport />
      <section className="panel">
        <div className="ph"><h2>Export</h2><span className="note">For spreadsheets or a backup</span></div>
        <div className="pb row-acts">
          <button className="btn" onClick={() => download(`battery-tests-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(
            data.tests.map((t) => ({
              battery: data.batteries.find((b) => b.id === t.batteryId)?.label ?? t.batteryId, date: t.at, ir_mohm: t.ir, soc_pct: t.soc, v0: t.v0, mca: t.mca,
              temp: t.temp, off_charger_min: t.offChargerMin, by: t.by, notes: t.notes,
            }))), 'text/csv')}><Icon name="download" />All tests (CSV)</button>
          <button className="btn" onClick={() => download(`battery-bench-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json')}><Icon name="download" />Full backup (JSON)</button>
          <span className="mute" style={{ alignSelf: 'center', fontSize: 12.5 }}>{data.batteries.length} batteries · {data.tests.length} tests · {Object.values(testsBy).filter((t) => t.length).length} with history</span>
        </div>
      </section>
    </section>
  );
}

function Loader({ onLoad }: { onLoad: (s: Sheet) => void }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label className="drop">
        <input type="file" accept=".csv,text/csv" className="sr" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onLoad(parseCSV(await f.text(), f.name));
        }} />
        <Icon name="upload" className="ico" /> <b>Choose a CSV file</b> <span className="mute">or drop it here</span>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="in" placeholder="…or paste a published Google Sheet CSV link" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={!url} onClick={async () => {
          setErr('');
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            onLoad(parseCSV(await r.text(), 'Google Sheet'));
          } catch (e) {
            setErr(`Couldn't fetch that link (${e instanceof Error ? e.message : e}). Download the sheet as CSV and choose the file instead.`);
          }
        }}>Fetch</button>
      </div>
      {err && <div className="mute" style={{ fontSize: 12.5 }}>{err}</div>}
    </div>
  );
}

function MappingGrid({ sheet, fields, map, setMap }: { sheet: Sheet; fields: readonly FieldDef[]; map: Mapping; setMap: (m: Mapping) => void }) {
  return (
    <div className="map-grid">
      {fields.map((f) => (
        <label className="lab" key={f.key}><span className="k-lab">{f.label}{f.required ? ' *' : ''}</span>
          <select className="sel" value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value || null })}>
            <option value="">— not in sheet —</option>
            {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

function TestImport() {
  const { act, toast, data } = useStore();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [map, setMap] = useState<Mapping>({});
  const [create, setCreate] = useState(true);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (sheet ? parseTestRows(sheet.rows, map) : null), [sheet, map]);
  const known = new Set(data.batteries.map((b) => b.label.toUpperCase()));
  const newLabels = parsed ? [...new Set(parsed.ok.map((r) => r.label).filter((l) => !known.has(l.toUpperCase())))] : [];

  return (
    <section className="panel">
      <div className="ph"><h2>Test history from the Google Sheet</h2>
        <button className="btn sm" onClick={() => download('battery-tests-template.csv', 'Battery,Date,IR (mOhm),SoC (%),Voltage,MCA,Tested by,Notes\nB-01,9/14/2026 16:05,8.4,131,13.24,1012,E. Gu,\n', 'text/csv')}>Template</button>
      </div>
      <div className="pb" style={{ display: 'grid', gap: 16 }}>
        {!sheet ? <>
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>In Google Sheets: <b>File → Download → Comma-separated values</b>. Each row should be one test with a battery, a date, and at least one reading. Column names don't have to match; you'll map them next.</p>
          <Loader onLoad={(s) => { setSheet(s); setMap(guessMapping(s.headers, TEST_FIELDS)); }} />
        </> : <>
          <div className="row-acts" style={{ alignItems: 'center' }}><b>{sheet.name}</b><span className="mute">{sheet.rows.length} rows · {sheet.headers.length} columns</span><span style={{ flex: 1 }} /><button className="btn sm" onClick={() => setSheet(null)}>Choose another file</button></div>
          <MappingGrid sheet={sheet} fields={TEST_FIELDS} map={map} setMap={setMap} />
          {parsed && <>
            <div className="tablewrap" style={{ border: '1px solid var(--line-2)' }}>
              <table><thead><tr><th>Row</th><th>Battery</th><th>Date</th><th className="r">IR</th><th className="r">SoC</th><th className="r">V₀</th><th className="r">MCA</th><th>By</th></tr></thead>
                <tbody>{parsed.ok.slice(0, 8).map((r) => (
                  <tr key={r.row}><td className="mute">{r.row}</td><td><b>{r.label}</b>{!known.has(r.label.toUpperCase()) && <span className="out-tag" style={{ marginLeft: 6 }}>New</span>}</td><td>{shortDate(r.at)} {new Date(r.at).getFullYear()}</td>
                    <td className="r">{r.ir ?? '—'}</td><td className="r">{r.soc ?? '—'}</td><td className="r">{r.v0 ?? '—'}</td><td className="r">{r.mca ?? '—'}</td><td className="mute">{r.by || '—'}</td></tr>
                ))}</tbody></table>
            </div>
            <div className="mute" style={{ fontSize: 12.5 }}>
              {parsed.ok.length} rows ready{parsed.ok.length > 8 ? ' (first 8 shown)' : ''}.
              {parsed.errors.length > 0 && <> {parsed.errors.length} skipped: {parsed.errors.slice(0, 4).map((e) => `row ${e.row} (${e.msg})`).join(', ')}{parsed.errors.length > 4 ? '…' : ''}.</>}
            </div>
            {newLabels.length > 0 && (
              <button className="ck" onClick={() => setCreate(!create)}><span className={`box${create ? ' on' : ''}`}>{create && <Icon name="tick" />}</span>
                Create {newLabels.length} new {newLabels.length === 1 ? 'battery' : 'batteries'}: {newLabels.slice(0, 10).join(', ')}{newLabels.length > 10 ? '…' : ''}</button>
            )}
            <div><button className="btn primary" disabled={busy || !parsed.ok.length || !map.battery || !map.date} onClick={async () => {
              setBusy(true);
              try {
                const res = await act.importTests(parsed.ok, create);
                toast(`Imported ${res.added} tests${res.created ? `, created ${res.created} batteries` : ''}${res.dupes ? `, ${res.dupes} already here` : ''}${res.skipped ? `, ${res.skipped} skipped` : ''}`);
                setSheet(null);
              } catch (e) { toast(`Import failed: ${e instanceof Error ? e.message : e}`); }
              setBusy(false);
            }}><Icon name="upload" />Import {parsed.ok.length} tests</button></div>
          </>}
        </>}
      </div>
    </section>
  );
}

function RunImport() {
  const { act, toast } = useStore();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [map, setMap] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (sheet ? parseRunRows(sheet.rows, map, new Date()) : null), [sheet, map]);
  return (
    <section className="panel">
      <div className="ph"><h2>Match-log summaries</h2>
        <button className="btn sm" onClick={() => download('match-runs-template.csv', 'Battery,Event,Match,Date,Min voltage,Peak current,Energy (Wh),Brownouts\nB-04,Offseason,Q14,9/27/2026 10:40,8.3,187,3.6,0\n', 'text/csv')}>Template</button>
      </div>
      <div className="pb" style={{ display: 'grid', gap: 16 }}>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>One row per match: which battery was in, plus the minimum voltage, peak current, energy used and brownouts from the robot log (AdvantageScope can export these). Reading <code>.dslog</code> and <code>.wpilog</code> files directly is the next step once we have a sample log from the robot.</p>
        {!sheet ? <Loader onLoad={(s) => { setSheet(s); setMap(guessMapping(s.headers, RUN_FIELDS)); }} /> : <>
          <div className="row-acts" style={{ alignItems: 'center' }}><b>{sheet.name}</b><span className="mute">{sheet.rows.length} rows</span><span style={{ flex: 1 }} /><button className="btn sm" onClick={() => setSheet(null)}>Choose another file</button></div>
          <MappingGrid sheet={sheet} fields={RUN_FIELDS} map={map} setMap={setMap} />
          {parsed && <>
            <div className="mute" style={{ fontSize: 12.5 }}>{parsed.ok.length} rows ready.{parsed.errors.length > 0 && ` ${parsed.errors.length} skipped.`} Rows for batteries that don't exist yet are skipped.</div>
            <div><button className="btn primary" disabled={busy || !parsed.ok.length} onClick={async () => {
              setBusy(true);
              try {
                const res = await act.addRuns(parsed.ok);
                toast(`Imported ${res.added} matches${res.skipped ? `, ${res.skipped} skipped (unknown battery)` : ''}`);
                setSheet(null);
              } catch (e) { toast(`Import failed: ${e instanceof Error ? e.message : e}`); }
              setBusy(false);
            }}><Icon name="upload" />Import {parsed.ok.length} matches</button></div>
          </>}
        </>}
      </div>
    </section>
  );
}
