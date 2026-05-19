const PHYSICAL_RAY_SURFACE_CHANNELS = Object.freeze(['kerb', 'illegalSurface']);

export function buildObservationVector(source, sensors, { includeSchema = true, vectorType = 'array' } = {}) {
  const includePhysicalDriverSenses = source.profile === 'physical-driver';
  const schema = includeSchema ? [
    { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
    { name: 'self.speedMetersPerSecond', unit: 'm/s', scale: 'fixed:120' },
    { name: 'self.steeringAngleRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.throttle', scale: '0..1' },
    { name: 'self.brake', scale: '0..1' },
    { name: 'self.lateralG', scale: 'fixed:8g' },
    { name: 'self.longitudinalG', scale: 'fixed:6g' },
    { name: 'self.gripUsage', scale: '0..2' },
    { name: 'self.slipAngleRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.tractionLimited', scale: 'boolean' },
    { name: 'self.lapProgressRatio', scale: '0..1' },
    { name: 'self.trackOffsetMeters', unit: 'm', scale: 'fixed:meters' },
    { name: 'self.trackHeadingErrorRadians', unit: 'rad', scale: 'fixed:pi' },
    { name: 'self.onTrack', scale: 'boolean' },
    { name: 'self.inPitLane', scale: 'boolean' },
    { name: 'self.tireEnergy', scale: '0..100' },
    { name: 'self.pitIntent', scale: '0..2' },
    { name: 'self.pitStopActive', scale: 'boolean' },
    { name: 'race.positionNormalized', scale: '0..1' },
    { name: 'race.raceModeGreen', scale: 'boolean' },
    { name: 'race.raceModeSafetyCar', scale: 'boolean' },
    { name: 'race.redFlag', scale: 'boolean' },
    { name: 'race.pitLaneOpen', scale: 'boolean' },
    { name: 'track.curvature', scale: 'track-curvature' },
  ] : null;
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
    pushSchema(schema,
      { name: 'self.yawRateRadiansPerSecond', unit: 'rad/s', scale: 'fixed:pi' },
      { name: 'trackRelation.leftBoundaryMeters', unit: 'm', scale: 'fixed:meters' },
      { name: 'trackRelation.rightBoundaryMeters', unit: 'm', scale: 'fixed:meters' },
      { name: 'trackRelation.legalWidthMeters', unit: 'm', scale: 'fixed:meters' },
    );
    vector.push(
      source.self.yawRateRadiansPerSecond / Math.PI,
      source.trackRelation.leftBoundaryMeters,
      source.trackRelation.rightBoundaryMeters,
      source.trackRelation.legalWidthMeters,
    );
    source.contactPatches.forEach((patch, index) => {
      pushSchema(schema,
        { name: `contactPatches[${index}].present`, scale: 'boolean' },
        { name: `contactPatches[${index}].surfaceCode`, scale: 'surface-code' },
        { name: `contactPatches[${index}].onLegalSurface`, scale: 'boolean' },
        { name: `contactPatches[${index}].signedOffsetMeters`, unit: 'm', scale: 'fixed:meters' },
      );
      vector.push(
        patch.present ? 1 : 0,
        patch.surfaceCode / 5,
        patch.onLegalSurface ? 1 : 0,
        patch.signedOffsetMeters,
      );
    });
  }
  source.track.lookahead.forEach((sample, index) => {
    pushSchema(schema,
      { name: `track.lookahead[${index}].curvature`, scale: 'track-curvature' },
      { name: `track.lookahead[${index}].headingDeltaRadians`, unit: 'rad', scale: 'fixed:pi' },
    );
    vector.push(sample.curvature ?? 0, (sample.headingDeltaRadians ?? 0) / Math.PI);
  });
  source.rays.forEach((ray, index) => {
    pushSchema(schema,
      { name: `rays[${index}].track.distanceRatio`, scale: '0..1' },
      { name: `rays[${index}].track.hit`, scale: 'boolean' },
      { name: `rays[${index}].track.kindExit`, scale: 'boolean' },
      { name: `rays[${index}].track.kindEntry`, scale: 'boolean' },
      { name: `rays[${index}].car.distanceRatio`, scale: '0..1' },
      { name: `rays[${index}].car.hit`, scale: 'boolean' },
      { name: `rays[${index}].car.relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
    );
    vector.push(
      ratio(ray.track.distanceMeters, ray.lengthMeters),
      ray.track.hit ? 1 : 0,
      ray.track.kind === 'exit' ? 1 : 0,
      ray.track.kind === 'entry' ? 1 : 0,
      ratio(ray.car.distanceMeters, ray.lengthMeters),
      ray.car.hit ? 1 : 0,
      ray.car.relativeSpeedKph / 200,
    );
    if (includePhysicalDriverSenses) {
      PHYSICAL_RAY_SURFACE_CHANNELS.forEach((channel) => {
        pushSchema(schema,
          { name: `rays[${index}].${channel}.distanceRatio`, scale: '0..1' },
          { name: `rays[${index}].${channel}.hit`, scale: 'boolean' },
        );
        vector.push(
          ratio(ray[channel]?.distanceMeters ?? ray.lengthMeters, ray.lengthMeters),
          ray[channel]?.hit ? 1 : 0,
        );
      });
    }
  });
  const nearbyLimit = sensors.nearbyCars.enabled ? (sensors.nearbyCars.maxCars ?? source.nearbyCars.length) : 0;
  const nearbyRadius = sensors.nearbyCars.radiusMeters ?? 150;
  for (let index = 0; index < nearbyLimit; index += 1) {
    const nearby = source.nearbyCars[index] ?? null;
    pushSchema(schema,
      { name: `nearbyCars[${index}].present`, scale: 'boolean' },
      { name: `nearbyCars[${index}].relativeForwardRatio`, scale: '-1..1' },
      { name: `nearbyCars[${index}].relativeRightRatio`, scale: '-1..1' },
      { name: `nearbyCars[${index}].relativeDistanceRatio`, scale: '0..1' },
      { name: `nearbyCars[${index}].relativeSpeedKph`, unit: 'kph', scale: 'fixed:200' },
      { name: `nearbyCars[${index}].relativeHeadingRadians`, unit: 'rad', scale: 'fixed:pi' },
      { name: `nearbyCars[${index}].ahead`, scale: 'boolean' },
      { name: `nearbyCars[${index}].sameLap`, scale: 'boolean' },
    );
    vector.push(
      nearby ? 1 : 0,
      clampRatio((nearby?.relativeForwardMeters ?? 0) / nearbyRadius),
      clampRatio((nearby?.relativeRightMeters ?? 0) / nearbyRadius),
      ratio(nearby?.relativeDistanceMeters ?? nearbyRadius, nearbyRadius),
      (nearby?.relativeSpeedKph ?? 0) / 200,
      (nearby?.relativeHeadingRadians ?? 0) / Math.PI,
      nearby?.ahead ? 1 : 0,
      nearby?.sameLap ? 1 : 0,
    );
    if (includePhysicalDriverSenses) {
      pushSchema(schema,
        { name: `nearbyCars[${index}].behind`, scale: 'boolean' },
        { name: `nearbyCars[${index}].closingRateMetersPerSecond`, unit: 'm/s', scale: 'fixed:100' },
        { name: `nearbyCars[${index}].timeToContactSeconds`, unit: 's', scale: 'fixed:10' },
        { name: `nearbyCars[${index}].leftOverlap`, scale: 'boolean' },
        { name: `nearbyCars[${index}].rightOverlap`, scale: 'boolean' },
      );
      vector.push(
        nearby?.behind ? 1 : 0,
        (nearby?.closingRateMetersPerSecond ?? 0) / 100,
        ratio(nearby?.timeToContactSeconds ?? 10, 10),
        nearby?.leftOverlap ? 1 : 0,
        nearby?.rightOverlap ? 1 : 0,
      );
    }
  }
  return { vector: finalizeVector(vector, vectorType), schema: schema ?? [] };
}

function finalizeVector(vector, vectorType = 'array') {
  return vectorType === 'float32' ? Float32Array.from(vector) : vector;
}

function pushSchema(schema, ...entries) {
  if (schema) schema.push(...entries);
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
