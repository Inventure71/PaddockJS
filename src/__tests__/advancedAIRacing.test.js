import { describe, expect, test } from 'vitest';
import { slowTest } from './testModes.js';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { createDemoOptions } from '../../demo/src/data/demoOptions.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits } from '../simulation/units.js';
import { advancedRacingOffset } from '../simulation/driver/advancedRacingControls.js';
import { VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';

const options = {
  seed: 100, physicsMode: 'advanced', totalLaps: 3,
  rules: { standingStart: false, modules: { tireDegradation: { enabled: false } } },
};

describe('advanced AI racing pace and traffic', () => {
  test('holds its current line under cornering load and releases the lane change on exit', () => {
    const sim = createRaceSimulation({ ...options, trackSeed: 20260427, drivers: PROJECT_DRIVERS.slice(0, 1) });
    const car = sim.cars[0];
    const point = pointAt(sim.track, metersToSimUnits(200));
    const currentOffset = metersToSimUnits(2.5);
    const passingOffset = metersToSimUnits(-3);
    sim.setCarState(car.id, {
      x: point.x + point.normalX * currentOffset, y: point.y + point.normalY * currentOffset,
      heading: point.heading, speed: kphToSimSpeed(180), progress: point.distance, raceDistance: point.distance,
    });
    car.yawRate = 1;
    const loaded = advancedRacingOffset(car, passingOffset, sim.track.width);
    expect(loaded).toBeCloseTo(currentOffset, 6);
    car.yawRate = 0.1;
    const unwinding = advancedRacingOffset(car, passingOffset, sim.track.width);
    expect(unwinding).toBeLessThan(loaded);
    expect(unwinding).toBeGreaterThan(passingOffset);
    car.yawRate = 0;
    expect(advancedRacingOffset(car, passingOffset, sim.track.width)).toBeCloseTo(passingOffset, 6);
  });

  test('keeping a loaded corner line cannot select a target outside the usable road', () => {
    const sim = createRaceSimulation({ ...options, trackSeed: 20260427, drivers: PROJECT_DRIVERS.slice(0, 1) });
    const car = sim.cars[0];
    car.speed = kphToSimSpeed(180);
    car.yawRate = 1;
    const point = pointAt(sim.track, metersToSimUnits(200));
    for (const side of [-1, 1]) {
      car.x = point.x + point.normalX * sim.track.width * side;
      car.y = point.y + point.normalY * sim.track.width * side;
      car.trackState = { ...point };
      const target = advancedRacingOffset(car, 0, sim.track.width);
      expect(Math.abs(target)).toBeLessThanOrEqual(sim.track.width / 2 - VEHICLE_LIMITS.carWidth);
    }
  });

  test('brakes for an actual same-lane car even while planning a pass', () => {
    const sim = createRaceSimulation({ ...options, trackSeed: 20260427, drivers: PROJECT_DRIVERS.slice(0, 2) });
    const [leader, follower] = sim.cars;
    for (const [car, distance, speedKph] of [[leader, 115, 5], [follower, 100, 40]]) {
      const point = pointAt(sim.track, metersToSimUnits(distance));
      sim.setCarState(car.id, {
        x: point.x, y: point.y, heading: point.heading, speed: kphToSimSpeed(speedKph),
        progress: point.distance, raceDistance: point.distance,
      });
    }
    sim.setCarControls(leader.id, { steering: 0, throttle: 0, brake: 1 });
    sim.recalculateRaceState({ updateDrs: false });
    sim.step(FIXED_STEP);
    expect(follower.appliedControls.throttle).toBe(0);
    expect(follower.appliedControls.brake).toBeGreaterThan(0);
    let contacts = 0;
    for (let frame = 0; frame < 5 / FIXED_STEP; frame += 1) {
      sim.step(FIXED_STEP);
      contacts += sim.events.filter((event) => event.type === 'contact').length;
    }
    expect(contacts).toBe(0);
    expect(follower.destroyed || follower.outOfRace).toBeFalsy();
  });

  // These ceilings leave margin above the measured candidate and below the
  // saved baseline, protecting useful lap pace without prescribing a trajectory.
  slowTest.each([
    { trackSeed: 12, lapCeiling: 143 },
    { trackSeed: 7110, lapCeiling: 173 },
    { trackSeed: 7203, lapCeiling: 108 },
  ])('completes clean flying laps on track $trackSeed below $lapCeiling seconds', { timeout: 30000 }, ({ trackSeed, lapCeiling }) => {
    const sim = createRaceSimulation({ ...options, trackSeed, drivers: PROJECT_DRIVERS.slice(0, 1) });
    const car = sim.cars[0];
    let offRoadFrames = 0;
    for (let frame = 0; frame < 650 / FIXED_STEP && !car.finished; frame += 1) {
      sim.step(FIXED_STEP);
      if (!car.trackState.onTrack) offRoadFrames += 1;
    }
    expect(car.finished).toBe(true);
    expect(offRoadFrames).toBe(0);
    expect(car.lapTelemetry.lastLapTime).toBeLessThan(lapCeiling);
  });

  slowTest('finishes the tight demo field through braking, traffic and tire wear', { timeout: 45000 }, () => {
    const sim = createRaceSimulation(resolveF1SimulatorOptions(createDemoOptions({
      seed: 93, trackSeed: 7203, totalLaps: 3, physicsMode: 'advanced', warmup: false,
    })));
    let contacts = 0;
    let offRoadFrames = 0;
    for (let frame = 0; frame < 400 / FIXED_STEP && !sim.raceControl.finished; frame += 1) {
      sim.step(FIXED_STEP);
      contacts += sim.events.filter((event) => event.type === 'contact').length;
      for (const car of sim.cars) {
        if (!car.finished && !car.trackState.onTrack && !['entering', 'queued', 'servicing', 'exiting'].includes(car.pitStop?.status)) offRoadFrames += 1;
      }
    }
    expect(sim.cars).toHaveLength(10);
    expect(sim.cars.every((car) => car.finished && !car.destroyed && !car.outOfRace)).toBe(true);
    expect(sim.time).toBeLessThan(365);
    expect(contacts).toBeLessThan(10);
    expect(offRoadFrames * FIXED_STEP).toBeLessThan(4);
  });
});

test('advanced racing brakes for a same-lane blocker even with a nearer adjacent car', () => {
  const sim = createRaceSimulation({ ...options, trackSeed: 20260427, drivers: PROJECT_DRIVERS.slice(0, 3) });
  const [follower, blocker, adjacent] = sim.cars;
  for (const [car, distance, offset, speedKph] of [
    [follower, 100, 0.2, 72],
    [blocker, 120, 0.2, 0],
    [adjacent, 110, 3.2, 72],
  ]) {
    const point = pointAt(sim.track, metersToSimUnits(distance));
    sim.setCarState(car.id, {
      x: point.x + point.normalX * metersToSimUnits(offset),
      y: point.y + point.normalY * metersToSimUnits(offset),
      heading: point.heading, speed: kphToSimSpeed(speedKph),
      progress: point.distance, raceDistance: point.distance, desiredOffset: metersToSimUnits(offset),
    });
  }
  sim.setCarControls(blocker.id, { steering: 0, throttle: 0, brake: 1 });
  sim.setCarControls(adjacent.id, { steering: 0, throttle: 0, brake: 0 });
  sim.recalculateRaceState({ updateDrs: false });

  sim.step(FIXED_STEP);

  expect(follower.appliedControls.throttle).toBe(0);
  expect(follower.appliedControls.brake).toBeGreaterThan(0);
});

test('advanced following recognizes overlapping cars on opposite sides of the centerline', () => {
  const sim = createRaceSimulation({ ...options, trackSeed: 20260427, drivers: PROJECT_DRIVERS.slice(0, 2) });
  const [follower, blocker] = sim.cars;
  for (const [car, distance, offset, speedKph] of [[follower, 100, -0.3, 72], [blocker, 120, 0.3, 0]]) {
    const point = pointAt(sim.track, metersToSimUnits(distance));
    sim.setCarState(car.id, {
      x: point.x + point.normalX * metersToSimUnits(offset),
      y: point.y + point.normalY * metersToSimUnits(offset),
      heading: point.heading, speed: kphToSimSpeed(speedKph),
      progress: point.distance, raceDistance: point.distance, desiredOffset: metersToSimUnits(offset),
    });
  }
  // The representative outer wheel offsets straddle the centerline too, but
  // their separation is not the physical clearance between the car centers.
  expect(Math.abs(follower.trackState.signedOffset - blocker.trackState.signedOffset))
    .toBeGreaterThan(metersToSimUnits(2.3));
  sim.setCarControls(blocker.id, { steering: 0, throttle: 0, brake: 1 });
  sim.recalculateRaceState({ updateDrs: false });

  sim.step(FIXED_STEP);

  expect(follower.appliedControls.throttle).toBe(0);
  expect(follower.appliedControls.brake).toBeGreaterThan(0);
});
