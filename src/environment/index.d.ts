export type TireCompound = 'S' | 'M' | 'H';
export type PaddockPhysicsMode = 'arcade' | 'simulator';
export type PaddockProceduralTrackProfile = 'race' | 'training-short' | 'training-medium' | 'training-technical';

export interface PaddockProceduralTrackOptions {
  profile?: PaddockProceduralTrackProfile;
  minLengthMeters?: number;
  maxLengthMeters?: number;
  startStraightMeters?: number;
  includePitLane?: boolean;
  length?: {
    minMeters?: number;
    maxMeters?: number;
  };
  startStraight?: {
    gridMeters?: number;
    exitMeters?: number;
    blendMeters?: number;
    lockExtraMeters?: number;
  };
  pitLane?: {
    enabled?: boolean;
  };
  shape?: {
    scale?: number;
    cornerDensity?: number;
    variation?: number;
  };
  validation?: {
    minClearanceMultiplier?: number;
    minShapeVariation?: number;
    minNonAdjacentArcMeters?: number;
    maxLocalTurnRadians?: number;
    maxSampleHeadingDeltaRadians?: number;
  };
  attempts?: {
    primary?: number;
    fallback?: number;
  };
}

export type PaddockStabilityState = 'stable' | 'understeer' | 'oversteer' | 'spin-risk' | 'destroyed';
export type PaddockPitIntent = 0 | 1 | 2;
export type PaddockScenarioPreset = 'cornering' | 'off-track-recovery' | 'overtaking-pack' | 'pit-entry';
export type PaddockParticipantInteractionProfile =
  | 'normal'
  | 'isolated-training'
  | 'batch-training'
  | 'phantom-race'
  | 'time-trial-overlay';

export interface PaddockParticipantInteraction {
  profile: PaddockParticipantInteractionProfile;
  collidable: boolean;
  detectableByRays: boolean;
  detectableAsNearby: boolean;
  blocksPitLane: boolean;
  affectsRaceOrder: boolean;
}

export type PaddockParticipantInteractionOverride =
  Partial<PaddockParticipantInteraction> & { profile?: PaddockParticipantInteractionProfile };

export interface PaddockParticipantInteractionsOptions {
  defaultProfile?: PaddockParticipantInteractionProfile;
  drivers?: Record<string, PaddockParticipantInteractionOverride>;
}

export interface PaddockReplayGhostTrajectorySample {
  timeSeconds: number;
  x: number;
  y: number;
  headingRadians: number;
  speedKph?: number;
  progressMeters?: number;
}

export interface PaddockReplayGhostOptions {
  id: string;
  label?: string;
  color?: string;
  opacity?: number;
  visible?: boolean;
  trajectory: PaddockReplayGhostTrajectorySample[];
  sensors?: {
    detectableByRays?: boolean;
    detectableAsNearby?: boolean;
  };
}

export interface PaddockReplayGhostSnapshot {
  id: string;
  label: string;
  color: string;
  opacity: number;
  visible: boolean;
  previousX: number;
  previousY: number;
  x: number;
  y: number;
  previousHeading: number;
  heading: number;
  speedKph: number;
  progressMeters: number;
  timeSeconds: number;
  sensors: {
    detectableByRays: boolean;
    detectableAsNearby: boolean;
  };
}

export interface TeamData {
  id?: string;
  name?: string;
  color?: string;
  icon?: string;
  pitCrew?: PaddockPitCrewStats;
  pitCrewStats?: PaddockPitCrewStats;
}

