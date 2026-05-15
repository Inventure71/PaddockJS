import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEMO_PROJECT_DRIVERS } from '../index.js';
import { createPaddockEnvironment } from '../environment/index.js';
import { createRaceSimulation, F1RaceSimulation } from '../simulation/raceSimulation.js';
import { resetWarmupRuntimeCache } from '../simulation/warmup/runtimeWarmup.js';

describe('runtime warmup', () => {
  let stepSpy;

  beforeEach(() => {
    resetWarmupRuntimeCache();
    stepSpy = vi.spyOn(F1RaceSimulation.prototype, 'step');
  });

  afterEach(() => {
    stepSpy.mockRestore();
    resetWarmupRuntimeCache();
  });

  test('reuses config-change warmup cache for direct simulation creation', () => {
    createRaceSimulation({
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
      seed: 17,
      trackSeed: 2701,
      warmup: { enabled: true, policy: 'config-change', steps: 3 },
    });
    expect(stepSpy).toHaveBeenCalledTimes(3);

    createRaceSimulation({
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
      seed: 17,
      trackSeed: 2701,
      warmup: { enabled: true, policy: 'config-change', steps: 3 },
    });
    expect(stepSpy).toHaveBeenCalledTimes(3);

    createRaceSimulation({
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
      seed: 18,
      trackSeed: 2701,
      warmup: { enabled: true, policy: 'config-change', steps: 3 },
    });
    expect(stepSpy).toHaveBeenCalledTimes(6);
  });

  test('environment warmup reruns when reset options change fingerprint', () => {
    const controlledDriver = DEMO_PROJECT_DRIVERS[0].id;
    const env = createPaddockEnvironment({
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 3),
      controlledDrivers: [controlledDriver],
      seed: 71,
      trackSeed: 3101,
      warmup: { enabled: true, policy: 'config-change', steps: 4 },
      sensors: {
        rays: {
          enabled: true,
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
      },
    });
    expect(stepSpy).toHaveBeenCalledTimes(4);

    env.reset();
    expect(stepSpy).toHaveBeenCalledTimes(4);

    env.reset({ seed: 72 });
    expect(stepSpy).toHaveBeenCalledTimes(8);
    env.destroy();
  });
});
