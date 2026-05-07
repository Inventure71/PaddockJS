import { metersToSimUnits } from './units.js';

export const DEFAULT_RULES = {
  drsDetectionSeconds: 1,
  safetyCarSpeed: 46,
  safetyCarLeadDistance: 122,
  safetyCarGap: 128,
  collisionRestitution: 0.18,
  standingStart: true,
  startLightCount: 5,
  startLightInterval: 0.72,
  startLightsOutHold: 0.78,
};

const DEFAULT_MODULES = {
  pitStops: {
    enabled: false,
    pitLaneSpeedLimitKph: 80,
    defaultStopSeconds: 2.8,
    maxConcurrentPitLaneCars: 3,
    minimumPitLaneGapMeters: 20,
    doubleStacking: false,
    tirePitRequestThresholdPercent: 50,
    tirePitCommitThresholdPercent: 30,
  },
  tireStrategy: {
    enabled: false,
    compounds: ['S', 'M', 'H'],
    mandatoryDistinctDryCompounds: null,
  },
  penalties: {
    enabled: false,
    stewardStrictness: 1,
    trackLimits: {
      strictness: 0,
      warningsBeforePenalty: 3,
      timePenaltySeconds: 5,
      relaxedMarginMeters: 3,
    },
    collision: {
      strictness: 0,
      timePenaltySeconds: 5,
      minimumSeverity: 2,
      relaxedSeverityMargin: 6,
      minimumImpactSpeedKph: 20,
      relaxedImpactSpeedKph: 20,
    },
    tireRequirement: {
      strictness: 0,
      timePenaltySeconds: 10,
    },
    pitLaneSpeeding: {
      strictness: 0,
      speedLimitKph: 80,
      marginKph: 0.5,
      relaxedMarginKph: 5,
      timePenaltySeconds: 5,
    },
  },
  weather: {
    enabled: false,
  },
  reliability: {
    enabled: false,
  },
  fuelLoad: {
    enabled: false,
  },
};

const RULESET_MODULES = {
  paddock: DEFAULT_MODULES,
  custom: DEFAULT_MODULES,
  grandPrix2025: {
    ...DEFAULT_MODULES,
    pitStops: {
      ...DEFAULT_MODULES.pitStops,
      enabled: true,
      pitLaneSpeedLimitKph: 80,
    },
    tireStrategy: {
      ...DEFAULT_MODULES.tireStrategy,
      enabled: true,
      mandatoryDistinctDryCompounds: 2,
    },
    penalties: {
      ...DEFAULT_MODULES.penalties,
      enabled: true,
      stewardStrictness: 0.85,
      trackLimits: {
        ...DEFAULT_MODULES.penalties.trackLimits,
        strictness: 0.85,
      },
      collision: {
        ...DEFAULT_MODULES.penalties.collision,
        strictness: 0.65,
      },
      tireRequirement: {
        ...DEFAULT_MODULES.penalties.tireRequirement,
        strictness: 1,
      },
      pitLaneSpeeding: {
        ...DEFAULT_MODULES.penalties.pitLaneSpeeding,
        strictness: 1,
        speedLimitKph: 80,
      },
    },
    fuelLoad: {
      enabled: true,
    },
  },
};

RULESET_MODULES.fia2025 = RULESET_MODULES.grandPrix2025;

