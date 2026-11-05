/* Core data model. Every timestamp is an ISO-8601 string. */

/** shelf = stored, not in the active charge rotation */
export type RotationState = 'shelf' | 'charging' | 'resting' | 'ready' | 'robot';
export type Temp = 'room' | 'cold' | 'warm';
export type Role = 'admin' | 'member';

export interface Battery {
  id: string;
  label: string;
  model?: string;
  manufacturer?: string; // MK, Energizer… (the M / E suffix on the name)
  lotCode?: string;
  location?: string; // AR Charger, Shop - TBT, Pit…
  /** Hand-picked and set aside for competition use only. */
  quarantined?: boolean;
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

/** beak = quick Battery Beak check, cba = full capacity discharge, mca = cranking-amps load test */
export type TestKind = 'beak' | 'cba' | 'mca';

export interface TestRecord {
  id: string;
  batteryId: string;
  at: string;
  kind?: TestKind; // older records without a kind are Beak checks (MCA-only ones are inferred)
  soc?: number | null; // %   (Beak)
  ir?: number | null; // mΩ  (Beak)
  v0?: number | null; // V, open-load (Beak)
  mca?: number | null; // cranking amps (MCA tester)
  ah?: number | null; // capacity, amp-hours (CBA)
  wh?: number | null; // energy, watt-hours (CBA)
  rintPre?: number | null; // mΩ, before the CBA discharge
  rintPost?: number | null; // mΩ, after the CBA discharge
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

/** One match (or practice run) worth of robot-log metrics. batteryId is ''
    when nobody said which battery was in the robot. */
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
  /* from a .wpilog analysis */
  restV?: number | null;
  endV?: number | null;
  ahUsed?: number | null;
  sysR?: number | null; // effective resistance under load, mΩ
  by?: string;
  notes?: string;
  report?: import('./matchReport').MatchReport | null;
  source: 'manual' | 'csv' | 'log';
}

export interface Settings {
  /* Suitable for competition (all must pass, then the best `compCount` by capacity) */
  compMinAh: number;
  compMaxRint: number; // mΩ, CBA pre-test
  compMinMca: number;
  compCbaMonths: number; // CBA must be this recent
  compMcaMonths: number;
  compCount: number; // how many batteries the team runs at competition
  /* Suitable for practice / prototype ("testing") */
  pracMinAh: number;
  pracMaxRint: number;
  pracMinMca: number;
  pracCbaMonths: number;
  pracMcaMonths: number;
  /* Battery Beak pit check */
  irMax: number; // Beak IR that pulls a battery for the day
  irWatch: number; // Beak IR watch zone
  socTarget: number; // charge target on the Beak
  socMin: number; // below this a Beak reading isn't trustworthy
  v0Min: number; // fresh-off-charger open-load voltage that fails
  v0Watch: number; // ...and the level that's worth watching
  restMin: number; // rest before recharging
  chargeMin: number; // typical full charge time
  queueLeadMin: number; // robot must be in queue this long before a match
  matchMin: number; // length of a match slot
  projectWeeks: number; // warn when a trend crosses a limit within this many weeks
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
  /** when an admin last saved the thresholds, and who */
  settingsUpdated: { at: string; by?: string } | null;
  event: EventConfig;
}
