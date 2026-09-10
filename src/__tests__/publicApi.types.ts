import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEFAULT_PADDOCK_THEME,
  DEMO_PROJECT_DRIVERS,
  DriverData,
  PADDOCK_THEME_CSS_VARIABLES,
  PADDOCK_THEME_TOKEN_KEYS,
  VehicleData,
  applyPaddockTheme,
  buildChampionshipDriverGrid,
  createProceduralTrack,
  createPaddockDriverControllerLoop,
  createPaddockSimulator,
  kphToSimSpeed,
  metersToSimUnits,
  mountRaceTelemetryDrawer,
  mountF1Simulator,
  mountTelemetryCore,
  mountTelemetryLapTimes,
  mountTelemetrySectorBanner,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  normalizeSimulatorDrivers,
  resolvePaddockTheme,
  simSpeedToKph,
  type CarSnapshot,
  type ChampionshipEntryBlueprint,
  type F1MountedSimulator,
  type F1SimulatorExpertApi,
  type F1SimulatorOptions,
  type NormalizedSimulatorDriver,
  type PaddockEnvironmentResult,
  type PaddockResolvedProceduralTrackOptions,
  type PaddockThemeTokenValue,
  type PaddockThemeSelector,
  type PaddockPitCrewStats,
  type TeamData,
  type PaddockProceduralTrack,
  type F1SimulatorTheme,
  type PaddockDriverController,
  type ResolvedPaddockTheme,
  type PaddockSimulatorController,
  type RaceSnapshot,
  type SectorPerformanceStatus,
  type TimingGapMode,
  type PaddockParticipantInteractionProfile,
  type PaddockParticipantInteraction,
  type PaddockParticipantInteractionOverride,
  type PaddockParticipantInteractionsOptions,
  type PaddockReplayGhostTrajectorySample,
  type PaddockReplayGhostOptions,
  type PaddockReplayGhostSnapshot,
} from '../index.js';
import {
  DriverData as DataSubpathDriverData,
  VehicleData as DataSubpathVehicleData,
  buildChampionshipDriverGrid as buildDataSubpathDriverGrid,
  createProceduralTrack as createDataSubpathProceduralTrack,
  formatDriverNumber as formatDataSubpathDriverNumber,
  kphToSimSpeed as dataSubpathKphToSimSpeed,
  normalizeSimulatorDrivers as normalizeDataSubpathDrivers,
  simSpeedToKph as dataSubpathSimSpeedToKph,
  type PaddockResolvedProceduralTrackOptions as DataSubpathResolvedProceduralTrackOptions,
  type PaddockThemeSelector as DataSubpathThemeSelector,
  type PaddockPitCrewStats as DataSubpathPitCrewStats,
  type TeamData as DataSubpathTeamData,
} from '../data/index.js';
import {
  createPaddockDriverControllerLoop as createEnvironmentDriverControllerLoop,
  createEnvironmentWorkerProtocol,
  createPaddockEnvironment,
  createProgressReward,
  createRolloutRecorder,
  runEnvironmentEvaluation,
  type PaddockDriverObservationObject,
  type PaddockParticipantInteractionProfile as EnvPaddockParticipantInteractionProfile,
  type PaddockParticipantInteraction as EnvPaddockParticipantInteraction,
  type PaddockParticipantInteractionOverride as EnvPaddockParticipantInteractionOverride,
  type PaddockParticipantInteractionsOptions as EnvPaddockParticipantInteractionsOptions,
  type PaddockReplayGhostTrajectorySample as EnvPaddockReplayGhostTrajectorySample,
  type PaddockReplayGhostOptions as EnvPaddockReplayGhostOptions,
  type PaddockReplayGhostSnapshot as EnvPaddockReplayGhostSnapshot,
  type PaddockResolvedProceduralTrackOptions as EnvPaddockResolvedProceduralTrackOptions,
  type PaddockPitCrewStats as EnvPaddockPitCrewStats,
  type PaddockThemeSelector as EnvPaddockThemeSelector,
  type TeamData as EnvTeamData,
} from '../environment/index.js';
import {
  createPaddockLoadingPlaceholder,
  type PaddockLoadingPlaceholderOptions,
  type PaddockLoadingPlaceholderVariant,
} from '../placeholder/index.js';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

