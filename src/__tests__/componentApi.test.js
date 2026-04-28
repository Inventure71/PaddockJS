import { describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../F1SimulatorApp.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../defaultAssets.js';
import { normalizeSimulatorDrivers } from '../normalizeDrivers.js';
import { createF1SimulatorShell } from '../shellTemplate.js';

function createRootStub(openButton) {
  return {
    style: {
      setProperty: vi.fn(),
    },
    querySelector(selector) {
      if (selector === '[data-race-data-open]') return openButton;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

describe('f1 simulator component API', () => {
  test('normalizes host-provided drivers and car pairings into simulation-ready entries', () => {
    const drivers = normalizeSimulatorDrivers([
      {
        id: 'alpha',
        name: 'Alpha Project',
        color: '#ff2d55',
        link: '/alpha.html',
        raceData: ['Host-provided entry'],
      },
    ], {
      entries: [
        {
          driverId: 'alpha',
          driverNumber: 71,
          timingName: 'Alpha',
          driver: { pace: 62, racecraft: 74, aggression: 54, riskTolerance: 58, patience: 52, consistency: 69 },
          vehicle: { id: 'alpha-a71', name: 'A71', power: 66, braking: 61, aero: 57, dragEfficiency: 64, mechanicalGrip: 60, weightControl: 56, tireCare: 59 },
        },
      ],
    });

    expect(drivers).toHaveLength(1);
    expect(drivers[0]).toMatchObject({
      id: 'alpha',
      name: 'Alpha Project',
      link: '/alpha.html',
      driverNumber: 71,
      timingCode: 'ALP',
    });
    expect(drivers[0].constructorArgs.driver.ratings.pace).toBe(62);
    expect(drivers[0].constructorArgs.vehicle.ratings.power).toBe(66);
    expect(drivers[0].vehicle.id).toBe('alpha-a71');
  });

  test('renders an owned shell with bundled asset URLs and a callback-driven project button', () => {
    const html = createF1SimulatorShell({
      title: 'Race Lab',
      kicker: 'Race Control',
      backLinkHref: '/projects.html',
      backLinkLabel: 'Projects',
      showBackLink: true,
      totalLaps: 12,
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
    });

    expect(html).toContain('data-f1-simulator-shell');
    expect(html).toContain('data-race-data-open');
    expect(html).toContain(DEFAULT_F1_SIMULATOR_ASSETS.f1Logo);
    expect(html).toContain(DEFAULT_F1_SIMULATOR_ASSETS.carOverview);
    expect(html).not.toContain('data-race-data-link');
  });

  test('calls onDriverOpen with the active driver when the race data button is pressed', () => {
    let openHandler = null;
    const openButton = {
      addEventListener(type, handler) {
        if (type === 'click') openHandler = handler;
      },
    };
    const onDriverOpen = vi.fn();
    const driver = {
      id: 'alpha',
      name: 'Alpha Project',
      color: '#ff2d55',
      timingCode: 'ALP',
    };
    const app = new F1SimulatorApp(createRootStub(openButton), {
      drivers: [driver],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      onDriverOpen,
      ui: {},
    });

    app.bindControls();
    app.activeRaceDataId = 'alpha';
    openHandler();

    expect(onDriverOpen).toHaveBeenCalledWith(driver);
  });
});
