import './styles.css';
import { F1SimulatorApp } from './app/F1SimulatorApp.js';
import { resolveF1SimulatorOptions } from './config/defaultOptions.js';
import { createF1SimulatorShell } from './ui/shellTemplate.js';
export {
  createPaddockSimulator,
  mountCarDriverOverview,
  mountCameraControls,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountRaceTelemetryDrawer,
  mountSafetyCarControl,
  mountTelemetryCore,
  mountTelemetryLapTimes,
  mountTelemetryPanel,
  mountTelemetrySectorBanner,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  mountTimingTower,
} from './api/PaddockSimulatorController.js';

export {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DriverData,
  VehicleData,
  buildChampionshipDriverGrid,
  formatDriverNumber,
} from './data/championship.js';
export { DEMO_PROJECT_DRIVERS } from './data/demoDrivers.js';
export { DEFAULT_F1_SIMULATOR_ASSETS } from './config/defaultAssets.js';
export { PADDOCK_SIMULATOR_PRESETS } from './config/defaultOptions.js';
export { createPaddockDriverControllerLoop } from './environment/controllerLoop.js';
export { normalizeSimulatorDrivers } from './data/normalizeDrivers.js';
export {
  REAL_F1_CAR_LENGTH_METERS,
  SIM_UNITS_PER_METER,
  TARGET_F1_TOP_SPEED_KPH,
  VISUAL_CAR_LENGTH_METERS,
  kphToSimSpeed,
  metersToSimUnits,
  simSpeedToKph,
  simSpeedToMetersPerSecond,
  simUnitsToMeters,
} from './simulation/units.js';

function assertMountRoot(root) {
  if (!(root instanceof Element)) {
    throw new Error('mountF1Simulator requires a DOM element root.');
  }
}

function mergeRestartOptions(previousOptions, nextOptions) {
  const resetFromPreset = Object.hasOwn(nextOptions, 'preset');
  const previousUi = resetFromPreset ? {} : previousOptions.ui;
  const previousTheme = resetFromPreset ? {} : previousOptions.theme;
  return {
    ...previousOptions,
    ...nextOptions,
    ui: {
      ...previousUi,
      ...(nextOptions.ui ?? {}),
      raceDataBanners: {
        ...(previousUi.raceDataBanners ?? {}),
        ...(nextOptions.ui?.raceDataBanners ?? {}),
      },
    },
    theme: {
      ...previousTheme,
      ...(nextOptions.theme ?? {}),
    },
    assets: {
      ...previousOptions.assets,
      ...(nextOptions.assets ?? {}),
      trackTextures: {
        ...previousOptions.assets.trackTextures,
        ...(nextOptions.assets?.trackTextures ?? {}),
      },
    },
    drivers: nextOptions.drivers ?? previousOptions.drivers,
    entries: nextOptions.entries ?? previousOptions.entries,
  };
}

export async function mountF1Simulator(root, options = {}) {
  assertMountRoot(root);

  let resolvedOptions = resolveF1SimulatorOptions(options);
  root.innerHTML = createF1SimulatorShell(resolvedOptions);
  const shell = root.querySelector('[data-f1-simulator-shell]');
  const app = new F1SimulatorApp(shell, resolvedOptions);
  await app.init();

  return {
    get expert() {
      return app.expert ?? null;
    },
    destroy() {
      app.destroy();
      root.innerHTML = '';
    },
    restart(nextOptions = {}) {
      const nextResolvedOptions = resolveF1SimulatorOptions(mergeRestartOptions(resolvedOptions, nextOptions));
      app.restart(nextResolvedOptions);
      resolvedOptions = nextResolvedOptions;
    },
    selectDriver(driverId) {
      app.selectCar(driverId, { focus: true });
    },
    setSafetyCarDeployed(deployed) {
      app.setSafetyCarDeployed(deployed);
    },
    setRedFlagDeployed(deployed) {
      app.setRedFlagDeployed(deployed);
    },
    setPitLaneOpen(open) {
      app.setPitLaneOpen(open);
    },
    callSafetyCar() {
      app.setSafetyCarDeployed(true);
    },
    clearSafetyCar() {
      app.setSafetyCarDeployed(false);
    },
    toggleSafetyCar() {
      const active = app.getSnapshot()?.raceControl.mode === 'safety-car';
      app.setSafetyCarDeployed(!active);
    },
    setPitIntent(driverId, intent, targetCompound) {
      return app.setPitIntent(driverId, intent, targetCompound);
    },
    getPitIntent(driverId) {
      return app.getPitIntent(driverId);
    },
    getPitTargetCompound(driverId) {
      return app.getPitTargetCompound(driverId);
    },
    servePenalty(penaltyId) {
      return app.servePenalty(penaltyId);
    },
    cancelPenalty(penaltyId) {
      return app.cancelPenalty(penaltyId);
    },
    getSnapshot() {
      return app.getSnapshot();
    },
  };
}
