import {
  GENERATED_FALLBACK_ATTEMPTS,
  GENERATED_TRACK_ATTEMPTS,
  GENERATED_TRACK_MAX_LENGTH,
  GENERATED_TRACK_MIN_LENGTH,
  MAX_LOCAL_TURN_RADIANS,
  MAX_SAMPLE_HEADING_DELTA_RADIANS,
  MIN_NON_ADJACENT_ARC_DISTANCE,
  MIN_TRACK_CLEARANCE_MULTIPLIER,
  MIN_TRACK_SHAPE_VARIATION,
  START_STRAIGHT_BLEND_LENGTH,
  START_STRAIGHT_EXIT_LENGTH,
  START_STRAIGHT_GRID_LENGTH,
  START_STRAIGHT_LOCK_EXTRA,
} from './trackConstants.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';

export const PROCEDURAL_TRACK_PROFILES = {
  race: {},
  'training-short': {
    length: { minMeters: 900, maxMeters: 1800 },
    startStraight: { gridMeters: 0, exitMeters: 80, blendMeters: 80, lockExtraMeters: 0 },
    pitLane: { enabled: false },
    shape: { scale: 0.2, cornerDensity: 1.3, variation: 0.22 },
    validation: {
      minClearanceMultiplier: 1,
      minNonAdjacentArcMeters: 160,
      maxLocalTurnRadians: 1.85,
    },
    attempts: { primary: 80, fallback: 200 },
  },
  'training-medium': {
    length: { minMeters: 1600, maxMeters: 3000 },
    startStraight: { gridMeters: 80, exitMeters: 140, blendMeters: 120, lockExtraMeters: 0 },
    pitLane: { enabled: false },
    shape: { scale: 0.38, cornerDensity: 1.18, variation: 0.24 },
    validation: {
      minClearanceMultiplier: 1.15,
      minNonAdjacentArcMeters: 260,
      maxLocalTurnRadians: 1.7,
    },
    attempts: { primary: 80, fallback: 200 },
  },
  'training-technical': {
    length: { minMeters: 800, maxMeters: 1700 },
    startStraight: { gridMeters: 0, exitMeters: 60, blendMeters: 70, lockExtraMeters: 0 },
    pitLane: { enabled: false },
    shape: { scale: 0.18, cornerDensity: 1.55, variation: 0.2 },
    validation: {
      minClearanceMultiplier: 0.9,
      minNonAdjacentArcMeters: 140,
      maxLocalTurnRadians: 2.05,
    },
    attempts: { primary: 100, fallback: 240 },
  },
};

const RACE_DEFAULTS = {
  profile: 'race',
  length: {
    min: GENERATED_TRACK_MIN_LENGTH,
    max: GENERATED_TRACK_MAX_LENGTH,
  },
  startStraight: {
    grid: START_STRAIGHT_GRID_LENGTH,
    exit: START_STRAIGHT_EXIT_LENGTH,
    blend: START_STRAIGHT_BLEND_LENGTH,
    lockExtra: START_STRAIGHT_LOCK_EXTRA,
  },
  pitLane: {
    enabled: true,
  },
  shape: {
    scale: 1,
    cornerDensity: 1,
    variation: MIN_TRACK_SHAPE_VARIATION,
  },
  validation: {
    minClearanceMultiplier: MIN_TRACK_CLEARANCE_MULTIPLIER,
    minShapeVariation: MIN_TRACK_SHAPE_VARIATION,
    minNonAdjacentArcDistance: MIN_NON_ADJACENT_ARC_DISTANCE,
    maxLocalTurnRadians: MAX_LOCAL_TURN_RADIANS,
    maxSampleHeadingDeltaRadians: MAX_SAMPLE_HEADING_DELTA_RADIANS,
  },
  attempts: {
    primary: GENERATED_FALLBACK_ATTEMPTS,
    fallback: GENERATED_TRACK_ATTEMPTS,
  },
};

