import { ResizePlugin, TickerPlugin } from 'pixi.js';

export class RuntimeStartupCancelledError extends Error {
  constructor() {
    super('PaddockJS initialization was cancelled before completion.');
    this.name = 'RuntimeStartupCancelledError';
  }
}

export function assertRuntimeStartupActive(app) {
  if (app.destroyed) throw new RuntimeStartupCancelledError();
}

function releaseInitializedPixiPlugins(application, onCleanupError) {
  // Runtime init owns Pixi's private ticker and resize target. Init can fail
  // between these plugins, so calling Application.destroy() is unsafe here.
  if (application.ticker) {
    try {
      TickerPlugin.destroy.call(application);
    } catch (error) {
      onCleanupError(error);
    }
  }
  if (typeof application._cancelResize === 'function') {
    try {
      ResizePlugin.destroy.call(application);
    } catch (error) {
      onCleanupError(error);
    }
  }
}

// Pixi's application plugins cannot be destroyed until their async init has settled.
export function createPixiStartupLifecycle(application, onCleanupError = () => {}) {
  let initializing = false;
  let initialized = false;
  let releaseRequested = false;
  let released = false;

  function release() {
    if (initializing || released) return;
    released = true;
    let rendererCleanupNeeded = true;
    if (initialized) {
      try {
        application.destroy(true, { children: true, texture: false });
        return;
      } catch (error) {
        // Pixi clears stage immediately before calling renderer.destroy().
        // A renderer failure must be reported without invoking that disposer twice.
        rendererCleanupNeeded = application.stage != null;
        onCleanupError(error);
      }
    }
    // Renderer discovery or an application plugin can fail before all plugins
    // are installed. Release only the instance-owned plugins that reached init.
    releaseInitializedPixiPlugins(application, onCleanupError);
    try {
      if (!application.stage?.destroyed) application.stage?.destroy?.({ children: true, texture: false });
    } catch (error) {
      onCleanupError(error);
    } finally {
      application.stage = null;
      try {
        if (rendererCleanupNeeded) application.renderer?.destroy?.(true);
      } catch (error) {
        onCleanupError(error);
      } finally {
        application.renderer = null;
      }
    }
  }

  return {
    async initialize(options) {
      initializing = true;
      try {
        await application.init(options);
        initialized = true;
        // Pixi defaults to owning touch gestures. Let the host page scroll;
        // Grid Walk opts into dragging through its own scoped touch-action CSS.
        if (application.renderer.events) application.renderer.events.autoPreventDefault = false;
        application.canvas.style?.removeProperty('touch-action');
      } finally {
        initializing = false;
        if (releaseRequested) release();
      }
    },
    destroy() {
      releaseRequested = true;
      release();
    },
  };
}
