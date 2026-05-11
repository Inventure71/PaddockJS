import type { PaddockActionSpec, PaddockObservationSpec } from './environment/index.js';

export type { PaddockActionSpec, PaddockObservationSpec } from './environment/index.js';

export type TireCompound = 'S' | 'M' | 'H';
export type PaddockPitIntent = 0 | 1 | 2;
export type PaddockPitIntentRequest = PaddockPitIntent | {
  intent?: PaddockPitIntent;
  pitIntent?: PaddockPitIntent;
  targetCompound?: TireCompound | string;
  compound?: TireCompound | string;
  pitCompound?: TireCompound | string;
  pitTargetCompound?: TireCompound | string;
  targetTire?: TireCompound | string;
};
export type CameraMode = 'overview' | 'leader' | 'selected' | 'show-all' | 'pit';
export type RaceBannerMode = 'project' | 'radio' | 'hidden';
export type RaceBannerEnabledMode = 'project' | 'radio';
export type RaceDataBannerSize = 'auto' | 'custom';
export type TimingTowerVerticalFit = 'expand-race-view' | 'scroll';
export type LayoutPreset = 'standard' | 'left-tower-overlay';
export type CameraControlsMode = 'embedded' | 'external' | false;
export type PaddockPresetName = 'dashboard' | 'timing-overlay' | 'compact-race' | 'full-dashboard';
export type TelemetryModuleName = 'core' | 'sectors' | 'lapTimes' | 'sectorTimes';
export type SectorPerformanceStatus = 'overall-best' | 'personal-best' | 'slower';
export type PaddockParticipantInteractionProfile =
  | 'normal'
  | 'isolated-training'
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

export interface CustomField {
  label: string;
  value: string;
}

export type CustomFieldInput = CustomField[] | Record<string, string>;

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
  customFields?: CustomFieldInput;
  team?: TeamData | null;
  driverNumber?: number;
}

export interface DriverRatings {
  pace: number;
  racecraft: number;
  aggression: number;
  riskTolerance: number;
  patience: number;
  consistency: number;
}

export interface VehicleRatings {
  power: number;
  braking: number;
  aero: number;
  dragEfficiency: number;
  mechanicalGrip: number;
  weightControl: number;
  tireCare: number;
}

export interface DriverBlueprint extends Partial<DriverRatings> {
  customFields?: CustomFieldInput;
}

export interface VehicleBlueprint extends Partial<VehicleRatings> {
  id?: string | null;
  name?: string | null;
  customFields?: CustomFieldInput;
}

export interface DriverConstructorArgs {
  ratings: DriverRatings;
  customFields: CustomField[];
  pace: number;
  racecraft: number;
  consistency: number;
  personality: {
    aggression: number;
    riskTolerance: number;
    patience: number;
  };
}

export interface VehicleConstructorArgs {
  id: string | null;
  name: string | null;
  ratings: VehicleRatings;
  customFields: CustomField[];
  powerNewtons: number;
  brakeNewtons: number;
  downforceCoefficient: number;
  dragCoefficient: number;
  tireGrip: number;
  mass: number;
  tireCare: number;
}

export class DriverData {
  constructor(input?: DriverBlueprint);
  readonly pace: number;
  readonly racecraft: number;
  readonly aggression: number;
  readonly riskTolerance: number;
  readonly patience: number;
  readonly consistency: number;
  readonly customFields: CustomField[];
  ratings(): DriverRatings;
  toConstructorArgs(): DriverConstructorArgs;
}

export class VehicleData {
  constructor(input?: VehicleBlueprint);
  readonly id: string | null;
  readonly name: string | null;
  readonly power: number;
  readonly braking: number;
  readonly aero: number;
  readonly dragEfficiency: number;
  readonly mechanicalGrip: number;
  readonly weightControl: number;
  readonly tireCare: number;
  readonly customFields: CustomField[];
  ratings(): VehicleRatings;
  toConstructorArgs(): VehicleConstructorArgs;
}

export interface ChampionshipEntryBlueprint {
  driverId: string;
  driverNumber?: number;
  timingName?: string;
  driver?: DriverData | DriverBlueprint;
  vehicle?: VehicleData | VehicleBlueprint;
  team?: TeamData;
}

