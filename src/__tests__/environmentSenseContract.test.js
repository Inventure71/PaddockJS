import { describe, expect, test } from 'vitest';
import { createPaddockEnvironment } from '../environment/index.js';
import { buildObservationSpec } from '../environment/specs.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { normalizeAngle } from '../simulation/simMath.js';
import { pointAt } from '../simulation/trackModel.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToMetersPerSecond, simUnitsToMeters } from '../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../simulation/vehicleGeometry.js';
import { CHAMPIONSHIP_ENTRY_BLUEPRINTS } from '../data/championship.js';
import { DEMO_PROJECT_DRIVERS } from '../data/demoDrivers.js';

const CONTROLLED_IDS = DEMO_PROJECT_DRIVERS.slice(0, 3).map((driver) => driver.id);

function baseEnvironmentOptions(overrides = {}) {
  return {
    drivers: DEMO_PROJECT_DRIVERS,
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    controlledDrivers: CONTROLLED_IDS,
    seed: 117,
    trackSeed: 4101,
    trackGeneration: { profile: 'training-short' },
    physicsMode: 'simulator',
    frameSkip: 1,
    scenario: {
      participants: CONTROLLED_IDS,
      placements: {
        [CONTROLLED_IDS[0]]: { distanceMeters: 120, offsetMeters: 0, speedKph: 80 },
        [CONTROLLED_IDS[1]]: { distanceMeters: 142, offsetMeters: 1.8, speedKph: 68 },
        [CONTROLLED_IDS[2]]: { distanceMeters: 96, offsetMeters: -2.4, speedKph: 72 },
      },
    },
    participantInteractions: { defaultProfile: 'normal' },
    observation: {
      profile: 'physical-driver',
      output: 'full',
      includeSchema: true,
      lookaheadMeters: [25, 75],
    },
    result: {
      stateOutput: 'full',
      resetDriversObservationScope: 'all',
    },
    sensors: {
      rays: {
        enabled: true,
        anglesDegrees: [-45, 0, 45],
        lengthMeters: 90,
        channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
      },
      nearbyCars: {
        enabled: true,
        maxCars: 2,
        radiusMeters: 120,
      },
    },
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: false },
        tireDegradation: { enabled: false },
      },
    },
    episode: { maxSteps: 200, endOnRaceFinish: false },
    ...overrides,
  };
}

function stepDeterministicEnvironment(options) {
  const env = createPaddockEnvironment(options);
  env.reset();
  const actions = {
    [CONTROLLED_IDS[0]]: { steering: 0.08, throttle: 0.62, brake: 0 },
    [CONTROLLED_IDS[1]]: { steering: -0.04, throttle: 0.48, brake: 0.03 },
    [CONTROLLED_IDS[2]]: { steering: 0.02, throttle: 0.52, brake: 0 },
  };
  const result = env.step(actions);
  return { env, result };
}

describe('model-facing environment sense contract', () => {
  test('full physical-driver observations match independent object and vector oracles', () => {
    const options = baseEnvironmentOptions();
    const { env, result } = stepDeterministicEnvironment(options);
    const snapshot = result.state.snapshot;

    for (const driverId of CONTROLLED_IDS) {
      const observation = result.observation[driverId];
      const car = snapshot.cars.find((entry) => entry.id === driverId);

      assertObservationObjectMatchesSnapshot(observation.object, car, snapshot, options);
      assertObservationVectorMatchesSchemaOracle(observation.object, observation.vector, observation.schema, options.sensors);
      expect(observation.vector.every(Number.isFinite)).toBe(true);
    }

    env.destroy();
  });

  test('vector-only physical-driver observations match full output for the same deterministic state', () => {
    const fullOptions = baseEnvironmentOptions();
    const vectorOptions = baseEnvironmentOptions({
      observation: {
        ...fullOptions.observation,
        output: 'vector',
        includeSchema: true,
      },
      result: {
        ...fullOptions.result,
        stateOutput: 'none',
      },
    });
    const full = stepDeterministicEnvironment(fullOptions);
    const vectorOnly = stepDeterministicEnvironment(vectorOptions);

    for (const driverId of CONTROLLED_IDS) {
      const fullObservation = full.result.observation[driverId];
      const vectorObservation = vectorOnly.result.observation[driverId];

      expect(Array.from(vectorObservation.vector)).toEqual(Array.from(fullObservation.vector));
      expect(vectorObservation.schema).toEqual(fullObservation.schema);
      expect(vectorObservation).not.toHaveProperty('object');
    }

    full.env.destroy();
    vectorOnly.env.destroy();
  });

  test('public observation spec schema matches produced per-driver sense schemas', () => {
    const options = resolveEnvironmentOptions(baseEnvironmentOptions({
      sensorsByDriver: {
        [CONTROLLED_IDS[1]]: {
          rays: {
            anglesDegrees: [-20, 20],
            lengthMeters: 65,
          },
          nearbyCars: {
            maxCars: 1,
          },
        },
      },
    }));
    const env = createPaddockEnvironment(options);
    const result = env.reset();
    const spec = buildObservationSpec(options);

    for (const driverId of CONTROLLED_IDS) {
      const expectedSchema = spec.perDriver[driverId]?.vector.schema ?? spec.vector.schema;
      expect(result.observation[driverId].schema).toEqual(expectedSchema);
      assertObservationVectorMatchesSchemaOracle(
        result.observation[driverId].object,
        result.observation[driverId].vector,
        result.observation[driverId].schema,
        effectiveSensorOptionsForTest(options, driverId),
      );
    }

    env.destroy();
  });
});

