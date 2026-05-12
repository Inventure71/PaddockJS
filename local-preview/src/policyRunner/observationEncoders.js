import {
  clampPolicyAction,
  numberOr,
  ratioNumber,
  zeros,
} from './numeric.js';

const SOLO_RAY_ANGLES = [-140, -100, -70, -50, -35, -20, -10, 0, 10, 20, 35, 50, 70, 100, 140, 180];
const SOLO_RAY_LENGTHS = SOLO_RAY_ANGLES.map((angle) => (Math.abs(angle) <= 70 ? 240 : Math.abs(angle) <= 100 ? 90 : 60));
const LIDAR_LITE_ANGLES = Array.from({ length: 25 }, (_, index) => -120 + index * 10);
const LIDAR_LITE_LENGTHS = LIDAR_LITE_ANGLES.map((angle) => (Math.abs(angle) <= 70 ? 260 : 100));
const RAY_LAYOUTS = {
  'driver-front-heavy': SOLO_RAY_ANGLES.map((angle, index) => ({ angle, length: SOLO_RAY_LENGTHS[index] })),
  'lidar-lite': LIDAR_LITE_ANGLES.map((angle, index) => ({ angle, length: LIDAR_LITE_LENGTHS[index] })),
};
const clampUnit = (value) => clampPolicyAction(numberOr(value, 0), -1, 1);

export function encodeSoloRayHybridObservation(
  observation,
  previousAction,
  previousSpeed,
  previousOffset,
  includeTrackRelation = false,
  options = {},
) {
  if (Array.isArray(observation?.schema) && observation.schema.length && observation?.vector) {
    return encodeSoloRayHybridVectorObservation(observation, previousAction, previousSpeed, previousOffset, includeTrackRelation, options);
  }
  const object = observation.object ?? {};
  const self = object.self ?? {};
  const track = object.track ?? {};
  const relation = object.trackRelation ?? {};
  const lookahead = Array.isArray(track.lookahead) ? track.lookahead : [];
  const speedKph = numberOr(self.speedKph, 0);
  const accel = numberOr(self.throttle, 0) - numberOr(self.brake, 0);
  const offset = numberOr(relation.lateralOffsetMeters ?? self.trackOffsetMeters, 0);
  const lapProgress = ratioNumber(numberOr(self.lapProgressMeters, 0), Math.max(1, numberOr(track.lengthMeters, 1)));
  return {
    body: [
      speedKph / 400,
      numberOr(self.steeringAngleRadians, 0) / Math.PI,
      accel,
      numberOr(previousAction[0], 0),
      numberOr(previousAction[1], 0),
      (speedKph - numberOr(previousSpeed, 0)) / 100,
      numberOr(self.yawRateRadiansPerSecond, 0) / Math.PI,
      numberOr(self.lateralG, 0) / 8,
      numberOr(self.longitudinalG, 0) / 6,
      numberOr(self.gripUsage, 0) / 2,
      numberOr(self.slipAngleRadians, 0) / Math.PI,
      self.tractionLimited ? 1 : 0,
      self.onTrack === false ? 0 : 1,
      lapProgress,
      clampUnit(numberOr(track.curvature, 0) * 100),
      clampUnit(numberOr(lookahead[0]?.curvature, 0) * 100),
    ],
    track: includeTrackRelation ? [
      offset / 20,
      numberOr(relation.headingErrorRadians ?? self.trackHeadingErrorRadians, 0) / Math.PI,
      numberOr(relation.legalWidthMeters, 0) / 30,
      numberOr(relation.leftBoundaryMeters, 0) / 20,
      numberOr(relation.rightBoundaryMeters, 0) / 20,
      relation.onLegalSurface ?? self.onTrack ? 1 : 0,
      numberOr(lookahead[0]?.headingDeltaRadians, 0),
      numberOr(lookahead[1]?.headingDeltaRadians, 0),
      lapProgress,
      (offset - numberOr(previousOffset, 0)) / 20,
    ] : zeros(10),
    contact_patches: encodeObjectContactPatches(object.contactPatches ?? []),
    rays: encodeSoloRayObjectRays(object.rays ?? [], options),
    opponents: Array.from({ length: 6 }, () => zeros(11)),
    race: zeros(6),
    memory: [lapProgress],
  };
}

