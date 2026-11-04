/* Turn raw stored docs into typed records. Also reads the field names used
   by the July 2026 version of the app (ts, testerName, readyState…) so any
   leftover documents still display instead of crashing. */
import type { Battery, EventConfig, Flag, MatchRun, Member, RotationEvent, RotationState, Settings, TestRecord } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/domain';
import type { Doc } from './backend';

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown, d: string) => {
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v;
  if (v && typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate(): Date }).toDate().toISOString();
  return d;
};
const STATES: RotationState[] = ['shelf', 'charging', 'resting', 'ready', 'robot'];
const LEGACY_STATE: Record<string, RotationState> = { inuse: 'robot', cooldown: 'resting', flat: 'charging' };

export function toBattery(id: string, d: Doc): Battery {
  const epoch = new Date(0).toISOString();
  let state = str(d.state) || str(d.readyState);
  state = LEGACY_STATE[state] ?? state;
  return {
    id,
    label: str(d.label, id.toUpperCase()),
    model: str(d.model) || undefined,
    manufacturer: str(d.manufacturer) || undefined,
    lotCode: str(d.lotCode) || undefined,
    location: str(d.location) || undefined,
    quarantined: d.quarantined === true,
    inService: str(d.inService) || undefined,
    notes: str(d.notes) || undefined,
    retired: d.retired === true || d.status === 'retired',
    retiredReason: (d.retiredReason as string) ?? null,
    retiredAt: (d.retiredAt as string) ?? (d.retiredDate as string) ?? null,
    state: (STATES.includes(state as RotationState) ? state : 'charging') as RotationState,
    stateSince: iso(d.stateSince ?? d.readySince, epoch),
    chargeCheck: (d.chargeCheck as Battery['chargeCheck']) ?? null,
    cycles: num(d.cycles) ?? 0,
    createdAt: iso(d.createdAt ?? d.addedDate, epoch),
  };
}

export function toTest(id: string, d: Doc): TestRecord {
  return {
    id,
    batteryId: str(d.batteryId),
    at: iso(d.at ?? d.ts, new Date(0).toISOString()),
    soc: num(d.soc),
    ir: num(d.ir),
    v0: num(d.v0),
    mca: num(d.mca),
    ah: num(d.ah),
    wh: num(d.wh),
    rintPre: num(d.rintPre),
    rintPost: num(d.rintPost),
    kind: (['beak', 'cba', 'mca'].includes(str(d.kind)) ? str(d.kind) : undefined) as TestRecord['kind'],
    temp: (str(d.temp) as TestRecord['temp']) || undefined,
    offChargerMin: num(d.offChargerMin),
    inspection: (d.inspection as TestRecord['inspection']) ?? null,
    by: str(d.by) || str(d.testerName) || undefined,
    notes: str(d.notes) || undefined,
    source: (str(d.source) as TestRecord['source']) || undefined,
  };
}

export const toEvent = (id: string, d: Doc): RotationEvent => ({
  id, batteryId: str(d.batteryId), at: iso(d.at, new Date(0).toISOString()),
  from: (d.from as RotationState) ?? null, to: (d.to as RotationState) ?? 'charging', by: str(d.by) || undefined, match: (d.match as string) ?? null,
});

export const toFlag = (id: string, d: Doc): Flag => ({
  id, batteryId: str(d.batteryId), at: iso(d.at ?? d.ts, new Date(0).toISOString()), by: str(d.by, 'someone'),
  reason: str(d.reason), status: (str(d.status, 'pending') as Flag['status']),
  resolvedBy: str(d.resolvedBy) || undefined, resolvedAt: str(d.resolvedAt ?? d.resolvedTs) || undefined,
});

export const toRun = (id: string, d: Doc): MatchRun => ({
  id, batteryId: str(d.batteryId), at: iso(d.at, new Date(0).toISOString()), event: str(d.event) || undefined,
  match: str(d.match), minV: num(d.minV), peakA: num(d.peakA), energyWh: num(d.energyWh), brownouts: num(d.brownouts),
  source: (str(d.source, 'manual') as MatchRun['source']),
});

export const toMember = (id: string, d: Doc): Member => ({
  email: id, name: str(d.name, id.split('@')[0]), role: d.role === 'admin' ? 'admin' : 'member',
});

export function toSettings(d: Doc | undefined): Settings {
  const out = { ...DEFAULT_SETTINGS };
  if (!d) return out;
  // legacy names from v1
  const legacy: Record<string, keyof Settings> = { chargeTarget: 'socTarget' };
  for (const [k, v] of Object.entries(d)) {
    const key = (legacy[k] ?? k) as keyof Settings;
    if (key in out && typeof v === 'number') (out as Record<string, unknown>)[key] = v;
  }
  if (typeof d.chargeHours === 'number' && d.chargeMin == null) out.chargeMin = Math.round(d.chargeHours * 60);
  return out;
}

export const DEFAULT_EVENT: EventConfig = { mode: 'practice', name: '', matches: [], assignments: {} };
export function toEventConfig(d: Doc | undefined): EventConfig {
  if (!d) return { ...DEFAULT_EVENT };
  return {
    mode: d.mode === 'comp' ? 'comp' : 'practice',
    name: str(d.name),
    matches: Array.isArray(d.matches) ? (d.matches as EventConfig['matches']) : [],
    assignments: (d.assignments as Record<string, string>) ?? {},
  };
}
