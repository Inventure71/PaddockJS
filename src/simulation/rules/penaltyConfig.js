import { metersToSimUnits } from '../units.js';
import { clamp01, nonNegativeInteger, positiveNumber } from './ruleConfigMerge.js';

export const PENALTY_SUBSECTIONS = ['trackLimits', 'collision', 'tireRequirement', 'pitLaneSpeeding'];

const CONSEQUENCE_TYPES = new Set([
  'warning',
  'time',
  'driveThrough',
  'stopGo',
  'positionDrop',
  'gridDrop',
  'disqualification',
]);

export function normalizePenaltyConfig(penalties) {
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
