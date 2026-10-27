import { describe, expect, test } from 'vitest';
import { DriverData } from '../data/driverData.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { racingDriverProfile } from '../simulation/driver/racingDriverProfile.js';
import { TRACK } from '../simulation/track/trackModel.js';
import { metersToSimUnits } from '../simulation/units.js';

function driverCar(rating, overrides = {}) {
  const constructor = new DriverData({ pace: rating, racecraft: rating, consistency: rating }).toConstructorArgs();
  return { ...constructor, index: 2, driverNumber: 71, raceDistance: metersToSimUnits(80), ...overrides };
}

describe('driver-dependent racing margins and judgement', () => {
  test('production driver normalization and car creation retain configured consistency without changing skill ratings', () => {
    const entries = [0, 50, 100].map((rating, index) => ({
      driverId: `driver-${index}`, driverNumber: 10 + index,
      driver: new DriverData({ pace: rating, racecraft: rating, consistency: rating }),
    }));
    const drivers = normalizeSimulatorDrivers(entries.map((entry) => ({ id: entry.driverId, name: entry.driverId })), { entries });
    const sim = createRaceSimulation({ seed: 71, track: TRACK, drivers, warmup: false, rules: { standingStart: false } });
    for (const [index, car] of sim.cars.entries()) {
      expect(car.consistency).toBeCloseTo(drivers[index].consistency, 14);
      expect(car.consistency).toBeCloseTo([0.59, 0.75, 0.91][index], 14);
      expect(car.pace).toBe(drivers[index].pace);
      expect(car.racecraft).toBe(drivers[index].racecraft);
      expect(racingDriverProfile(car).ability).toBeCloseTo(index / 2, 14);
      expect(racingDriverProfile(car).consistency).toBeCloseTo(index / 2, 14);
    }
    const legacy = createRaceSimulation({ seed: 71, track: TRACK, drivers: [{ id: 'legacy', name: 'Legacy' }], warmup: false });
    expect(legacy.cars[0].consistency).toBe(0.75);
    const explicit = createRaceSimulation({ seed: 71, track: TRACK, drivers: [{ id: 'explicit', name: 'Explicit', consistency: 0.2 }], warmup: false });
    expect(explicit.cars[0].consistency).toBe(0.2);
  });

  test('skill increases precision and usable policy shares independently of aggression', () => {
    const novice = racingDriverProfile(driverCar(0));
    const strongest = racingDriverProfile(driverCar(100));
    expect(novice.ability).toBeCloseTo(0, 14);
    expect(strongest.ability).toBeCloseTo(1, 14);
    expect(strongest.risk).toBe(novice.risk);
    expect(strongest.lateralShare).toBeGreaterThan(novice.lateralShare);
    expect(strongest.longitudinalShare).toBeGreaterThan(novice.longitudinalShare);
    expect(strongest.anticipationSeconds).toBeLessThan(novice.anticipationSeconds);
    expect(Math.abs(strongest.lineErrorMeters)).toBeLessThan(Math.abs(novice.lineErrorMeters));

    const conservative = racingDriverProfile(driverCar(50, { aggression: 0, personality: { riskTolerance: 0.2 } }));
    const aggressive = racingDriverProfile(driverCar(50, { aggression: 1, personality: { riskTolerance: 0.2 } }));
    expect(aggressive.ability).toBe(conservative.ability);
    expect(aggressive.consistency).toBe(conservative.consistency);
    expect(aggressive.risk).toBeGreaterThan(conservative.risk);
    expect(aggressive.lateralShare).toBeGreaterThan(conservative.lateralShare);
    expect(aggressive.anticipationSeconds).toBeLessThan(conservative.anticipationSeconds);
    const riskTolerant = racingDriverProfile(driverCar(50, { aggression: 0, personality: { riskTolerance: 1 } }));
    expect(riskTolerant.ability).toBe(conservative.ability);
    expect(riskTolerant.risk).toBeGreaterThan(conservative.risk);
  });

  test('finite defaults and clamping handle missing and extreme constructor values', () => {
    const neutral = racingDriverProfile();
    expect(neutral.ability).toBeCloseTo(0.5, 14);
    expect(neutral.consistency).toBeCloseTo(0.5, 14);
    expect(neutral.risk).toBe(0.5);
    const invalid = racingDriverProfile({ pace: NaN, racecraft: Infinity, consistency: -Infinity, aggression: NaN, raceDistance: NaN, driverNumber: Infinity });
    expect(invalid).toEqual(neutral);
    const high = racingDriverProfile({ pace: 99, racecraft: 99, consistency: 99, aggression: 99, personality: { riskTolerance: 99 } });
    const low = racingDriverProfile({ pace: -99, racecraft: -99, consistency: -99, aggression: -99, personality: { riskTolerance: -99 } });
    expect(high.ability).toBe(1);
    expect(high.consistency).toBe(1);
    expect(high.risk).toBe(1);
    expect(low.ability).toBe(0);
    expect(low.consistency).toBe(0);
    expect(low.risk).toBe(0);
    expect(racingDriverProfile({ personality: { baseAggression: 0.8, riskTolerance: 0.5 } }).risk).toBeCloseTo(0.62, 14);
  });

  test('judgement is deterministic, continuous across distances and has no mean offset', () => {
    const car = driverCar(0, { aggression: 1, personality: { riskTolerance: 1 } });
    const before = structuredClone(car);
    expect(racingDriverProfile(car)).toEqual(racingDriverProfile(car));
    expect(car).toEqual(before);
    const first = racingDriverProfile({ ...car, raceDistance: metersToSimUnits(179.999), progress: metersToSimUnits(179.999) });
    const next = racingDriverProfile({ ...car, raceDistance: metersToSimUnits(180.001), progress: 0 });
    expect(Math.abs(first.lineErrorMeters - next.lineErrorMeters)).toBeLessThan(0.00002);
    expect(Math.abs(first.speedJudgementScale - next.speedJudgementScale)).toBeLessThan(0.000002);
    expect(Math.abs(first.anticipationSeconds - next.anticipationSeconds)).toBeLessThan(0.000002);
    const profiles = Array.from({ length: 360 }, (_, index) => racingDriverProfile({ ...car, raceDistance: metersToSimUnits(index / 2) }));
    expect(profiles.reduce((sum, profile) => sum + profile.lineErrorMeters, 0) / profiles.length).toBeCloseTo(0, 14);
    expect(profiles.reduce((sum, profile) => sum + profile.speedJudgementScale, 0) / profiles.length).toBeCloseTo(1, 14);
    expect(profiles.reduce((sum, profile) => sum + profile.anticipationSeconds, 0) / profiles.length).toBeCloseTo(0.28, 14);
    expect(racingDriverProfile({ ...car, driverNumber: 72 })).not.toEqual(racingDriverProfile(car));
    expect(racingDriverProfile({ ...car, index: 3 })).not.toEqual(racingDriverProfile(car));
  });

  test.each([0, 50, 100])('bounds policy shares and smooth judgement variation at skill rating %s', (rating) => {
    const car = driverCar(rating, { aggression: 1, personality: { riskTolerance: 1 } });
    const maxLineError = rating === 100 ? 0.018 : 0.2;
    for (let meter = -180; meter <= 360; meter += 3) {
      const profile = racingDriverProfile({ ...car, raceDistance: metersToSimUnits(meter) });
      expect(Object.values(profile).every(Number.isFinite)).toBe(true);
      expect(profile.lateralShare).toBeGreaterThanOrEqual(0.74);
      expect(profile.lateralShare).toBeLessThanOrEqual(0.96);
      expect(profile.longitudinalShare).toBeGreaterThanOrEqual(0.86);
      expect(profile.longitudinalShare).toBeLessThanOrEqual(0.98);
      expect(Math.abs(profile.lineErrorMeters)).toBeLessThanOrEqual(maxLineError + 1e-14);
      expect(profile.speedJudgementScale).toBeGreaterThanOrEqual(0.988);
      expect(profile.speedJudgementScale).toBeLessThanOrEqual(1.012);
      expect(profile.anticipationSeconds).toBeGreaterThanOrEqual(0.11);
      expect(profile.anticipationSeconds).toBeLessThanOrEqual(0.345);
    }
  });
});
