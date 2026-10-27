import { describe, expect, test, vi } from 'vitest';
import * as pace from '../simulation/driver/advancedRacePace.js';
import * as envelope from '../simulation/driver/advancedRacingEnvelope.js';
import { racingDriverProfile } from '../simulation/driver/racingDriverProfile.js';
import { advancedRacingPreviewReserveMeters } from '../simulation/driver/advancedRacingTiming.js';
import { normalizeAngle } from '../simulation/simMath.js';
import { tirePerformanceFactor } from '../simulation/vehicle/vehiclePhysics.js';
import { decideDriverControls } from '../simulation/driver/driverController.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK, pointAt } from '../simulation/track/trackModel.js';
import { metersToSimUnits, simUnitsToMeters, TOP_SPEED_SIM_UNITS_PER_SECOND } from '../simulation/units.js';

const MAX_SPEED = simUnitsToMeters(TOP_SPEED_SIM_UNITS_PER_SECOND);

function createSimulation() {
  const sim = createRaceSimulation({
    seed: 71, track: TRACK, warmup: false, physicsMode: 'advanced',
    rules: { standingStart: false }, drivers: [{ id: 'driver', name: 'Driver' }],
  });
  const car = sim.cars[0];
  const progress = sim.track.length * 0.75;
  const point = pointAt(sim.track, progress);
  sim.setCarState(car.id, { x: point.x, y: point.y, heading: point.heading, progress, raceDistance: progress, speed: metersToSimUnits(70) });
  return sim;
}

// Preserve the pre-memoization braking decision as a query-count/equality
// oracle, using the actual track and uncached public corner calculation.
function uncachedTargetSpeed(car, track, pathCurvature, profile = racingDriverProfile(car)) {
  const speed = simUnitsToMeters(car.speed);
  const tireFactor = tirePerformanceFactor(car.tireEnergy ?? 100);
  const horizon = Math.max(80, speed * 3);
  const anticipationDistance = advancedRacingPreviewReserveMeters(speed, profile, 12);
  let targetSpeed = MAX_SPEED;
  const farDistance = Math.ceil(horizon / 12) * 12;
  let futureHeading = pointAt(track, car.progress + metersToSimUnits(farDistance + 12)).heading;
  const scratch = envelope.createAdvancedRacingEnvelopeScratch();
  for (let distance = farDistance; distance >= 0; distance -= 12) {
    const sample = pointAt(track, car.progress + metersToSimUnits(distance));
    const turnDirection = Math.sign(normalizeAngle(futureHeading - sample.heading)) || Math.sign(pathCurvature) || 1;
    const curve = sample.curvature * metersToSimUnits(1) * turnDirection;
    futureHeading = sample.heading;
    const corner = pace.advancedCornerSpeed(car, curve, tireFactor, profile);
    const futureSpeed = Math.min(targetSpeed, corner);
    const limits = envelope.estimateAdvancedRacingBrakeForce(car, futureSpeed, tireFactor, futureSpeed ** 2 * curve, scratch);
    const deceleration = (limits.brakeForce * profile.longitudinalShare + limits.brakeResistanceForce) / car.mass;
    const usableDistance = Math.max(0, distance + 12 - anticipationDistance) - Math.max(0, distance - anticipationDistance);
    targetSpeed = Math.min(corner, Math.sqrt(futureSpeed ** 2 + 2 * deceleration * usableDistance));
  }
  return Math.min(MAX_SPEED, Math.min(targetSpeed, pace.advancedCornerSpeed(car, pathCurvature, tireFactor, profile)) * profile.speedJudgementScale);
}

function queryKeys(spy) {
  return spy.mock.calls.map((call) => ({ speed: call[1], direction: call[4]?.turnDirection }));
}

function assertUniqueEndpointQueries(calls) {
  const endpoints = calls.filter(({ speed }) => speed === MAX_SPEED || speed === 0);
  const keys = endpoints.map(({ speed, direction }) => `${direction}:${speed}`);
  expect(keys.length).toBeGreaterThan(0);
  expect(new Set(keys).size).toBe(keys.length);
}

