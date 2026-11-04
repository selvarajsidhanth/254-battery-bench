/* A backend is either Firestore (shared, live) or localStorage (demo mode).
   Both speak the same tiny interface so the UI never cares which it is. */

export type Col = 'batteries' | 'tests' | 'events' | 'flags' | 'runs' | 'members' | 'config';
export const COLS: Col[] = ['batteries', 'tests', 'events', 'flags', 'runs', 'members', 'config'];

export type Doc = Record<string, unknown>;
export type Op =
  | { kind: 'set'; col: Col; id: string; data: Doc }
  | { kind: 'update'; col: Col; id: string; data: Doc }
  | { kind: 'delete'; col: Col; id: string };

export interface Backend {
  mode: 'cloud' | 'local';
  /** Calls back once per collection with the full id→doc map, then again on every change. */
  subscribe(cb: (col: Col, docs: Record<string, Doc>) => void, onError?: (e: unknown) => void): () => void;
  write(ops: Op[]): Promise<void>;
}

/** Firestore rejects `undefined`; strip it everywhere before writing. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = clean(x);
    return out as T;
  }
  return v;
}