function assertObservationObjectMatchesSnapshot(object, car, snapshot, options) {
  expect(object.self.id).toBe(car.id);
  expect(object.self.speedKph).toBeCloseTo(car.speedKph, 9);
  expect(object.self.speedMetersPerSecond).toBeCloseTo(simSpeedToMetersPerSecond(car.speed ?? 0), 9);
  expect(object.self.headingRadians).toBeCloseTo(car.heading, 9);
  expect(object.self.yawRateRadiansPerSecond).toBeCloseTo(car.yawRate ?? 0, 9);
  expect(object.self.steeringAngleRadians).toBeCloseTo(car.steeringAngle ?? 0, 9);
  expect(object.self.throttle).toBeCloseTo(car.throttle ?? 0, 9);
  expect(object.self.brake).toBeCloseTo(car.brake ?? 0, 9);
  expect(object.self.lateralG).toBeCloseTo(car.lateralG ?? 0, 9);
  expect(object.self.longitudinalG).toBeCloseTo(car.longitudinalG ?? 0, 9);
  expect(object.self.gripUsage).toBeCloseTo(car.gripUsage ?? 0, 9);
  expect(object.self.slipAngleRadians).toBeCloseTo(car.slipAngleRadians ?? 0, 9);
  expect(object.self.tractionLimited).toBe(Boolean(car.tractionLimited));
  expect(object.self.destroyed).toBe(Boolean(car.destroyed));
  expect(object.self.destroyReason).toBe(car.destroyReason ?? null);
  expect(object.self.lapProgressMeters).toBeCloseTo(simUnitsToMeters(car.progress ?? 0), 9);
  expect(object.self.trackOffsetMeters).toBeCloseTo(simUnitsToMeters(car.signedOffset ?? 0), 9);
  expect(object.self.trackHeadingErrorRadians).toBeCloseTo(expectedTrackHeadingError(car, snapshot), 9);
  expect(object.self.inPitLane).toBe(Boolean(car.inPitLane));
  expect(object.self.tireEnergy).toBe(car.tireEnergy ?? null);
  expect(object.self.pitIntent).toBe(car.pitIntent ?? car.pitStop?.intent ?? 0);
  expect(object.self.pitStopStatus).toBe(car.pitStop?.status ?? null);

  const widthMeters = simUnitsToMeters(snapshot.track.width ?? 0);
  const offsetMeters = simUnitsToMeters(car.signedOffset ?? 0);
  expect(object.trackRelation.lateralOffsetMeters).toBeCloseTo(offsetMeters, 9);
  expect(object.trackRelation.legalWidthMeters).toBeCloseTo(widthMeters, 9);
  expect(object.trackRelation.leftBoundaryMeters).toBeCloseTo(widthMeters / 2 + offsetMeters, 9);
  expect(object.trackRelation.rightBoundaryMeters).toBeCloseTo(widthMeters / 2 - offsetMeters, 9);
  expect(object.trackRelation.headingErrorRadians).toBeCloseTo(expectedTrackHeadingError(car, snapshot), 9);
  expect(object.trackRelation.surface).toBe(car.surface ?? 'track');
  expect(object.trackRelation.onLegalSurface).toBe(expectedLegalSurface(car));

  expect(object.race.position).toBe(car.rank);
  expect(object.race.totalCars).toBe(snapshot.cars.length);
  expect(object.race.raceMode).toBe(snapshot.raceControl.mode);
  expect(object.race.pitLaneOpen).toBe(Boolean(snapshot.raceControl.pitLaneOpen));
  expect(object.race.redFlag).toBe(Boolean(snapshot.raceControl.redFlag));
  expect(object.race.totalLaps).toBe(snapshot.totalLaps);

  expect(object.track.lengthMeters).toBeCloseTo(simUnitsToMeters(snapshot.track.length ?? 0), 9);
  expect(object.track.widthMeters).toBeCloseTo(widthMeters, 9);
  expect(object.track.curvature).toBeCloseTo(car.trackState?.curvature ?? pointAt(snapshot.track, car.progress ?? 0).curvature ?? 0, 9);
  assertLookaheadMatchesTrack(object.track.lookahead, car, snapshot, options);
  assertContactPatchesMatchWheels(object.contactPatches, car);
  assertNearbyCarsMatchSnapshot(object.nearbyCars, car, snapshot, options.sensors.nearbyCars);
}

