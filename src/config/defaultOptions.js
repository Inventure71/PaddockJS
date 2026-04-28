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
    showRaceDataPanel: true,
  },
};

export function resolveF1SimulatorOptions(options = {}) {
  const ui = {
    ...DEFAULT_F1_SIMULATOR_OPTIONS.ui,
    ...(options.ui ?? {}),
  };
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
