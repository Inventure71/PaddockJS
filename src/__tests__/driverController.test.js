import { describe, expect, test } from 'vitest';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { createDriverInput, decideDriverControls, planRacingLine } from '../simulation/driverController.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToKph, simUnitsToMeters } from '../simulation/units.js';
import { offsetTrackPoint, pointAt } from '../simulation/trackModel.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';

const drivers = [
  { id: 'leader', code: 'LED', name: 'Leader', color: '#ff3860', pace: 1, racecraft: 0.78 },
  { id: 'chaser', code: 'CHS', name: 'Chaser', color: '#118ab2', pace: 1, racecraft: 0.86 },
];

const legalRacingSurfaces = ['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit'];

function sampleBuiltInAiRun(seconds, trackSeed = 20260430) {
  const sim = createRaceSimulation({
    seed: 100,
    trackSeed,
    drivers: PROJECT_DRIVERS.slice(0, 1),
    totalLaps: 8,
    rules: { standingStart: false },
  });
  const samples = [];

  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
    sim.step(1 / 60);
    const car = sim.cars[0];
    samples.push({
      speedKph: simSpeedToKph(car.speed),
      signedOffset: car.trackState?.signedOffset ?? 0,
      surface: car.trackState?.surface ?? 'track',
      positionSource: 'integrated-vehicle',
    });
  }

  return samples;
}

function placeCarAtDistance(sim, id, distance, speedKph = 120, offset = 0) {
  const point = pointAt(sim.track, distance);
  const position = offsetTrackPoint(point, offset);
  sim.setCarState(id, {
    x: position.x,
    y: position.y,
    heading: point.heading,
    speed: kphToSimSpeed(speedKph),
    raceDistance: distance,
    progress: point.distance,
  });
}