function assertLookaheadMatchesTrack(lookahead, car, snapshot, options) {
  const base = pointAt(snapshot.track, car.progress ?? 0);
  const distances = options.observation.lookaheadMeters;
  expect(lookahead).toHaveLength(distances.length);
  distances.forEach((distanceMeters, index) => {
    const sample = pointAt(snapshot.track, (car.progress ?? 0) + metersToSimUnits(distanceMeters));
    expect(lookahead[index].distanceMeters).toBe(distanceMeters);
    expect(lookahead[index].curvature).toBeCloseTo(sample.curvature ?? 0, 9);
    expect(lookahead[index].headingDeltaRadians).toBeCloseTo(normalizeAngle(sample.heading - base.heading), 9);
  });
}

function assertContactPatchesMatchWheels(contactPatches, car) {
  const wheelsById = new Map((car.wheels ?? []).map((wheel) => [wheel.id, wheel]));
  expect(contactPatches.map((patch) => patch.id)).toEqual(['front-left', 'front-right', 'rear-left', 'rear-right']);
  contactPatches.forEach((patch) => {
    const wheel = wheelsById.get(patch.id);
    expect(patch.present).toBe(Boolean(wheel));
    expect(patch.signedOffsetMeters).toBeCloseTo(simUnitsToMeters(wheel?.signedOffset ?? 0), 9);
    expect(patch.crossTrackErrorMeters).toBeCloseTo(simUnitsToMeters(wheel?.crossTrackError ?? 0), 9);
    expect(patch.surface).toBe(wheel?.surface ?? 'track');
    expect(patch.surfaceCode).toBe(expectedSurfaceCode(wheel?.surface ?? 'track'));
    expect(patch.onLegalSurface).toBe(Boolean(wheel?.onTrack || wheel?.inPitLane));
    expect(patch.inPitLane).toBe(Boolean(wheel?.inPitLane));
  });
}

function assertNearbyCarsMatchSnapshot(nearbyCars, car, snapshot, nearbyOptions) {
  const expected = expectedNearbyCars(car, snapshot, nearbyOptions);
  expect(nearbyCars).toHaveLength(expected.length);
  expected.forEach((target, index) => {
    const actual = nearbyCars[index];
    expect(actual.id).toBe(target.id);
    expect(actual.entityType).toBe(target.entityType);
    expect(actual.relativeForwardMeters).toBeCloseTo(target.relativeForwardMeters, 9);
    expect(actual.relativeRightMeters).toBeCloseTo(target.relativeRightMeters, 9);
    expect(actual.relativeDistanceMeters).toBeCloseTo(target.relativeDistanceMeters, 9);
    expect(actual.relativeSpeedKph).toBeCloseTo(target.relativeSpeedKph, 9);
    expect(actual.relativeHeadingRadians).toBeCloseTo(target.relativeHeadingRadians, 9);
    expect(actual.ahead).toBe(target.ahead);
    expect(actual.sameLap).toBe(target.sameLap);
    expect(actual.behind).toBe(target.behind);
    expect(actual.closingRateMetersPerSecond).toBeCloseTo(target.closingRateMetersPerSecond, 9);
    if (target.timeToContactSeconds == null) expect(actual.timeToContactSeconds).toBeNull();
    else expect(actual.timeToContactSeconds).toBeCloseTo(target.timeToContactSeconds, 9);
    expect(actual.leftOverlap).toBe(target.leftOverlap);
    expect(actual.rightOverlap).toBe(target.rightOverlap);
  });
}

