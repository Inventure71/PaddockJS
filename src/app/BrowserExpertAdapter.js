import { createEnvironmentRuntime } from '../environment/runtime.js';
import { resolveEnvironmentOptions } from '../environment/options.js';

export function createBrowserExpertAdapter(app, expertOptions = {}) {
  let resolvedOptions = resolveEnvironmentOptions({
    ...app.options,
    ...expertOptions,
    controlledDrivers: expertOptions.controlledDrivers,
  });

  return createEnvironmentRuntime({
    getSimulation: () => app.sim,
    setSimulation(nextSim) {
      app.sim = nextSim;
    },
    createSimulation(nextOptions) {
      app.applyExpertOptions(nextOptions);
      return app.createRaceSimulation(nextOptions);
    },
    getOptions: () => resolvedOptions,
    setOptions(nextOptions) {
      resolvedOptions = nextOptions;
    },
    afterReset(result) {
      app.renderTrack();
      app.renderExpertFrame(result.state.snapshot, { observation: result.observation });
    },
    afterStep(result) {
      app.renderExpertFrame(result.state.snapshot, { observation: result.observation });
    },
  });
}
