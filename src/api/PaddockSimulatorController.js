import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { installLayoutSupport } from '../app/layoutSupport.js';
import {
  createRaceDataPanelMarkup,
  createTelemetrySectorBannerMarkup,
} from '../ui/bannerTemplates.js';
import {
  createCarDriverOverviewMarkup,
  createCameraControlsMarkup,
  createRaceCanvasMarkup,
  createRaceControlsMarkup,
  createRaceTelemetryDrawerMarkup,
  createSafetyCarControlMarkup,
  createTelemetryCoreMarkup,
  createTelemetryLapTimesMarkup,
  createTelemetryPanelMarkup,
  createTelemetrySectorTimesMarkup,
  createTelemetrySectorsMarkup,
  createTimingTowerMarkup,
} from '../ui/componentTemplates.js';
import { applyPaddockThemeCssVariables, resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { formatCssUrl } from '../config/cssValues.js';
import { mergeRestartOptions } from '../config/restartOptions.js';
import { getNextTimingGapMode, normalizeTimingGapMode } from '../config/timingGapMode.js';
import { createThemeSync, resolveRuntimeThemeModeOptions, resolveRuntimeThemeOptions } from './runtimeTheme.js';

function assertMountTarget(root, label) {
  if (!root || typeof root !== 'object' || !('innerHTML' in root)) {
    throw new Error(`${label} requires a DOM element root.`);
  }
}

function setPackageCssVariables(root, assets, theme, context = {}) {
  root.classList?.add?.('f1-sim-component');
  root.style?.setProperty?.('--broadcast-panel-surface', formatCssUrl(assets.broadcastPanel));
  applyPaddockThemeCssVariables(root, theme, context);
}

function createCompositeRoot(getRoots, getOptions) {
  return {
    style: {
      setProperty(name, value) {
        getRoots().forEach((root) => root.style?.setProperty?.(name, value));
      },
      removeProperty(name) {
        getRoots().forEach((root) => root.style?.removeProperty?.(name));
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
    setAttribute(name, value) {
      getRoots().forEach((root) => root.setAttribute?.(name, value));
    },
    removeAttribute(name) {
      getRoots().forEach((root) => root.removeAttribute?.(name));
    },
    applyCssVariables(context = {}) {
      const options = getOptions();
      getRoots().forEach((root) => setPackageCssVariables(root, options.assets, options.theme, context));
    },
  };
}

export class PaddockSimulatorController {
  constructor(options = {}) {
    this.options = resolveF1SimulatorOptions(options);
    this.roots = new Map();
    this.mountRenderers = new Map();
    this.layoutSupportCleanups = new Map();
    this.app = null;
    this.compositeRoot = createCompositeRoot(() => [...this.roots.values()], () => this.options);
  }

  mountComponent(root, key, createMarkup) {
    assertMountTarget(root, `mount ${key}`);
    if (this.app) {
      throw new Error('Mount PaddockJS components before calling start().');
    }
    const render = typeof createMarkup === 'function' ? createMarkup : () => createMarkup;
    root.innerHTML = render();
    setPackageCssVariables(root, this.options.assets, this.options.theme);
    this.layoutSupportCleanups.get(key)?.();
    this.layoutSupportCleanups.set(key, installLayoutSupport(root));
    this.roots.set(key, root);
    this.mountRenderers.set(key, render);
    return root;
  }

  mountRaceControls(root) {
    return this.mountComponent(root, 'race-controls', () => createRaceControlsMarkup(this.options));
  }

  mountCameraControls(root) {
    return this.mountComponent(root, 'camera-controls', () => createCameraControlsMarkup(this.options));
  }

  mountSafetyCarControl(root) {
    return this.mountComponent(root, 'safety-car-control', () => createSafetyCarControlMarkup(this.options));
  }

  mountTimingTower(root) {
    return this.mountComponent(root, 'timing-tower', () => createTimingTowerMarkup(this.options));
  }

  mountRaceCanvas(root, {
    includeRaceDataPanel = false,
    includeTimingTower = false,
    includeTelemetrySectorBanner = false,
    timingTowerVerticalFit,
    responsiveNarrowLayout,
  } = {}) {
    return this.mountComponent(root, 'race-canvas', () => createRaceCanvasMarkup({
      ...this.options,
      includeRaceDataPanel,
      includeTimingTower,
      includeTelemetrySectorBanner,
      timingTowerVerticalFit,
      responsiveNarrowLayout,
    }));
  }

  mountTelemetryPanel(root, { includeOverview } = {}) {
    return this.mountComponent(root, 'telemetry-stack', () => createTelemetryPanelMarkup(this.options, { includeOverview }));
  }

  mountTelemetryCore(root) {
    return this.mountComponent(root, 'telemetry-core', () => createTelemetryCoreMarkup(this.options));
  }

  mountTelemetrySectors(root) {
    return this.mountComponent(root, 'telemetry-sectors', () => createTelemetrySectorsMarkup(this.options));
  }

  mountTelemetryLapTimes(root) {
    return this.mountComponent(root, 'telemetry-lap-times', () => createTelemetryLapTimesMarkup(this.options));
  }

  mountTelemetrySectorTimes(root) {
    return this.mountComponent(root, 'telemetry-sector-times', () => createTelemetrySectorTimesMarkup(this.options));
  }

  mountTelemetrySectorBanner(root) {
    return this.mountComponent(root, 'telemetry-sector-banner', () => createTelemetrySectorBannerMarkup(this.options));
  }

  mountRaceTelemetryDrawer(root, options = {}) {
    return this.mountComponent(root, 'race-telemetry-drawer', () => createRaceTelemetryDrawerMarkup(this.options, options));
  }

  mountCarDriverOverview(root) {
    return this.mountComponent(root, 'car-driver-overview', () => createCarDriverOverviewMarkup(this.options));
  }

  mountRaceDataPanel(root) {
    return this.mountComponent(root, 'race-data-panel', () => createRaceDataPanelMarkup({
      ...this.options,
      standalone: true,
    }));
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
    this.layoutSupportCleanups.forEach((cleanup) => cleanup());
    this.layoutSupportCleanups.clear();
    this.roots.forEach((root) => {
      root.innerHTML = '';
    });
    this.roots.clear();
    this.mountRenderers.clear();
  }

  rerenderMountedComponents() {
    this.roots.forEach((root, key) => {
      const render = this.mountRenderers.get(key);
      if (render) root.innerHTML = render();
      setPackageCssVariables(root, this.options.assets, this.options.theme);
      this.layoutSupportCleanups.get(key)?.();
      this.layoutSupportCleanups.set(key, installLayoutSupport(root));
    });
  }

  syncOptionsFromRunningApp() {
    const timingGapMode = this.app?.getTimingGapMode?.();
    if (!timingGapMode) return this.options;
    this.options = {
      ...this.options,
      ui: {
        ...this.options.ui,
        timingGapMode: normalizeTimingGapMode(timingGapMode),
      },
    };
    return this.options;
  }

  restart(nextOptions = {}) {
    const currentOptions = this.app ? this.syncOptionsFromRunningApp() : this.options;
    const nextResolvedOptions = resolveF1SimulatorOptions(mergeRestartOptions(currentOptions, nextOptions));
    if (this.app) {
      const previousOptions = this.options;
      this.options = nextResolvedOptions;
      try {
        this.app.restart(nextResolvedOptions);
      } catch (error) {
        this.options = previousOptions;
        throw error;
      }
      return;
    }
    this.options = nextResolvedOptions;
    this.rerenderMountedComponents();
  }

  setTheme(themeInput = {}) {
    const currentOptions = this.app ? this.syncOptionsFromRunningApp() : this.options;
    const nextResolvedOptions = resolveRuntimeThemeOptions(currentOptions, themeInput);
    this.options = nextResolvedOptions;
    if (this.app?.setTheme) {
      this.app.setTheme(nextResolvedOptions.theme);
    } else {
      this.compositeRoot.applyCssVariables();
    }
    return nextResolvedOptions.theme;
  }

  setThemeMode(mode) {
    const currentOptions = this.app ? this.syncOptionsFromRunningApp() : this.options;
    const nextResolvedOptions = resolveRuntimeThemeModeOptions(currentOptions, mode);
    this.options = nextResolvedOptions;
    if (this.app?.setTheme) {
      this.app.setTheme(nextResolvedOptions.theme);
    } else {
      this.compositeRoot.applyCssVariables();
    }
    return nextResolvedOptions.theme;
  }

  getTheme() {
    return this.options.theme;
  }

  syncThemeFrom(source, options = {}) {
    return createThemeSync(this, source, options);
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

  getSimulationSpeed() {
    return this.app?.simulationSpeed ?? 1;
  }

  setTimingGapMode(mode) {
    const timingGapMode = this.app
      ? this.app.setTimingGapMode(mode)
      : normalizeTimingGapMode(mode);
    this.options = {
      ...this.options,
      ui: {
        ...this.options.ui,
        timingGapMode,
      },
    };
    return this.options.ui.timingGapMode;
  }

  getTimingGapMode() {
    return this.app?.getTimingGapMode?.() ?? normalizeTimingGapMode(this.options.ui?.timingGapMode);
  }

  toggleTimingGapMode() {
    if (this.app) {
      const timingGapMode = this.app.toggleTimingGapMode();
      this.options = {
        ...this.options,
        ui: {
          ...this.options.ui,
          timingGapMode,
        },
      };
      return timingGapMode;
    }
    return this.setTimingGapMode(getNextTimingGapMode(this.options.ui?.timingGapMode));
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
