/* App-wide state: live data from the backend, derived health, and every
   write the UI can make. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COLS, type Backend, type Col, type Doc, type Op } from './backend';
import {
  DEFAULT_EVENT, toBattery, toEvent, toEventConfig, toFlag, toMember, toRun, toSettings, toTest,
} from './normalize';
import { SYSCHECK, SYSCHECK_LEFT, assessFleet, sortByTime, type Assessment } from '../lib/domain';
import type { ParsedSheet } from '../lib/teamSheets';
import type {
  AppData, Battery, EventConfig, Flag, Inspection, MatchRun, MatchVideo, Member, RotationState, Role, Settings, TestKind, TestRecord,
} from '../lib/types';
import { byLabel, ms, slugify, uid } from '../lib/format';
import type { ParsedRunRow, ParsedTestRow } from '../lib/csv';
import type { MatchReport } from '../lib/matchReport';
import { resetDemo as resetLocalDemo } from './local';

export interface Session { name: string; email?: string; role: Role }

export interface NewTest {
  batteryId: string;
  kind: TestKind;
  soc?: number | null;
  ir?: number | null;
  v0?: number | null;
  mca?: number | null;
  ah?: number | null;
  wh?: number | null;
  rintPre?: number | null;
  rintPost?: number | null;
  inspection?: Inspection | null;
  by: string;
  notes: string;
}

interface StoreValue {
  mode: 'cloud' | 'local';
  ready: boolean;
  error: string | null;
  data: AppData;
  session: Session;
  isAdmin: boolean;
  now: number;
  testsBy: Record<string, TestRecord[]>;
  runsBy: Record<string, MatchRun[]>;
  health: Record<string, Assessment>;
  active: Battery[];
  battery: (id: string | undefined) => Battery | undefined;
  toast: (msg: string) => void;
  toastMsg: { id: number; msg: string } | null;
  act: ReturnType<typeof makeActions>;
  /** every document exactly as stored, for exact backups */
  snapshot: Record<Col, Record<string, Doc>>;
}

const Ctx = createContext<StoreValue | null>(null);
export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside provider');
  return v;
};

const EMPTY: Record<Col, Record<string, Doc>> = { batteries: {}, tests: {}, events: {}, flags: {}, runs: {}, members: {}, config: {} };

