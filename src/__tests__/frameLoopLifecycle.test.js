import { afterEach, describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import { FIXED_STEP } from '../simulation/raceSimulation.js';

function frameRuntime(callbacks, { events = [], finished = false, cars = [] } = {}) {
  const root = { style: { setProperty() {} }, querySelector() { return null; }, querySelectorAll() { return []; } };
  const app = new F1SimulatorApp(root, {
    drivers: [], assets: DEFAULT_F1_SIMULATOR_ASSETS,
    initialCameraMode: 'leader', totalLaps: 1, ui: {}, ...callbacks,
  });
  const snapshot = {
    time: FIXED_STEP, cars, events, track: { drsZones: [] },
    raceControl: { mode: 'green', finished, classification: [] }, safetyCar: { deployed: false },
  };
  const simulation = { step: vi.fn(), events, snapshot: vi.fn(() => snapshot) };
  app.sim = simulation;
  app.lastTime = 1000 - FIXED_STEP * 1000;
  app.lastDomUpdateTime = 0;
  for (const method of ['applyCamera', 'renderDrsTrails', 'renderPitLaneStatus', 'renderCars', 'updateDom']) {
    vi.spyOn(app, method).mockImplementation(() => {});
  }
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  return { app, simulation };
}

afterEach(() => vi.restoreAllMocks());

describe('frame loop host lifecycle reentrancy', () => {
  test.each(['event', 'finish'])('host destruction from a race %s callback prevents further rendering', (callback) => {
    let app;
    const onRaceFinish = vi.fn(() => { if (callback === 'finish') app.destroy(); });
    const fixture = frameRuntime({
      onRaceEvent: () => { if (callback === 'event') app.destroy(); }, onRaceFinish,
    }, { events: [{ type: 'contact', at: FIXED_STEP, carId: 'alpha' }], finished: true });
    app = fixture.app;

    expect(() => app.tick()).not.toThrow();
    expect(app.destroyed).toBe(true);
    expect(fixture.simulation.step).toHaveBeenCalledTimes(1);
    expect(app.renderCars).not.toHaveBeenCalled();
    expect(app.applyCamera).not.toHaveBeenCalled();
    expect(app.updateDom).not.toHaveBeenCalled();
    expect(onRaceFinish).toHaveBeenCalledTimes(callback === 'finish' ? 1 : 0);
    expect(() => app.tick()).not.toThrow();
    expect(fixture.simulation.step).toHaveBeenCalledTimes(1);
  });

  test.each(['event', 'finish'])('a replacement race created during a %s callback is not rendered from the prior snapshot', (callback) => {
    let app;
    const replacement = { step: vi.fn() };
    const onRaceFinish = vi.fn(() => { if (callback === 'finish') app.sim = replacement; });
    const fixture = frameRuntime({
      onRaceEvent: () => { if (callback === 'event') app.sim = replacement; }, onRaceFinish,
    }, { events: [{ type: 'contact', at: FIXED_STEP, carId: 'alpha' }], finished: true });
    app = fixture.app;

    app.tick();
    expect(app.sim).toBe(replacement);
    expect(replacement.step).not.toHaveBeenCalled();
    expect(app.renderCars).not.toHaveBeenCalled();
    expect(app.updateDom).not.toHaveBeenCalled();
    expect(onRaceFinish).toHaveBeenCalledTimes(callback === 'finish' ? 1 : 0);
    app.destroy();
  });

  test('an unchanged runtime still renders and refreshes readouts after callbacks', () => {
    const onRaceEvent = vi.fn();
    const onRaceFinish = vi.fn();
    const { app } = frameRuntime({ onRaceEvent, onRaceFinish }, {
      events: [{ type: 'contact', at: FIXED_STEP, carId: 'alpha' }], finished: true,
    });
    app.tick();
    expect(onRaceEvent).toHaveBeenCalledTimes(1);
    expect(onRaceFinish).toHaveBeenCalledTimes(1);
    expect(app.renderCars).toHaveBeenCalledTimes(1);
    expect(app.updateDom).toHaveBeenCalledTimes(1);
    app.destroy();
  });

  test.each(['expert', 'readouts'])('%s rendering stops when its lifecycle callback unmounts the runtime', (surface) => {
    let app;
    const fixture = frameRuntime({ onRaceFinish: () => app.destroy() }, { finished: true });
    app = fixture.app;
    const snapshot = fixture.simulation.snapshot();
    if (surface === 'readouts') app.updateDom.mockRestore();
    expect(() => surface === 'expert' ? app.renderExpertFrame(snapshot) : app.updateDom(snapshot)).not.toThrow();
    expect(app.destroyed).toBe(true);
    expect(app.applyCamera).not.toHaveBeenCalled();
    expect(app.renderCars).not.toHaveBeenCalled();
  });

  test.each(['destroy', 'restart'])('a host %s during an event batch stops remaining events and obsolete finish delivery', (action) => {
    let app;
    const replacement = {};
    const onRaceFinish = vi.fn();
    const onRaceEvent = vi.fn(() => {
      if (action === 'destroy') app.destroy();
      else { app.sim = replacement; app.hostLifecycle.reset(); }
    });
    const fixture = frameRuntime({ onRaceEvent, onRaceFinish }, {
      events: [{ type: 'contact', carId: 'alpha' }, { type: 'contact', carId: 'beta' }], finished: true,
    });
    app = fixture.app;
    const emitter = app.hostLifecycle;
    app.tick();
    expect(onRaceEvent).toHaveBeenCalledTimes(1);
    expect(onRaceFinish).not.toHaveBeenCalled();
    expect(app.renderCars).not.toHaveBeenCalled();
    if (action === 'restart') {
      expect(emitter.lastLeaderLap).toBeNull();
      expect(emitter.raceFinishEmitted).toBe(false);
      expect(emitter.emittedRaceEventKeys.size).toBe(0);
      app.destroy();
    }
  });

  test.each(['destroy', 'restart'])('a host %s during lap delivery cannot dispatch events or corrupt successor lifecycle state', (action) => {
    let app;
    const onRaceEvent = vi.fn();
    const onRaceFinish = vi.fn();
    const onLapChange = vi.fn(() => {
      if (action === 'destroy') app.destroy();
      else { app.sim = {}; app.hostLifecycle.reset(); }
    });
    const fixture = frameRuntime({ onLapChange, onRaceEvent, onRaceFinish }, {
      events: [{ type: 'contact', carId: 'alpha' }], finished: true, cars: [{ id: 'alpha', lap: 2 }],
    });
    app = fixture.app;
    app.updateDom.mockRestore();
    const emitter = app.hostLifecycle;
    emitter.lastLeaderLap = 1;
    expect(() => app.updateDom(fixture.simulation.snapshot())).not.toThrow();
    expect(onLapChange).toHaveBeenCalledTimes(1);
    expect(onRaceEvent).not.toHaveBeenCalled();
    expect(onRaceFinish).not.toHaveBeenCalled();
    if (action === 'restart') {
      expect(emitter.lastLeaderLap).toBeNull();
      expect(emitter.raceFinishEmitted).toBe(false);
      expect(emitter.emittedRaceEventKeys.size).toBe(0);
      app.destroy();
    }
  });
});