export interface NormalizedSimulatorDriver extends SimulatorDriver {
  code: string;
  timingCode: string;
  raceName: string;
  driverNumber: number;
  team: TeamData | null;
  pace: number;
  racecraft: number;
  consistency: number;
  personality: DriverConstructorArgs['personality'];
  vehicle: VehicleConstructorArgs;
  constructorArgs: {
    driver: DriverConstructorArgs;
    vehicle: VehicleConstructorArgs;
  };
  championship: {
    id: string;
    name: string;
    season: number;
    entryIndex: number;
    vehicleId: string | null;
  };
}

export interface F1SimulatorTheme {
  accentColor?: string;
  greenColor?: string;
  yellowColor?: string;
  timingTowerMaxWidth?: string;
  raceViewMinHeight?: string;
}

export interface F1SimulatorUiOptions {
  layoutPreset?: LayoutPreset;
  cameraControls?: CameraControlsMode;
  showFps?: boolean;
  showTimingTower?: boolean;
  showTelemetry?: boolean;
  telemetryIncludesOverview?: boolean;
  telemetryModules?: boolean | TelemetryModuleName[] | Partial<Record<TelemetryModuleName, boolean>>;
  showRaceDataPanel?: boolean;
  raceDataBanners?: {
    initial?: RaceBannerMode;
    enabled?: true | false | RaceBannerEnabledMode[];
  };
  raceDataBannerSize?: RaceDataBannerSize;
  raceDataTelemetryDetail?: boolean;
  penaltyBanners?: boolean;
  timingPenaltyBadges?: boolean;
  simulationSpeedControl?: boolean;
  timingTowerVerticalFit?: TimingTowerVerticalFit;
}

export interface TrackTextureAssets {
  asphalt?: string;
}

export interface F1SimulatorAssets {
  car?: string;
  carOverview?: string;
  driverHelmet?: string;
  safetyCar?: string;
  broadcastPanel?: string;
  f1Logo?: string;
  trackTextures?: TrackTextureAssets;
}

export interface TrackSnapshot {
  seed?: number | null;
  width?: number;
  length?: number;
  sectors?: TrackSectorSnapshot[];
  pitLane?: PitLaneSnapshot;
  [key: string]: unknown;
}

export interface TrackPointSnapshot {
  x: number;
  y: number;
  heading?: number;
  distance?: number;
}

export interface PitLaneSnapshot {
  enabled: boolean;
  side: -1 | 1;
  width: number;
  offset?: number;
  boxCount: number;
  teamCount: number;
  boxesPerTeam: number;
  entry: {
    trackDistance: number;
    distanceFromStart: number;
    trackPoint: TrackPointSnapshot;
    edgePoint: TrackPointSnapshot;
    trackConnectPoint: TrackPointSnapshot;
    lanePoint: TrackPointSnapshot;
    roadCenterline: TrackPointSnapshot[];
    connector: TrackPointSnapshot[];
  };
  exit: {
    trackDistance: number;
    distanceFromStart: number;
    trackPoint: TrackPointSnapshot;
    edgePoint: TrackPointSnapshot;
    trackConnectPoint: TrackPointSnapshot;
    lanePoint: TrackPointSnapshot;
    roadCenterline: TrackPointSnapshot[];
    connector: TrackPointSnapshot[];
  };
  mainLane: {
    start: TrackPointSnapshot;
    end: TrackPointSnapshot;
    points: TrackPointSnapshot[];
    length: number;
    heading: number;
  };
  fastLane?: {
    offset: number;
    width: number;
  };
  workingLane?: {
    start: TrackPointSnapshot;
    end: TrackPointSnapshot;
    points: TrackPointSnapshot[];
    offset: number;
    width: number;
  };
  serviceNormal: { x: number; y: number };
  teams?: PitTeamSnapshot[];
  boxes: PitBoxSnapshot[];
  serviceAreas?: PitServiceAreaSnapshot[];
}

export interface PitTeamSnapshot {
  id: string;
  name: string;
  color: string;
  index: number;
  boxIds: string[];
  serviceAreaId?: string | null;
}

export interface PitBoxSnapshot {
  id: string;
  index: number;
  teamIndex: number;
  teamBoxIndex: number;
  teamId?: string;
  teamName?: string;
  teamColor?: string;
  distanceAlongLane: number;
  laneTarget: TrackPointSnapshot;
  center: TrackPointSnapshot;
  length: number;
  depth: number;
  corners: TrackPointSnapshot[];
}

