import { Application, Container, Graphics } from 'pixi.js';
import { applyPaddockThemeCssVariables } from '../config/defaultOptions.js';
import { ProceduralTrackAsset } from '../rendering/proceduralTrackAsset.js';
import { createRenderSnapshot } from '../rendering/renderSnapshot.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { clamp } from '../simulation/simMath.js';
import { WORLD } from '../simulation/track/trackModel.js';
import { CameraController } from './camera/cameraController.js';
import { createBrowserExpertAdapter } from './BrowserExpertAdapter.js';
import { querySimulatorDom } from './domBindings.js';
import { loadAppTextures } from './rendering/appAssets.js';
import { CarRenderer } from './rendering/carRenderer.js';
import { DrsTrailRenderer } from './rendering/drsTrailRenderer.js';
import { renderExpertSensorRays } from './rendering/expertSensorRenderer.js';
import { PitLaneStatusRenderer } from './rendering/pitLaneStatusRenderer.js';
import { ReplayGhostRenderer } from './rendering/replayGhostRenderer.js';
import { renderTrackSurface } from './rendering/trackRenderer.js';
import {
  formatLapGap,
  formatRaceGap,
  getPenaltyByDriver,
  getTimingOrderKey,
  getTimingPenaltyKey,
  isWavedFlagCar,
  renderTimingTower,
  syncTimingGapModeControls,
} from './readouts/timingTowerRenderer.js';
import { formatTelemetryGap } from './readouts/readoutFormatters.js';
import { getOverviewFields, renderCarDriverOverview } from './readouts/carOverviewRenderer.js';
import { renderLapTelemetry, renderTelemetryReadouts } from './readouts/telemetryRenderer.js';
import {
  renderRaceFinish,
  renderRaceStatusReadouts,
  renderStartLights,
} from './readouts/raceStatusRenderer.js';
import {
  updateCameraControlButtons,
  updateModeButtons,
  updateToggleButtons,
} from './readouts/controlStateRenderer.js';
import {
  createPenaltyStewardMessage,
  createWarningStewardMessage,
  renderActiveStewardMessage,
  updateStewardMessageState,
} from './banners/stewardMessageController.js';
import {
  hideRaceDataPanel,
  getProjectRadioQuote,
  RACE_DATA_SELECTED_VISIBLE_MS,
  RADIO_SCHEDULE_CATCHUP_LIMIT_MS,
  renderProjectRadio,
  renderRaceData,
  resetRaceDataBannerState,
  scheduleRadioBreak,
  scheduleRadioPopup,
  shouldAutoHideActiveRaceData,
  getNextRadioBreakTime,
} from './banners/raceDataBannerController.js';
import { runFrameLoopTick } from './runtime/frameLoop.js';
import { observeRuntimeVisibility, syncRuntimeTicker } from './runtime/runtimeVisibility.js';
import { TARGET_FRAME_MS, timingUpdateIntervalForSpeed } from './runtime/runtimeTiming.js';

const SIMULATION_SPEED_STEPS = [1, 2, 3, 4, 5, 10];
const DRS_DRAG_REDUCTION_PERCENT = 58;