export function encodeHybridObservation(observation, previousAction, previousSpeed, previousOffset) {
  const object = observation.object ?? {};
  const self = object.self ?? {};
  const relation = object.trackRelation ?? {};
  const race = object.race ?? {};
  const track = object.track ?? {};
  const speedKph = numberOr(self.speedKph, 0);
  const offset = numberOr(relation.lateralOffsetMeters ?? self.trackOffsetMeters, 0);
  const lapProgress = ratioNumber(numberOr(self.lapProgressMeters, 0), Math.max(1, numberOr(track.lengthMeters, 1)));
  return {
    body: [
      speedKph / 400,
      numberOr(self.speedMetersPerSecond, 0) / 120,
      numberOr(self.steeringAngleRadians, 0) / Math.PI,
      numberOr(self.throttle, 0),
      numberOr(self.brake, 0),
      numberOr(self.yawRateRadiansPerSecond, 0) / Math.PI,
      numberOr(self.lateralG, 0) / 8,
      numberOr(self.longitudinalG, 0) / 6,
      numberOr(self.gripUsage, 0) / 2,
      numberOr(self.slipAngleRadians, 0) / Math.PI,
      self.tractionLimited ? 1 : 0,
      stabilityCode(self.stabilityState) / 4,
      lapProgress,
      numberOr(previousAction[0], 0),
      numberOr(previousAction[1], 0),
      (speedKph - numberOr(previousSpeed, 0)) / 100,
    ],
    track: [
      offset / 20,
      numberOr(relation.headingErrorRadians ?? self.trackHeadingErrorRadians, 0) / Math.PI,
      numberOr(relation.legalWidthMeters, 0) / 30,
      numberOr(relation.leftBoundaryMeters, 0) / 20,
      numberOr(relation.rightBoundaryMeters, 0) / 20,
      relation.onLegalSurface ?? self.onTrack ? 1 : 0,
      surfaceCode(relation.surface ?? self.surface) / 8,
      numberOr(self.completedLaps, 0) / 5,
      lapProgress,
      (offset - numberOr(previousOffset, 0)) / 20,
    ],
    contact_patches: encodeObjectContactPatches(object.contactPatches ?? []),
    rays: encodeHybridRays(object.rays ?? []),
    opponents: encodeHybridOpponents(object.nearbyCars ?? []),
    race: [
      ratioNumber(numberOr(race.position, 1) - 1, Math.max(1, numberOr(race.totalCars, 1) - 1)),
      numberOr(race.totalCars, 1) / 20,
      race.raceMode === 'green' ? 1 : 0,
      race.raceMode === 'safety-car' ? 1 : 0,
      race.redFlag ? 1 : 0,
      race.pitLaneOpen ? 1 : 0,
    ],
    memory: [lapProgress],
  };
}