type _RootEnvParityInteractionProfile = AssertTrue<
  IsEqual<PaddockParticipantInteractionProfile, EnvPaddockParticipantInteractionProfile>
>;
type _RootEnvParityInteraction = AssertTrue<
  IsEqual<PaddockParticipantInteraction, EnvPaddockParticipantInteraction>
>;
type _RootEnvParityInteractionOverride = AssertTrue<
  IsEqual<PaddockParticipantInteractionOverride, EnvPaddockParticipantInteractionOverride>
>;
type _RootEnvParityInteractionOptions = AssertTrue<
  IsEqual<PaddockParticipantInteractionsOptions, EnvPaddockParticipantInteractionsOptions>
>;
type _RootEnvParityReplayTrajectory = AssertTrue<
  IsEqual<PaddockReplayGhostTrajectorySample, EnvPaddockReplayGhostTrajectorySample>
>;
type _RootEnvParityReplayOptions = AssertTrue<
  IsEqual<PaddockReplayGhostOptions, EnvPaddockReplayGhostOptions>
>;
type _RootEnvParityReplaySnapshot = AssertTrue<
  IsEqual<PaddockReplayGhostSnapshot, EnvPaddockReplayGhostSnapshot>
>;
type _RootDataParityResolvedTrackOptions = AssertTrue<
  IsEqual<PaddockResolvedProceduralTrackOptions, DataSubpathResolvedProceduralTrackOptions>
>;
type _RootEnvParityResolvedTrackOptions = AssertTrue<
  IsEqual<PaddockResolvedProceduralTrackOptions, EnvPaddockResolvedProceduralTrackOptions>
>;
type _RootDataParityThemeSelector = AssertTrue<
  IsEqual<PaddockThemeSelector, DataSubpathThemeSelector>
>;
type _RootDataParityPitCrewStats = AssertTrue<
  IsEqual<PaddockPitCrewStats, DataSubpathPitCrewStats>
>;
type _RootEnvParityPitCrewStats = AssertTrue<
  IsEqual<PaddockPitCrewStats, EnvPaddockPitCrewStats>
>;
type _RootEnvParityThemeSelector = AssertTrue<
  IsEqual<PaddockThemeSelector, EnvPaddockThemeSelector>
>;
type _RootDataParityTeamData = AssertTrue<
  IsEqual<TeamData, DataSubpathTeamData>
>;
type _RootEnvParityTeamData = AssertTrue<
  IsEqual<TeamData, EnvTeamData>
>;

const environmentThemedTeam: EnvTeamData = {
  id: 'typed-team',
  theme: 'team:typed-team',
  pitCrew: {
    speed: 75,
    consistency: 80,
    reliability: 85,
  },
};
const dataTeamFromEnvironment: DataSubpathTeamData = environmentThemedTeam;
const rootTeamFromData: TeamData = dataTeamFromEnvironment;
const environmentTeamFromRoot: EnvTeamData = rootTeamFromData;
const dataThemeSelector: DataSubpathThemeSelector = 'selectedTeam';
const rootThemeSelector: PaddockThemeSelector = dataThemeSelector;
const environmentThemeSelector: EnvPaddockThemeSelector = rootThemeSelector;

void environmentThemedTeam;
void dataTeamFromEnvironment;
void rootTeamFromData;
void environmentTeamFromRoot;
void rootThemeSelector;
void environmentThemeSelector;

// @ts-expect-error Theme tokens are CSS strings; numeric values would produce invalid runtime CSS.
const invalidNumericThemeToken: PaddockThemeTokenValue = 720;
void invalidNumericThemeToken;

const root = document.createElement('div');