export function resolveProceduralTrackOptions(options = {}) {
  const requestedProfile = options.profile ?? 'race';
  if (!Object.hasOwn(PROCEDURAL_TRACK_PROFILES, requestedProfile)) {
    throw new Error(`Unsupported procedural track profile: ${requestedProfile}`);
  }

  const expanded = expandLegacyTrackOptions(options);
  const profile = expandLegacyTrackOptions(PROCEDURAL_TRACK_PROFILES[requestedProfile]);
  const merged = deepMerge(deepMerge({ profile: requestedProfile }, profile), expanded);

  const resolved = {
    profile: requestedProfile,
    length: {
      min: positiveMetersToSimUnits(merged.length?.minMeters, RACE_DEFAULTS.length.min, 'length.minMeters'),
      max: positiveMetersToSimUnits(merged.length?.maxMeters, RACE_DEFAULTS.length.max, 'length.maxMeters'),
    },
    startStraight: {
      grid: nonNegativeMetersToSimUnits(merged.startStraight?.gridMeters, RACE_DEFAULTS.startStraight.grid, 'startStraight.gridMeters'),
      exit: nonNegativeMetersToSimUnits(merged.startStraight?.exitMeters, RACE_DEFAULTS.startStraight.exit, 'startStraight.exitMeters'),
      blend: nonNegativeMetersToSimUnits(merged.startStraight?.blendMeters, RACE_DEFAULTS.startStraight.blend, 'startStraight.blendMeters'),
      lockExtra: nonNegativeMetersToSimUnits(merged.startStraight?.lockExtraMeters, RACE_DEFAULTS.startStraight.lockExtra, 'startStraight.lockExtraMeters'),
    },
    pitLane: {
      enabled: merged.pitLane?.enabled !== false,
    },
    shape: {
      scale: positiveNumber(merged.shape?.scale, RACE_DEFAULTS.shape.scale, 'shape.scale'),
      cornerDensity: positiveNumber(merged.shape?.cornerDensity, RACE_DEFAULTS.shape.cornerDensity, 'shape.cornerDensity'),
      variation: nonNegativeNumber(merged.shape?.variation, RACE_DEFAULTS.shape.variation, 'shape.variation'),
    },
    validation: {
      minClearanceMultiplier: nonNegativeNumber(
        merged.validation?.minClearanceMultiplier,
        RACE_DEFAULTS.validation.minClearanceMultiplier,
        'validation.minClearanceMultiplier',
      ),
      minShapeVariation: nonNegativeNumber(
        merged.validation?.minShapeVariation ?? merged.shape?.variation,
        RACE_DEFAULTS.validation.minShapeVariation,
        'validation.minShapeVariation',
      ),
      minNonAdjacentArcDistance: nonNegativeMetersToSimUnits(
        merged.validation?.minNonAdjacentArcMeters,
        RACE_DEFAULTS.validation.minNonAdjacentArcDistance,
        'validation.minNonAdjacentArcMeters',
      ),
      maxLocalTurnRadians: positiveNumber(
        merged.validation?.maxLocalTurnRadians,
        RACE_DEFAULTS.validation.maxLocalTurnRadians,
        'validation.maxLocalTurnRadians',
      ),
      maxSampleHeadingDeltaRadians: positiveNumber(
        merged.validation?.maxSampleHeadingDeltaRadians,
        RACE_DEFAULTS.validation.maxSampleHeadingDeltaRadians,
        'validation.maxSampleHeadingDeltaRadians',
      ),
    },
    attempts: {
      primary: positiveInteger(merged.attempts?.primary, RACE_DEFAULTS.attempts.primary, 'attempts.primary'),
      fallback: positiveInteger(merged.attempts?.fallback, RACE_DEFAULTS.attempts.fallback, 'attempts.fallback'),
    },
  };

  if (resolved.length.min > resolved.length.max) {
    throw new Error('Procedural track length.minMeters must be less than or equal to length.maxMeters.');
  }
  resolved.cacheKey = stableTrackGenerationCacheKey(resolved);
  return resolved;
}

export function stableTrackGenerationCacheKey(options) {
  return JSON.stringify({
    profile: options.profile,
    length: {
      minMeters: roundMeters(options.length.min),
      maxMeters: roundMeters(options.length.max),
    },
    startStraight: {
      gridMeters: roundMeters(options.startStraight.grid),
      exitMeters: roundMeters(options.startStraight.exit),
      blendMeters: roundMeters(options.startStraight.blend),
      lockExtraMeters: roundMeters(options.startStraight.lockExtra),
    },
    pitLane: { enabled: options.pitLane.enabled },
    shape: {
      scale: roundNumber(options.shape.scale),
      cornerDensity: roundNumber(options.shape.cornerDensity),
      variation: roundNumber(options.shape.variation),
    },
    validation: {
      minClearanceMultiplier: roundNumber(options.validation.minClearanceMultiplier),
      minShapeVariation: roundNumber(options.validation.minShapeVariation),
      minNonAdjacentArcMeters: roundMeters(options.validation.minNonAdjacentArcDistance),
      maxLocalTurnRadians: roundNumber(options.validation.maxLocalTurnRadians),
      maxSampleHeadingDeltaRadians: roundNumber(options.validation.maxSampleHeadingDeltaRadians),
    },
    attempts: options.attempts,
  });
}

function expandLegacyTrackOptions(options = {}) {
  const next = { ...options };
  if (options.minLengthMeters != null || options.maxLengthMeters != null) {
    next.length = {
      ...(options.length ?? {}),
      ...(options.minLengthMeters != null ? { minMeters: options.minLengthMeters } : {}),
      ...(options.maxLengthMeters != null ? { maxMeters: options.maxLengthMeters } : {}),
    };
  }
  if (options.startStraightMeters != null) {
    next.startStraight = {
      ...(options.startStraight ?? {}),
      gridMeters: options.startStraightMeters,
      exitMeters: options.startStraightMeters,
    };
  }
  if (options.includePitLane != null) {
    next.pitLane = {
      ...(options.pitLane ?? {}),
      enabled: Boolean(options.includePitLane),
    };
  }
  return next;
}

function deepMerge(base, override) {
  const result = { ...base };
  Object.entries(override ?? {}).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
      return;
    }
    if (value !== undefined) result[key] = value;
  });
  return result;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function positiveMetersToSimUnits(value, fallback, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Procedural track ${label} must be a positive number.`);
  }
  return metersToSimUnits(number);
}

function nonNegativeMetersToSimUnits(value, fallback, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Procedural track ${label} must be a non-negative number.`);
  }
  return metersToSimUnits(number);
}

function positiveNumber(value, fallback, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Procedural track ${label} must be a positive number.`);
  }
  return number;
}

function nonNegativeNumber(value, fallback, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Procedural track ${label} must be a non-negative number.`);
  }
  return number;
}

function positiveInteger(value, fallback, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Procedural track ${label} must be a positive integer.`);
  }
  return number;
}

function roundMeters(value) {
  return roundNumber(simUnitsToMeters(value));
}

function roundNumber(value) {
  return Math.round(value * 1e6) / 1e6;
}