export interface PitServiceAreaSnapshot {
  id: string;
  index: number;
  teamIndex: number;
  teamId?: string;
  teamName?: string;
  teamColor?: string;
  distanceAlongLane: number;
  queueDistanceAlongLane: number;
  laneTarget: TrackPointSnapshot;
  center: TrackPointSnapshot;
  queuePoint: TrackPointSnapshot;
  length: number;
  depth: number;
  corners: TrackPointSnapshot[];
  queueCorners: TrackPointSnapshot[];
  garageBoxIds: string[];
}

export interface TrackSectorSnapshot {
  index: number;
  id: string;
  label: string;
  start: number;
  end: number;
  startRatio: number;
  endRatio: number;
  length: number;
}

export interface LapTelemetrySnapshot {
  currentLap: number;
  currentSector: number;
  currentLapTime: number | null;
  currentSectorElapsed: number | null;
  currentSectorProgress: number | null;
  currentSectors: Array<number | null>;
  sectorProgress: Array<number | null>;
  liveSectors: Array<number | null>;
  sectorPerformance: {
    current: Array<SectorPerformanceStatus | null>;
    last: Array<SectorPerformanceStatus | null>;
    best: Array<SectorPerformanceStatus | null>;
  };
  lastLapTime: number | null;
  bestLapTime: number | null;
  lastSectors: Array<number | null>;
  bestSectors: Array<number | null>;
  completedLaps: number;
}

export interface PitStopSnapshot {
  status: 'pending' | 'entering' | 'queued' | 'servicing' | 'exiting' | 'completed';
  intent: PaddockPitIntent;
  phase: 'entry' | 'queue' | 'queue-release' | 'penalty' | 'service' | 'exit' | null;
  boxIndex: number;
  boxId: string;
  garageBoxIndex?: number | null;
  garageBoxId?: string | null;
  teamId?: string | null;
  teamColor?: string | null;
  stopsCompleted: number;
  queueingForService?: boolean;
  plannedRaceDistance: number | null;
  entryRaceDistance: number | null;
  serviceRemainingSeconds: number | null;
  penaltyServiceRemainingSeconds: number | null;
  penaltyServiceTotalSeconds: number | null;
  servingPenaltyIds: string[];
  targetTire?: TireCompound | string | null;
  serviceProfile?: {
    baseSeconds: number;
    seconds: number;
    perfect: boolean;
    variabilityEnabled: boolean;
    teamId?: string | null;
    pitCrew: Required<PaddockPitCrewStats>;
    speedDeltaSeconds: number;
    consistencyDeltaSeconds: number;
    issueDelaySeconds: number;
    issue?: string | null;
  } | null;
}

export interface RaceEvent {
  type: string;
  at?: number;
  firstShapeId?: string;
  secondShapeId?: string;
  contactType?: 'body-body' | 'body-wheel' | 'wheel-body' | 'wheel-wheel' | string;
  depth?: number;
  timeOfImpact?: number;
  [key: string]: unknown;
}

export type PaddockRulesetName = 'paddock' | 'custom' | 'grandPrix2025' | 'fia2025';

export interface PaddockPitStopRules {
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
  maxConcurrentPitLaneCars?: number;
  minimumPitLaneGapMeters?: number;
  doubleStacking?: boolean;
  tirePitRequestThresholdPercent?: number;
  tirePitCommitThresholdPercent?: number;
}

export interface PaddockTireStrategyRules {
  enabled?: boolean;
  compounds?: TireCompound[];
  mandatoryDistinctDryCompounds?: number | null;
}

export interface PaddockTireDegradationRules {
  enabled?: boolean;
}

