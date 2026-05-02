import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DRIVER_STAT_DEFINITIONS, formatDriverNumber, VEHICLE_STAT_DEFINITIONS } from '../data/championship.js';
import { applyPaddockThemeCssVariables } from '../config/defaultOptions.js';
import { normalizeCustomFields } from '../data/customFields.js';
import { getCarRayOrigin, getCarRayVector } from '../environment/sensors.js';
import { ProceduralTrackAsset } from '../rendering/proceduralTrackAsset.js';
import { createRenderSnapshot } from '../rendering/renderSnapshot.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { clamp } from '../simulation/simMath.js';
import { offsetTrackPoint, pointAt, WORLD } from '../simulation/trackModel.js';
import { metersToSimUnits } from '../simulation/units.js';
import { createBrowserExpertAdapter } from './BrowserExpertAdapter.js';
import { querySimulatorDom, setText, setTextAll } from './domBindings.js';

const TARGET_RENDER_FPS = 60;
const TARGET_FRAME_MS = 1000 / TARGET_RENDER_FPS;
const FRAME_PACING_EPSILON_MS = 0.75;
const MAX_FRAME_CATCHUP_COUNT = 4;
const MAX_SIMULATION_STEPS_PER_RENDER = 5;
const DOM_UPDATE_INTERVAL_MS = 100;
const TIMING_UPDATE_INTERVAL_MS = 250;
const SIM_SPEED = 3.25;
const CAR_WORLD_LENGTH = 66;
const CAR_WORLD_WIDTH = 23;
const SAFETY_CAR_WORLD_LENGTH = 92;
const SAFETY_CAR_WORLD_WIDTH = 38;
const CAMERA_PRESETS = {
  overview: 1.6,
  leader: 5.35,
  selected: 6.1,
};
const SHOW_ALL_PADDING = 520;
const SHOW_ALL_MIN_ZOOM = 1.1;
const SHOW_ALL_MAX_ZOOM = 6.4;
const SHOW_ALL_TOP_RESERVED = 92;
const SHOW_ALL_BOTTOM_RESERVED = 132;
const DRS_TRAIL_TTL = 0.68;
const DRS_TRAIL_MIN_DISTANCE = 10;
const SENSOR_RAY_TRACK_COLOR = 0xf1c65b;
const SENSOR_RAY_TRACK_ENTRY_COLOR = 0x68d8ff;
const SENSOR_RAY_CAR_COLOR = 0xff4d5f;
const RACE_DATA_SELECTED_VISIBLE_MS = 5200;
const RADIO_BREAK_MIN_MS = 4800;
const RADIO_BREAK_MAX_MS = 11800;
const RADIO_VISIBLE_MIN_MS = 6200;
const RADIO_VISIBLE_MAX_MS = 9200;
const RADIO_SCHEDULE_CATCHUP_LIMIT_MS = 30000;
const DRS_DRAG_REDUCTION_PERCENT = 58;

const VEHICLE_OVERVIEW_FIELDS = [
  ['power', 'Power'],
  ['braking', 'Braking'],
  ['aero', 'Aero'],
  ['dragEfficiency', 'Drag'],
  ['mechanicalGrip', 'Grip'],
  ['weightControl', 'Weight'],
];
const DRIVER_OVERVIEW_FIELDS = [
  ['pace', 'Pace'],
  ['racecraft', 'Racecraft'],
  ['aggression', 'Aggression'],
  ['riskTolerance', 'Risk'],
  ['patience', 'Patience'],
  ['consistency', 'Consistency'],
];

const TINT_BY_COLOR = new Map();

