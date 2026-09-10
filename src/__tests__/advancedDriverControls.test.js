import { describe, expect, test } from 'vitest';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { pointAt, offsetTrackPoint } from '../simulation/track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToKph } from '../simulation/units.js';

function createSimulation(count = 1) {
  return createRaceSimulation({
    seed: 100,
    trackSeed: 20260427,
    physicsMode: 'advanced',
    drivers: PROJECT_DRIVERS.slice(0, count),
    totalLaps: 4,
    rules: { standingStart: false },
  });
}

describe('built-in driver with axle tire forces', () => {
  test('recovers from gravel on worn tires instead of holding drive below rolling resistance', () => {
    const sim = createRaceSimulation({
      seed: 100,
      trackSeed: 20260427,
      physicsMode: 'advanced',
      drivers: PROJECT_DRIVERS.slice(0, 1),
      totalLaps: 4,
      rules: { standingStart: false, modules: { stalledDnf: { enabled: true, maxStoppedSeconds: 5 } } },
    });
    const car = sim.cars[0];
    const point = pointAt(sim.track, metersToSimUnits(900));
    const position = offsetTrackPoint(point, metersToSimUnits(13));
    sim.setCarState(car.id, {
      x: position.x, y: position.y, heading: point.heading - 0.12,
      speed: kphToSimSpeed(6), tireEnergy: 18,
    });
    expect(car.wheelStates.every((wheel) => wheel.surface === 'gravel')).toBe(true);

    for (let frame = 0; frame < 20 * 60; frame += 1) sim.step(1 / 60);

    expect(car.outOfRace).not.toBe(true);
    expect(car.destroyed).not.toBe(true);
    expect(car.trackState.onTrack).toBe(true);
    expect(simSpeedToKph(car.speed)).toBeGreaterThan(30);
  });

  test('takes over a saturated straight launch without entering off-track recovery', () => {
    const sim = createSimulation();
    const car = sim.cars[0];
    const point = pointAt(sim.track, metersToSimUnits(100));
    sim.setCarState(car.id, {
      x: point.x, y: point.y, heading: point.heading, speed: kphToSimSpeed(40),
    });
    sim.setCarControls(car.id, { steering: 0, throttle: 1, brake: 0 });
    sim.step(1 / 60);
    expect(car.gripUsage).toBeGreaterThan(1.7);
    sim.clearCarControls(car.id);

    for (let frame = 0; frame < 120; frame += 1) sim.step(1 / 60);

    expect(car.rejoinRecoveryFrames ?? 0).toBe(0);
    expect(car.trackState.onTrack).toBe(true);
    expect(Math.abs(car.slipAngleRadians)).toBeLessThan(0.08);
    expect(simSpeedToKph(car.speed)).toBeGreaterThan(70);
    expect(car.gripUsage).toBeLessThan(1);
  });

  test('arrests a sideways slide before trying to accelerate back to the track', () => {
    const sim = createSimulation();
    const car = sim.cars[0];
    const point = pointAt(sim.track, metersToSimUnits(100));
    const speed = kphToSimSpeed(40);
    sim.setCarState(car.id, {
      x: point.x, y: point.y, heading: point.heading, speed,
      velocityX: Math.cos(point.heading + 0.8) * speed,
      velocityY: Math.sin(point.heading + 0.8) * speed,
      slipAngleRadians: 0.8,
    });

    sim.step(1 / 60);
    expect(car.appliedControls).toEqual({ steering: 0, throttle: 0, brake: 1 });
    for (let frame = 0; frame < 30; frame += 1) sim.step(1 / 60);
    expect(car.speed).toBeLessThan(speed * 0.5);
    expect(car.destroyed).not.toBe(true);
  });

  test('a full field follows the safety car through generated corners using tire-limited controls', () => {
    const sim = createSimulation(10);
    sim.setSafetyCar(true);
    let offRoadFrames = 0;
    let largestSlip = 0;
    for (let frame = 0; frame < 60 * 60; frame += 1) {
      sim.step(1 / 60);
      for (const car of sim.cars) {
        if (!car.trackState.onTrack) offRoadFrames += 1;
        largestSlip = Math.max(largestSlip, Math.abs(car.slipAngleRadians));
      }
    }
    expect(offRoadFrames).toBe(0);
    expect(largestSlip).toBeLessThan(0.08);
    expect(sim.cars.every((car) => !car.destroyed && !car.outOfRace)).toBe(true);
    expect(Math.min(...sim.cars.map((car) => simSpeedToKph(car.speed)))).toBeGreaterThan(30);
  });
});