export function StoreProvider({ backend, session, children }: { backend: Backend; session: Session; children: ReactNode }) {
  const [raw, setRaw] = useState(EMPTY);
  const [loaded, setLoaded] = useState<Set<Col>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toastMsg, setToast] = useState<{ id: number; msg: string } | null>(null);

  useEffect(() => {
    const unsub = backend.subscribe(
      (col, docs) => {
        setRaw((r) => ({ ...r, [col]: docs }));
        setLoaded((l) => (l.has(col) ? l : new Set(l).add(col)));
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
    return unsub;
  }, [backend]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const toastTimer = useRef<number>();
  const toast = useCallback((msg: string) => {
    setToast({ id: Date.now(), msg });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const data: AppData = useMemo(() => ({
    batteries: Object.entries(raw.batteries).map(([id, d]) => toBattery(id, d)).sort(byLabel),
    tests: sortByTime(Object.entries(raw.tests).map(([id, d]) => toTest(id, d))),
    events: sortByTime(Object.entries(raw.events).map(([id, d]) => toEvent(id, d))),
    flags: sortByTime(Object.entries(raw.flags).map(([id, d]) => toFlag(id, d))).reverse(),
    runs: sortByTime(Object.entries(raw.runs).map(([id, d]) => toRun(id, d))).reverse(),
    members: Object.entries(raw.members).map(([id, d]) => toMember(id, d)).sort((a, b) => a.name.localeCompare(b.name)),
    settings: toSettings(raw.config.settings),
    settingsUpdated: typeof raw.config.settings?.updatedAt === 'string'
      ? { at: raw.config.settings.updatedAt as string, by: raw.config.settings.updatedBy as string | undefined }
      : null,
    event: raw.config.event ? toEventConfig(raw.config.event) : DEFAULT_EVENT,
  }), [raw]);

  const testsBy = useMemo(() => {
    const m: Record<string, TestRecord[]> = {};
    data.batteries.forEach((b) => (m[b.id] = []));
    data.tests.forEach((t) => (m[t.batteryId] ??= []).push(t));
    return m;
  }, [data]);
  const runsBy = useMemo(() => {
    const m: Record<string, MatchRun[]> = {};
    data.runs.forEach((r) => (m[r.batteryId] ??= []).push(r));
    return m;
  }, [data]);
  const health: Record<string, Assessment> = useMemo(
    () => assessFleet(data.batteries, testsBy, data.settings, now),
    [data, testsBy, now],
  );

  const act = useMemo(() => makeActions(backend, data, session, raw), [backend, data, session, raw]);

  const value: StoreValue = {
    mode: backend.mode,
    ready: loaded.size >= 7,
    error,
    data,
    session,
    isAdmin: session.role === 'admin',
    now,
    testsBy,
    runsBy,
    health,
    active: data.batteries.filter((b) => !b.retired),
    battery: (id) => data.batteries.find((b) => b.id === id),
    toast,
    toastMsg,
    act,
    snapshot: raw,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ writes */
function makeActions(backend: Backend, data: AppData, session: Session, raw: Record<Col, Record<string, Doc>>) {
  const nowIso = () => new Date().toISOString();
  const w = (ops: Op[]) => backend.write(ops);
  const find = (id: string) => data.batteries.find((b) => b.id === id);

  function moveOps(b: Battery, to: RotationState, match: string | null = null): Op[] {
    const at = nowIso();
    const patch: Doc = { state: to, stateSince: at };
    if (to === 'charging') {
      // after a systems check the pack is nearly full, so its charge countdown starts high
      patch.chargeCheck = b.state === 'robot' && b.robotFor === SYSCHECK
        ? { soc: Math.round(data.settings.socTarget * SYSCHECK_LEFT), at } : null;
    }
    patch.robotFor = to === 'robot' ? match : null;
    if (b.state === 'robot' && to !== 'robot') patch.cycles = (b.cycles || 0) + 1;
    return [
      { kind: 'update', col: 'batteries', id: b.id, data: patch },
      { kind: 'set', col: 'events', id: uid(), data: { batteryId: b.id, at, from: b.state, to, by: session.name, match, prevSince: b.stateSince } },
    ];
  }

  return {
    async addBattery(input: { label: string; manufacturer?: string; lotCode?: string; location?: string; inService?: string; state: RotationState }) {
      const label = input.label.trim().toUpperCase();
      const id = slugify(label);
      if (!id) throw new Error('Give it a label');
      if (find(id)) throw new Error(`${label} already exists`);
      const at = nowIso();
      await w([{ kind: 'set', col: 'batteries', id, data: {
        label, manufacturer: input.manufacturer || null, lotCode: input.lotCode || null, location: input.location || null, quarantined: false,
        inService: input.inService || null, retired: false, retiredReason: null, retiredAt: null,
        state: input.state, stateSince: at, chargeCheck: null, cycles: 0, createdAt: at,
      } }]);
      return id;
    },

    updateBattery: (id: string, patch: Partial<Pick<Battery, 'label' | 'model' | 'manufacturer' | 'lotCode' | 'location' | 'quarantined' | 'quarantineFor' | 'inService' | 'notes' | 'cycles'>>) =>
      w([{ kind: 'update', col: 'batteries', id, data: patch as Doc }]),

    move: (b: Battery, to: RotationState, match: string | null = null) => w(moveOps(b, to, match)),

    /** Undo an accidental "it's in the robot": the battery goes back to where it was (with its old timing),
        and a battery that was pulled out to make room goes back in. Logged as reversing events. */
    async undoInstall(b: Battery) {
      const evs = data.events;
      const undone = new Set(evs.map((e) => e.undoOf).filter(Boolean));
      const last = <T,>(xs: T[], f: (x: T) => boolean) => [...xs].reverse().find(f);
      const put = last(evs, (e) => e.batteryId === b.id && e.to === 'robot' && !e.undoOf && !undone.has(e.id));
      if (!put || b.state !== 'robot') throw new Error('Nothing to undo');
      const back = put.from && put.from !== 'robot' ? put.from : 'ready';
      const before = last(evs, (e) => e.batteryId === b.id && ms(e.at) < ms(put.at));
      const at = nowIso();
      const ops: Op[] = [
        { kind: 'update', col: 'batteries', id: b.id, data: { state: back, stateSince: put.prevSince ?? before?.at ?? put.at, robotFor: null } },
        { kind: 'set', col: 'events', id: uid(), data: { batteryId: b.id, at, from: 'robot', to: back, by: session.name, match: put.match ?? null, undoOf: put.id } },
      ];
      const bumped = last(evs, (e) => e.batteryId !== b.id && e.from === 'robot' && e.to === 'charging' && !e.undoOf && !undone.has(e.id) && Math.abs(ms(put.at) - ms(e.at)) < 60_000);
      const other = bumped && find(bumped.batteryId);
      if (bumped && other && other.state === 'charging') {
        const wentIn = last(evs, (e) => e.batteryId === other.id && e.to === 'robot' && ms(e.at) < ms(bumped.at));
        ops.push(
          { kind: 'update', col: 'batteries', id: other.id, data: { state: 'robot', stateSince: bumped.prevSince ?? wentIn?.at ?? bumped.at, robotFor: wentIn?.match ?? other.robotFor ?? null, chargeCheck: null, cycles: Math.max(0, (other.cycles || 1) - 1) } },
          { kind: 'set', col: 'events', id: uid(), data: { batteryId: other.id, at, from: 'charging', to: 'robot', by: session.name, match: wentIn?.match ?? null, undoOf: bumped.id } },
        );
      }
      await w(ops);
      return { back, restored: bumped && other && other.state === 'charging' ? other : null };
    },

    async checkCharge(b: Battery, soc: number) {
      if (soc >= data.settings.socTarget) return w(moveOps(b, 'ready'));
      return w([{ kind: 'update', col: 'batteries', id: b.id, data: { chargeCheck: { soc, at: nowIso() } } }]);
    },

    /** after: ready = mark ready, charge = put on a charger (a CBA drains the pack), pull = shelve it + flag for retirement */
    async logTest(t: NewTest, after: 'ready' | 'keep' | 'pull' | 'charge', pullReason?: string) {
      const b = find(t.batteryId);
      if (!b) throw new Error('Unknown battery');
      const ops: Op[] = [{ kind: 'set', col: 'tests', id: uid(), data: { ...t, at: nowIso(), source: 'app' } }];
      if (after === 'ready' && b.state !== 'ready') ops.push(...moveOps(b, 'ready'));
      if (after === 'charge' && b.state !== 'charging') ops.push(...moveOps(b, 'charging'));
      if (after === 'pull') {
        if (b.state !== 'shelf') ops.push(...moveOps(b, 'shelf'));
        if (!data.flags.some((f) => f.batteryId === b.id && f.status === 'pending')) {
          ops.push({ kind: 'set', col: 'flags', id: uid(), data: {
            batteryId: b.id, at: nowIso(), by: t.by || session.name, status: 'pending', reason: pullReason || 'Failed a test.',
          } });
        }
      }
      return w(ops);
    },

    deleteTest: (id: string) => w([{ kind: 'delete', col: 'tests', id }]),

    flag: (b: Battery, reason: string) =>
      w([{ kind: 'set', col: 'flags', id: uid(), data: { batteryId: b.id, at: nowIso(), by: session.name, reason, status: 'pending' } }]),

    async resolveFlag(f: Flag, approve: boolean) {
      const ops: Op[] = [{ kind: 'update', col: 'flags', id: f.id, data: { status: approve ? 'approved' : 'dismissed', resolvedBy: session.name, resolvedAt: nowIso() } }];
      if (approve) ops.push({ kind: 'update', col: 'batteries', id: f.batteryId, data: { retired: true, retiredReason: f.reason, retiredAt: nowIso() } });
      return w(ops);
    },

    async retire(b: Battery, reason: string) {
      const ops: Op[] = [{ kind: 'update', col: 'batteries', id: b.id, data: { retired: true, retiredReason: reason || 'Retired', retiredAt: nowIso() } }];
      data.flags.filter((f) => f.batteryId === b.id && f.status === 'pending').forEach((f) =>
        ops.push({ kind: 'update', col: 'flags', id: f.id, data: { status: 'approved', resolvedBy: session.name, resolvedAt: nowIso() } }));
      return w(ops);
    },
    unretire: (b: Battery) =>
      w([{ kind: 'update', col: 'batteries', id: b.id, data: { retired: false, retiredReason: null, retiredAt: null, state: 'charging', stateSince: nowIso(), chargeCheck: null } }]),

    saveSettings: (s: Settings) =>
      w([{ kind: 'set', col: 'config', id: 'settings', data: { ...s, updatedAt: nowIso(), updatedBy: session.name } as unknown as Doc }]),
    saveEvent: (e: EventConfig) => w([{ kind: 'set', col: 'config', id: 'event', data: e as unknown as Doc }]),

    /** Import the team's Google Sheet tabs (inventory, CBA form, MCA form, config) in one go. */
    async importTeamSheets(sheets: ParsedSheet[]) {
      const ops: Op[] = [];
      const at = nowIso();
      const byLabel = new Map(data.batteries.map((b) => [b.label.toUpperCase(), b]));
      const ensured = new Map<string, string>(); // label → id
      let created = 0, updated = 0, cba = 0, mca = 0, dupes = 0;
      const ensure = (label: string, extra: Doc = {}) => {
        const key = label.toUpperCase();
        if (ensured.has(key)) {
          if (Object.keys(extra).length) ops.push({ kind: 'update', col: 'batteries', id: ensured.get(key)!, data: extra });
          return ensured.get(key)!;
        }
        const existing = byLabel.get(key);
        if (existing) {
          ensured.set(key, existing.id);
          if (Object.keys(extra).length) { ops.push({ kind: 'update', col: 'batteries', id: existing.id, data: extra }); updated++; }
          return existing.id;
        }
        const id = slugify(label);
        ensured.set(key, id);
        created++;
        ops.push({ kind: 'set', col: 'batteries', id, data: {
          label: key, retired: false, retiredReason: null, retiredAt: null, quarantined: false,
          manufacturer: { M: 'MK', E: 'Energizer' }[key.slice(-1)] ?? null,
          state: 'shelf', stateSince: at, chargeCheck: null, cycles: 0, createdAt: at, ...extra,
        } });
        return id;
      };
      // inventory first so batteries get their details
      for (const sh of sheets) for (const r of sh.inventory ?? []) {
        ensure(r.label, {
          manufacturer: r.manufacturer ?? null, lotCode: r.lotCode ?? null, location: r.location ?? null, quarantined: r.quarantined, quarantineFor: r.quarantined ? r.quarantineFor : null,
          ...(r.retired ? { retired: true, retiredReason: 'Decommissioned (imported from the team sheet)', retiredAt: at } : {}),
        });
      }
      const seen = new Set(data.tests.map((t) => `${t.batteryId}|${t.at.slice(0, 16)}|${t.ah ?? ''}|${t.mca ?? ''}`));
      for (const sh of sheets) {
        for (const r of sh.cba ?? []) {
          const id = ensure(r.label);
          const k = `${id}|${r.at.slice(0, 16)}|${r.ah ?? ''}|`;
          if (seen.has(k)) { dupes++; continue; }
          seen.add(k); cba++;
          ops.push({ kind: 'set', col: 'tests', id: uid(), data: { batteryId: id, kind: 'cba', at: r.at, ah: r.ah, rintPre: r.rintPre, rintPost: r.rintPost, wh: r.wh, by: r.by || undefined, source: 'import' } });
        }
        for (const r of sh.mca ?? []) {
          const id = ensure(r.label);
          const k = `${id}|${r.at.slice(0, 16)}||${r.mca}`;
          if (seen.has(k)) { dupes++; continue; }
          seen.add(k); mca++;
          ops.push({ kind: 'set', col: 'tests', id: uid(), data: { batteryId: id, kind: 'mca', at: r.at, mca: r.mca, by: r.by || undefined, source: 'import' } });
        }
      }
      const config = sheets.find((x) => x.config)?.config;
      if (config && Object.keys(config).length) {
        ops.push({ kind: 'set', col: 'config', id: 'settings', data: { ...data.settings, ...config, updatedAt: at, updatedBy: session.name } as unknown as Doc });
      }
      await w(ops);
      return { created, updated, cba, mca, dupes, thresholds: !!config && Object.keys(config).length > 0 };
    },

    async importTests(rows: ParsedTestRow[], createMissing: boolean) {
      const ops: Op[] = [];
      const known = new Map(data.batteries.map((b) => [b.label.toUpperCase(), b.id]));
      let created = 0, skipped = 0, dupes = 0;
      const at = nowIso();
      // same battery + same minute + same IR = already imported
      const seen = new Set(data.tests.map((t) => `${t.batteryId}|${t.at.slice(0, 16)}|${t.ir ?? ''}`));
      for (const r of rows) {
        const existing = known.get(r.label.toUpperCase());
        if (existing && seen.has(`${existing}|${r.at.slice(0, 16)}|${r.ir ?? ''}`)) { dupes++; continue; }
        let id = known.get(r.label.toUpperCase());
        if (!id && createMissing) {
          id = slugify(r.label);
          known.set(r.label.toUpperCase(), id);
          created++;
          ops.push({ kind: 'set', col: 'batteries', id, data: {
            label: r.label, retired: false, retiredReason: null, retiredAt: null, state: 'charging', stateSince: at,
            chargeCheck: null, cycles: 0, createdAt: at,
          } });
        }
        if (!id) { skipped++; continue; }
        ops.push({ kind: 'set', col: 'tests', id: uid(), data: {
          batteryId: id, at: r.at, ir: r.ir, soc: r.soc, v0: r.v0, mca: r.mca, by: r.by || undefined, notes: r.notes || undefined, source: 'import',
        } });
      }
      await w(ops);
      return { added: rows.length - skipped - dupes, created, skipped, dupes };
    },

    async addRuns(rows: ParsedRunRow[]) {
      const known = new Map(data.batteries.map((b) => [b.label.toUpperCase(), b.id]));
      const ops: Op[] = [];
      let skipped = 0;
      for (const r of rows) {
        const id = known.get(r.label.toUpperCase());
        if (!id) { skipped++; continue; }
        ops.push({ kind: 'set', col: 'runs', id: uid(), data: {
          batteryId: id, at: r.at, event: r.event || undefined, match: r.match, minV: r.minV, peakA: r.peakA,
          energyWh: r.energyWh, brownouts: r.brownouts, source: 'csv',
        } });
      }
      await w(ops);
      return { added: ops.length, skipped };
    },
    deleteRun: (id: string) => w([{ kind: 'delete', col: 'runs', id }]),

    /** Save a robot-log report as a match run. Returns the new run id. */
    async saveMatchReport(report: MatchReport, opts: { batteryId: string; match: string; event?: string; notes?: string; video?: MatchVideo | null }) {
      const id = uid();
      const b = report.battery;
      await w([{ kind: 'set', col: 'runs', id, data: {
        batteryId: opts.batteryId, at: report.logStart ?? nowIso(), event: opts.event?.trim() || undefined, match: opts.match.trim() || report.match.label,
        minV: b.minV, peakA: b.peakA, energyWh: b.wh, brownouts: b.brownouts, restV: b.restV, endV: b.endV, ahUsed: b.ah, sysR: b.systemRmOhm,
        by: session.name, notes: opts.notes?.trim() || undefined, report, video: opts.video ?? undefined, source: 'log',
      } }]);
      return id;
    },
    updateRun: (id: string, patch: { batteryId?: string; match?: string; event?: string; notes?: string }) =>
      w([{ kind: 'update', col: 'runs', id, data: patch as Doc }]),

    /** Hide a pit warning (pass the warning text), or bring it back (null). */
    ackWarning: (b: Battery, text: string | null) =>
      w([{ kind: 'update', col: 'batteries', id: b.id, data: { warnAck: text ? { text, at: nowIso(), by: session.name } : null } }]),

    setRunVideo: (id: string, video: MatchVideo | null) => w([{ kind: 'update', col: 'runs', id, data: { video } }]),

    setMember: (m: Member) => w([{ kind: 'set', col: 'members', id: m.email.toLowerCase().trim(), data: { name: m.name, role: m.role } }]),
    removeMember: (email: string) => w([{ kind: 'delete', col: 'members', id: email }]),

    /** Put the database back to a backup. Exact = also delete anything added since (members are never deleted). */
    async restore(backup: Partial<Record<Col, Record<string, Doc>>>, exact: boolean) {
      const ops: Op[] = [];
      for (const c of COLS) {
        const want = backup[c];
        if (!want) continue;
        for (const [id, d] of Object.entries(want)) ops.push({ kind: 'set', col: c, id, data: d });
        if (exact && c !== 'members') for (const id of Object.keys(raw[c])) if (!(id in want)) ops.push({ kind: 'delete', col: c, id });
      }
      await w(ops);
      return ops.length;
    },

    resetDemo() {
      if (backend.mode !== 'local') return;
      resetLocalDemo();
      window.location.reload();
    },
  };
}
