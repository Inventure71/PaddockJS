import { describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import {
  createPaddockSimulator,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountTelemetryPanel,
  mountTimingTower,
} from '../index.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { createF1SimulatorShell } from '../ui/shellTemplate.js';

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

function createMarkupRoot() {
  return {
    innerHTML: '',
    style: {
      setProperty: vi.fn(),
    },
    querySelector(selector) {
      if (selector === '[data-track-canvas]' && this.innerHTML.includes('data-track-canvas')) {
        return { selector };
      }
      return this.innerHTML.includes(selector.replace(/^\[/, '').replace(/\]$/, '')) ? { selector } : null;
    },
    querySelectorAll(selector) {
      return this.querySelector(selector) ? [{ selector }] : [];
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

  test('does not require optional telemetry or race data panels to render runtime state', () => {
    const driver = {
      id: 'alpha',
      name: 'Alpha Project',
      color: '#ff2d55',
      timingCode: 'ALP',
    };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [driver],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const car = {
      ...driver,
      code: 'ALP',
      rank: 1,
      speedKph: 211,
      throttle: 0.81,
      brake: 0.12,
      tireEnergy: 93,
      drsActive: false,
      drsEligible: true,
      setup: {},
    };

    expect(() => app.renderTelemetry(car)).not.toThrow();
    expect(() => app.renderRaceData(car)).not.toThrow();
    expect(() => app.renderProjectRadio(performance.now())).not.toThrow();
  });

  test('creates a composable simulator that mounts panels into separate host roots', () => {
    const simulator = createPaddockSimulator({
      drivers: [
        {
          id: 'alpha',
          name: 'Alpha Project',
          color: '#ff2d55',
          link: '/alpha.html',
          raceData: ['Host-provided entry'],
        },
      ],
    });
    const controls = createMarkupRoot();
    const tower = createMarkupRoot();
    const race = createMarkupRoot();
    const telemetry = createMarkupRoot();
    const raceData = createMarkupRoot();

    simulator.mountRaceControls(controls);
    simulator.mountTimingTower(tower);
    simulator.mountRaceCanvas(race);
    simulator.mountTelemetryPanel(telemetry);
    simulator.mountRaceDataPanel(raceData);

    expect(controls.innerHTML).toContain('data-safety-car');
    expect(tower.innerHTML).toContain('data-timing-tower');
    expect(race.innerHTML).toContain('data-track-canvas');
    expect(telemetry.innerHTML).toContain('data-telemetry-speed');
    expect(raceData.innerHTML).toContain('data-race-data-open');
    expect(simulator.querySelector('[data-track-canvas]')).toEqual({ selector: '[data-track-canvas]' });
  });

  test('exports standalone mount helpers for individual panels', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const controls = createMarkupRoot();
    const tower = createMarkupRoot();
    const race = createMarkupRoot();
    const telemetry = createMarkupRoot();
    const raceData = createMarkupRoot();

    mountRaceControls(controls, simulator);
    mountTimingTower(tower, simulator);
    mountRaceCanvas(race, simulator);
    mountTelemetryPanel(telemetry, simulator);
    mountRaceDataPanel(raceData, simulator);

    expect(controls.innerHTML).toContain('data-paddock-component="race-controls"');
    expect(tower.innerHTML).toContain('data-paddock-component="timing-tower"');
    expect(race.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(telemetry.innerHTML).toContain('data-paddock-component="telemetry-panel"');
    expect(raceData.innerHTML).toContain('data-paddock-component="race-data-panel"');
  });
});
