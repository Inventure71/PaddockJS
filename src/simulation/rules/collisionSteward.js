import { simSpeedToKph } from '../units.js';

export function calculateCollisionPenalties({ first, second, collision = null, rule }) {
  if (!rule) return [];
  const severity = collision?.depth ?? 0;
  const severityThreshold = (rule.minimumSeverity ?? 0) + (rule.relaxedSeverityMargin ?? 0) * (1 - rule.strictness);
  const impactSpeed = collision?.impactSpeed ?? 0;
  const impactSpeedThreshold = (rule.minimumImpactSpeed ?? 0) + (rule.relaxedImpactSpeed ?? 0) * (1 - rule.strictness);
  const atFaultDriverId = collision?.atFaultDriverId ?? null;
  const aheadDriverId = collision?.aheadDriverId ?? null;
  const sharedFaultDriverIds = Array.isArray(collision?.sharedFaultDriverIds)
    ? collision.sharedFaultDriverIds
    : [];

  if (severity < severityThreshold) return [];
  if (impactSpeed < impactSpeedThreshold) return [];

  if (sharedFaultDriverIds.length > 0) {
    return sharedFaultDriverIds
      .map((driverId) => {
        const car = first.id === driverId ? first : second.id === driverId ? second : null;
        if (!car) return null;
        const other = first.id === driverId ? second : first;
        return buildCollisionPenalty(car, other, rule, {
          severity,
          severityThreshold,
          impactSpeed,
          impactSpeedThreshold,
          aheadDriverId: null,
          atFaultDriverId: driverId,
          sharedFault: true,
          reason: 'Unclear collision responsibility',
        });
      })
      .filter(Boolean);
  }

  if (!atFaultDriverId || !aheadDriverId) return [];

  const atFault = first.id === atFaultDriverId ? first : second;
  const other = first.id === atFaultDriverId ? second : first;
  return [buildCollisionPenalty(atFault, other, rule, {
    severity,
    severityThreshold,
    impactSpeed,
    impactSpeedThreshold,
    aheadDriverId,
    atFaultDriverId,
  })];
}

function buildCollisionPenalty(car, other, rule, context) {
  return {
    type: 'collision',
    driverId: car.id,
    otherCarId: other.id,
    aheadDriverId: context.aheadDriverId,
    atFaultDriverId: context.atFaultDriverId,
    strictness: rule.strictness,
    penaltySeconds: rule.timePenaltySeconds,
    consequences: rule.consequences,
    severity: context.severity,
    threshold: context.severityThreshold,
    impactSpeedKph: simSpeedToKph(context.impactSpeed),
    impactSpeedThresholdKph: simSpeedToKph(context.impactSpeedThreshold),
    sharedFault: Boolean(context.sharedFault),
    reason: context.reason ?? 'Avoidable contact with car ahead',
  };
}
