import { describe, expect, test, vi } from 'vitest';
import { slowTest } from './testModes.js';
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

  test('can suppress intermediate expert renders while still stepping the visible simulation', () => {
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

    expert.setFrameRenderSuppressed(true);
    expert.step({ [driverId]: { steering: 0, throttle: 1, brake: 0 } });
    expert.setFrameRenderSuppressed(false);
    expert.step({ [driverId]: { steering: 0, throttle: 1, brake: 0 } });

    expect(sim.step).toHaveBeenCalledTimes(2);
    expect(app.renderExpertFrame).toHaveBeenCalledTimes(1);
  });

  test('expert reset preserves the app track query index option when recreating the simulation', () => {
    const driverId = DEMO_PROJECT_DRIVERS[0].id;
    const options = {
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      trackQueryIndex: true,
      totalLaps: 2,
      scenario: { participants: 'controlled-only' },
      rules: { standingStart: false },
    };
    let visualSim = createRaceSimulation(options);
    const app = {
      sim: visualSim,
      options: {
        ...options,
        expert: {
          enabled: true,
          controlledDrivers: [driverId],
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
    });

    const result = expert.reset({ trackSeed: 2027 });

    expect(app.createRaceSimulation).toHaveBeenCalledWith(expect.objectContaining({
      trackSeed: 2027,
      trackQueryIndex: true,
    }));
    expect(app.sim.track.queryIndex).toBeDefined();
    expect(Object.keys(result.state.snapshot.track)).not.toContain('queryIndex');
  });

  test('attaches external renderer frames and blocks local expert stepping', () => {
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
    let subscribedFrameHandler = null;
    let unsubscribed = false;
    expert.attachExternalRenderer({
      subscribe(onFrame) {
        subscribedFrameHandler = onFrame;
        return () => {
          unsubscribed = true;
        };
      },
    });
    expect(expert.getExternalRendererState()).toEqual(expect.objectContaining({
      attached: true,
      lastError: null,
    }));
    subscribedFrameHandler({
      snapshot: createSnapshot(),
      observation: { [driverId]: { vector: [1, 2, 3] } },
      meta: { step: 7 },
    });
    expect(app.renderExpertFrame).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        forceDomUpdate: true,
        observation: expect.any(Object),
      }),
    );
    expect(() => expert.step({
      [driverId]: { steering: 0, throttle: 0.5, brake: 0 },
    })).toThrow('disabled while external renderer mode is attached');
    expect(() => expert.resetDrivers?.({
      [driverId]: { distanceMeters: 100, speedKph: 80, offsetMeters: 0 },
    })).toThrow('disabled while external renderer mode is attached');
    expert.detachExternalRenderer();
    expect(unsubscribed).toBe(true);
    expect(expert.getExternalRendererState().attached).toBe(false);
  });

  test('normalizes external renderer driver ids to local driver slots', () => {
    const localIds = DEMO_PROJECT_DRIVERS.slice(0, 2).map((driver) => driver.id);
    const sim = {
      snapshot: vi.fn(createSnapshot),
      setCarControls: vi.fn(),
      step: vi.fn(),
    };
    const app = {
      sim,
      options: {
        drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS.slice(0, 2),
        expert: {
          enabled: true,
          controlledDrivers: localIds,
        },
      },
      applyExpertOptions: vi.fn(),
      createRaceSimulation: vi.fn(() => sim),
      renderExpertFrame: vi.fn(),
      renderTrack: vi.fn(),
    };
    const expert = createBrowserExpertAdapter(app, {
      enabled: true,
      controlledDrivers: localIds,
    });
    let onFrame = null;
    expert.attachExternalRenderer({
      subscribe(handler) {
        onFrame = handler;
        return () => {};
      },
    });
    onFrame({
      snapshot: {
        ...createSnapshot(),
        cars: [
          { id: 'self-agent-01', rank: 1, x: 10, y: 10, heading: 0, color: null, name: null, code: null },
          { id: 'self-agent-02', rank: 2, x: 20, y: 20, heading: 0, color: null, name: null, code: null },
        ],
      },
      observation: {
        'self-agent-01': { vector: [1, 2] },
        'self-agent-02': { vector: [3, 4] },
      },
      meta: { step: 12 },
    });

    expect(app.renderExpertFrame).toHaveBeenCalled();
    const [renderSnapshot, renderOptions] = app.renderExpertFrame.mock.calls.at(-1);
    expect(renderSnapshot.cars.map((car) => car.id)).toEqual(localIds);
    expect(renderOptions.observation[localIds[0]]).toEqual({ vector: [1, 2] });
    expect(renderOptions.observation[localIds[1]]).toEqual({ vector: [3, 4] });
    expect(expert.getExternalRendererState().lastMeta).toEqual(expect.objectContaining({
      step: 12,
      externalDriverMap: expect.objectContaining({
        'self-agent-01': localIds[0],
        'self-agent-02': localIds[1],
      }),
    }));
  });

  test('restores local stepping after external renderer detach', () => {
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
    expert.attachExternalRenderer({
      subscribe() {
        return () => {};
      },
    });
    expert.detachExternalRenderer();
    expert.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });
    expect(sim.step).toHaveBeenCalled();
  });

  slowTest('matches headless environment state for the same seed and actions', () => {
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