function assertObservationVectorMatchesSchemaOracle(object, vector, schema, sensors) {
  const values = Array.from(vector);
  expect(schema).toHaveLength(values.length);
  schema.forEach((entry, index) => {
    const expected = expectedVectorValue(object, sensors, entry.name);
    expect(values[index], entry.name).toBeCloseTo(expected, 9);
  });
}

function expectedVectorValue(object, sensors, name) {
  const contactMatch = name.match(/^contactPatches\[(\d+)]\.(.+)$/);
  if (contactMatch) {
    const patch = object.contactPatches[Number(contactMatch[1])] ?? null;
    const field = contactMatch[2];
    if (field === 'present') return patch?.present ? 1 : 0;
    if (field === 'surfaceCode') return (patch?.surfaceCode ?? 0) / 5;
    if (field === 'onLegalSurface') return patch?.onLegalSurface ? 1 : 0;
    if (field === 'signedOffsetMeters') return patch?.signedOffsetMeters ?? 0;
    if (field === 'crossTrackErrorMeters') return patch?.crossTrackErrorMeters ?? 0;
  }

  const lookaheadMatch = name.match(/^track\.lookahead\[(\d+)]\.(.+)$/);
  if (lookaheadMatch) {
    const sample = object.track.lookahead[Number(lookaheadMatch[1])] ?? {};
    if (lookaheadMatch[2] === 'curvature') return sample.curvature ?? 0;
    if (lookaheadMatch[2] === 'headingDeltaRadians') return (sample.headingDeltaRadians ?? 0) / Math.PI;
  }

  const rayMatch = name.match(/^rays\[(\d+)]\.(track|car|kerb|illegalSurface)\.(.+)$/);
  if (rayMatch) {
    const ray = object.rays[Number(rayMatch[1])] ?? {};
    const channel = rayMatch[2];
    const field = rayMatch[3];
    if (channel === 'track') {
      if (field === 'distanceRatio') return ratio(ray.track?.distanceMeters, ray.lengthMeters);
      if (field === 'hit') return ray.track?.hit ? 1 : 0;
      if (field === 'kindExit') return ray.track?.kind === 'exit' ? 1 : 0;
      if (field === 'kindEntry') return ray.track?.kind === 'entry' ? 1 : 0;
    }
    if (channel === 'car') {
      if (field === 'distanceRatio') return ratio(ray.car?.distanceMeters, ray.lengthMeters);
      if (field === 'hit') return ray.car?.hit ? 1 : 0;
      if (field === 'relativeSpeedKph') return (ray.car?.relativeSpeedKph ?? 0) / 200;
      if (field === 'targetTypeReplayGhost') return ray.car?.targetType === 'replayGhost' ? 1 : 0;
    }
    if (field === 'distanceRatio') return ratio(ray[channel]?.distanceMeters ?? ray.lengthMeters, ray.lengthMeters);
    if (field === 'hit') return ray[channel]?.hit ? 1 : 0;
  }

  const nearbyMatch = name.match(/^nearbyCars\[(\d+)]\.(.+)$/);
  if (nearbyMatch) {
    const nearby = object.nearbyCars[Number(nearbyMatch[1])] ?? null;
    const field = nearbyMatch[2];
    const radiusMeters = sensors.nearbyCars.radiusMeters ?? 150;
    if (field === 'present') return nearby ? 1 : 0;
    if (field === 'relativeForwardRatio') return clampRatio((nearby?.relativeForwardMeters ?? 0) / radiusMeters);
    if (field === 'relativeRightRatio') return clampRatio((nearby?.relativeRightMeters ?? 0) / radiusMeters);
    if (field === 'relativeDistanceRatio') return ratio(nearby?.relativeDistanceMeters ?? radiusMeters, radiusMeters);
    if (field === 'relativeSpeedKph') return (nearby?.relativeSpeedKph ?? 0) / 200;
    if (field === 'relativeHeadingRadians') return (nearby?.relativeHeadingRadians ?? 0) / Math.PI;
    if (field === 'ahead') return nearby?.ahead ? 1 : 0;
    if (field === 'sameLap') return nearby?.sameLap ? 1 : 0;
    if (field === 'entityTypeReplayGhost') return nearby?.entityType === 'replayGhost' ? 1 : 0;
    if (field === 'behind') return nearby?.behind ? 1 : 0;
    if (field === 'closingRateMetersPerSecond') return (nearby?.closingRateMetersPerSecond ?? 0) / 100;
    if (field === 'timeToContactSeconds') return ratio(nearby?.timeToContactSeconds ?? 10, 10);
    if (field === 'leftOverlap') return nearby?.leftOverlap ? 1 : 0;
    if (field === 'rightOverlap') return nearby?.rightOverlap ? 1 : 0;
  }

  const exact = {
    'self.speedKph': object.self.speedKph / 400,
    'self.speedMetersPerSecond': object.self.speedMetersPerSecond / 120,
    'self.steeringAngleRadians': object.self.steeringAngleRadians / Math.PI,
    'self.throttle': object.self.throttle,
    'self.brake': object.self.brake,
    'self.lateralG': object.self.lateralG / 8,
    'self.longitudinalG': object.self.longitudinalG / 6,
    'self.gripUsage': object.self.gripUsage / 2,
    'self.slipAngleRadians': object.self.slipAngleRadians / Math.PI,
    'self.tractionLimited': object.self.tractionLimited ? 1 : 0,
    'self.lapProgressRatio': ratio(object.self.lapProgressMeters, object.track.lengthMeters || 1),
    'self.trackOffsetMeters': object.self.trackOffsetMeters,
    'self.trackHeadingErrorRadians': object.self.trackHeadingErrorRadians / Math.PI,
    'self.onTrack': object.self.onTrack ? 1 : 0,
    'self.inPitLane': object.self.inPitLane ? 1 : 0,
    'self.tireEnergy': (object.self.tireEnergy ?? 0) / 100,
    'self.pitIntent': (object.self.pitIntent ?? 0) / 2,
    'self.pitStopActive': object.self.pitStopStatus && object.self.pitStopStatus !== 'pending' && object.self.pitStopStatus !== 'completed' ? 1 : 0,
    'self.yawRateRadiansPerSecond': object.self.yawRateRadiansPerSecond / Math.PI,
    'race.positionNormalized': normalizeRacePosition(object),
    'race.raceModeGreen': object.race.raceMode === 'green' ? 1 : 0,
    'race.raceModeSafetyCar': object.race.raceMode === 'safety-car' ? 1 : 0,
    'race.redFlag': object.race.redFlag ? 1 : 0,
    'race.pitLaneOpen': object.race.pitLaneOpen ? 1 : 0,
    'track.curvature': object.track.curvature ?? 0,
    'trackRelation.leftBoundaryMeters': object.trackRelation.leftBoundaryMeters,
    'trackRelation.rightBoundaryMeters': object.trackRelation.rightBoundaryMeters,
    'trackRelation.legalWidthMeters': object.trackRelation.legalWidthMeters,
  };

  if (Object.hasOwn(exact, name)) return exact[name];
  throw new Error(`Missing sense oracle for vector schema field: ${name}`);
}

