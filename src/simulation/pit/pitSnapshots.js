import { finiteOrNull } from '../vehicle/vehicleSnapshots.js';

export function pitLaneStatusSnapshot(raceControl, pitLane, pitStops) {
  const enabled = Boolean(pitLane?.enabled && pitStops?.enabled);
  const redFlag = Boolean(raceControl.redFlag);
  const open = enabled && Boolean(raceControl.pitLaneOpen) && !redFlag;
  return {
    enabled,
    open,
    reason: !enabled ? 'unavailable' : redFlag ? 'red-flag' : open ? 'open' : 'closed',
    color: open ? 'green' : redFlag ? 'yellow' : 'red',
    light: open ? '#22c55e' : redFlag ? '#facc15' : '#ef4444',
  };
}

export function serializePitStop(pitStop, normalizePitIntent, PIT_INTENT_NONE) {
  if (!pitStop) return null;
  return {
    status: pitStop.status,
    intent: normalizePitIntent(pitStop.intent) ?? PIT_INTENT_NONE,
    phase: pitStop.phase ?? null,
    boxIndex: pitStop.boxIndex,
    boxId: pitStop.boxId,
    garageBoxIndex: pitStop.garageBoxIndex ?? null,
    garageBoxId: pitStop.garageBoxId ?? null,
    teamId: pitStop.teamId ?? null,
    teamColor: pitStop.teamColor ?? null,
    stopsCompleted: pitStop.stopsCompleted ?? 0,
    queueingForService: Boolean(pitStop.queueingForService),
    plannedRaceDistance: finiteOrNull(pitStop.plannedRaceDistance),
    entryRaceDistance: finiteOrNull(pitStop.entryRaceDistance),
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    penaltyServiceRemainingSeconds: finiteOrNull(pitStop.penaltyServiceRemaining),
    penaltyServiceTotalSeconds: finiteOrNull(pitStop.penaltyServiceTotal),
    servingPenaltyIds: [...(pitStop.servingPenaltyIds ?? [])],
    targetTire: pitStop.targetTire ?? null,
    serviceProfile: pitStop.serviceProfile ? { ...pitStop.serviceProfile } : null,
  };
}

export function serializeRenderPitStop(pitStop) {
  if (!pitStop) return null;
  return {
    phase: pitStop.phase ?? null,
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    penaltyServiceRemainingSeconds: finiteOrNull(pitStop.penaltyServiceRemaining),
  };
}

export function serializeObservationPitStop(pitStop, normalizePitIntent, PIT_INTENT_NONE) {
  if (!pitStop) return null;
  return {
    status: pitStop.status,
    intent: normalizePitIntent(pitStop.intent) ?? PIT_INTENT_NONE,
    phase: pitStop.phase ?? null,
    targetTire: pitStop.targetTire ?? null,
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    penaltyServiceRemainingSeconds: finiteOrNull(pitStop.penaltyServiceRemaining),
    stopsCompleted: pitStop.stopsCompleted ?? 0,
  };
}
