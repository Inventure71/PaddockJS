export type TireCompound = 'S' | 'M' | 'H';
export type CameraMode = 'overview' | 'leader' | 'selected';
export type RaceBannerMode = 'project' | 'radio' | 'hidden';
export type RaceBannerEnabledMode = 'project' | 'radio';
export type RaceDataBannerSize = 'auto' | 'custom';
export type TimingTowerVerticalFit = 'expand-race-view' | 'scroll';
export type LayoutPreset = 'standard' | 'left-tower-overlay';
export type CameraControlsMode = 'embedded' | 'external' | false;
export type PaddockPresetName = 'dashboard' | 'timing-overlay' | 'compact-race' | 'full-dashboard';
export type TelemetryModuleName = 'core' | 'sectors' | 'lapTimes' | 'sectorTimes';
export type SectorPerformanceStatus = 'overall-best' | 'personal-best' | 'slower';

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
  [key: string]: unknown;
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

export interface RaceEvent {
  type: string;
  at?: number;
  [key: string]: unknown;
}

export interface CarSnapshot {
  id: string;
  rank: number;
  code: string;
  timingCode: string;
  name: string;
  color: string;
  tire: TireCompound;
  lap: number;
  speedKph: number;
  finished?: boolean;
  finishTime?: number | null;
  classifiedRank?: number | null;
  intervalAheadSeconds?: number | null;
  leaderGapSeconds?: number | null;
  lapTelemetry?: LapTelemetrySnapshot;
  [key: string]: unknown;
}

export interface RaceClassificationEntry {
  id: string;
  rank: number;
  code: string;
  lap: number;
  finished: boolean;
  finishTime?: number | null;
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
    finished: boolean;
    finishedAt: number | null;
    winner: CarSnapshot | null;
    classification: RaceClassificationEntry[];
    start: {
      visible: boolean;
      [key: string]: unknown;
    };
  };
  safetyCar: {
    deployed: boolean;
    [key: string]: unknown;
  };
  rules: Record<string, unknown>;
  events: RaceEvent[];
  cars: CarSnapshot[];
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
  onDriverSelect?: (driver: CarSnapshot, snapshot: RaceSnapshot) => void;
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

export interface F1SimulatorOptions extends F1SimulatorCallbacks {
  preset?: PaddockPresetName;
  drivers: SimulatorDriver[];
  entries?: ChampionshipEntryBlueprint[];
  seed?: number;
  trackSeed?: number;
  totalLaps?: number;
  initialCameraMode?: CameraMode;
  theme?: F1SimulatorTheme;
  title?: string;
  kicker?: string;
  backLinkHref?: string;
  backLinkLabel?: string;
  showBackLink?: boolean;
  ui?: F1SimulatorUiOptions;
  assets?: F1SimulatorAssets;
}

export type F1SimulatorRestartOptions = Partial<Omit<F1SimulatorOptions, 'assets'>>;

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
}

export interface F1MountedSimulator {
  destroy(): void;
  restart(nextOptions?: F1SimulatorRestartOptions): void;
  selectDriver(driverId: string): void;
  setSafetyCarDeployed(deployed: boolean): void;
  callSafetyCar(): void;
  clearSafetyCar(): void;
  toggleSafetyCar(): void;
  getSnapshot(): RaceSnapshot | null;
}

export interface PaddockSimulatorController {
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
  callSafetyCar(): void;
  clearSafetyCar(): void;
  toggleSafetyCar(): void;
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
  options?: { entries?: ChampionshipEntryBlueprint[] },
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