function encodeSoloRayHybridVectorObservation(observation, previousAction, previousSpeed, previousOffset, includeTrackRelation, options = {}) {
  const vector = Array.from(observation.vector ?? []);
  const schemaIndex = vectorSchemaIndex(observation.schema ?? []);
  const value = (fieldName, fallback = 0) => vectorValue(vector, schemaIndex, fieldName, fallback);
  const speedRatio = value('self.speedKph');
  const speedKph = speedRatio * 400;
  const accel = value('self.throttle') - value('self.brake');
  const lapProgress = value('self.lapProgressRatio');
  const offset = value('self.trackOffsetMeters');
  const lookaheadHeading0 = value('track.lookahead[0].headingDeltaRadians');
  const lookaheadHeading1 = value('track.lookahead[1].headingDeltaRadians');
  const lookaheadCurvature0 = value('track.lookahead[0].curvature');
  return {
    body: [
      speedRatio,
      value('self.steeringAngleRadians'),
      accel,
      numberOr(previousAction[0], 0),
      numberOr(previousAction[1], 0),
      (speedKph - numberOr(previousSpeed, 0)) / 100,
      value('self.yawRateRadiansPerSecond'),
      value('self.lateralG'),
      value('self.longitudinalG'),
      value('self.gripUsage'),
      value('self.slipAngleRadians'),
      value('self.tractionLimited'),
      value('self.onTrack'),
      lapProgress,
      clampUnit(value('track.curvature') * 100),
      clampUnit(lookaheadCurvature0 * 100),
    ],
    track: includeTrackRelation ? [
      offset / 20,
      value('self.trackHeadingErrorRadians'),
      value('trackRelation.legalWidthMeters') / 30,
      value('trackRelation.leftBoundaryMeters') / 20,
      value('trackRelation.rightBoundaryMeters') / 20,
      value('self.onTrack'),
      lookaheadHeading0,
      lookaheadHeading1,
      lapProgress,
      (offset - numberOr(previousOffset, 0)) / 20,
    ] : zeros(10),
    contact_patches: encodeSoloRayVectorContactPatches(value),
    rays: encodeSoloRayVectorRays(value, options),
    opponents: Array.from({ length: 6 }, () => zeros(11)),
    race: zeros(6),
    memory: [lapProgress],
  };
}

function encodeSoloRayVectorContactPatches(value) {
  return Array.from({ length: 4 }, (_, index) => {
    const surfaceRatio = value(`contactPatches[${index}].surfaceCode`) * (5 / 8);
    const signedOffset = value(`contactPatches[${index}].signedOffsetMeters`);
    return [
      value(`contactPatches[${index}].present`),
      surfaceRatio,
      value(`contactPatches[${index}].onLegalSurface`),
      signedOffset / 20,
      signedOffset / 20,
      value('self.inPitLane'),
      surfaceRatio > 0.2 && surfaceRatio < 0.35 ? 1 : 0,
    ];
  });
}

function encodeSoloRayVectorRays(value, options = {}) {
  const specs = rayLayoutSpecs(options.rayLayout, options.rayCount);
  return specs.map(({ angle, length }, index) => [
    angle / 180,
    length / 300,
    value(`rays[${index}].track.distanceRatio`, 1),
    value(`rays[${index}].track.hit`),
    value(`rays[${index}].track.kindExit`),
    value(`rays[${index}].track.kindEntry`),
    value(`rays[${index}].kerb.distanceRatio`, 1),
    value(`rays[${index}].kerb.hit`),
    value(`rays[${index}].illegalSurface.distanceRatio`, 1),
    value(`rays[${index}].illegalSurface.hit`),
    value(`rays[${index}].barrier.distanceRatio`, 1),
    value(`rays[${index}].barrier.hit`),
    value(`rays[${index}].car.distanceRatio`, 1),
    value(`rays[${index}].car.hit`),
    value(`rays[${index}].car.relativeSpeedKph`),
  ]);
}

function encodeObjectContactPatches(patches) {
  return Array.from({ length: 4 }, (_, index) => {
    const patch = patches[index] ?? {};
    return [
      patch.present === false ? 0 : 1,
      surfaceCode(patch.surface) / 8,
      patch.onLegalSurface ? 1 : 0,
      numberOr(patch.signedOffsetMeters, 0) / 20,
      numberOr(patch.crossTrackErrorMeters, 0) / 20,
      patch.inPitLane ? 1 : 0,
      patch.surface === 'kerb' ? 1 : 0,
    ];
  });
}

function encodeSoloRayObjectRays(rays, options = {}) {
  const specs = rayLayoutSpecs(options.rayLayout, options.rayCount);
  return specs.map(({ angle, length: configuredLength }, index) => {
    const ray = rays[index] ?? {};
    const length = Math.max(1, numberOr(ray.lengthMeters, configuredLength));
    return encodeRayChannels(ray, length, angle);
  });
}

