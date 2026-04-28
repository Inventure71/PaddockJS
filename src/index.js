import './styles.css';
import { F1SimulatorApp } from './app/F1SimulatorApp.js';
import { resolveF1SimulatorOptions } from './config/defaultOptions.js';
import { createF1SimulatorShell } from './ui/shellTemplate.js';
export {
  createPaddockSimulator,
  mountCameraControls,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountSafetyCarControl,
  mountTelemetryPanel,
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
export { normalizeSimulatorDrivers } from './data/normalizeDrivers.js';

function assertMountRoot(root) {
  if (!(root instanceof Element)) {
    throw new Error('mountF1Simulator requires a DOM element root.');
  }
}

function mergeRestartOptions(previousOptions, nextOptions) {
  return {
    ...previousOptions,
    ...nextOptions,
    ui: {
      ...previousOptions.ui,
      ...(nextOptions.ui ?? {}),
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
    destroy() {
      app.destroy();
      root.innerHTML = '';
    },
    restart(nextOptions = {}) {
      resolvedOptions = resolveF1SimulatorOptions(mergeRestartOptions(resolvedOptions, nextOptions));
      app.restart(resolvedOptions);
    },
    selectDriver(driverId) {
      app.selectCar(driverId, { focus: true });
    },
    setSafetyCarDeployed(deployed) {
      app.setSafetyCarDeployed(deployed);
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
    getSnapshot() {
      return app.getSnapshot();
    },
  };
}