function expectedNearbyCars(car, snapshot, nearbyOptions) {
  const limit = Math.max(0, Math.floor(nearbyOptions.maxCars ?? 6));
  const radius = metersToSimUnits(nearbyOptions.radiusMeters ?? 150);
  const radiusSquared = radius * radius;
  const forwardX = Math.cos(car.heading);
  const forwardY = Math.sin(car.heading);
  const rightX = -Math.sin(car.heading);
  const rightY = Math.cos(car.heading);
  const candidates = snapshot.cars
    .filter((other) => other.id !== car.id)
    .map((other, order) => ({ ...other, entityType: 'car', order }))
    .filter((other) => other.detectableBySensors !== false)
    .map((other) => {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) return null;
      const forward = forwardX * dx + forwardY * dy;
      const right = rightX * dx + rightY * dy;
      const relativeDistanceMeters = simUnitsToMeters(Math.sqrt(distanceSquared));
      const nearby = {
        id: other.id,
        entityType: other.entityType,
        relativeForwardMeters: simUnitsToMeters(forward),
        relativeRightMeters: simUnitsToMeters(right),
        relativeDistanceMeters,
        relativeSpeedKph: other.speedKph - car.speedKph,
        relativeHeadingRadians: normalizeAngle((other.heading - car.heading + Math.PI) % (Math.PI * 2) - Math.PI),
        ahead: forward > 0,
        sameLap: other.lap != null && other.lap === car.lap,
        distanceSquared,
        order: other.order,
      };
      return {
        ...nearby,
        ...expectedRadarFields(car, other, nearby),
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.distanceSquared - second.distanceSquared || first.order - second.order)
    .slice(0, limit);

  return candidates.map(({ distanceSquared, order, ...entry }) => entry);
}

function expectedRadarFields(car, target, nearby) {
  const dx = (target.x ?? 0) - (car.x ?? 0);
  const dy = (target.y ?? 0) - (car.y ?? 0);
  const distance = Math.max(1e-9, Math.hypot(dx, dy));
  const selfVelocity = expectedVelocity(car);
  const targetVelocity = expectedVelocity(target);
  const relativeVelocity = {
    x: targetVelocity.x - selfVelocity.x,
    y: targetVelocity.y - selfVelocity.y,
  };
  const closingRate = -((relativeVelocity.x * dx + relativeVelocity.y * dy) / distance);
  const closingRateMetersPerSecond = simSpeedToMetersPerSecond(closingRate);
  const longitudinalOverlap = Math.abs(nearby.relativeForwardMeters ?? 0) <= simUnitsToMeters(VEHICLE_GEOMETRY.bodyLength);
  const lateralOverlap = Math.abs(nearby.relativeRightMeters ?? 0) <= simUnitsToMeters(VEHICLE_GEOMETRY.bodyWidth);
  const sideOverlap = longitudinalOverlap && lateralOverlap;

  return {
    behind: !nearby.ahead,
    closingRateMetersPerSecond,
    timeToContactSeconds: closingRateMetersPerSecond > 0
      ? nearby.relativeDistanceMeters / closingRateMetersPerSecond
      : null,
    leftOverlap: sideOverlap && (nearby.relativeRightMeters ?? 0) < 0,
    rightOverlap: sideOverlap && (nearby.relativeRightMeters ?? 0) > 0,
  };
}

function expectedVelocity(car) {
  if (Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)) {
    return { x: car.velocityX, y: car.velocityY };
  }
  const speed = Number.isFinite(car.speed) ? car.speed : kphToSimSpeed(car.speedKph ?? 0);
  const heading = car.heading ?? car.headingRadians ?? 0;
  return {
    x: Math.cos(heading) * speed,
    y: Math.sin(heading) * speed,
  };
}