const resolvedPublicTheme: ResolvedPaddockTheme = resolvePaddockTheme({
  ...DEFAULT_PADDOCK_THEME,
  mode: 'light',
  tokens: { primary: '#123456' },
});
const resolvedPublicThemeMode: 'light' | 'dark' = resolvedPublicTheme.activeMode;
const resolvedPublicThemePrimary: PaddockThemeTokenValue | undefined = resolvedPublicTheme.activeTokens.primary;
const themeTokenKeys: readonly string[] = PADDOCK_THEME_TOKEN_KEYS;
const primaryCssVariable: string = PADDOCK_THEME_CSS_VARIABLES.primary;
applyPaddockTheme(root, resolvedPublicTheme);
void resolvedPublicThemeMode;
void resolvedPublicThemePrimary;
void themeTokenKeys;
void primaryCssVariable;

const placeholderVariant: PaddockLoadingPlaceholderVariant = 'lights';
const placeholderOptions: PaddockLoadingPlaceholderOptions = {
  label: 'Loading simulator',
  detail: 'Preparing race',
  variant: placeholderVariant,
  attributes: { 'data-host': 'typed' },
};
const placeholderHtml: string = createPaddockLoadingPlaceholder(placeholderOptions);
void placeholderHtml;

const drivers = normalizeSimulatorDrivers(DEMO_PROJECT_DRIVERS, {
  entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
});
const dataSubpathDrivers = normalizeDataSubpathDrivers(DEMO_PROJECT_DRIVERS, {
  entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
});
const dataSubpathGrid = buildDataSubpathDriverGrid(dataSubpathDrivers, CHAMPIONSHIP_ENTRY_BLUEPRINTS);
const dataSubpathDriver = new DataSubpathDriverData({ pace: 70, driverModel: { id: 'driver-policy' } });
const dataSubpathVehicle = new DataSubpathVehicleData({ id: 'typed-data-car', name: 'Typed Data Car', driverModel: 'vehicle-policy' });
const dataSubpathTrack: PaddockProceduralTrack = createDataSubpathProceduralTrack(7101);
const dataSubpathTrackSampleCount: number = dataSubpathTrack.sampleCount;
const dataSubpathResolvedLengthMin: number | undefined = dataSubpathTrack.generationOptions?.length.min;
const dataSubpathResolvedCacheKey: string | undefined = dataSubpathTrack.generationOptions?.cacheKey;
// @ts-expect-error Runtime stores resolved sim-unit fields, not the caller-facing meter option names.
const invalidResolvedLengthMeters = dataSubpathTrack.generationOptions?.length.minMeters;
const dataSubpathNumber: string = formatDataSubpathDriverNumber(71);
const dataSubpathSpeed: number = dataSubpathSimSpeedToKph(dataSubpathKphToSimSpeed(180));
void dataSubpathGrid;
void dataSubpathDriver;
void dataSubpathVehicle;
void dataSubpathTrack;
void dataSubpathTrackSampleCount;
void dataSubpathResolvedLengthMin;
void dataSubpathResolvedCacheKey;
void invalidResolvedLengthMeters;
void dataSubpathNumber;
void dataSubpathSpeed;

const typedDrivers: NormalizedSimulatorDriver[] = buildChampionshipDriverGrid(drivers, CHAMPIONSHIP_ENTRY_BLUEPRINTS);
const leader: CarSnapshot | undefined = typedDrivers.length > 0
  ? {
      id: typedDrivers[0].id,
      rank: 1,
      code: typedDrivers[0].code,
      timingCode: typedDrivers[0].timingCode,
      name: typedDrivers[0].name,
      color: typedDrivers[0].color,
      tire: 'M',
      lap: 1,
      speedKph: 280,
    }
  : undefined;

const extraEntry: ChampionshipEntryBlueprint = {
  driverId: 'typed-entry',
  driverNumber: 99,
  timingName: 'Typed',
  driver: new DriverData({ pace: 70 }),
  vehicle: new VehicleData({ id: 'typed-car', name: 'Typed Car', power: 72 }),
  team: { id: 'alpha', name: 'Alpha Team', theme: 'contrast' },
};

