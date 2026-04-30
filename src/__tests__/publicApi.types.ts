import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
  DriverData,
  VehicleData,
  buildChampionshipDriverGrid,
  createPaddockSimulator,
  kphToSimSpeed,
  metersToSimUnits,
  mountF1Simulator,
  normalizeSimulatorDrivers,
  simSpeedToKph,
  type CarSnapshot,
  type ChampionshipEntryBlueprint,
  type F1MountedSimulator,
  type F1SimulatorOptions,
  type NormalizedSimulatorDriver,
  type PaddockSimulatorController,
  type RaceSnapshot,
} from '../index.js';

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
    void maybeWinner;
    void finalSnapshot;
  },
};

const controller: PaddockSimulatorController = createPaddockSimulator(options);
controller.mountRaceControls(root);
controller.mountCameraControls(root);
controller.mountSafetyCarControl(root);
controller.mountTimingTower(root);
controller.mountRaceCanvas(root, { includeTimingTower: true, timingTowerVerticalFit: 'scroll' });
controller.mountTelemetryPanel(root, { includeOverview: false });
controller.mountCarDriverOverview(root);
controller.mountRaceDataPanel(root);
controller.selectDriver('budget');

const mounted: Promise<F1MountedSimulator> = mountF1Simulator(root, options);
mounted.then((simulator) => {
  const snapshot: RaceSnapshot | null = simulator.getSnapshot();
  void snapshot;
});

const simUnits: number = metersToSimUnits(5);
const kph: number = simSpeedToKph(kphToSimSpeed(320));
const maybeLeader: CarSnapshot | undefined = leader;
void simUnits;
void kph;
void maybeLeader;