export interface PaddockPitCrewStats {
  speed?: number;
  consistency?: number;
  reliability?: number;
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

export type PaddockRulesetName = 'paddock' | 'custom' | 'grandPrix2025' | 'fia2025';

export interface PaddockPenaltyEntry {
  id: string;
  type: string;
  at: number;
  lap: number;
  driverId: string;
  strictness: number;
  status: PaddockPenaltyStatus;
  penaltySeconds: number;
  pendingPenaltySeconds?: number;
  consequences: PaddockPenaltyConsequence[];
  serviceType?: 'driveThrough' | 'stopGo' | null;
  serviceRequired?: boolean;
  serviceServedAt?: number | null;
  appliedAt?: number;
  cancelledAt?: number;
  unserved?: boolean;
  positionDrop?: number;
  gridDrop?: number;
  disqualified?: boolean;
  reason?: string;
  otherCarId?: string;
  aheadDriverId?: string;
  atFaultDriverId?: string;
  sharedFault?: boolean;
  impactSpeedKph?: number;
  impactSpeedThresholdKph?: number;
  [key: string]: unknown;
}

export type PaddockPenaltyConsequence =
  | { type: 'warning' }
  | { type: 'time'; seconds: number }
  | { type: 'driveThrough'; conversionSeconds?: number }
  | { type: 'stopGo'; seconds?: number; conversionSeconds?: number }
  | { type: 'positionDrop'; positions: number }
  | { type: 'gridDrop'; positions: number }
  | { type: 'disqualification' };

export type PaddockPenaltyStatus = 'issued' | 'served' | 'applied' | 'cancelled';

export interface RaceSnapshot {
  time: number;
  physicsMode: PaddockPhysicsMode;
  totalLaps: number;
  raceControl: {
    mode: string;
    finished: boolean;
    [key: string]: unknown;
  };
  track: Record<string, unknown>;
  cars: Array<Record<string, unknown>>;
  replayGhosts: PaddockReplayGhostSnapshot[];
  events: RaceEvent[];
  penalties: PaddockPenaltyEntry[];
  [key: string]: unknown;
}

export interface PaddockAction {
  steering: number;
  throttle: number;
  brake: number;
  pitIntent?: PaddockPitIntent;
  pitCompound?: TireCompound | string;
  pitTargetCompound?: TireCompound | string;
}

export type PaddockActionMap = Record<string, PaddockAction>;

export interface PaddockRaceRules {
  ruleset?: PaddockRulesetName;
  profile?: PaddockRulesetName;
  modules?: {
    pitStops?: {
      enabled?: boolean;
      pitLaneSpeedLimitKph?: number;
      defaultStopSeconds?: number;
      variability?: {
        enabled?: boolean;
        perfect?: boolean;
        speedImpactSeconds?: number;
        consistencyJitterSeconds?: number;
        issueChance?: number;
        issueMaxDelaySeconds?: number;
      };
      doubleStacking?: boolean;
      maxConcurrentPitLaneCars?: number;
      minimumPitLaneGapMeters?: number;
      tirePitRequestThresholdPercent?: number;
      tirePitCommitThresholdPercent?: number;
    };
    tireStrategy?: {
      enabled?: boolean;
      compounds?: TireCompound[];
      mandatoryDistinctDryCompounds?: number | null;
    };
    tireDegradation?: {
      enabled?: boolean;
    };
    penalties?: {
      enabled?: boolean;
      stewardStrictness?: number;
      trackLimits?: {
        strictness?: number;
        warningsBeforePenalty?: number;
        relaxedMarginMeters?: number;
        timePenaltySeconds?: number;
        consequences?: PaddockPenaltyConsequence[];
      };
      collision?: {
        strictness?: number;
        timePenaltySeconds?: number;
        consequences?: PaddockPenaltyConsequence[];
        minimumSeverity?: number;
        relaxedSeverityMargin?: number;
        minimumImpactSpeedKph?: number;
        relaxedImpactSpeedKph?: number;
      };
      tireRequirement?: {
        strictness?: number;
        timePenaltySeconds?: number;
        consequences?: PaddockPenaltyConsequence[];
      };
      pitLaneSpeeding?: {
        strictness?: number;
        speedLimitKph?: number;
        marginKph?: number;
        relaxedMarginKph?: number;
        timePenaltySeconds?: number;
        consequences?: PaddockPenaltyConsequence[];
      };
    };
    weather?: { enabled?: boolean };
    reliability?: { enabled?: boolean };
    fuelLoad?: { enabled?: boolean };
  };
  drsDetectionSeconds?: number;
  safetyCarSpeed?: number;
  safetyCarLeadDistance?: number;
  safetyCarGap?: number;
  collisionRestitution?: number;
  standingStart?: boolean;
  startLightCount?: number;
  startLightInterval?: number;
  startLightsOutHold?: number;
}

export interface PaddockSensorRayResult {
  id?: string;
  angleDegrees: number;
  angleRadians: number;
  lengthMeters: number;
  roadEdge: {
    hit: boolean;
    distanceMeters: number;
    kind: 'exit' | 'entry' | null;
  };
  track: {
    hit: boolean;
    distanceMeters: number;
    kind: 'exit' | 'entry' | null;
  };
  kerb: PaddockSurfaceRayHit;
  illegalSurface: PaddockSurfaceRayHit;
  car: {
    hit: boolean;
    distanceMeters: number;
    driverId: string | null;
    targetId?: string | null;
    targetType?: 'car' | 'replayGhost' | null;
    relativeSpeedKph: number;
  };
}

export interface PaddockSurfaceRayHit {
  hit: boolean;
  distanceMeters: number;
  surface: string | null;
}

export interface PaddockNearbyCarObservation {
  id: string;
  relativeForwardMeters: number;
  relativeRightMeters: number;
  relativeDistanceMeters: number;
  relativeSpeedKph: number;
  relativeHeadingRadians: number;
  ahead: boolean;
  behind: boolean;
  sameLap: boolean;
  closingRateMetersPerSecond: number;
  timeToContactSeconds: number | null;
  leftOverlap: boolean;
  rightOverlap: boolean;
  entityType?: 'car' | 'replayGhost';
}

export interface PaddockTrackLookaheadObservation {
  distanceMeters: number;
  curvature: number;
  headingDeltaRadians: number;
}

export interface PaddockDriverObservationObject {
  profile: string;
  self: {
    id: string;
    speedKph: number;
    speedMetersPerSecond: number;
    headingRadians: number;
    yawRateRadiansPerSecond: number;
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
    inPitLane: boolean;
    pitLanePart: 'entry' | 'fast-lane' | 'working-lane' | 'exit' | 'service-box' | 'garage-box' | null;
    pitBoxId: string | null;
    tireEnergy: number | null;
    pitIntent: PaddockPitIntent;
    pitTargetCompound: TireCompound | string | null;
    pitStopStatus: 'pending' | 'entering' | 'queued' | 'servicing' | 'exiting' | 'completed' | null;
    pitStopPhase: 'entry' | 'queue' | 'queue-release' | 'penalty' | 'service' | 'exit' | null;
    pitStopServiceRemainingSeconds: number | null;
    pitStopPenaltyServiceRemainingSeconds: number | null;
    pitStopsCompleted: number;
    lateralG: number;
    longitudinalG: number;
    gripUsage: number;
    slipAngleRadians: number;
    tractionLimited: boolean;
    stabilityState: PaddockStabilityState;
    destroyed: boolean;
    destroyReason: string | null;
  };
  trackRelation: {
    lateralOffsetMeters: number;
    headingErrorRadians: number;
    legalWidthMeters: number;
    leftBoundaryMeters: number;
    rightBoundaryMeters: number;
    onLegalSurface: boolean;
    surface: string;
  };
  contactPatches: PaddockContactPatchObservation[];
  race: {
    position: number;
    totalCars: number;
    raceMode: string;
    pitLaneOpen: boolean;
    redFlag: boolean;
    totalLaps: number;
  };
  track: {
    lengthMeters: number;
    widthMeters: number;
    curvature: number;
    lookahead: PaddockTrackLookaheadObservation[];
  };
  rays: PaddockSensorRayResult[];
  nearbyCars: PaddockNearbyCarObservation[];
  events: RaceEvent[];
}

export interface PaddockContactPatchObservation {
  id: 'front-left' | 'front-right' | 'rear-left' | 'rear-right' | string;
  present: boolean;
  signedOffsetMeters: number;
  crossTrackErrorMeters: number;
  surface: string;
  surfaceCode: number;
  onLegalSurface: boolean;
  inPitLane: boolean;
}

export interface PaddockObservationSchemaEntry {
  name: string;
  unit?: string;
  scale?: string;
}

export interface PaddockDriverObservation {
  object?: PaddockDriverObservationObject;
  vector?: number[] | Float32Array;
  schema?: PaddockObservationSchemaEntry[];
  events: RaceEvent[];
}

export interface PaddockEnvironmentOptions {
  drivers: SimulatorDriver[];
  entries?: ChampionshipEntryBlueprint[];
  controlledDrivers: string[];
  seed?: number;
  trackSeed?: number;
  trackGeneration?: PaddockProceduralTrackOptions;
  totalLaps?: number;
  frameSkip?: number;
  physicsMode?: PaddockPhysicsMode;
  rules?: PaddockRaceRules;
  participantInteractions?: PaddockParticipantInteractionsOptions;
  replayGhosts?: PaddockReplayGhostOptions[];
  actionPolicy?: 'strict' | 'report';
  scenario?: {
    participants?: 'all' | 'controlled-only' | string[];
    nonControlled?: 'ai';
    preset?: PaddockScenarioPreset;
    placements?: Record<string, PaddockScenarioPlacement>;
    traffic?: PaddockScenarioTrafficPlacement[];
  };
  sensors?: {
    rays?: {
      enabled?: boolean;
      anglesDegrees?: number[];
      lengthMeters?: number;
      defaultLengthMeters?: number;
      layout?: 'compact' | 'driver-front-heavy' | 'lidar-lite' | string;
      rays?: Array<number | {
        id?: string;
        angleDegrees: number;
        lengthMeters?: number;
      }>;
      channels?: Array<'roadEdge' | 'kerb' | 'illegalSurface' | 'car'>;
      precision?: 'driver' | 'debug';
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
  observation?: {
    profile?: 'default' | 'physical-driver' | 'debug-map' | string;
    output?: 'full' | 'vector' | 'object';
    includeSchema?: boolean;
    vectorType?: 'array' | 'float32';
    lookaheadMeters?: number[];
  };
  result?: {
    stateOutput?: 'full' | 'minimal' | 'none';
    resetDriversObservationScope?: 'all' | 'reset';
  };
  episode?: {
    maxSteps?: number;
    endOnRaceFinish?: boolean;
  };
  reward?: (payload: PaddockRewardContext) => number;
}

export interface PaddockScenarioPlacement {
  distanceMeters?: number;
  startDistanceMeters?: number;
  offsetMeters?: number;
  speedKph?: number;
  headingErrorRadians?: number;
}

export interface PaddockScenarioTrafficPlacement {
  driverId: string;
  relativeTo: string;
  deltaDistanceMeters?: number;
  offsetMeters?: number;
  speedKph?: number;
  headingErrorRadians?: number;
}

export interface PaddockRewardContext {
  driverId: string;
  previous: RaceSnapshot | null;
  current: PaddockDriverObservation;
  action: PaddockAction | undefined;
  events: RaceEvent[];
  state: { snapshot: RaceSnapshot };
  metrics: PaddockEnvironmentDriverMetrics;
  episode: PaddockDriverRuntimeState;
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

export interface PaddockActionSpec {
  version: 1;
  controlledDrivers: string[];
  action: {
    type: 'continuous';
    perDriver: {
      steering: { min: -1; max: 1; unit: 'normalized' };
      throttle: { min: 0; max: 1; unit: 'normalized' };
      brake: { min: 0; max: 1; unit: 'normalized' };
      pitIntent: { values: [0, 1, 2]; unit: 'request'; optional: true };
      pitCompound: { values: string[]; unit: 'compound'; optional: true };
    };
  };
}

export interface PaddockObservationSpec {
  version: 2 | 3;
  controlledDrivers: string[];
  object: Record<string, unknown>;
  vector: {
    schema: PaddockObservationSchemaEntry[];
  };
}

export interface PaddockRolloutTransition {
  observation: Record<string, PaddockDriverObservation>;
  action: PaddockActionMap;
  reward: null | Record<string, number>;
  nextObservation: Record<string, PaddockDriverObservation>;
  terminated: boolean;
  truncated: boolean;
  info: PaddockEnvironmentResult['info'];
}

export interface PaddockRolloutRecorder {
  recordStep(
    previousResult: PaddockEnvironmentResult,
    action: PaddockActionMap,
    nextResult: PaddockEnvironmentResult
  ): PaddockRolloutTransition;
  clear(): void;
  toJSON(): PaddockRolloutTransition[];
}

export interface PaddockEvaluationCase {
  name: string;
  seed?: number;
  trackSeed?: number;
  maxSteps?: number;
  scenario?: PaddockEnvironmentOptions['scenario'];
}

export interface PaddockEvaluationDriverMetrics {
  distanceMeters: number;
  lapProgressMeters: number;
  offTrackSteps: number;
  contactCount: number;
  recoverySuccess: boolean;
  passCount: number;
  lapTimeSeconds: number | null;
}

export interface PaddockEvaluationCaseReport {
  name: string;
  seed?: number;
  trackSeed?: number;
  steps: number;
  done: boolean;
  endReason: string | null;
  metrics: Record<string, PaddockEvaluationDriverMetrics>;
}

export interface PaddockEvaluationReport {
  cases: PaddockEvaluationCaseReport[];
}

export type PaddockPolicyLike =
  | ((observation: PaddockDriverObservation, context: Record<string, unknown>) => PaddockAction)
  | { predict(observation: PaddockDriverObservation, context: Record<string, unknown>): PaddockAction };

export interface PaddockDriverControllerContext {
  runtime: PaddockControllerRuntime;
  mode: string;
  actionRepeat: number;
  controlledDrivers: string[];
  actionSpec: PaddockActionSpec;
  observationSpec: PaddockObservationSpec;
  result: PaddockEnvironmentResult | unknown;
  previousResult: PaddockEnvironmentResult | unknown | null;
  observation: Record<string, PaddockDriverObservation>;
  orderedObservations: Array<{
    driverId: string;
    index: number;
    observation: PaddockDriverObservation | null;
    vector: number[] | Float32Array | null;
  }>;
  metrics: Record<string, PaddockEnvironmentDriverMetrics>;
  events: RaceEvent[];
  info: PaddockEnvironmentResult['info'] | unknown | null;
  previousActions: PaddockActionMap;
  orderedPreviousActions: Array<PaddockAction | null>;
  actions: PaddockActionMap | null;
  policyStep: number;
  runtimeStep: number;
  heldFramesRemaining: number;
  actionIndex: number;
  resetDriverIds: string[];
}

export interface PaddockDriverController {
  init?(context: PaddockDriverControllerContext): void | Promise<void>;
  reset?(context: PaddockDriverControllerContext): void | Promise<void>;
  decideBatch(context: PaddockDriverControllerContext): PaddockActionMap | Promise<PaddockActionMap>;
  onStep?(context: PaddockDriverControllerContext): void | Promise<void>;
}

export interface PaddockControllerRuntime {
  reset(options?: unknown): PaddockEnvironmentResult | unknown;
  step(actions: PaddockActionMap): PaddockEnvironmentResult | unknown;
  resetDrivers?(
    placements: Record<string, PaddockScenarioPlacement>,
    resultOptions?: PaddockEnvironmentResultOptions
  ): PaddockEnvironmentResult | unknown;
  getObservation(): Record<string, PaddockDriverObservation>;
  getState?(options?: { output?: 'full' | 'minimal' | 'none' }): PaddockEnvironmentResult['state'] | unknown;
  getActionSpec(): PaddockActionSpec;
  getObservationSpec(): PaddockObservationSpec;
  destroy?(): void;
}

export interface PaddockDriverControllerLoopOptions {
  runtime: PaddockControllerRuntime;
  controller: PaddockDriverController;
  actionRepeat?: number;
  mode?: string;
  scheduler?: null | ((callback: () => void | Promise<void>) => unknown);
}

export interface PaddockDriverControllerLoop {
  readonly result: PaddockEnvironmentResult | unknown | null;
  readonly actionSpec: PaddockActionSpec | null;
  readonly observationSpec: PaddockObservationSpec | null;
  readonly stats: {
    policyStep: number;
    runtimeStep: number;
    heldFramesRemaining: number;
    actions: PaddockActionMap | null;
    actionRepeat: number;
    lastDecisionMs: number;
    running: boolean;
    lastError: unknown | null;
  };
  reset(options?: unknown): Promise<PaddockEnvironmentResult | unknown>;
  resetDrivers(
    placements: Record<string, PaddockScenarioPlacement>,
    resultOptions?: PaddockEnvironmentResultOptions
  ): Promise<PaddockEnvironmentResult | unknown>;
  step(): Promise<PaddockEnvironmentResult | unknown>;
  stepFrame(): Promise<PaddockEnvironmentResult | unknown>;
  start(): void;
  stop(): void;
}

export interface PaddockEnvironmentWorkerMessage {
  id?: string | number | null;
  type: 'reset' | 'resetDrivers' | 'step' | 'getActionSpec' | 'getObservationSpec' | 'getObservation' | 'getState' | 'destroy' | string;
  options?: Partial<PaddockEnvironmentOptions>;
  actions?: PaddockActionMap;
  placements?: Record<string, PaddockScenarioPlacement>;
  resultOptions?: PaddockEnvironmentResultOptions;
  stateOptions?: { output?: 'full' | 'minimal' | 'none' };
}

export interface PaddockEnvironmentWorkerResponse {
  id: string | number | null;
  ok: boolean;
  type: string;
  result?: unknown;
  error?: string;
}

export interface PaddockEnvironmentWorkerProtocol {
  handle(message: PaddockEnvironmentWorkerMessage): PaddockEnvironmentWorkerResponse;
}

export interface PaddockEnvironmentResult {
  observation: Record<string, PaddockDriverObservation>;
  reward: null | Record<string, number>;
  metrics: Record<string, PaddockEnvironmentDriverMetrics>;
  terminated: boolean;
  truncated: boolean;
  done: boolean;
  events: RaceEvent[];
  state: { snapshot: RaceSnapshot } | null;
  info: {
    step: number;
    elapsedSeconds: number;
    seed: number;
    trackSeed: number;
    controlledDrivers: string[];
    actionErrors: string[];
    endReason: string | null;
    drivers: Record<string, PaddockDriverRuntimeState>;
  };
}

export type PaddockEnvironmentSnapshotResult = PaddockEnvironmentResult & {
  state: { snapshot: RaceSnapshot };
};

export interface PaddockEnvironment {
  reset(options?: Partial<PaddockEnvironmentOptions>): PaddockEnvironmentResult;
  resetDrivers(
    placements: Record<string, PaddockScenarioPlacement>,
    resultOptions?: PaddockEnvironmentResultOptions
  ): PaddockEnvironmentResult;
  step(actions: PaddockActionMap): PaddockEnvironmentResult;
  getObservation(): PaddockEnvironmentResult['observation'];
  getState(options?: { output?: 'full' | 'minimal' | 'none' }): PaddockEnvironmentResult['state'];
  getActionSpec(): PaddockActionSpec;
  getObservationSpec(): PaddockObservationSpec;
  destroy(): void;
}

export interface PaddockEnvironmentResultOptions {
  stateOutput?: 'full' | 'minimal' | 'none';
  observationScope?: 'all' | 'reset';
  resetDriversObservationScope?: 'all' | 'reset';
}

export interface PaddockDriverRuntimeState {
  terminated: boolean;
  truncated: boolean;
  endReason: string | null;
  episodeStep: number;
  episodeId: number;
}

export interface PaddockEnvironmentDriverMetrics {
  progressDeltaMeters: number;
  legalProgressDeltaMeters: number;
  offTrack: boolean;
  kerb: boolean;
  fullyOutsideWhiteLine: boolean;
  severeCut: boolean;
  destroyed: boolean;
  destroyReason: string | null;
  under30kph: boolean;
  spinOrBackwards: boolean;
  completedLap: boolean;
  lapTimeSeconds: number | null;
  contactCount: number;
}

export function createPaddockEnvironment(options: PaddockEnvironmentOptions): PaddockEnvironment;
export function createPaddockDriverControllerLoop(options: PaddockDriverControllerLoopOptions): PaddockDriverControllerLoop;
export function createProgressReward(options?: PaddockProgressRewardOptions): (context: PaddockRewardContext) => number;
export function createRolloutRecorder(): PaddockRolloutRecorder;
export function createRolloutTransition(
  previousResult: PaddockEnvironmentResult,
  action: PaddockActionMap,
  nextResult: PaddockEnvironmentResult
): PaddockRolloutTransition;
export const ENVIRONMENT_SCENARIO_PRESETS: readonly PaddockScenarioPreset[];
export const DEFAULT_EVALUATION_CASES: readonly PaddockEvaluationCase[];
export function createEvaluationTracker(initialResult: PaddockEnvironmentSnapshotResult): {
  update(result: PaddockEnvironmentSnapshotResult): void;
  finish(): Record<string, PaddockEvaluationDriverMetrics>;
};
export function runEnvironmentEvaluation(options: {
  baseOptions: PaddockEnvironmentOptions;
  policy: PaddockPolicyLike;
  cases?: PaddockEvaluationCase[];
  createEnvironment?: (options: PaddockEnvironmentOptions) => PaddockEnvironment;
}): PaddockEvaluationReport;
export function createEnvironmentWorkerProtocol(env: PaddockEnvironment): PaddockEnvironmentWorkerProtocol;
export function handleEnvironmentMessage(
  env: PaddockEnvironment,
  message: PaddockEnvironmentWorkerMessage
): PaddockEnvironmentWorkerResponse;
