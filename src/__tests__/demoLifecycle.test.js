import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const packageMocks = vi.hoisted(() => ({
  mount: vi.fn(), create: vi.fn(), loop: vi.fn(), environment: vi.fn(),
}));
vi.mock('@inventure71/paddockjs', () => ({
  mountF1Simulator: packageMocks.mount,
  createPaddockSimulator: packageMocks.create,
  createPaddockDriverControllerLoop: packageMocks.loop,
  ...Object.fromEntries([
    'mountCameraControls', 'mountCarDriverOverview', 'mountRaceCanvas', 'mountRaceControls',
    'mountRaceDataPanel', 'mountRaceTelemetryDrawer', 'mountSafetyCarControl', 'mountTelemetryCore',
    'mountTelemetryLapTimes', 'mountTelemetryPanel', 'mountTelemetrySectorBanner',
    'mountTelemetrySectorTimes', 'mountTelemetrySectors', 'mountTimingTower',
  ].map((name) => [name, vi.fn()])),
}));
vi.mock('@inventure71/paddockjs/environment', () => ({
  DEFAULT_EVALUATION_CASES: [], ENVIRONMENT_SCENARIO_PRESETS: [],
  createPaddockEnvironment: packageMocks.environment,
  createProgressReward: () => () => 0,
  createRolloutRecorder: () => ({ recordStep: vi.fn() }),
  createEnvironmentWorkerProtocol: () => ({}),
  createRolloutTransition: () => ({}), runEnvironmentEvaluation: vi.fn(),
}));
vi.mock('../../demo/src/data/demoOptions.js', () => ({
  createDemoOptions: (options) => options,
  DEMO_DRIVERS: [{ id: 'alpha' }],
  DEMO_ENTRIES: [{ driverId: 'alpha' }],
}));

import { createPresetShowcase } from '../../demo/src/runtime/presetShowcase.js';
import { installHeadlessLab } from '../../demo/src/runtime/headlessLab.js';
import { mountMainShowcase } from '../../demo/src/runtime/mainShowcase.js';
import { installExpertLab } from '../../demo/src/runtime/expertLab.js';
import { installControlDeck } from '../../demo/src/runtime/controlDeck.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

function element(dataset = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    dataset, textContent: '', disabled: false,
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    focus: vi.fn(),
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    click: () => listeners.get('click')?.(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', {
    location: { href: 'https://demo.example/' }, history: { replaceState: vi.fn() },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1), clearInterval: vi.fn(),
  });
  vi.stubGlobal('document', { getElementById: () => element(), querySelectorAll: () => [] });
});
afterEach(() => vi.unstubAllGlobals());

