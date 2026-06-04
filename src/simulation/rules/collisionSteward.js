import { simSpeedToKph } from '../units.js';

export function calculateCollisionPenalties({ first, second, collision = null, rule }) {
  const penalties = [];
  emitCollisionPenalties({
    first,
    second,
    collision,
    rule,
    emit: (penalty) => {
      penalties.push(penalty);
    },
  });
  return penalties;
}

export function emitCollisionPenalties({ first, second, collision = null, rule, emit, emitContext = null }) {
  if (!rule || typeof emit !== 'function') return 0;
  const severity = collision?.depth ?? 0;
  const severityThreshold = (rule.minimumSeverity ?? 0) + (rule.relaxedSeverityMargin ?? 0) * (1 - rule.strictness);
  const impactSpeed = collision?.impactSpeed ?? 0;
  const impactSpeedThreshold = (rule.minimumImpactSpeed ?? 0) + (rule.relaxedImpactSpeed ?? 0) * (1 - rule.strictness);
  const atFaultDriverId = collision?.atFaultDriverId ?? null;
  const aheadDriverId = collision?.aheadDriverId ?? null;
  const sharedFaultDriverIds = Array.isArray(collision?.sharedFaultDriverIds)
    ? collision.sharedFaultDriverIds
    : [];

  if (severity < severityThreshold) return 0;
  if (impactSpeed < impactSpeedThreshold) return 0;

  let emitted = 0;
  if (sharedFaultDriverIds.length > 0) {
    for (let index = 0; index < sharedFaultDriverIds.length; index += 1) {
      const driverId = sharedFaultDriverIds[index];
      const car = first.id === driverId ? first : second.id === driverId ? second : null;
      if (!car) continue;
      const other = first.id === driverId ? second : first;
      emit(buildCollisionPenalty(car, other, rule, {
        severity,
        severityThreshold,
        impactSpeed,
        impactSpeedThreshold,
        aheadDriverId: null,
        atFaultDriverId: driverId,
        sharedFault: true,
        reason: 'Unclear collision responsibility',
      }), emitContext);
      emitted += 1;
    }
    return emitted;
  }

  if (!atFaultDriverId || !aheadDriverId) return 0;

  const atFault = first.id === atFaultDriverId ? first : second;
  const other = first.id === atFaultDriverId ? second : first;
  emit(buildCollisionPenalty(atFault, other, rule, {
    severity,
    severityThreshold,
    impactSpeed,
    impactSpeedThreshold,
    aheadDriverId,
    atFaultDriverId,
  }), emitContext);
  return 1;
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
