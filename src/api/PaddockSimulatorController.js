import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import {
  createCarDriverOverviewMarkup,
  createCameraControlsMarkup,
  createRaceCanvasMarkup,
  createRaceControlsMarkup,
  createRaceDataPanelMarkup,
  createRaceTelemetryDrawerMarkup,
  createSafetyCarControlMarkup,
  createTelemetryCoreMarkup,
  createTelemetryLapTimesMarkup,
  createTelemetryPanelMarkup,
  createTelemetrySectorBannerMarkup,
  createTelemetrySectorTimesMarkup,
  createTelemetrySectorsMarkup,
  createTimingTowerMarkup,
} from '../ui/componentTemplates.js';
import { applyPaddockThemeCssVariables, resolveF1SimulatorOptions } from '../config/defaultOptions.js';

function assertMountTarget(root, label) {
  if (!root || typeof root !== 'object' || !('innerHTML' in root)) {
    throw new Error(`${label} requires a DOM element root.`);
  }
}

function setPackageCssVariables(root, assets, theme) {
  root.classList?.add?.('f1-sim-component');
  root.style?.setProperty?.('--broadcast-panel-surface', `url('${assets.broadcastPanel}')`);
  applyPaddockThemeCssVariables(root, theme);
}

function mergeResolvedOptions(previousOptions, nextOptions) {
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

function createCompositeRoot(getRoots, getOptions) {
  return {
    style: {
      setProperty(name, value) {
        getRoots().forEach((root) => root.style?.setProperty?.(name, value));
      },
    },
    querySelector(selector) {
      for (const root of getRoots()) {
        const match = root.querySelector?.(selector);
        if (match) return match;
      }
      return null;
    },
    querySelectorAll(selector) {
      return getRoots().flatMap((root) => [...(root.querySelectorAll?.(selector) ?? [])]);
    },
    applyCssVariables() {
      const options = getOptions();
      getRoots().forEach((root) => setPackageCssVariables(root, options.assets, options.theme));
    },
  };
}

export class PaddockSimulatorController {
  constructor(options = {}) {
    this.options = resolveF1SimulatorOptions(options);
    this.roots = new Map();
    this.app = null;
    this.compositeRoot = createCompositeRoot(() => [...this.roots.values()], () => this.options);
  }

  mountComponent(root, key, markup) {
    assertMountTarget(root, `mount ${key}`);
    if (this.app) {
      throw new Error('Mount PaddockJS components before calling start().');
    }
    root.innerHTML = markup;
    setPackageCssVariables(root, this.options.assets, this.options.theme);
    this.roots.set(key, root);
    return root;
  }

  mountRaceControls(root) {
    return this.mountComponent(root, 'race-controls', createRaceControlsMarkup(this.options));
  }

  mountCameraControls(root) {
    return this.mountComponent(root, 'camera-controls', createCameraControlsMarkup(this.options));
  }

  mountSafetyCarControl(root) {
    return this.mountComponent(root, 'safety-car-control', createSafetyCarControlMarkup(this.options));
  }

  mountTimingTower(root) {
    return this.mountComponent(root, 'timing-tower', createTimingTowerMarkup(this.options));
  }

  mountRaceCanvas(root, {
    includeRaceDataPanel = false,
    includeTimingTower = false,
    includeTelemetrySectorBanner = false,
    timingTowerVerticalFit,
  } = {}) {
    return this.mountComponent(root, 'race-canvas', createRaceCanvasMarkup({
      ...this.options,
      includeRaceDataPanel,
      includeTimingTower,
      includeTelemetrySectorBanner,
      timingTowerVerticalFit,
    }));
  }

  mountTelemetryPanel(root, { includeOverview } = {}) {
    return this.mountComponent(root, 'telemetry-stack', createTelemetryPanelMarkup(this.options, { includeOverview }));
  }

  mountTelemetryCore(root) {
    return this.mountComponent(root, 'telemetry-core', createTelemetryCoreMarkup(this.options));
  }

  mountTelemetrySectors(root) {
    return this.mountComponent(root, 'telemetry-sectors', createTelemetrySectorsMarkup(this.options));
  }

  mountTelemetryLapTimes(root) {
    return this.mountComponent(root, 'telemetry-lap-times', createTelemetryLapTimesMarkup(this.options));
  }

  mountTelemetrySectorTimes(root) {
    return this.mountComponent(root, 'telemetry-sector-times', createTelemetrySectorTimesMarkup(this.options));
  }

  mountTelemetrySectorBanner(root) {
    return this.mountComponent(root, 'telemetry-sector-banner', createTelemetrySectorBannerMarkup(this.options));
  }

  mountRaceTelemetryDrawer(root, options = {}) {
    return this.mountComponent(root, 'race-telemetry-drawer', createRaceTelemetryDrawerMarkup(this.options, options));
  }

  mountCarDriverOverview(root) {
    return this.mountComponent(root, 'car-driver-overview', createCarDriverOverviewMarkup(this.options));
  }

  mountRaceDataPanel(root) {
    return this.mountComponent(root, 'race-data-panel', createRaceDataPanelMarkup(this.options));
  }

  querySelector(selector) {
    return this.compositeRoot.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.compositeRoot.querySelectorAll(selector);
  }

  async start() {
    if (this.app) return this;
    this.compositeRoot.applyCssVariables();
    this.app = new F1SimulatorApp(this.compositeRoot, this.options);
    await this.app.init();
    return this;
  }

  get expert() {
    return this.app?.expert ?? null;
  }

  destroy() {
    this.app?.destroy();
    this.app = null;
    this.roots.forEach((root) => {
      root.innerHTML = '';
    });
    this.roots.clear();
  }

  restart(nextOptions = {}) {
    const nextResolvedOptions = resolveF1SimulatorOptions(mergeResolvedOptions(this.options, nextOptions));
    this.app?.restart(nextResolvedOptions);
    this.options = nextResolvedOptions;
    this.compositeRoot.applyCssVariables();
  }

  selectDriver(driverId) {
    this.app?.selectCar(driverId, { focus: true });
  }

  setSafetyCarDeployed(deployed) {
    this.app?.setSafetyCarDeployed(deployed);
  }

  setRedFlagDeployed(deployed) {
    this.app?.setRedFlagDeployed?.(deployed);
  }

  setPitLaneOpen(open) {
    this.app?.setPitLaneOpen?.(open);
  }

  callSafetyCar() {
    this.setSafetyCarDeployed(true);
  }

  clearSafetyCar() {
    this.setSafetyCarDeployed(false);
  }

  toggleSafetyCar() {
    const active = this.app?.getSnapshot()?.raceControl.mode === 'safety-car';
    this.setSafetyCarDeployed(!active);
  }

  setPitIntent(driverId, intent, targetCompound) {
    return this.app?.setPitIntent(driverId, intent, targetCompound) ?? false;
  }

  getPitIntent(driverId) {
    return this.app?.getPitIntent(driverId) ?? 0;
  }

  getPitTargetCompound(driverId) {
    return this.app?.getPitTargetCompound?.(driverId) ?? null;
  }

  servePenalty(penaltyId) {
    return this.app?.servePenalty(penaltyId) ?? null;
  }

  cancelPenalty(penaltyId) {
    return this.app?.cancelPenalty(penaltyId) ?? null;
  }

  getSnapshot() {
    return this.app?.getSnapshot() ?? null;
  }
}

export function createPaddockSimulator(options = {}) {
  return new PaddockSimulatorController(options);
}

export function mountRaceControls(root, simulator) {
  return simulator.mountRaceControls(root);
}

export function mountCameraControls(root, simulator) {
  return simulator.mountCameraControls(root);
}

export function mountCarDriverOverview(root, simulator) {
  return simulator.mountCarDriverOverview(root);
}

export function mountSafetyCarControl(root, simulator) {
  return simulator.mountSafetyCarControl(root);
}

export function mountTimingTower(root, simulator) {
  return simulator.mountTimingTower(root);
}

export function mountRaceCanvas(root, simulator, options) {
  return simulator.mountRaceCanvas(root, options);
}

export function mountTelemetryPanel(root, simulator, options) {
  return simulator.mountTelemetryPanel(root, options);
}

export function mountTelemetryCore(root, simulator) {
  return simulator.mountTelemetryCore(root);
}

export function mountTelemetrySectors(root, simulator) {
  return simulator.mountTelemetrySectors(root);
}

export function mountTelemetryLapTimes(root, simulator) {
  return simulator.mountTelemetryLapTimes(root);
}

export function mountTelemetrySectorTimes(root, simulator) {
  return simulator.mountTelemetrySectorTimes(root);
}

export function mountTelemetrySectorBanner(root, simulator) {
  return simulator.mountTelemetrySectorBanner(root);
}

export function mountRaceTelemetryDrawer(root, simulator, options) {
  return simulator.mountRaceTelemetryDrawer(root, options);
}

export function mountRaceDataPanel(root, simulator) {
  return simulator.mountRaceDataPanel(root);
}