const options: F1SimulatorOptions = {
  preset: 'timing-overlay',
  drivers: DEMO_PROJECT_DRIVERS,
  entries: [...CHAMPIONSHIP_ENTRY_BLUEPRINTS, extraEntry],
  initialCameraMode: 'show-all',
  physicsMode: 'advanced',
  warmup: {
    enabled: true,
    policy: 'config-change',
    steps: 16,
  },
  trackGeneration: {
    profile: 'training-short',
    length: { minMeters: 900, maxMeters: 1800 },
    startStraight: { gridMeters: 0, exitMeters: 80, blendMeters: 80 },
    pitLane: { enabled: false },
    shape: { scale: 0.2, cornerDensity: 1.3, variation: 0.22 },
    validation: { minClearanceMultiplier: 1, maxLocalTurnRadians: 1.85 },
    attempts: { primary: 80, fallback: 200 },
  },
  theme: {
    mode: 'system',
    use: 'contrast',
    tokens: {
      primary: { light: '#008c55', dark: '#00ff84' },
      pitLane: '#7c3aed',
    },
    themes: {
      contrast: {
        extends: 'default',
        tokens: {
          yellowFlag: { dark: '#ffcc00' },
        },
        components: {
          button: {
            background: 'pitLane',
            text: 'primaryText',
          },
        },
      },
    },
    componentThemes: {
      'race-controls': 'contrast',
      'timing-tower': 'selectedTeam',
    },
    teamThemes: {
      alpha: 'contrast',
    },
    accentColor: '#00ff84',
    timingTowerMaxWidth: '380px',
  },
  ui: {
    layoutPreset: 'left-tower-overlay',
    cameraControls: 'external',
    timingTowerVerticalFit: 'scroll',
    raceDataBanners: {
      initial: 'project',
      enabled: ['project', 'radio'],
    },
    penaltyBanners: true,
    timingPenaltyBadges: true,
    timingGapMode: 'leader',
    timingGapModeToggle: false,
  },
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
    frameSkip: 4,
    episode: {
      maxSteps: 3600,
      endOnRaceFinish: true,
    },
    visualizeSensors: {
      rays: true,
    },
  },
  rules: {
    ruleset: 'fia2025',
    modules: {
      pitStops: {
        enabled: true,
        pitLaneSpeedLimitKph: 80,
        maxConcurrentPitLaneCars: 3,
        minimumPitLaneGapMeters: 20,
        variability: { enabled: true, perfect: true },
      },
      stalledDnf: {
        enabled: true,
        maxStoppedSeconds: 12,
        speedThresholdKph: 5,
      },
      penalties: {
        trackLimits: { strictness: 0.8 },
        collision: {
          strictness: 0.5,
          timePenaltySeconds: 5,
          minimumSeverity: 2,
          minimumImpactSpeedKph: 20,
        },
        tireRequirement: { strictness: 1, consequences: [{ type: 'time', seconds: 10 }] },
        pitLaneSpeeding: {
          strictness: 1,
          speedLimitKph: 80,
        },
      },
    },
  },
  onDriverOpen(driver) {
    const driverName: string = driver.name;
    void driverName;
  },
  onReady({ snapshot }) {
    const leaderSnapshot: CarSnapshot | undefined = snapshot.cars[0];
    const physicsMode: 'arcade' | 'advanced' = snapshot.physicsMode;
    const gripUsage: number | undefined = leaderSnapshot?.gripUsage;
    const stabilityState: string | undefined = leaderSnapshot?.stabilityState;
    const trackDistance: number | undefined = leaderSnapshot?.trackState?.distance;
    const trackSurface: string | undefined = leaderSnapshot?.trackState?.surface;
    void leaderSnapshot;
    void physicsMode;
    void gripUsage;
    void stabilityState;
    void trackDistance;
    void trackSurface;
  },
  onDriverSelect(driver, snapshot) {
    const selectedDriver: NormalizedSimulatorDriver = driver;
    const selectedSnapshot: RaceSnapshot = snapshot;
    void selectedDriver;
    void selectedSnapshot;
  },
  onRaceFinish({ winner, snapshot }) {
    const maybeWinner: CarSnapshot | null = winner;
    const finalSnapshot: RaceSnapshot = snapshot;
    const penalties = snapshot.penalties;
    const firstPenalty = penalties[0];
    if (firstPenalty) {
      const status: 'issued' | 'served' | 'applied' | 'cancelled' = firstPenalty.status;
      const maybeService: 'driveThrough' | 'stopGo' | null | undefined = firstPenalty.serviceType;
      void status;
      void maybeService;
    }
    void maybeWinner;
    void finalSnapshot;
    void penalties;
  },
};

