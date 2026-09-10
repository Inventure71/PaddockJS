import { describe, expect, test } from 'vitest';
import { advancedCornerSpeed, advancedFollowingSpeed, advancedRacingSpeedControls } from '../simulation/driver/advancedRacePace.js';
import { integrateVehiclePhysics, tirePerformanceFactor, VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';
import { advancedDriveForce } from '../simulation/vehicle/advancedVehicleModel.js';
import { advancedLateralAccelerationLimit, advancedRearForceCapacity } from '../simulation/vehicle/advancedTireForces.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { resolveTrackStatePitOverride } from '../simulation/track/spatialQueries.js';

function createCar({ speed = 20, surface = 'track', ...overrides } = {}) {
  return {
    x: 0, y: 0, heading: 0, steeringAngle: 0, yawRate: 0,
    speed: metersToSimUnits(speed), velocityX: metersToSimUnits(speed), velocityY: 0,
    mass: 798, powerNewtons: 43000, brakeNewtons: 59000,
    dragCoefficient: 0.33, downforceCoefficient: 6.1, tireGrip: 2.4,
    tireEnergy: 100, tireCare: 1,
    trackState: { surface, onTrack: surface === 'track' },
    wheelStates: ['front-left', 'front-right', 'rear-left', 'rear-right'].map((id) => ({ id, surface })),
    ...overrides,
  };
}

function expectValidPedals(controls) {
  expect(Number.isFinite(controls.throttle)).toBe(true);
  expect(Number.isFinite(controls.brake)).toBe(true);
  expect(controls.throttle).toBeGreaterThanOrEqual(0);
  expect(controls.throttle).toBeLessThanOrEqual(1);
  expect(controls.brake).toBeGreaterThanOrEqual(0);
  expect(controls.brake).toBeLessThanOrEqual(1);
  expect(controls.throttle * controls.brake).toBe(0);
}

function advance(car, targetSpeed) {
  const controls = advancedRacingSpeedControls(car, targetSpeed);
  expectValidPedals(controls);
  integrateVehiclePhysics(car, { steering: 0, ...controls }, 1 / 60, {
    physicsMode: 'advanced', tireDegradationEnabled: false,
  });
}

describe('advanced racing pace against vehicle forces', () => {
  test.each([
    { drsActive: false, initialSpeed: 20 },
    { drsActive: true, initialSpeed: 20 },
    { drsActive: false, initialSpeed: 80 },
    { drsActive: true, initialSpeed: 80 },
  ])('holds a 60 m/s cruise from $initialSpeed m/s with DRS $drsActive', ({ drsActive, initialSpeed }) => {
    const car = createCar({ speed: initialSpeed, drsActive });
    let largestSettledError = 0;
    for (let frame = 0; frame < 30 * 60; frame += 1) {
      advance(car, 60);
      if (frame >= 25 * 60) largestSettledError = Math.max(largestSettledError, Math.abs(simUnitsToMeters(car.speed) - 60));
    }
    expect(largestSettledError).toBeLessThan(0.6);
    expect(car.tireEnergy).toBe(100);
    expect(Math.abs(car.yawRate)).toBeLessThan(1e-8);
  });

  test.each([0, 30])('a zero-speed request stops and holds from %s m/s without reverse or creep', (speed) => {
    const car = createCar({ speed });
    for (let frame = 0; frame < 20 * 60; frame += 1) {
      advance(car, 0);
      expect(simUnitsToMeters(car.velocityX)).toBeGreaterThanOrEqual(-0.001);
    }
    expect(simUnitsToMeters(car.speed)).toBeLessThan(0.05);
    const stoppedPosition = car.x;
    for (let frame = 0; frame < 5 * 60; frame += 1) advance(car, 0);
    expect(Math.abs(simUnitsToMeters(car.x - stoppedPosition))).toBeLessThan(0.01);
    if (speed === 0) expect(Math.abs(simUnitsToMeters(car.x))).toBeLessThan(0.01);
  });

  test.each([
    { surface: 'track', tireEnergy: 100 },
    { surface: 'track', tireEnergy: 18 },
    { surface: 'gravel', tireEnergy: 100 },
    { surface: 'gravel', tireEnergy: 18 },
  ])('reserves lateral adhesion on $surface with tire energy $tireEnergy', ({ surface, tireEnergy }) => {
    const speed = 30;
    const car = createCar({ speed, surface, tireEnergy });
    const tireFactor = tirePerformanceFactor(tireEnergy);
    const lateralCapacity = advancedLateralAccelerationLimit(car, speed, tireFactor);
    const rearCapacity = advancedRearForceCapacity(car, speed, tireFactor);
    const straightThrottle = advancedRacingSpeedControls(car, 90).throttle;
    car.yawRate = lateralCapacity * 0.75 / speed;
    car.lateralAcceleration = speed * car.yawRate;
    const lateralFraction = Math.abs(speed * car.yawRate) / lateralCapacity;
    const longitudinalFraction = Math.sqrt(1 - lateralFraction ** 2);

    const accelerate = advancedRacingSpeedControls(car, 90);
    expectValidPedals(accelerate);
    expect(accelerate.throttle).toBeLessThan(straightThrottle);
    expect(accelerate.throttle * advancedDriveForce(car, speed))
      .toBeLessThanOrEqual(rearCapacity * longitudinalFraction + 1e-6);

    const slow = advancedRacingSpeedControls(car, 0);
    expectValidPedals(slow);
    expect(slow.brake).toBeGreaterThan(0);
    expect(slow.brake * car.brakeNewtons)
      .toBeLessThanOrEqual(lateralCapacity * car.mass * longitudinalFraction + 1e-6);
  });
});

describe('advanced corner speed planning', () => {
  test.each([0.005, 0.008])('uses the designated corner grip budget accurately on a %s /m bend', (curvature) => {
    const car = createCar();
    const planned = advancedCornerSpeed(car, curvature, 1);
    const lateralDemand = planned ** 2 * curvature;
    const designatedBudget = 0.6 * advancedLateralAccelerationLimit(car, planned, 1);
    // These bends do not reach the speed cap: numerical approximation should
    // not leave more than 1% of the deliberately conservative budget unused.
    expect(lateralDemand).toBeLessThanOrEqual(designatedBudget + 1e-6);
    expect(lateralDemand).toBeGreaterThan(designatedBudget * 0.99);
  });

  test.each([0.008, 0.02, 0.08])('uses achievable aero at the planned speed for curvature %s /m', (curvature) => {
    const slowApproach = createCar({ speed: 20 });
    const fastApproach = createCar({ speed: 70 });
    const planned = advancedCornerSpeed(slowApproach, curvature, 1);
    expect(planned).toBeGreaterThan(5);
    expect(planned).toBeLessThanOrEqual(simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
    expect(planned ** 2 * curvature)
      .toBeLessThanOrEqual(0.72 * advancedLateralAccelerationLimit(slowApproach, planned, 1) + 1e-6);
    expect(advancedCornerSpeed(fastApproach, curvature, 1)).toBeCloseTo(planned, 6);
    expect(advancedCornerSpeed(slowApproach, -curvature, 1)).toBeCloseTo(planned, 6);
  });

  test('tightening the corner, wearing tires or losing surface grip lowers the planned speed', () => {
    const fresh = createCar();
    const worn = createCar({ tireEnergy: 18 });
    const gravel = createCar({ surface: 'gravel' });
    const reference = advancedCornerSpeed(fresh, 0.02, 1);
    expect(advancedCornerSpeed(fresh, 0.04, 1)).toBeLessThan(reference);
    expect(advancedCornerSpeed(worn, 0.02, tirePerformanceFactor(18))).toBeLessThan(reference);
    expect(advancedCornerSpeed(gravel, 0.02, 1)).toBeLessThan(reference);
  });

  test('a straight returns a finite speed within the supported vehicle envelope', () => {
    const planned = advancedCornerSpeed(createCar(), 0, 1);
    expect(Number.isFinite(planned)).toBe(true);
    expect(planned).toBeGreaterThan(0);
    expect(planned).toBeLessThanOrEqual(simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
  });
});

describe('advanced following speed uses actual blockers', () => {
  function placedCar(id, distance, offset, speed = 0, overrides = {}) {
    return createCar({
      id, speed, x: metersToSimUnits(distance), y: metersToSimUnits(offset),
      raceDistance: metersToSimUnits(distance),
      trackState: {
        x: metersToSimUnits(distance), y: 0, normalX: 0, normalY: 1,
        surface: 'track', onTrack: true, signedOffset: metersToSimUnits(offset),
      },
      ...overrides,
    });
  }

  test('an adjacent car cannot hide a farther same-lane stopped leader', () => {
    const follower = placedCar('follower', 100, 0.2, 20);
    const leader = placedCar('leader', 120, 0.2);
    const adjacent = placedCar('adjacent', 110, 3.2, 20);
    const expected = advancedFollowingSpeed(follower, [follower, leader]);
    expect(expected).toBeLessThan(simUnitsToMeters(follower.speed));
    expect(advancedFollowingSpeed(follower, [follower, adjacent, leader])).toBe(expected);
    expect(advancedFollowingSpeed(follower, [leader, follower, adjacent])).toBe(expected);
  });

  test.each([
    { name: 'separate pit lane', followerOffset: 0, pitOffset: 20, surface: 'pit-lane', blocks: false },
    { name: 'overlapping pit entry', followerOffset: 9, pitOffset: 10.5, surface: 'pit-entry', blocks: true },
  ])('compares a $name against the same main-track corridor', ({ followerOffset, pitOffset, surface, blocks }) => {
    const follower = placedCar('follower', 100, followerOffset, 20);
    const pitCar = placedCar('pit-car', 120, pitOffset);
    // Resolve the production boundary: the retained reference point moves to
    // the pit centerline while mainTrackSignedOffset remains in the road frame.
    pitCar.trackState = resolveTrackStatePitOverride(
      { width: metersToSimUnits(20), kerbWidth: 0 },
      { ...pitCar.trackState, surface: 'gravel', crossTrackError: metersToSimUnits(Math.abs(pitOffset)) },
      {
        x: pitCar.x, y: pitCar.y, normalX: 0, normalY: 1,
        signedOffset: 0, crossTrackError: 0, surface, inPitLane: true, onTrack: true,
        pitLanePart: surface === 'pit-entry' ? 'entry' : 'lane',
        pitLaneDistanceAlong: metersToSimUnits(20), pitLaneTotalLength: metersToSimUnits(100),
      },
    );
    expect(pitCar.trackState.inPitLane).toBe(true);
    expect(pitCar.trackState.mainTrackSignedOffset).toBe(metersToSimUnits(pitOffset));

    const limit = advancedFollowingSpeed(follower, [follower, pitCar]);
    if (blocks) expect(limit).toBeLessThan(simUnitsToMeters(follower.speed));
    else expect(limit).toBe(advancedFollowingSpeed(follower, [follower]));
  });

  test.each([
    { name: 'retired', distance: 105, overrides: { outOfRace: true } },
    { name: 'destroyed', distance: 105, overrides: { destroyed: true } },
    { name: 'phantom', distance: 105, overrides: { interaction: { profile: 'phantom-race', collidable: false } } },
    { name: 'behind', distance: 95, overrides: {} },
  ])('ignores a $name participant when choosing a following constraint', ({ name, distance, overrides }) => {
    const follower = placedCar('follower', 100, 0.2, 20);
    const ignored = placedCar(name, distance, 0.2, 0, overrides);
    const leader = placedCar('leader', 120, 0.2);
    expect(advancedFollowingSpeed(follower, [follower, ignored]))
      .toBe(advancedFollowingSpeed(follower, [follower]));
    expect(advancedFollowingSpeed(follower, [follower, ignored, leader]))
      .toBe(advancedFollowingSpeed(follower, [follower, leader]));
  });

  test('does not mutate car state or reorder the caller-owned participant list', () => {
    const follower = placedCar('follower', 100, 0.2, 20);
    const cars = [placedCar('leader', 120, 0.2), follower, placedCar('adjacent', 110, 3.2, 20)];
    const before = structuredClone({ follower, cars });
    advancedFollowingSpeed(follower, cars);
    expect({ follower, cars }).toEqual(before);
  });
});
