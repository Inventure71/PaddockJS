import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import {
  createRaceCanvasMarkup,
  createRaceControlsMarkup,
  createRaceDataPanelMarkup,
  createTelemetryPanelMarkup,
  createTimingTowerMarkup,
} from '../ui/componentTemplates.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';

function assertMountTarget(root, label) {
  if (!root || typeof root !== 'object' || !('innerHTML' in root)) {
    throw new Error(`${label} requires a DOM element root.`);
  }
}

function setPackageCssVariables(root, assets) {
  root.style?.setProperty?.('--broadcast-panel-surface', `url('${assets.broadcastPanel}')`);
}

function mergeResolvedOptions(previousOptions, nextOptions) {
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

function createCompositeRoot(getRoots, getAssets) {
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
      const assets = getAssets();
      getRoots().forEach((root) => setPackageCssVariables(root, assets));
    },
  };
}

export class PaddockSimulatorController {
  constructor(options = {}) {
    this.options = resolveF1SimulatorOptions(options);
    this.roots = new Map();
    this.app = null;
    this.compositeRoot = createCompositeRoot(() => [...this.roots.values()], () => this.options.assets);
  }

  mountComponent(root, key, markup) {
    assertMountTarget(root, `mount ${key}`);
    if (this.app) {
      throw new Error('Mount PaddockJS components before calling start().');
    }
    root.innerHTML = markup;
    setPackageCssVariables(root, this.options.assets);
    this.roots.set(key, root);
    return root;
  }

  mountRaceControls(root) {
    return this.mountComponent(root, 'race-controls', createRaceControlsMarkup(this.options));
  }

  mountTimingTower(root) {
    return this.mountComponent(root, 'timing-tower', createTimingTowerMarkup(this.options));
  }

  mountRaceCanvas(root) {
    return this.mountComponent(root, 'race-canvas', createRaceCanvasMarkup(this.options));
  }

  mountTelemetryPanel(root) {
    return this.mountComponent(root, 'telemetry-panel', createTelemetryPanelMarkup(this.options));
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

export function mountTimingTower(root, simulator) {
  return simulator.mountTimingTower(root);
}

export function mountRaceCanvas(root, simulator) {
  return simulator.mountRaceCanvas(root);
}

export function mountTelemetryPanel(root, simulator) {
  return simulator.mountTelemetryPanel(root);
}

export function mountRaceDataPanel(root, simulator) {
  return simulator.mountRaceDataPanel(root);
}
