import { DEFAULT_PADDOCK_THEME_INPUT } from './theme/themeTokens.js';
import { DEFAULT_TELEMETRY_MODULES } from './telemetryModules.js';

export const DEFAULT_F1_SIMULATOR_OPTIONS = {
  seed: 1971,
  physicsMode: 'arcade',
  warmup: {
    enabled: true,
    policy: 'config-change',
  },
  totalLaps: 10,
  initialCameraMode: 'leader',
  gridWalk: { enabled: false, initialView: 'grid-walk', ambientMotion: true },
  title: 'F1 Simulator Lab',
  kicker: 'Race Control',
  backLinkHref: 'projects.html',
  backLinkLabel: 'Projects',
  showBackLink: true,
  ui: {
    layoutPreset: 'standard',
    cameraControls: 'external',
    viewControls: 'switch',
    showFps: true,
    showTimingTower: true,
    showTelemetry: true,
    telemetryIncludesOverview: true,
    telemetryModules: { ...DEFAULT_TELEMETRY_MODULES },
    showRaceDataPanel: true,
    raceDataTelemetryDetail: false,
    driverCamera: false,
    raceDataBanners: {
      initial: 'project',
      enabled: ['project', 'radio'],
    },
    raceDataBannerSize: 'custom',
    timingTowerVerticalFit: 'expand-race-view',
    timingGapMode: 'interval',
    timingGapModeToggle: true,
    timingEntryVerticalPadding: 5,
    responsiveNarrowLayout: true,
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
