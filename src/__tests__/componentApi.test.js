import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import {
  createPaddockSimulator,
  mountCameraControls,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountSafetyCarControl,
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

function createOverlayRootStub({ canvasHost, timingTower }) {
  return {
    style: {
      setProperty: vi.fn(),
    },
    querySelector(selector) {
      if (selector === '[data-track-canvas]') return canvasHost;
      if (selector === '[data-timing-tower]') return timingTower;
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

  test('renders a left overlay shell preset with external camera controls and optional fps hidden', () => {
    const html = createF1SimulatorShell({
      title: 'Race Lab',
      kicker: 'Race Control',
      backLinkHref: '/projects.html',
      backLinkLabel: 'Projects',
      showBackLink: true,
      totalLaps: 12,
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      ui: {
        layoutPreset: 'left-tower-overlay',
        cameraControls: 'external',
        showFps: false,
      },
    });

    expect(html).toContain('sim-shell--left-tower-overlay');
    expect(html).toContain('data-paddock-component="camera-controls"');
    expect(html).toContain('data-timing-tower');
    expect(html).not.toContain('fps-counter');
    expect(html.indexOf('data-paddock-component="camera-controls"')).toBeLessThan(
      html.indexOf('data-paddock-component="race-canvas"'),
    );
  });

  test('left tower overlay css reserves the broadcast gutter for canvas overlays', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).not.toContain('--timing-overlay-width');
    expect(css).not.toContain('--timing-overlay-safe-left');
    expect(css).toContain('width: clamp(210px, 19.5%, 375px)');
    expect(css).toContain('.sim-shell--left-tower-overlay .sim-canvas-panel > .camera-controls');
    expect(css).toContain('.sim-shell--left-tower-overlay .race-data-panel');
    expect(css).toContain('.sim-shell--left-tower-overlay .timing-list');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('.sim-shell--left-tower-overlay .broadcast-column-head span');
    expect(css).toContain('grid-template-columns: 1.7rem 1.8rem minmax(0, 1fr) minmax(2.7rem, 3.45rem) 1.25rem');
    expect(css).toContain('clip-path: inset(0 round 1.25rem)');
  });

  test('left tower overlay camera frames the race view outside the broadcast gutter', () => {
    const canvasHost = {
      clientWidth: 1000,
      clientHeight: 600,
      getBoundingClientRect() {
        return { left: 0, right: 1000 };
      },
    };
    const timingTower = {
      getBoundingClientRect() {
        return { left: 16, right: 241 };
      },
    };
    const app = new F1SimulatorApp(createOverlayRootStub({ canvasHost, timingTower }), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: { layoutPreset: 'left-tower-overlay' },
    });

    const safeArea = app.getCameraSafeArea(1000);
    const frame = app.getCameraFrame({
      cars: [{ id: 'alpha', x: 5000, y: 3200 }],
      raceControl: { mode: 'green' },
    }, 1000, 600, 1, safeArea);

    expect(safeArea.left).toBe(257);
    expect(safeArea.width).toBe(743);
    expect(frame.screenX).toBe(628.5);
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

  test('exports standalone mount helpers for individual panels and controls', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const controls = createMarkupRoot();
    const camera = createMarkupRoot();
    const safety = createMarkupRoot();
    const tower = createMarkupRoot();
    const race = createMarkupRoot();
    const telemetry = createMarkupRoot();
    const raceData = createMarkupRoot();

    mountRaceControls(controls, simulator);
    mountCameraControls(camera, simulator);
    mountSafetyCarControl(safety, simulator);
    mountTimingTower(tower, simulator);
    mountRaceCanvas(race, simulator);
    mountTelemetryPanel(telemetry, simulator);
    mountRaceDataPanel(raceData, simulator);

    expect(controls.innerHTML).toContain('data-paddock-component="race-controls"');
    expect(camera.innerHTML).toContain('data-paddock-component="camera-controls"');
    expect(safety.innerHTML).toContain('data-paddock-component="safety-car-control"');
    expect(tower.innerHTML).toContain('data-paddock-component="timing-tower"');
    expect(race.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(telemetry.innerHTML).toContain('data-paddock-component="telemetry-panel"');
    expect(raceData.innerHTML).toContain('data-paddock-component="race-data-panel"');
  });

  test('exposes explicit safety car control methods for external callers', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const app = {
      setSafetyCarDeployed: vi.fn(),
      getSnapshot: vi.fn()
        .mockReturnValueOnce({ raceControl: { mode: 'green' } })
        .mockReturnValueOnce({ raceControl: { mode: 'safety-car' } }),
    };
    simulator.app = app;

    simulator.callSafetyCar();
    simulator.clearSafetyCar();
    simulator.toggleSafetyCar();
    simulator.toggleSafetyCar();

    expect(app.setSafetyCarDeployed).toHaveBeenNthCalledWith(1, true);
    expect(app.setSafetyCarDeployed).toHaveBeenNthCalledWith(2, false);
    expect(app.setSafetyCarDeployed).toHaveBeenNthCalledWith(3, true);
    expect(app.setSafetyCarDeployed).toHaveBeenNthCalledWith(4, false);
  });
});