function createMountTrackSeed() {
  const values = new Uint32Array(1);
  try {
    globalThis.crypto?.getRandomValues?.(values);
  } catch {
    values[0] = 0;
  }
  return (values[0] || Math.floor(Date.now() + performance.now() * 1000)) >>> 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getTireClass(tire) {
  return String(tire ?? 'M').toLowerCase();
}

function formatTelemetryTime(value) {
  if (!Number.isFinite(value)) return '--';
  const clamped = Math.max(0, value);
  if (clamped >= 60) {
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }
  return `${clamped.toFixed(3)}s`;
}

function setPerformanceClass(node, status) {
  ['overall-best', 'personal-best', 'slower'].forEach((name) => {
    node?.classList?.toggle?.(`is-${name}`, status === name);
  });
}

function colorToTint(color) {
  if (TINT_BY_COLOR.has(color)) return TINT_BY_COLOR.get(color);
  const tint = Number.parseInt(String(color ?? '').replace('#', ''), 16);
  const normalizedTint = Number.isFinite(tint) ? tint : 0xffffff;
  TINT_BY_COLOR.set(color, normalizedTint);
  return normalizedTint;
}

function smoothAngle(current, target, amount) {
  if (!Number.isFinite(current)) return target;
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * amount;
}

function destroyDisplayChildren(container) {
  container?.removeChildren?.().forEach((child) => {
    child.destroy?.({ children: true, texture: false, textureSource: false });
  });
}

function expertVisualizesRays(expertOptions) {
  const setting = expertOptions?.visualizeSensors;
  if (setting === true) return true;
  if (!setting || setting === false) return false;
  return Boolean(setting.rays);
}

function pointFromRay(origin, ray, distance) {
  return {
    x: origin.x + ray.x * distance,
    y: origin.y + ray.y * distance,
  };
}

function hasOwnOption(options, key) {
  return Object.hasOwn(options ?? {}, key);
}

function expertOptionsChanged(nextExpertOptions, currentExpertOptions) {
  return nextExpertOptions !== currentExpertOptions;
}

function assetSetsEqual(first = {}, second = {}) {
  const firstTrackTextures = first.trackTextures ?? {};
  const secondTrackTextures = second.trackTextures ?? {};
  const assetKeys = ['car', 'carOverview', 'driverHelmet', 'safetyCar', 'broadcastPanel', 'f1Logo'];
  const textureKeys = new Set([...Object.keys(firstTrackTextures), ...Object.keys(secondTrackTextures)]);
  return assetKeys.every((key) => first[key] === second[key]) &&
    [...textureKeys].every((key) => firstTrackTextures[key] === secondTrackTextures[key]);
}

export class F1SimulatorApp {
  constructor(root, options) {
    this.root = root;
    this.options = options;
    this.drivers = options.drivers;
    this.driverById = new Map(this.drivers.map((driver) => [driver.id, driver]));
    this.assets = options.assets;
    this.root.style.setProperty('--broadcast-panel-surface', `url('${this.assets.broadcastPanel}')`);
    this.root.style.setProperty('--paddock-entry-count', String(this.drivers.length));
    applyPaddockThemeCssVariables(this.root, options.theme);
    Object.assign(this, querySimulatorDom(root));
    this.abortController = new AbortController();
    this.resizeHandler = null;
    this.layoutResizeObserver = null;
    this.cameraSafeAreaCache = null;
    this.visibilityChangeHandler = null;
    this.visibilityObserver = null;
    this.tickerCallback = null;
    this.expert = null;
    this.expertMode = Boolean(options.expert?.enabled);
    this.sim = null;
    this.app = null;
    this.worldLayer = null;
    this.trackAsset = null;
    this.drsLayer = null;
    this.trailLayer = null;
    this.sensorLayer = null;
    this.carLayer = null;
    this.textures = {};
    this.carSprites = new Map();
    this.carHitAreas = new Map();
    this.drsTrails = new Map();
    this.trackSeed = options.trackSeed ?? createMountTrackSeed();
    this.selectedId = this.drivers[0]?.id ?? null;
    this.raceDataBannerConfig = options.ui?.raceDataBanners ?? { initial: 'project', enabled: ['project', 'radio'] };
    this.activeRaceDataId = null;
    this.lastRaceDataInteraction = performance.now();
    this.radioRandomState = (this.trackSeed ^ 0x9e3779b9) >>> 0;
    this.radioState = {
      visible: false,
      nextChangeAt: Number.POSITIVE_INFINITY,
      driverIndex: 0,
      quoteIndex: 0,
    };
    this.resetRaceDataBannerState(this.lastRaceDataInteraction);
    this.camera = {
      mode: options.initialCameraMode,
      zoom: CAMERA_PRESETS[options.initialCameraMode] ?? CAMERA_PRESETS.leader,
      scale: null,
      x: WORLD.width / 2,
      y: WORLD.height / 2,
    };
    this.overviewMode = 'vehicle';
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.nextGameFrameTime = this.lastTime + TARGET_FRAME_MS;
    this.lastDomUpdateTime = 0;
    this.lastTimingRenderTime = 0;
    this.lastTimingRaceMode = null;
    this.lastTimingMarkup = null;
    this.lastOverviewRenderKey = null;
    this.lastFinishClassificationMarkup = null;
    this.runtimeViewportVisible = true;
    this.runtimeDocumentVisible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
    this.runtimeTickerRunning = true;
    this.fps = {
      frames: 0,
      current: 0,
      lastSample: this.lastTime,
    };
    this.lastLeaderLap = null;
    this.emittedRaceEventKeys = new Set();
    this.raceFinishEmitted = false;
    this.timingGapMode = 'interval';
    this.telemetryDrawerOpen = Boolean(
      this.readouts.telemetryDrawerWorkbench?.classList?.contains?.('is-telemetry-open'),
    );
  }

  async init() {
    this.emitHostCallback('onLoadingChange', { loading: true, phase: 'initializing' });
    try {
      if (!this.canvasHost) {
        throw new Error('F1 simulator canvas host is missing.');
      }

      this.sim = this.createRaceSimulation();
      this.app = new Application();
      await this.app.init({
        resizeTo: this.canvasHost,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        backgroundAlpha: 0,
      });
      this.canvasHost.appendChild(this.app.canvas);

      this.worldLayer = new Container();
      this.drsLayer = new Container();
      this.trailLayer = new Graphics();
      this.sensorLayer = new Graphics();
      this.carLayer = new Container();
      this.app.stage.addChild(this.worldLayer);

      await this.loadAssets();
      this.trackAsset = new ProceduralTrackAsset({ textures: this.textures, world: WORLD });
      this.worldLayer.addChild(this.trackAsset.container, this.drsLayer, this.trailLayer, this.sensorLayer, this.carLayer);
      this.createCars();
      this.bindControls();
      this.renderTrack();
      const snapshot = this.sim.snapshot();
      this.updateDom(snapshot);
      if (this.expertMode) {
        this.expert = createBrowserExpertAdapter(this, this.options.expert);
      }
      this.completeComponentLoading();
      this.emitHostCallback('onLoadingChange', { loading: false, phase: 'ready' });
      this.emitHostCallback('onReady', { snapshot });
      this.resizeHandler = () => this.applyCamera(this.sim.snapshot());
      window.addEventListener('resize', this.resizeHandler, { signal: this.abortController.signal });
      this.observeLayoutResize();
      if (!this.expertMode) {
        this.tickerCallback = () => this.tick();
        this.app.ticker.add(this.tickerCallback);
        this.observeRuntimeVisibility();
      }
    } catch (error) {
      this.emitHostCallback('onLoadingChange', { loading: false, phase: 'error' });
      this.emitHostCallback('onError', error, { phase: 'init' });
      this.destroy();
      throw error;
    }
  }

  emitHostCallback(name, ...args) {
    const callback = this.options?.[name];
    if (typeof callback !== 'function') return;
    try {
      callback(...args);
    } catch (error) {
      if (name !== 'onError' && typeof this.options?.onError === 'function') {
        try {
          this.options.onError(error, { callback: name });
        } catch {
          // Host callbacks should not break the simulator runtime.
        }
      }
    }
  }

  completeComponentLoading() {
    const loadingNodes = [...(this.root.querySelectorAll?.('[data-paddock-loading]') ?? [])];
    loadingNodes.forEach((node) => {
      node.closest?.('[data-paddock-component]')?.classList?.add?.('is-loaded');
      node.remove?.();
    });
  }

  createRaceSimulation(options = this.options) {
    return createRaceSimulation({
      seed: options.seed,
      trackSeed: options.trackSeed ?? this.trackSeed,
      drivers: options.drivers ?? this.drivers,
      totalLaps: options.totalLaps,
    });
  }

  async loadAssets() {
    this.textures.car = Texture.WHITE;
    try {
      this.textures.car = await Assets.load(this.assets.car);
      this.textures.car.source.scaleMode = 'linear';
      this.textures.car.source.autoGenerateMipmaps = true;
    } catch {
      this.textures.car = Texture.WHITE;
    }

    try {
      this.textures.safetyCar = await Assets.load(this.assets.safetyCar);
      this.textures.safetyCar.source.scaleMode = 'linear';
      this.textures.safetyCar.source.autoGenerateMipmaps = true;
    } catch {
      this.textures.safetyCar = Texture.WHITE;
    }

    await Promise.all(Object.entries(this.assets.trackTextures).map(async ([key, url]) => {
      try {
        const texture = await Assets.load(url);
        texture.source.scaleMode = 'linear';
        this.textures[key] = texture;
      } catch {
        this.textures[key] = Texture.WHITE;
      }
    }));
  }

  createCars() {
    const texture = this.textures.car ?? Texture.WHITE;
    const baseScale = Math.min(
      CAR_WORLD_LENGTH / Math.max(texture.width, 1),
      CAR_WORLD_WIDTH / Math.max(texture.height, 1),
    );

    this.carSprites.forEach((sprite) => sprite.destroy());
    this.carHitAreas.forEach((hit) => hit.destroy());
    this.carSprites.clear();
    this.carHitAreas.clear();
    this.drsTrails.clear();

    if (this.safetySprite) {
      this.safetySprite.destroy();
      this.safetySprite = null;
    }

    this.drivers.forEach((driver) => {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.baseScale = baseScale;
      sprite.scale.set(baseScale);
      sprite.tint = colorToTint(driver.color);
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      sprite.on('pointerdown', () => {
        this.selectCar(driver.id, { focus: true });
      });
      this.carSprites.set(driver.id, sprite);
      this.carLayer.addChild(sprite);

      const hit = new Graphics();
      hit.circle(0, 0, 24).fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointerdown', () => {
        this.selectCar(driver.id, { focus: true });
      });
      this.carHitAreas.set(driver.id, hit);
      this.carLayer.addChild(hit);
    });
  }

  bindControls() {
    const eventOptions = { signal: this.abortController.signal };

    this.safetyButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const next = this.sim.snapshot().raceControl.mode !== 'safety-car';
        this.setSafetyCarDeployed(next);
      }, eventOptions);
    });

    this.restartButton?.addEventListener('click', () => {
      this.sim = this.createRaceSimulation();
      this.selectedId = this.drivers[0]?.id ?? null;
      this.resetRaceDataBannerState(performance.now());
      this.syncSafetyCarControls(false);
      this.drsTrails.clear();
      this.trailLayer?.clear();
      this.lastTimingRenderTime = 0;
      this.lastTimingRaceMode = null;
      this.renderTrack();
    }, eventOptions);

    this.cameraButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.camera.mode = button.dataset.cameraMode;
        if (CAMERA_PRESETS[this.camera.mode]) this.camera.zoom = CAMERA_PRESETS[this.camera.mode];
        this.updateCameraControls();
      }, eventOptions);
    });

    this.zoomInButton?.addEventListener('click', () => {
      this.camera.zoom = clamp(this.camera.zoom + 0.42, 0.72, 8.5);
      this.updateCameraControls();
    }, eventOptions);

    this.zoomOutButton?.addEventListener('click', () => {
      this.camera.zoom = clamp(this.camera.zoom - 0.42, 0.72, 8.5);
      this.updateCameraControls();
    }, eventOptions);

    this.overviewModeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.overviewMode = button.dataset.overviewMode === 'driver' ? 'driver' : 'vehicle';
        const selected = this.sim?.snapshot().cars.find((car) => car.id === this.selectedId);
        this.renderCarDriverOverview(selected);
      }, eventOptions);
    });

    this.timingGapModeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.timingGapMode = button.dataset.timingGapMode === 'leader' ? 'leader' : 'interval';
        this.syncTimingGapModeControls();
        const snapshot = this.sim?.snapshot?.();
        if (snapshot) this.renderTiming(snapshot.cars, snapshot.raceControl.mode);
      }, eventOptions);
    });

    this.timingList?.addEventListener?.('pointerdown', (event) => {
      const row = event.target instanceof Element ? event.target.closest('[data-driver-id]') : null;
      if (!row) return;
      this.selectCar(row.dataset.driverId, { focus: true });
    }, eventOptions);

    this.openButton?.addEventListener('click', () => {
      const driver = this.driverById.get(this.activeRaceDataId ?? this.selectedId);
      if (!driver) return;
      this.options.onDriverOpen?.(driver);
    }, eventOptions);

    this.readouts.telemetryDrawerToggle?.addEventListener('click', () => {
      this.setTelemetryDrawerOpen(!this.telemetryDrawerOpen);
    }, eventOptions);
  }

  setTelemetryDrawerOpen(open) {
    this.telemetryDrawerOpen = Boolean(open);
    this.readouts.telemetryDrawerWorkbench?.classList?.toggle?.('is-telemetry-open', this.telemetryDrawerOpen);
    if (this.telemetryDrawerOpen) {
      this.readouts.telemetryDrawer?.removeAttribute?.('inert');
      this.readouts.telemetryDrawer?.setAttribute?.('aria-hidden', 'false');
    } else {
      this.readouts.telemetryDrawer?.setAttribute?.('inert', '');
      this.readouts.telemetryDrawer?.setAttribute?.('aria-hidden', 'true');
    }
    this.readouts.telemetryDrawerToggle?.setAttribute?.('aria-expanded', String(this.telemetryDrawerOpen));
    if (this.readouts.telemetryDrawerToggle) {
      this.readouts.telemetryDrawerToggle.textContent = this.telemetryDrawerOpen ? 'Close telemetry' : 'Telemetry';
    }
    this.invalidateCameraSafeArea();
  }

  observeLayoutResize() {
    if (typeof ResizeObserver !== 'function') return;
    this.layoutResizeObserver?.disconnect?.();
    this.layoutResizeObserver = new ResizeObserver(() => this.invalidateCameraSafeArea());
    if (this.canvasHost) this.layoutResizeObserver.observe(this.canvasHost);
    if (this.readouts.timingTower) this.layoutResizeObserver.observe(this.readouts.timingTower);
  }

  invalidateCameraSafeArea() {
    this.cameraSafeAreaCache = null;
  }

  observeRuntimeVisibility() {
    if (!this.canvasHost) return;

    if (typeof IntersectionObserver === 'function') {
      this.visibilityObserver?.disconnect?.();
      this.visibilityObserver = new IntersectionObserver((entries) => {
        const entry = entries.find((item) => item.target === this.canvasHost) ?? entries[0];
        this.runtimeViewportVisible = Boolean(entry?.isIntersecting || entry?.intersectionRatio > 0);
        this.syncRuntimeTicker();
      }, {
        root: null,
        rootMargin: '240px 0px',
        threshold: 0,
      });
      this.visibilityObserver.observe(this.canvasHost);
    }

    if (typeof document !== 'undefined') {
      this.visibilityChangeHandler = () => {
        this.runtimeDocumentVisible = document.visibilityState !== 'hidden';
        this.syncRuntimeTicker();
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler, {
        signal: this.abortController.signal,
      });
    }

    this.syncRuntimeTicker();
  }

  syncRuntimeTicker() {
    if (this.expertMode) return;
    if (!this.app?.ticker) return;

    const shouldRun = this.runtimeViewportVisible && this.runtimeDocumentVisible;
    if (shouldRun === this.runtimeTickerRunning) return;

    this.runtimeTickerRunning = shouldRun;
    if (shouldRun) {
      this.resetFrameClock();
      this.app.ticker.start?.();
    } else {
      this.app.ticker.stop?.();
    }
  }

  resetFrameClock(now = performance.now()) {
    this.accumulator = 0;
    this.lastTime = now;
    this.nextGameFrameTime = now + TARGET_FRAME_MS;
    this.fps.frames = 0;
    this.fps.lastSample = now;
  }

  tick() {
    if (this.expertMode) return;
    const now = performance.now();
    if (now < this.nextGameFrameTime - FRAME_PACING_EPSILON_MS) return;

    const elapsedFrameCount = clamp(
      Math.floor((now - this.nextGameFrameTime + FRAME_PACING_EPSILON_MS) / TARGET_FRAME_MS) + 1,
      1,
      MAX_FRAME_CATCHUP_COUNT,
    );
    const frameSeconds = (TARGET_FRAME_MS * elapsedFrameCount) / 1000;
    this.nextGameFrameTime += TARGET_FRAME_MS * elapsedFrameCount;
    if (now - this.nextGameFrameTime > TARGET_FRAME_MS * MAX_FRAME_CATCHUP_COUNT) {
      this.nextGameFrameTime = now + TARGET_FRAME_MS;
    }
    this.lastTime = now;
    this.sampleFps(now);
    this.accumulator += frameSeconds * SIM_SPEED;

    let simulationSteps = 0;
    while (this.accumulator >= FIXED_STEP && simulationSteps < MAX_SIMULATION_STEPS_PER_RENDER) {
      this.sim.step(FIXED_STEP);
      const stepSnapshot = this.sim.snapshot();
      this.emitSnapshotLifecycle(stepSnapshot);
      this.accumulator -= FIXED_STEP;
      simulationSteps += 1;
    }

    if (this.accumulator >= FIXED_STEP) {
      this.accumulator %= FIXED_STEP;
      this.nextGameFrameTime = now + TARGET_FRAME_MS;
    }

    const snapshot = this.sim.snapshot();
    const renderSnapshot = createRenderSnapshot(snapshot, clamp(this.accumulator / FIXED_STEP, 0, 1));
    this.applyCamera(renderSnapshot);
    this.renderDrsTrails(renderSnapshot);
    this.renderCars(renderSnapshot);
    if (now - this.lastDomUpdateTime >= DOM_UPDATE_INTERVAL_MS) {
      this.updateDom(snapshot, { emitLifecycle: false });
      this.lastDomUpdateTime = now;
    }
  }

  renderExpertFrame(snapshot = this.sim?.snapshot(), { observation } = {}) {
    if (!snapshot) return;
    const renderSnapshot = createRenderSnapshot(snapshot, 0);
    this.applyCamera(renderSnapshot);
    this.renderDrsTrails(renderSnapshot);
    this.renderExpertSensorRays(renderSnapshot, observation);
    this.renderCars(renderSnapshot);
    this.updateDom(snapshot, { emitLifecycle: false });
    this.lastDomUpdateTime = performance.now();
  }

  renderTrack() {
    destroyDisplayChildren(this.drsLayer);
    this.sensorLayer?.clear();
    const snapshot = this.sim.snapshot();
    const track = snapshot.track;

    this.trackAsset.render(track);

    track.drsZones.forEach((zone) => {
      const zoneLine = new Graphics();
      const steps = 44;
      for (let index = 0; index <= steps; index += 1) {
        const basePoint = pointAt(track, zone.start + ((zone.end - zone.start) * index) / steps);
        const point = offsetTrackPoint(basePoint, track.width / 2 - 22);
        if (index === 0) zoneLine.moveTo(point.x, point.y);
        else zoneLine.lineTo(point.x, point.y);
      }
      zoneLine.stroke({ width: 8, color: 0x14c784, alpha: 0.5, join: 'round', cap: 'round' });
      this.drsLayer.addChild(zoneLine);
    });
  }

  renderCars(snapshot) {
    snapshot.cars.forEach((car) => {
      const sprite = this.carSprites.get(car.id);
      const hit = this.carHitAreas.get(car.id);
      if (!sprite || !hit) return;
      sprite.x = car.x;
      sprite.y = car.y;
      sprite.currentRotation = smoothAngle(sprite.currentRotation, car.heading, 0.24);
      sprite.rotation = sprite.currentRotation;
      sprite.alpha = snapshot.raceControl.mode === 'safety-car' ? 0.82 : 1;
      sprite.scale.set(sprite.baseScale);
      sprite.tint = colorToTint(car.color);
      hit.x = car.x;
      hit.y = car.y;
    });

    if (!this.safetySprite && snapshot.safetyCar.deployed) {
      const texture = this.textures.safetyCar ?? Texture.WHITE;
      this.safetySprite = new Sprite(texture);
      this.safetySprite.anchor.set(0.5);
      this.safetySprite.baseScale = Math.min(
        SAFETY_CAR_WORLD_LENGTH / Math.max(texture.width, 1),
        SAFETY_CAR_WORLD_WIDTH / Math.max(texture.height, 1),
      );
      this.safetySprite.scale.set(this.safetySprite.baseScale);
      this.carLayer.addChild(this.safetySprite);
    }

    if (this.safetySprite) {
      this.safetySprite.visible = snapshot.safetyCar.deployed;
      this.safetySprite.x = snapshot.safetyCar.x;
      this.safetySprite.y = snapshot.safetyCar.y;
      this.safetySprite.rotation = snapshot.safetyCar.heading;
    }
  }

  renderExpertSensorRays(snapshot, observation) {
    if (!this.sensorLayer) return;
    this.sensorLayer.clear();
    if (!this.expertMode || !expertVisualizesRays(this.options.expert)) return;

    const controlledDrivers = this.options.expert?.controlledDrivers ?? [];
    if (!controlledDrivers.length || !observation) return;

    const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
    controlledDrivers.forEach((driverId) => {
      const car = carsById.get(driverId);
      const rays = observation?.[driverId]?.object?.rays;
      if (!car || !Array.isArray(rays) || rays.length === 0) return;

      const origin = getCarRayOrigin(car);

      rays.forEach((ray) => {
        const rayVector = getCarRayVector(car, Number(ray.angleDegrees) || 0);
        const totalDistanceMeters = Math.max(0, Number(ray.lengthMeters) || 0);
        const trackDistanceMeters = Math.max(0, Number(ray.track?.distanceMeters) || totalDistanceMeters);
        const carDistanceMeters = Math.max(0, Number(ray.car?.distanceMeters) || totalDistanceMeters);
        const trackHit = Boolean(ray.track?.hit) && trackDistanceMeters <= totalDistanceMeters;
        const carHit = Boolean(ray.car?.hit) && carDistanceMeters <= totalDistanceMeters;
        const fullEnd = pointFromRay(origin, rayVector, metersToSimUnits(totalDistanceMeters));

        this.sensorLayer
          .moveTo(origin.x, origin.y)
          .lineTo(fullEnd.x, fullEnd.y)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.18, cap: 'round' });

        if (!trackHit && !carHit) return;

        const carIsClosest = carHit && (!trackHit || carDistanceMeters <= trackDistanceMeters);
        const hitDistanceMeters = carIsClosest ? carDistanceMeters : trackDistanceMeters;
        const hitEnd = pointFromRay(origin, rayVector, metersToSimUnits(hitDistanceMeters));
        const hitColor = carIsClosest
          ? SENSOR_RAY_CAR_COLOR
          : ray.track?.kind === 'entry'
            ? SENSOR_RAY_TRACK_ENTRY_COLOR
            : SENSOR_RAY_TRACK_COLOR;

        this.sensorLayer
          .moveTo(origin.x, origin.y)
          .lineTo(hitEnd.x, hitEnd.y)
          .stroke({ width: carIsClosest ? 5 : 3.4, color: hitColor, alpha: carIsClosest ? 0.9 : 0.76, cap: 'round' });
        this.sensorLayer
          .circle(hitEnd.x, hitEnd.y, carIsClosest ? 7 : 5)
          .fill({ color: hitColor, alpha: 0.92 })
          .circle(hitEnd.x, hitEnd.y, carIsClosest ? 10 : 8)
          .stroke({ width: 1.5, color: 0x10131a, alpha: 0.72 });
      });
    });
  }

  renderDrsTrails(snapshot) {
    if (!this.trailLayer) return;

    snapshot.cars.forEach((car) => {
      const history = this.drsTrails.get(car.id) ?? [];
      const rear = {
        x: car.x - Math.cos(car.heading) * CAR_WORLD_LENGTH * 0.46,
        y: car.y - Math.sin(car.heading) * CAR_WORLD_LENGTH * 0.46,
        at: snapshot.time,
      };
      const last = history[history.length - 1];

      if (
        car.drsActive &&
        (!last || Math.hypot(rear.x - last.x, rear.y - last.y) >= DRS_TRAIL_MIN_DISTANCE)
      ) {
        history.push(rear);
      }

      const activeTrail = history.filter((point) => snapshot.time - point.at <= DRS_TRAIL_TTL);
      if (activeTrail.length) this.drsTrails.set(car.id, activeTrail);
      else this.drsTrails.delete(car.id);
    });

    this.trailLayer.clear();
    this.drsTrails.forEach((history) => {
      for (let index = 1; index < history.length; index += 1) {
        const previous = history[index - 1];
        const point = history[index];
        const age = snapshot.time - point.at;
        const life = clamp(1 - age / DRS_TRAIL_TTL, 0, 1);
        this.trailLayer.moveTo(previous.x, previous.y);
        this.trailLayer.lineTo(point.x, point.y);
        this.trailLayer.stroke({
          width: 5 + life * 7,
          color: 0x3be8ff,
          alpha: 0.22 + life * 0.48,
          cap: 'round',
          join: 'round',
        });
      }
    });
  }

  applyCamera(snapshot) {
    if (!this.worldLayer) return;

    const width = this.canvasHost.clientWidth || 900;
    const height = this.canvasHost.clientHeight || 640;
    const safeArea = this.getCameraSafeArea(width);
    const baseScale = Math.min(safeArea.width / (WORLD.width + 260), height / (WORLD.height + 220));
    const frame = this.getCameraFrame(snapshot, width, height, baseScale, safeArea);
    const scale = frame.scale;
    const target = frame.target;
    this.camera.x += (target.x - this.camera.x) * 0.08;
    this.camera.y += (target.y - this.camera.y) * 0.08;
    const activeScale = this.camera.scale === null
      ? scale
      : this.camera.scale + (scale - this.camera.scale) * 0.12;
    this.camera.scale = activeScale;
    this.worldLayer.scale.set(activeScale);
    this.worldLayer.position.set(
      frame.screenX - this.camera.x * activeScale,
      frame.screenY - this.camera.y * activeScale,
    );
  }

  getCameraSafeArea(width) {
    if (this.cameraSafeAreaCache?.width === width) {
      return this.cameraSafeAreaCache.safeArea;
    }

    const canvasRect = this.canvasHost?.getBoundingClientRect?.();
    const towerRect = this.readouts.timingTower?.getBoundingClientRect?.();
    if (!canvasRect || !towerRect) {
      const safeArea = { left: 0, width };
      this.cameraSafeAreaCache = { width, safeArea };
      return safeArea;
    }
    const overlapsCanvasHorizontally = towerRect.right > canvasRect.left && towerRect.left < canvasRect.right;
    const hasVerticalBounds = Number.isFinite(canvasRect.top) &&
      Number.isFinite(canvasRect.bottom) &&
      Number.isFinite(towerRect.top) &&
      Number.isFinite(towerRect.bottom);
    const overlapsCanvasVertically = !hasVerticalBounds ||
      (towerRect.bottom > canvasRect.top && towerRect.top < canvasRect.bottom);
    const canvasWidth = Math.max(1, canvasRect.right - canvasRect.left || width);
    const towerWidth = Math.max(0, towerRect.right - towerRect.left);
    const isSideGutter = towerWidth < canvasWidth * 0.6;
    if (!overlapsCanvasHorizontally || !overlapsCanvasVertically || !isSideGutter) {
      const safeArea = { left: 0, width };
      this.cameraSafeAreaCache = { width, safeArea };
      return safeArea;
    }

    const overlayGap = 16;
    const reservedLeft = clamp(towerRect.right - canvasRect.left + overlayGap, 0, width * 0.48);
    const safeArea = {
      left: reservedLeft,
      width: Math.max(1, width - reservedLeft),
    };
    this.cameraSafeAreaCache = { width, safeArea };
    return safeArea;
  }

  getCameraFrame(snapshot, width, height, baseScale, safeArea = { left: 0, width }) {
    const screenCenterX = safeArea.left + safeArea.width / 2;

    if (this.camera.mode === 'show-all') {
      const bounds = snapshot.cars.reduce((box, car) => ({
        minX: Math.min(box.minX, car.x),
        minY: Math.min(box.minY, car.y),
        maxX: Math.max(box.maxX, car.x),
        maxY: Math.max(box.maxY, car.y),
      }), {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      });
      const target = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };
      const fitWidth = Math.max(CAR_WORLD_LENGTH * 3, bounds.maxX - bounds.minX + SHOW_ALL_PADDING);
      const fitHeight = Math.max(CAR_WORLD_LENGTH * 3, bounds.maxY - bounds.minY + SHOW_ALL_PADDING);
      const safeHeight = Math.max(height * 0.48, height - SHOW_ALL_TOP_RESERVED - SHOW_ALL_BOTTOM_RESERVED);
      const scale = clamp(
        Math.min(safeArea.width / fitWidth, safeHeight / fitHeight),
        baseScale * SHOW_ALL_MIN_ZOOM,
        baseScale * SHOW_ALL_MAX_ZOOM,
      );
      return {
        target,
        scale,
        screenX: screenCenterX,
        screenY: SHOW_ALL_TOP_RESERVED + safeHeight / 2,
      };
    }

    return {
      target: this.getCameraTarget(snapshot),
      scale: baseScale * this.camera.zoom,
      screenX: screenCenterX,
      screenY: height / 2,
    };
  }

  getCameraTarget(snapshot) {
    if (this.camera.mode === 'overview') {
      return { x: WORLD.width / 2, y: WORLD.height / 2 };
    }

    if (this.camera.mode === 'selected') {
      const selected = snapshot.cars.find((car) => car.id === this.selectedId);
      if (selected) return selected;
    }

    const leader = snapshot.cars[0];
    return leader ? { x: leader.x, y: leader.y } : { x: WORLD.width / 2, y: WORLD.height / 2 };
  }

  updateDom(snapshot, { emitLifecycle = true } = {}) {
    const leader = snapshot.cars[0];
    const selected = snapshot.cars.find((car) => car.id === this.selectedId) ?? leader;
    const activeDrs = snapshot.cars.filter((car) => car.drsActive).length;
    const contactCount = snapshot.events.filter((event) => event.type === 'contact').length;
    const now = performance.now();

    if (emitLifecycle) this.emitSnapshotLifecycle(snapshot);

    if (this.activeRaceDataId && now - this.lastRaceDataInteraction > RACE_DATA_SELECTED_VISIBLE_MS) {
      this.activeRaceDataId = null;
      if (this.isRaceDataBannerEnabled('radio')) this.scheduleRadioBreak(now);
    }

    if (this.readouts.mode) {
      const modeLabel = snapshot.raceControl.mode === 'safety-car'
          ? 'SC'
          : snapshot.raceControl.finished
            ? 'FINISH'
            : 'GREEN';
      this.readouts.mode.textContent = modeLabel;
      this.readouts.mode.style.color = snapshot.raceControl.mode === 'safety-car'
        ? 'var(--yellow)'
        : snapshot.raceControl.mode === 'finished'
          ? 'var(--red)'
          : 'var(--green)';
    }
    this.syncSafetyCarControls(snapshot.raceControl.mode === 'safety-car');
    if (this.readouts.lap) this.readouts.lap.textContent = `${leader?.lap ?? 1}/${snapshot.totalLaps}`;
    if (this.readouts.towerLap) this.readouts.towerLap.textContent = leader?.lap ?? 1;
    if (this.readouts.towerTotalLaps) this.readouts.towerTotalLaps.textContent = snapshot.totalLaps;
    if (this.readouts.timingTower) {
      this.readouts.timingTower.classList.toggle('is-safety-car', snapshot.raceControl.mode === 'safety-car');
      this.readouts.timingTower.classList.toggle('is-pre-start', snapshot.raceControl.mode === 'pre-start');
    }
    if (this.readouts.towerSafetyBanner) {
      this.readouts.towerSafetyBanner.hidden = snapshot.raceControl.mode !== 'safety-car';
    }
    if (this.readouts.drs) {
      this.readouts.drs.textContent = snapshot.raceControl.mode === 'safety-car'
        ? 'DISABLED'
        : activeDrs
          ? `${activeDrs} OPEN`
          : 'ARMED';
    }
    if (this.readouts.contacts) this.readouts.contacts.textContent = String(contactCount);
    this.renderStartLights(snapshot.raceControl);
    if (this.readouts.camera) {
      const zoom = this.camera.mode === 'show-all'
        ? Math.round(((this.camera.scale ?? 0) / Math.max(0.0001, this.getBaseScale())) * 100)
        : Math.round(this.camera.zoom * 100);
      this.readouts.camera.textContent = `${this.camera.mode.toUpperCase().replace('-', ' ')} ${zoom}%`;
    }
    if (this.readouts.fps) {
      this.readouts.fps.textContent = this.fps.current ? `${this.fps.current}` : '--';
    }
    this.renderRaceFinish(snapshot);

    this.updateCameraControls();
    this.syncTimingGapModeControls();
    if (
      now - this.lastTimingRenderTime >= TIMING_UPDATE_INTERVAL_MS ||
      this.lastTimingRaceMode !== snapshot.raceControl.mode
    ) {
      this.renderTiming(snapshot.cars, snapshot.raceControl.mode);
      this.lastTimingRenderTime = now;
      this.lastTimingRaceMode = snapshot.raceControl.mode;
    }
    this.renderTelemetry(selected);
    const activeRaceDataCar = this.activeRaceDataId
      ? snapshot.cars.find((car) => car.id === this.activeRaceDataId)
      : null;
    if (activeRaceDataCar) {
      this.renderRaceData(activeRaceDataCar);
    } else {
      this.renderProjectRadio(now);
    }
  }

  emitSnapshotLifecycle(snapshot) {
    const leader = snapshot.cars[0];
    const leaderLap = leader?.lap;
    if (Number.isFinite(leaderLap)) {
      if (this.lastLeaderLap != null && leaderLap !== this.lastLeaderLap) {
        this.emitHostCallback('onLapChange', {
          previousLeaderLap: this.lastLeaderLap,
          leaderLap,
          leader,
          snapshot,
        });
      }
      this.lastLeaderLap = leaderLap;
    }

    snapshot.events.forEach((event) => {
      const key = `${event.type}:${event.at ?? snapshot.time}:${event.carId ?? ''}:${event.otherCarId ?? ''}:${event.winnerId ?? ''}`;
      if (this.emittedRaceEventKeys.has(key)) return;
      this.emittedRaceEventKeys.add(key);
      this.emitHostCallback('onRaceEvent', event, snapshot);
    });

    if (snapshot.raceControl.finished && !this.raceFinishEmitted) {
      this.raceFinishEmitted = true;
      this.emitHostCallback('onRaceFinish', {
        winner: snapshot.raceControl.winner,
        classification: snapshot.raceControl.classification ?? [],
        snapshot,
      });
    }
  }

  renderRaceFinish(snapshot) {
    const panel = this.readouts.finishPanel;
    if (!panel) return;

    panel.hidden = !snapshot.raceControl.finished;
    if (!snapshot.raceControl.finished) return;

    const winner = snapshot.raceControl.winner;
    const winnerDriver = winner ? this.driverById.get(winner.id) : null;
    const winnerName = winnerDriver?.name ?? winner?.name ?? 'Winner';
    panel.style.setProperty('--driver-color', winner?.color ?? winnerDriver?.color ?? 'var(--red)');
    setText(this.readouts.finishWinner, winnerName);

    if (this.readouts.finishClassification) {
      const topThree = (snapshot.raceControl.classification ?? []).slice(0, 3);
      const classificationMarkup = topThree.map((entry) => `
        <li>
          <span>P${escapeHtml(entry.rank)}</span>
          <strong>${escapeHtml(entry.timingCode ?? entry.code ?? entry.id)}</strong>
        </li>
      `).join('');
      if (classificationMarkup !== this.lastFinishClassificationMarkup) {
        this.readouts.finishClassification.innerHTML = classificationMarkup;
        this.lastFinishClassificationMarkup = classificationMarkup;
      }
    }
  }

  getBaseScale() {
    const width = this.canvasHost.clientWidth || 900;
    const height = this.canvasHost.clientHeight || 640;
    const safeArea = this.getCameraSafeArea(width);
    return Math.min(safeArea.width / (WORLD.width + 260), height / (WORLD.height + 220));
  }

  sampleFps(now) {
    this.fps.frames += 1;
    const elapsed = now - this.fps.lastSample;
    if (elapsed < 500) return;
    this.fps.current = Math.round((this.fps.frames * 1000) / elapsed);
    this.fps.frames = 0;
    this.fps.lastSample = now;
  }

  renderStartLights(raceControl) {
    const panel = this.readouts.startLights;
    if (!panel) return;

    const start = raceControl.start;
    const visible = Boolean(start?.visible);
    panel.hidden = !visible;
    if (!visible) return;

    this.startLightNodes.forEach((light, index) => {
      light.classList.toggle('is-lit', index < (start.lightsLit ?? 0));
    });
    panel.classList.toggle('is-lights-out', raceControl.mode === 'green' && start.released);

    if (this.readouts.startLightsLabel) {
      this.readouts.startLightsLabel.textContent = raceControl.mode === 'green' && start.released
        ? 'Lights out'
        : `${start.lightsLit}/${start.lightCount}`;
    }
  }

  selectCar(id, { focus = false } = {}) {
    this.selectedId = id;
    this.activeRaceDataId = this.isRaceDataBannerEnabled('project') ? id : null;
    this.lastRaceDataInteraction = performance.now();
    if (this.isRaceDataBannerEnabled('radio')) this.scheduleRadioBreak(this.lastRaceDataInteraction);
    if (focus) {
      this.camera.mode = 'selected';
      this.camera.zoom = CAMERA_PRESETS.selected;
      this.updateCameraControls();
    }
    this.lastTimingRenderTime = 0;
    const snapshot = this.sim.snapshot();
    this.updateDom(snapshot);
    const driver = this.driverById.get(id);
    if (driver) this.emitHostCallback('onDriverSelect', driver, snapshot);
  }

  renderTiming(cars, raceMode) {
    if (!this.timingList) return;
    this.syncTimingGapModeControls();
    const timingMarkup = cars.map((car) => {
      const driver = this.driverById.get(car.id);
      let gap = 'Leader';
      if (raceMode === 'finished') {
        gap = car.rank === 1 ? 'Winner' : 'FIN';
      } else if (raceMode === 'safety-car' && car.rank > 1) {
        gap = 'SC';
      } else if (raceMode === 'pre-start') {
        gap = car.rank === 1 ? 'Pole' : 'Grid';
      } else if (car.rank > 1) {
        gap = this.formatTimingGap(car);
      }
      const tire = car.tire ?? driver?.tire ?? 'M';
      const timingCode = car.timingCode ?? driver?.timingCode ?? car.code;
      const team = car.team ?? driver?.team ?? null;
      const icon = team?.icon ?? car.icon ?? driver?.icon ?? timingCode;
      const iconColor = team?.color ?? car.color;

      return `
        <li>
          <button class="timing-row ${car.id === this.selectedId ? 'is-selected' : ''}" type="button"
            data-driver-id="${escapeHtml(car.id)}" aria-label="Select ${escapeHtml(car.name)}"
            style="--driver-color: ${escapeHtml(car.color)}">
            <span class="timing-position">${car.rank}</span>
            <span class="timing-icon timing-team-icon" aria-hidden="true" style="--team-color: ${escapeHtml(iconColor)}">${escapeHtml(icon)}</span>
            <span class="timing-name" title="${escapeHtml(car.name)}">${escapeHtml(timingCode)}</span>
            <span class="timing-gap">${escapeHtml(gap)}</span>
            <span class="timing-tire timing-tire--${getTireClass(tire)}">${escapeHtml(tire)}</span>
          </button>
        </li>
      `;
    }).join('');
    if (timingMarkup !== this.lastTimingMarkup) {
      this.timingList.innerHTML = timingMarkup;
      this.lastTimingMarkup = timingMarkup;
    }
  }

  formatTimingGap(car) {
    const value = this.timingGapMode === 'leader'
      ? car.leaderGapSeconds
      : (car.intervalAheadSeconds ?? car.gapAheadSeconds);
    return Number.isFinite(value) ? `+${Math.max(0, value).toFixed(3)}` : '--';
  }

  syncTimingGapModeControls() {
    const label = this.timingGapMode === 'leader' ? 'Gap' : 'Int';
    setText(this.readouts.timingGapLabel, label);
    this.timingGapModeButtons.forEach((button) => {
      const active = button.dataset.timingGapMode === this.timingGapMode;
      button.setAttribute('aria-pressed', String(active));
      button.classList?.toggle?.('is-active', active);
    });
  }

  renderTelemetry(car) {
    if (!car) return;
    const driver = this.driverById.get(car.id);
    const icon = car.icon ?? driver?.icon ?? car.code;
    const driverNumber = formatDriverNumber(car.driverNumber ?? driver?.driverNumber);
    const drsState = car.drsActive ? 'OPEN' : car.drsEligible ? 'READY' : 'OFF';
    const surface = (car.surface ?? 'track').toUpperCase();

    setTextAll(this.readouts.selectedCode, car.code);
    this.readouts.selectedCode?.forEach?.((node) => {
      node.style.color = car.color;
    });
    this.readouts.telemetrySectorBanners?.forEach?.((node) => {
      node.style.setProperty('--driver-color', car.color);
    });
    setTextAll(this.readouts.selectedName, car.name);
    setTextAll(this.readouts.speed, `${Math.round(car.speedKph)} km/h`);
    setTextAll(this.readouts.throttle, `${Math.round(car.throttle * 100)}%`);
    setTextAll(this.readouts.brake, `${Math.round(car.brake * 100)}%`);
    setTextAll(this.readouts.tyres, `${Math.round(car.tireEnergy ?? 100)}%`);
    setTextAll(this.readouts.selectedDrs, drsState);
    setTextAll(this.readouts.surface, surface);
    setTextAll(
      this.readouts.gap,
      car.rank === 1 || !Number.isFinite(car.gapAheadSeconds)
        ? '--'
        : `${car.gapAheadSeconds.toFixed(2)}s`,
    );
    setTextAll(
      this.readouts.leaderGap,
      car.rank === 1 || !Number.isFinite(car.leaderGapSeconds)
        ? '--'
        : `${car.leaderGapSeconds.toFixed(2)}s`,
    );

    this.renderCarDriverOverview(car);
    this.renderLapTelemetry(car.lapTelemetry);
  }

  renderLapTelemetry(telemetry) {
    if (!telemetry) return;

    setTextAll(this.readouts.currentSector, `S${telemetry.currentSector ?? 1}`);
    setTextAll(this.readouts.completedLaps, `${telemetry.completedLaps ?? 0} laps`);
    setTextAll(this.readouts.currentLapTime, formatTelemetryTime(telemetry.currentLapTime));
    setTextAll(this.readouts.lastLapTime, formatTelemetryTime(telemetry.lastLapTime));
    setTextAll(this.readouts.bestLapTime, formatTelemetryTime(telemetry.bestLapTime));

    this.readouts.telemetrySectorBars?.forEach((bar) => {
      const sector = Number(bar.dataset.telemetrySectorBar);
      const index = sector - 1;
      const isActive = sector === telemetry.currentSector;
      const sectorComplete = Number.isFinite(telemetry.currentSectors?.[index]);
      const fill = sectorComplete
        ? 100
        : (isActive ? clamp((telemetry.currentSectorProgress ?? 0) * 100, 0, 100) : 0);
      const fillValue = `${fill.toFixed(1)}%`;
      if (bar.style.getPropertyValue('--sector-fill') !== fillValue) {
        bar.style.setProperty('--sector-fill', fillValue);
      }
      bar.classList.toggle('is-active', isActive);
      bar.classList.toggle('is-complete', sectorComplete);
      setPerformanceClass(bar, telemetry.sectorPerformance?.current?.[index]);
    });

    this.readouts.telemetrySectorTimes?.forEach((node) => {
      const sector = Number(node.dataset.telemetrySectorTime);
      const index = sector - 1;
      const value = sector === telemetry.currentSector && !Number.isFinite(telemetry.currentSectors?.[index])
        ? telemetry.currentSectorElapsed
        : telemetry.currentSectors?.[index];
      setText(node, formatTelemetryTime(value));
      setPerformanceClass(node, telemetry.sectorPerformance?.current?.[index]);
    });

    this.readouts.telemetrySectorLast?.forEach((node) => {
      const index = Number(node.dataset.telemetrySectorLast) - 1;
      setText(node, formatTelemetryTime(telemetry.lastSectors?.[index]));
      setPerformanceClass(node, telemetry.sectorPerformance?.last?.[index]);
    });

    this.readouts.telemetrySectorBest?.forEach((node) => {
      const index = Number(node.dataset.telemetrySectorBest) - 1;
      setText(node, formatTelemetryTime(telemetry.bestSectors?.[index]));
      setPerformanceClass(node, telemetry.sectorPerformance?.best?.[index]);
    });
  }

  getOverviewFields(driver, mode) {
    if (mode === 'driver') {
      const ratings = driver?.constructorArgs?.driver?.ratings ?? {};
      return [
        ...DRIVER_OVERVIEW_FIELDS.map(([key, label]) => ({
          key,
          label,
          value: ratings[key] ?? DRIVER_STAT_DEFINITIONS[key]?.neutral,
        })),
        ...normalizeCustomFields([
          ...(driver?.constructorArgs?.driver?.customFields ?? []),
          ...(driver?.customFields ?? []),
        ]),
      ];
    }

    const ratings = driver?.constructorArgs?.vehicle?.ratings ?? driver?.vehicle?.ratings ?? {};
    return [
      ...VEHICLE_OVERVIEW_FIELDS.map(([key, label]) => ({
        key,
        label,
        value: ratings[key] ?? VEHICLE_STAT_DEFINITIONS[key]?.neutral,
      })),
      ...normalizeCustomFields(driver?.vehicle?.customFields ?? driver?.constructorArgs?.vehicle?.customFields ?? []),
    ];
  }

  renderCarDriverOverview(car) {
    if (!car || !this.readouts.carOverview) return;
    const driver = this.driverById.get(car.id);
    const icon = car.icon ?? driver?.icon ?? car.code;
    const driverNumber = formatDriverNumber(car.driverNumber ?? driver?.driverNumber);
    const mode = this.overviewMode === 'driver' ? 'driver' : 'vehicle';
    const fields = this.getOverviewFields(driver, mode);
    const displayFields = fields.length > 0
      ? fields
      : [{ label: mode === 'driver' ? 'Driver fields' : 'Car fields', value: 'No custom fields' }];
    const imageSrc = mode === 'driver'
      ? (driver?.driverImage ?? driver?.portrait ?? driver?.avatar ?? this.assets.driverHelmet)
      : this.assets.carOverview;
    const overviewCode = mode === 'driver'
      ? `${car.code} driver`
      : `${driver?.vehicle?.name ?? car.vehicleName ?? car.code}`;
    const overviewKey = JSON.stringify({
      id: car.id,
      mode,
      color: car.color,
      code: car.code,
      icon,
      driverNumber,
      imageSrc,
      overviewCode,
      fields: displayFields.map((field) => [field.label, field.value]),
    });
    if (overviewKey === this.lastOverviewRenderKey) return;
    this.lastOverviewRenderKey = overviewKey;

    this.readouts.carOverview?.style.setProperty('--driver-color', car.color);
    this.readouts.carOverviewDiagram?.style.setProperty('--driver-color', car.color);
    if (this.readouts.carOverviewTitle) {
      this.readouts.carOverviewTitle.textContent = mode === 'driver' ? 'Driver overview' : 'Car overview';
    }
    if (this.readouts.carOverviewCode) {
      this.readouts.carOverviewCode.textContent = overviewCode;
    }
    if (this.readouts.carOverviewIcon) this.readouts.carOverviewIcon.textContent = icon;
    if (this.readouts.carOverviewImage) {
      this.readouts.carOverviewImage.src = imageSrc;
    }
    if (this.readouts.carOverviewNumber) this.readouts.carOverviewNumber.textContent = driverNumber;
    if (this.readouts.carOverviewCoreStat) this.readouts.carOverviewCoreStat.textContent = mode === 'driver' ? 'Driver' : 'Car';
    this.readouts.carOverviewFields.forEach((fieldNode, index) => {
      const field = displayFields[index];
      fieldNode.hidden = !field;
      if (!field) return;
      const labelNode = fieldNode.querySelector('[data-overview-field-label]');
      const valueNode = fieldNode.querySelector('[data-overview-field-value]');
      setText(labelNode, field.label);
      setText(valueNode, field.value);
    });
    this.updateOverviewModeButtons();
  }

  renderRaceData(car) {
    if (!car || !this.readouts.raceDataPanel || !this.isRaceDataBannerEnabled('project')) return;
    const driver = this.drivers.find((item) => item.id === car.id);
    if (!driver) return;

    this.readouts.raceDataPanel.style.setProperty('--driver-color', driver.color);
    this.readouts.raceDataPanel.classList.remove('is-hidden');
    this.readouts.raceDataPanel.classList.add('is-project-mode');
    this.readouts.raceDataPanel.classList.remove('is-radio-mode');
    this.readouts.raceDataPanel.removeAttribute('data-idle-mode');
    setText(this.readouts.raceDataKicker, 'Project');
    setText(this.readouts.raceDataTitle, driver.name);
    if (this.readouts.raceDataNumber) {
      this.readouts.raceDataNumber.textContent = formatDriverNumber(car.driverNumber ?? driver.driverNumber);
    }
    if (this.readouts.raceDataSubtitle) {
      this.readouts.raceDataSubtitle.textContent = `${car.code} - P${car.rank} - ${driver.raceData?.[0] ?? 'Project entry'}`;
    }
    if (this.readouts.raceDataOpen) {
      this.readouts.raceDataOpen.hidden = typeof this.options.onDriverOpen !== 'function';
    }
  }

  renderProjectRadio(now = performance.now()) {
    if (!this.readouts.raceDataPanel) return;
    if (!this.isRaceDataBannerEnabled('radio')) {
      this.hideRaceDataPanel();
      return;
    }
    this.updateRadioSchedule(now);
    if (!this.radioState.visible) {
      this.hideRaceDataPanel();
      return;
    }

    const radio = this.getProjectRadioQuote();

    this.readouts.raceDataPanel.style.setProperty('--driver-color', radio.color);
    this.readouts.raceDataPanel.classList.remove('is-hidden');
    this.readouts.raceDataPanel.classList.add('is-radio-mode');
    this.readouts.raceDataPanel.classList.remove('is-project-mode');
    this.readouts.raceDataPanel.dataset.idleMode = 'quote';
    setText(this.readouts.raceDataKicker, 'Project radio');
    setText(this.readouts.raceDataTitle, radio.title);
    setText(this.readouts.raceDataNumber, '');
    setText(this.readouts.raceDataSubtitle, radio.subtitle);
    if (this.readouts.raceDataOpen) this.readouts.raceDataOpen.hidden = true;
  }

  hideRaceDataPanel() {
    if (!this.readouts.raceDataPanel) return;
    this.readouts.raceDataPanel.classList.add('is-hidden');
    this.readouts.raceDataPanel.classList.remove('is-project-mode', 'is-radio-mode');
    this.readouts.raceDataPanel.removeAttribute('data-idle-mode');
    if (this.readouts.raceDataOpen) this.readouts.raceDataOpen.hidden = true;
  }

  updateRadioSchedule(now) {
    if (!this.isRaceDataBannerEnabled('radio')) {
      this.radioState.visible = false;
      this.radioState.nextChangeAt = Number.POSITIVE_INFINITY;
      return;
    }
    if (
      Number.isFinite(this.radioState.nextChangeAt) &&
      now - this.radioState.nextChangeAt > RADIO_SCHEDULE_CATCHUP_LIMIT_MS
    ) {
      if (this.radioState.visible) this.scheduleRadioBreak(now);
      else this.scheduleRadioPopup(now);
      return;
    }
    while (now >= this.radioState.nextChangeAt) {
      if (this.radioState.visible) {
        this.scheduleRadioBreak(this.radioState.nextChangeAt);
      } else {
        this.scheduleRadioPopup(this.radioState.nextChangeAt);
      }
    }
  }

  scheduleRadioBreak(now) {
    this.radioState.visible = false;
    this.radioState.nextChangeAt = this.getNextRadioBreakTime(now);
  }

  scheduleRadioPopup(now) {
    if (!this.isRaceDataBannerEnabled('radio')) {
      this.scheduleRadioBreak(now);
      return;
    }
    const driverIndex = Math.floor(this.nextRadioRandom() * this.drivers.length);
    const driver = this.drivers[driverIndex] ?? this.drivers[0];
    const quoteCount = Math.max(1, driver.raceData?.length ?? 1);
    this.radioState.visible = true;
    this.radioState.driverIndex = driverIndex;
    this.radioState.quoteIndex = Math.floor(this.nextRadioRandom() * quoteCount);
    this.radioState.nextChangeAt = now + this.randomRadioRange(RADIO_VISIBLE_MIN_MS, RADIO_VISIBLE_MAX_MS);
  }

  randomRadioRange(min, max) {
    return min + this.nextRadioRandom() * (max - min);
  }

  nextRadioRandom() {
    this.radioRandomState = (Math.imul(1664525, this.radioRandomState) + 1013904223) >>> 0;
    return this.radioRandomState / 0x100000000;
  }

  getNextRadioBreakTime(now) {
    return this.isRaceDataBannerEnabled('radio')
      ? now + this.randomRadioRange(RADIO_BREAK_MIN_MS, RADIO_BREAK_MAX_MS)
      : Number.POSITIVE_INFINITY;
  }

  resetRaceDataBannerState(now = performance.now()) {
    const initialRaceDataMode = this.raceDataBannerConfig.initial ?? 'project';
    this.activeRaceDataId = this.isRaceDataBannerEnabled('project') && initialRaceDataMode === 'project'
      ? this.selectedId
      : null;
    this.lastRaceDataInteraction = now;
    const showInitialRadio = this.isRaceDataBannerEnabled('radio') && initialRaceDataMode === 'radio';
    this.radioState.visible = showInitialRadio;
    this.radioState.nextChangeAt = showInitialRadio
      ? now + this.randomRadioRange(RADIO_VISIBLE_MIN_MS, RADIO_VISIBLE_MAX_MS)
      : this.getNextRadioBreakTime(now);
    this.radioState.driverIndex = 0;
    this.radioState.quoteIndex = 0;
  }

  isRaceDataBannerEnabled(kind) {
    return this.raceDataBannerConfig.enabled?.includes(kind) ?? true;
  }

  getProjectRadioQuote() {
    const driver = this.drivers[this.radioState.driverIndex] ?? this.drivers[0];
    const quote = driver.raceData?.[this.radioState.quoteIndex] ?? 'Project entry';

    return {
      color: driver.color,
      title: driver.name,
      subtitle: `${driver.code} - "${quote}"`,
    };
  }

  updateCameraControls() {
    this.cameraButtons.forEach((button) => {
      const isActive = button.dataset.cameraMode === this.camera.mode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  updateOverviewModeButtons() {
    this.overviewModeButtons.forEach((button) => {
      const isActive = button.dataset.overviewMode === this.overviewMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  syncSafetyCarControls(active) {
    this.safetyButtons.forEach((button) => {
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  applyExpertOptions(nextOptions = {}) {
    this.options = {
      ...this.options,
      ...nextOptions,
      ui: {
        ...this.options.ui,
        ...(nextOptions.ui ?? {}),
        raceDataBanners: {
          ...this.options.ui.raceDataBanners,
          ...(nextOptions.ui?.raceDataBanners ?? {}),
        },
      },
      assets: {
        ...this.options.assets,
        ...(nextOptions.assets ?? {}),
        trackTextures: {
          ...this.options.assets.trackTextures,
          ...(nextOptions.assets?.trackTextures ?? {}),
        },
      },
    };
    this.assets = this.options.assets;
    if (hasOwnOption(nextOptions, 'trackSeed')) {
      this.trackSeed = this.options.trackSeed ?? createMountTrackSeed();
    }
    if (nextOptions.drivers) {
      this.drivers = nextOptions.drivers;
      this.driverById = new Map(this.drivers.map((driver) => [driver.id, driver]));
      this.root.style.setProperty('--paddock-entry-count', String(this.drivers.length));
      this.createCars();
    }
  }

  restart(nextOptions = {}) {
    if (hasOwnOption(nextOptions, 'assets') && !assetSetsEqual(nextOptions.assets, this.options.assets)) {
      throw new Error('PaddockJS restart() does not support changing assets. Destroy and mount a new simulator with the new assets.');
    }
    if (hasOwnOption(nextOptions, 'expert') && expertOptionsChanged(nextOptions.expert, this.options.expert)) {
      throw new Error('PaddockJS restart() does not support changing expert mode. Destroy and mount a new simulator with the new expert options.');
    }
    this.applyExpertOptions(nextOptions);
    this.raceDataBannerConfig = this.options.ui?.raceDataBanners ?? this.raceDataBannerConfig;
    this.root.style.setProperty('--broadcast-panel-surface', `url('${this.assets.broadcastPanel}')`);
    applyPaddockThemeCssVariables(this.root, this.options.theme);
    this.sim = this.createRaceSimulation();
    if (this.expertMode) {
      this.expert = createBrowserExpertAdapter(this, this.options.expert);
    }
    this.selectedId = this.drivers[0]?.id ?? null;
    this.lastTimingMarkup = null;
    this.lastOverviewRenderKey = null;
    this.lastFinishClassificationMarkup = null;
    this.resetRaceDataBannerState(performance.now());
    this.lastTimingRenderTime = 0;
    this.lastTimingRaceMode = null;
    this.lastLeaderLap = null;
    this.emittedRaceEventKeys.clear();
    this.raceFinishEmitted = false;
    this.renderTrack();
    this.updateDom(this.sim.snapshot());
  }

  setSafetyCarDeployed(deployed) {
    this.sim?.setSafetyCar(Boolean(deployed));
    const active = this.sim?.snapshot().raceControl.mode === 'safety-car';
    this.syncSafetyCarControls(active);
  }

  getSnapshot() {
    return this.sim?.snapshot() ?? null;
  }

  destroy() {
    this.abortController.abort();
    this.layoutResizeObserver?.disconnect?.();
    this.layoutResizeObserver = null;
    this.visibilityObserver?.disconnect?.();
    this.visibilityObserver = null;
    if (this.app && this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
    }
    this.app?.destroy(true, { children: true, texture: false });
    this.app = null;
    this.carSprites.clear();
    this.carHitAreas.clear();
    this.drsTrails.clear();
  }
}