describe('driver controller', () => {
  test('exposes real driving inputs as clamped vehicle controls', () => {
    const input = createDriverInput();

    input.steer(VEHICLE_LIMITS.maxSteer * 2);
    input.accelerate(1.4);
    input.brake(-0.2);

    expect(input.controls()).toEqual({
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 1,
      brake: 0,
    });
  });

  test('decides how to drive without integrating the car physics state', () => {
    const sim = createRaceSimulation({
      seed: 12,
      drivers,
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const chaser = sim.cars.find((car) => car.id === 'chaser');
    const before = {
      x: chaser.x,
      y: chaser.y,
      heading: chaser.heading,
      speed: chaser.speed,
      tireEnergy: chaser.tireEnergy,
    };

    const controls = decideDriverControls({
      car: chaser,
      orderIndex: 1,
      race: sim.driverRaceContext(),
    });

    expect(controls.steering).toBeGreaterThanOrEqual(-VEHICLE_LIMITS.maxSteer);
    expect(controls.steering).toBeLessThanOrEqual(VEHICLE_LIMITS.maxSteer);
    expect(controls.throttle).toBeGreaterThanOrEqual(0);
    expect(controls.throttle).toBeLessThanOrEqual(1);
    expect(controls.brake).toBeGreaterThanOrEqual(0);
    expect(controls.brake).toBeLessThanOrEqual(1);
    expect({
      x: chaser.x,
      y: chaser.y,
      heading: chaser.heading,
      speed: chaser.speed,
      tireEnergy: chaser.tireEnergy,
    }).toEqual(before);
  });

  test('base AI pushes generated corners through the physics instead of crawling around them', () => {
    const samples = sampleBuiltInAiRun(30);
    const rollingSamples = samples.slice(4 * 60);
    const averageSpeedKph = samples.reduce((total, car) => total + car.speedKph, 0) / samples.length;
    const sortedRollingSpeeds = rollingSamples.map((car) => car.speedKph).sort((a, b) => a - b);
    const maxOffsetMeters = Math.max(...samples.map((car) => Math.abs(simUnitsToMeters(car.signedOffset))));
    const offRoadSamples = samples.filter((car) => !legalRacingSurfaces.includes(car.surface));

    expect(averageSpeedKph).toBeGreaterThan(185);
    expect(sortedRollingSpeeds[Math.floor(sortedRollingSpeeds.length * 0.1)]).toBeGreaterThan(95);
    expect(Math.min(...rollingSamples.map((car) => car.speedKph))).toBeGreaterThan(60);
    expect(maxOffsetMeters).toBeGreaterThan(7);
    expect(offRoadSamples).toEqual([]);
    expect(new Set(samples.map((car) => car.positionSource))).toEqual(new Set(['integrated-vehicle']));
  });

  test('base AI stays on track through sharp generated turns using normal controls', () => {
    const samples = sampleBuiltInAiRun(36, 2);
    const runningSamples = samples.slice(4 * 60);
    const offRoadSamples = runningSamples.filter((car) => !legalRacingSurfaces.includes(car.surface));
    const sortedRollingSpeeds = runningSamples.map((car) => car.speedKph).sort((a, b) => a - b);

    expect(offRoadSamples).toEqual([]);
    expect(sortedRollingSpeeds[Math.floor(sortedRollingSpeeds.length * 0.1)]).toBeGreaterThan(84);
    expect(new Set(samples.map((car) => car.positionSource))).toEqual(new Set(['integrated-vehicle']));
  });

  test('base AI stabilizes after a large off-track recovery instead of crossing back into gravel', () => {
    const sim = createRaceSimulation({
      seed: 124,
      trackSeed: 2,
      drivers: PROJECT_DRIVERS.slice(0, 1),
      totalLaps: 4,
      rules: { standingStart: false },
    });
    const car = sim.cars[0];
    const recoveryPoint = pointAt(sim.track, metersToSimUnits(1900));
    const recoveryPosition = offsetTrackPoint(
      recoveryPoint,
      metersToSimUnits(30),
    );
    sim.setCarState(car.id, {
      x: recoveryPosition.x,
      y: recoveryPosition.y,
      heading: recoveryPoint.heading + Math.PI * 0.75,
      speed: kphToSimSpeed(70),
      raceDistance: recoveryPoint.distance,
      progress: recoveryPoint.distance,
    });
    sim.recalculateRaceState({ updateDrs: false });

    const samples = [];
    for (let elapsed = 0; elapsed < 20; elapsed += 1 / 60) {
      sim.step(1 / 60);
      samples.push(sim.snapshot().cars[0]);
    }

    const firstLegalIndex = samples.findIndex((sample) => legalRacingSurfaces.includes(sample.surface));
    const stableSamples = firstLegalIndex >= 0
      ? samples.slice(firstLegalIndex, Math.min(samples.length, firstLegalIndex + 6 * 60))
      : [];

    expect(firstLegalIndex).toBeGreaterThanOrEqual(0);
    expect(firstLegalIndex / 60).toBeLessThan(8);
    expect(stableSamples.filter((sample) => !legalRacingSurfaces.includes(sample.surface))).toEqual([]);
    expect(samples.at(-1).speedKph).toBeGreaterThan(80);
    expect(new Set(samples.map((sample) => sample.positionSource))).toEqual(new Set(['integrated-vehicle']));
  });

  test('aggressive trailing drivers commit to a visible attacking line in real track space', () => {
    const sim = createRaceSimulation({
      seed: 92,
      trackSeed: 20260430,
      drivers,
      totalLaps: 3,
      rules: { standingStart: false },
    });

    placeCarAtDistance(sim, 'leader', metersToSimUnits(140), 145, 0);
    placeCarAtDistance(sim, 'chaser', metersToSimUnits(92), 152, 0);
    sim.recalculateRaceState({ updateDrs: false });

    const chaser = sim.cars.find((car) => car.id === 'chaser');
    chaser.desiredOffset = 0;
    chaser.aggression = 0.95;

    const plan = planRacingLine(chaser, 1, sim.driverRaceContext());

    expect(simUnitsToMeters(chaser.gapAhead)).toBeLessThan(55);
    expect(Math.abs(simUnitsToMeters(plan.offset))).toBeGreaterThan(1.2);
  });

  test('leading drivers defend a close attacker without snapping the car state', () => {
    const sim = createRaceSimulation({
      seed: 93,
      trackSeed: 20260430,
      drivers,
      totalLaps: 3,
      rules: { standingStart: false },
    });

    placeCarAtDistance(sim, 'leader', metersToSimUnits(140), 145, 0);
    placeCarAtDistance(sim, 'chaser', metersToSimUnits(112), 150, metersToSimUnits(2.8));
    sim.recalculateRaceState({ updateDrs: false });

    const leader = sim.cars.find((car) => car.id === 'leader');
    const before = {
      x: leader.x,
      y: leader.y,
      heading: leader.heading,
      speed: leader.speed,
    };
    leader.desiredOffset = 0;
    leader.aggression = 0.72;

    const plan = planRacingLine(leader, 0, sim.driverRaceContext());

    expect(Math.sign(plan.offset)).toBe(1);
    expect(simUnitsToMeters(plan.offset)).toBeGreaterThan(0.8);
    expect({
      x: leader.x,
      y: leader.y,
      heading: leader.heading,
      speed: leader.speed,
    }).toEqual(before);
  });

  test('close base-AI battles use attacking space without throwing cars into gravel', () => {
    const sim = createRaceSimulation({
      seed: 94,
      trackSeed: 20260430,
      drivers: [
        {
          id: 'leader',
          code: 'LED',
          name: 'Leader',
          color: '#ff3860',
          pace: 1,
          racecraft: 0.78,
          personality: { aggression: 0.55, riskTolerance: 0.75 },
        },
        {
          id: 'chaser',
          code: 'CHS',
          name: 'Chaser',
          color: '#118ab2',
          pace: 1.04,
          racecraft: 0.9,
          personality: { aggression: 0.9, riskTolerance: 0.95 },
        },
      ],
      totalLaps: 4,
      rules: { standingStart: false },
    });

    placeCarAtDistance(sim, 'leader', metersToSimUnits(140), 145, 0);
    placeCarAtDistance(sim, 'chaser', metersToSimUnits(92), 152, 0);
    sim.recalculateRaceState({ updateDrs: false });

    const samples = [];
    for (let elapsed = 0; elapsed < 12; elapsed += 1 / 60) {
      sim.step(1 / 60);
      samples.push(...sim.snapshot().cars);
    }

    const offRoadSamples = samples.filter((car) => !legalRacingSurfaces.includes(car.surface));
    const chaserSamples = samples.filter((car) => car.id === 'chaser');
    const maxChaserOffsetMeters = Math.max(...chaserSamples.map((car) => Math.abs(simUnitsToMeters(car.signedOffset))));
    const closestGapMeters = Math.min(...chaserSamples.map((car) => simUnitsToMeters(car.gapAhead)).filter(Number.isFinite));

    expect(offRoadSamples).toEqual([]);
    expect(maxChaserOffsetMeters).toBeGreaterThan(4);
    expect(closestGapMeters).toBeLessThan(20);
    expect(new Set(samples.map((car) => car.positionSource))).toEqual(new Set(['integrated-vehicle']));
  });

  test('faster aggressive base AI breaks out of last place in a same-lane train', () => {
    const trainDrivers = PROJECT_DRIVERS.slice(0, 8).map((driver, index) => ({
      ...driver,
      pace: index === 7 ? 1.12 : 0.95 + index * 0.001,
      racecraft: index === 7 ? 0.95 : 0.65,
      personality: {
        aggression: index === 7 ? 0.95 : 0.3,
        riskTolerance: index === 7 ? 0.95 : 0.4,
        patience: index === 7 ? 0.1 : 0.8,
      },
    }));
    const sim = createRaceSimulation({
      seed: 222,
      trackSeed: 20260430,
      drivers: trainDrivers,
      totalLaps: 5,
      rules: { standingStart: false },
    });
    const fastId = trainDrivers[7].id;

    sim.cars.forEach((entry, index) => {
      placeCarAtDistance(
        sim,
        entry.id,
        metersToSimUnits(350 - index * 30),
        index === 7 ? 220 : 140,
        0,
      );
    });
    sim.recalculateRaceState({ updateDrs: false });

    const samples = [];
    let contactCount = 0;
    for (let elapsed = 0; elapsed < 35; elapsed += 1 / 60) {
      sim.step(1 / 60);
      const snapshot = sim.snapshot();
      contactCount += snapshot.events.filter((event) => event.type === 'contact').length;
      samples.push(snapshot);
    }
    const fastSamples = samples.map((snapshot) => snapshot.cars.find((entry) => entry.id === fastId));
    const finalFast = fastSamples.at(-1);
    const maxFastOffsetMeters = Math.max(...fastSamples.map((sample) => Math.abs(simUnitsToMeters(sample.signedOffset))));
    const offRoadSamples = samples.flatMap((snapshot) => snapshot.cars)
      .filter((sample) => !legalRacingSurfaces.includes(sample.surface));

    expect(finalFast.rank).toBeLessThanOrEqual(6);
    expect(maxFastOffsetMeters).toBeGreaterThan(4);
    expect(contactCount).toBeLessThan(4);
    expect(offRoadSamples).toEqual([]);
    expect(new Set(fastSamples.map((sample) => sample.positionSource))).toEqual(new Set(['integrated-vehicle']));
  });
});
