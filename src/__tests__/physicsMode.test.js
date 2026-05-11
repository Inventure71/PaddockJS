import { describe, expect, test } from 'vitest';
import { slowTest } from './testModes.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { createPaddockEnvironment } from '../environment/index.js';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { CHAMPIONSHIP_ENTRY_BLUEPRINTS } from '../data/championship.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToKph } from '../simulation/units.js';
import { integrateVehiclePhysics, VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';
import { offsetTrackPoint, pointAt } from '../simulation/trackModel.js';

const LEGAL_RACING_SURFACES = ['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit'];

function baseCar(overrides = {}) {
  return {
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    heading: 0,
    previousHeading: 0,
    steeringAngle: 0,
    yawRate: 0,
    turnRadius: Infinity,
    speed: kphToSimSpeed(160),
    mass: 798,
    powerNewtons: 43000,
    brakeNewtons: 59000,
    dragCoefficient: 0.33,
    downforceCoefficient: 6.1,
    tireGrip: 2.4,
    tireEnergy: 100,
    tireCare: 1,
    trackState: { surface: 'track' },
    wheelStates: [],
    ...overrides,
  };
}

function stepMany(car, controlsForStep, seconds, physicsMode = 'simulator') {
  const dt = 1 / 60;
  for (let step = 0; step < seconds * 60; step += 1) {
    integrateVehiclePhysics(car, controlsForStep(step, car), dt, { physicsMode });
  }
  return car;
}

describe('physics mode', () => {
  test('normalizes browser and environment physics mode options', () => {
    const browser = resolveF1SimulatorOptions({
      drivers: PROJECT_DRIVERS.slice(0, 1),
      physicsMode: 'simulator',
    });
    const fallback = resolveF1SimulatorOptions({
      drivers: PROJECT_DRIVERS.slice(0, 1),
      physicsMode: 'invalid',
    });
    const env = createPaddockEnvironment({
      drivers: PROJECT_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [PROJECT_DRIVERS[0].id],
      physicsMode: 'simulator',
      rules: { standingStart: false },
    });

    expect(browser.physicsMode).toBe('simulator');
    expect(fallback.physicsMode).toBe('arcade');
    expect(env.reset().state.snapshot.physicsMode).toBe('simulator');
  });

  test('keeps arcade physics as the default race simulation mode', () => {
    const sim = createRaceSimulation({
      seed: 1,
      drivers: PROJECT_DRIVERS.slice(0, 1),
      rules: { standingStart: false },
    });

    expect(sim.physicsMode).toBe('arcade');
    expect(sim.snapshot().physicsMode).toBe('arcade');
  });

  test('simulator physics prevents high-speed zig-zag steering from accelerating to top speed', () => {
    const car = baseCar();

    stepMany(car, (step) => ({
      steering: (Math.floor(step / 10) % 2 === 0 ? 1 : -1) * VEHICLE_LIMITS.maxSteer,
      throttle: 1,
      brake: 0,
    }), 5);

    expect(simSpeedToKph(car.speed)).toBeLessThan(175);
    expect(car.gripUsage).toBeGreaterThan(0.95);
    expect(car.tractionLimited).toBe(true);
    expect(['understeer', 'oversteer', 'spin-risk']).toContain(car.stabilityState);
  });

  test('simulator physics trades throttle against cornering grip', () => {
    const flatThrottle = baseCar({ steeringAngle: VEHICLE_LIMITS.maxSteer });
    const coast = baseCar({ steeringAngle: VEHICLE_LIMITS.maxSteer });

    integrateVehiclePhysics(flatThrottle, {
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 1,
      brake: 0,
    }, 1 / 60, { physicsMode: 'simulator' });
    integrateVehiclePhysics(coast, {
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 0,
      brake: 0,
    }, 1 / 60, { physicsMode: 'simulator' });

    expect(flatThrottle.tractionLimited).toBe(true);
    expect(flatThrottle.gripUsage).toBeGreaterThan(coast.gripUsage);
    expect(Math.abs(flatThrottle.yawRate)).toBeLessThanOrEqual(Math.abs(coast.yawRate));
  });

  test('simulator physics treats kerb as legal but less stable than track', () => {
    const track = baseCar({ trackState: { surface: 'track' }, steeringAngle: VEHICLE_LIMITS.maxSteer });
    const kerb = baseCar({ trackState: { surface: 'kerb' }, steeringAngle: VEHICLE_LIMITS.maxSteer });

    integrateVehiclePhysics(track, {
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 0.7,
      brake: 0,
    }, 1 / 60, { physicsMode: 'simulator' });
    integrateVehiclePhysics(kerb, {
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 0.7,
      brake: 0,
    }, 1 / 60, { physicsMode: 'simulator' });

    expect(kerb.gripUsage).toBeGreaterThan(track.gripUsage);
    expect(simSpeedToKph(kerb.speed)).toBeLessThan(simSpeedToKph(track.speed));
    expect(kerb.stabilityState).not.toBe('stable');
  });

  slowTest('simulator snapshots and observations expose physics telemetry', () => {
    const env = createPaddockEnvironment({
      drivers: PROJECT_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [PROJECT_DRIVERS[0].id],
      physicsMode: 'simulator',
      rules: { standingStart: false },
      frameSkip: 1,
    });

    const driverId = PROJECT_DRIVERS[0].id;
    const result = env.step({
      [driverId]: {
        steering: 1,
        throttle: 1,
        brake: 0,
      },
    });
    const car = result.state.snapshot.cars[0];
    const self = result.observation[driverId].object.self;
    const vectorNames = result.observation[driverId].schema.map((entry) => entry.name);

    expect(car.lateralG).toEqual(expect.any(Number));
    expect(car.longitudinalG).toEqual(expect.any(Number));
    expect(car.gripUsage).toEqual(expect.any(Number));
    expect(car.slipAngleRadians).toEqual(expect.any(Number));
    expect(typeof car.tractionLimited).toBe('boolean');
    expect(['stable', 'understeer', 'oversteer', 'spin-risk']).toContain(car.stabilityState);
    expect(self.gripUsage).toBe(car.gripUsage);
    expect(vectorNames).toContain('self.gripUsage');
  });

  slowTest('built-in simulator-mode AI drives through physics without crawling or treating runoff as track', () => {
    const sim = createRaceSimulation({
      seed: 100,
      trackSeed: 20260427,
      physicsMode: 'simulator',
      drivers: PROJECT_DRIVERS.slice(0, 1),
      totalLaps: 4,
      rules: { standingStart: false },
    });
    const samples = [];

    for (let elapsed = 0; elapsed < 30; elapsed += 1 / 60) {
      sim.step(1 / 60);
      const car = sim.snapshot().cars[0];
      samples.push(car);
    }

    const rollingSamples = samples.slice(4 * 60);
    const offRoadSamples = rollingSamples.filter((car) => !LEGAL_RACING_SURFACES.includes(car.surface));
    const minRollingSpeed = Math.min(...rollingSamples.map((car) => car.speedKph));
    const averageRollingSpeed = rollingSamples.reduce((total, car) => total + car.speedKph, 0) / rollingSamples.length;

    expect(offRoadSamples).toHaveLength(0);
    expect(minRollingSpeed).toBeGreaterThan(30);
    expect(averageRollingSpeed).toBeGreaterThan(90);
    expect(new Set(samples.map((car) => car.positionSource))).toEqual(new Set(['integrated-vehicle']));
    expect(samples.some((car) => car.gripUsage > 0.55)).toBe(true);
  });

  test('built-in simulator-mode AI can recover from gravel without stalling', () => {
    const sim = createRaceSimulation({
      seed: 101,
      trackSeed: 20260430,
      physicsMode: 'simulator',
      drivers: PROJECT_DRIVERS.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const car = sim.cars[0];
    const recoveryPoint = pointAt(sim.track, metersToSimUnits(900));
    const recoveryPosition = offsetTrackPoint(recoveryPoint, metersToSimUnits(13));
    sim.setCarState(car.id, {
      x: recoveryPosition.x,
      y: recoveryPosition.y,
      heading: recoveryPoint.heading + 0.24,
      speed: kphToSimSpeed(46),
      raceDistance: recoveryPoint.distance,
      progress: recoveryPoint.distance,
    });
    sim.recalculateRaceState({ updateDrs: false });

    const samples = [];
    for (let elapsed = 0; elapsed < 18; elapsed += 1 / 60) {
      sim.step(1 / 60);
      samples.push(sim.snapshot().cars[0]);
    }

    const final = samples.at(-1);
    const allWheelsOutsideSteps = samples.filter((sample) =>
      sample.wheels.every((wheel) => wheel.fullyOutsideWhiteLine)
    ).length;

    expect(final.speedKph).toBeGreaterThan(35);
    expect(LEGAL_RACING_SURFACES).toContain(final.surface);
    expect(allWheelsOutsideSteps).toBeLessThan(240);
    expect(new Set(samples.map((sample) => sample.positionSource))).toEqual(new Set(['integrated-vehicle']));
  });
});
