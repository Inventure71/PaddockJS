import { buildObservationVectorSchema, MODEL_RAY_SURFACE_CHANNELS } from './observationSchema.js';

export function buildObservationVector(source, sensors, { includeSchema = true, vectorType = 'array' } = {}) {
  const includePhysicalDriverSenses = source.profile === 'physical-driver';
  const vector = [
    source.self.speedKph / 400,
    source.self.speedMetersPerSecond / 120,
    source.self.steeringAngleRadians / Math.PI,
    source.self.throttle,
    source.self.brake,
    source.self.lateralG / 8,
    source.self.longitudinalG / 6,
    source.self.gripUsage / 2,
    source.self.slipAngleRadians / Math.PI,
    source.self.tractionLimited ? 1 : 0,
    normalizeLapProgress(source),
    source.self.trackOffsetMeters,
    source.self.trackHeadingErrorRadians / Math.PI,
    source.self.onTrack ? 1 : 0,
    source.self.inPitLane ? 1 : 0,
    (source.self.tireEnergy ?? 0) / 100,
    (source.self.pitIntent ?? 0) / 2,
    source.self.pitStopStatus && source.self.pitStopStatus !== 'pending' && source.self.pitStopStatus !== 'completed' ? 1 : 0,
    normalizeRacePosition(source),
    source.race.raceMode === 'green' ? 1 : 0,
    source.race.raceMode === 'safety-car' ? 1 : 0,
    source.race.redFlag ? 1 : 0,
    source.race.pitLaneOpen ? 1 : 0,
    source.track.curvature ?? 0,
  ];
  if (includePhysicalDriverSenses) {
    vector.push(
      source.self.yawRateRadiansPerSecond / Math.PI,
      source.trackRelation.leftBoundaryMeters,
      source.trackRelation.rightBoundaryMeters,
      source.trackRelation.legalWidthMeters,
    );
    source.contactPatches.forEach((patch) => {
      vector.push(
        patch.present ? 1 : 0,
        patch.surfaceCode / 5,
        patch.onLegalSurface ? 1 : 0,
        patch.signedOffsetMeters,
        patch.crossTrackErrorMeters,
      );
    });
  }
  source.track.lookahead.forEach((sample) => {
    vector.push(sample.curvature ?? 0, (sample.headingDeltaRadians ?? 0) / Math.PI);
  });
  if (typeof source.appendRayVectorValues === 'function') {
    source.appendRayVectorValues(vector);
  } else {
    source.rays.forEach((ray) => {
      vector.push(
        ratio(ray.track.distanceMeters, ray.lengthMeters),
        ray.track.hit ? 1 : 0,
        ray.track.kind === 'exit' ? 1 : 0,
        ray.track.kind === 'entry' ? 1 : 0,
        ratio(ray.car.distanceMeters, ray.lengthMeters),
        ray.car.hit ? 1 : 0,
        ray.car.relativeSpeedKph / 200,
        ray.car.targetType === 'replayGhost' ? 1 : 0,
      );
      MODEL_RAY_SURFACE_CHANNELS.forEach((channel) => {
        if (sensors.rays.channels?.includes?.(channel)) {
          vector.push(
            ratio(ray[channel]?.distanceMeters ?? ray.lengthMeters, ray.lengthMeters),
            ray[channel]?.hit ? 1 : 0,
          );
        }
      });
    });
  }
  const nearbyLimit = sensors.nearbyCars.enabled ? (sensors.nearbyCars.maxCars ?? source.nearbyCars.length) : 0;
  const nearbyRadius = sensors.nearbyCars.radiusMeters ?? 150;
  for (let index = 0; index < nearbyLimit; index += 1) {
    const nearby = source.nearbyCars[index] ?? null;
    vector.push(
      nearby ? 1 : 0,
      clampRatio((nearby?.relativeForwardMeters ?? 0) / nearbyRadius),
      clampRatio((nearby?.relativeRightMeters ?? 0) / nearbyRadius),
      ratio(nearby?.relativeDistanceMeters ?? nearbyRadius, nearbyRadius),
      (nearby?.relativeSpeedKph ?? 0) / 200,
      (nearby?.relativeHeadingRadians ?? 0) / Math.PI,
      nearby?.ahead ? 1 : 0,
      nearby?.sameLap ? 1 : 0,
      nearby?.entityType === 'replayGhost' ? 1 : 0,
    );
    if (includePhysicalDriverSenses) {
      vector.push(
        nearby?.behind ? 1 : 0,
        (nearby?.closingRateMetersPerSecond ?? 0) / 100,
        ratio(nearby?.timeToContactSeconds ?? 10, 10),
        nearby?.leftOverlap ? 1 : 0,
        nearby?.rightOverlap ? 1 : 0,
      );
    }
  }
  const schema = includeSchema ? buildObservationVectorSchema({
    profile: source.profile,
    contactPatchCount: source.contactPatches?.length ?? 0,
    lookaheadCount: source.track.lookahead.length,
    rayCount: typeof source.appendRayVectorValues === 'function' ? 0 : source.rays.length,
    rayChannels: sensors.rays.channels,
    nearbyCount: nearbyLimit,
  }) : [];
  return { vector: finalizeVector(vector, vectorType), schema };
}

function finalizeVector(vector, vectorType = 'array') {
  return vectorType === 'float32' ? Float32Array.from(vector) : vector;
}

function normalizeLapProgress(source) {
  return ratio(source.self.lapProgressMeters, source.track.lengthMeters || 1);
}

function normalizeRacePosition(source) {
  const totalCars = Number(source.race.totalCars);
  const position = Number(source.race.position);
  if (!Number.isFinite(totalCars) || totalCars <= 1 || !Number.isFinite(position)) return 0;
  return ratio(position - 1, totalCars - 1);
}

function ratio(value, max) {
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(0, Math.min(1, finite / Math.max(1e-9, max)));
}

function clampRatio(value) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}
