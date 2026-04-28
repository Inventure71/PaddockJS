import { resolveF1SimulatorAssets } from './defaultAssets.js';
import { CHAMPIONSHIP_ENTRY_BLUEPRINTS } from '../data/championship.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';

export const DEFAULT_F1_SIMULATOR_OPTIONS = {
  seed: 1971,
  totalLaps: 10,
  initialCameraMode: 'leader',
  title: 'F1 Simulator Lab',
  kicker: 'Race Control',
  backLinkHref: 'projects.html',
  backLinkLabel: 'Projects',
  showBackLink: true,
  ui: {
    layoutPreset: 'standard',
    cameraControls: 'embedded',
    showFps: true,
    showTimingTower: true,
    showTelemetry: true,
    telemetryIncludesOverview: true,
    showRaceDataPanel: true,
    raceDataBanners: {
      initial: 'project',
      enabled: ['project', 'radio'],
    },
    timingTowerVerticalFit: 'expand-race-view',
  },
};

export function resolveF1SimulatorOptions(options = {}) {
  const requestedUi = options.ui ?? {};
  const ui = {
    ...DEFAULT_F1_SIMULATOR_OPTIONS.ui,
    ...requestedUi,
    raceDataBanners: {
      ...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners,
      ...(requestedUi.raceDataBanners ?? {}),
    },
  };
  ui.raceDataBanners.enabled = normalizeEnabledBanners(ui.raceDataBanners.enabled);
  if (!['project', 'radio', 'hidden'].includes(ui.raceDataBanners.initial)) {
    ui.raceDataBanners.initial = DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.initial;
  }
  if (ui.raceDataBanners.initial !== 'hidden' && !ui.raceDataBanners.enabled.includes(ui.raceDataBanners.initial)) {
    ui.raceDataBanners.initial = 'hidden';
  }
  if (!['expand-race-view', 'scroll'].includes(ui.timingTowerVerticalFit)) {
    ui.timingTowerVerticalFit = DEFAULT_F1_SIMULATOR_OPTIONS.ui.timingTowerVerticalFit;
  }
  const drivers = normalizeSimulatorDrivers(options.drivers, {
    entries: options.entries ?? CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  });

  return {
    ...DEFAULT_F1_SIMULATOR_OPTIONS,
    ...options,
    ui,
    drivers,
    assets: resolveF1SimulatorAssets(options.assets),
  };
}

function normalizeEnabledBanners(value) {
  if (value === false) return [];
  if (value === true || value == null) return [...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.enabled];
  if (!Array.isArray(value)) return [...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.enabled];
  return [...new Set(value.filter((item) => item === 'project' || item === 'radio'))];
}