const typedProceduralTrack: PaddockProceduralTrack = createProceduralTrack(4101, {
  profile: 'training-medium',
  minLengthMeters: 1600,
  includePitLane: false,
});
const typedProceduralTrackWidth: number = typedProceduralTrack.width;
void typedProceduralTrack;
void typedProceduralTrackWidth;

const controller: PaddockSimulatorController = createPaddockSimulator(options);
const pitCameraController: PaddockSimulatorController = createPaddockSimulator({
  ...options,
  initialCameraMode: 'pit',
});
controller.mountRaceControls(root);
controller.mountCameraControls(root);
controller.mountSafetyCarControl(root);
controller.mountTimingTower(root);
controller.mountRaceCanvas(root, {
  includeTimingTower: true,
  includeTelemetrySectorBanner: true,
  timingTowerVerticalFit: 'scroll',
});
controller.mountTelemetryPanel(root, { includeOverview: false });
controller.mountTelemetryCore(root);
controller.mountTelemetrySectors(root);
controller.mountTelemetrySectorBanner(root);
controller.mountTelemetryLapTimes(root);
controller.mountTelemetrySectorTimes(root);
controller.mountRaceTelemetryDrawer(root);
controller.mountCarDriverOverview(root);
controller.mountRaceDataPanel(root);
controller.selectDriver('budget');
const controllerTheme: ResolvedPaddockTheme = controller.setThemeMode('light');
const controllerThemeMode: 'light' | 'dark' = controllerTheme.activeMode;
const controllerThemeFromObject: ResolvedPaddockTheme = controller.setTheme({ mode: 'dark' });
const currentControllerTheme: ResolvedPaddockTheme = controller.getTheme();
const stopControllerThemeSync: () => void = controller.syncThemeFrom(document.documentElement, {
  attribute: 'data-theme',
  map: { light: 'light', dark: 'dark' },
});
const maybeServedPenalty = controller.servePenalty('penalty-1');
const maybeCancelledPenalty = controller.cancelPenalty('penalty-2');
const pitIntentWasSet: boolean = controller.setPitIntent('budget', 2);
const targetedPitIntentWasSet: boolean = controller.setPitIntent('budget', { pitIntent: 2, pitCompound: 'H' });
const currentPitIntent: 0 | 1 | 2 = controller.getPitIntent('budget');
const currentPitTarget: string | null = controller.getPitTargetCompound('budget');
const currentTimingGapMode: TimingGapMode = controller.getTimingGapMode();
const nextTimingGapMode: TimingGapMode = controller.setTimingGapMode('interval');
const toggledTimingGapMode: TimingGapMode = controller.toggleTimingGapMode();
controller.setPitLaneOpen(true);
controller.setRedFlagDeployed(false);
const maybeExpertController: F1SimulatorExpertApi | null = controller.expert;
const maybeExpertActionSpec = maybeExpertController?.getActionSpec();
const maybeExpertObservationSpec = maybeExpertController?.getObservationSpec();
const maybeExpertResetResult: PaddockEnvironmentResult | undefined = maybeExpertController?.reset();
const maybeExpertStepResult: PaddockEnvironmentResult | undefined = maybeExpertController?.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});
const maybeExpertObservation: PaddockEnvironmentResult['observation'] | undefined =
  maybeExpertController?.getObservation();