function encodeHybridRays(rays) {
  return Array.from({ length: 16 }, (_, index) => {
    const ray = rays[index] ?? {};
    const length = Math.max(1, numberOr(ray.lengthMeters, 120));
    return encodeRayChannels(ray, length, 0);
  });
}

function encodeRayChannels(ray, length, fallbackAngleDegrees) {
  const track = ray.track ?? ray.roadEdge ?? {};
  const kerb = ray.kerb ?? {};
  const illegal = ray.illegalSurface ?? {};
  const barrier = ray.barrier ?? {};
  const car = ray.car ?? {};
  return [
    numberOr(ray.angleDegrees, fallbackAngleDegrees) / 180,
    length / 300,
    ratioNumber(numberOr(track.distanceMeters, length), length),
    track.hit ? 1 : 0,
    track.kind === 'exit' ? 1 : 0,
    track.kind === 'entry' ? 1 : 0,
    ratioNumber(numberOr(kerb.distanceMeters, length), length),
    kerb.hit ? 1 : 0,
    ratioNumber(numberOr(illegal.distanceMeters, length), length),
    illegal.hit ? 1 : 0,
    ratioNumber(numberOr(barrier.distanceMeters, length), length),
    barrier.hit ? 1 : 0,
    ratioNumber(numberOr(car.distanceMeters, length), length),
    car.hit ? 1 : 0,
    numberOr(car.relativeSpeedKph, 0) / 200,
  ];
}

function rayLayoutSpecs(rayLayout = 'driver-front-heavy', rayCount = null) {
  const source = RAY_LAYOUTS[rayLayout] ?? RAY_LAYOUTS['driver-front-heavy'];
  const count = Number.isFinite(Number(rayCount)) && Number(rayCount) > 0 ? Number(rayCount) : source.length;
  return Array.from({ length: count }, (_, index) => source[index] ?? { angle: 0, length: 120 });
}

function encodeHybridOpponents(cars) {
  return Array.from({ length: 6 }, (_, index) => {
    const car = cars[index];
    if (!car) return zeros(11);
    return [
      1,
      numberOr(car.relativeForwardMeters, 0) / 160,
      numberOr(car.relativeRightMeters, 0) / 160,
      numberOr(car.relativeDistanceMeters, 0) / 160,
      numberOr(car.relativeSpeedKph, 0) / 200,
      numberOr(car.relativeHeadingRadians, 0) / Math.PI,
      car.ahead ? 1 : 0,
      car.behind ? 1 : 0,
      car.leftOverlap ? 1 : 0,
      car.rightOverlap ? 1 : 0,
      numberOr(car.closingRateMetersPerSecond, 0) / 100,
    ];
  });
}

function vectorSchemaIndex(schema) {
  return new Map(schema.map((entry, index) => [
    typeof entry === 'string' ? entry : String(entry?.name ?? ''),
    index,
  ]));
}

function vectorValue(vector, schemaIndex, fieldName, fallback = 0) {
  const index = schemaIndex.get(fieldName);
  if (!Number.isInteger(index) || index < 0 || index >= vector.length) return fallback;
  return numberOr(vector[index], fallback);
}

function surfaceCode(surface) {
  return {
    track: 1,
    kerb: 2,
    'pit-entry': 3,
    'pit-lane': 3,
    'pit-exit': 3,
    'pit-box': 3,
    grass: 4,
    gravel: 5,
    runoff: 6,
    outside: 7,
    barrier: 8,
  }[String(surface ?? 'unknown')] ?? 0;
}

function stabilityCode(value) {
  return {
    stable: 0,
    loaded: 1,
    sliding: 2,
    unstable: 3,
    spun: 4,
  }[String(value ?? 'stable')] ?? 0;
}
