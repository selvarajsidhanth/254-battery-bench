/* Demo-mode backend: everything lives in this browser's localStorage. */
import { COLS, clean, type Backend, type Col, type Doc, type Op } from './backend';
import { generateSeed } from './seed';

const KEY = (c: Col) => `bb2:${c}`;
/** bump when the sample data's shape changes so old demo data is replaced */
const SEED_VERSION = '3';

function read(c: Col): Record<string, Doc> {
  try {
    const raw = localStorage.getItem(KEY(c));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function save(c: Col, v: Record<string, Doc>) {
  try {
    localStorage.setItem(KEY(c), JSON.stringify(v));
  } catch (e) {
    console.error('localStorage write failed', e);
  }
}

export function resetDemo() {
  const seed = generateSeed();
  for (const c of COLS) save(c, seed[c] ?? {});
  try { localStorage.setItem('bb2:seeded', SEED_VERSION); } catch { /* private mode */ }
}

export function createLocalBackend(): Backend {
  let seeded = false;
  try { seeded = localStorage.getItem('bb2:seeded') === SEED_VERSION; } catch { /* ignore */ }
  if (!seeded) resetDemo();

  const listeners = new Set<(col: Col, docs: Record<string, Doc>) => void>();
  const emit = (c: Col) => listeners.forEach((l) => l(c, read(c)));

  return {
    mode: 'local',
    subscribe(cb) {
      listeners.add(cb);
      COLS.forEach((c) => cb(c, read(c)));
      const onStorage = (e: StorageEvent) => {
        const c = COLS.find((x) => e.key === KEY(x));
        if (c) cb(c, read(c));
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
    async write(ops: Op[]) {
      const touched = new Map<Col, Record<string, Doc>>();
      for (const op of ops) {
        const docs = touched.get(op.col) ?? read(op.col);
        if (op.kind === 'delete') delete docs[op.id];
        else if (op.kind === 'set') docs[op.id] = clean(op.data);
        else docs[op.id] = { ...(docs[op.id] ?? {}), ...clean(op.data) };
        touched.set(op.col, docs);
      }
      touched.forEach((docs, c) => save(c, docs));
      touched.forEach((_, c) => emit(c));
    },
  };
}

/** Throwaway backend for the pit rehearsal: starts from the given docs, lives in memory, gone on reload. */
export function createMemoryBackend(start: Partial<Record<Col, Record<string, Doc>>>): Backend {
  const db = Object.fromEntries(COLS.map((c) => [c, { ...(start[c] ?? {}) }])) as Record<Col, Record<string, Doc>>;
  const listeners = new Set<(col: Col, docs: Record<string, Doc>) => void>();
  return {
    mode: 'local',
    subscribe(cb) {
      listeners.add(cb);
      COLS.forEach((c) => cb(c, { ...db[c] }));
      return () => { listeners.delete(cb); };
    },
    async write(ops: Op[]) {
      const touched = new Set<Col>();
      for (const op of ops) {
        const docs = db[op.col];
        if (op.kind === 'delete') delete docs[op.id];
        else if (op.kind === 'set') docs[op.id] = clean(op.data);
        else docs[op.id] = { ...(docs[op.id] ?? {}), ...clean(op.data) };
        touched.add(op.col);
      }
      touched.forEach((c) => listeners.forEach((l) => l(c, { ...db[c] })));
    },
  };
}
