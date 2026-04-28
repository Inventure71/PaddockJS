import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import {
  createCarDriverOverviewMarkup,
  createCameraControlsMarkup,
  createRaceCanvasMarkup,
  createRaceControlsMarkup,
  createRaceDataPanelMarkup,
  createSafetyCarControlMarkup,
  createTelemetryPanelMarkup,
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
    timingTowerVerticalFit,
  } = {}) {
    return this.mountComponent(root, 'race-canvas', createRaceCanvasMarkup({
      ...this.options,
      includeRaceDataPanel,
      includeTimingTower,
      timingTowerVerticalFit,
    }));
  }

  mountTelemetryPanel(root, { includeOverview } = {}) {
    return this.mountComponent(root, 'telemetry-panel', createTelemetryPanelMarkup(this.options, { includeOverview }));
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

  destroy() {
    this.app?.destroy();
    this.app = null;
    this.roots.forEach((root) => {
      root.innerHTML = '';
    });
    this.roots.clear();
  }

  restart(nextOptions = {}) {
    this.options = resolveF1SimulatorOptions(mergeResolvedOptions(this.options, nextOptions));
    this.compositeRoot.applyCssVariables();
    this.app?.restart(this.options);
  }

  selectDriver(driverId) {
    this.app?.selectCar(driverId, { focus: true });
  }

  setSafetyCarDeployed(deployed) {
    this.app?.setSafetyCarDeployed(deployed);
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

export function mountRaceDataPanel(root, simulator) {
  return simulator.mountRaceDataPanel(root);
}
