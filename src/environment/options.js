import { CHAMPIONSHIP_ENTRY_BLUEPRINTS } from '../data/championship.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { normalizePhysicsMode } from '../simulation/vehicle/vehiclePhysics.js';
import { normalizeWarmupOptions } from '../simulation/warmup/runtimeWarmup.js';
import { normalizeObservationOptions } from './observationOptions.js';
import { resolveScenarioPlacementConfig } from './scenarios.js';
import { normalizeRayOptions } from './sensors.js';

const DEFAULT_SEED = 1971;
const DEFAULT_FRAME_SKIP = 1;
const DEFAULT_MAX_STEPS = 10000;
const RESULT_STATE_OUTPUTS = new Set(['full', 'minimal', 'none']);
const RESET_OBSERVATION_SCOPES = new Set(['all', 'reset']);

const DEFAULT_SENSOR_OPTIONS = {
  rays: {
    enabled: true,
    anglesDegrees: [-135, -60, -20, 0, 20, 60, 135, 180],
    lengthMeters: 120,
    detectTrack: true,
    detectCars: true,
  },
  nearbyCars: {
    enabled: true,
    maxCars: 6,
    radiusMeters: 150,
  },
};

export function resolveEnvironmentOptions(options = {}) {
  if (!Array.isArray(options.controlledDrivers) || options.controlledDrivers.length === 0) {
    throw new Error('PaddockJS environment controlledDrivers is required.');
  }

  const seed = normalizeSeed(options.seed, createGeneratedSeed);
  const trackSeed = normalizeSeed(options.trackSeed, createGeneratedSeed);
  const normalizedDrivers = normalizeSimulatorDrivers(options.drivers, {
    entries: options.entries ?? CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    caller: 'createPaddockEnvironment',
  });
  const resolved = {
    ...options,
    seed,
    trackSeed,
    trackGeneration: options.trackGeneration ?? {},
    totalLaps: options.totalLaps,
    drivers: normalizedDrivers,
  };
  const driverIds = new Set(resolved.drivers.map((driver) => driver.id));
  const controlledDrivers = [...new Set(options.controlledDrivers)];

  controlledDrivers.forEach((driverId) => {
    if (!driverIds.has(driverId)) {
      throw new Error(`PaddockJS environment controlled driver does not exist: ${driverId}`);
    }
  });

  const scenario = resolveScenario(options.scenario, controlledDrivers, driverIds);
  const participants = resolveParticipants(scenario.participants, controlledDrivers, resolved.drivers);
  const participantDrivers = resolved.drivers.filter((driver) => participants.has(driver.id));
  const participantIds = new Set(participantDrivers.map((driver) => driver.id));

  controlledDrivers.forEach((driverId) => {
    if (!participantIds.has(driverId)) {
      throw new Error(`PaddockJS environment controlled driver must be included in scenario participants: ${driverId}`);
    }
  });

  const externalRenderer = normalizeExternalRenderer(options.externalRenderer);

  return {
    ...resolved,
    physicsMode: normalizePhysicsMode(options.physicsMode),
    warmup: normalizeWarmupOptions(options.warmup, 'environment'),
    drivers: participantDrivers,
    controlledDrivers,
    frameSkip: normalizePositiveInteger(options.frameSkip, DEFAULT_FRAME_SKIP, 'frameSkip'),
    actionPolicy: options.actionPolicy === 'report' ? 'report' : 'strict',
    scenario,
    observation: {
      ...normalizeObservationOptions(options.observation ?? {}),
    },
    sensors: mergeSensorOptions(options.sensors),
    sensorsByDriver: options.sensorsByDriver ?? {},
    episode: {
      maxSteps: normalizePositiveInteger(options.episode?.maxSteps, DEFAULT_MAX_STEPS, 'episode.maxSteps'),
      endOnRaceFinish: options.episode?.endOnRaceFinish !== false,
    },
    result: normalizeResultOptions(options.result),
    reward: typeof options.reward === 'function' ? options.reward : null,
    externalRenderer,
  };
}

export function normalizeResultOptions(result = {}) {
  const stateOutput = RESULT_STATE_OUTPUTS.has(result.stateOutput) ? result.stateOutput : 'full';
  const resetDriversObservationScope = RESET_OBSERVATION_SCOPES.has(result.resetDriversObservationScope)
    ? result.resetDriversObservationScope
    : 'all';
  return {
    ...result,
    stateOutput,
    resetDriversObservationScope,
  };
}

function normalizeSeed(value, fallbackFactory) {
  if (value == null) return fallbackFactory();
  const number = Number(value);
  return Number.isFinite(number) ? number : DEFAULT_SEED;
}

function createGeneratedSeed() {
  const values = new Uint32Array(1);
  try {
    globalThis.crypto?.getRandomValues?.(values);
  } catch {
    values[0] = 0;
  }
  return (values[0] || Math.floor(Date.now() + performance.now() * 1000)) >>> 0;
}

function resolveScenario(scenario = {}, controlledDrivers, driverIds) {
  const participants = scenario.participants ?? 'all';
  if (
    participants !== 'all' &&
    participants !== 'controlled-only' &&
    !Array.isArray(participants)
  ) {
    throw new Error('PaddockJS environment scenario.participants must be "all", "controlled-only", or an array of driver ids.');
  }
  if (scenario.nonControlled != null && scenario.nonControlled !== 'ai') {
    throw new Error('PaddockJS environment first slice only supports scenario.nonControlled: "ai".');
  }
  if (Array.isArray(participants)) {
    participants.forEach((driverId) => {
      if (!driverIds.has(driverId)) {
        throw new Error(`PaddockJS environment scenario participant does not exist: ${driverId}`);
      }
    });
    controlledDrivers.forEach((driverId) => {
      if (!participants.includes(driverId)) {
        throw new Error(`PaddockJS environment controlled driver must be included in scenario participants: ${driverId}`);
      }
    });
  }
  return {
    participants,
    nonControlled: 'ai',
    ...resolveScenarioPlacementConfig(scenario, driverIds),
  };
}

function resolveParticipants(participants, controlledDrivers, drivers) {
  if (participants === 'controlled-only') return new Set(controlledDrivers);
  if (Array.isArray(participants)) return new Set(participants);
  return new Set(drivers.map((driver) => driver.id));
}

function normalizePositiveInteger(value, fallback, label) {
  if (value == null) return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`PaddockJS environment ${label} must be a positive integer.`);
  }
  return number;
}

function mergeSensorOptions(sensors = {}) {
  return {
    rays: normalizeRayOptions({
      ...DEFAULT_SENSOR_OPTIONS.rays,
      ...(sensors.rays ?? {}),
    }),
    nearbyCars: {
      ...DEFAULT_SENSOR_OPTIONS.nearbyCars,
      ...(sensors.nearbyCars ?? {}),
    },
  };
}

function normalizeExternalRenderer(value) {
  if (value == null) return null;
  if (typeof value === 'function') return { onFrame: value };
  if (typeof value === 'object' && typeof value.onFrame === 'function') {
    return { onFrame: value.onFrame };
  }
  throw new Error('PaddockJS environment externalRenderer must be a function or an object with onFrame(frame).');
}