const maybeExpertState: PaddockEnvironmentResult['state'] | undefined = maybeExpertController?.getState();
maybeExpertController?.attachExternalRenderer({
  subscribe(onFrame) {
    onFrame({
      snapshot: controller.getSnapshot() as RaceSnapshot,
      observation: {},
      meta: { step: 1 },
    });
    return () => {};
  },
});
const maybeExternalRendererState = maybeExpertController?.getExternalRendererState();
maybeExpertController?.detachExternalRenderer();
void maybeExpertActionSpec;
void maybeExpertObservationSpec;
void maybeExpertResetResult;
void maybeExpertStepResult;
void maybeExpertObservation;
void maybeExpertState;
void maybeExternalRendererState;
void maybeExpertController;
void maybeServedPenalty;
void maybeCancelledPenalty;
void pitIntentWasSet;
void targetedPitIntentWasSet;
void currentPitIntent;
void currentPitTarget;
void currentTimingGapMode;
void nextTimingGapMode;
void toggledTimingGapMode;
void controllerTheme;
void controllerThemeMode;
void controllerThemeFromObject;
void currentControllerTheme;
void stopControllerThemeSync;
void pitCameraController;

const mounted: Promise<F1MountedSimulator> = mountF1Simulator(root, options);
mountTelemetryCore(root, controller);
mountTelemetrySectors(root, controller);
mountTelemetrySectorBanner(root, controller);
mountTelemetryLapTimes(root, controller);
mountTelemetrySectorTimes(root, controller);
mountRaceTelemetryDrawer(root, controller);
mounted.then((simulator) => {
  const snapshot: RaceSnapshot | null = simulator.getSnapshot();
  const maybeExpert: F1SimulatorExpertApi | null = simulator.expert;
  const mountedTimingGapMode: TimingGapMode = simulator.getTimingGapMode();
  const mountedTheme: ResolvedPaddockTheme = simulator.setThemeMode('light');
  const mountedThemeMode: 'light' | 'dark' = mountedTheme.activeMode;
  const mountedThemeFromObject: ResolvedPaddockTheme = simulator.setTheme({ mode: 'dark' });
  const currentMountedTheme: ResolvedPaddockTheme = simulator.getTheme();
  const stopMountedThemeSync: () => void = simulator.syncThemeFrom(document.documentElement, {
    attribute: 'data-theme',
  });
  simulator.setTimingGapMode('leader');
  simulator.toggleTimingGapMode();
  // @ts-expect-error expert mode is a mount-time option, not a restart option.
  simulator.restart({ expert: { enabled: true, controlledDrivers: ['budget'] } });
  void snapshot;
  void maybeExpert;
  void mountedTimingGapMode;
  void mountedTheme;
  void mountedThemeMode;
  void mountedThemeFromObject;
  void currentMountedTheme;
  void stopMountedThemeSync;
});

// @ts-expect-error expert mode is a mount-time option, not a composable restart option.
controller.restart({ expert: { enabled: false, controlledDrivers: ['budget'] } });

const env = createPaddockEnvironment({
  drivers: options.drivers,
  controlledDrivers: ['budget'],
  warmup: {
    policy: 'always',
    steps: 8,
  },
  physicsMode: 'advanced',
  observation: {
    output: 'vector',
    vectorType: 'float32',
  },
  sensors: {
    rays: {
      precision: 'driver',
    },
  },
  result: {
    stateOutput: 'minimal',
  },
  rules: {
    ruleset: 'custom',
    standingStart: false,
    modules: {
      penalties: {
        trackLimits: { strictness: 0.25 },
      },
    },
  },
  reward: createProgressReward(),
});
const typedRewardEnv = createPaddockEnvironment({
  drivers: options.drivers,
  controlledDrivers: ['budget'],
  reward(context) {
    const legalProgress: number = context.metrics.legalProgressDeltaMeters;
    const destroyed: boolean = context.metrics.destroyed;
    const terminated: boolean = context.episode.terminated;
    void destroyed;
    void terminated;
    return legalProgress;
  },
});

