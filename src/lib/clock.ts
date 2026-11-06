/* The app's idea of "now". Normally the wall clock; the pit rehearsal swaps in
   a simulated clock that can run fast, pause, or jump ahead. */

interface Sim { base: number; mark: number; speed: number; paused: boolean }
let sim: Sim | null = null;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

export const appNow = () =>
  sim ? sim.base + (sim.paused ? 0 : (Date.now() - sim.mark) * sim.speed) : Date.now();
export const appIso = () => new Date(appNow()).toISOString();
export const simulated = () => sim != null;
export const simState = () => (sim ? { speed: sim.speed, paused: sim.paused } : null);

export function startSim(at = Date.now(), speed = 1) {
  sim = { base: at, mark: Date.now(), speed, paused: false };
  ping();
}
export function stopSim() {
  sim = null;
  ping();
}
function rebase(patch: Partial<Sim>) {
  if (!sim) return;
  sim = { ...sim, base: appNow(), mark: Date.now(), ...patch };
  ping();
}
export const setSimSpeed = (speed: number) => rebase({ speed, paused: false });
export const setSimPaused = (paused: boolean) => rebase({ paused });
export const jumpSim = (ms: number) => { if (sim) rebase({ base: appNow() + ms }); };
/** Called whenever the simulated clock changes speed, pauses, or jumps. */
export function onClockChange(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}