function createMountTrackSeed() {
  const values = new Uint32Array(1);
  try {
    globalThis.crypto?.getRandomValues?.(values);
  } catch {
    values[0] = 0;
  }
  return (values[0] || Math.floor(Date.now() + performance.now() * 1000)) >>> 0;
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
    this.cameraController = null;
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
    this.pitLaneStatusLayer = null;
    this.replayGhostLayer = null;
    this.carLayer = null;
    this.textures = {};
    this.carSprites = new Map();
    this.carHitAreas = new Map();
    this.serviceCountdownLabels = new Map();
    this.carRenderer = new CarRenderer({
      carSprites: this.carSprites,
      carHitAreas: this.carHitAreas,
      serviceCountdownLabels: this.serviceCountdownLabels,
      onSelectCar: (driverId) => this.selectCar(driverId, { focus: true }),
    });
    this.drsTrails = new Map();
    this.drsTrailRenderer = new DrsTrailRenderer({ trails: this.drsTrails });
    this.replayGhostRenderer = new ReplayGhostRenderer();
    this.pitLaneStatusRenderer = new PitLaneStatusRenderer();
    this.trackSeed = options.trackSeed ?? createMountTrackSeed();
    this.selectedId = this.drivers[0]?.id ?? null;
    this.raceDataBannerConfig = options.ui?.raceDataBanners ?? { initial: 'project', enabled: ['project', 'radio'] };
    this.raceDataBannersMuted = false;
    this.penaltyBannerEnabled = Boolean(options.ui?.penaltyBanners);
    this.timingPenaltyBadgesEnabled = Boolean(options.ui?.timingPenaltyBadges);
    this.activeRaceDataId = null;
    this.activePenaltyBanner = null;
    this.lastPenaltyBannerId = null;
    this.activeStewardMessage = null;
    this.lastStewardMessageKey = null;
    this.lastRaceDataInteraction = performance.now();
    this.radioRandomState = (this.trackSeed ^ 0x9e3779b9) >>> 0;
    this.radioState = {
      visible: false,
      nextChangeAt: Number.POSITIVE_INFINITY,
      driverIndex: 0,
      quoteIndex: 0,
    };
    this.resetRaceDataBannerState(this.lastRaceDataInteraction);
    this.cameraController = new CameraController({
      canvasHost: this.canvasHost,
      readouts: this.readouts,
      initialMode: options.initialCameraMode,
    });
    this.camera = this.cameraController.camera;
    this.overviewMode = 'vehicle';
    this.simulationSpeed = 1;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.nextGameFrameTime = this.lastTime + TARGET_FRAME_MS;
    this.lastDomUpdateTime = 0;
    this.lastTimingRenderTime = 0;
    this.lastTimingRaceMode = null;
    this.lastTimingPenaltyKey = '';
    this.lastTimingOrderKey = '';
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
      this.pitLaneStatusLayer = new Graphics();
      this.replayGhostLayer = new Container();
      this.carLayer = new Container();
      this.app.stage.addChild(this.worldLayer);

      await this.loadAssets();
      this.trackAsset = new ProceduralTrackAsset({ textures: this.textures, world: WORLD });
      this.worldLayer.addChild(
        this.trackAsset.container,
        this.drsLayer,
        this.trailLayer,
        this.pitLaneStatusLayer,
        this.sensorLayer,
        this.replayGhostLayer,
        this.carLayer,
      );
      this.createCars();
      this.bindControls();
      this.renderTrack();
      const snapshot = this.sim.snapshot();
      this.updateDom(snapshot);
      this.lastDomUpdateTime = performance.now();
      if (this.expertMode) {
        this.expert = createBrowserExpertAdapter(this, this.options.expert);
      }
      this.renderInitialFrame(snapshot);
      this.completeComponentLoading();
      this.emitHostCallback('onLoadingChange', { loading: false, phase: 'ready' });
      this.emitHostCallback('onReady', { snapshot });
      this.resizeHandler = () => this.applyCamera(this.sim.snapshotRender?.() ?? this.sim.snapshot());
      window.addEventListener('resize', this.resizeHandler, { signal: this.abortController.signal });
      this.observeLayoutResize();
      if (!this.expertMode) {
        this.resetFrameClock();
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
      rules: options.rules,
      participantInteractions: options.participantInteractions,
      replayGhosts: options.replayGhosts,
    });
  }

  async loadAssets() {
    this.textures = await loadAppTextures(this.assets);
  }

  createCars() {
    this.drsTrails.clear();
    this.carRenderer.createCars({
      drivers: this.drivers,
      textures: this.textures,
      carLayer: this.carLayer,
    });
  }

  createRawCarGeometryGraphic(driver) {
    return this.carRenderer.createRawCarGeometryGraphic(driver);
  }

  createServiceCountdownLabel() {
    return this.carRenderer.createServiceCountdownLabel();
  }

  applyServiceCountdownTone(label, tone) {
    this.carRenderer.applyServiceCountdownTone(label, tone);
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
      this.lastTimingPenaltyKey = '';
      this.lastTimingOrderKey = '';
      this.renderTrack();
    }, eventOptions);

    this.cameraButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.setCameraMode(button.dataset.cameraMode);
      }, eventOptions);
    });

    this.zoomInButton?.addEventListener('click', () => {
      this.adjustCameraZoom(1);
    }, eventOptions);

    this.zoomOutButton?.addEventListener('click', () => {
      this.adjustCameraZoom(-1);
    }, eventOptions);

    this.simulationSpeedButtons?.forEach((button) => {
      button.addEventListener('click', () => {
        this.cycleSimulationSpeed();
      }, eventOptions);
    });
    this.updateSimulationSpeedControls();

    this.bannerMuteButtons?.forEach((button) => {
      button.addEventListener('click', () => {
        this.setRaceDataBannersMuted(!this.raceDataBannersMuted);
      }, eventOptions);
    });

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
        if (snapshot) this.renderTiming(snapshot.cars, snapshot.raceControl.mode, snapshot.penalties ?? []);
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

    this.readouts.raceDataDismiss?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dismissRaceDataPanel(performance.now());
    }, eventOptions);

    this.readouts.telemetryDrawerToggle?.addEventListener('click', () => {
      this.setTelemetryDrawerOpen(!this.telemetryDrawerOpen);
    }, eventOptions);

    this.bindCameraWheelControls(eventOptions);
  }

  setCameraMode(mode) {
    const snapshot = this.sim?.snapshot?.();
    if (!this.cameraController.setMode(mode, snapshot)) return false;
    this.updateCameraControls(snapshot);
    return true;
  }

  adjustCameraZoom(direction) {
    this.cameraController.adjustZoom(direction);
    this.updateCameraControls();
    return this.camera.zoom;
  }

  cycleSimulationSpeed() {
    const currentIndex = SIMULATION_SPEED_STEPS.indexOf(this.simulationSpeed);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % SIMULATION_SPEED_STEPS.length
      : 0;
    this.simulationSpeed = SIMULATION_SPEED_STEPS[nextIndex];
    this.updateSimulationSpeedControls();
    return this.simulationSpeed;
  }

  updateSimulationSpeedControls() {
    this.simulationSpeedButtons?.forEach((button) => {
      const label = `${this.simulationSpeed}x`;
      button.textContent = label;
      button.setAttribute?.('aria-label', `Simulation speed ${label}`);
    });
  }

  bindCameraWheelControls(eventOptions) {
    if (!this.canvasHost?.addEventListener) return;
    this.canvasHost.addEventListener('wheel', (event) => {
      event.preventDefault?.();
      this.adjustCameraZoom(event.deltaY > 0 ? -1 : 1);
    }, { ...eventOptions, passive: false });
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
    this.syncRendererToCurrentLayout({ render: true });
    this.scheduleLayoutResizeSync(380);
  }

  setRaceDataBannersMuted(muted, now = performance.now()) {
    this.raceDataBannersMuted = Boolean(muted);
    if (this.raceDataBannersMuted) {
      this.activeRaceDataId = null;
      this.radioState.visible = false;
      this.radioState.nextChangeAt = Number.POSITIVE_INFINITY;
      this.hideRaceDataPanel();
    } else {
      this.resetRaceDataBannerState(now);
    }
    this.updateBannerMuteControls();
  }

  resizeRendererToCanvasHost() {
    if (!this.app?.renderer?.resize || !this.canvasHost) return;
    const width = Math.max(1, Math.round(this.canvasHost.clientWidth || 0));
    const height = Math.max(1, Math.round(this.canvasHost.clientHeight || 0));
    this.app.renderer.resize(width, height);
  }

  renderInitialFrame(snapshot) {
    const renderSnapshot = createRenderSnapshot(snapshot, 0);
    this.resizeRendererToCanvasHost();
    this.applyCamera(renderSnapshot, { immediate: true });
    this.renderDrsTrails(renderSnapshot);
    this.renderPitLaneStatus(renderSnapshot);
    this.renderCars(renderSnapshot);
    this.app?.render?.();
  }

  syncRendererToCurrentLayout({ render = false } = {}) {
    this.resizeRendererToCanvasHost();
    const snapshot = this.sim?.snapshotRender?.() ?? this.sim?.snapshot?.();
    if (!snapshot) return;
    const renderSnapshot = createRenderSnapshot(snapshot, clamp(this.accumulator / FIXED_STEP, 0, 1));
    this.applyCamera(renderSnapshot);
    if (render) {
      this.renderDrsTrails(renderSnapshot);
      this.renderPitLaneStatus(renderSnapshot);
      this.renderCars(renderSnapshot);
      this.app?.render?.();
    }
  }

  scheduleLayoutResizeSync(durationMs = 360) {
    if (typeof requestAnimationFrame !== 'function') return;
    const startedAt = performance.now();
    const run = (timestamp = performance.now()) => {
      this.syncRendererToCurrentLayout({ render: true });
      if (timestamp - startedAt < durationMs) {
        this.layoutResizeFrame = requestAnimationFrame(run);
      }
    };
    this.layoutResizeFrame = requestAnimationFrame(run);
  }

  observeLayoutResize() {
    if (typeof ResizeObserver !== 'function') return;
    this.layoutResizeObserver?.disconnect?.();
    this.layoutResizeObserver = new ResizeObserver(() => {
      this.invalidateCameraSafeArea();
      this.syncRendererToCurrentLayout({ render: true });
    });
    if (this.canvasHost) this.layoutResizeObserver.observe(this.canvasHost);
    if (this.readouts.timingTower) this.layoutResizeObserver.observe(this.readouts.timingTower);
  }

  invalidateCameraSafeArea() {
    this.cameraController.invalidateSafeArea();
  }

  observeRuntimeVisibility() {
    observeRuntimeVisibility(this);
  }

  syncRuntimeTicker() {
    syncRuntimeTicker(this);
  }

  resetFrameClock(now = performance.now()) {
    this.accumulator = 0;
    this.lastTime = now;
    this.nextGameFrameTime = now + TARGET_FRAME_MS;
    this.fps.current = 0;
    this.fps.frames = 0;
    this.fps.lastSample = now;
  }

  tick() {
    runFrameLoopTick(this);
  }

  renderExpertFrame(snapshot = this.sim?.snapshot(), { observation } = {}) {
    if (!snapshot) return;
    const renderSnapshot = createRenderSnapshot(snapshot, 0);
    this.applyCamera(renderSnapshot);
    this.renderDrsTrails(renderSnapshot);
    this.renderExpertSensorRays(renderSnapshot, observation);
    this.renderPitLaneStatus(renderSnapshot);
    this.renderCars(renderSnapshot);
    this.updateDom(snapshot, { emitLifecycle: false });
    this.lastDomUpdateTime = performance.now();
  }

  renderTrack() {
    this.pitLaneStatusRenderer.reset();
    this.cameraController.invalidateTrackCaches();
    const snapshot = this.sim.snapshot();
    renderTrackSurface({
      drsLayer: this.drsLayer,
      sensorLayer: this.sensorLayer,
      pitLaneStatusLayer: this.pitLaneStatusLayer,
      trackAsset: this.trackAsset,
      snapshot,
    });
  }

  renderPitLaneStatus(snapshot) {
    this.pitLaneStatusRenderer.render(snapshot, this.pitLaneStatusLayer);
  }

  renderCars(snapshot) {
    this.replayGhostRenderer.render(snapshot, {
      textures: this.textures,
      replayGhostLayer: this.replayGhostLayer,
    });
    this.carRenderer.renderCars(snapshot, {
      textures: this.textures,
      carLayer: this.carLayer,
    });
  }

  renderServiceCountdownLabel(car) {
    this.carRenderer.renderServiceCountdownLabel(car);
  }

  renderExpertSensorRays(snapshot, observation) {
    renderExpertSensorRays({
      snapshot,
      observation,
      sensorLayer: this.sensorLayer,
      expertMode: this.expertMode,
      expertOptions: this.options.expert,
    });
  }

  renderDrsTrails(snapshot) {
    this.drsTrailRenderer.render(snapshot, this.trailLayer);
  }

  applyCamera(snapshot, { immediate = false } = {}) {
    this.cameraController.applyToWorldLayer(this.worldLayer, snapshot, {
      immediate,
      selectedId: this.selectedId,
    });
  }

  getCameraSafeArea(width) {
    return this.cameraController.getSafeArea(width);
  }

  getCameraFrame(snapshot, width, height, baseScale, safeArea = { left: 0, width }) {
    return this.cameraController.getFrame(snapshot, width, height, baseScale, safeArea, this.selectedId);
  }

  getCameraTarget(snapshot) {
    return this.cameraController.getTarget(snapshot, this.selectedId);
  }

  getTrackCameraBounds(track) {
    return this.cameraController.getTrackBounds(track);
  }

  getCameraBoundsFitScale(bounds, height, safeArea) {
    return this.cameraController.getBoundsFitScale(bounds, height, safeArea);
  }

  getPitCameraBounds(pitLane) {
    return this.cameraController.getPitBounds(pitLane);
  }

  getPitCameraFrame(pitLane, height, baseScale, safeArea, screenCenterX, minimumScale = null) {
    return this.cameraController.getPitFrame(pitLane, height, baseScale, safeArea, screenCenterX, minimumScale);
  }

  updateDom(snapshot, { emitLifecycle = true } = {}) {
    const leader = snapshot.cars[0];
    const selected = snapshot.cars.find((car) => car.id === this.selectedId) ?? leader;
    const activeDrs = snapshot.cars.filter((car) => car.drsActive).length;
    const contactCount = snapshot.events.filter((event) => event.type === 'contact').length;
    const now = performance.now();

    if (emitLifecycle) this.emitSnapshotLifecycle(snapshot);

    if (
      this.shouldAutoHideActiveRaceData() &&
      now - this.lastRaceDataInteraction > RACE_DATA_SELECTED_VISIBLE_MS
    ) {
      this.activeRaceDataId = null;
      if (this.isRaceDataBannerEnabled('radio')) this.scheduleRadioBreak(now);
    }
    this.updateStewardMessageState(snapshot, now);

    this.syncSafetyCarControls(snapshot.raceControl.mode === 'safety-car');
    this.lastFinishClassificationMarkup = renderRaceStatusReadouts({
      readouts: this.readouts,
      startLightNodes: this.startLightNodes,
      snapshot,
      camera: this.camera,
      fps: this.fps,
      activeDrs,
      contactCount,
      driverById: this.driverById,
      lastFinishClassificationMarkup: this.lastFinishClassificationMarkup,
    });

    this.updateCameraControls(snapshot);
    this.syncTimingGapModeControls();
    const timingPenaltyKey = this.getTimingPenaltyKey(snapshot.penalties ?? []);
    const timingOrderKey = this.getTimingOrderKey(snapshot.cars);
    const timingUpdateInterval = timingUpdateIntervalForSpeed(this.simulationSpeed);
    if (
      now - this.lastTimingRenderTime >= timingUpdateInterval ||
      this.lastTimingRaceMode !== snapshot.raceControl.mode ||
      this.lastTimingPenaltyKey !== timingPenaltyKey ||
      this.lastTimingOrderKey !== timingOrderKey
    ) {
      this.renderTiming(snapshot.cars, snapshot.raceControl.mode, snapshot.penalties ?? []);
      this.lastTimingRenderTime = now;
      this.lastTimingRaceMode = snapshot.raceControl.mode;
      this.lastTimingPenaltyKey = timingPenaltyKey;
      this.lastTimingOrderKey = timingOrderKey;
    }
    this.renderTelemetry(selected);
    const activeRaceDataCar = this.activeRaceDataId
      ? snapshot.cars.find((car) => car.id === this.activeRaceDataId)
      : null;
    this.renderActiveStewardMessage();
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

    this.emitRaceEvents(snapshot.events, snapshot);

    if (snapshot.raceControl.finished && !this.raceFinishEmitted) {
      this.raceFinishEmitted = true;
      this.emitHostCallback('onRaceFinish', {
        winner: snapshot.raceControl.winner,
        classification: snapshot.raceControl.classification ?? [],
        snapshot,
      });
    }
  }

  emitRaceEvents(events = [], snapshot) {
    events.forEach((event) => {
      const key = `${event.type}:${event.at ?? snapshot.time}:${event.carId ?? ''}:${event.otherCarId ?? ''}:${event.winnerId ?? ''}`;
      if (this.emittedRaceEventKeys.has(key)) return;
      this.emittedRaceEventKeys.add(key);
      this.emitHostCallback('onRaceEvent', event, snapshot);
    });
  }

  renderRaceFinish(snapshot) {
    this.lastFinishClassificationMarkup = renderRaceFinish({
      readouts: this.readouts,
      snapshot,
      driverById: this.driverById,
      lastFinishClassificationMarkup: this.lastFinishClassificationMarkup,
    });
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
    renderStartLights(this.readouts, this.startLightNodes, raceControl);
  }

  selectCar(id, { focus = false } = {}) {
    this.selectedId = id;
    this.activeRaceDataId = this.isRaceDataBannerEnabled('project') ? id : null;
    this.lastRaceDataInteraction = performance.now();
    if (this.isRaceDataBannerEnabled('radio')) this.scheduleRadioBreak(this.lastRaceDataInteraction);
    if (focus) {
      this.setCameraMode('selected');
    }
    this.lastTimingRenderTime = 0;
    const snapshot = this.sim.snapshot();
    this.updateDom(snapshot);
    const driver = this.driverById.get(id);
    if (driver) this.emitHostCallback('onDriverSelect', driver, snapshot);
  }

  renderTiming(cars, raceMode, penalties = []) {
    this.syncTimingGapModeControls();
    this.lastTimingMarkup = renderTimingTower({
      timingList: this.timingList,
      cars,
      raceMode,
      penalties,
      driverById: this.driverById,
      selectedId: this.selectedId,
      timingGapMode: this.timingGapMode,
      timingPenaltyBadgesEnabled: this.timingPenaltyBadgesEnabled,
      lastTimingMarkup: this.lastTimingMarkup,
    });
  }

  getTimingOrderKey(cars = []) {
    return getTimingOrderKey(cars, { timingGapMode: this.timingGapMode });
  }

  isWavedFlagCar(car) {
    return isWavedFlagCar(car);
  }

  getPenaltyByDriver(penalties = []) {
    return getPenaltyByDriver(penalties);
  }

  getTimingPenaltyKey(penalties = []) {
    return getTimingPenaltyKey(penalties, {
      timingPenaltyBadgesEnabled: this.timingPenaltyBadgesEnabled,
    });
  }

  formatTimingGap(car) {
    return formatRaceGap(car, this.timingGapMode);
  }

  formatLapGap(laps) {
    return formatLapGap(laps);
  }

  formatTelemetryGap(car, mode) {
    return formatTelemetryGap(car, mode);
  }

  syncTimingGapModeControls() {
    syncTimingGapModeControls({
      readouts: this.readouts,
      buttons: this.timingGapModeButtons,
      timingGapMode: this.timingGapMode,
    });
  }

  renderTelemetry(car) {
    renderTelemetryReadouts({
      readouts: this.readouts,
      car,
      driverById: this.driverById,
    });
    this.renderCarDriverOverview(car);
    this.renderLapTelemetry(car.lapTelemetry);
  }

  renderLapTelemetry(telemetry) {
    renderLapTelemetry(this.readouts, telemetry);
  }

  getOverviewFields(driver, mode) {
    return getOverviewFields(driver, mode);
  }

  renderCarDriverOverview(car) {
    const previousKey = this.lastOverviewRenderKey;
    this.lastOverviewRenderKey = renderCarDriverOverview({
      readouts: this.readouts,
      car,
      driverById: this.driverById,
      assets: this.assets,
      overviewMode: this.overviewMode,
      lastOverviewRenderKey: this.lastOverviewRenderKey,
    });
    if (this.lastOverviewRenderKey !== previousKey) this.updateOverviewModeButtons();
  }

  renderRaceData(car) {
    renderRaceData({
      car,
      drivers: this.drivers,
      readouts: this.readouts,
      options: {
        ...this.options,
        isRaceDataBannerEnabled: (kind) => this.isRaceDataBannerEnabled(kind),
      },
    });
  }

  shouldAutoHideActiveRaceData() {
    return shouldAutoHideActiveRaceData({
      activeRaceDataId: this.activeRaceDataId,
      options: this.options,
      readouts: this.readouts,
    });
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

    renderProjectRadio({
      readouts: this.readouts,
      radio: this.getProjectRadioQuote(),
    });
  }

  hideRaceDataPanel() {
    hideRaceDataPanel(this.readouts);
  }

  dismissRaceDataPanel(now = performance.now()) {
    this.activeRaceDataId = null;
    this.lastRaceDataInteraction = now;
    this.radioState.visible = false;
    this.radioState.nextChangeAt = this.getNextRadioBreakTime(now);
    this.hideRaceDataPanel();
  }

  updateStewardMessageState(snapshot, now = performance.now()) {
    const state = updateStewardMessageState({
      snapshot,
      now,
      state: {
        activeStewardMessage: this.activeStewardMessage,
        lastPenaltyBannerId: this.lastPenaltyBannerId,
        lastStewardMessageKey: this.lastStewardMessageKey,
      },
      driverById: this.driverById,
      penaltyBannerEnabled: this.penaltyBannerEnabled,
      stewardMessageNode: this.readouts.stewardMessage,
    });
    this.activeStewardMessage = state.activeStewardMessage;
    this.lastPenaltyBannerId = state.lastPenaltyBannerId;
    this.lastStewardMessageKey = state.lastStewardMessageKey;
  }

  createPenaltyStewardMessage(penalty) {
    return createPenaltyStewardMessage(penalty, this.driverById);
  }

  createWarningStewardMessage(event) {
    return createWarningStewardMessage(event, this.driverById);
  }

  renderActiveStewardMessage() {
    renderActiveStewardMessage(this.readouts, this.activeStewardMessage);
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
    scheduleRadioBreak({
      radioState: this.radioState,
      now,
      isEnabled: (kind) => this.isRaceDataBannerEnabled(kind),
      nextRandom: () => this.nextRadioRandom(),
    });
  }

  scheduleRadioPopup(now) {
    scheduleRadioPopup({
      radioState: this.radioState,
      now,
      drivers: this.drivers,
      isEnabled: (kind) => this.isRaceDataBannerEnabled(kind),
      nextRandom: () => this.nextRadioRandom(),
    });
  }

  nextRadioRandom() {
    this.radioRandomState = (Math.imul(1664525, this.radioRandomState) + 1013904223) >>> 0;
    return this.radioRandomState / 0x100000000;
  }

  getNextRadioBreakTime(now) {
    return getNextRadioBreakTime({
      now,
      isEnabled: (kind) => this.isRaceDataBannerEnabled(kind),
      nextRandom: () => this.nextRadioRandom(),
    });
  }

  resetRaceDataBannerState(now = performance.now()) {
    resetRaceDataBannerState({
      state: this,
      now,
      initialMode: this.raceDataBannerConfig.initial ?? 'project',
      selectedId: this.selectedId,
      isEnabled: (kind) => this.isRaceDataBannerEnabled(kind),
      nextRandom: () => this.nextRadioRandom(),
    });
  }

  isRaceDataBannerEnabled(kind) {
    return !this.raceDataBannersMuted && (this.raceDataBannerConfig.enabled?.includes(kind) ?? true);
  }

  getProjectRadioQuote() {
    return getProjectRadioQuote({
      drivers: this.drivers,
      radioState: this.radioState,
    });
  }

  updateCameraControls(snapshot = this.sim?.snapshot?.()) {
    updateCameraControlButtons({
      camera: this.camera,
      cameraButtons: this.cameraButtons,
      snapshot,
      hasPitCamera: (currentSnapshot) => this.hasPitCamera(currentSnapshot),
      isCameraModeAvailable: (mode, currentSnapshot) => this.isCameraModeAvailable(mode, currentSnapshot),
    });
    this.updateBannerMuteControls();
  }

  updateBannerMuteControls() {
    updateToggleButtons(this.bannerMuteButtons, this.raceDataBannersMuted);
  }

  hasPitCamera(snapshot = this.sim?.snapshot?.()) {
    return this.cameraController.hasPitCamera(snapshot);
  }

  isCameraModeAvailable(mode, snapshot = this.sim?.snapshot?.()) {
    return this.cameraController.isModeAvailable(mode, snapshot);
  }

  updateOverviewModeButtons() {
    updateModeButtons(this.overviewModeButtons, this.overviewMode, 'overviewMode');
  }

  syncSafetyCarControls(active) {
    updateToggleButtons(this.safetyButtons, active);
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
    this.penaltyBannerEnabled = Boolean(this.options.ui?.penaltyBanners);
    this.timingPenaltyBadgesEnabled = Boolean(this.options.ui?.timingPenaltyBadges);
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
    this.lastTimingPenaltyKey = '';
    this.lastTimingOrderKey = '';
    this.activePenaltyBanner = null;
    this.lastPenaltyBannerId = null;
    this.activeStewardMessage = null;
    this.lastStewardMessageKey = null;
    this.lastLeaderLap = null;
    this.emittedRaceEventKeys.clear();
    this.raceFinishEmitted = false;
    this.renderTrack();
    const snapshot = this.sim.snapshot();
    this.updateDom(snapshot);
    this.lastDomUpdateTime = performance.now();
    this.renderInitialFrame(snapshot);
  }

  setSafetyCarDeployed(deployed) {
    this.sim?.setSafetyCar(Boolean(deployed));
    const active = this.sim?.snapshot().raceControl.mode === 'safety-car';
    this.syncSafetyCarControls(active);
  }

  setRedFlagDeployed(deployed) {
    this.sim?.setRedFlag?.(Boolean(deployed));
    if (this.sim) this.updateDom(this.sim.snapshot());
  }

  setPitLaneOpen(open) {
    this.sim?.setPitLaneOpen?.(Boolean(open));
    if (this.sim) this.updateDom(this.sim.snapshot());
  }

  setPitIntent(driverId, intent, targetCompound) {
    const applied = Boolean(this.sim?.setPitIntent?.(driverId, intent, targetCompound));
    if (applied) this.updateDom(this.sim.snapshot());
    return applied;
  }

  getPitIntent(driverId) {
    return this.sim?.getPitIntent?.(driverId) ?? 0;
  }

  getPitTargetCompound(driverId) {
    return this.sim?.getPitTargetCompound?.(driverId) ?? null;
  }

  servePenalty(penaltyId) {
    const penalty = this.sim?.servePenalty(penaltyId) ?? null;
    if (penalty) this.updateDom(this.sim.snapshot());
    return penalty;
  }

  cancelPenalty(penaltyId) {
    const penalty = this.sim?.cancelPenalty(penaltyId) ?? null;
    if (penalty) this.updateDom(this.sim.snapshot());
    return penalty;
  }

  getSnapshot() {
    return this.sim?.snapshot() ?? null;
  }

  destroy() {
    this.abortController.abort();
    if (this.layoutResizeFrame && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.layoutResizeFrame);
    }
    this.layoutResizeFrame = null;
    this.layoutResizeObserver?.disconnect?.();
    this.layoutResizeObserver = null;
    this.visibilityObserver?.disconnect?.();
    this.visibilityObserver = null;
    if (this.app && this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
    }
    this.replayGhostRenderer.destroy();
    this.app?.destroy(true, { children: true, texture: false });
    this.app = null;
    this.carSprites.clear();
    this.carHitAreas.clear();
    this.serviceCountdownLabels.clear();
    this.drsTrails.clear();
  }
}
