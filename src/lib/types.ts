/* Core data model. Every timestamp is an ISO-8601 string. */

export type RotationState = 'charging' | 'resting' | 'ready' | 'robot';
export type Temp = 'room' | 'cold' | 'warm';
export type Role = 'admin' | 'member';

export interface Battery {
  id: string;
  label: string;
  model?: string;
  inService?: string; // "YYYY-MM"
  notes?: string;
  retired: boolean;
  retiredReason?: string | null;
  retiredAt?: string | null;
  state: RotationState;
  stateSince: string;
  /** A Beak reading taken while the battery was still charging. */
  chargeCheck?: { soc: number; at: string } | null;
  cycles: number;
  createdAt: string;
}

export interface Inspection {
  leads: boolean;
  crimps: boolean;
  case: boolean;
  anderson: boolean;
}

export interface TestRecord {
  id: string;
  batteryId: string;
  at: string;
  soc?: number | null; // %
  ir?: number | null; // mΩ
  v0?: number | null; // V, open-load
  mca?: number | null; // cranking amps
  temp?: Temp;
  offChargerMin?: number | null;
  inspection?: Inspection | null;
  by?: string;
  notes?: string;
  source?: 'app' | 'import';
}

export interface RotationEvent {
  id: string;
  batteryId: string;
  at: string;
  from: RotationState | null;
  to: RotationState;
  by?: string;
  match?: string | null;
}

export interface Flag {
  id: string;
  batteryId: string;
  at: string;
  by: string;
  reason: string;
  status: 'pending' | 'approved' | 'dismissed';
  resolvedBy?: string;
  resolvedAt?: string;
}

/** One match (or practice run) worth of robot-log metrics for a battery. */
export interface MatchRun {
  id: string;
  batteryId: string;
  at: string;
  event?: string;
  match: string;
  minV?: number | null;
  peakA?: number | null;
  energyWh?: number | null;
  brownouts?: number | null;
  source: 'manual' | 'csv';
}

export interface Settings {
  irMax: number; // retire / pull above this
  irWatch: number; // watch zone starts here
  socTarget: number; // charge target on the Beak
  socMin: number; // below this a test reading isn't trustworthy
  v0Min: number; // fresh-off-charger open-load voltage that fails
  v0Watch: number; // ...and the level that's worth watching
  mcaFloor: number | null; // AutoMeter pass/fail (team still deciding)
  mcaEvery: number; // ask for MCA every Nth test
  restMin: number; // rest before recharging
  chargeMin: number; // typical full charge time
  staleDays: number; // flag a battery not tested in this long
  queueLeadMin: number; // robot must be in queue this long before a match
  matchMin: number; // length of a match slot
  projectWeeks: number; // warn when the IR trend crosses the limit within this many weeks
}

export interface ScheduledMatch {
  key: string; // "qm42"
  label: string; // "Q42"
  time: string;
}

export interface EventConfig {
  mode: 'practice' | 'comp';
  name: string;
  matches: ScheduledMatch[];
  /** Manual battery choices that override the auto plan: match key → battery id. */
  assignments: Record<string, string>;
}

export interface Member {
  email: string;
  name: string;
  role: Role;
}

export interface AppData {
  batteries: Battery[];
  tests: TestRecord[];
  events: RotationEvent[];
  flags: Flag[];
  runs: MatchRun[];
  members: Member[];
  settings: Settings;
  event: EventConfig;
}
