import { describe, expect, test, vi } from 'vitest';
import { createBrowserExpertAdapter } from '../app/BrowserExpertAdapter.js';
import { createPaddockEnvironment } from '../environment/index.js';
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
} from '../index.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

function createSnapshot() {
  return {
    time: 0,
    world: { width: 1, height: 1 },
    track: { width: 100, length: 1000 },
    totalLaps: 1,
    raceControl: {
      mode: 'green',
      finished: false,
      finishedAt: null,
      winner: null,
      classification: [],
      start: { visible: false },
    },
    safetyCar: { deployed: false },
    rules: {},
    events: [],
    cars: [],
  };
}

describe('browser expert adapter', () => {
  test('uses the app simulation host instead of creating a parallel visible simulation for reads', () => {
    const sim = {
      snapshot: vi.fn(createSnapshot),
      setCarControls: vi.fn(),
      step: vi.fn(),
    };
    const app = {
      sim,
      options: {
        drivers: DEMO_PROJECT_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
        expert: {
          enabled: true,
          controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
        },
      },
      applyExpertOptions: vi.fn(),
      createRaceSimulation: vi.fn(() => sim),
      renderExpertFrame: vi.fn(),
      renderTrack: vi.fn(),
    };

    const expert = createBrowserExpertAdapter(app, {
      enabled: true,
      controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
    });

    expert.getState();
    expect(sim.snapshot).toHaveBeenCalled();
    expect(app.createRaceSimulation).not.toHaveBeenCalled();
  });

  test('renders through the app after explicit expert steps', () => {
    const driverId = DEMO_PROJECT_DRIVERS[0].id;
    const sim = {
      snapshot: vi.fn(createSnapshot),
      setCarControls: vi.fn(),
      step: vi.fn(),
    };
    const app = {
      sim,
      options: {
        drivers: DEMO_PROJECT_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
        expert: {
          enabled: true,
          controlledDrivers: [driverId],
        },
      },
      applyExpertOptions: vi.fn(),
      createRaceSimulation: vi.fn(() => sim),
      renderExpertFrame: vi.fn(),
      renderTrack: vi.fn(),
    };

    const expert = createBrowserExpertAdapter(app, {
      enabled: true,
      controlledDrivers: [driverId],
    });

    expert.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(sim.setCarControls).toHaveBeenCalled();
    expect(sim.step).toHaveBeenCalled();
    expect(app.renderExpertFrame).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        observation: expect.any(Object),
      }),
    );
  });

  test('matches headless environment state for the same seed and actions', () => {
    const driverId = DEMO_PROJECT_DRIVERS[0].id;
    const options = {
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 3),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      frameSkip: 3,
      totalLaps: 2,
      scenario: { participants: 'controlled-only' },
      rules: { standingStart: false },
    };
    const headless = createPaddockEnvironment(options);
    let visualSim = createRaceSimulation(options);
    const app = {
      sim: visualSim,
      options: {
        ...options,
        expert: {
          enabled: true,
          controlledDrivers: [driverId],
          frameSkip: 3,
        },
      },
      applyExpertOptions: vi.fn(),
      createRaceSimulation: vi.fn((nextOptions) => {
        visualSim = createRaceSimulation(nextOptions);
        return visualSim;
      }),
      renderExpertFrame: vi.fn(),
      renderTrack: vi.fn(),
    };
    const expert = createBrowserExpertAdapter(app, {
      enabled: true,
      controlledDrivers: [driverId],
      frameSkip: 3,
    });

    headless.reset();
    expert.reset();

    const actions = [
      { [driverId]: { steering: 0, throttle: 1, brake: 0 } },
      { [driverId]: { steering: 0.2, throttle: 0.8, brake: 0 } },
      { [driverId]: { steering: -0.1, throttle: 0.6, brake: 0.1 } },
    ];

    let headlessResult = null;
    let visualResult = null;
    actions.forEach((action) => {
      headlessResult = headless.step(action);
      visualResult = expert.step(action);
    });

    const headlessCar = headlessResult.state.snapshot.cars.find((car) => car.id === driverId);
    const visualCar = visualResult.state.snapshot.cars.find((car) => car.id === driverId);

    expect(visualResult.info.step).toBe(headlessResult.info.step);
    expect(visualCar.distanceMeters).toBeCloseTo(headlessCar.distanceMeters, 5);
    expect(visualCar.speedKph).toBeCloseTo(headlessCar.speedKph, 5);
    expect(visualResult.observation[driverId].object.rays).toEqual(headlessResult.observation[driverId].object.rays);
    expect(expert.getActionSpec()).toEqual(headless.getActionSpec());
    expect(expert.getObservationSpec()).toEqual(headless.getObservationSpec());
  });
});
