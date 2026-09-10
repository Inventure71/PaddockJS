import { describe, expect, test } from 'vitest';
import { slowTest } from './testModes.js';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { createDemoOptions } from '../../demo/src/data/demoOptions.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { decideDriverControls } from '../simulation/driver/driverController.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { arcadeTrackCornerSpeedLimit, integrateVehiclePhysics, tirePerformanceFactor, VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';

function solo(trackSeed = 20260427) {
  return createRaceSimulation({
    seed: 100, trackSeed, physicsMode: 'arcade', drivers: PROJECT_DRIVERS.slice(0, 1), totalLaps: 3,
    rules: { standingStart: false, modules: { tireDegradation: { enabled: false } } },
  });
}

function place(sim, { distance, speedKph, offset = 0, headingOffset = 0, tireEnergy = 100 }) {
  const car = sim.cars[0];
  const point = pointAt(sim.track, metersToSimUnits(distance));
  sim.setCarState(car.id, {
    x: point.x + point.normalX * metersToSimUnits(offset),
    y: point.y + point.normalY * metersToSimUnits(offset),
    heading: point.heading + headingOffset,
    speed: kphToSimSpeed(speedKph), steeringAngle: 0, tireEnergy,
    progress: point.distance, raceDistance: point.distance, desiredOffset: 0,
  });
  sim.recalculateRaceState({ updateDrs: false });
  return car;
}

describe('arcade racing control behavior', () => {
  test('corrects outward heading before the second bend instead of steering farther outward', () => {
    const sim = solo(7110);
    // Representative pre-excursion state from the legacy driver's first lap.
    const car = place(sim, { distance: 1319, offset: -1.31, headingOffset: 0.115, speedKph: 181 });
    expect(car.trackState.onTrack).toBe(true);

    sim.step(FIXED_STEP);

    expect(car.appliedControls.steering).toBeLessThan(0);
    for (let frame = 0; frame < 3 / FIXED_STEP; frame += 1) {
      sim.step(FIXED_STEP);
      expect(car.trackState.onTrack).toBe(true);
    }
    expect(car.destroyed || car.outOfRace).toBeFalsy();
  });

  test('keeps accelerating far from a corner and brakes when the same approach becomes close', () => {
    const farSim = solo();
    const far = place(farSim, { distance: 240, speedKph: 270 });
    const nearSim = solo();
    const near = place(nearSim, { distance: 515, speedKph: 270 });

    farSim.step(FIXED_STEP);
    nearSim.step(FIXED_STEP);

    expect(far.appliedControls.throttle).toBeGreaterThan(0.5);
    expect(far.appliedControls.brake).toBe(0);
    expect(near.appliedControls.throttle).toBe(0);
    expect(near.appliedControls.brake).toBeGreaterThan(0.1);
  });

  test.each([false, true])('worn tires trigger corner braking below the old 96 km/h floor with DRS %s', (drsActive) => {
    const sim = solo();
    const car = place(sim, { distance: 620, speedKph: 92, tireEnergy: 18 });
    car.drsActive = drsActive;
    const controls = decideDriverControls({ car, orderIndex: 0, race: sim });

    expect(controls.throttle).toBe(0);
    expect(controls.brake).toBeGreaterThan(0);
    const before = car.speed;
    integrateVehiclePhysics(car, controls, FIXED_STEP, { physicsMode: 'arcade', tireDegradationEnabled: false });
    expect(car.speed).toBeLessThan(before);
  });

  test('the worn-tire corner speed remains achievable through the actual arcade yaw response', () => {
    const sim = solo();
    const car = place(sim, { distance: 620, speedKph: 0, tireEnergy: 18 });
    const curvature = 1 / 50;
    const speedMps = arcadeTrackCornerSpeedLimit(car, curvature, 0.85);
    expect(speedMps * 3.6).toBeLessThan(96);
    expect(speedMps).toBeGreaterThan(1);
    car.speed = metersToSimUnits(speedMps);
    const steering = Math.atan(simUnitsToMeters(VEHICLE_LIMITS.wheelbase) * curvature / tirePerformanceFactor(car.tireEnergy));
    car.steeringAngle = steering;

    integrateVehiclePhysics(car, { steering, throttle: 0, brake: 0 }, FIXED_STEP, {
      physicsMode: 'arcade', tireDegradationEnabled: false,
    });

    expect(car.tractionLimited).toBe(false);
    expect(car.yawRate / simUnitsToMeters(car.speed)).toBeCloseTo(curvature, 6);
  });

  test('recovers a backward-facing placement without driving far in the wrong direction', () => {
    const sim = solo();
    const car = place(sim, { distance: 200, speedKph: 20, headingOffset: Math.PI });
    const initialDistance = car.raceDistance;
    let minimumDistance = initialDistance;
    for (let frame = 0; frame < 20 / FIXED_STEP; frame += 1) {
      sim.step(FIXED_STEP);
      minimumDistance = Math.min(minimumDistance, car.raceDistance);
    }
    expect(simUnitsToMeters(initialDistance - minimumDistance)).toBeLessThan(50);
    expect(car.raceDistance).toBeGreaterThan(initialDistance);
    expect(car.trackState.onTrack).toBe(true);
    expect(car.destroyed || car.outOfRace).toBeFalsy();
  });
});

describe('complete arcade races', () => {
  slowTest.each([
    { trackSeed: 7110, lapCeiling: 145 },
    { trackSeed: 26, lapCeiling: 115 },
  ])('completes clean laps on track $trackSeed below $lapCeiling seconds', { timeout: 30000 }, ({ trackSeed, lapCeiling }) => {
    const sim = solo(trackSeed);
    const car = sim.cars[0];
    let offRoadFrames = 0;
    for (let frame = 0; frame < 650 / FIXED_STEP && !car.finished; frame += 1) {
      sim.step(FIXED_STEP);
      if (!car.trackState.onTrack) offRoadFrames += 1;
    }
    expect(car.finished).toBe(true);
    expect(car.destroyed || car.outOfRace).toBeFalsy();
    expect(offRoadFrames).toBe(0);
    expect(car.lapTelemetry.lastLapTime).toBeLessThan(lapCeiling);
  });

  slowTest.each([
    { name: 'hero', seed: 71, trackSeed: 7109, totalLaps: 5 },
    { name: 'dashboard', seed: 90, trackSeed: 7200, totalLaps: 3 },
  ])('finishes the $name field with tire wear and pit service enabled', { timeout: 45000 }, ({ seed, trackSeed, totalLaps }) => {
    const sim = createRaceSimulation(resolveF1SimulatorOptions(createDemoOptions({
      seed, trackSeed, totalLaps, physicsMode: 'arcade', warmup: false,
    })));
    let serviceCompletions = 0;
    let lowestTireEnergy = 100;
    for (let frame = 0; frame < 1200 / FIXED_STEP && !sim.raceControl.finished; frame += 1) {
      sim.step(FIXED_STEP);
      serviceCompletions += sim.events.filter((event) => event.type === 'pit-stop-complete').length;
      lowestTireEnergy = Math.min(lowestTireEnergy, ...sim.cars.map((car) => car.tireEnergy));
    }
    expect(sim.cars).toHaveLength(10);
    expect(sim.cars.every((car) => car.finished && !car.destroyed && !car.outOfRace)).toBe(true);
    expect(lowestTireEnergy).toBeLessThan(40);
    expect(serviceCompletions).toBeGreaterThan(0);
  });
});
