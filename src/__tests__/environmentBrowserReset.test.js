import { describe, expect, test, vi } from 'vitest';
import { createBrowserExpertAdapter } from '../app/BrowserExpertAdapter.js';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK } from '../simulation/trackModel.js';

function createBrowserHost() {
  const options = resolveEnvironmentOptions({
    drivers: [
      { id: 'alpha', name: 'Alpha', color: '#ff0000' },
      { id: 'bravo', name: 'Bravo', color: '#0000ff' },
    ],
    entries: [],
    controlledDrivers: ['alpha'],
    seed: 71,
    trackSeed: 2097,
    track: TRACK,
    warmup: false,
    ui: { raceDataBanners: {} },
    assets: { trackTextures: {} },
    sensors: { rays: { enabled: false }, nearbyCars: { enabled: false } },
  });
  return {
    options,
    drivers: options.drivers,
    driverById: new Map(options.drivers.map((driver) => [driver.id, driver])),
    sim: createRaceSimulation(options),
    root: { style: { setProperty: vi.fn() } },
    applyExpertOptions: F1SimulatorApp.prototype.applyExpertOptions,
    createRaceSimulation: vi.fn(createRaceSimulation),
    createCars: vi.fn(),
    renderTrack: vi.fn(),
    renderExpertFrame: vi.fn(),
  };
}

describe('browser environment resets', () => {
  test('recreating the browser adapter preserves excluded drivers and honors a replacement roster', () => {
    const app = createBrowserHost();
    let expert = createBrowserExpertAdapter(app, { controlledDrivers: ['alpha'] });
    try {
      expert.reset({ scenario: { participants: 'controlled-only' } });
      expert.destroy();
      expert = createBrowserExpertAdapter(app, { controlledDrivers: ['alpha'] });
      expect(expert.reset({ scenario: { participants: 'all' } }).state.snapshot.cars.map((car) => car.id))
        .toEqual(['alpha', 'bravo']);

      expert.destroy();
      app.applyExpertOptions({ drivers: [app.drivers[0]] });
      expert = createBrowserExpertAdapter(app, { controlledDrivers: ['alpha'] });
      expect(expert.reset({ scenario: { participants: 'all' } }).state.snapshot.cars.map((car) => car.id))
        .toEqual(['alpha']);
      expect(() => expert.reset({ controlledDrivers: ['bravo'] })).toThrow('controlled driver does not exist: bravo');
    } finally {
      expert.destroy();
    }
  });

  test('failed simulation creation keeps the host configuration and visible simulation intact', () => {
    const app = createBrowserHost();
    const expert = createBrowserExpertAdapter(app, { controlledDrivers: ['alpha'] });
    const previousOptions = app.options;
    const previousDrivers = app.drivers;
    const previousDriverById = app.driverById;
    const previousSimulation = app.sim;
    try {
      expect(() => expert.reset({
        controlledDrivers: ['bravo'],
        scenario: { participants: 'controlled-only' },
        track: null,
        trackGeneration: { profile: 'invalid-reset-profile' },
      })).toThrow('Unsupported procedural track profile: invalid-reset-profile');

      expect(app.options).toBe(previousOptions);
      expect(app.drivers).toBe(previousDrivers);
      expect(app.driverById).toBe(previousDriverById);
      expect(app.sim).toBe(previousSimulation);
      expect(app.createCars).not.toHaveBeenCalled();
      expect(app.renderTrack).not.toHaveBeenCalled();
      expect(app.renderExpertFrame).not.toHaveBeenCalled();
      expect(expert.getActionSpec().controlledDrivers).toEqual(['alpha']);
      expect(expert.reset().state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
    } finally {
      expert.destroy();
    }
  });

  test('successful participant resets synchronize the host, simulation, specs, and rendered observations', () => {
    const app = createBrowserHost();
    const expert = createBrowserExpertAdapter(app, { controlledDrivers: ['alpha'] });
    try {
      expert.reset({ scenario: { participants: 'controlled-only' } });
      expect(app.drivers.map((driver) => driver.id)).toEqual(['alpha']);

      const switched = expert.reset({ controlledDrivers: ['bravo'] });
      expect(app.options.controlledDrivers).toEqual(['bravo']);
      expect(app.drivers.map((driver) => driver.id)).toEqual(['bravo']);
      expect(app.sim.cars.map((car) => car.id)).toEqual(['bravo']);
      expect(expert.getActionSpec().controlledDrivers).toEqual(['bravo']);
      expect(Object.keys(switched.observation)).toEqual(['bravo']);
      expect(app.renderExpertFrame).toHaveBeenLastCalledWith(
        switched.state.snapshot,
        { forceDomUpdate: true, observation: switched.observation },
      );

      const restored = expert.reset({ scenario: { participants: 'all' } });
      expect(app.options.drivers).toBe(app.drivers);
      expect(app.drivers.map((driver) => driver.id)).toEqual(['alpha', 'bravo']);
      expect(app.sim.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
      expect(restored.state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
      expect([...app.driverById.keys()]).toEqual(['alpha', 'bravo']);
    } finally {
      expert.destroy();
    }
  });
});