const typedDriverController: PaddockDriverController = {
  init(context) {
    const firstVector: number[] | Float32Array | null = context.orderedObservations[0]?.vector ?? null;
    void firstVector;
  },
  async decideBatch(context) {
    return Object.fromEntries(context.controlledDrivers.map((driverId) => [
      driverId,
      { steering: 0, throttle: 1, brake: 0 },
    ]));
  },
  onStep(context) {
    const step: number = context.runtimeStep;
    void step;
  },
};
const typedLoop = createPaddockDriverControllerLoop({
  runtime: env,
  controller: typedDriverController,
  actionRepeat: 4,
});
const typedEnvironmentLoop = createEnvironmentDriverControllerLoop({
  runtime: env,
  controller: typedDriverController,
});
typedLoop.stepFrame().then((result: PaddockEnvironmentResult) => void result);
typedEnvironmentLoop.stop();
const resetResult = env.reset();
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
const firstActionDriver: string | undefined = actionSpec.controlledDrivers[0];
const firstVectorField: string | undefined = observationSpec.vector.schema[0]?.name;
const observationSpecVersion: 3 | 6 = observationSpec.version;
const typedObservationObject = {} as PaddockDriverObservationObject;
const appliedSteering: number = typedObservationObject.self.appliedControls?.steering ?? 0;
const appliedThrottle: number = typedObservationObject.self.appliedControls?.throttle ?? 0;
const appliedBrake: number = typedObservationObject.self.appliedControls?.brake ?? 0;
const maybeRacePosition: number | null = typedObservationObject.race.position;
resetResult.info.controlledDrivers.includes('budget');
const resetEpisodeStep: number = resetResult.info.drivers.budget.episodeStep;
const resetProgressMetric: number = resetResult.metrics.budget.progressDeltaMeters;
const maybeVector: number[] | Float32Array | undefined = resetResult.observation.budget.vector;
const nextResult = env.step({
  budget: { steering: 0, throttle: 1, brake: 0, pitIntent: 2, pitCompound: 'H' },
});
env.resetDrivers(
  { budget: { distanceMeters: 200, offsetMeters: 0, speedKph: 90 } },
  { stateOutput: 'none', observationScope: 'reset' },
);
const recorder = createRolloutRecorder();
const transition = recorder.recordStep(resetResult, {
  budget: { steering: 0, throttle: 1, brake: 0 },
}, nextResult);
const evaluation = runEnvironmentEvaluation({
  baseOptions: {
    drivers: options.drivers,
    controlledDrivers: ['budget'],
    scenario: {
      participants: 'controlled-only',
      preset: 'cornering',
      placements: {
        budget: { distanceMeters: 200, offsetMeters: 0, speedKph: 90 },
      },
    },
  },
  cases: [{ name: 'typed', seed: 1, trackSeed: 2, maxSteps: 1 }],
  policy() {
    return { steering: 0, throttle: 1, brake: 0 };
  },
});
const protocol = createEnvironmentWorkerProtocol(env);
const protocolResponse = protocol.handle({ type: 'getActionSpec' });
env.destroy();
typedRewardEnv.destroy();
void firstActionDriver;
void firstVectorField;
void observationSpecVersion;
void appliedSteering;
void appliedThrottle;
void appliedBrake;
void maybeRacePosition;
void transition;
void evaluation;
void protocolResponse;

const simUnits: number = metersToSimUnits(5);
const kph: number = simSpeedToKph(kphToSimSpeed(320));
const maybeLeader: CarSnapshot | undefined = leader;
const sectorStatus: SectorPerformanceStatus = 'overall-best';
void simUnits;
void kph;
void maybeLeader;
void sectorStatus;
