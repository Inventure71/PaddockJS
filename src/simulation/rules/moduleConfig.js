import { metersToSimUnits } from '../units.js';
import { DEFAULT_MODULES } from './ruleDefaults.js';
import { isPlainObject, clamp01, mergeConfig, nonNegativeInteger, positiveInteger, positiveNumber } from './ruleConfigMerge.js';
import { normalizePenaltyConfig } from './penaltyConfig.js';

const MODULE_NAMES = Object.keys(DEFAULT_MODULES);

export function normalizeModules(modules, explicitModules = {}) {
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
  next.pitStops.variability = {
    ...DEFAULT_MODULES.pitStops.variability,
    ...(isPlainObject(next.pitStops.variability) ? next.pitStops.variability : {}),
  };
  next.pitStops.variability.enabled = Boolean(next.pitStops.variability.enabled);
  next.pitStops.variability.perfect = Boolean(next.pitStops.variability.perfect);
  next.pitStops.variability.speedImpactSeconds = Math.max(
    0,
    Number(next.pitStops.variability.speedImpactSeconds) || DEFAULT_MODULES.pitStops.variability.speedImpactSeconds,
  );
  next.pitStops.variability.consistencyJitterSeconds = Math.max(
    0,
    Number(next.pitStops.variability.consistencyJitterSeconds) || DEFAULT_MODULES.pitStops.variability.consistencyJitterSeconds,
  );
  next.pitStops.variability.issueChance = clamp01(
    next.pitStops.variability.issueChance,
    DEFAULT_MODULES.pitStops.variability.issueChance,
  );
  next.pitStops.variability.issueMaxDelaySeconds = Math.max(
    0,
    Number(next.pitStops.variability.issueMaxDelaySeconds) || DEFAULT_MODULES.pitStops.variability.issueMaxDelaySeconds,
  );
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
