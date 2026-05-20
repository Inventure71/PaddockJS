import { createEnvironmentRuntime } from '../environment/runtime.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createBrowserExpertExternalRendererBridge } from './BrowserExpertExternalRenderer.js';

export function createBrowserExpertAdapter(app, expertOptions = {}) {
  let resolvedOptions = resolveBrowserExpertOptions(app.options, expertOptions);
  let frameRenderSuppressed = false;
  const externalRenderer = createBrowserExpertExternalRendererBridge(app);

  function resolveBrowserExpertOptions(appOptions, nextExpertOptions = {}) {
    const options = resolveEnvironmentOptions({
      ...appOptions,
      ...nextExpertOptions,
      controlledDrivers: nextExpertOptions.controlledDrivers,
    });
    if (options.result.stateOutput !== 'none') return options;
    return {
      ...options,
      result: {
        ...options.result,
        stateOutput: 'minimal',
      },
    };
  }

  function renderableSnapshot(result) {
    return result?.state?.snapshot ?? app.sim?.snapshotObservation?.() ?? app.sim?.snapshot?.() ?? null;
  }

  /*
   * Browser expert mode is a visual adapter. Compact headless options may ask for
   * no state payload, but the canvas still needs a snapshot to render.
   */
  function renderExpertResult(result, renderOptions = {}) {
    const snapshot = renderableSnapshot(result);
    if (!snapshot) return;
    app.renderExpertFrame(snapshot, {
      ...renderOptions,
      observation: result?.observation,
    });
  }

  function initialResolvedOptions() {
    return resolveBrowserExpertOptions(app.options, expertOptions);
  }

  resolvedOptions = initialResolvedOptions();

  const runtime = createEnvironmentRuntime({
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
      resolvedOptions = nextOptions.result?.stateOutput === 'none'
        ? { ...nextOptions, result: { ...nextOptions.result, stateOutput: 'minimal' } }
        : nextOptions;
    },
    afterReset(result) {
      app.renderTrack();
      renderExpertResult(result, { forceDomUpdate: true });
    },
    afterStep(result) {
      if (frameRenderSuppressed) return;
      renderExpertResult(result);
    },
  });

  return {
    ...runtime,
    reset(options = {}) {
      externalRenderer.assertDetached('reset');
      return runtime.reset(options);
    },
    step(actions = {}) {
      externalRenderer.assertDetached('step');
      return runtime.step(actions);
    },
    resetDrivers(placements = {}, resultOptions = {}) {
      externalRenderer.assertDetached('resetDrivers');
      return runtime.resetDrivers(placements, resultOptions);
    },
    destroy() {
      externalRenderer.detach();
      runtime.destroy();
    },
    setFrameRenderSuppressed(suppressed) {
      frameRenderSuppressed = Boolean(suppressed);
    },
    attachExternalRenderer: externalRenderer.attach,
    detachExternalRenderer: externalRenderer.detach,
    getExternalRendererState: externalRenderer.getState,
  };
}