function expectedTrackHeadingError(car, snapshot) {
  const base = pointAt(snapshot.track, car.progress ?? 0);
  return car.trackHeadingError ?? normalizeAngle((car.heading ?? base.heading) - base.heading);
}

function expectedLegalSurface(car) {
  if (Array.isArray(car.wheels) && car.wheels.length > 0) {
    return car.wheels.every((wheel) => wheel.onTrack || wheel.inPitLane);
  }
  if (car.inPitLane) return true;
  return ['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box'].includes(car.surface ?? 'track');
}

function expectedSurfaceCode(surface) {
  return {
    track: 0,
    kerb: 1,
    'pit-entry': 2,
    'pit-lane': 2,
    'pit-exit': 2,
    'pit-box': 2,
    grass: 3,
    gravel: 4,
    barrier: 5,
  }[surface] ?? 5;
}

function normalizeRacePosition(object) {
  const totalCars = Number(object.race.totalCars);
  const position = Number(object.race.position);
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

function effectiveSensorOptionsForTest(options, driverId) {
  return {
    rays: {
      ...options.sensors.rays,
      ...(options.sensorsByDriver?.[driverId]?.rays ?? {}),
    },
    nearbyCars: {
      ...options.sensors.nearbyCars,
      ...(options.sensorsByDriver?.[driverId]?.nearbyCars ?? {}),
    },
  };
}
