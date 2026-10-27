import { describe, expect, test } from 'vitest';
import { DriverData } from '../data/driverData.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { arcadePreviewLookahead, arcadeRacingLookahead } from '../simulation/driver/arcadeRacePace.js';
import { metersToSimUnits } from '../simulation/units.js';

describe('arcade racing tracking horizon', () => {
  test('keeps a smooth bounded pursuit horizon separate from braking preview', () => {
    expect(arcadeRacingLookahead(0)).toBe(metersToSimUnits(8));
    expect(arcadeRacingLookahead(metersToSimUnits(20))).toBe(metersToSimUnits(15));
    expect(arcadeRacingLookahead(metersToSimUnits(80))).toBe(metersToSimUnits(35));
    const before = arcadeRacingLookahead(metersToSimUnits(40));
    const after = arcadeRacingLookahead(metersToSimUnits(40.001));
    expect(after - before).toBeCloseTo(metersToSimUnits(0.00035), 10);
    expect(arcadePreviewLookahead(metersToSimUnits(80))).toBeGreaterThan(arcadeRacingLookahead(metersToSimUnits(80)));
  });

  test('expert production driver completes tight bends without the long-chord excursion', { timeout: 15000 }, () => {
    const drivers = normalizeSimulatorDrivers([{ id: 'envelope-pilot', name: 'Envelope Pilot', color: '#e10600', tire: 'M' }], {
      entries: [{ driverId: 'envelope-pilot', driverNumber: 1,
        driver: new DriverData({ pace: 100, racecraft: 100, consistency: 100, aggression: 75, riskTolerance: 75, patience: 60 }) }],
    });
    drivers[0].vehicle = { ...drivers[0].vehicle, mass: 798, powerNewtons: 43000, brakeNewtons: 59000,
      downforceCoefficient: 6.1, dragCoefficient: 0.33, tireGrip: 2.4, tireCare: 1 };
    const sim = createRaceSimulation({ seed: 100, trackSeed: 7203, physicsMode: 'arcade', drivers, totalLaps: 3, warmup: false,
      rules: { standingStart: false, modules: { tireDegradation: { enabled: false }, pitStops: { enabled: false } } } });
    const car = sim.cars[0];
    let offRoadFrames = 0;
    for (let frame = 0; frame < 600 / FIXED_STEP && !car.finished && !car.destroyed && !car.outOfRace; frame += 1) {
      sim.step(FIXED_STEP);
      if (!car.trackState.onTrack && !car.trackState.inPitLane) offRoadFrames += 1;
    }
    expect(car.finished).toBe(true);
    expect(car.destroyed || car.outOfRace).toBeFalsy();
    expect(offRoadFrames).toBe(0);
    expect(car.tireEnergy).toBe(100);
  });
});
