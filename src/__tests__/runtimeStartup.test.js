import { Application, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { PaddockSimulatorController } from '../api/PaddockSimulatorController.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import { runFrameLoopTick } from '../app/runtime/frameLoop.js';
import { configureRuntimeTicker } from '../app/runtime/runtimeTiming.js';
import { RuntimeStartupCancelledError } from '../app/runtime/pixiStartupLifecycle.js';
import { FIXED_STEP } from '../simulation/raceSimulation.js';

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
    vi.spyOn(F1SimulatorApp.prototype, 'createRaceSimulation').mockReturnValue({ snapshot: () => snapshot });
    for (const method of ['createCars', 'bindControls', 'syncTimingPanelDisclosureState', 'renderTrack', 'updateDom', 'renderInitialFrame', 'observeLayoutResize']) {
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

  test('destroy while GPU init is pending releases eventual resources without mounting or ready/error callbacks', async () => {
    const gate = deferred();
    const { renderers, applications } = installPixiInit(gate.promise);
    const onReady = vi.fn();
    const onError = vi.fn();
    const app = createRuntime({ onReady, onError });
    const host = app.canvasHost;
    const pending = app.init();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);

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

  test('ready callbacks may destroy the runtime without later installing controls or a ticker', async () => {
    const { applications, renderers } = installPixiInit();
    let app;
    app = createRuntime({ onReady: () => app.destroy() });
    await expect(app.init()).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
    expect(applications[0].ticker).toBeNull();
    expect(app.resizeHandler).toBeNull();
  });

  test('composable cancellation settles before a new start can initialize normally', async () => {
    const gate = deferred();
    const { init, renderers } = installPixiInit(gate.promise);
    const simulator = new PaddockSimulatorController({ drivers: [{ id: 'alpha', name: 'Alpha', color: '#ff2d55' }] });
    simulator.roots.set('race-canvas', createRoot());
    const pending = simulator.start();
    const rejection = expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    simulator.destroy();
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
