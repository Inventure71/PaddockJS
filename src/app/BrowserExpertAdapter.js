import { createEnvironmentRuntime } from '../environment/runtime.js';
import { resolveEnvironmentOptions } from '../environment/options.js';

export function createBrowserExpertAdapter(app, expertOptions = {}) {
  let resolvedOptions = resolveEnvironmentOptions({
    ...app.options,
    ...expertOptions,
    controlledDrivers: expertOptions.controlledDrivers,
  });
  let frameRenderSuppressed = false;
  let externalRendererUnsubscribe = null;
  let externalRendererAttached = false;
  let externalRendererLastMeta = null;
  let externalRendererLastFrameAt = null;
  let externalRendererLastError = null;

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
      resolvedOptions = nextOptions;
    },
    afterReset(result) {
      app.renderTrack();
      app.renderExpertFrame(result.state.snapshot, {
        forceDomUpdate: true,
        observation: result.observation,
      });
    },
    afterStep(result) {
      if (frameRenderSuppressed) return;
      app.renderExpertFrame(result.state.snapshot, { observation: result.observation });
    },
  });

  function assertExternalRendererDetached(method) {
    if (!externalRendererAttached) return;
    throw new Error(`Browser expert ${method}() is disabled while external renderer mode is attached.`);
  }

  function detachExternalRenderer() {
    if (typeof externalRendererUnsubscribe === 'function') {
      try {
        externalRendererUnsubscribe();
      } catch (error) {
        externalRendererLastError = error instanceof Error ? error.message : String(error);
      }
    }
    externalRendererUnsubscribe = null;
    externalRendererAttached = false;
  }

  function attachExternalRenderer(source) {
    if (!source || typeof source.subscribe !== 'function') {
      throw new Error('attachExternalRenderer(source) requires a source with subscribe(onFrame).');
    }
    detachExternalRenderer();
    externalRendererLastError = null;
    const unsubscribe = source.subscribe((frame) => {
      if (!frame || typeof frame !== 'object') {
        externalRendererLastError = 'Invalid external frame payload.';
        return;
      }
      const snapshot = frame.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        externalRendererLastError = 'External frame is missing snapshot.';
        return;
      }
      try {
        app.renderExpertFrame(snapshot, {
          forceDomUpdate: true,
          observation: frame.observation && typeof frame.observation === 'object'
            ? frame.observation
            : {},
        });
        externalRendererLastMeta = frame.meta ?? null;
        externalRendererLastFrameAt = Date.now();
        externalRendererLastError = null;
      } catch (error) {
        externalRendererLastError = error instanceof Error ? error.message : String(error);
      }
    });
    if (typeof unsubscribe !== 'function') {
      throw new Error('attachExternalRenderer(source) subscribe(onFrame) must return an unsubscribe function.');
    }
    externalRendererUnsubscribe = unsubscribe;
    externalRendererAttached = true;
  }

  function getExternalRendererState() {
    return {
      attached: externalRendererAttached,
      lastMeta: externalRendererLastMeta,
      lastFrameAt: externalRendererLastFrameAt,
      lastError: externalRendererLastError,
    };
  }

  return {
    ...runtime,
    reset(options = {}) {
      assertExternalRendererDetached('reset');
      return runtime.reset(options);
    },
    step(actions = {}) {
      assertExternalRendererDetached('step');
      return runtime.step(actions);
    },
    resetDrivers(placements = {}, resultOptions = {}) {
      assertExternalRendererDetached('resetDrivers');
      return runtime.resetDrivers(placements, resultOptions);
    },
    destroy() {
      detachExternalRenderer();
      runtime.destroy();
    },
    setFrameRenderSuppressed(suppressed) {
      frameRenderSuppressed = Boolean(suppressed);
    },
    attachExternalRenderer,
    detachExternalRenderer,
    getExternalRendererState,
  };
}