const MODULE_NAMES = Object.keys(DEFAULT_MODULES);
const PENALTY_SUBSECTIONS = ['trackLimits', 'collision', 'tireRequirement', 'pitLaneSpeeding'];
const CONSEQUENCE_TYPES = new Set([
  'warning',
  'time',
  'driveThrough',
  'stopGo',
  'positionDrop',
  'gridDrop',
  'disqualification',
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function mergeConfig(base, override) {
  if (!isPlainObject(override)) return clone(base);
  const next = clone(base);
  Object.entries(override).forEach(([key, value]) => {
    next[key] = isPlainObject(value) && isPlainObject(next[key])
      ? mergeConfig(next[key], value)
      : clone(value);
  });
  return next;
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function nonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function normalizeConsequences(value, fallbackSeconds) {
  const source = Array.isArray(value) && value.length
    ? value
    : [{ type: 'time', seconds: fallbackSeconds }];
  const normalized = source
    .map((consequence) => {
      const type = CONSEQUENCE_TYPES.has(consequence?.type) ? consequence.type : null;
      if (!type) return null;
      if (type === 'time') {
        return {
          type,
          seconds: positiveNumber(consequence.seconds, fallbackSeconds),
        };
      }
      if (type === 'driveThrough') {
        return {
          type,
          conversionSeconds: positiveNumber(consequence.conversionSeconds, 20),
        };
      }
      if (type === 'stopGo') {
        return {
          type,
          seconds: positiveNumber(consequence.seconds, 10),
          conversionSeconds: positiveNumber(consequence.conversionSeconds, 30),
        };
      }
      if (type === 'positionDrop' || type === 'gridDrop') {
        return {
          type,
          positions: nonNegativeInteger(consequence.positions, 1),
        };
      }
      return { type };
    })
    .filter(Boolean);
  return normalized.length ? normalized : [{ type: 'time', seconds: fallbackSeconds }];
}

function sumTimeConsequences(consequences) {
  return consequences.reduce((total, consequence) => (
    consequence.type === 'time' ? total + consequence.seconds : total
  ), 0);
}

function normalizePenaltyConfig(penalties) {
  const next = {
    ...penalties,
    enabled: Boolean(penalties.enabled),
    stewardStrictness: clamp01(penalties.stewardStrictness, 1),
  };

  PENALTY_SUBSECTIONS.forEach((name) => {
    next[name] = {
      ...penalties[name],
      strictness: clamp01(penalties[name]?.strictness, 0),
    };
  });

  next.trackLimits.warningsBeforePenalty = nonNegativeInteger(next.trackLimits.warningsBeforePenalty, 3);
  next.trackLimits.consequences = normalizeConsequences(next.trackLimits.consequences, positiveNumber(next.trackLimits.timePenaltySeconds, 5));
  next.trackLimits.timePenaltySeconds = sumTimeConsequences(next.trackLimits.consequences);
  next.trackLimits.relaxedMarginMeters = Math.max(0, Number(next.trackLimits.relaxedMarginMeters) || 0);
  next.trackLimits.relaxedMargin = metersToSimUnits(next.trackLimits.relaxedMarginMeters);

  next.collision.consequences = normalizeConsequences(next.collision.consequences, positiveNumber(next.collision.timePenaltySeconds, 5));
  next.collision.timePenaltySeconds = sumTimeConsequences(next.collision.consequences);
  next.collision.minimumSeverity = Math.max(0, Number(next.collision.minimumSeverity) || 0);
  next.collision.relaxedSeverityMargin = Math.max(0, Number(next.collision.relaxedSeverityMargin) || 0);
  next.collision.minimumImpactSpeedKph = Math.max(0, Number(next.collision.minimumImpactSpeedKph) || 0);
  next.collision.relaxedImpactSpeedKph = Math.max(0, Number(next.collision.relaxedImpactSpeedKph) || 0);
  next.collision.minimumImpactSpeed = metersToSimUnits(next.collision.minimumImpactSpeedKph / 3.6);
  next.collision.relaxedImpactSpeed = metersToSimUnits(next.collision.relaxedImpactSpeedKph / 3.6);
  next.tireRequirement.consequences = normalizeConsequences(next.tireRequirement.consequences, positiveNumber(next.tireRequirement.timePenaltySeconds, 10));
  next.tireRequirement.timePenaltySeconds = sumTimeConsequences(next.tireRequirement.consequences);
  next.pitLaneSpeeding.speedLimitKph = positiveNumber(next.pitLaneSpeeding.speedLimitKph, 80);
  next.pitLaneSpeeding.marginKph = Math.max(0, Number(next.pitLaneSpeeding.marginKph) || 0);
  next.pitLaneSpeeding.relaxedMarginKph = Math.max(0, Number(next.pitLaneSpeeding.relaxedMarginKph) || 0);
  next.pitLaneSpeeding.consequences = normalizeConsequences(next.pitLaneSpeeding.consequences, positiveNumber(next.pitLaneSpeeding.timePenaltySeconds, 5));
  next.pitLaneSpeeding.timePenaltySeconds = sumTimeConsequences(next.pitLaneSpeeding.consequences);

  next.enabled = next.enabled || PENALTY_SUBSECTIONS.some((name) => next[name].strictness > 0);
  return next;
}

function normalizeModules(modules, explicitModules = {}) {
  const next = mergeConfig(DEFAULT_MODULES, modules);
  const explicitPitSpeed = isPlainObject(explicitModules?.penalties?.pitLaneSpeeding) &&
    Object.hasOwn(explicitModules.penalties.pitLaneSpeeding, 'speedLimitKph');

  MODULE_NAMES.forEach((name) => {
    next[name] = {
      ...next[name],
      enabled: Boolean(next[name].enabled),
    };
  });

  next.pitStops.pitLaneSpeedLimitKph = positiveNumber(next.pitStops.pitLaneSpeedLimitKph, 80);
  next.pitStops.defaultStopSeconds = positiveNumber(next.pitStops.defaultStopSeconds, 2.8);
  next.pitStops.maxConcurrentPitLaneCars = positiveInteger(next.pitStops.maxConcurrentPitLaneCars, 3);
  next.pitStops.minimumPitLaneGapMeters = positiveNumber(next.pitStops.minimumPitLaneGapMeters, 20);
  next.pitStops.minimumPitLaneGap = metersToSimUnits(next.pitStops.minimumPitLaneGapMeters);
  next.pitStops.doubleStacking = Boolean(next.pitStops.doubleStacking);
  next.pitStops.tirePitRequestThresholdPercent = clamp01(
    Number(next.pitStops.tirePitRequestThresholdPercent) / 100,
    0.5,
  ) * 100;
  next.pitStops.tirePitCommitThresholdPercent = Math.min(
    next.pitStops.tirePitRequestThresholdPercent,
    clamp01(Number(next.pitStops.tirePitCommitThresholdPercent) / 100, 0.3) * 100,
  );

  next.tireStrategy.compounds = Array.isArray(next.tireStrategy.compounds) && next.tireStrategy.compounds.length
    ? [...next.tireStrategy.compounds]
    : ['S', 'M', 'H'];
  next.tireStrategy.mandatoryDistinctDryCompounds = next.tireStrategy.mandatoryDistinctDryCompounds == null
    ? null
    : nonNegativeInteger(next.tireStrategy.mandatoryDistinctDryCompounds, 0);

  next.penalties = normalizePenaltyConfig(next.penalties);
  if (!explicitPitSpeed) {
    next.penalties.pitLaneSpeeding.speedLimitKph = next.pitStops.pitLaneSpeedLimitKph;
  }
  return next;
}

export function normalizeRaceRules(rules = {}) {
  const requestedRuleset = rules?.ruleset ?? rules?.profile ?? 'paddock';
  const ruleset = Object.hasOwn(RULESET_MODULES, requestedRuleset) ? requestedRuleset : 'custom';
  const presetModules = RULESET_MODULES[ruleset] ?? RULESET_MODULES.custom;
  const modules = normalizeModules(mergeConfig(presetModules, rules.modules), rules.modules);
  const flatOverrides = Object.fromEntries(
    Object.entries(rules ?? {}).filter(([key]) => key !== 'ruleset' && key !== 'profile' && key !== 'modules'),
  );

  return {
    ...DEFAULT_RULES,
    ...flatOverrides,
    ruleset,
    modules,
  };
}

export function getPenaltyRule(rules, type) {
  const penalties = rules?.modules?.penalties;
  if (!penalties?.enabled) return null;
  const config = penalties[type];
  if (!config || config.strictness <= 0) return null;
  return {
    ...config,
    strictness: clamp01(config.strictness * penalties.stewardStrictness, config.strictness),
  };
}