export interface PaddockPenaltySubsectionRules {
  strictness?: number;
  timePenaltySeconds?: number;
  consequences?: PaddockPenaltyConsequence[];
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

export interface PaddockTrackLimitPenaltyRules extends PaddockPenaltySubsectionRules {
  warningsBeforePenalty?: number;
  relaxedMarginMeters?: number;
}

export interface PaddockCollisionPenaltyRules extends PaddockPenaltySubsectionRules {
  minimumSeverity?: number;
  relaxedSeverityMargin?: number;
  minimumImpactSpeedKph?: number;
  relaxedImpactSpeedKph?: number;
}

export interface PaddockPitLaneSpeedingPenaltyRules extends PaddockPenaltySubsectionRules {
  speedLimitKph?: number;
  marginKph?: number;
  relaxedMarginKph?: number;
}

export interface PaddockPenaltyRules {
  enabled?: boolean;
  stewardStrictness?: number;
  trackLimits?: PaddockTrackLimitPenaltyRules;
  collision?: PaddockCollisionPenaltyRules;
  tireRequirement?: PaddockPenaltySubsectionRules;
  pitLaneSpeeding?: PaddockPitLaneSpeedingPenaltyRules;
}

export interface PaddockRaceModules {
  pitStops?: PaddockPitStopRules;
  tireStrategy?: PaddockTireStrategyRules;
  tireDegradation?: PaddockTireDegradationRules;
  penalties?: PaddockPenaltyRules;
  weather?: { enabled?: boolean };
  reliability?: { enabled?: boolean };
  fuelLoad?: { enabled?: boolean };
}

export interface PaddockRaceRules {
  ruleset?: PaddockRulesetName;
  profile?: PaddockRulesetName;
  modules?: PaddockRaceModules;
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

export interface WheelSurfaceSnapshot {
  id: string;
  x: number;
  y: number;
  signedOffset: number;
  crossTrackError: number;
  surface: string;
  onTrack: boolean;
  inPitLane: boolean;
  fullyOutsideWhiteLine: boolean;
}

export interface CarSnapshot {
  id: string;
  rank: number | null;
  code: string;
  timingCode: string;
  name: string;
  color: string;
  tire: TireCompound;
  interaction?: PaddockParticipantInteraction;
  lap: number;
  speedKph: number;
  finishRank?: number | null;
  status?: 'racing' | 'waved-flag' | string;
  raceStatus?: 'racing' | 'waved-flag' | string;
  wavedFlag?: boolean;
  finished?: boolean;
  finishTime?: number | null;
  penaltySeconds?: number;
  adjustedFinishTime?: number | null;
  classifiedRank?: number | null;
  intervalAheadSeconds?: number | null;
  leaderGapSeconds?: number | null;
  gapAheadLaps?: number;
  intervalAheadLaps?: number;
  leaderGapLaps?: number;
  lapTelemetry?: LapTelemetrySnapshot;
  surface?: string;
  signedOffset?: number;
  crossTrackError?: number;
  inPitLane?: boolean;
  wheels?: WheelSurfaceSnapshot[];
  pitLanePart?: 'entry' | 'fast-lane' | 'working-lane' | 'exit' | 'service-box' | 'garage-box' | null;
  pitBoxId?: string | null;
  pitLaneCrossTrackError?: number | null;
  usedTireCompounds?: Array<TireCompound | string>;
  pitIntent?: PaddockPitIntent;
  pitStop?: PitStopSnapshot | null;
  [key: string]: unknown;
}

export interface RaceClassificationEntry {
  id: string;
  rank: number;
  code: string;
  lap: number;
  finished: boolean;
  finishTime?: number | null;
  penaltySeconds?: number;
  adjustedFinishTime?: number | null;
  gapLaps?: number;
  intervalLaps?: number;
  positionDrop?: number;
  disqualified?: boolean;
  [key: string]: unknown;
}

export interface RaceSnapshot {
  time: number;
  world: {
    width: number;
    height: number;
    [key: string]: unknown;
  };
  track: TrackSnapshot;
  totalLaps: number;
  raceControl: {
    mode: string;
    redFlag: boolean;
    pitLaneOpen: boolean;
    pitLaneStatus?: {
      enabled: boolean;
      open: boolean;
      reason: string;
      color: string;
      light: string;
    };
    finished: boolean;
    finishedAt: number | null;
    winner: CarSnapshot | null;
    classification: RaceClassificationEntry[];
    start: {
      visible: boolean;
      [key: string]: unknown;
    };
  };
  pitLaneStatus?: {
    enabled: boolean;
    open: boolean;
    reason: string;
    color: string;
    light: string;
  };
  safetyCar: {
    deployed: boolean;
    [key: string]: unknown;
  };
  rules: PaddockRaceRules;
  events: RaceEvent[];
  penalties: PaddockPenaltyEntry[];
  cars: CarSnapshot[];
  replayGhosts: PaddockReplayGhostSnapshot[];
}

export interface LifecycleErrorContext {
  phase?: string;
  callback?: string;
}

export interface F1SimulatorCallbacks {
  onDriverOpen?: (driver: NormalizedSimulatorDriver) => void;
  onLoadingChange?: (state: { loading: boolean; phase: string }) => void;
  onReady?: (payload: { snapshot: RaceSnapshot }) => void;
  onError?: (error: unknown, context: LifecycleErrorContext) => void;
  onDriverSelect?: (driver: NormalizedSimulatorDriver, snapshot: RaceSnapshot) => void;
  onRaceEvent?: (event: RaceEvent, snapshot: RaceSnapshot) => void;
  onLapChange?: (payload: {
    previousLeaderLap: number | null;
    leaderLap: number;
    leader: CarSnapshot | null;
    snapshot: RaceSnapshot;
  }) => void;
  onRaceFinish?: (payload: {
    winner: CarSnapshot | null;
    classification: RaceClassificationEntry[];
    snapshot: RaceSnapshot;
  }) => void;
}

export interface F1SimulatorExpertOptions {
  enabled: boolean;
  controlledDrivers: string[];
  frameSkip?: number;
  visualizeSensors?: boolean | {
    rays?: boolean;
  };
}

export interface F1SimulatorExpertAction {
  steering: number;
  throttle: number;
  brake: number;
  pitIntent?: PaddockPitIntent;
  pitCompound?: TireCompound | string;
  pitTargetCompound?: TireCompound | string;
}

export interface F1SimulatorExpertApi {
  reset(options?: unknown): unknown;
  step(actions: Record<string, F1SimulatorExpertAction>): unknown;
  getObservation(): unknown;
  getState(): unknown;
  getActionSpec(): PaddockActionSpec;
  getObservationSpec(): PaddockObservationSpec;
  destroy(): void;
}

export interface F1SimulatorOptions extends F1SimulatorCallbacks {
  preset?: PaddockPresetName;
  drivers: SimulatorDriver[];
  entries?: ChampionshipEntryBlueprint[];
  seed?: number;
  trackSeed?: number;
  totalLaps?: number;
  rules?: PaddockRaceRules;
  participantInteractions?: PaddockParticipantInteractionsOptions;
  replayGhosts?: PaddockReplayGhostOptions[];
  initialCameraMode?: CameraMode;
  theme?: F1SimulatorTheme;
  title?: string;
  kicker?: string;
  backLinkHref?: string;
  backLinkLabel?: string;
  showBackLink?: boolean;
  ui?: F1SimulatorUiOptions;
  assets?: F1SimulatorAssets;
  expert?: F1SimulatorExpertOptions;
}

export type F1SimulatorRestartOptions = Partial<Omit<F1SimulatorOptions, 'assets' | 'expert'>>;

export interface MountRaceCanvasOptions {
  includeRaceDataPanel?: boolean;
  includeTimingTower?: boolean;
  includeTelemetrySectorBanner?: boolean;
  timingTowerVerticalFit?: TimingTowerVerticalFit;
}

export interface MountTelemetryPanelOptions {
  includeOverview?: boolean;
}

export interface MountRaceTelemetryDrawerOptions {
  timingTowerVerticalFit?: TimingTowerVerticalFit;
  drawerInitiallyOpen?: boolean;
  raceDataTelemetryDetail?: boolean;
}

export interface F1MountedSimulator {
  readonly expert: F1SimulatorExpertApi | null;
  destroy(): void;
  restart(nextOptions?: F1SimulatorRestartOptions): void;
  selectDriver(driverId: string): void;
  setSafetyCarDeployed(deployed: boolean): void;
  setRedFlagDeployed(deployed: boolean): void;
  setPitLaneOpen(open: boolean): void;
  callSafetyCar(): void;
  clearSafetyCar(): void;
  toggleSafetyCar(): void;
  setPitIntent(driverId: string, intent: PaddockPitIntentRequest, targetCompound?: TireCompound | string): boolean;
  getPitIntent(driverId: string): PaddockPitIntent;
  getPitTargetCompound(driverId: string): TireCompound | string | null;
  servePenalty(penaltyId: string): PaddockPenaltyEntry | null;
  cancelPenalty(penaltyId: string): PaddockPenaltyEntry | null;
  getSnapshot(): RaceSnapshot | null;
}

export interface PaddockSimulatorController {
  readonly expert: F1SimulatorExpertApi | null;
  mountRaceControls<T extends Element>(root: T): T;
  mountCameraControls<T extends Element>(root: T): T;
  mountSafetyCarControl<T extends Element>(root: T): T;
  mountTimingTower<T extends Element>(root: T): T;
  mountRaceCanvas<T extends Element>(root: T, options?: MountRaceCanvasOptions): T;
  mountTelemetryPanel<T extends Element>(root: T, options?: MountTelemetryPanelOptions): T;
  mountTelemetryCore<T extends Element>(root: T): T;
  mountTelemetrySectors<T extends Element>(root: T): T;
  mountTelemetrySectorBanner<T extends Element>(root: T): T;
  mountTelemetryLapTimes<T extends Element>(root: T): T;
  mountTelemetrySectorTimes<T extends Element>(root: T): T;
  mountRaceTelemetryDrawer<T extends Element>(root: T, options?: MountRaceTelemetryDrawerOptions): T;
  mountCarDriverOverview<T extends Element>(root: T): T;
  mountRaceDataPanel<T extends Element>(root: T): T;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Element[];
  start(): Promise<PaddockSimulatorController>;
  destroy(): void;
  restart(nextOptions?: F1SimulatorRestartOptions): void;
  selectDriver(driverId: string): void;
  setSafetyCarDeployed(deployed: boolean): void;
  setRedFlagDeployed(deployed: boolean): void;
  setPitLaneOpen(open: boolean): void;
  callSafetyCar(): void;
  clearSafetyCar(): void;
  toggleSafetyCar(): void;
  setPitIntent(driverId: string, intent: PaddockPitIntentRequest, targetCompound?: TireCompound | string): boolean;
  getPitIntent(driverId: string): PaddockPitIntent;
  getPitTargetCompound(driverId: string): TireCompound | string | null;
  servePenalty(penaltyId: string): PaddockPenaltyEntry | null;
  cancelPenalty(penaltyId: string): PaddockPenaltyEntry | null;
  getSnapshot(): RaceSnapshot | null;
}

export const CHAMPIONSHIP_ENTRY_BLUEPRINTS: ChampionshipEntryBlueprint[];
export const DEMO_PROJECT_DRIVERS: SimulatorDriver[];
export const DEFAULT_F1_SIMULATOR_ASSETS: Required<F1SimulatorAssets>;
export const PADDOCK_SIMULATOR_PRESETS: Record<PaddockPresetName, {
  ui?: F1SimulatorUiOptions;
  theme?: F1SimulatorTheme;
}>;

export const REAL_F1_CAR_LENGTH_METERS: number;
export const SIM_UNITS_PER_METER: number;
export const TARGET_F1_TOP_SPEED_KPH: number;
export const VISUAL_CAR_LENGTH_METERS: number;

export function buildChampionshipDriverGrid(
  drivers?: SimulatorDriver[],
  entries?: ChampionshipEntryBlueprint[],
): NormalizedSimulatorDriver[];
export function formatDriverNumber(driverNumber: number | string | null | undefined): string;
export function normalizeSimulatorDrivers(
  drivers: SimulatorDriver[],
  options?: { entries?: ChampionshipEntryBlueprint[]; caller?: string },
): NormalizedSimulatorDriver[];

export function metersToSimUnits(meters: number): number;
export function simUnitsToMeters(simUnits: number): number;
export function kphToSimSpeed(kph: number): number;
export function simSpeedToKph(simSpeed: number): number;
export function simSpeedToMetersPerSecond(simSpeed: number): number;

export function createPaddockSimulator(options: F1SimulatorOptions): PaddockSimulatorController;
export function mountF1Simulator(root: Element, options: F1SimulatorOptions): Promise<F1MountedSimulator>;

export function mountRaceControls<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountCameraControls<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountSafetyCarControl<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountTimingTower<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountRaceCanvas<T extends Element>(
  root: T,
  simulator: PaddockSimulatorController,
  options?: MountRaceCanvasOptions,
): T;
export function mountTelemetryPanel<T extends Element>(
  root: T,
  simulator: PaddockSimulatorController,
  options?: MountTelemetryPanelOptions,
): T;
export function mountTelemetryCore<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountTelemetrySectors<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountTelemetrySectorBanner<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountTelemetryLapTimes<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountTelemetrySectorTimes<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountRaceTelemetryDrawer<T extends Element>(
  root: T,
  simulator: PaddockSimulatorController,
  options?: MountRaceTelemetryDrawerOptions,
): T;
export function mountCarDriverOverview<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
export function mountRaceDataPanel<T extends Element>(root: T, simulator: PaddockSimulatorController): T;
