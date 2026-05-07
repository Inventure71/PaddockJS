import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
  DriverData,
  VehicleData,
  buildChampionshipDriverGrid,
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
  simSpeedToKph,
  type CarSnapshot,
  type ChampionshipEntryBlueprint,
  type F1MountedSimulator,
  type F1SimulatorExpertApi,
  type F1SimulatorOptions,
  type NormalizedSimulatorDriver,
  type PaddockSimulatorController,
  type RaceSnapshot,
  type SectorPerformanceStatus,
} from '../index.js';
import { createPaddockEnvironment, createProgressReward } from '../environment/index.js';

const root = document.createElement('div');

const drivers = normalizeSimulatorDrivers(DEMO_PROJECT_DRIVERS, {
  entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
});

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
};

const options: F1SimulatorOptions = {
  preset: 'timing-overlay',
  drivers: DEMO_PROJECT_DRIVERS,
  entries: [...CHAMPIONSHIP_ENTRY_BLUEPRINTS, extraEntry],
  initialCameraMode: 'show-all',
  theme: {
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
  },
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
    frameSkip: 4,
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
    void leaderSnapshot;
  },
  onRaceFinish({ winner, snapshot }) {
    const maybeWinner: CarSnapshot | null = winner;
    const finalSnapshot: RaceSnapshot = snapshot;
    const penalties = snapshot.penalties;
    void maybeWinner;
    void finalSnapshot;
    void penalties;
  },
};

const controller: PaddockSimulatorController = createPaddockSimulator(options);
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
const maybeExpertController: F1SimulatorExpertApi | null = controller.expert;
const maybeExpertActionSpec = maybeExpertController?.getActionSpec();
const maybeExpertObservationSpec = maybeExpertController?.getObservationSpec();
void maybeExpertActionSpec;
void maybeExpertObservationSpec;
void maybeExpertController;

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
  // @ts-expect-error expert mode is a mount-time option, not a restart option.
  simulator.restart({ expert: { enabled: true, controlledDrivers: ['budget'] } });
  void snapshot;
  void maybeExpert;
});

// @ts-expect-error expert mode is a mount-time option, not a composable restart option.
controller.restart({ expert: { enabled: false, controlledDrivers: ['budget'] } });

const env = createPaddockEnvironment({
  drivers: options.drivers,
  controlledDrivers: ['budget'],
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
const resetResult = env.reset();
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
const firstActionDriver: string | undefined = actionSpec.controlledDrivers[0];
const firstVectorField: string | undefined = observationSpec.vector.schema[0]?.name;
resetResult.info.controlledDrivers.includes('budget');
env.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});
env.destroy();
void firstActionDriver;
void firstVectorField;

const simUnits: number = metersToSimUnits(5);
const kph: number = simSpeedToKph(kphToSimSpeed(320));
const maybeLeader: CarSnapshot | undefined = leader;
const sectorStatus: SectorPerformanceStatus = 'overall-best';
void simUnits;
void kph;
void maybeLeader;
void sectorStatus;
