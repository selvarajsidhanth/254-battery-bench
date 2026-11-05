import type { MatchReport } from './matchReport';

/** Analyze a .wpilog in a Web Worker (falls back to the main thread). */
export function analyzeFile(file: File, onProgress: (f: number) => void): Promise<MatchReport> {
  return new Promise((resolve, reject) => {
    const onMainThread = () => import('./matchReport').then((m) => m.analyzeLog(file, onProgress)).then(resolve, reject);
    let worker: Worker;
    try {
      worker = new Worker(new URL('./logWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      onMainThread();
      return;
    }
    let started = false;
    worker.onmessage = (e) => {
      const d = e.data as { type: 'progress'; f: number } | { type: 'done'; report: MatchReport } | { type: 'error'; message: string };
      started = true;
      if (d.type === 'progress') onProgress(d.f);
      else { worker.terminate(); if (d.type === 'done') resolve(d.report); else reject(new Error(d.message)); }
    };
    // if the worker script itself can't load, just do the work here instead
    worker.onerror = (e) => { worker.terminate(); if (!started) onMainThread(); else reject(new Error(e.message || 'The log reader crashed.')); };
    worker.postMessage(file);
  });
}
