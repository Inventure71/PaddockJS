export type TireCompound = 'S' | 'M' | 'H';

export interface TeamData {
  id?: string;
  name?: string;
  color?: string;
  icon?: string;
}

export interface SimulatorDriver {
  id: string;
  name: string;
  color: string;
  link?: string;
  icon?: string;
  code?: string;
  timingName?: string;
  tire?: TireCompound;
  raceData?: string[];
  customFields?: Array<{ label: string; value: string }> | Record<string, string>;
  team?: TeamData | null;
  driverNumber?: number;
}

export interface ChampionshipEntryBlueprint {
  driverId: string;
  driverNumber?: number;
  timingName?: string;
  driver?: unknown;
  vehicle?: unknown;
  team?: TeamData;
}

export interface RaceEvent {
  type: string;
  at?: number;
  [key: string]: unknown;
}

export interface RaceSnapshot {
  time: number;
  totalLaps: number;
  raceControl: {
    mode: string;
    finished: boolean;
    [key: string]: unknown;
  };
  track: Record<string, unknown>;
  cars: Array<Record<string, unknown>>;
  events: RaceEvent[];
  [key: string]: unknown;
}

export interface PaddockAction {
  steering: number;
  throttle: number;
  brake: number;
}

export type PaddockActionMap = Record<string, PaddockAction>;

export interface PaddockSensorRayResult {
  angleDegrees: number;
  angleRadians: number;
  lengthMeters: number;
  track: {
    hit: boolean;
    distanceMeters: number;
    surface: string;
  };
  car: {
    hit: boolean;
    distanceMeters: number;
    driverId: string | null;
    relativeSpeedKph: number;
  };
}

export interface PaddockNearbyCarObservation {
  id: string;
  relativeForwardMeters: number;
  relativeRightMeters: number;
  relativeDistanceMeters: number;
  relativeSpeedKph: number;
  relativeHeadingRadians: number;
  ahead: boolean;
  sameLap: boolean;
}

export interface PaddockDriverObservationObject {
  self: {
    id: string;
    speedKph: number;
    speedMetersPerSecond: number;
    headingRadians: number;
    steeringAngleRadians: number;
    throttle: number;
    brake: number;
    lap: number;
    completedLaps: number;
    lapProgressMeters: number;
    trackOffsetMeters: number;
    trackHeadingErrorRadians: number;
    onTrack: boolean;
    surface: string;
    tireEnergy: number | null;
  };
  race: {
    position: number;
    totalCars: number;
    raceMode: string;
    totalLaps: number;
  };
  rays: PaddockSensorRayResult[];
  nearbyCars: PaddockNearbyCarObservation[];
  events: RaceEvent[];
}

export interface PaddockObservationSchemaEntry {
  name: string;
  unit?: string;
  scale?: string;
}

export interface PaddockDriverObservation {
  object: PaddockDriverObservationObject;
  vector: number[];
  schema: PaddockObservationSchemaEntry[];
  events: RaceEvent[];
}

export interface PaddockEnvironmentOptions {
  drivers: SimulatorDriver[];
  entries?: ChampionshipEntryBlueprint[];
  controlledDrivers: string[];
  seed?: number;
  trackSeed?: number;
  totalLaps?: number;
  frameSkip?: number;
  actionPolicy?: 'strict' | 'report';
  scenario?: {
    participants?: 'all' | 'controlled-only' | string[];
    nonControlled?: 'ai';
  };
  sensors?: {
    rays?: {
      enabled?: boolean;
      anglesDegrees?: number[];
      lengthMeters?: number;
      detectTrack?: boolean;
      detectCars?: boolean;
    };
    nearbyCars?: {
      enabled?: boolean;
      maxCars?: number;
      radiusMeters?: number;
    };
  };
  sensorsByDriver?: Record<string, PaddockEnvironmentOptions['sensors']>;
  episode?: {
    maxSteps?: number;
    endOnRaceFinish?: boolean;
  };
  reward?: (payload: PaddockRewardContext) => number;
}

export interface PaddockRewardContext {
  driverId: string;
  previous: RaceSnapshot | null;
  current: PaddockDriverObservation;
  action: PaddockAction | undefined;
  events: RaceEvent[];
  state: { snapshot: RaceSnapshot };
}

export interface PaddockProgressRewardWeights {
  progress: number;
  speed: number;
  offTrack: number;
  collision: number;
  steering: number;
  brake: number;
}

export interface PaddockProgressRewardOptions {
  weights?: Partial<PaddockProgressRewardWeights>;
}

export interface PaddockEnvironmentResult {
  observation: Record<string, PaddockDriverObservation>;
  reward: null | Record<string, number>;
  terminated: boolean;
  truncated: boolean;
  done: boolean;
  events: RaceEvent[];
  state: { snapshot: RaceSnapshot };
  info: {
    step: number;
    elapsedSeconds: number;
    seed: number;
    trackSeed: number;
    controlledDrivers: string[];
    actionErrors: string[];
    endReason: string | null;
  };
}

export interface PaddockEnvironment {
  reset(options?: Partial<PaddockEnvironmentOptions>): PaddockEnvironmentResult;
  step(actions: PaddockActionMap): PaddockEnvironmentResult;
  getObservation(): PaddockEnvironmentResult['observation'];
  getState(): PaddockEnvironmentResult['state'];
  destroy(): void;
}

export function createPaddockEnvironment(options: PaddockEnvironmentOptions): PaddockEnvironment;
export function createProgressReward(options?: PaddockProgressRewardOptions): (context: PaddockRewardContext) => number;
