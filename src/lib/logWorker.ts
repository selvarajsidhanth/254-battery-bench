/* Runs the log analysis off the main thread so the page stays responsive on
   100+ MB logs. Everything stays in the browser: the file is never uploaded. */
import { analyzeLog } from './matchReport';

self.onmessage = async (e: MessageEvent<File>) => {
  const file = e.data;
  try {
    let last = 0;
    const report = await analyzeLog(file, (f) => {
      if (f - last > 0.02 || f === 1) { last = f; (self as unknown as Worker).postMessage({ type: 'progress', f }); }
    });
    (self as unknown as Worker).postMessage({ type: 'done', report });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
