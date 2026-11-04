/* Demo-mode backend: everything lives in this browser's localStorage. */
import { COLS, clean, type Backend, type Col, type Doc, type Op } from './backend';
import { generateSeed } from './seed';

const KEY = (c: Col) => `bb2:${c}`;

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
  try { localStorage.setItem('bb2:seeded', '1'); } catch { /* private mode */ }
}

export function createLocalBackend(): Backend {
  let seeded = false;
  try { seeded = localStorage.getItem('bb2:seeded') === '1'; } catch { /* ignore */ }
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
