import { describe, expect, test, vi } from 'vitest';
import { createBrowserExpertAdapter } from '../app/BrowserExpertAdapter.js';
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
} from '../index.js';

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
});
