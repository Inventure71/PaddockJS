import { resolveF1SimulatorAssets } from './defaultAssets.js';
import { CHAMPIONSHIP_ENTRY_BLUEPRINTS } from '../data/championship.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { normalizePhysicsMode } from '../simulation/vehicle/vehiclePhysics.js';
import { normalizeWarmupOptions } from '../simulation/warmup/runtimeWarmup.js';
import {
  DEFAULT_PADDOCK_THEME_INPUT,
  applyPaddockThemeCssVariables,
  mergeThemeInputs,
  normalizePaddockTheme,
} from './themeOptions.js';
import { normalizePublicUrlOption } from './urlOptions.js';

export const DEFAULT_F1_SIMULATOR_OPTIONS = {
  seed: 1971,
  physicsMode: 'arcade',
  warmup: {
    enabled: true,
    policy: 'config-change',
  },
  totalLaps: 10,
  initialCameraMode: 'leader',
  title: 'F1 Simulator Lab',
  kicker: 'Race Control',
  backLinkHref: 'projects.html',
  backLinkLabel: 'Projects',
  showBackLink: true,
  ui: {
    layoutPreset: 'standard',
    cameraControls: 'external',
    showFps: true,
    showTimingTower: true,
    showTelemetry: true,
    telemetryIncludesOverview: true,
    telemetryModules: {
      core: true,
      sectors: true,
      lapTimes: true,
      sectorTimes: true,
    },
    showRaceDataPanel: true,
    raceDataTelemetryDetail: false,
    driverCamera: false,
    raceDataBanners: {
      initial: 'project',
      enabled: ['project', 'radio'],
    },
    raceDataBannerSize: 'custom',
    timingTowerVerticalFit: 'expand-race-view',
  },
  debug: {
    physicsModeIndicator: false,
  },
  theme: DEFAULT_PADDOCK_THEME_INPUT,
};

export const PADDOCK_SIMULATOR_PRESETS = {
  dashboard: {
    ui: {
      layoutPreset: 'standard',
      cameraControls: 'external',
      showFps: true,
      showTimingTower: true,
      showTelemetry: true,
      showRaceDataPanel: true,
      raceDataBannerSize: 'custom',
      timingTowerVerticalFit: 'expand-race-view',
    },
  },
  'timing-overlay': {
    ui: {
      layoutPreset: 'left-tower-overlay',
      cameraControls: 'external',
      showFps: false,
      showTimingTower: true,
      showTelemetry: true,
      showRaceDataPanel: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: {
        initial: 'project',
        enabled: ['project', 'radio'],
      },
    },
  },
  'compact-race': {
    ui: {
      layoutPreset: 'standard',
      cameraControls: 'external',
      showFps: false,
      showTimingTower: false,
      showTelemetry: false,
      showRaceDataPanel: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'scroll',
    },
    theme: {
      timingTowerMaxWidth: '340px',
      raceViewMinHeight: '460px',
    },
  },
  'full-dashboard': {
    ui: {
      layoutPreset: 'standard',
      cameraControls: 'external',
      showFps: true,
      showTimingTower: true,
      showTelemetry: true,
      telemetryIncludesOverview: true,
      showRaceDataPanel: true,
      raceDataBannerSize: 'custom',
      timingTowerVerticalFit: 'expand-race-view',
    },
  },
};

export { PADDOCK_THEME_CSS_VARIABLES, applyPaddockThemeCssVariables } from './themeOptions.js';

const SUPPORTED_CAMERA_MODES = new Set(['overview', 'leader', 'selected', 'driver', 'show-all', 'pit']);