describe('decision-local advanced pace capacity endpoints', () => {
  test('production racing controls retain exact pedals and steering with fewer contact-capacity queries', () => {
    const before = createSimulation();
    const after = createSimulation();
    const capacity = vi.spyOn(envelope, 'estimateAdvancedRacingLateralCapacity');
    const targetSpeed = vi.spyOn(pace, 'advancedRaceTargetSpeed');
    try {
      targetSpeed.mockImplementation(uncachedTargetSpeed);
      const baselineControls = decideDriverControls({ car: before.cars[0], orderIndex: 0, race: before.driverRaceContext() });
      const baselineCalls = queryKeys(capacity);
      targetSpeed.mockRestore();
      capacity.mockClear();
      const controls = decideDriverControls({ car: after.cars[0], orderIndex: 0, race: after.driverRaceContext() });
      const calls = queryKeys(capacity);
      expect(controls).toEqual(baselineControls);
      expect(controls.throttle + controls.brake).toBeGreaterThan(0);
      assertUniqueEndpointQueries(calls);
      expect(baselineCalls.filter(({ speed }) => speed === MAX_SPEED).length).toBeGreaterThan(3);
      expect(calls.length).toBeLessThan(baselineCalls.length * 0.8);
      // Interior chord roots and variable braking capacities remain untouched.
      expect(calls.filter(({ speed }) => speed !== MAX_SPEED && speed !== 0)).toEqual(
        baselineCalls.filter(({ speed }) => speed !== MAX_SPEED && speed !== 0),
      );
    } finally {
      targetSpeed.mockRestore();
      capacity.mockRestore();
    }
  });

  test.each(['drs', 'tires', 'surface'])('a subsequent decision immediately reflects changed %s capacity', (change) => {
    const sim = createSimulation();
    const car = sim.cars[0];
    const original = pace.advancedRaceTargetSpeed(car, sim.track, 0.02);
    if (change === 'drs') car.drsActive = true;
    if (change === 'tires') car.tireEnergy = 18;
    if (change === 'surface') {
      car.trackState.surface = 'gravel';
      for (const wheel of car.wheelStates) wheel.surface = 'gravel';
    }
    const capacity = vi.spyOn(envelope, 'estimateAdvancedRacingLateralCapacity');
    try {
      const next = pace.advancedRaceTargetSpeed(car, sim.track, 0.02);
      const calls = queryKeys(capacity);
      assertUniqueEndpointQueries(calls);
      expect(next).toBe(uncachedTargetSpeed(car, sim.track, 0.02));
      expect(next).toBeLessThan(original);
    } finally {
      capacity.mockRestore();
    }
  });

  test('mixed wheel surfaces keep opposite turn directions separate within one decision', () => {
    const sim = createSimulation();
    const car = sim.cars[0];
    car.wheelStates[0].surface = 'gravel';
    car.wheelStates[2].surface = 'kerb';
    const current = pointAt(sim.track, car.progress);
    const future = pointAt(sim.track, car.progress + metersToSimUnits(12));
    const trackDirection = Math.sign(normalizeAngle(future.heading - current.heading)) || 1;
    const pathCurvature = -trackDirection * 0.02;
    const capacity = vi.spyOn(envelope, 'estimateAdvancedRacingLateralCapacity');
    try {
      const target = pace.advancedRaceTargetSpeed(car, sim.track, pathCurvature);
      const calls = queryKeys(capacity);
      assertUniqueEndpointQueries(calls);
      expect(new Set(calls.map(({ direction }) => direction)).size).toBe(2);
      expect(target).toBe(uncachedTargetSpeed(car, sim.track, pathCurvature));
    } finally { capacity.mockRestore(); }
  });

  test('direct public corner decisions remain uncached and react to mutation', () => {
    const car = createSimulation().cars[0];
    const reference = pace.advancedCornerSpeed(car, 0.02, 1);
    car.tireGrip *= 0.5;
    expect(pace.advancedCornerSpeed(car, 0.02, 1)).toBeLessThan(reference);
    expect(pace.advancedCornerSpeed(car, 0, 1)).toBe(MAX_SPEED);
  });
});
