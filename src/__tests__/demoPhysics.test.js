import { describe, expect, test } from 'vitest';
import { slowTest } from './testModes.js';
import { createDemoOptions } from '../../demo/src/data/demoOptions.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { createPaddockEnvironment } from '../environment/index.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';

const automaticRaces = [
  { name: 'hero', seed: 71, trackSeed: 7109, totalLaps: 5 },
  { name: 'components', seed: 72, trackSeed: 7110, totalLaps: 3 },
  ...['dashboard', 'timing-overlay', 'compact-race', 'full-dashboard'].map((preset, index) => ({
    name: preset, preset, seed: 90 + index, trackSeed: 7200 + index, totalLaps: 3,
  })),
];

describe('demo physics selection', () => {
  test('browser and headless package defaults remain arcade', () => {
    expect(resolveF1SimulatorOptions({ drivers: createDemoOptions().drivers }).physicsMode).toBe('arcade');
    const env = createPaddockEnvironment({
      drivers: [{ id: 'driver', name: 'Driver', color: '#ff0000' }],
      controlledDrivers: ['driver'], seed: 71, trackSeed: 7109, warmup: false,
    });
    try {
      expect(env.reset().state.snapshot.physicsMode).toBe('arcade');
    } finally {
      env.destroy();
    }
  });

  test.each(automaticRaces)('$name uses the ordinary arcade demo mode', (race) => {
    const options = resolveF1SimulatorOptions(createDemoOptions(race));
    expect(options.physicsMode).toBe('arcade');
  });

  test('an explicit advanced lab keeps advanced physics', () => {
    const options = resolveF1SimulatorOptions(createDemoOptions({ physicsMode: 'advanced' }));
    expect(options.physicsMode).toBe('advanced');
  });

  slowTest.each(automaticRaces)('$name keeps its ten-car field racing through three simulated minutes', { timeout: 30000 }, (race) => {
    const options = resolveF1SimulatorOptions(createDemoOptions({ ...race, warmup: false }));
    const sim = createRaceSimulation(options);
    expect(sim.cars).toHaveLength(10);
    for (let step = 0; step < 180 / FIXED_STEP; step += 1) sim.step(FIXED_STEP);
    const snapshot = sim.snapshot();
    expect(snapshot.cars.filter((car) => car.dnf)).toEqual([]);
    expect(Math.max(...sim.cars.map((car) => car.raceDistance / sim.track.length))).toBeGreaterThan(0.9);
  });
});
