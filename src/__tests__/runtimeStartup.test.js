import { Application, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { PaddockSimulatorController } from '../api/PaddockSimulatorController.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import { runFrameLoopTick } from '../app/runtime/frameLoop.js';
import { configureRuntimeTicker } from '../app/runtime/runtimeTiming.js';
import { RuntimeStartupCancelledError } from '../app/runtime/pixiStartupLifecycle.js';
import * as browserSimulationStartup from '../app/runtime/browserSimulationStartup.js';
import * as startupTasks from '../app/runtime/startupTasks.js';
import * as trackBuilder from '../simulation/track/trackBuilder.js';
import { FIXED_STEP } from '../simulation/raceSimulation.js';

// GPU/startup tests isolate the DOM input component; real wrapper cleanup and
// camera/input behavior are covered by nativeScrollSurface and browser smoke.
vi.mock('../app/controls/SceneScrollController.js', () => ({
  SceneScrollController: class { sync() {} },
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createRoot() {
  const canvasHost = {
    appendChild: vi.fn(),
    clientWidth: 900,
    clientHeight: 640,
    getBoundingClientRect: () => ({ top: 0, bottom: 640, left: 0, right: 900, width: 900, height: 640 }),
  };
  return {
    canvasHost,
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    querySelector: (selector) => selector === '[data-track-canvas]' ? canvasHost : null,
    querySelectorAll: () => [],
  };
}

function createRuntime(callbacks = {}) {
  return new F1SimulatorApp(createRoot(), {
    drivers: [], assets: DEFAULT_F1_SIMULATOR_ASSETS,
    initialCameraMode: 'leader', totalLaps: 1, ui: {}, ...callbacks,
  });
}

const snapshot = { time: 0, cars: [], events: [], track: {}, raceControl: { mode: 'green' }, safetyCar: {} };

describe('browser startup resource lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: vi.fn() });
    vi.stubGlobal('addEventListener', vi.fn());
    vi.stubGlobal('removeEventListener', vi.fn());
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    // GPU lifecycle cases isolate geometry; dedicated phase-cancellation cases
    // below exercise the production preparation/checkpoint path.
    vi.spyOn(browserSimulationStartup, 'prepareBrowserSimulation').mockImplementation(async (app, checkpoint) => {
      await checkpoint(true);
      return app.createRaceSimulation();
    });
    vi.spyOn(F1SimulatorApp.prototype, 'createRaceSimulation').mockReturnValue({ snapshot: () => snapshot });
    for (const method of ['createCars', 'bindControls', 'syncTimingPanelDisclosureState', 'renderTrack', 'renderStartupTrack', 'updateDom', 'renderInitialFrame', 'observeLayoutResize']) {
      vi.spyOn(F1SimulatorApp.prototype, method).mockImplementation(() => {});
    }
    vi.spyOn(F1SimulatorApp.prototype, 'loadAssets').mockResolvedValue({});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function installPixiInit(gate = Promise.resolve(), configureRenderer = () => {}) {
    const renderers = [];
    const applications = [];
    const init = vi.spyOn(Application.prototype, 'init').mockImplementation(async function (options) {
      applications.push(this);
      await gate;
      this.renderer = { canvas: {}, resize: vi.fn(), render: vi.fn(), destroy: vi.fn() };
      renderers.push(this.renderer);
      configureRenderer(this.renderer);
      // Preserve the real Pixi application plugin lifecycle after the GPU boundary.
      Application._plugins.forEach((plugin) => plugin.init.call(this, options));
    });
    return { init, renderers, applications };
  }

  test.each(['track preparation', 'partial track drawing'])('cancellation during %s preserves readiness boundaries and permits a clean retry', async (phase) => {
    const { init, applications, renderers } = installPixiInit();
    F1SimulatorApp.prototype.createRaceSimulation.mockRestore();
    if (phase === 'track preparation') browserSimulationStartup.prepareBrowserSimulation.mockRestore();
    else F1SimulatorApp.prototype.renderStartupTrack.mockRestore();
    const gate = deferred();
    const entered = deferred();
    const builds = phase === 'track preparation' ? vi.spyOn(trackBuilder, 'buildTrackModel') : null;
    const createCheckpoint = startupTasks.createStartupCheckpoint;
    let held = false;
    vi.spyOn(startupTasks, 'createStartupCheckpoint').mockImplementation((app) => {
      const checkpoint = createCheckpoint(app);
      return (force) => {
        const atBoundary = phase === 'track preparation'
          ? builds.mock.calls.length > 0 && app.sim === null
          : app.trackAsset?.container.children.length > 0;
        if (!held && atBoundary) {
          held = true;
          entered.resolve(app);
          return gate.promise.then(() => checkpoint(force));
        }
        return checkpoint(force);
      };
    });
    const onReady = vi.fn();
    const onError = vi.fn();
    const simulator = new PaddockSimulatorController({
      seed: 17, trackSeed: 8910112, warmup: { enabled: false },
      drivers: [{ id: 'alpha', name: 'Alpha' }], onReady, onError,
    });
    simulator.roots.set('race-canvas', createRoot());
    const pending = simulator.start();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    const initializing = await entered.promise;
    try {
      expect(simulator.getSnapshot()).toBeNull();
      expect(simulator.expert).toBeNull();
      expect(simulator.setPitIntent('alpha', 1)).toBe(false);
      expect(() => simulator.restart()).toThrow('Await start() before restarting');
      expect(initializing.runtimeSceneReady).toBe(false);
      expect(initializing.bindControls).not.toHaveBeenCalled();
      expect(initializing.createCars).not.toHaveBeenCalled();
      expect(onReady).not.toHaveBeenCalled();
      let partialChildren = [];
      if (phase === 'track preparation') {
        expect(init).not.toHaveBeenCalled();
        expect(builds).toHaveBeenCalled();
        expect(initializing.sim).toBeNull();
      } else {
        expect(applications[0].ticker.started).toBe(false);
        expect(initializing.worldLayer.renderable).toBe(false);
        partialChildren = [...initializing.trackAsset.container.children];
        expect(partialChildren.length).toBeGreaterThan(0);
      }

      simulator.destroy();
      gate.resolve();
      await rejection;
      expect(initializing.root).toBeNull();
      expect(initializing.sim).toBeNull();
      expect(initializing.worldLayer).toBeNull();
      expect(initializing.trackAsset).toBeNull();
      expect(partialChildren.every((child) => child.destroyed)).toBe(true);
      expect(simulator.app).toBeNull();
      expect(simulator.startPromise).toBeNull();
      expect(simulator.initializingApp).toBeNull();
      expect(onReady).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      if (phase === 'partial track drawing') expect(renderers[0].destroy).toHaveBeenCalledTimes(1);

      simulator.roots.set('race-canvas', createRoot());
      await expect(simulator.start()).resolves.toBe(simulator);
      expect(simulator.getSnapshot().cars.map((car) => car.id)).toEqual(['alpha']);
      expect(simulator.app.runtimeSceneReady).toBe(true);
      expect(simulator.app.worldLayer.renderable).toBe(true);
      expect(simulator.app.app.ticker.started).toBe(true);
      expect(simulator.app.bindControls).toHaveBeenCalledTimes(1);
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      simulator.destroy();
      gate.resolve();
      await pending.catch(() => {});
    }
    expect(renderers.every((renderer) => renderer.destroy.mock.calls.length === 1)).toBe(true);
  });

  test('destroy while GPU init is pending releases eventual resources without mounting or ready/error callbacks', async () => {
    const gate = deferred();
    const { renderers, applications } = installPixiInit(gate.promise);
    const onReady = vi.fn();
    const onError = vi.fn();
    const app = createRuntime({ onReady, onError });
    const host = app.canvasHost;
    const pending = app.init();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    await vi.waitFor(() => expect(applications).toHaveLength(1));

    expect(() => app.destroy()).not.toThrow();
    app.destroy();
    gate.resolve();
    await rejection;

    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(applications[0].stage).toBeNull();
    expect(applications[0].renderer).toBeNull();
    expect(host.appendChild).not.toHaveBeenCalled();
    expect(app.loadAssets).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(app.app).toBeNull();
  });

  test('cancellation as preparation resolves cannot reacquire simulation or GPU resources', async () => {
    const { init, applications } = installPixiInit();
    const onReady = vi.fn();
    const onError = vi.fn();
    const app = createRuntime({ onReady, onError });
    F1SimulatorApp.prototype.createRaceSimulation.mockImplementationOnce(() => {
      queueMicrotask(() => app.destroy());
      return { snapshot: () => snapshot };
    });

    await expect(app.init()).rejects.toBeInstanceOf(RuntimeStartupCancelledError);

    expect(init).not.toHaveBeenCalled();
    expect(applications).toHaveLength(0);
    expect(app.sim).toBeNull();
    expect(app.app).toBeNull();
    expect(app.root).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('destroy during assets leaves textures and rendering references cleared after late resolution', async () => {
    const { renderers } = installPixiInit();
    const assets = deferred();
    F1SimulatorApp.prototype.loadAssets.mockReturnValue(assets.promise);
    const onReady = vi.fn();
    const onError = vi.fn();
    const app = createRuntime({ onReady, onError });
    const pending = app.init();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    await vi.waitFor(() => expect(app.loadAssets).toHaveBeenCalledTimes(1));

    app.destroy();
    assets.resolve({ lateTexture: {} });
    await rejection;

    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(app.textures).toEqual({});
    expect(app.worldLayer).toBeNull();
    expect(app.trackAsset).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test.each([false, true])('failed renderer initialization cleans state with Grid Walk enabled=%s', async (enabled) => {
    const gate = deferred();
    const { applications } = installPixiInit(gate.promise);
    const failure = new Error('GPU discovery failed');
    const onError = vi.fn();
    const app = createRuntime({ onError, gridWalk: { enabled } });
    const pending = app.init();
    const rejection = expect(pending).rejects.toBe(failure);
    await vi.waitFor(() => expect(applications).toHaveLength(1));
    gate.reject(failure);
    await rejection;
    expect(applications[0].stage).toBeNull();
    expect(onError).toHaveBeenCalledWith(failure, { phase: 'init' });
    expect(app.app).toBeNull();
  });

  test.each(['resize', 'render'])('a failure in initial renderer.%s releases the partially installed resize plugin', async (method) => {
    const activeResizeListeners = new Set();
    globalThis.addEventListener.mockImplementation((type, listener) => {
      if (type === 'resize') activeResizeListeners.add(listener);
    });
    globalThis.removeEventListener.mockImplementation((type, listener) => {
      if (type === 'resize') activeResizeListeners.delete(listener);
    });
    const failure = new Error(`initial renderer.${method} failed`);
    const { renderers, applications } = installPixiInit(Promise.resolve(), (renderer) => {
      renderer[method].mockImplementation(() => { throw failure; });
    });
    const onError = vi.fn();
    const app = createRuntime({ onError });
    await expect(app.init()).rejects.toBe(failure);
    const pixi = applications[0];
    expect(globalThis.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(activeResizeListeners.size).toBe(0);
    expect(pixi.resizeTo).toBeNull();
    expect(pixi.queueResize).toBeNull();
    expect(pixi._cancelResize).toBeNull();
    expect(pixi.ticker).toBeUndefined();
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(pixi.stage).toBeNull();
    expect(pixi.renderer).toBeNull();
    expect(app.app).toBeNull();
    expect(app.root).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, { phase: 'init' });
  });

  test('a late Pixi init-hook failure releases both installed ticker and resize plugins', async () => {
    const activeResizeListeners = new Set();
    globalThis.addEventListener.mockImplementation((type, listener) => {
      if (type === 'resize') activeResizeListeners.add(listener);
    });
    globalThis.removeEventListener.mockImplementation((type, listener) => {
      if (type === 'resize') activeResizeListeners.delete(listener);
    });
    const failure = new Error('application init hook failed');
    let tickerDestroy;
    vi.stubGlobal('__PIXI_APP_INIT__', (pixi) => {
      tickerDestroy = vi.spyOn(pixi.ticker, 'destroy');
      throw failure;
    });
    const { renderers, applications } = installPixiInit();
    const onError = vi.fn();
    const app = createRuntime({ onError });
    await expect(app.init()).rejects.toBe(failure);
    const pixi = applications[0];
    expect(tickerDestroy).toHaveBeenCalledTimes(1);
    expect(pixi.ticker).toBeNull();
    expect(activeResizeListeners.size).toBe(0);
    expect(pixi.resizeTo).toBeNull();
    expect(pixi.queueResize).toBeNull();
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(pixi.stage).toBeNull();
    expect(pixi.renderer).toBeNull();
    expect(app.app).toBeNull();
    expect(app.root).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, { phase: 'init' });
  });

  test('a GPU failure after cancellation remains cancellation and releases the pending stage', async () => {
    const gate = deferred();
    const { applications } = installPixiInit(gate.promise);
    const onError = vi.fn();
    const app = createRuntime({ onError });
    const pending = app.init();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    await vi.waitFor(() => expect(applications).toHaveLength(1));
    app.destroy();
    gate.reject(new Error('GPU failure after unmount'));
    await rejection;
    expect(applications[0].stage).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  test('an asset failure after cancellation cannot emit an initialization error', async () => {
    const { renderers } = installPixiInit();
    const assets = deferred();
    F1SimulatorApp.prototype.loadAssets.mockReturnValue(assets.promise);
    const onError = vi.fn();
    const app = createRuntime({ onError });
    const pending = app.init();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    await vi.waitFor(() => expect(app.loadAssets).toHaveBeenCalled());
    app.destroy();
    assets.reject(new Error('asset failure after unmount'));
    await rejection;
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('a failed disposer is reported while independent resources and runtime references are released', async () => {
    const { renderers } = installPixiInit();
    let errorContext;
    const onError = vi.fn(() => { errorContext = [app.root, app.app, app.cameraController]; });
    const app = createRuntime({ onError });
    await app.init();
    const failure = new Error('observer cleanup failed');
    app.layoutSupportCleanup = () => { throw failure; };
    app.destroy();
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(app.root).toBeNull();
    expect(app.app).toBeNull();
    expect(app.cameraController).toBeNull();
    expect(errorContext).toEqual([null, null, null]);
    expect(onError).toHaveBeenCalledWith(failure, { phase: 'destroy' });
  });

  test('cleanup failure does not mask a renderer initialization failure', async () => {
    const gate = deferred();
    const { applications } = installPixiInit(gate.promise);
    const failure = new Error('GPU discovery failed');
    const cleanupFailure = new Error('stage cleanup failed');
    const onError = vi.fn();
    const app = createRuntime({ onError });
    const pending = app.init();
    const rejection = expect(pending).rejects.toBe(failure);
    await vi.waitFor(() => expect(applications).toHaveLength(1));
    vi.spyOn(applications[0].stage, 'destroy').mockImplementation(() => { throw cleanupFailure; });
    gate.reject(failure);
    await rejection;
    expect(applications[0].stage).toBeNull();
    expect(app.app).toBeNull();
    expect(onError).toHaveBeenCalledWith(failure, { phase: 'init' });
    expect(onError).toHaveBeenCalledWith(cleanupFailure, { phase: 'destroy' });
  });

  test('renderer teardown failures are reported once without repeating its disposer', async () => {
    const { renderers } = installPixiInit();
    const onError = vi.fn();
    const app = createRuntime({ onError });
    await app.init();
    const failure = new Error('renderer cleanup failed');
    renderers[0].destroy.mockImplementation(() => { throw failure; });
    app.destroy();
    app.destroy();
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(app.app).toBeNull();
    expect(app.root).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, { phase: 'destroy' });
  });

  test('ready callbacks may destroy the initialized runtime and release its controls and ticker', async () => {
    const { applications, renderers } = installPixiInit();
    let app;
    app = createRuntime({ onReady: () => app.destroy() });
    await expect(app.init()).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(applications[0].ticker).toBeNull();
    expect(app.resizeHandler).toBeNull();
  });

  test('browser restart preserves filtered expert rosters until explicitly replaced', async () => {
    installPixiInit();
    F1SimulatorApp.prototype.createRaceSimulation.mockRestore();
    const simulator = new PaddockSimulatorController({
      seed: 17, trackSeed: 31, warmup: false,
      drivers: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
      expert: { enabled: true, controlledDrivers: ['alpha'] },
    });
    simulator.roots.set('race-canvas', createRoot());
    try {
      await simulator.start();
      simulator.expert.reset({ scenario: { participants: 'controlled-only' } });
      simulator.app.restart();
      expect(simulator.expert.reset({ scenario: { participants: 'all' } }).state.snapshot.cars.map((car) => car.id))
        .toEqual(['alpha', 'beta']);
      simulator.restart({ drivers: [{ id: 'alpha', name: 'Alpha' }] });
      expect(simulator.expert.reset({ scenario: { participants: 'all' } }).state.snapshot.cars.map((car) => car.id))
        .toEqual(['alpha']);
    } finally {
      simulator.destroy();
    }
  });

  test.each([
    [{ trackGeneration: { profile: 'invalid-restart-profile' } }, 'Unsupported procedural track profile: invalid-restart-profile'],
    [{ drivers: [{ id: 'beta', name: 'Beta' }] }, 'controlled driver does not exist: alpha'],
  ])('failed restart %j preserves the active runtime and expert adapter for retry', async (nextOptions, message) => {
    installPixiInit();
    F1SimulatorApp.prototype.createRaceSimulation.mockRestore();
    const simulator = new PaddockSimulatorController({
      seed: 17, trackSeed: 31, warmup: false,
      drivers: [{ id: 'alpha', name: 'Alpha' }],
      expert: { enabled: true, controlledDrivers: ['alpha'] },
    });
    simulator.roots.set('race-canvas', createRoot());
    try {
      await simulator.start();
      const previousOptions = simulator.app.options;
      const previousSimulation = simulator.app.sim;
      const previousExpert = simulator.expert;
      expect(() => simulator.restart(nextOptions)).toThrow(message);
      expect(simulator.app.options).toBe(previousOptions);
      expect(simulator.app.sim).toBe(previousSimulation);
      expect(simulator.expert).toBe(previousExpert);
      expect(simulator.expert.reset().state.snapshot.cars.map((car) => car.id)).toEqual(['alpha']);
      expect(() => simulator.restart()).not.toThrow();
    } finally {
      simulator.destroy();
    }
  });

  test('composable ready callbacks can use the fully initialized runtime API', async () => {
    installPixiInit();
    F1SimulatorApp.prototype.createRaceSimulation.mockRestore();
    const setView = vi.spyOn(F1SimulatorApp.prototype, 'setView').mockReturnValue(true);
    const onError = vi.fn();
    let readyState;
    const simulator = new PaddockSimulatorController({
      seed: 17, trackSeed: 31, warmup: { enabled: false },
      totalLaps: 3, rules: { modules: { pitStops: { enabled: true } } },
      trackGeneration: { pitLane: { enabled: true } },
      drivers: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
      expert: { enabled: true, controlledDrivers: ['beta'] },
      onError,
      onReady: ({ snapshot: readySnapshot }) => {
        readyState = { snapshot: simulator.getSnapshot(), expert: simulator.expert, readySnapshot };
        simulator.selectDriver('beta');
        readyState.selectedId = simulator.app?.selectedId;
        readyState.pitApplied = simulator.setPitIntent('beta', 1);
        readyState.pitIntent = simulator.getPitIntent('beta');
        readyState.viewApplied = simulator.setView('race');
        readyState.expertSnapshot = simulator.expert?.getState().snapshot;
      },
    });
    simulator.roots.set('race-canvas', createRoot());
    try {
      await simulator.start();
      expect(readyState.snapshot?.cars.map((car) => car.id)).toEqual(['alpha', 'beta']);
      expect(readyState.expert).toBe(simulator.expert);
      expect(readyState.expertSnapshot?.cars).toHaveLength(2);
      expect(readyState.selectedId).toBe('beta');
      expect(readyState.pitApplied).toBe(true);
      expect(readyState.pitIntent).toBe(1);
      expect(readyState.viewApplied).toBe(true);
      expect(setView).toHaveBeenCalledWith('race');
      expect(onError).not.toHaveBeenCalled();
    } finally {
      simulator.destroy();
    }
  });

  test.each(['onReady', 'onLoadingChange'])('composable %s may destroy without publishing a destroyed runtime', async (callback) => {
    const { renderers } = installPixiInit();
    const onReady = vi.fn();
    const simulator = new PaddockSimulatorController({
      drivers: [{ id: 'alpha', name: 'Alpha' }],
      onReady,
      [callback]: (payload) => {
        if (callback === 'onLoadingChange' && payload.phase !== 'ready') return;
        simulator.destroy();
      },
    });
    simulator.roots.set('race-canvas', createRoot());
    await expect(simulator.start()).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    expect(simulator.app).toBeNull();
    expect(simulator.initializingApp).toBeNull();
    expect(simulator.startPromise).toBeNull();
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  test.each(['onReady', 'onLoadingChange'])('composable %s may restart without stale startup state or ready data', async (callback) => {
    installPixiInit();
    F1SimulatorApp.prototype.createRaceSimulation.mockRestore();
    const onError = vi.fn();
    let readySnapshot;
    const simulator = new PaddockSimulatorController({
      seed: 17, trackSeed: 31, warmup: { enabled: false },
      drivers: [{ id: 'alpha', name: 'Alpha' }], totalLaps: 1,
      onError,
      onReady: ({ snapshot: value }) => { readySnapshot = value; },
      [callback]: (payload) => {
        if (callback === 'onLoadingChange' && payload.phase !== 'ready') return;
        simulator.restart({ totalLaps: 3 });
        if (callback === 'onReady') readySnapshot = payload.snapshot;
      },
    });
    simulator.roots.set('race-canvas', createRoot());
    try {
      await simulator.start();
      expect(onError).not.toHaveBeenCalled();
      expect(simulator.getSnapshot().totalLaps).toBe(3);
      expect(readySnapshot.totalLaps).toBe(callback === 'onReady' ? 1 : 3);
      expect(simulator.app.app.ticker.started).toBe(true);
      expect(simulator.app.resizeHandler).toBeTypeOf('function');
    } finally {
      simulator.destroy();
    }
  });

  test('an initializing loading callback shares the pending start and cannot use runtime methods', async () => {
    const gate = deferred();
    const { init } = installPixiInit(gate.promise);
    let nestedStart;
    let earlyState;
    let calls = 0;
    const simulator = new PaddockSimulatorController({
      drivers: [{ id: 'alpha', name: 'Alpha' }],
      onLoadingChange: ({ phase }) => {
        if (phase !== 'initializing' || calls++ > 0) return;
        nestedStart = simulator.start();
        earlyState = { snapshot: simulator.getSnapshot(), expert: simulator.expert,
          pitApplied: simulator.setPitIntent('alpha', 1), viewApplied: simulator.setView('race') };
        try { simulator.restart(); } catch (error) { earlyState.restartError = error.message; }
      },
    });
    simulator.roots.set('race-canvas', createRoot());
    const pending = simulator.start();
    try {
      await vi.waitFor(() => expect(init).toHaveBeenCalled());
      expect(init).toHaveBeenCalledTimes(1);
      expect(earlyState).toEqual({ snapshot: null, expert: null, pitApplied: false, viewApplied: false,
        restartError: expect.stringContaining('Await start() before restarting') });
      gate.resolve();
      await expect(pending).resolves.toBe(simulator);
      await expect(nestedStart).resolves.toBe(simulator);
    } finally {
      gate.resolve();
      await Promise.allSettled([pending, nestedStart]);
      simulator.destroy();
    }
  });

  test.each(['destroy', 'restart'])('restart stops stale rendering when a snapshot callback calls %s', async (action) => {
    installPixiInit();
    F1SimulatorApp.prototype.createRaceSimulation.mockRestore();
    F1SimulatorApp.prototype.updateDom.mockRestore();
    const createSimulation = F1SimulatorApp.prototype.createRaceSimulation;
    let generation = 0;
    vi.spyOn(F1SimulatorApp.prototype, 'createRaceSimulation').mockImplementation(function (...args) {
      const simulation = createSimulation.apply(this, args);
      if (++generation === 2) simulation.events.push({ type: 'restart-boundary', at: 0 });
      return simulation;
    });
    const onError = vi.fn();
    const onRaceEvent = vi.fn((event) => {
      if (event.type === 'restart-boundary') simulator[action]();
    });
    const simulator = new PaddockSimulatorController({
      seed: 17, trackSeed: 31, warmup: { enabled: false },
      drivers: [{ id: 'alpha', name: 'Alpha' }], onRaceEvent, onError,
    });
    simulator.roots.set('race-canvas', createRoot());
    try {
      await simulator.start();
      F1SimulatorApp.prototype.renderInitialFrame.mockClear();
      expect(() => simulator.restart()).not.toThrow();
      expect(onRaceEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'restart-boundary' }), expect.any(Object));
      expect(onError).not.toHaveBeenCalled();
      expect(F1SimulatorApp.prototype.renderInitialFrame).toHaveBeenCalledTimes(action === 'destroy' ? 0 : 1);
      expect(simulator.app === null).toBe(action === 'destroy');
    } finally {
      simulator.destroy();
    }
  });

  test('composable cancellation settles before a new start can initialize normally', async () => {
    const gate = deferred();
    const { init, renderers } = installPixiInit(gate.promise);
    const simulator = new PaddockSimulatorController({ drivers: [{ id: 'alpha', name: 'Alpha', color: '#ff2d55' }] });
    simulator.roots.set('race-canvas', createRoot());
    const pending = simulator.start();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    simulator.destroy();
    expect(() => simulator.restart()).toThrow('Await start() before restarting');
    gate.resolve();
    await rejection;
    expect(simulator.startPromise).toBeNull();
    expect(simulator.initializingApp).toBeNull();
    expect(simulator.app).toBeNull();
    simulator.roots.set('race-canvas', createRoot());
    await simulator.start();
    expect(init).toHaveBeenCalledTimes(2);
    expect(simulator.app.app.ticker.maxFPS).toBe(60);
    simulator.destroy();
    expect(renderers.every((renderer) => renderer.destroy.mock.calls.length === 1)).toBe(true);
  });

  test('Pixi stays stopped during loading and starts only after the configured render cap', async () => {
    const { init, applications } = installPixiInit();
    const assets = deferred();
    F1SimulatorApp.prototype.loadAssets.mockReturnValue(assets.promise);
    const app = createRuntime();
    const pending = app.init();
    await vi.waitFor(() => expect(app.loadAssets).toHaveBeenCalled());
    expect(init.mock.calls[0][0].autoStart).toBe(false);
    expect(applications[0].ticker.started).toBe(false);
    expect(applications[0].ticker.maxFPS).toBe(60);
    assets.resolve({});
    await pending;
    expect(app.app.ticker.started).toBe(true);
    app.destroy();
  });
});

describe('render ticker pacing', () => {
  afterEach(() => vi.restoreAllMocks());
  test.each([30, 60, 120, 144])('caps actual draw callbacks on a %i Hz display while preserving fixed-step realtime playback', (refreshRate) => {
    const ticker = new Ticker();
    configureRuntimeTicker(ticker);
    let now = 0;
    let simulationSeconds = 0;
    const draw = vi.fn();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const app = {
      expertMode: false, lastTime: 0, lastDomUpdateTime: 0,
      accumulator: 0, simulationSpeed: 1, sampleFps() {},
      sim: { events: [], step(dt) { simulationSeconds += dt; }, snapshot: () => snapshot, snapshotRenderInto: () => snapshot },
      emitSnapshotLifecycle() {}, applyCamera() {}, renderDrsTrails() {}, renderPitLaneStatus() {}, renderCars() {}, updateDom() {},
    };
    ticker.add(() => runFrameLoopTick(app));
    ticker.add(draw, undefined, UPDATE_PRIORITY.LOW);
    for (let frame = 1; frame <= refreshRate * 2; frame += 1) {
      now = frame * 1000 / refreshRate;
      ticker.update(now);
    }
    const expectedMaximumDraws = Math.min(refreshRate, 60) * 2;
    expect(draw.mock.calls.length).toBeLessThanOrEqual(expectedMaximumDraws);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(expectedMaximumDraws - 2);
    expect(Math.abs(simulationSeconds - 2)).toBeLessThanOrEqual(FIXED_STEP * 2);
    ticker.destroy();
  });
});