export function resolveF1SimulatorOptions(options = {}) {
  const presetName = Object.hasOwn(PADDOCK_SIMULATOR_PRESETS, options.preset)
    ? options.preset
    : null;
  const preset = presetName ? PADDOCK_SIMULATOR_PRESETS[presetName] : {};
  const requestedUi = options.ui ?? {};
  const presetUi = preset.ui ?? {};
  const initialCameraMode = SUPPORTED_CAMERA_MODES.has(options.initialCameraMode)
    ? options.initialCameraMode
    : DEFAULT_F1_SIMULATOR_OPTIONS.initialCameraMode;
  const ui = {
    ...DEFAULT_F1_SIMULATOR_OPTIONS.ui,
    ...presetUi,
    ...requestedUi,
    raceDataBanners: {
      ...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners,
      ...(presetUi.raceDataBanners ?? {}),
      ...(requestedUi.raceDataBanners ?? {}),
    },
  };
  ui.driverCamera = Boolean(ui.driverCamera || initialCameraMode === 'driver');
  ui.raceDataBanners.enabled = normalizeEnabledBanners(ui.raceDataBanners.enabled);
  ui.telemetryModules = normalizeTelemetryModules(ui.telemetryModules);
  if (!['project', 'radio', 'hidden'].includes(ui.raceDataBanners.initial)) {
    ui.raceDataBanners.initial = DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.initial;
  }
  if (ui.raceDataBanners.initial !== 'hidden' && !ui.raceDataBanners.enabled.includes(ui.raceDataBanners.initial)) {
    ui.raceDataBanners.initial = 'hidden';
  }
  if (!['expand-race-view', 'scroll'].includes(ui.timingTowerVerticalFit)) {
    ui.timingTowerVerticalFit = DEFAULT_F1_SIMULATOR_OPTIONS.ui.timingTowerVerticalFit;
  }
  if (!['auto', 'custom'].includes(ui.raceDataBannerSize)) {
    ui.raceDataBannerSize = DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBannerSize;
  }
  ui.raceDataTelemetryDetail = Boolean(ui.raceDataTelemetryDetail);
  const debug = {
    ...DEFAULT_F1_SIMULATOR_OPTIONS.debug,
    ...(preset.debug ?? {}),
    ...(options.debug ?? {}),
  };
  debug.physicsModeIndicator = Boolean(debug.physicsModeIndicator);
  const mergedOptions = {
    ...DEFAULT_F1_SIMULATOR_OPTIONS,
    ...preset,
    ...options,
  };
  const drivers = normalizeSimulatorDrivers(mergedOptions.drivers, {
    entries: mergedOptions.entries ?? CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  });
  const theme = normalizePaddockTheme(mergeThemeInputs(
    DEFAULT_F1_SIMULATOR_OPTIONS.theme,
    preset.theme,
    collectDriverTeamThemes(drivers),
    options.theme,
  ));

  return {
    ...DEFAULT_F1_SIMULATOR_OPTIONS,
    ...preset,
    ...options,
    preset: presetName ?? options.preset,
    backLinkHref: normalizePublicUrlOption(
      mergedOptions.backLinkHref,
      DEFAULT_F1_SIMULATOR_OPTIONS.backLinkHref,
    ),
    physicsMode: normalizePhysicsMode(options.physicsMode ?? preset.physicsMode),
    warmup: normalizeWarmupOptions(mergedOptions.warmup, 'browser'),
    initialCameraMode,
    ui,
    debug,
    theme,
    drivers,
    assets: resolveF1SimulatorAssets(options.assets),
  };
}

function collectDriverTeamThemes(drivers = []) {
  const teamThemes = {};
  drivers.forEach((driver) => {
    const teamId = driver?.team?.id;
    const theme = driver?.team?.theme;
    if (typeof teamId === 'string' && teamId !== '' && typeof theme === 'string' && theme !== '') {
      teamThemes[teamId] = theme;
    }
  });
  return Object.keys(teamThemes).length > 0 ? { teamThemes } : {};
}

function normalizeEnabledBanners(value) {
  if (value === false) return [];
  if (value === true || value == null) return [...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.enabled];
  if (!Array.isArray(value)) return [...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.enabled];
  return [...new Set(value.filter((item) => item === 'project' || item === 'radio'))];
}

function normalizeTelemetryModules(value) {
  const defaults = DEFAULT_F1_SIMULATOR_OPTIONS.ui.telemetryModules;
  const names = Object.keys(defaults);
  if (value === false) {
    return Object.fromEntries(names.map((name) => [name, false]));
  }
  if (value === true || value == null) return { ...defaults };
  if (Array.isArray(value)) {
    const requested = new Set(value);
    return Object.fromEntries(names.map((name) => [name, requested.has(name)]));
  }
  if (typeof value !== 'object') return { ...defaults };
  return Object.fromEntries(names.map((name) => [
    name,
    value[name] == null ? defaults[name] : Boolean(value[name]),
  ]));
}
