import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { disableWarmupOptions, runWarmupWithGuard } from '../simulation/warmup/runtimeWarmup.js';
import { applyControlledRunoffResponse, initializeControlledPitIntentForSimulation } from './driverReset.js';
import { buildEnvironmentObservation } from './observations.js';
import { applyEnvironmentScenario } from './scenarios.js';

export function createSimulationWithEnvironmentScenario(options) {
  runWarmupWithGuard({
    options,
    surface: 'environment',
    execute: ({ warmup }) => {
      const warmupSimulation = createRaceSimulation(disableWarmupOptions(options, warmup.surface));
      initializeControlledPitIntentForSimulation(warmupSimulation, options);
      applyEnvironmentScenario(warmupSimulation, options);
      applyControlledRunoffResponse(warmupSimulation, options);
      for (let index = 0; index < warmup.steps; index += 1) warmupSimulation.step(FIXED_STEP);
      const warmupSnapshot = warmupSimulation.snapshotObservation?.() ?? warmupSimulation.snapshot();
      buildEnvironmentObservation({
        snapshot: warmupSnapshot,
        options,
        events: [],
      });
    },
  });
  const sim = createRaceSimulation(disableWarmupOptions(options, 'environment'));
  initializeControlledPitIntentForSimulation(sim, options);
  applyEnvironmentScenario(sim, options);
  applyControlledRunoffResponse(sim, options);
  return sim;
}
