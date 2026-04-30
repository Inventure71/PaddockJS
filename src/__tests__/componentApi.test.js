import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { setText } from '../app/domBindings.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import { PADDOCK_SIMULATOR_PRESETS, resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import {
  createPaddockSimulator,
  mountCarDriverOverview,
  mountCameraControls,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountSafetyCarControl,
  mountTelemetryPanel,
  mountTimingTower,
} from '../index.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { createTimingTowerMarkup } from '../ui/componentTemplates.js';
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
          driver: {
            pace: 62,
            racecraft: 74,
            aggression: 54,
            riskTolerance: 58,
            patience: 52,
            consistency: 69,
            customFields: { Specialty: 'Late braking' },
          },
          vehicle: {
            id: 'alpha-a71',
            name: 'A71',
            power: 66,
            braking: 61,
            aero: 57,
            dragEfficiency: 64,
            mechanicalGrip: 60,
            weightControl: 56,
            tireCare: 59,
            customFields: [{ label: 'Aero kit', value: 'Low drag' }],
          },
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
    expect(drivers[0].constructorArgs.driver.customFields).toEqual([{ label: 'Specialty', value: 'Late braking' }]);
    expect(drivers[0].constructorArgs.vehicle.customFields).toEqual([{ label: 'Aero kit', value: 'Low drag' }]);
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
        raceDataBannerSize: 'auto',
      },
    });

    expect(html).toContain('sim-shell--left-tower-overlay');
    expect(html).toContain('sim-shell--timing-expand-race-view');
    expect(html).toContain('sim-shell--race-data-auto');
    expect(html).toContain('race-data-panel--auto');
    expect(html).toContain('data-paddock-component="camera-controls"');
    expect(html).toContain('data-timing-tower');
    expect(html).not.toContain('fps-counter');
    expect(html.indexOf('data-paddock-component="camera-controls"')).toBeLessThan(
      html.indexOf('data-paddock-component="race-canvas"'),
    );
    expect(html.indexOf('data-paddock-component="race-canvas"')).toBeLessThan(
      html.indexOf('data-paddock-component="race-data-panel"'),
    );
    expect(html.indexOf('data-paddock-component="race-data-panel"')).toBeLessThan(
      html.indexOf('data-paddock-component="telemetry-panel"'),
    );
  });

  test('timing tower exposes runtime interval and leader gap modes', () => {
    const html = createTimingTowerMarkup({
      totalLaps: 12,
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
    });

    expect(html).toContain('data-timing-gap-mode="interval"');
    expect(html).toContain('data-timing-gap-mode="leader"');
    expect(html).toContain('data-timing-gap-label');
  });

  test('timing tower can switch between interval and leader gap display at runtime', () => {
    const timingList = { innerHTML: '' };
    const intervalButton = {
      dataset: { timingGapMode: 'interval' },
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
    };
    const leaderButton = {
      dataset: { timingGapMode: 'leader' },
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
    };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-timing-list]') return timingList;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-timing-gap-mode]') return [intervalButton, leaderButton];
        return [];
      },
    }, {
      drivers: [
        { id: 'alpha', name: 'Alpha Project', color: '#ff2d55', team: { icon: 'AP', color: '#00ff84' } },
        { id: 'bravo', name: 'Bravo Project', color: '#39a7ff', team: { icon: 'BP', color: '#ffd166' } },
        { id: 'charlie', name: 'Charlie Project', color: '#14c784', team: { icon: 'CP' } },
      ],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const cars = [
      { id: 'alpha', rank: 1, code: 'ALP', timingCode: 'ALP', name: 'Alpha Project', color: '#ff2d55', tire: 'M' },
      { id: 'bravo', rank: 2, code: 'BRV', timingCode: 'BRV', name: 'Bravo Project', color: '#39a7ff', tire: 'H', intervalAheadSeconds: 1.234, leaderGapSeconds: 1.234 },
      { id: 'charlie', rank: 3, code: 'CHR', timingCode: 'CHR', name: 'Charlie Project', color: '#14c784', tire: 'S', intervalAheadSeconds: 0.789, leaderGapSeconds: 2.023 },
    ];

    app.bindControls();
    app.renderTiming(cars, 'green');
    expect(timingList.innerHTML).toContain('+0.789');
    expect(timingList.innerHTML).not.toContain('+2.023');
    expect(timingList.innerHTML).toContain('timing-team-icon');
    expect(timingList.innerHTML).toContain('AP');

    const switchToLeader = leaderButton.addEventListener.mock.calls.find(([type]) => type === 'click')[1];
    app.sim = { snapshot: () => ({ cars, raceControl: { mode: 'green' } }) };
    switchToLeader();

    expect(timingList.innerHTML).toContain('+2.023');
    expect(timingList.innerHTML).not.toContain('+0.789');
    expect(leaderButton.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
  });

  test('resolves banner defaults and timing vertical fit options', () => {
    const optionDrivers = [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }];
    const options = resolveF1SimulatorOptions({
      drivers: optionDrivers,
      ui: {
        raceDataBanners: {
          initial: 'radio',
          enabled: ['radio'],
        },
        timingTowerVerticalFit: 'scroll',
        raceDataBannerSize: 'auto',
      },
    });

    expect(options.ui.raceDataBanners).toEqual({
      initial: 'radio',
      enabled: ['radio'],
    });
    expect(options.ui.timingTowerVerticalFit).toBe('scroll');
    expect(options.ui.raceDataBannerSize).toBe('auto');

    const disabledInitial = resolveF1SimulatorOptions({
      drivers: optionDrivers,
      ui: {
        raceDataBanners: {
          initial: 'project',
          enabled: ['radio'],
        },
        raceDataBannerSize: 'bad-value',
      },
    });

    expect(disabledInitial.ui.raceDataBanners.initial).toBe('hidden');
    expect(disabledInitial.ui.raceDataBannerSize).toBe('custom');
  });

  test('resolves public presets before host overrides', () => {
    const options = resolveF1SimulatorOptions({
      preset: 'timing-overlay',
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      ui: {
        showFps: true,
        raceDataBanners: {
          initial: 'radio',
        },
      },
    });

    expect(PADDOCK_SIMULATOR_PRESETS['timing-overlay']).toBeDefined();
    expect(options.preset).toBe('timing-overlay');
    expect(options.ui.layoutPreset).toBe('left-tower-overlay');
    expect(options.ui.cameraControls).toBe('external');
    expect(options.ui.raceDataBannerSize).toBe('auto');
    expect(options.ui.showFps).toBe(true);
    expect(options.ui.raceDataBanners.initial).toBe('radio');
    expect(options.ui.raceDataBanners.enabled).toEqual(['project', 'radio']);
  });

  test('applies the package theme and sizing contract as css variables', () => {
    const root = createRootStub(null);
    const options = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      theme: {
        accentColor: '#00ff84',
        raceViewMinHeight: '720px',
        timingTowerMaxWidth: '360px',
      },
    });

    new F1SimulatorApp(root, options);

    expect(root.style.setProperty).toHaveBeenCalledWith('--paddock-accent-color', '#00ff84');
    expect(root.style.setProperty).toHaveBeenCalledWith('--paddock-race-view-min-height', '720px');
    expect(root.style.setProperty).toHaveBeenCalledWith('--paddock-timing-tower-max-width', '360px');
  });

  test('generates a fresh procedural track seed unless host provides one', () => {
    const originalCrypto = globalThis.crypto;
    let nextSeed = 1000;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues(values) {
          values[0] = nextSeed;
          nextSeed += 1;
          return values;
        },
      },
    });

    try {
      const first = new F1SimulatorApp(createRootStub(null), {
        drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
        assets: DEFAULT_F1_SIMULATOR_ASSETS,
        initialCameraMode: 'leader',
        totalLaps: 10,
        seed: 1971,
        ui: {},
      });
      const second = new F1SimulatorApp(createRootStub(null), {
        drivers: [{ id: 'bravo', name: 'Bravo Project', color: '#39a7ff' }],
        assets: DEFAULT_F1_SIMULATOR_ASSETS,
        initialCameraMode: 'leader',
        totalLaps: 10,
        seed: 3171,
        ui: {},
      });
      const explicit = new F1SimulatorApp(createRootStub(null), {
        drivers: [{ id: 'charlie', name: 'Charlie Project', color: '#14c784' }],
        assets: DEFAULT_F1_SIMULATOR_ASSETS,
        initialCameraMode: 'leader',
        trackSeed: 123456,
        totalLaps: 10,
        seed: 4171,
        ui: {},
      });

      expect(first.trackSeed).toBe(1000);
      expect(second.trackSeed).toBe(1001);
      expect(explicit.trackSeed).toBe(123456);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  test('left tower overlay css keeps race controls clear while race data stays inside the race view', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).not.toContain('--timing-overlay-width');
    expect(css).not.toContain('--timing-overlay-safe-left');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('--timing-board-width: max(255px, calc((100cqw - 1.8rem) * 0.78 / 4.68))');
    expect(css).toContain('--timing-board-min-height');
    expect(css).toContain('.sim-shell--left-tower-overlay.sim-grid');
    expect(css).toContain('.sim-shell--left-tower-overlay.sim-shell--timing-expand-race-view .sim-canvas-panel');
    expect(css).toContain('.sim-shell--left-tower-overlay.sim-shell--timing-scroll .sim-timing');
    expect(css).toContain('.sim-shell--left-tower-overlay .sim-timing.broadcast-tower');
    expect(css).toContain('.sim-canvas-panel--with-timing-tower > .sim-timing.broadcast-tower');
    expect(css).toContain('width: var(--timing-board-width)');
    expect(css).toContain('height: auto;');
    expect(css).toContain('.sim-shell--left-tower-overlay .sim-canvas-panel > .camera-controls');
    expect(css).toContain('.sim-shell--left-tower-overlay .race-data-panel');
    expect(css).toContain('.race-data-panel--custom');
    expect(css).toContain('.sim-shell--left-tower-overlay .race-data-panel--auto');
    expect(css).toContain('@container (min-width: 980px)');
    expect(css).toContain('--race-data-safe-left');
    expect(css).toContain('z-index: 8;');
    expect(css).toContain('.sim-shell--left-tower-overlay .race-data-copy');
    expect(css).toContain('.sim-shell--left-tower-overlay .timing-list');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('.sim-shell--left-tower-overlay .broadcast-column-head span');
    expect(css).toContain('.broadcast-column-head span:nth-child(5),\n.timing-tire');
    expect(css).toContain('grid-column: 5;');
    expect(css).toContain('max-width: 390px');
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

  test('camera reserves the broadcast gutter when the timing tower is embedded in the race canvas', () => {
    const canvasHost = {
      clientWidth: 1000,
      clientHeight: 760,
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
      ui: {},
    });

    const safeArea = app.getCameraSafeArea(1000);

    expect(safeArea.left).toBe(257);
    expect(safeArea.width).toBe(743);
  });

  test('camera does not reserve a side gutter for a full-width mobile timing board', () => {
    const canvasHost = {
      clientWidth: 420,
      clientHeight: 900,
      getBoundingClientRect() {
        return { left: 0, right: 420, top: 0, bottom: 900 };
      },
    };
    const timingTower = {
      getBoundingClientRect() {
        return { left: 0, right: 420, top: 12, bottom: 390 };
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

    const safeArea = app.getCameraSafeArea(420);
    const frame = app.getCameraFrame({
      cars: [{ id: 'alpha', x: 5000, y: 3200 }],
      raceControl: { mode: 'green' },
    }, 420, 900, 1, safeArea);

    expect(safeArea.left).toBe(0);
    expect(safeArea.width).toBe(420);
    expect(frame.screenX).toBe(210);
  });

  test('overview camera starts closer than the full-world base fit', () => {
    const app = new F1SimulatorApp(createOverlayRootStub({
      canvasHost: {
        clientWidth: 1000,
        clientHeight: 600,
        getBoundingClientRect() {
          return { left: 0, right: 1000 };
        },
      },
      timingTower: null,
    }), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'overview',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });

    const frame = app.getCameraFrame({
      cars: [{ id: 'alpha', x: 5000, y: 3200 }],
      raceControl: { mode: 'green' },
    }, 1000, 600, 1);

    expect(frame.target).toEqual({ x: 3800, y: 2300 });
    expect(frame.scale).toBe(1.6);
  });

  test('camera framing exposes more world as host containers become wider or taller', () => {
    const app = new F1SimulatorApp(createOverlayRootStub({
      canvasHost: {
        clientWidth: 500,
        clientHeight: 500,
        getBoundingClientRect() {
          return { left: 0, right: 500 };
        },
      },
      timingTower: null,
    }), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      cars: [{ id: 'alpha', x: 5000, y: 3200 }],
      raceControl: { mode: 'green' },
    };

    const squareSafeArea = app.getCameraSafeArea(500);
    const squareFrame = app.getCameraFrame(snapshot, 500, 500, 1, squareSafeArea);
    const wideSafeArea = app.getCameraSafeArea(1200);
    const wideFrame = app.getCameraFrame(snapshot, 1200, 420, 1, wideSafeArea);
    const tallSafeArea = app.getCameraSafeArea(420);
    const tallFrame = app.getCameraFrame(snapshot, 420, 900, 1, tallSafeArea);

    expect(wideSafeArea.width / wideFrame.scale).toBeGreaterThan(squareSafeArea.width / squareFrame.scale);
    expect(900 / tallFrame.scale).toBeGreaterThan(500 / squareFrame.scale);
    expect(Number.isFinite(wideFrame.screenX)).toBe(true);
    expect(Number.isFinite(tallFrame.screenY)).toBe(true);
  });

  test('caches camera safe-area layout measurements between resizes', () => {
    let canvasRectReads = 0;
    let towerRectReads = 0;
    const app = new F1SimulatorApp(createOverlayRootStub({
      canvasHost: {
        clientWidth: 1000,
        clientHeight: 600,
        getBoundingClientRect() {
          canvasRectReads += 1;
          return { left: 0, right: 1000 };
        },
      },
      timingTower: {
        getBoundingClientRect() {
          towerRectReads += 1;
          return { left: 0, right: 320 };
        },
      },
    }), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.worldLayer = {
      scale: { set: vi.fn() },
      position: { set: vi.fn() },
    };
    const snapshot = {
      cars: [{ id: 'alpha', x: 5000, y: 3200 }],
      raceControl: { mode: 'green' },
    };

    app.applyCamera(snapshot);
    app.applyCamera(snapshot);
    app.applyCamera(snapshot);
    app.invalidateCameraSafeArea();
    app.applyCamera(snapshot);

    expect(canvasRectReads).toBe(2);
    expect(towerRectReads).toBe(2);
  });

  test('skips identical text readout writes during frequent DOM updates', () => {
    let value = 'READY';
    let writeCount = 0;
    const node = {
      get textContent() {
        return value;
      },
      set textContent(nextValue) {
        writeCount += 1;
        value = nextValue;
      },
    };

    setText(node, 'READY');
    setText(node, 'GREEN');
    setText(node, 'GREEN');

    expect(writeCount).toBe(1);
    expect(value).toBe('GREEN');
  });

  test('does not rebuild static selected car overview on every telemetry refresh', () => {
    const labelNode = { textContent: '' };
    const valueNode = { textContent: '' };
    const fieldNode = {
      hidden: false,
      querySelector: vi.fn((selector) => (
        selector === '[data-overview-field-label]' ? labelNode : valueNode
      )),
    };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{
        id: 'alpha',
        name: 'Alpha Project',
        color: '#ff2d55',
        timingCode: 'ALP',
        driverNumber: 7,
        constructorArgs: {
          vehicle: { ratings: { power: 64 } },
          driver: { ratings: { pace: 72 } },
        },
      }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.overviewModeButtons = [];
    app.readouts = {
      ...app.readouts,
      selectedCode: { textContent: '', style: {} },
      selectedName: { textContent: '' },
      speed: { textContent: '' },
      throttle: { textContent: '' },
      brake: { textContent: '' },
      tyres: { textContent: '' },
      selectedDrs: { textContent: '' },
      surface: { textContent: '' },
      gap: { textContent: '' },
      leaderGap: { textContent: '' },
      carOverview: { style: { setProperty: vi.fn() } },
      carOverviewDiagram: { style: { setProperty: vi.fn() } },
      carOverviewTitle: { textContent: '' },
      carOverviewCode: { textContent: '' },
      carOverviewIcon: { textContent: '' },
      carOverviewImage: { src: '' },
      carOverviewNumber: { textContent: '' },
      carOverviewCoreStat: { textContent: '' },
      carOverviewFields: [fieldNode],
    };
    const car = {
      id: 'alpha',
      name: 'Alpha Project',
      code: 'ALP',
      color: '#ff2d55',
      driverNumber: 7,
      rank: 1,
      speedKph: 211,
      throttle: 0.82,
      brake: 0.04,
      tireEnergy: 91,
      drsActive: false,
      drsEligible: true,
      surface: 'track',
    };

    app.renderTelemetry(car);
    app.renderTelemetry({ ...car, speedKph: 214, throttle: 0.88, tireEnergy: 90 });

    expect(fieldNode.querySelector).toHaveBeenCalledTimes(2);
    expect(app.readouts.speed.textContent).toBe('214 km/h');
  });

  test('pauses the render ticker while the race canvas is offscreen', () => {
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    let observerCallback = null;
    const observedTargets = [];
    globalThis.IntersectionObserver = vi.fn(function MockIntersectionObserver(callback) {
      observerCallback = callback;
      return {
        observe: vi.fn((target) => observedTargets.push(target)),
        disconnect: vi.fn(),
      };
    });

    try {
      const canvasHost = {
        clientWidth: 1000,
        clientHeight: 600,
        getBoundingClientRect() {
          return { left: 0, right: 1000 };
        },
      };
      const app = new F1SimulatorApp({
        style: {
          setProperty: vi.fn(),
        },
        querySelector(selector) {
          if (selector === '[data-track-canvas]') return canvasHost;
          return null;
        },
        querySelectorAll() {
          return [];
        },
      }, {
        drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
        assets: DEFAULT_F1_SIMULATOR_ASSETS,
        initialCameraMode: 'leader',
        totalLaps: 10,
        seed: 1971,
        ui: {},
      });
      app.app = {
        ticker: {
          start: vi.fn(),
          stop: vi.fn(),
        },
      };
      app.accumulator = 12;
      app.nextGameFrameTime = -100;

      app.observeRuntimeVisibility();
      observerCallback([{ isIntersecting: false, intersectionRatio: 0 }]);
      observerCallback([{ isIntersecting: true, intersectionRatio: 0.15 }]);

      expect(observedTargets).toEqual([canvasHost]);
      expect(app.app.ticker.stop).toHaveBeenCalledTimes(1);
      expect(app.app.ticker.start).toHaveBeenCalledTimes(1);
      expect(app.accumulator).toBe(0);
      expect(app.nextGameFrameTime).toBeGreaterThan(app.lastTime);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
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

  test('emits lifecycle callbacks for selection, race events, laps, and finish', () => {
    const callbacks = {
      onDriverSelect: vi.fn(),
      onRaceEvent: vi.fn(),
      onLapChange: vi.fn(),
      onRaceFinish: vi.fn(),
    };
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
      totalLaps: 3,
      seed: 1971,
      ui: {},
      ...callbacks,
    });
    const baseCar = {
      ...driver,
      code: 'ALP',
      rank: 1,
      lap: 1,
      speedKph: 211,
      throttle: 0.81,
      brake: 0.12,
      tireEnergy: 93,
      drsActive: false,
      drsEligible: true,
      setup: {},
    };
    const baseSnapshot = {
      time: 1,
      totalLaps: 3,
      raceControl: { mode: 'green', start: {} },
      events: [],
      cars: [baseCar],
    };

    app.sim = { snapshot: () => baseSnapshot };
    app.selectCar('alpha', { focus: false });
    app.updateDom(baseSnapshot);
    app.updateDom({
      ...baseSnapshot,
      time: 2,
      events: [{ type: 'contact', at: 2, carId: 'alpha' }],
      cars: [{ ...baseCar, lap: 2 }],
    });
    app.updateDom({
      ...baseSnapshot,
      time: 3,
      raceControl: {
        mode: 'safety-car',
        start: {},
        finished: true,
        winner: { id: 'alpha', name: 'Alpha Project' },
        classification: [{ id: 'alpha', rank: 1 }],
      },
      events: [{ type: 'race-finish', at: 3, winnerId: 'alpha' }],
      cars: [{ ...baseCar, lap: 3, finished: true, classifiedRank: 1 }],
    });

    expect(callbacks.onDriverSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'alpha' }), expect.any(Object));
    expect(callbacks.onRaceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contact', carId: 'alpha' }),
      expect.any(Object),
    );
    expect(callbacks.onLapChange).toHaveBeenCalledWith(expect.objectContaining({
      previousLeaderLap: 1,
      leaderLap: 2,
    }));
    expect(callbacks.onRaceFinish).toHaveBeenCalledTimes(1);
    expect(callbacks.onRaceFinish).toHaveBeenCalledWith(expect.objectContaining({
      winner: expect.objectContaining({ id: 'alpha' }),
      classification: [{ id: 'alpha', rank: 1 }],
    }));
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

  test('does not replay every missed project-radio transition after a long pause', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', raceData: ['Box'] }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        raceDataBanners: { initial: 'radio', enabled: ['radio'] },
      },
    });
    app.radioState.visible = false;
    app.radioState.nextChangeAt = 0;
    app.scheduleRadioPopup = vi.fn(function scheduleRadioPopup(now) {
      this.radioState.visible = true;
      this.radioState.nextChangeAt = now + 1000;
    });
    app.scheduleRadioBreak = vi.fn(function scheduleRadioBreak(now) {
      this.radioState.visible = false;
      this.radioState.nextChangeAt = now + 1000;
    });

    app.updateRadioSchedule(600_000);

    expect(app.scheduleRadioPopup).toHaveBeenCalledTimes(1);
    expect(app.scheduleRadioBreak).not.toHaveBeenCalled();
    expect(app.radioState.nextChangeAt).toBeGreaterThan(600_000);
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
    const overview = createMarkupRoot();
    const raceData = createMarkupRoot();

    simulator.mountRaceControls(controls);
    simulator.mountTimingTower(tower);
    simulator.mountRaceCanvas(race, { includeRaceDataPanel: true });
    simulator.mountTelemetryPanel(telemetry, { includeOverview: false });
    simulator.mountCarDriverOverview(overview);
    simulator.mountRaceDataPanel(raceData);

    expect(controls.innerHTML).toContain('data-safety-car');
    expect(tower.innerHTML).toContain('data-timing-tower');
    expect(race.innerHTML).toContain('data-track-canvas');
    expect(race.innerHTML).toContain('data-race-data-panel');
    expect(telemetry.innerHTML).toContain('data-telemetry-speed');
    expect(telemetry.innerHTML).not.toContain('data-paddock-component="car-driver-overview"');
    expect(overview.innerHTML).toContain('data-paddock-component="car-driver-overview"');
    expect(overview.innerHTML).toContain('data-overview-mode="vehicle"');
    expect(overview.innerHTML).toContain('data-overview-mode="driver"');
    expect(overview.innerHTML).toContain('car-overview-cell--slot-1');
    expect(overview.innerHTML).toContain('data-overview-field');
    expect(overview.innerHTML).toContain('data-car-overview-image');
    expect(raceData.innerHTML).toContain('data-race-data-open');
    expect(simulator.querySelector('[data-track-canvas]')).toEqual({ selector: '[data-track-canvas]' });
  });

  test('marks composable mount roots as package styling scopes', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const root = {
      innerHTML: '',
      classList: {
        add: vi.fn(),
      },
      style: {
        setProperty: vi.fn(),
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };

    simulator.mountTimingTower(root);

    expect(root.classList.add).toHaveBeenCalledWith('f1-sim-component');
    expect(root.style.setProperty).toHaveBeenCalledWith(
      '--broadcast-panel-surface',
      `url('${DEFAULT_F1_SIMULATOR_ASSETS.broadcastPanel}')`,
    );
  });

  test('keeps race-data banners inside the race canvas when requested by composable hosts', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const defaultRace = createMarkupRoot();
    const bannerRace = createMarkupRoot();

    simulator.mountRaceCanvas(defaultRace);
    simulator.mountRaceCanvas(bannerRace, { includeRaceDataPanel: true });

    expect(defaultRace.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(defaultRace.innerHTML).not.toContain('data-paddock-component="race-data-panel"');
    expect(bannerRace.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(bannerRace.innerHTML).toContain('data-paddock-component="race-data-panel"');
    expect(bannerRace.innerHTML.indexOf('data-paddock-component="race-data-panel"')).toBeGreaterThan(
      bannerRace.innerHTML.indexOf('data-paddock-component="race-canvas"'),
    );
  });

  test('can embed the timing tower inside a composable race canvas with its own vertical fit mode', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      ui: {
        timingTowerVerticalFit: 'expand-race-view',
      },
    });
    const race = createMarkupRoot();

    simulator.mountRaceCanvas(race, {
      includeTimingTower: true,
      includeRaceDataPanel: true,
      timingTowerVerticalFit: 'scroll',
    });

    expect(race.innerHTML).toContain('sim-canvas-panel--with-timing-tower');
    expect(race.innerHTML).toContain('sim-canvas-panel--timing-scroll');
    expect(race.innerHTML).toContain('data-paddock-component="timing-tower"');
    expect(race.innerHTML).toContain('data-paddock-component="race-data-panel"');
    expect(race.innerHTML.indexOf('data-paddock-component="timing-tower"')).toBeGreaterThan(
      race.innerHTML.indexOf('data-paddock-component="race-canvas"'),
    );
  });

  test('renders package-owned loading placeholders for heavy mounted surfaces', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const tower = createMarkupRoot();
    const race = createMarkupRoot();
    const telemetry = createMarkupRoot();

    simulator.mountTimingTower(tower);
    simulator.mountRaceCanvas(race, { includeRaceDataPanel: true, includeTimingTower: true });
    simulator.mountTelemetryPanel(telemetry);

    expect(tower.innerHTML).toContain('data-paddock-loading');
    expect(race.innerHTML).toContain('data-paddock-loading');
    expect(telemetry.innerHTML).toContain('data-paddock-loading');
    expect(race.innerHTML).toContain('paddock-loading__lights');
  });

  test('removes component loading placeholders after the simulator runtime finishes initialization', () => {
    const removeLoading = vi.fn();
    const markLoaded = vi.fn();
    const loadingNode = {
      remove: removeLoading,
      closest(selector) {
        return selector === '[data-paddock-component]'
          ? { classList: { add: markLoaded } }
          : null;
      },
    };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-track-canvas]') {
          return {
            clientWidth: 1000,
            clientHeight: 760,
            getBoundingClientRect() {
              return { left: 0, right: 1000 };
            },
          };
        }
        return null;
      },
      querySelectorAll(selector) {
        return selector === '[data-paddock-loading]' ? [loadingNode] : [];
      },
    }, {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });

    app.completeComponentLoading();

    expect(markLoaded).toHaveBeenCalledWith('is-loaded');
    expect(removeLoading).toHaveBeenCalled();
  });

  test('timing tower css supports fixed-height contexts and embedded race-canvas fit modes', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('--timing-board-max-width: var(--paddock-timing-tower-max-width, 390px)');
    expect(css).toContain('width: min(100%, var(--timing-board-max-width));');
    expect(css).toContain('height: 100%;');
    expect(css).toContain('min-height: var(--paddock-race-view-min-height, 620px);');
    expect(css).toContain('flex: 1 1 auto;');
    expect(css).toContain('.sim-canvas-panel--with-timing-tower');
    expect(css).toContain('.sim-canvas-panel--timing-expand-race-view');
    expect(css).toContain('.sim-canvas-panel--timing-scroll .sim-timing');
    expect(css).toContain('.paddock-loading');
    expect(css).toContain('@keyframes paddock-loading-pulse');
  });

  test('package layouts include narrow-host rules for mobile and compact embeds', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('.sim-shell--left-tower-overlay .sim-timing');
    expect(css).toContain('.sim-canvas-panel--with-timing-tower > .sim-timing');
    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain('.sim-canvas-panel--with-timing-tower > .sim-timing {\n    position: static;');
    expect(css).toContain('height: min(46svh, 420px);');
    expect(css).toContain('.sim-shell--left-tower-overlay .sim-timing {\n    width: 100%;');
    expect(css).toContain('max-width: 100%;');
    expect(css).toContain('.sim-canvas-panel--with-timing-tower > .camera-controls {\n    left: 0.75rem;');
  });

  test('timing list rows stack from the top instead of stretching by entry count', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('grid-auto-rows: minmax(33px, max-content);');
    expect(css).toContain('align-content: start;');
    expect(css).toContain('justify-content: stretch;');
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
    const overview = createMarkupRoot();
    const raceData = createMarkupRoot();

    mountRaceControls(controls, simulator);
    mountCameraControls(camera, simulator);
    mountSafetyCarControl(safety, simulator);
    mountTimingTower(tower, simulator);
    mountRaceCanvas(race, simulator, { includeRaceDataPanel: true });
    mountTelemetryPanel(telemetry, simulator);
    mountCarDriverOverview(overview, simulator);
    mountRaceDataPanel(raceData, simulator);

    expect(controls.innerHTML).toContain('data-paddock-component="race-controls"');
    expect(camera.innerHTML).toContain('data-paddock-component="camera-controls"');
    expect(safety.innerHTML).toContain('data-paddock-component="safety-car-control"');
    expect(tower.innerHTML).toContain('data-paddock-component="timing-tower"');
    expect(race.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(race.innerHTML).toContain('data-paddock-component="race-data-panel"');
    expect(telemetry.innerHTML).toContain('data-paddock-component="telemetry-panel"');
    expect(overview.innerHTML).toContain('data-paddock-component="car-driver-overview"');
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
