import { DEFAULT_F1_SIMULATOR_OPTIONS } from './simulatorDefaults.js';
import { normalizeTelemetryModules } from './telemetryModules.js';
import { normalizeTimingGapMode } from './timingGapMode.js';

export function resolveSimulatorUiOptions(requestedUi = {}, presetUi = {}, initialCameraMode = 'leader') {
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
  ui.telemetryModules = normalizeTelemetryModules(ui.telemetryModules, DEFAULT_F1_SIMULATOR_OPTIONS.ui.telemetryModules);
  if (!['project', 'radio', 'hidden'].includes(ui.raceDataBanners.initial)) {
    ui.raceDataBanners.initial = DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.initial;
  }
  if (ui.raceDataBanners.initial !== 'hidden' && !ui.raceDataBanners.enabled.includes(ui.raceDataBanners.initial)) {
    ui.raceDataBanners.initial = 'hidden';
  }
  if (!['expand-race-view', 'scroll'].includes(ui.timingTowerVerticalFit)) {
    ui.timingTowerVerticalFit = DEFAULT_F1_SIMULATOR_OPTIONS.ui.timingTowerVerticalFit;
  }
  ui.timingGapMode = normalizeTimingGapMode(ui.timingGapMode);
  ui.timingGapModeToggle = ui.timingGapModeToggle !== false;
  ui.timingEntryVerticalPadding = normalizeNonNegativeFiniteNumber(
    ui.timingEntryVerticalPadding,
    DEFAULT_F1_SIMULATOR_OPTIONS.ui.timingEntryVerticalPadding,
  );
  ui.responsiveNarrowLayout = ui.responsiveNarrowLayout !== false;
  if (!['auto', 'custom'].includes(ui.raceDataBannerSize)) {
    ui.raceDataBannerSize = DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBannerSize;
  }
  ui.raceDataTelemetryDetail = Boolean(ui.raceDataTelemetryDetail);
  return ui;
}

function normalizeNonNegativeFiniteNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
}

function normalizeEnabledBanners(value) {
  if (value === false) return [];
  if (value === true || value == null) return [...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.enabled];
  if (!Array.isArray(value)) return [...DEFAULT_F1_SIMULATOR_OPTIONS.ui.raceDataBanners.enabled];
  return [...new Set(value.filter((item) => item === 'project' || item === 'radio'))];
}
