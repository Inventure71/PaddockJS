import { DEFAULT_F1_SIMULATOR_OPTIONS, PADDOCK_SIMULATOR_PRESETS } from './simulatorDefaults.js';
import { resolveSimulatorUiOptions } from './uiOptions.js';
export { DEFAULT_F1_SIMULATOR_OPTIONS, PADDOCK_SIMULATOR_PRESETS } from './simulatorDefaults.js';
import { resolveF1SimulatorAssets } from './defaultAssets.js';
import { CHAMPIONSHIP_ENTRY_BLUEPRINTS } from '../data/championship.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { normalizePhysicsMode } from '../simulation/vehicle/vehiclePhysics.js';
import { normalizeWarmupOptions } from '../simulation/warmup/runtimeWarmup.js';
import {
  mergeThemeInputs,
  normalizePaddockTheme,
} from './themeOptions.js';
import { normalizePublicUrlOption } from './urlOptions.js';

export {
  DEFAULT_PADDOCK_THEME,
  PADDOCK_THEME_CSS_VARIABLES,
  PADDOCK_THEME_TOKEN_KEYS,
  applyPaddockTheme,
  applyPaddockThemeCssVariables,
  resolvePaddockTheme,
} from './themeOptions.js';

const SUPPORTED_CAMERA_MODES = new Set(['overview', 'leader', 'selected', 'driver', 'show-all', 'pit']);

export function resolveF1SimulatorOptions(options = {}) {
  if (options.gridWalk?.enabled && options.expert?.enabled) {
    throw new Error('Grid Walk requires normal browser playback; expert mode owns its own simulation lifecycle.');
  }
  const presetName = Object.hasOwn(PADDOCK_SIMULATOR_PRESETS, options.preset)
    ? options.preset
    : null;
  const preset = presetName ? PADDOCK_SIMULATOR_PRESETS[presetName] : {};
  const requestedUi = options.ui ?? {};
  const presetUi = preset.ui ?? {};
  const initialCameraMode = SUPPORTED_CAMERA_MODES.has(options.initialCameraMode)
    ? options.initialCameraMode
    : DEFAULT_F1_SIMULATOR_OPTIONS.initialCameraMode;
  const ui = resolveSimulatorUiOptions(requestedUi, presetUi, initialCameraMode);
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
    gridWalk: {
      enabled: options.gridWalk?.enabled === true,
      initialView: options.gridWalk?.initialView === 'race' ? 'race' : 'grid-walk',
      ambientMotion: options.gridWalk?.ambientMotion !== false,
    },
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