describe('demo runtime ownership', () => {
  test.each(['pre-start', 'red-flag'])('control deck preserves actual state when %s rejects safety-car deployment', (mode) => {
    const sim = createRaceSimulation({
      seed: 171, trackSeed: 7301, warmup: false,
      drivers: [{ id: 'alpha', name: 'Alpha', code: 'ALP', color: '#ff2d55', pace: 1, racecraft: 0.8 }],
      rules: { standingStart: mode === 'pre-start' },
    });
    if (mode === 'red-flag') sim.setRedFlag(true);
    const controller = {
      getSnapshot: () => sim.snapshot(),
      getTheme: () => ({ activeMode: 'dark' }),
      setSafetyCarDeployed: vi.fn((deployed) => sim.setSafetyCar(deployed)),
    };
    const button = element({ raceAction: 'safety-car' });
    const cleanup = installControlDeck({ controller, primaryDriverId: 'alpha', readout: element(), buttons: [button] });

    button.click();

    expect(controller.setSafetyCarDeployed).toHaveBeenCalledWith(true);
    expect(sim.snapshot().raceControl.mode).toBe(mode);
    expect(sim.snapshot().safetyCar.deployed).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    cleanup();
  });

  test('serializes preset mounts and skips superseded queued requests on the same root', async () => {
    const pending = deferred();
    let active = false;
    let collisions = 0;
    packageMocks.mount.mockImplementation(async (_root, options) => {
      if (active) { collisions += 1; throw new Error('active simulator root'); }
      active = true;
      const controller = { destroy: vi.fn(() => { active = false; }) };
      if (options.preset === 'timing-overlay') await pending.promise;
      return controller;
    });
    const buttons = ['dashboard', 'full-dashboard'].map((preset) => element({ preset }));
    const status = element();
    const showcase = createPresetShowcase({ root: element(), status, buttons });
    const initial = showcase.mountInitial();
    await Promise.resolve();
    const middle = buttons[0].click();
    const latest = buttons[1].click();
    pending.resolve();
    await Promise.all([initial, middle, latest]);

    expect(collisions).toBe(0);
    expect(packageMocks.mount.mock.calls.map(([, options]) => options.preset))
      .toEqual(['timing-overlay', 'full-dashboard']);
    expect(status.textContent).toBe('full dashboard ready');
    showcase.destroy();
    await buttons[0].click();
    expect(active).toBe(false);
    expect(packageMocks.mount).toHaveBeenCalledTimes(2);
  });

  test('destroys a headless environment when stepping fails and reenables the run button', async () => {
    const env = { reset: () => ({}), step: () => { throw new Error('step failed'); }, destroy: vi.fn() };
    packageMocks.environment.mockReturnValue(env);
    const button = element();
    const status = element();
    installHeadlessLab({ button, status, metrics: element(), output: element() });
    await button.click();
    expect(packageMocks.environment.mock.calls[0][0].physicsMode).toBe('arcade');
    expect(status.textContent).toBe('Headless lab failed: step failed');
    expect(env.destroy).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
  });

  test('releases an outstanding preset mount after disposal and ignores later selections', async () => {
    const pending = deferred();
    const controller = { destroy: vi.fn() };
    packageMocks.mount.mockReturnValue(pending.promise);
    const button = element({ preset: 'dashboard' });
    const showcase = createPresetShowcase({ root: element(), status: element(), buttons: [button] });
    const initial = showcase.mountInitial();
    await Promise.resolve();
    showcase.destroy();
    pending.resolve(controller);
    await initial;
    expect(controller.destroy).toHaveBeenCalledOnce();
    await button.click();
    expect(packageMocks.mount).toHaveBeenCalledOnce();
  });

  test('destroys both allocated showcase controllers when hero initialization fails', async () => {
    const hero = { start: vi.fn().mockRejectedValue(new Error('hero failed')), destroy: vi.fn() };
    const components = { destroy: vi.fn() };
    packageMocks.create.mockReturnValueOnce(hero).mockReturnValueOnce(components);
    await expect(mountMainShowcase({ onEvent: vi.fn() })).rejects.toThrow('hero failed');
    expect(hero.destroy).toHaveBeenCalledOnce();
    expect(components.destroy).toHaveBeenCalledOnce();
  });

  test('releases the expert runtime after controller-loop initialization fails', async () => {
    const mounted = { expert: {}, destroy: vi.fn() };
    packageMocks.mount.mockResolvedValue(mounted);
    packageMocks.loop.mockImplementation(() => { throw new Error('loop failed'); });
    const button = element();
    const status = element();
    const cleanup = installExpertLab({ button, status, workspace: element(), root: element() });
    await button.click();
    expect(packageMocks.mount.mock.calls[0][1].physicsMode).toBe('advanced');
    expect(status.textContent).toBe('Expert mode failed: loop failed');
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
    const nextMounted = { expert: {}, destroy: vi.fn() };
    const nextLoop = { start: vi.fn(), stop: vi.fn() };
    packageMocks.mount.mockResolvedValue(nextMounted);
    packageMocks.loop.mockReturnValue(nextLoop);
    await button.click();
    expect(nextLoop.start).toHaveBeenCalledOnce();
    expect(packageMocks.loop.mock.lastCall[0].scheduler).toBeTypeOf('function');
    expect(status.textContent).toBe('Expert mode ready · focus the race and drive');
    cleanup();
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(nextMounted.destroy).toHaveBeenCalledOnce();
    expect(nextLoop.stop).toHaveBeenCalledOnce();
  });

  test('disposal during expert mounting prevents a late mount from starting a loop', async () => {
    const pending = deferred();
    const mounted = { expert: {}, destroy: vi.fn() };
    packageMocks.mount.mockReturnValue(pending.promise);
    packageMocks.loop.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
    const button = element();
    const cleanup = installExpertLab({ button, status: element(), workspace: element(), root: element() });
    const launch = button.click();
    cleanup();
    pending.resolve(mounted);
    await launch;
    expect(mounted.destroy).toHaveBeenCalledOnce();
    expect(packageMocks.loop).not.toHaveBeenCalled();
    await button.click();
    expect(packageMocks.mount).toHaveBeenCalledOnce();
  });

  test('control deck reflects public state changes and toggles from current runtime values', () => {
    const snapshot = { totalLaps: 3, cars: [{ lap: 2, name: 'Alpha' }], raceControl: { mode: 'safety-car', redFlag: false, pitLaneOpen: false } };
    let theme = { activeMode: 'light' };
    const controller = {
      getSnapshot: () => snapshot, getTheme: () => theme,
      getTimingGapMode: () => 'leader', getPitIntent: () => 0, getPitTargetCompound: () => null,
      setSafetyCarDeployed: vi.fn((deployed) => { snapshot.raceControl.mode = deployed ? 'safety-car' : 'green'; }),
      setRedFlagDeployed: vi.fn(), setPitLaneOpen: vi.fn(),
      setThemeMode: vi.fn((mode) => { theme = { activeMode: mode }; }),
    };
    const buttons = ['safety-car', 'red-flag', 'pit-lane', 'timing-gap', 'pit-stop', 'theme'].map((raceAction) => element({ raceAction }));
    const readout = element();
    const cleanup = installControlDeck({ controller, primaryDriverId: 'alpha', readout, buttons });
    expect(readout.textContent).toBe('Lap 2/3 · safety-car · Alpha leads');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[2].textContent).toBe('Pit lane closed');
    expect(buttons[5].textContent).toBe('Theme: light');
    buttons[0].click();
    expect(controller.setSafetyCarDeployed).toHaveBeenCalledWith(false);
    buttons[5].click();
    expect(controller.setThemeMode).toHaveBeenCalledWith('dark');
    snapshot.raceControl.mode = 'red-flag';
    snapshot.raceControl.redFlag = true;
    const refresh = window.setInterval.mock.calls[0][0];
    refresh();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    cleanup();
    expect(window.clearInterval).toHaveBeenCalledWith(1);
    buttons[0].click();
    expect(controller.setSafetyCarDeployed).toHaveBeenCalledOnce();
  });
});
