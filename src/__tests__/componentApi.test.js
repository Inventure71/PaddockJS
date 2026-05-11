import { readFileSync } from 'node:fs';
import { Container, Texture } from 'pixi.js';
import { describe, expect, test, vi } from 'vitest';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { CarRenderer } from '../app/rendering/carRenderer.js';
import { ReplayGhostRenderer } from '../app/rendering/replayGhostRenderer.js';
import { setText } from '../app/domBindings.js';
import { DEFAULT_F1_SIMULATOR_ASSETS } from '../config/defaultAssets.js';
import { PADDOCK_SIMULATOR_PRESETS, resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import {
  createPaddockSimulator,
  mountF1Simulator,
  mountCarDriverOverview,
  mountCameraControls,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountSafetyCarControl,
  mountRaceTelemetryDrawer,
  mountTelemetrySectorBanner,
  mountTelemetryCore,
  mountTelemetryLapTimes,
  mountTelemetryPanel,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  mountTimingTower,
} from '../index.js';
import { normalizeSimulatorDrivers } from '../data/normalizeDrivers.js';
import { FIXED_STEP, createRaceSimulation } from '../simulation/raceSimulation.js';
import { WORLD } from '../simulation/trackModel.js';
import {
  createCameraControlsMarkup,
  createRaceDataPanelMarkup,
  createRaceTelemetryDrawerMarkup,
  createTelemetryCoreMarkup,
  createTelemetryLapTimesMarkup,
  createTelemetryPanelMarkup,
  createTelemetrySectorBannerMarkup,
  createTelemetrySectorTimesMarkup,
  createTelemetrySectorsMarkup,
  createTimingTowerMarkup,
} from '../ui/componentTemplates.js';
import { createF1SimulatorShell } from '../ui/shellTemplate.js';

const HEAVY_INTEGRATION_TEST_TIMEOUT_MS = 15000;

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

function createClassListStub(initial = []) {
  const values = new Set(initial);
  return {
    add: vi.fn((...classes) => classes.forEach((item) => values.add(item))),
    remove: vi.fn((...classes) => classes.forEach((item) => values.delete(item))),
    contains: vi.fn((item) => values.has(item)),
    toggle: vi.fn((item, force) => {
      const next = force ?? !values.has(item);
      if (next) values.add(item);
      else values.delete(item);
      return next;
    }),
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
  test('replay ghost renderer draws translucent non-interactive overlays without car hit areas', () => {
    const layer = new Container();
    const renderer = new ReplayGhostRenderer();

    renderer.render({
      replayGhosts: [
        {
          id: 'best-lap',
          label: 'Best Lap',
          color: '#00ff84',
          opacity: 0.35,
          visible: true,
          x: 100,
          y: 200,
          heading: 0.4,
        },
      ],
    }, {
      textures: { car: Texture.WHITE },
      replayGhostLayer: layer,
    });

    const sprite = renderer.sprites.get('best-lap');
    const label = renderer.labels.get('best-lap');
    const halo = renderer.halos.get('best-lap');
    expect(sprite).toEqual(expect.objectContaining({
      x: 100,
      y: 200,
      alpha: 0.35,
      eventMode: 'none',
    }));
    expect(halo).toEqual(expect.objectContaining({
      x: 100,
      y: 200,
      eventMode: 'none',
      ghostVisualRole: 'replay-halo',
    }));
    expect(label.text).toBe('Best Lap');
    expect(layer.children).toContain(halo);
    expect(layer.children).toContain(sprite);
    expect(layer.children).toContain(label);
  });

  test('car renderer marks non-colliding participants without changing normal car hit behavior', () => {
    const layer = new Container();
    const carSprites = new Map();
    const carHitAreas = new Map();
    const serviceCountdownLabels = new Map();
    const onSelectCar = vi.fn();
    const renderer = new CarRenderer({
      carSprites,
      carHitAreas,
      serviceCountdownLabels,
      onSelectCar,
    });

    renderer.createCars({
      drivers: [
        { id: 'model-a', color: '#ff2d55' },
        { id: 'model-b', color: '#39a7ff' },
      ],
      textures: { car: Texture.WHITE },
      carLayer: layer,
    });

    renderer.renderCars({
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
      cars: [
        {
          id: 'model-a',
          color: '#ff2d55',
          x: 100,
          y: 120,
          heading: 0.35,
          drsActive: false,
          pitStop: null,
          interaction: { collidable: false },
        },
        {
          id: 'model-b',
          color: '#39a7ff',
          x: 220,
          y: 260,
          heading: -0.2,
          drsActive: false,
          pitStop: null,
          interaction: { collidable: true },
        },
      ],
    }, {
      textures: {},
      carLayer: layer,
    });

    const nonCollidingMarker = renderer.nonCollidingMarkers.get('model-a');
    const normalMarker = renderer.nonCollidingMarkers.get('model-b');
    expect(nonCollidingMarker).toEqual(expect.objectContaining({
      visible: true,
      x: 100,
      y: 120,
      rotation: 0.35,
      eventMode: 'none',
      interactionVisualRole: 'non-colliding-marker',
    }));
    expect(normalMarker.visible).toBe(false);
    expect(carSprites.get('model-a').eventMode).toBe('static');
    expect(carHitAreas.get('model-a').eventMode).toBe('static');
  });

  test('browser runtime render snapshots expose the fields consumed by mounted UI surfaces', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers: [
        { id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' },
        { id: 'beta', name: 'Beta Project', color: '#39a7ff', timingCode: 'BET' },
      ],
      rules: { standingStart: false, ruleset: 'fia2025' },
    });
    sim.step(FIXED_STEP);

    const render = sim.snapshotRender();
    const car = render.cars[0];

    expect(render).toEqual(expect.objectContaining({
      time: expect.any(Number),
      world: expect.any(Object),
      track: expect.objectContaining({
        samples: expect.any(Array),
        pitLane: expect.any(Object),
        drsZones: expect.any(Array),
      }),
      totalLaps: expect.any(Number),
      raceControl: expect.objectContaining({
        mode: expect.any(String),
        redFlag: expect.any(Boolean),
        pitLaneOpen: expect.any(Boolean),
        pitLaneStatus: expect.any(Object),
        finished: expect.any(Boolean),
        start: expect.any(Object),
      }),
      pitLaneStatus: expect.any(Object),
      safetyCar: expect.objectContaining({
        deployed: expect.any(Boolean),
        x: expect.any(Number),
        y: expect.any(Number),
        heading: expect.any(Number),
      }),
      cars: expect.any(Array),
    }));
    expect(car).toEqual({
      id: expect.any(String),
      color: expect.any(String),
      previousX: expect.any(Number),
      previousY: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
      previousHeading: expect.any(Number),
      heading: expect.any(Number),
      drsActive: expect.any(Boolean),
      pitStop: expect.objectContaining({
        phase: null,
        serviceRemainingSeconds: 0,
        penaltyServiceRemainingSeconds: 0,
      }),
      interaction: expect.objectContaining({
        profile: 'normal',
        collidable: true,
      }),
    });
    expect(car).not.toHaveProperty('setup');
    expect(car).not.toHaveProperty('lapTelemetry');
    expect(car).not.toHaveProperty('wheels');
  });

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

  test('rejects duplicate host driver ids before creating runtime maps', () => {
    expect(() => normalizeSimulatorDrivers([
      { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
      { id: 'alpha', name: 'Alpha Duplicate', color: '#39a7ff' },
    ], {
      entries: [],
    })).toThrow('Duplicate simulator driver id: alpha');
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
      html.indexOf('data-paddock-component="telemetry-stack"'),
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
    expect(html).toContain('data-tower-race-control-kicker');
    expect(html).toContain('data-tower-race-control-title');
    expect(html).toContain('data-tower-race-control-banner');
    expect(html).toContain('hidden');
    expect(html).not.toContain('broadcast-safety-banner');
    expect(html).not.toContain('Safety Car</strong>');
  });

  test('timing tower race-control banner switches from safety car to red flag', () => {
    const banner = {
      hidden: true,
      classList: createClassListStub(),
    };
    const timingTower = {
      classList: createClassListStub(),
    };
    const mode = { textContent: '', style: {} };
    const drs = { textContent: '' };
    const kicker = { textContent: '' };
    const title = { textContent: '' };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.readouts = {
      ...app.readouts,
      mode,
      drs,
      timingTower,
      towerRaceControlBanner: banner,
      towerRaceControlKicker: kicker,
      towerRaceControlTitle: title,
    };
    app.renderTelemetry = vi.fn();
    app.renderRaceFinish = vi.fn();
    app.renderStartLights = vi.fn();
    app.renderActiveStewardMessage = vi.fn();
    app.renderProjectRadio = vi.fn();
    app.updateCameraControls = vi.fn();
    app.syncTimingGapModeControls = vi.fn();
    app.syncSafetyCarControls = vi.fn();
    app.emitSnapshotLifecycle = vi.fn();
    app.renderTiming = vi.fn();
    const car = {
      id: 'alpha',
      rank: 1,
      lap: 1,
      code: 'ALP',
      timingCode: 'ALP',
      name: 'Alpha Project',
      color: '#ff2d55',
      tire: 'M',
    };

    app.updateDom({
      time: 1,
      totalLaps: 10,
      raceControl: { mode: 'red-flag', start: {} },
      events: [],
      penalties: [],
      cars: [car],
    });

    expect(banner.hidden).toBe(false);
    expect(kicker.textContent).toBe('FIA');
    expect(title.textContent).toBe('Red Flag');
    expect(mode.textContent).toBe('RED');
    expect(mode.style.color).toBe('var(--race-control-red)');
    expect(drs.textContent).toBe('DISABLED');
    expect(banner.classList.toggle).toHaveBeenCalledWith('is-red-flag', true);
    expect(timingTower.classList.toggle).toHaveBeenCalledWith('is-red-flag', true);
  });

  test('camera controls expose the pit camera mode', () => {
    const html = createCameraControlsMarkup();

    expect(html).toContain('data-camera-mode="pit"');
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
      { id: 'charlie', rank: 3, code: 'CHR', timingCode: 'CHR', name: 'Charlie Project', color: '#14c784', tire: 'S', intervalAheadLaps: 1, leaderGapLaps: 2, intervalAheadSeconds: Infinity, leaderGapSeconds: Infinity },
    ];

    app.bindControls();
    app.renderTiming(cars, 'green');
    expect(timingList.innerHTML).toContain('+1');
    expect(timingList.innerHTML).not.toContain('+2 LAPS');
    expect(timingList.innerHTML).toContain('timing-team-icon');
    expect(timingList.innerHTML).toContain('AP');

    const switchToLeader = leaderButton.addEventListener.mock.calls.find(([type]) => type === 'click')[1];
    app.sim = { snapshot: () => ({ cars, raceControl: { mode: 'green' } }) };
    switchToLeader();

    expect(timingList.innerHTML).toContain('+2');
    expect(timingList.innerHTML).not.toContain('+1 LAP');
    expect(leaderButton.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
  });

  test('timing tower renders opt-in penalty badges from the penalty ledger', () => {
    const timingList = { innerHTML: '' };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-timing-list]') return timingList;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    }, {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', code: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        timingPenaltyBadges: true,
      },
    });

    app.renderTiming([{
      id: 'alpha',
      rank: 1,
      code: 'ALP',
      timingCode: 'ALP',
      name: 'Alpha Project',
      color: '#ff2d55',
      tire: 'M',
    }], 'green', [{
      id: 'penalty-1',
      type: 'collision',
      driverId: 'alpha',
      penaltySeconds: 5,
      consequences: [{ type: 'time', seconds: 5 }],
    }]);

    expect(timingList.innerHTML).toContain('timing-penalty-badge');
    expect(timingList.innerHTML).toContain('Penalty: 5s collision');
  });

  test('timing tower shows waved flag status for cars that finished before race completion', () => {
    const timingList = { innerHTML: '' };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-timing-list]') return timingList;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    }, {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.timingList = timingList;

    app.renderTiming([
      {
        id: 'alpha',
        rank: 1,
        code: 'ALP',
        timingCode: 'ALP',
        name: 'Alpha Project',
        color: '#ff2d55',
        tire: 'M',
        raceStatus: 'waved-flag',
        wavedFlag: true,
      },
    ], 'green');

    expect(timingList.innerHTML).toContain('WAVED');
  });

  test('timing tower does not render penalty badges for warning-only events', () => {
    const timingList = { innerHTML: '' };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', code: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        timingPenaltyBadges: true,
      },
    });
    app.timingList = timingList;

    app.renderTiming([{
      id: 'alpha',
      rank: 1,
      code: 'ALP',
      timingCode: 'ALP',
      name: 'Alpha Project',
      color: '#ff2d55',
      tire: 'M',
    }], 'green', []);

    expect(timingList.innerHTML).not.toContain('timing-penalty-badge');
    expect(timingList.innerHTML).not.toContain('Penalty:');
  });

  test('steward message renders opt-in penalty content above the race view', () => {
    const panel = {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
      style: {
        setProperty: vi.fn(),
      },
      dataset: {},
    };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', code: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        penaltyBanners: true,
      },
    });
    app.readouts = {
      ...app.readouts,
      stewardMessage: panel,
      stewardMessageKicker: { textContent: '' },
      stewardMessageTitle: { textContent: '' },
      stewardMessageDetail: { textContent: '' },
    };

    app.activeStewardMessage = {
      message: app.createPenaltyStewardMessage({
        id: 'penalty-1',
        type: 'track-limits',
        driverId: 'alpha',
        penaltySeconds: 10,
        consequences: [{ type: 'time', seconds: 10 }],
        reason: 'Exceeded track limits',
      }),
      visibleUntil: performance.now() + 1000,
    };
    app.renderActiveStewardMessage();

    expect(app.readouts.stewardMessageKicker.textContent).toBe('+10s');
    expect(app.readouts.stewardMessageTitle.textContent).toBe('ALP time penalty');
    expect(app.readouts.stewardMessageDetail.textContent).toBe('Track Limits - Exceeded track limits');
    expect(panel.classList.add).toHaveBeenCalledWith('is-penalty');
  });

  test('steward message styling keeps penalty size readable', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.steward-message.is-penalty {\n  --steward-panel-bg:');
    expect(css).toContain('.steward-message.is-warning {\n  --steward-panel-bg:');
    expect(css).toContain('.steward-message__kicker {\n  grid-row: span 2;');
    expect(css).toContain('font-size: 1.05rem;');
    expect(css).toContain('background: var(--steward-chip-bg);');
    expect(css).toContain('white-space: normal;');
    expect(css).not.toContain('.race-data-panel.is-penalty-mode');
  });

  test('steward message renders track-limit warnings before penalties', () => {
    const panel = {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
      style: {
        setProperty: vi.fn(),
      },
    };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', code: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        penaltyBanners: true,
      },
    });
    app.readouts = {
      ...app.readouts,
      stewardMessage: panel,
      stewardMessageKicker: { textContent: '' },
      stewardMessageTitle: { textContent: '' },
      stewardMessageDetail: { textContent: '' },
    };

    app.updateStewardMessageState({
      events: [{
        type: 'track-limits',
        decision: 'warning',
        carId: 'alpha',
        violationCount: 2,
        warningsBeforePenalty: 3,
        at: 12,
      }],
      penalties: [],
    });
    app.renderActiveStewardMessage();

    expect(app.readouts.stewardMessageKicker.textContent).toBe('Warning');
    expect(app.readouts.stewardMessageTitle.textContent).toBe('ALP track limits');
    expect(app.readouts.stewardMessageDetail.textContent).toBe('Track Limits 2/3');
    expect(panel.classList.add).toHaveBeenCalledWith('is-warning');
  });

  test('race-data panel no longer receives steward penalty messages', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', code: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        penaltyBanners: true,
      },
    });

    const message = app.createPenaltyStewardMessage({
      type: 'track-limits',
      driverId: 'alpha',
      penaltySeconds: 10,
      consequences: [{ type: 'time', seconds: 10 }],
      reason: 'Exceeded track limits',
    });

    expect(message.kicker).toBe('+10s');
    expect(message.title).toBe('ALP time penalty');
  });

  test('passes configured rules from mounted app options into the simulation', () => {
    const app = new F1SimulatorApp(createRootStub(null), resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', code: 'ALP' }],
      rules: {
        standingStart: false,
        ruleset: 'custom',
        modules: {
          penalties: {
            tireRequirement: {
              strictness: 1,
              consequences: [{ type: 'time', seconds: 10 }],
            },
          },
        },
      },
    }));

    const snapshot = app.createRaceSimulation().snapshot();

    expect(snapshot.raceControl.mode).toBe('green');
    expect(snapshot.rules.ruleset).toBe('custom');
    expect(snapshot.rules.modules.penalties.tireRequirement).toMatchObject({
      strictness: 1,
      timePenaltySeconds: 10,
      consequences: [{ type: 'time', seconds: 10 }],
    });
  }, 10000);

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

  test('telemetry components are detached package surfaces and the panel is only a stack template', () => {
    const options = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const coreHtml = createTelemetryCoreMarkup(options);
    const sectorsHtml = createTelemetrySectorsMarkup(options);
    const lapTimesHtml = createTelemetryLapTimesMarkup(options);
    const sectorTimesHtml = createTelemetrySectorTimesMarkup(options);
    const sectorBannerHtml = createTelemetrySectorBannerMarkup(options);
    const html = createTelemetryPanelMarkup(options);

    expect(coreHtml).toContain('data-paddock-component="telemetry-core"');
    expect(coreHtml).toContain('data-telemetry-speed');
    expect(coreHtml).not.toContain('data-telemetry-sector-strip');
    expect(sectorsHtml).toContain('data-paddock-component="telemetry-sectors"');
    expect(sectorsHtml).toContain('data-telemetry-sector-strip');
    expect(lapTimesHtml).toContain('data-paddock-component="telemetry-lap-times"');
    expect(lapTimesHtml).toContain('data-telemetry-lap-table');
    expect(sectorTimesHtml).toContain('data-paddock-component="telemetry-sector-times"');
    expect(sectorTimesHtml).toContain('data-telemetry-sector-table');
    expect(sectorBannerHtml).toContain('data-paddock-component="telemetry-sector-banner"');
    expect(sectorBannerHtml).toContain('data-telemetry-sector-banner');

    expect(html).toContain('data-paddock-component="telemetry-stack"');
    expect(html).toContain('data-paddock-component="telemetry-core"');
    expect(html).toContain('data-paddock-component="telemetry-sectors"');
    expect(html).toContain('data-paddock-component="telemetry-lap-times"');
    expect(html).toContain('data-paddock-component="telemetry-sector-times"');

    const sectorsOnly = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      ui: {
        telemetryModules: ['sectors'],
      },
    });
    const sectorsOnlyHtml = createTelemetryPanelMarkup(sectorsOnly);

    expect(sectorsOnlyHtml).not.toContain('data-paddock-component="telemetry-core"');
    expect(sectorsOnlyHtml).toContain('data-telemetry-sector-strip');
    expect(sectorsOnlyHtml).not.toContain('data-telemetry-lap-table');
    expect(sectorsOnlyHtml).not.toContain('data-telemetry-sector-table');

    const compact = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      ui: {
        telemetryModules: {
          sectors: false,
          sectorTimes: false,
        },
      },
    });
    const compactHtml = createTelemetryPanelMarkup(compact);

    expect(compactHtml).toContain('data-paddock-component="telemetry-core"');
    expect(compactHtml).not.toContain('data-telemetry-sector-strip');
    expect(compactHtml).toContain('data-telemetry-lap-table');
    expect(compactHtml).not.toContain('data-telemetry-sector-table');
  });

  test('race telemetry drawer template combines race window with detached telemetry surfaces', () => {
    const options = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const html = createRaceTelemetryDrawerMarkup(options, { raceDataTelemetryDetail: true });

    expect(html).toContain('data-paddock-component="race-telemetry-drawer"');
    expect(html).toContain('data-paddock-component="race-canvas"');
    expect(html).toContain('data-paddock-component="timing-tower"');
    expect(html).toContain('data-paddock-component="race-data-panel"');
    expect(html).toContain('data-race-data-telemetry');
    expect(html).not.toContain('data-paddock-component="telemetry-sector-banner"');
    expect(html).toContain('data-telemetry-drawer-toggle');
    expect(html).toContain('data-safety-car');
    expect(html).toContain('data-simulation-speed');
    expect(html).toContain('race-telemetry-drawer__controls');
    expect(html).toContain('data-telemetry-drawer');
    expect(html).not.toContain('telemetry-drawer__header');
    expect(html).toContain('data-paddock-component="telemetry-stack"');
    expect(html).not.toContain('Live telemetry');
    expect(html).not.toContain('data-telemetry-drawer-close');
    expect(html).toContain('data-paddock-component="telemetry-core"');
    expect(html).toContain('data-paddock-component="telemetry-sectors"');
    expect(html).toContain('data-paddock-component="telemetry-lap-times"');
    expect(html).toContain('data-paddock-component="telemetry-sector-times"');
    expect(html).not.toContain('data-paddock-component="telemetry-panel"');
  });

  test('race telemetry drawer follows the explicit telemetry-detail option', () => {
    const options = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const defaultHtml = createRaceTelemetryDrawerMarkup(options);
    const enabledHtml = createRaceTelemetryDrawerMarkup(options, { raceDataTelemetryDetail: true });
    const disabledHtml = createRaceTelemetryDrawerMarkup(options, { raceDataTelemetryDetail: false });

    expect(defaultHtml).not.toContain('data-race-data-telemetry');
    expect(enabledHtml).toContain('data-race-data-telemetry');
    expect(disabledHtml).not.toContain('data-race-data-telemetry');
  });

  test('race data panel can include project telemetry detail without becoming a separate popup', () => {
    const standardHtml = createRaceDataPanelMarkup({
      ui: { raceDataTelemetryDetail: false },
    });
    const telemetryHtml = createRaceDataPanelMarkup({
      ui: { raceDataTelemetryDetail: true },
    });

    expect(standardHtml).toContain('data-paddock-component="race-data-panel"');
    expect(standardHtml).not.toContain('data-race-data-telemetry');
    expect(telemetryHtml).toContain('race-data-panel--with-telemetry');
    expect(telemetryHtml).toContain('data-race-data-telemetry');
    expect(telemetryHtml).toContain('data-telemetry-sector-bar="1"');
    expect(telemetryHtml).toContain('data-telemetry-sector-time="3"');
    expect(telemetryHtml).not.toContain('data-paddock-component="telemetry-sector-banner"');
  });

  test('banner markup is owned by a focused banner template module', () => {
    const componentTemplates = readFileSync(new URL('../ui/componentTemplates.js', import.meta.url), 'utf8');

    expect(componentTemplates).toContain("from './bannerTemplates.js'");
    expect(componentTemplates).toContain("from './raceControlStatusBanner.js'");
    expect(componentTemplates).not.toContain('function createRaceDataTelemetryMarkup');
    expect(componentTemplates).not.toContain('export function createTelemetrySectorBannerMarkup');
    expect(componentTemplates).not.toContain('export function createStewardMessageMarkup');
    expect(componentTemplates).not.toContain('broadcast-safety-banner');
  });

  test('race telemetry drawer instances receive unique accessible drawer ids', () => {
    const options = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const first = createRaceTelemetryDrawerMarkup(options);
    const second = createRaceTelemetryDrawerMarkup(options);
    const firstDrawerId = first.match(/id="([^"]+)"/)?.[1];
    const secondDrawerId = second.match(/id="([^"]+)"/)?.[1];

    expect(firstDrawerId).toMatch(/^paddock-telemetry-drawer-/);
    expect(secondDrawerId).toMatch(/^paddock-telemetry-drawer-/);
    expect(firstDrawerId).not.toBe(secondDrawerId);
    expect(first).toContain(`aria-controls="${firstDrawerId}"`);
    expect(second).toContain(`aria-controls="${secondDrawerId}"`);
  });

  test('simulation speed control is optional outside the race workbench', () => {
    const standardHtml = createCameraControlsMarkup();
    const explicitHtml = createCameraControlsMarkup({ showSimulationSpeed: true });
    const optionsHtml = createCameraControlsMarkup({ ui: { simulationSpeedControl: true } });

    expect(standardHtml).not.toContain('data-simulation-speed');
    expect(explicitHtml).toContain('data-simulation-speed');
    expect(optionsHtml).toContain('data-simulation-speed');
  });

  test('race canvas can render the sector graph as a broadcast lower-third banner', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const race = createMarkupRoot();

    simulator.mountRaceCanvas(race, {
      includeRaceDataPanel: true,
      includeTelemetrySectorBanner: true,
    });

    expect(race.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(race.innerHTML).toContain('data-paddock-component="race-data-panel"');
    expect(race.innerHTML).toContain('data-paddock-component="telemetry-sector-banner"');
    expect(race.innerHTML).toContain('data-telemetry-sector-banner');
    expect(race.innerHTML).toContain('data-selected-name');
    expect(race.innerHTML).toContain('data-selected-code');
  });

  test('sector banner shows selected car identity and receives the selected car color', () => {
    const banner = { style: { setProperty: vi.fn() } };
    const selectedCode = { textContent: '', style: {} };
    const selectedName = { textContent: '' };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.readouts = {
      ...app.readouts,
      telemetrySectorBanners: [banner],
      selectedCode: [selectedCode],
      selectedName: [selectedName],
      speed: [],
      throttle: [],
      brake: [],
      tyres: [],
      selectedDrs: [],
      surface: [],
      gap: [],
      leaderGap: [],
    };

    app.renderTelemetry({
      id: 'alpha',
      name: 'Alpha Project',
      code: 'ALP',
      color: '#ff2d55',
      rank: 1,
      speedKph: 211,
      throttle: 0.82,
      brake: 0.04,
      tireEnergy: 91,
      drsActive: false,
      drsEligible: true,
      surface: 'track',
    });

    expect(selectedCode.textContent).toBe('ALP');
    expect(selectedName.textContent).toBe('Alpha Project');
    expect(selectedCode.style.color).toBe('#ff2d55');
    expect(banner.style.setProperty).toHaveBeenCalledWith('--driver-color', '#ff2d55');
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

  test('normalizes initial camera mode to supported runtime modes', () => {
    const showAll = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      initialCameraMode: 'show-all',
    });
    const pit = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      initialCameraMode: 'pit',
    });
    const invalid = resolveF1SimulatorOptions({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      initialCameraMode: 'sidepod',
    });

    expect(showAll.initialCameraMode).toBe('show-all');
    expect(pit.initialCameraMode).toBe('pit');
    expect(invalid.initialCameraMode).toBe('leader');
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

  test('restart with a new track seed rebuilds the procedural track deterministically', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      trackSeed: 10101,
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.sim = app.createRaceSimulation();
    app.drsLayer = new Container();
    app.trackAsset = { render: vi.fn() };
    app.updateDom = vi.fn();

    const initialSignature = app.sim.snapshot().track.centerlineControls
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join('|');

    app.restart({ trackSeed: 20 });

    const restarted = app.getSnapshot();
    const restartedSignature = restarted.track.centerlineControls
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join('|');

    const expected = createRaceSimulation({
      seed: 1971,
      trackSeed: 20,
      drivers: app.drivers,
      totalLaps: 10,
    }).snapshot();
    const expectedSignature = expected.track.centerlineControls
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join('|');

    expect(app.trackSeed).toBe(20);
    expect(restartedSignature).toBe(expectedSignature);
    expect(restartedSignature).not.toBe(initialSignature);
  }, HEAVY_INTEGRATION_TEST_TIMEOUT_MS);

  test('restart rejects asset changes because texture loading is an initialization boundary', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });

    expect(() => app.restart({
      assets: { car: '/next-car.png' },
    })).toThrow('PaddockJS restart() does not support changing assets');
  });

  test('restart rejects expert changes because expert mode is a mount-time boundary', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
      expert: {
        enabled: false,
        controlledDrivers: ['alpha'],
      },
    });

    expect(() => app.restart({
      expert: {
        enabled: true,
        controlledDrivers: ['alpha'],
      },
    })).toThrow('PaddockJS restart() does not support changing expert mode');
  });

  test('rerendering the track destroys old DRS graphics before adding new ones', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.sim = createRaceSimulation({
      seed: 1971,
      trackSeed: 10101,
      drivers: app.drivers,
      totalLaps: 10,
    });
    app.drsLayer = new Container();
    app.trackAsset = { render: vi.fn() };

    app.renderTrack();
    const oldChildren = [...app.drsLayer.children];
    const destroySpies = oldChildren.map((child) => vi.spyOn(child, 'destroy'));

    app.renderTrack();

    expect(oldChildren.length).toBeGreaterThan(0);
    destroySpies.forEach((spy) => {
      expect(spy).toHaveBeenCalledWith({ children: true, texture: false, textureSource: false });
    });
  });

  test('renders small countdown labels above cars during pit penalty and tire service', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.carLayer = new Container();
    app.textures.car = Texture.WHITE;
    app.createCars();

    app.renderCars({
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
      cars: [{
        id: 'alpha',
        x: 1200,
        y: 900,
        heading: 0,
        color: '#ff2d55',
        pitStop: {
          phase: 'penalty',
          penaltyServiceRemainingSeconds: 4.4,
        },
      }],
    });

    const label = app.serviceCountdownLabels.get('alpha');
    expect(label.visible).toBe(true);
    expect(label.x).toBe(1200);
    expect(label.y).toBeLessThan(900);
    expect(label.children.some((child) => child.text === '+5s')).toBe(true);

    app.renderCars({
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
      cars: [{
        id: 'alpha',
        x: 1200,
        y: 900,
        heading: 0,
        color: '#ff2d55',
        pitStop: {
          phase: 'service',
          serviceRemainingSeconds: 2.2,
          penaltyServiceRemainingSeconds: 0,
        },
      }],
    });

    expect(label.visible).toBe(true);
    expect(label.x).toBe(1200);
    expect(label.y).toBeLessThan(900);
    expect(label.serviceTone).toBe('pit');
    expect(label.children.some((child) => child.text === '3s')).toBe(true);

    app.renderCars({
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
      cars: [{
        id: 'alpha',
        x: 1200,
        y: 900,
        heading: 0,
        color: '#ff2d55',
        pitStop: {
          phase: 'exit',
          serviceRemainingSeconds: 0,
          penaltyServiceRemainingSeconds: 0,
        },
      }],
    });

    expect(label.visible).toBe(false);
  });

  test('renderCars avoids repeated scale and tint writes when car visual state is unchanged', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const sprite = {
      x: 0,
      y: 0,
      rotation: 0,
      currentRotation: 0,
      alpha: 1,
      tint: 0xffffff,
      baseScale: 1,
      scale: { set: vi.fn() },
    };
    app.carSprites.set('alpha', sprite);
    app.carHitAreas.set('alpha', { x: 0, y: 0 });
    app.serviceCountdownLabels.set('alpha', { visible: false });
    const snapshot = {
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
      cars: [{
        id: 'alpha',
        x: 1200,
        y: 900,
        heading: 0,
        color: '#ff2d55',
      }],
    };

    app.renderCars(snapshot);
    app.renderCars(snapshot);

    expect(sprite.scale.set).toHaveBeenCalledTimes(1);
  });

  test('normal sprite render mode smooths heading and applies driver tint', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const sprite = {
      x: 0,
      y: 0,
      rotation: 0,
      currentRotation: 0,
      alpha: 1,
      tint: 0xffffff,
      baseScale: 1,
      lastRenderedScale: 1,
      scale: { set: vi.fn() },
    };
    app.carSprites.set('alpha', sprite);
    app.carHitAreas.set('alpha', { x: 0, y: 0 });
    app.serviceCountdownLabels.set('alpha', { visible: false });

    app.renderCars({
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
      cars: [{
        id: 'alpha',
        x: 1200,
        y: 900,
        heading: 1.1,
        color: '#ff2d55',
      }],
    });

    expect(sprite.rotation).toBeCloseTo(1.1 * 0.24);
    expect(sprite.currentRotation).toBeCloseTo(1.1 * 0.24);
    expect(sprite.tint).toBe(0xff2d55);
  });

  test('default browser playback advances simulation at real-time scale', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      time: 0,
      events: [],
      cars: [],
      track: { drsZones: [] },
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
    };
    const now = 1000;
    const performanceSpy = vi.spyOn(performance, 'now').mockReturnValue(now);
    const step = vi.fn();
    app.sim = {
      step,
      snapshot: vi.fn(() => snapshot),
    };
    app.nextGameFrameTime = now;
    app.accumulator = 0;
    app.lastDomUpdateTime = now;
    app.emitSnapshotLifecycle = vi.fn();
    app.applyCamera = vi.fn();
    app.renderDrsTrails = vi.fn();
    app.renderPitLaneStatus = vi.fn();
    app.renderCars = vi.fn();
    app.updateDom = vi.fn();

    app.tick();

    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(FIXED_STEP);
    performanceSpy.mockRestore();
  });

  test('simulation speed button cycles browser playback from 1x through 10x', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const button = {
      textContent: '',
      setAttribute: vi.fn(),
    };
    app.simulationSpeedButtons = [button];

    expect(app.cycleSimulationSpeed()).toBe(2);
    expect(button.textContent).toBe('2x');
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-label', 'Simulation speed 2x');
    expect(app.cycleSimulationSpeed()).toBe(3);
    expect(app.cycleSimulationSpeed()).toBe(4);
    expect(app.cycleSimulationSpeed()).toBe(5);
    expect(app.cycleSimulationSpeed()).toBe(10);
    expect(button.textContent).toBe('10x');
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-label', 'Simulation speed 10x');
    expect(app.cycleSimulationSpeed()).toBe(1);
    expect(button.textContent).toBe('1x');
  });

  test('browser playback uses the selected simulation speed multiplier', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      time: 0,
      events: [],
      cars: [],
      track: { drsZones: [] },
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
    };
    const now = 1000;
    const performanceSpy = vi.spyOn(performance, 'now').mockReturnValue(now);
    const step = vi.fn();
    app.sim = {
      step,
      snapshot: vi.fn(() => snapshot),
    };
    app.simulationSpeed = 2;
    app.nextGameFrameTime = now;
    app.accumulator = 0;
    app.lastDomUpdateTime = now;
    app.emitSnapshotLifecycle = vi.fn();
    app.applyCamera = vi.fn();
    app.renderDrsTrails = vi.fn();
    app.renderPitLaneStatus = vi.fn();
    app.renderCars = vi.fn();
    app.updateDom = vi.fn();

    app.tick();

    expect(step).toHaveBeenCalledTimes(2);
    expect(step).toHaveBeenNthCalledWith(1, FIXED_STEP);
    expect(step).toHaveBeenNthCalledWith(2, FIXED_STEP);
    performanceSpy.mockRestore();
  });

  test('browser playback can execute the full 10x fixed-step budget in one render frame', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      time: 0,
      events: [],
      cars: [],
      track: { drsZones: [] },
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
    };
    const now = 1000;
    const performanceSpy = vi.spyOn(performance, 'now').mockReturnValue(now);
    const step = vi.fn();
    app.sim = {
      step,
      snapshot: vi.fn(() => snapshot),
    };
    app.simulationSpeed = 10;
    app.nextGameFrameTime = now;
    app.accumulator = 0;
    app.lastDomUpdateTime = now;
    app.emitSnapshotLifecycle = vi.fn();
    app.applyCamera = vi.fn();
    app.renderDrsTrails = vi.fn();
    app.renderPitLaneStatus = vi.fn();
    app.renderCars = vi.fn();
    app.updateDom = vi.fn();

    app.tick();

    expect(step).toHaveBeenCalledTimes(10);
    performanceSpy.mockRestore();
  });

  test('browser playback avoids full per-step snapshots while still emitting step events', () => {
    const onRaceEvent = vi.fn();
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      onRaceEvent,
      ui: {},
    });
    const snapshot = {
      time: 1,
      events: [],
      cars: [{ id: 'alpha', lap: 1 }],
      track: { drsZones: [] },
      raceControl: { mode: 'green', start: {} },
      safetyCar: { deployed: false },
      penalties: [],
    };
    const now = 1000;
    const performanceSpy = vi.spyOn(performance, 'now').mockReturnValue(now);
    const step = vi.fn();
    const sim = {
      events: [],
      step: vi.fn(() => {
        step();
        sim.events = step.mock.calls.length === 2
          ? [{ type: 'contact', at: 1, carId: 'alpha' }]
          : [];
      }),
      snapshot: vi.fn(() => snapshot),
    };
    app.sim = sim;
    app.simulationSpeed = 3;
    app.nextGameFrameTime = now;
    app.accumulator = 0;
    app.lastDomUpdateTime = now;
    app.applyCamera = vi.fn();
    app.renderDrsTrails = vi.fn();
    app.renderPitLaneStatus = vi.fn();
    app.renderCars = vi.fn();
    app.updateDom = vi.fn();

    app.tick();

    expect(sim.step).toHaveBeenCalledTimes(3);
    expect(sim.snapshot).toHaveBeenCalledTimes(1);
    expect(onRaceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contact', carId: 'alpha' }),
      snapshot,
    );
    performanceSpy.mockRestore();
  });

  test('updateDom skips timing markup work before the timing interval when order and penalties are unchanged', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.readouts = {};
    app.renderTelemetry = vi.fn();
    app.renderRaceFinish = vi.fn();
    app.renderStartLights = vi.fn();
    app.renderActiveStewardMessage = vi.fn();
    app.renderProjectRadio = vi.fn();
    app.updateCameraControls = vi.fn();
    app.syncTimingGapModeControls = vi.fn();
    app.syncSafetyCarControls = vi.fn();
    app.updateStewardMessageState = vi.fn();
    app.emitSnapshotLifecycle = vi.fn();
    app.renderTiming = vi.fn();
    app.lastTimingRenderTime = performance.now();
    app.lastTimingRaceMode = 'green';
    app.lastTimingPenaltyKey = '';
    app.lastTimingOrderKey = 'alpha:1:1:--:0:0:0::0:M';

    app.updateDom({
      time: 1,
      totalLaps: 10,
      raceControl: { mode: 'green', start: {} },
      safetyCar: { deployed: false },
      events: [],
      penalties: [],
      cars: [{
        id: 'alpha',
        rank: 1,
        lap: 1,
        code: 'ALP',
        timingCode: 'ALP',
        name: 'Alpha Project',
        color: '#ff2d55',
        tire: 'M',
        speedKph: 120,
        throttle: 0,
        brake: 0,
        setup: {},
      }],
    });

    expect(app.renderTiming).not.toHaveBeenCalled();
  });

  test('updateDom uses the supplied snapshot for camera controls', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      time: 1,
      totalLaps: 10,
      track: { pitLane: { enabled: false } },
      raceControl: { mode: 'green', start: {} },
      safetyCar: { deployed: false },
      events: [],
      penalties: [],
      cars: [{
        id: 'alpha',
        rank: 1,
        lap: 1,
        code: 'ALP',
        timingCode: 'ALP',
        name: 'Alpha Project',
        color: '#ff2d55',
        tire: 'M',
        speedKph: 120,
        throttle: 0,
        brake: 0,
        setup: {},
      }],
    };
    app.readouts = {};
    app.cameraButtons = [];
    app.sim = { snapshot: vi.fn(() => snapshot) };
    app.renderTelemetry = vi.fn();
    app.renderRaceFinish = vi.fn();
    app.renderStartLights = vi.fn();
    app.renderActiveStewardMessage = vi.fn();
    app.renderProjectRadio = vi.fn();
    app.syncTimingGapModeControls = vi.fn();
    app.syncSafetyCarControls = vi.fn();
    app.updateStewardMessageState = vi.fn();
    app.emitSnapshotLifecycle = vi.fn();
    app.renderTiming = vi.fn();

    app.updateDom(snapshot);

    expect(app.sim.snapshot).not.toHaveBeenCalled();
  });

  test('unchanged pit-lane status light does not redraw every render frame', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const layer = {
      clear: vi.fn(() => layer),
      circle: vi.fn(() => layer),
      fill: vi.fn(() => layer),
      stroke: vi.fn(() => layer),
    };
    const snapshot = {
      pitLaneStatus: { open: true, light: '#22c55e', reason: 'open' },
      raceControl: { pitLaneStatus: { open: true, light: '#22c55e', reason: 'open' } },
      track: {
        pitLane: {
          enabled: true,
          width: 80,
          mainLane: { start: { x: 100, y: 200 }, heading: 0 },
          serviceNormal: { x: 0, y: 1 },
          workingLane: { offset: 30 },
        },
      },
    };
    app.pitLaneStatusLayer = layer;

    app.renderPitLaneStatus(snapshot);
    app.renderPitLaneStatus(snapshot);

    expect(layer.clear).toHaveBeenCalledTimes(1);
    expect(layer.circle).toHaveBeenCalledTimes(3);
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
    expect(css).toContain('.track-canvas {\n  position: absolute;\n  inset: 0;\n  z-index: 0;');
    expect(css).toContain('background: #2e7d32;');
    expect(css).toContain('z-index: 12;');
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

  test('overview camera frames the full generated track by default', () => {
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
      trackSeed: 20260430,
      ui: {},
    });
    const snapshot = createRaceSimulation({
      seed: 1971,
      trackSeed: 20260430,
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      totalLaps: 10,
    }).snapshot();
    const safeArea = app.getCameraSafeArea(1000);
    const bounds = app.getTrackCameraBounds(snapshot.track);
    const expectedScale = app.getCameraBoundsFitScale(bounds, 600, safeArea);

    const frame = app.getCameraFrame(snapshot, 1000, 600, 1, safeArea);

    expect(frame.target.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 5);
    expect(frame.target.y).toBeCloseTo((bounds.minY + bounds.maxY) / 2, 5);
    expect(frame.scale).toBeCloseTo(expectedScale, 5);
    snapshot.track.samples.forEach((sample) => {
      const screenX = frame.screenX + (sample.x - frame.target.x) * frame.scale;
      const screenY = frame.screenY + (sample.y - frame.target.y) * frame.scale;
      expect(screenX).toBeGreaterThanOrEqual(safeArea.left);
      expect(screenX).toBeLessThanOrEqual(safeArea.left + safeArea.width);
      expect(screenY).toBeGreaterThanOrEqual(0);
      expect(screenY).toBeLessThanOrEqual(600);
    });
  });

  test('leader and selected cameras start close enough for car-follow views', () => {
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
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      cars: [{ id: 'alpha', x: 5000, y: 3200 }],
      raceControl: { mode: 'green' },
    };

    expect(app.getCameraFrame(snapshot, 1000, 600, 1).scale).toBe(18);
    app.setCameraMode('selected');
    expect(app.getCameraFrame(snapshot, 1000, 600, 1).scale).toBe(24);
  });

  test('initial follow camera frame applies the selected target immediately', () => {
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
      drivers: [
        { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
        { id: 'beta', name: 'Beta Project', color: '#118ab2' },
      ],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'selected',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      cars: [
        { id: 'alpha', x: 1200, y: 800 },
        { id: 'beta', x: 5400, y: 3300 },
      ],
      raceControl: { mode: 'green' },
    };
    app.selectedId = 'beta';
    app.camera.x = 1200;
    app.camera.y = 800;
    app.camera.scale = null;
    app.worldLayer = {
      scale: { set: vi.fn() },
      position: { set: vi.fn() },
    };
    const baseScale = Math.min(1000 / (WORLD.width + 260), 600 / (WORLD.height + 220));
    const expectedFrame = app.getCameraFrame(snapshot, 1000, 600, baseScale, { left: 0, width: 1000 });

    app.applyCamera(snapshot);

    expect(app.camera.x).toBe(5400);
    expect(app.camera.y).toBe(3300);
    expect(app.worldLayer.position.set).toHaveBeenCalledWith(
      expectedFrame.screenX - 5400 * expectedFrame.scale,
      expectedFrame.screenY - 3300 * expectedFrame.scale,
    );
  });

  test('camera mode changes glide from the current target instead of snapping', () => {
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
      drivers: [
        { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
        { id: 'beta', name: 'Beta Project', color: '#118ab2' },
      ],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      cars: [
        { id: 'alpha', x: 1200, y: 800 },
        { id: 'beta', x: 5400, y: 3300 },
      ],
      raceControl: { mode: 'green' },
    };
    app.selectedId = 'beta';
    app.camera.x = 1200;
    app.camera.y = 800;
    app.camera.scale = 1;
    app.camera.initialized = true;
    app.worldLayer = {
      scale: { set: vi.fn() },
      position: { set: vi.fn() },
    };
    app.setCameraMode('selected');

    app.applyCamera(snapshot);

    expect(app.camera.x).toBeCloseTo(1704);
    expect(app.camera.y).toBeCloseTo(1100);
    expect(app.camera.x).not.toBe(5400);
    expect(app.camera.y).not.toBe(3300);
  });

  test('pit camera frames the generated pit lane instead of the race leader', () => {
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
      initialCameraMode: 'pit',
      totalLaps: 10,
      seed: 1971,
      trackSeed: 20260430,
      ui: {},
    });
    const snapshot = createRaceSimulation({
      seed: 1971,
      trackSeed: 20260430,
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      totalLaps: 10,
    }).snapshot();
    const pitLane = snapshot.track.pitLane;
    const points = [
      pitLane.entry.lanePoint,
      ...pitLane.mainLane.points,
      ...pitLane.workingLane.points,
      pitLane.exit.lanePoint,
      ...pitLane.boxes.flatMap((box) => box.corners),
      ...pitLane.serviceAreas.flatMap((area) => [...area.corners, ...area.queueCorners]),
    ].filter(Boolean);
    const bounds = points.reduce((box, point) => ({
      minX: Math.min(box.minX, point.x),
      minY: Math.min(box.minY, point.y),
      maxX: Math.max(box.maxX, point.x),
      maxY: Math.max(box.maxY, point.y),
    }), {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });

    const frame = app.getCameraFrame(snapshot, 1000, 600, 0.12);

    expect(frame.target.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 5);
    expect(frame.target.y).toBeCloseTo((bounds.minY + bounds.maxY) / 2, 5);
    expect(frame.target).not.toEqual({ x: snapshot.cars[0].x, y: snapshot.cars[0].y });
    expect(frame.scale).toBeGreaterThan(0);
  });

  test('pit camera frames operational pit-lane geometry instead of access roads', () => {
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
      initialCameraMode: 'pit',
      totalLaps: 10,
      seed: 1971,
      trackSeed: 20260430,
      ui: {},
    });
    const snapshot = createRaceSimulation({
      seed: 1971,
      trackSeed: 20260430,
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      totalLaps: 10,
    }).snapshot();

    const safeArea = app.getCameraSafeArea(1000);
    const baseScale = Math.min(safeArea.width / (WORLD.width + 260), 600 / (WORLD.height + 220));
    const frame = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);
    const bounds = app.getPitCameraBounds(snapshot.track.pitLane);
    const accessPoints = [
      ...snapshot.track.pitLane.entry.roadCenterline,
      ...snapshot.track.pitLane.exit.roadCenterline,
    ];
    const accessBounds = accessPoints.reduce((box, point) => ({
      minX: Math.min(box.minX, point.x),
      minY: Math.min(box.minY, point.y),
      maxX: Math.max(box.maxX, point.x),
      maxY: Math.max(box.maxY, point.y),
    }), {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });

    expect(frame.scale).toBeGreaterThan(baseScale);
    expect(frame.target.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 5);
    expect(frame.target.y).toBeCloseTo((bounds.minY + bounds.maxY) / 2, 5);
    expect(bounds.maxX - bounds.minX).toBeLessThan(accessBounds.maxX - accessBounds.minX);
  });

  test('pit camera controls are disabled when no pit lane is available', () => {
    const pitButton = {
      dataset: { cameraMode: 'pit' },
      hidden: false,
      disabled: false,
      classList: { toggle: vi.fn() },
      setAttribute: vi.fn(),
    };
    const leaderButton = {
      dataset: { cameraMode: 'leader' },
      hidden: false,
      disabled: false,
      classList: { toggle: vi.fn() },
      setAttribute: vi.fn(),
    };
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'pit',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.cameraButtons = [leaderButton, pitButton];
    app.sim = {
      snapshot: () => ({
        track: { pitLane: null },
        cars: [{ id: 'alpha', x: 5000, y: 3200 }],
        raceControl: { mode: 'green' },
      }),
    };

    app.updateCameraControls();

    expect(app.camera.mode).toBe('leader');
    expect(pitButton.hidden).toBe(true);
    expect(pitButton.disabled).toBe(true);
    expect(leaderButton.setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
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

  test('zoom controls cannot pull any camera farther out than the generated track frame', () => {
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
      initialCameraMode: 'show-all',
      totalLaps: 10,
      seed: 1971,
      trackSeed: 20260430,
      ui: {},
    });
    const snapshot = createRaceSimulation({
      seed: 1971,
      trackSeed: 20260430,
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      totalLaps: 10,
    }).snapshot();
    const safeArea = app.getCameraSafeArea(1000);
    const baseScale = Math.min(safeArea.width / (WORLD.width + 260), 600 / (WORLD.height + 220));
    const trackFitScale = app.getCameraBoundsFitScale(app.getTrackCameraBounds(snapshot.track), 600, safeArea);

    app.camera.mode = 'show-all';
    app.camera.zoom = 1;
    const defaultShowAll = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);
    app.adjustCameraZoom(-20);
    const zoomedOutShowAll = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);
    app.adjustCameraZoom(6);
    const zoomedInShowAll = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);

    expect(app.camera.zoom).toBeGreaterThan(1);
    expect(zoomedOutShowAll.scale).toBeLessThan(defaultShowAll.scale);
    expect(zoomedOutShowAll.scale).toBeGreaterThanOrEqual(trackFitScale);
    expect(zoomedInShowAll.scale).toBeGreaterThanOrEqual(defaultShowAll.scale);

    app.camera.mode = 'pit';
    app.camera.zoom = 1;
    const defaultPit = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);
    app.adjustCameraZoom(2);
    const zoomedInPit = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);

    expect(zoomedInPit.scale).toBeGreaterThan(defaultPit.scale);

    app.camera.mode = 'leader';
    app.camera.zoom = 0.55;
    const zoomedOutLeader = app.getCameraFrame(snapshot, 1000, 600, baseScale, safeArea);

    expect(zoomedOutLeader.scale).toBeGreaterThanOrEqual(trackFitScale);
  });

  test('canvas pointer dragging does not switch to a free camera target', () => {
    const eventHandlers = new Map();
    const app = new F1SimulatorApp(createOverlayRootStub({
      canvasHost: {
        clientWidth: 1000,
        clientHeight: 600,
        addEventListener: vi.fn((type, handler) => {
          eventHandlers.set(type, handler);
        }),
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
        getBoundingClientRect() {
          return { left: 0, right: 1000 };
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

    app.camera.x = 2400;
    app.camera.y = 1800;
    app.camera.scale = 0.5;

    app.bindCameraWheelControls({ signal: new AbortController().signal });
    eventHandlers.get('pointerdown')?.({
      button: 0,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
    });
    eventHandlers.get('pointermove')?.({
      pointerId: 7,
      clientX: 200,
      clientY: 50,
      preventDefault: vi.fn(),
    });

    expect(app.canvasHost.addEventListener).toHaveBeenCalledTimes(1);
    expect(app.canvasHost.addEventListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      expect.objectContaining({ passive: false }),
    );
    expect(app.camera.free).toBe(false);
    expect(app.camera.freeTarget).toBe(null);
    expect(app.getCameraTarget({ cars: [{ id: 'alpha', x: 5000, y: 3000 }] })).toEqual({ x: 5000, y: 3000 });
  });

  test('camera controls include a mute banners toggle for project and radio banners', () => {
    const html = createCameraControlsMarkup();
    expect(html).toContain('data-race-data-banners-muted');
    expect(html).toContain('Mute banners');

    const panel = {
      classList: createClassListStub(),
      removeAttribute: vi.fn(),
    };
    const app = new F1SimulatorApp({
      style: { setProperty: vi.fn() },
      querySelector(selector) {
        if (selector === '[data-race-data-panel]') return panel;
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
      ui: { raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] } },
    });

    expect(app.isRaceDataBannerEnabled('project')).toBe(true);
    app.setRaceDataBannersMuted(true);

    expect(app.isRaceDataBannerEnabled('project')).toBe(false);
    expect(app.isRaceDataBannerEnabled('radio')).toBe(false);
    expect(panel.classList.add).toHaveBeenCalledWith('is-hidden');
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

  test('clears stale fps samples when the frame clock is reset', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });

    app.accumulator = 2;
    app.nextGameFrameTime = 100;
    app.fps.current = 2;
    app.fps.frames = 4;
    app.fps.lastSample = 500;

    app.resetFrameClock(4000);

    expect(app.accumulator).toBe(0);
    expect(app.lastTime).toBe(4000);
    expect(app.nextGameFrameTime).toBeCloseTo(4000 + 1000 / 60);
    expect(app.fps.current).toBe(0);
    expect(app.fps.frames).toBe(0);
    expect(app.fps.lastSample).toBe(4000);
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

  test('race-data close button hides project and radio pills before their scheduled timeout', () => {
    const listeners = new Map();
    const panel = {
      classList: createClassListStub(['is-project-mode']),
      style: { setProperty: vi.fn() },
      removeAttribute: vi.fn(),
    };
    const closeButton = {
      hidden: false,
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    };
    const app = new F1SimulatorApp({
      style: { setProperty: vi.fn() },
      querySelector(selector) {
        if (selector === '[data-race-data-panel]') return panel;
        if (selector === '[data-race-data-dismiss]') return closeButton;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    }, {
      drivers: [
        { id: 'alpha', name: 'Alpha Project', color: '#ff2d55', raceData: ['Box'] },
      ],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {
        raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
      },
    });

    app.activeRaceDataId = 'alpha';
    app.radioState.visible = true;
    app.radioState.nextChangeAt = performance.now() + 6000;
    app.bindControls();

    expect(closeButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function), expect.any(Object));
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('click')(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(app.activeRaceDataId).toBe(null);
    expect(app.radioState.visible).toBe(false);
    expect(app.radioState.nextChangeAt).toBeGreaterThan(performance.now());
    expect(panel.classList.add).toHaveBeenCalledWith('is-hidden');
    expect(panel.classList.remove).toHaveBeenCalledWith('is-project-mode', 'is-radio-mode');
  });

  test('race-data close button stays small and above every lower-third layout', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.race-data-dismiss {');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('width: 0.95rem;');
    expect(css).toContain('height: 0.95rem;');
    expect(css).toContain('font-size: 0;');
    expect(css).toContain('color: transparent;');
    expect(css).toContain('background: var(--race-data-dismiss-icon-color);');
    expect(css).toContain('.race-data-dismiss::before,\n.race-data-dismiss::after');
    expect(css).toContain('width: 0.48rem;');
    expect(css).toContain('transform: translate(-50%, -50%) rotate(45deg);');
    expect(css).toContain('transform: translate(-50%, -50%) rotate(-45deg);');
    expect(css).toContain('z-index: 4;');
    expect(css).toContain('.race-data-panel--with-telemetry .race-data-dismiss');
    expect(css).toContain('.race-data-panel.is-radio-mode .race-data-dismiss');
  });

  test('project telemetry lower-third does not auto-hide after the normal project banner timeout', () => {
    const driver = { id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' };
    const snapshot = {
      cars: [{ id: 'alpha', name: 'Alpha Project', code: 'ALP', color: '#ff2d55', rank: 1 }],
      events: [],
      penalties: [],
      raceControl: { mode: 'green' },
    };
    const standard = new F1SimulatorApp(createRootStub(null), {
      drivers: [driver],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: { raceDataTelemetryDetail: false },
    });
    standard.activeRaceDataId = 'alpha';
    standard.lastRaceDataInteraction = performance.now() - 6000;

    standard.updateDom(snapshot, { emitLifecycle: false });

    expect(standard.activeRaceDataId).toBe(null);

    const telemetry = new F1SimulatorApp(createRootStub(null), {
      drivers: [driver],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: { raceDataTelemetryDetail: true },
    });
    telemetry.activeRaceDataId = 'alpha';
    telemetry.lastRaceDataInteraction = performance.now() - 6000;

    telemetry.updateDom(snapshot, { emitLifecycle: false });

    expect(telemetry.activeRaceDataId).toBe('alpha');
  });

  test('mounted telemetry lower-thirds do not auto-hide when telemetry detail came from a template option', () => {
    const driver = { id: 'alpha', name: 'Alpha Project', color: '#ff2d55', timingCode: 'ALP' };
    const snapshot = {
      cars: [{ id: 'alpha', name: 'Alpha Project', code: 'ALP', color: '#ff2d55', rank: 1 }],
      events: [],
      penalties: [],
      raceControl: { mode: 'green' },
    };
    const panel = {
      classList: createClassListStub(['race-data-panel--with-telemetry']),
      style: { setProperty: vi.fn() },
      removeAttribute: vi.fn(),
    };
    const telemetry = new F1SimulatorApp({
      style: { setProperty: vi.fn() },
      querySelector(selector) {
        if (selector === '[data-race-data-panel]') return panel;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    }, {
      drivers: [driver],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: { raceDataTelemetryDetail: false },
    });
    telemetry.activeRaceDataId = 'alpha';
    telemetry.lastRaceDataInteraction = performance.now() - 6000;

    telemetry.updateDom(snapshot, { emitLifecycle: false });

    expect(telemetry.activeRaceDataId).toBe('alpha');
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
    const sectors = createMarkupRoot();
    const lapTimes = createMarkupRoot();
    const overview = createMarkupRoot();
    const raceData = createMarkupRoot();

    simulator.mountRaceControls(controls);
    simulator.mountTimingTower(tower);
    simulator.mountRaceCanvas(race, { includeRaceDataPanel: true });
    simulator.mountTelemetryPanel(telemetry, { includeOverview: false });
    simulator.mountTelemetrySectors(sectors);
    simulator.mountTelemetryLapTimes(lapTimes);
    simulator.mountCarDriverOverview(overview);
    simulator.mountRaceDataPanel(raceData);

    expect(controls.innerHTML).toContain('data-safety-car');
    expect(tower.innerHTML).toContain('data-timing-tower');
    expect(race.innerHTML).toContain('data-track-canvas');
    expect(race.innerHTML).toContain('data-race-data-panel');
    expect(telemetry.innerHTML).toContain('data-paddock-component="telemetry-stack"');
    expect(telemetry.innerHTML).toContain('data-paddock-component="telemetry-core"');
    expect(telemetry.innerHTML).not.toContain('data-paddock-component="car-driver-overview"');
    expect(sectors.innerHTML).toContain('data-paddock-component="telemetry-sectors"');
    expect(lapTimes.innerHTML).toContain('data-paddock-component="telemetry-lap-times"');
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

  test('telemetry drawer controls open by taking layout space and close through the persistent toggle', () => {
    const toggle = {
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
      textContent: 'Telemetry',
    };
    const drawer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const workbench = {
      classList: {
        toggle: vi.fn(),
      },
    };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-telemetry-drawer-toggle]') return toggle;
        if (selector === '[data-telemetry-drawer]') return drawer;
        if (selector === '[data-race-telemetry-drawer]') return workbench;
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

    app.bindControls();
    const toggleHandler = toggle.addEventListener.mock.calls.find(([type]) => type === 'click')[1];

    toggleHandler();
    expect(workbench.classList.toggle).toHaveBeenCalledWith('is-telemetry-open', true);
    expect(drawer.removeAttribute).toHaveBeenCalledWith('inert');
    expect(drawer.setAttribute).toHaveBeenCalledWith('aria-hidden', 'false');
    expect(toggle.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');
    expect(toggle.textContent).toBe('Close telemetry');

    toggleHandler();
    expect(workbench.classList.toggle).toHaveBeenCalledWith('is-telemetry-open', false);
    expect(drawer.setAttribute).toHaveBeenCalledWith('inert', '');
    expect(drawer.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(toggle.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
    expect(toggle.textContent).toBe('Telemetry');
  });

  test('telemetry drawer opening resizes the renderer instead of stretching the canvas', () => {
    const toggle = {
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
      textContent: 'Telemetry',
    };
    const drawer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const workbench = {
      classList: {
        toggle: vi.fn(),
      },
    };
    const canvasHost = {
      clientWidth: 820,
      clientHeight: 620,
    };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-telemetry-drawer-toggle]') return toggle;
        if (selector === '[data-telemetry-drawer]') return drawer;
        if (selector === '[data-race-telemetry-drawer]') return workbench;
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
      renderer: {
        resize: vi.fn(),
      },
    };
    app.sim = {
      snapshot: vi.fn(() => ({
        cars: [],
        track: { pitLane: null },
        raceControl: { mode: 'green' },
        safetyCar: { deployed: false },
      })),
    };
    app.applyCamera = vi.fn();

    app.bindControls();
    const toggleHandler = toggle.addEventListener.mock.calls.find(([type]) => type === 'click')[1];
    toggleHandler();

    expect(app.app.renderer.resize).toHaveBeenCalledWith(820, 620);
    expect(app.applyCamera).toHaveBeenCalledWith(expect.objectContaining({
      cars: [],
      track: { pitLane: null },
      raceControl: { mode: 'green' },
    }));
  });

  test('telemetry drawer keeps syncing renderer while the layout is animating', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const callbacks = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const toggle = {
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
      textContent: 'Telemetry',
    };
    const app = new F1SimulatorApp({
      style: { setProperty: vi.fn() },
      querySelector(selector) {
        if (selector === '[data-telemetry-drawer-toggle]') return toggle;
        if (selector === '[data-telemetry-drawer]') return { removeAttribute: vi.fn(), setAttribute: vi.fn() };
        if (selector === '[data-race-telemetry-drawer]') return { classList: { toggle: vi.fn() } };
        if (selector === '[data-track-canvas]') return { clientWidth: 820, clientHeight: 620 };
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
      renderer: { resize: vi.fn() },
      render: vi.fn(),
    };
    app.sim = {
      snapshot: vi.fn(() => ({
        cars: [],
        track: { pitLane: null },
        raceControl: { mode: 'green' },
        safetyCar: { deployed: false },
      })),
    };
    app.applyCamera = vi.fn();

    try {
      app.bindControls();
      toggle.addEventListener.mock.calls.find(([type]) => type === 'click')[1]();
      callbacks.shift()?.(performance.now());
      callbacks.shift()?.(performance.now() + 180);
      callbacks.shift()?.(performance.now() + 380);

      expect(app.app.renderer.resize.mock.calls.length).toBeGreaterThan(2);
      expect(app.app.render).toHaveBeenCalled();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  test('initial frame is rendered before loading placeholders are cleared', () => {
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    const snapshot = {
      cars: [],
      track: { pitLane: null },
      raceControl: { mode: 'green' },
      safetyCar: { deployed: false },
    };
    app.resizeRendererToCanvasHost = vi.fn();
    app.applyCamera = vi.fn();
    app.renderDrsTrails = vi.fn();
    app.renderCars = vi.fn();
    app.app = { render: vi.fn() };

    app.renderInitialFrame(snapshot);

    expect(app.resizeRendererToCanvasHost).toHaveBeenCalled();
    expect(app.applyCamera).toHaveBeenCalled();
    expect(app.renderCars).toHaveBeenCalled();
    expect(app.app.render).toHaveBeenCalled();
  });

  test('telemetry drawer toggle respects an initially open drawer', () => {
    const toggle = {
      addEventListener: vi.fn(),
      setAttribute: vi.fn(),
      textContent: 'Close telemetry',
    };
    const drawer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const workbench = {
      classList: {
        contains: vi.fn((className) => className === 'is-telemetry-open'),
        toggle: vi.fn(),
      },
    };
    const app = new F1SimulatorApp({
      style: {
        setProperty: vi.fn(),
      },
      querySelector(selector) {
        if (selector === '[data-telemetry-drawer-toggle]') return toggle;
        if (selector === '[data-telemetry-drawer]') return drawer;
        if (selector === '[data-race-telemetry-drawer]') return workbench;
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

    app.bindControls();
    const toggleHandler = toggle.addEventListener.mock.calls.find(([type]) => type === 'click')[1];

    toggleHandler();

    expect(workbench.classList.toggle).toHaveBeenCalledWith('is-telemetry-open', false);
    expect(drawer.setAttribute).toHaveBeenCalledWith('inert', '');
    expect(drawer.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(toggle.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
    expect(toggle.textContent).toBe('Telemetry');
  });

  test('sector telemetry readouts receive performance classes from lap telemetry', () => {
    const makeNode = (dataset) => ({
      dataset,
      textContent: '',
      classList: {
        toggle: vi.fn(),
      },
      style: {
        getPropertyValue: vi.fn(() => ''),
        setProperty: vi.fn(),
      },
    });
    const sectorTime = makeNode({ telemetrySectorTime: '1' });
    const activeSectorTime = makeNode({ telemetrySectorTime: '2' });
    const staleFutureSectorTime = makeNode({ telemetrySectorTime: '3' });
    const lastSector = makeNode({ telemetrySectorLast: '1' });
    const bestSector = makeNode({ telemetrySectorBest: '1' });
    const bar = makeNode({ telemetrySectorBar: '1' });
    bar.style.getPropertyValue = vi.fn(() => '100.0%');
    const activeBar = makeNode({ telemetrySectorBar: '2' });
    const futureBar = makeNode({ telemetrySectorBar: '3' });
    futureBar.style.getPropertyValue = vi.fn(() => '100.0%');
    const app = new F1SimulatorApp(createRootStub(null), {
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      assets: DEFAULT_F1_SIMULATOR_ASSETS,
      initialCameraMode: 'leader',
      totalLaps: 10,
      seed: 1971,
      ui: {},
    });
    app.readouts = {
      ...app.readouts,
      currentSector: [],
      completedLaps: [],
      currentLapTime: [],
      lastLapTime: [],
      bestLapTime: [],
      telemetrySectorBars: [bar, activeBar, futureBar],
      telemetrySectorTimes: [sectorTime, activeSectorTime, staleFutureSectorTime],
      telemetrySectorLast: [lastSector],
      telemetrySectorBest: [bestSector],
    };

    app.renderLapTelemetry({
      currentSector: 2,
      currentLapTime: 42,
      currentSectorElapsed: 4,
      currentSectorProgress: 0.4,
      completedLaps: 1,
      currentSectors: [28.123, null, null],
      sectorProgress: [1, 0.4, 0],
      liveSectors: [28.123, 4, null],
      lastSectors: [29.456, null, null],
      bestSectors: [27.777, null, null],
      sectorPerformance: {
        current: ['personal-best', null, null],
        last: ['slower', null, null],
        best: ['overall-best', null, null],
      },
    });

    expect(sectorTime.classList.toggle).toHaveBeenCalledWith('is-personal-best', true);
    expect(sectorTime.classList.toggle).toHaveBeenCalledWith('is-overall-best', false);
    expect(lastSector.classList.toggle).toHaveBeenCalledWith('is-slower', true);
    expect(bestSector.classList.toggle).toHaveBeenCalledWith('is-overall-best', true);
    expect(bar.classList.toggle).toHaveBeenCalledWith('is-personal-best', true);
    expect(sectorTime.textContent).toBe('28.123s');
    expect(bar.style.setProperty).not.toHaveBeenCalledWith('--sector-fill', '0.0%');
    expect(activeSectorTime.textContent).toBe('4.000s');
    expect(activeBar.style.setProperty).toHaveBeenCalledWith('--sector-fill', '40.0%');
    expect(futureBar.style.setProperty).toHaveBeenCalledWith('--sector-fill', '0.0%');
  });

  test('sector telemetry clears future readouts for every active sector even if stale values are present', () => {
    const makeNode = (dataset) => ({
      dataset,
      textContent: 'stale',
      classList: {
        toggle: vi.fn(),
      },
      style: {
        getPropertyValue: vi.fn(() => '100.0%'),
        setProperty: vi.fn(),
      },
    });

    for (let currentSector = 1; currentSector <= 3; currentSector += 1) {
      const sectorTimes = [1, 2, 3].map((sector) => makeNode({ telemetrySectorTime: String(sector) }));
      const sectorBars = [1, 2, 3].map((sector) => makeNode({ telemetrySectorBar: String(sector) }));
      const app = new F1SimulatorApp(createRootStub(null), {
        drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
        assets: DEFAULT_F1_SIMULATOR_ASSETS,
        initialCameraMode: 'leader',
        totalLaps: 10,
        seed: 1971,
        ui: {},
      });
      app.readouts = {
        ...app.readouts,
        currentSector: [],
        completedLaps: [],
        currentLapTime: [],
        lastLapTime: [],
        bestLapTime: [],
        telemetrySectorBars: sectorBars,
        telemetrySectorTimes: sectorTimes,
        telemetrySectorLast: [],
        telemetrySectorBest: [],
      };

      app.renderLapTelemetry({
        currentSector,
        currentLapTime: 4,
        currentSectorElapsed: 4,
        currentSectorProgress: 0.25,
        completedLaps: 1,
        currentSectors: [11.1, 28.123, 33.3],
        sectorProgress: [1, 1, 1].map((value, index) => (
          index === currentSector - 1 ? 0.25 : value
        )),
        liveSectors: [11.1, 28.123, 33.3],
        sectorPerformance: {
          current: ['slower', 'slower', 'slower'],
        },
      });

      sectorTimes.forEach((node, index) => {
        if (index < currentSector - 1) expect(node.textContent).not.toBe('--');
        else if (index === currentSector - 1) expect(node.textContent).toBe('4.000s');
        else expect(node.textContent).toBe('--');
      });
      sectorBars.forEach((bar, index) => {
        if (index === currentSector - 1) {
          expect(bar.style.setProperty).toHaveBeenCalledWith('--sector-fill', '25.0%');
          expect(bar.classList.toggle).toHaveBeenCalledWith('is-slower', false);
        } else if (index > currentSector - 1) {
          expect(bar.style.setProperty).toHaveBeenCalledWith('--sector-fill', '0.0%');
          expect(bar.classList.toggle).toHaveBeenCalledWith('is-slower', false);
          expect(sectorTimes[index].classList.toggle).toHaveBeenCalledWith('is-slower', false);
        }
      });
    }
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
    expect(css).toContain('--race-control-red: #e10600');
    expect(css).toContain('.broadcast-race-control-banner.is-red-flag {\n  background: var(--race-control-red);');
    expect(css).toContain('.paddock-loading');
    expect(css).toContain('@keyframes paddock-loading-pulse');
  });

  test('telemetry drawer animation avoids grid-template transitions and offscreen overflow', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('--telemetry-drawer-width');
    expect(css).toContain('margin-right: var(--telemetry-drawer-width)');
    expect(css).toContain('max-inline-size: 100%');
    expect(css).toContain('clip-path: inset(0 0 0 100%)');
    expect(css).toContain('.race-telemetry-drawer.is-telemetry-open .telemetry-drawer {\n  clip-path: inset(0);');
    expect(css).toContain('.race-telemetry-drawer__toolbar');
    expect(css).toContain('.race-telemetry-drawer__race {\n  min-width: 0;\n  display: flex;\n  flex: 1 1 auto;\n  min-height: 0;');
    expect(css).toContain('.race-telemetry-drawer__race > .sim-canvas-panel {\n  flex: 1 1 auto;');
    expect(css).not.toContain('.race-telemetry-drawer.is-telemetry-open .race-telemetry-drawer__controls [data-safety-car]');
    expect(css).not.toContain('transition: grid-template-columns');
  });

  test('telemetry sidebar component supports constrained vertical scrolling', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('height: var(--paddock-race-view-height, var(--paddock-race-view-min-height, 620px));');
    expect(css).toContain('min-height: min(100%, var(--paddock-race-view-min-height, 620px));');
    expect(css).toContain('.telemetry-stack {\n  display: grid;\n  grid-auto-rows: max-content;\n  align-content: start;');
    expect(css).toContain('max-height: 100%;\n  overflow-y: auto;');
    expect(css).toContain('.telemetry-drawer__content {\n  height: 100%;');
    expect(css).toContain('.telemetry-drawer__content > .telemetry-stack {\n  height: 100%;');
    expect(css).not.toContain('telemetry-drawer__header');
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
    const telemetryCore = createMarkupRoot();
    const telemetrySectors = createMarkupRoot();
    const telemetryLapTimes = createMarkupRoot();
    const telemetrySectorTimes = createMarkupRoot();
    const telemetrySectorBanner = createMarkupRoot();
    const drawer = createMarkupRoot();
    const overview = createMarkupRoot();
    const raceData = createMarkupRoot();

    mountRaceControls(controls, simulator);
    mountCameraControls(camera, simulator);
    mountSafetyCarControl(safety, simulator);
    mountTimingTower(tower, simulator);
    mountRaceCanvas(race, simulator, { includeRaceDataPanel: true });
    mountTelemetryPanel(telemetry, simulator);
    mountTelemetryCore(telemetryCore, simulator);
    mountTelemetrySectors(telemetrySectors, simulator);
    mountTelemetryLapTimes(telemetryLapTimes, simulator);
    mountTelemetrySectorTimes(telemetrySectorTimes, simulator);
    mountTelemetrySectorBanner(telemetrySectorBanner, simulator);
    mountRaceTelemetryDrawer(drawer, simulator);
    mountCarDriverOverview(overview, simulator);
    mountRaceDataPanel(raceData, simulator);

    expect(controls.innerHTML).toContain('data-paddock-component="race-controls"');
    expect(camera.innerHTML).toContain('data-paddock-component="camera-controls"');
    expect(safety.innerHTML).toContain('data-paddock-component="safety-car-control"');
    expect(tower.innerHTML).toContain('data-paddock-component="timing-tower"');
    expect(race.innerHTML).toContain('data-paddock-component="race-canvas"');
    expect(race.innerHTML).toContain('data-paddock-component="race-data-panel"');
    expect(telemetry.innerHTML).toContain('data-paddock-component="telemetry-stack"');
    expect(telemetryCore.innerHTML).toContain('data-paddock-component="telemetry-core"');
    expect(telemetrySectors.innerHTML).toContain('data-paddock-component="telemetry-sectors"');
    expect(telemetryLapTimes.innerHTML).toContain('data-paddock-component="telemetry-lap-times"');
    expect(telemetrySectorTimes.innerHTML).toContain('data-paddock-component="telemetry-sector-times"');
    expect(telemetrySectorBanner.innerHTML).toContain('data-paddock-component="telemetry-sector-banner"');
    expect(drawer.innerHTML).toContain('data-paddock-component="race-telemetry-drawer"');
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

  test('exposes race-control and pit target compound methods for external callers', () => {
    const simulator = createPaddockSimulator({
      drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
    });
    const app = {
      setRedFlagDeployed: vi.fn(),
      setPitLaneOpen: vi.fn(),
      setPitIntent: vi.fn().mockReturnValue(true),
      getPitTargetCompound: vi.fn().mockReturnValue('H'),
    };
    simulator.app = app;

    simulator.setRedFlagDeployed(true);
    simulator.setPitLaneOpen(false);
    expect(simulator.setPitIntent('alpha', 2, 'H')).toBe(true);
    expect(simulator.getPitTargetCompound('alpha')).toBe('H');

    expect(app.setRedFlagDeployed).toHaveBeenCalledWith(true);
    expect(app.setPitLaneOpen).toHaveBeenCalledWith(false);
    expect(app.setPitIntent).toHaveBeenCalledWith('alpha', 2, 'H');
  });

  test('mountF1Simulator exposes the same race-control and pit methods as its public type', async () => {
    const OriginalElement = globalThis.Element;
    class ElementStub {}
    globalThis.Element = ElementStub;
    const shell = {
      style: { setProperty: vi.fn() },
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
    };
    const root = new ElementStub();
    root.innerHTML = '';
    root.querySelector = vi.fn((selector) => (
      selector === '[data-f1-simulator-shell]' ? shell : null
    ));
    const calls = {
      setRedFlagDeployed: vi.fn(),
      setPitLaneOpen: vi.fn(),
      setPitIntent: vi.fn().mockReturnValue(true),
      getPitTargetCompound: vi.fn().mockReturnValue('H'),
    };
    const previous = {
      init: F1SimulatorApp.prototype.init,
      destroy: F1SimulatorApp.prototype.destroy,
      setRedFlagDeployed: F1SimulatorApp.prototype.setRedFlagDeployed,
      setPitLaneOpen: F1SimulatorApp.prototype.setPitLaneOpen,
      setPitIntent: F1SimulatorApp.prototype.setPitIntent,
      getPitTargetCompound: F1SimulatorApp.prototype.getPitTargetCompound,
    };
    F1SimulatorApp.prototype.init = vi.fn(async () => {});
    F1SimulatorApp.prototype.destroy = vi.fn();
    F1SimulatorApp.prototype.setRedFlagDeployed = calls.setRedFlagDeployed;
    F1SimulatorApp.prototype.setPitLaneOpen = calls.setPitLaneOpen;
    F1SimulatorApp.prototype.setPitIntent = calls.setPitIntent;
    F1SimulatorApp.prototype.getPitTargetCompound = calls.getPitTargetCompound;

    try {
      const mounted = await mountF1Simulator(root, {
        drivers: [{ id: 'alpha', name: 'Alpha Project', color: '#ff2d55' }],
      });

      mounted.setRedFlagDeployed(true);
      mounted.setPitLaneOpen(false);
      expect(mounted.setPitIntent('alpha', 2, 'H')).toBe(true);
      expect(mounted.getPitTargetCompound('alpha')).toBe('H');

      expect(calls.setRedFlagDeployed).toHaveBeenCalledWith(true);
      expect(calls.setPitLaneOpen).toHaveBeenCalledWith(false);
      expect(calls.setPitIntent).toHaveBeenCalledWith('alpha', 2, 'H');
      expect(calls.getPitTargetCompound).toHaveBeenCalledWith('alpha');
    } finally {
      F1SimulatorApp.prototype.init = previous.init;
      F1SimulatorApp.prototype.destroy = previous.destroy;
      F1SimulatorApp.prototype.setRedFlagDeployed = previous.setRedFlagDeployed;
      F1SimulatorApp.prototype.setPitLaneOpen = previous.setPitLaneOpen;
      F1SimulatorApp.prototype.setPitIntent = previous.setPitIntent;
      F1SimulatorApp.prototype.getPitTargetCompound = previous.getPitTargetCompound;
      if (OriginalElement === undefined) delete globalThis.Element;
      else globalThis.Element = OriginalElement;
    }
  });
});
