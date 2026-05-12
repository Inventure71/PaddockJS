import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
  createPaddockDriverControllerLoop,
  createPaddockSimulator,
  mountCameraControls,
  mountCarDriverOverview,
  mountF1Simulator,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountRaceTelemetryDrawer,
  mountSafetyCarControl,
  mountTelemetryCore,
  mountTelemetryLapTimes,
  mountTelemetryPanel,
  mountTelemetrySectorBanner,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  mountTimingTower,
} from '@inventure71/paddockjs';
import { detectVehicleCollision } from '../../src/simulation/collisionGeometry.js';
import { createVehicleGeometry } from '../../src/simulation/vehicleGeometry.js';
import { calculateWheelSurfaceState } from '../../src/simulation/wheelSurface.js';
import { createAdvancedFrameCounter } from './advancedFrameCounter.js';
import {
  checkpointPolicyUrl,
  loadCheckpointPolicyPayload,
} from './policyRunner/checkpointPolicy.js';
import {
  createHeuristicController,
  createHybridCheckpointController,
  createLabRemoteController,
} from './policyRunner/controllers.js';

const page = document.body.dataset.page ?? 'home';
const controllers = new Map();
const eventLog = document.querySelector('[data-event-log]');
const snapshotReadout = document.querySelector('[data-preview-snapshot]');
const finishSnapshotReadout = document.querySelector('[data-finish-snapshot]');
const penaltySnapshotReadout = document.querySelector('[data-penalty-snapshot]');
const SHOWCASE_TRACK_SEED = 20260430;
const LOCAL_CHECKPOINT_POLICY_URL = '/local-checkpoints/latest-hybrid-policy.json';
const LOCAL_CHECKPOINT_HISTORY_URL = '/local-checkpoints/hybrid-history.json';
const POLICY_GROWTH_INTERVAL_MS = 5000;
const POLICY_ACTION_HOLD_FRAMES = 4;
const POLICY_TRAINING_REPLAY_MAX_POLICY_STEPS = 420;
const POLICY_TRAINING_REPLAY_STALL_POLICY_STEPS = 32;
const POLICY_TRAINING_REPLAY_SPIN_POLICY_STEPS = 32;
const LAZY_START_ROOT_MARGIN = '760px 0px';
const COMPLETE_WORKBENCH_TRACK_SEED = readNumericQueryParam('completeTrackSeed') ?? createPreviewTrackSeed();

window.__paddockCompleteWorkbenchTrackSeed = COMPLETE_WORKBENCH_TRACK_SEED;

const PREVIEW_NAV_ITEMS = [
  { page: 'home', href: '/', label: 'Overview' },
  { page: 'templates', href: '/templates.html', label: 'Templates' },
  { page: 'components', href: '/components.html', label: 'Components' },
  { page: 'api', href: '/api.html', label: 'API' },
  { page: 'behavior', href: '/behavior.html', label: 'Behavior' },
  { page: 'stewarding', href: '/stewarding.html', label: 'Stewarding' },
  { page: 'collision-lab', href: '/collision-lab.html', label: 'Collision Lab' },
  { page: 'policy-runner', href: '/policy-runner.html', label: 'Policy Runner' },
];

function mountSharedPreviewHeader() {
  document.querySelector('.site-header')?.remove();
  const header = document.createElement('header');
  header.className = 'site-header';
  const mark = document.createElement('a');
  mark.className = 'site-mark';
  mark.href = '/';
  mark.textContent = 'PaddockJS';
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'Showcase pages');
  for (const item of PREVIEW_NAV_ITEMS) {
    const link = document.createElement('a');
    link.href = previewRouteHref(item.href);
    link.textContent = item.label;
    if (item.page === page) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  header.append(mark, nav);
  document.body.prepend(header);
}

function readNumericQueryParam(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value == null || value.trim() === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue >>> 0 : null;
}

function createPreviewTrackSeed() {
  const values = new Uint32Array(1);
  try {
    window.crypto?.getRandomValues?.(values);
  } catch {
    values[0] = 0;
  }
  return (values[0] || Math.floor(Date.now() + Math.random() * 0xffffffff)) >>> 0;
}

function element(id) {
  return document.getElementById(id);
}

function requiredElement(id) {
  const node = element(id);
  if (!node) throw new Error(`Local preview host could not find #${id}.`);
  return node;
}

function addController(name, controller) {
  controllers.set(name, controller);
  window.__paddockPreviewControllers = controllers;
  window.paddockPreview = Object.fromEntries(controllers);
  return controller;
}

function startPreviewControllerWhenNear(root, name, startController) {
  let started = false;
  let startPromise = null;
  let observer = null;

  const start = async () => {
    if (started) return startPromise;
    started = true;
    observer?.disconnect();
    root.dataset.previewStartState = 'starting';
    startPromise = Promise.resolve()
      .then(startController)
      .then((controller) => {
        root.dataset.previewStartState = 'ready';
        return addController(name, controller);
      })
      .catch((error) => {
        root.dataset.previewStartState = 'error';
        throw error;
      });
    return startPromise;
  };

  root.dataset.previewStartState = 'pending';

  if (typeof IntersectionObserver !== 'function') {
    window.requestAnimationFrame(() => {
      start().catch((error) => appendEvent(`${name}:error`, error.message));
    });
    return start;
  }

  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
      start().catch((error) => appendEvent(`${name}:error`, error.message));
    }
  }, {
    root: null,
    rootMargin: LAZY_START_ROOT_MARGIN,
    threshold: 0,
  });
  observer.observe(root);
  window.__paddockPreviewStarts ??= new Map();
  window.__paddockPreviewStarts.set(name, start);
  return start;
}

function hostDriverOpen(driver) {
  appendEvent('onDriverOpen', driver.name ?? driver.id);
}

function appendEvent(type, detail) {
  if (!eventLog) return;
  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  item.innerHTML = `<span>${escapeHtml(time)}</span><strong>${escapeHtml(type)}</strong><em>${escapeHtml(detail ?? '')}</em>`;
  eventLog.prepend(item);
  while (eventLog.children.length > 14) {
    eventLog.lastElementChild?.remove();
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function previewPhysicsMode() {
  return explicitPreviewPhysicsMode() ?? 'arcade';
}

function explicitPreviewPhysicsMode() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('physicsMode');
  return value === 'simulator' || value === 'arcade' ? value : null;
}

function previewRouteHref(href) {
  const physicsMode = explicitPreviewPhysicsMode();
  if (!physicsMode) return href;
  const url = new URL(href, window.location.origin);
  url.searchParams.set('physicsMode', physicsMode);
  return `${url.pathname}${url.search}${url.hash}`;
}

function synchronizePreviewPhysicsLinks() {
  const physicsMode = explicitPreviewPhysicsMode();
  if (!physicsMode) return;
  document.querySelectorAll('a[href^="/"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    link.setAttribute('href', previewRouteHref(href));
  });
}

function previewUi(ui = {}) {
  return {
    showPhysicsModeIndicator: true,
    ...ui,
  };
}

function commonOptions(label = 'preview') {
  const physicsMode = previewPhysicsMode();
  return {
    drivers: DEMO_PROJECT_DRIVERS,
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    physicsMode,
    ui: previewUi(),
    backLinkHref: previewRouteHref('/'),
    backLinkLabel: 'Preview',
    onDriverOpen: hostDriverOpen,
    onLoadingChange({ phase }) {
      appendEvent(`${label}:loading`, phase);
    },
    onReady({ snapshot }) {
      appendEvent(`${label}:ready`, `${snapshot.raceControl.mode} / ${physicsMode}`);
    },
    onDriverSelect(driver) {
      appendEvent(`${label}:select`, driver.code ?? driver.id);
    },
    onRaceEvent(event) {
      appendEvent(`${label}:event`, event.type);
    },
    onLapChange({ leaderLap }) {
      appendEvent(`${label}:lap`, `Lap ${leaderLap}`);
    },
    onRaceFinish({ winner }) {
      appendEvent(`${label}:finish`, winner?.name ?? 'winner');
    },
    onError(error, context) {
      appendEvent(`${label}:error`, `${context?.phase ?? context?.callback ?? 'runtime'}: ${error.message}`);
    },
  };
}

function stewardRules({ immediateTrackLimitPenalty = false } = {}) {
  return {
    standingStart: true,
    ruleset: 'custom',
    modules: {
      penalties: {
        trackLimits: {
          strictness: 1,
          warningsBeforePenalty: immediateTrackLimitPenalty ? 0 : 3,
          consequences: [{ type: 'time', seconds: 5 }],
        },
        collision: {
          strictness: 1,
          consequences: [{ type: 'time', seconds: 5 }],
        },
      },
    },
  };
}

function raceStrategyRules(options = {}) {
  const rules = stewardRules(options);
  return {
    ...rules,
    modules: {
      ...rules.modules,
      pitStops: {
        enabled: true,
        pitLaneSpeedLimitKph: 80,
        defaultStopSeconds: 2.8,
        maxConcurrentPitLaneCars: 3,
        minimumPitLaneGapMeters: 20,
      },
      tireStrategy: {
        enabled: true,
        compounds: ['S', 'M', 'H'],
        mandatoryDistinctDryCompounds: 2,
      },
    },
  };
}

function apiShowcaseRules() {
  const rules = raceStrategyRules({ immediateTrackLimitPenalty: true });
  return {
    ...rules,
    modules: {
      ...rules.modules,
      penalties: {
        ...rules.modules.penalties,
        trackLimits: {
          strictness: 1,
          warningsBeforePenalty: 0,
          consequences: [{ type: 'driveThrough', conversionSeconds: 20 }],
        },
      },
    },
  };
}

function summarizeSnapshot(controller, label) {
  const snapshot = controller?.getSnapshot?.();
  if (!snapshot) return { label, status: 'not started' };

  const leader = snapshot.cars?.[0];
  return {
    label,
    mode: snapshot.raceControl.mode,
    lap: `${leader?.lap ?? 1}/${snapshot.totalLaps}`,
    leader: leader ? `${leader.rank}. ${leader.name} (${leader.code})` : 'none',
    winner: snapshot.raceControl.winner?.name ?? null,
    safetyCar: snapshot.safetyCar.deployed,
  };
}

function renderSnapshot() {
  if (!snapshotReadout) return;
  const summaries = [...controllers].map(([label, controller]) => summarizeSnapshot(controller, label));
  snapshotReadout.textContent = JSON.stringify(summaries, null, 2);
}

function renderApiSnapshot(controller = controllers.get('api-target')) {
  if (!snapshotReadout) return;
  const snapshot = controller?.getSnapshot?.();
  const selectedDriverId = controller?.app?.selectedId ?? snapshot?.cars?.[0]?.id ?? null;
  const selectedCar = snapshot?.cars?.find((car) => car.id === selectedDriverId) ?? null;
  const pitStrategyDriverId = DEMO_PROJECT_DRIVERS[0]?.id;
  const firstPenalty = snapshot?.penalties?.[0] ?? null;
  snapshotReadout.textContent = JSON.stringify({
    seed: controller?.options?.seed ?? null,
    mode: snapshot?.raceControl?.mode ?? null,
    safetyCar: snapshot?.safetyCar?.deployed ?? false,
    redFlag: snapshot?.raceControl?.redFlag ?? false,
    pitLaneOpen: snapshot?.raceControl?.pitLaneOpen ?? false,
    pitLaneStatus: snapshot?.pitLaneStatus ?? snapshot?.raceControl?.pitLaneStatus ?? null,
    selectedDriver: selectedCar ? {
      id: selectedCar.id,
      code: selectedCar.code,
      name: selectedCar.name,
      rank: selectedCar.rank,
    } : null,
    pitStrategyDriver: pitStrategyDriverId ? {
      id: pitStrategyDriverId,
      pitIntent: controller?.getPitIntent?.(pitStrategyDriverId) ?? null,
      targetCompound: controller?.getPitTargetCompound?.(pitStrategyDriverId) ?? null,
    } : null,
    firstPenalty: firstPenalty ? {
      id: firstPenalty.id,
      type: firstPenalty.type,
      driverId: firstPenalty.driverId,
      status: firstPenalty.status,
      serviceType: firstPenalty.serviceType,
      serviceRequired: firstPenalty.serviceRequired,
      pendingPenaltySeconds: firstPenalty.pendingPenaltySeconds,
      penaltySeconds: firstPenalty.penaltySeconds,
    } : null,
  }, null, 2);
}

function renderFinishSnapshot(controller) {
  if (!finishSnapshotReadout) return;
  const snapshot = controller?.getSnapshot?.();
  if (!snapshot) {
    finishSnapshotReadout.textContent = 'Waiting for race snapshot...';
    return;
  }

  finishSnapshotReadout.textContent = JSON.stringify({
    mode: snapshot.raceControl.mode,
    finished: snapshot.raceControl.finished,
    winner: snapshot.raceControl.winner?.name ?? null,
    classification: (snapshot.raceControl.classification ?? []).slice(0, 5).map((entry) => ({
      rank: entry.rank,
      code: entry.code,
      finished: entry.finished,
      lap: entry.lap,
    })),
  }, null, 2);
}

function renderPenaltySnapshot(controller) {
  if (!penaltySnapshotReadout) return;
  const snapshot = controller?.getSnapshot?.();
  if (!snapshot) {
    penaltySnapshotReadout.textContent = 'Preparing stewarding demo...';
    return;
  }

  penaltySnapshotReadout.textContent = JSON.stringify({
    mode: snapshot.raceControl.mode,
    winner: snapshot.raceControl.winner?.code ?? null,
    classification: (snapshot.raceControl.classification ?? []).map((entry) => ({
      rank: entry.rank,
      code: entry.code,
      finishTime: entry.finishTime,
      penaltySeconds: entry.penaltySeconds,
      adjustedFinishTime: entry.adjustedFinishTime,
    })),
    penalties: (snapshot.penalties ?? []).map((penalty) => ({
      type: penalty.type,
      driverId: penalty.driverId,
      penaltySeconds: penalty.penaltySeconds,
      reason: penalty.reason,
      consequences: penalty.consequences,
    })),
  }, null, 2);
}

function placePreviewCarAtDistance(sim, id, distance, { speed = 0, offset = 0 } = {}) {
  const wrappedDistance = ((distance % sim.track.length) + sim.track.length) % sim.track.length;
  const sample = sim.track.samples.reduce((closest, candidate) => (
    Math.abs(candidate.distance - wrappedDistance) < Math.abs(closest.distance - wrappedDistance)
      ? candidate
      : closest
  ), sim.track.samples[0]);
  sim.setCarState(id, {
    x: sample.x + sample.normalX * offset,
    y: sample.y + sample.normalY * offset,
    heading: sample.heading,
    progress: sample.distance,
    raceDistance: distance,
    speed,
  });
}

function prepareFinishDemo(controller) {
  const sim = controller?.app?.sim;
  if (!sim) return;

  const finishDistance = sim.finishDistance;
  placePreviewCarAtDistance(sim, 'budget', finishDistance - 44, { speed: 95, offset: -18 });
  placePreviewCarAtDistance(sim, 'noir', finishDistance - 78, { speed: 92, offset: 18 });
  controller.app.updateDom(sim.snapshot());
}

function forceStewardingDemo(controller) {
  const sim = controller?.app?.sim;
  if (!sim) return;

  const placeCarOutsideTrackLimits = (id, distance) => {
    const offset = sim.track.width / 2 + (sim.track.kerbWidth ?? 0) + 320;
    placePreviewCarAtDistance(sim, id, distance, { speed: 0, offset });
  };

  placeCarOutsideTrackLimits('budget', 1350);
  sim.reviewTrackLimits?.();

  const snapshot = sim.snapshot();
  controller.app.updateDom(snapshot);
  renderPenaltySnapshot(controller);
}

function forceApiPenaltyDemo(controller) {
  const sim = controller?.app?.sim;
  if (!sim) return null;
  placePreviewCarAtDistance(sim, 'budget', 1350, {
    speed: 0,
    offset: sim.track.width / 2 + (sim.track.kerbWidth ?? 0) + 320,
  });
  sim.reviewTrackLimits?.();
  const penalty = sim.penalties?.[0] ?? null;
  controller.app.updateDom(sim.snapshot());
  return penalty;
}

function wireDriverButtons() {
  const root = document.querySelector('[data-driver-buttons]');
  if (!root) return;

  root.innerHTML = DEMO_PROJECT_DRIVERS.map((driver) => `
    <button type="button" data-driver-id="${escapeHtml(driver.id)}" style="--driver-color: ${escapeHtml(driver.color)}">
      <span>${escapeHtml(driver.code)}</span>
      <strong>${escapeHtml(driver.name)}</strong>
    </button>
  `).join('');

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-driver-id]')
      : null;
    if (!button) return;
    controllers.forEach((controller) => controller.selectDriver?.(button.dataset.driverId));
    renderApiSnapshot();
  });
}

function wireActions() {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-action]')
      : null;
    if (!button) return;

    if (button.dataset.action === 'restart') {
      controllers.forEach((controller, label) => {
        controller.restart?.({ seed: (Date.now() + label.length * 97) % 100000 });
      });
      renderApiSnapshot();
      return;
    }

    if (button.dataset.action === 'safety') {
      controllers.forEach((controller) => controller.toggleSafetyCar?.());
      renderApiSnapshot();
      return;
    }

    if (button.dataset.action === 'snapshot') {
      renderSnapshot();
      renderApiSnapshot();
      return;
    }

    const apiController = controllers.get('api-target');
    const driverId = DEMO_PROJECT_DRIVERS[0]?.id;

    if (button.dataset.action === 'red-flag') {
      const redFlag = Boolean(apiController?.getSnapshot?.()?.raceControl?.redFlag);
      apiController?.setRedFlagDeployed?.(!redFlag);
      renderApiSnapshot(apiController);
      return;
    }

    if (button.dataset.action === 'pit-lane') {
      const open = Boolean(apiController?.getSnapshot?.()?.raceControl?.pitLaneOpen);
      apiController?.setPitLaneOpen?.(!open);
      renderApiSnapshot(apiController);
      return;
    }

    if (button.dataset.action === 'pit-intent') {
      if (driverId) apiController?.setPitIntent?.(driverId, { intent: 2, targetCompound: 'M' });
      renderApiSnapshot(apiController);
      return;
    }

    if (button.dataset.action === 'pit-clear') {
      if (driverId) apiController?.setPitIntent?.(driverId, 0);
      renderApiSnapshot(apiController);
      return;
    }

    if (button.dataset.action === 'force-penalty') {
      forceApiPenaltyDemo(apiController);
      renderApiSnapshot(apiController);
      return;
    }

    if (button.dataset.action === 'serve-penalty') {
      const penaltyId = apiController?.getSnapshot?.()?.penalties?.find((penalty) => penalty.serviceRequired)?.id;
      if (penaltyId) apiController?.servePenalty?.(penaltyId);
      renderApiSnapshot(apiController);
      return;
    }

    if (button.dataset.action === 'cancel-penalty') {
      const penaltyId = apiController?.getSnapshot?.()?.penalties?.find((penalty) => penalty.status !== 'cancelled')?.id;
      if (penaltyId) apiController?.cancelPenalty?.(penaltyId);
      renderApiSnapshot(apiController);
    }
  });
}

function wireBannerDemo(controller) {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-banner-demo]')
      : null;
    if (!button) return;

    if (button.dataset.bannerDemo === 'project') {
      const driverId = DEMO_PROJECT_DRIVERS[0]?.id;
      if (driverId) controller.selectDriver(driverId);
      return;
    }

    if (button.dataset.bannerDemo === 'radio') {
      controller.restart({ seed: 7271 });
    }
  });
}

async function mountTemplatesPage() {
  const completeRoot = requiredElement('template-complete-root');
  const complete = createPaddockSimulator({
    ...commonOptions('complete-broadcast'),
    title: 'Complete Race Workbench',
    kicker: 'rules + broadcast UI',
    seed: 7071,
    trackSeed: COMPLETE_WORKBENCH_TRACK_SEED,
    totalLaps: 14,
    rules: raceStrategyRules(),
    theme: {
      accentColor: '#f1c65b',
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '680px',
    },
    ui: previewUi({
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceTelemetryDrawer(requiredElement('template-complete-root'), complete, {
    raceDataTelemetryDetail: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  startPreviewControllerWhenNear(completeRoot, 'complete-broadcast', async () => {
    await complete.start();
    return complete;
  });

  const dashboardRoot = requiredElement('template-dashboard-root');
  startPreviewControllerWhenNear(dashboardRoot, 'dashboard', () => mountF1Simulator(dashboardRoot, {
    ...commonOptions('dashboard'),
    preset: 'dashboard',
    title: 'Dashboard Preset',
    kicker: "preset: 'dashboard'",
    seed: 1971,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 10,
    ui: previewUi({
      raceDataBannerSize: 'custom',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  }));

  const overlayRoot = requiredElement('template-overlay-root');
  startPreviewControllerWhenNear(overlayRoot, 'timing-overlay', () => mountF1Simulator(overlayRoot, {
    ...commonOptions('overlay'),
    preset: 'timing-overlay',
    title: 'Timing Overlay',
    kicker: "preset: 'timing-overlay'",
    seed: 3171,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 9,
    theme: {
      accentColor: '#ff2d55',
      timingTowerMaxWidth: '370px',
      raceViewMinHeight: '680px',
    },
    ui: previewUi({
      showFps: true,
      raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
    }),
  }));

  const bannerRoot = requiredElement('template-banner-root');
  const banner = createPaddockSimulator({
    ...commonOptions('banner-option'),
    title: 'Banner Option',
    kicker: 'radio + project',
    seed: 7271,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    theme: {
      accentColor: '#f1c65b',
      timingTowerMaxWidth: '350px',
      raceViewMinHeight: '700px',
    },
    ui: previewUi({
      raceDataBannerSize: 'auto',
      raceDataTelemetryDetail: true,
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceCanvas(requiredElement('template-banner-root'), banner, {
    includeTimingTower: true,
    includeRaceDataPanel: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  mountCameraControls(requiredElement('template-banner-camera-controls'), banner);
  startPreviewControllerWhenNear(bannerRoot, 'banner-option', async () => {
    await banner.start();
    return banner;
  });
  wireBannerDemo(banner);

  const compactRoot = requiredElement('template-compact-root');
  startPreviewControllerWhenNear(compactRoot, 'compact-race', () => mountF1Simulator(compactRoot, {
    ...commonOptions('compact'),
    preset: 'compact-race',
    title: 'Compact Race',
    kicker: "preset: 'compact-race'",
    seed: 4171,
    totalLaps: 6,
    theme: {
      raceViewMinHeight: '520px',
      timingTowerMaxWidth: '320px',
    },
  }));

  const fullDashboardRoot = requiredElement('template-full-dashboard-root');
  startPreviewControllerWhenNear(fullDashboardRoot, 'full-dashboard', () => mountF1Simulator(fullDashboardRoot, {
    ...commonOptions('full-dashboard'),
    preset: 'full-dashboard',
    title: 'Full Dashboard',
    kicker: "preset: 'full-dashboard'",
    seed: 5171,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    theme: {
      accentColor: '#00ff84',
      timingTowerMaxWidth: '380px',
      raceViewMinHeight: '700px',
    },
  }));

  const drawerRoot = requiredElement('template-drawer-root');
  const drawer = createPaddockSimulator({
    ...commonOptions('drawer-template'),
    title: 'Race Workbench',
    kicker: 'drawer template',
    seed: 6171,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    theme: {
      accentColor: '#14c784',
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '680px',
    },
    ui: previewUi({
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceTelemetryDrawer(requiredElement('template-drawer-root'), drawer, {
    timingTowerVerticalFit: 'expand-race-view',
    raceDataTelemetryDetail: true,
  });
  startPreviewControllerWhenNear(drawerRoot, 'drawer-template', async () => {
    await drawer.start();
    return drawer;
  });
}

async function mountComponentsPage() {
  const embedded = createPaddockSimulator({
    ...commonOptions('embedded-window'),
    title: 'Embedded Race Window',
    kicker: 'mountRaceCanvas',
    seed: 6111,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    rules: stewardRules({ immediateTrackLimitPenalty: true }),
    theme: {
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '760px',
    },
    ui: previewUi({
      showFps: false,
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceCanvas(requiredElement('component-embedded-canvas'), embedded, {
    includeTimingTower: true,
    includeRaceDataPanel: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  mountCameraControls(requiredElement('component-embedded-camera-controls'), embedded);
  await embedded.start();
  addController('embedded-window', embedded);
  forceStewardingDemo(embedded);

  const pieces = createPaddockSimulator({
    ...commonOptions('pieces'),
    title: 'Composable Mounts',
    kicker: 'createPaddockSimulator',
    seed: 7171,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    ui: previewUi({
      cameraControls: false,
    }),
  });

  mountRaceControls(requiredElement('component-race-controls'), pieces);
  mountSafetyCarControl(requiredElement('component-safety-car'), pieces);
  mountCameraControls(requiredElement('component-camera-controls'), pieces);
  mountTimingTower(requiredElement('component-timing-tower'), pieces);
  mountRaceCanvas(requiredElement('component-race-canvas'), pieces);
  mountTelemetryCore(requiredElement('component-telemetry-core'), pieces);
  mountTelemetrySectors(requiredElement('component-telemetry-sectors'), pieces);
  mountTelemetrySectorBanner(requiredElement('component-telemetry-sector-banner'), pieces);
  mountTelemetryLapTimes(requiredElement('component-telemetry-lap-times'), pieces);
  mountTelemetrySectorTimes(requiredElement('component-telemetry-sector-times'), pieces);
  mountTelemetryPanel(requiredElement('component-telemetry-panel'), pieces, { includeOverview: true });
  mountCarDriverOverview(requiredElement('component-overview'), pieces);
  mountRaceDataPanel(requiredElement('component-race-data'), pieces);

  await pieces.start();
  addController('pieces', pieces);

  const drawer = createPaddockSimulator({
    ...commonOptions('component-drawer'),
    title: 'Composable Drawer',
    kicker: 'mountRaceTelemetryDrawer',
    seed: 7199,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    theme: {
      timingTowerMaxWidth: '350px',
      raceViewMinHeight: '620px',
    },
    ui: previewUi({
      raceDataBannerSize: 'auto',
      raceDataTelemetryDetail: true,
      raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceTelemetryDrawer(requiredElement('component-telemetry-drawer'), drawer, {
    drawerInitiallyOpen: true,
    raceDataTelemetryDetail: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  startPreviewControllerWhenNear(requiredElement('component-telemetry-drawer'), 'component-drawer', async () => {
    await drawer.start();
    return drawer;
  });
}

async function mountApiPage() {
  const controller = createPaddockSimulator({
    ...commonOptions('api'),
    preset: 'timing-overlay',
    title: 'API Target',
    kicker: 'controller + callbacks',
    seed: 8171,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 5,
    rules: apiShowcaseRules(),
    theme: {
      accentColor: '#f1c65b',
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '650px',
    },
    ui: previewUi({
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceTelemetryDrawer(requiredElement('api-simulator-root'), controller, {
    raceDataTelemetryDetail: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  await controller.start();
  addController('api-target', controller);
  forceApiPenaltyDemo(controller);
  wireDriverButtons();
  wireActions();
  renderApiSnapshot(controller);
  window.setInterval(() => renderApiSnapshot(controller), 1000);
}

async function mountBehaviorPage() {
  const expand = createPaddockSimulator({
    ...commonOptions('expand-fit'),
    seed: 9111,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 6,
    theme: { raceViewMinHeight: '620px', timingTowerMaxWidth: '340px' },
    ui: previewUi({ raceDataBannerSize: 'auto', timingTowerVerticalFit: 'expand-race-view' }),
  });
  mountRaceCanvas(requiredElement('behavior-expand-root'), expand, {
    includeTimingTower: true,
    includeRaceDataPanel: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  await expand.start();
  addController('expand-fit', expand);

  const scroll = createPaddockSimulator({
    ...commonOptions('scroll-fit'),
    seed: 9222,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 6,
    theme: { raceViewMinHeight: '420px', timingTowerMaxWidth: '340px' },
    ui: previewUi({ raceDataBannerSize: 'auto', timingTowerVerticalFit: 'scroll' }),
  });
  mountRaceCanvas(requiredElement('behavior-scroll-root'), scroll, {
    includeTimingTower: true,
    includeRaceDataPanel: true,
    timingTowerVerticalFit: 'scroll',
  });
  await scroll.start();
  addController('scroll-fit', scroll);

  const finish = createPaddockSimulator({
    ...commonOptions('finish'),
    drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS.slice(0, 2),
    preset: 'compact-race',
    title: 'Finish Contract',
    kicker: 'final lap',
    seed: 9333,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 1,
    theme: {
      accentColor: '#00ff84',
      raceViewMinHeight: '560px',
      timingTowerMaxWidth: '330px',
    },
    ui: previewUi({
      raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceCanvas(requiredElement('behavior-finish-root'), finish, {
    includeRaceDataPanel: true,
  });
  await finish.start();
  addController('finish-contract', finish);
  prepareFinishDemo(finish);
  renderFinishSnapshot(finish);
  window.setInterval(() => renderFinishSnapshot(finish), 1000);
}

async function mountStewardingPage() {
  const penalties = createPaddockSimulator({
    ...commonOptions('penalties'),
    drivers: DEMO_PROJECT_DRIVERS.slice(0, 2),
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS.slice(0, 2),
    preset: 'timing-overlay',
    title: 'Stewarding Rules',
    kicker: 'strictness + consequences',
    seed: 9444,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 20,
    theme: {
      accentColor: '#ff4d5f',
      raceViewMinHeight: '560px',
      timingTowerMaxWidth: '340px',
    },
    rules: {
      standingStart: true,
      ruleset: 'custom',
      modules: {
        tireStrategy: {
          enabled: true,
          mandatoryDistinctDryCompounds: 2,
        },
        penalties: {
          tireRequirement: {
            strictness: 1,
            consequences: [{ type: 'time', seconds: 10 }],
          },
          collision: {
            strictness: 1,
            consequences: [{ type: 'time', seconds: 5 }],
          },
          trackLimits: {
            strictness: 1,
            warningsBeforePenalty: 0,
            consequences: [{ type: 'time', seconds: 5 }],
          },
        },
      },
    },
    ui: previewUi({
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceCanvas(requiredElement('stewarding-penalty-root'), penalties, {
    includeTimingTower: true,
    includeRaceDataPanel: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  await penalties.start();
  addController('penalty-contract', penalties);
  forceStewardingDemo(penalties);
  renderPenaltySnapshot(penalties);
  window.setInterval(() => renderPenaltySnapshot(penalties), 1000);
}

async function mountPolicyRunnerPage() {
  const root = requiredElement('policy-runner-root');
  const status = document.querySelector('[data-policy-checkpoint-status]');
  const readout = document.querySelector('[data-policy-runner-readout]');
  const sensesPanel = document.querySelector('[data-policy-senses]');
  const controllerSelect = document.querySelector('[data-policy-controller-select]');
  const configurationSelect = document.querySelector('[data-policy-configuration-select]');
  const growthSelect = document.querySelector('[data-policy-growth-select]');
  const growthPrevButton = document.querySelector('[data-policy-growth-prev]');
  const growthNextButton = document.querySelector('[data-policy-growth-next]');
  const growthAutoInput = document.querySelector('[data-policy-growth-auto]');
  const resetButton = document.querySelector('[data-policy-runner-reset]');
  const stepButton = document.querySelector('[data-policy-runner-step]');
  const autoInput = document.querySelector('[data-policy-runner-auto]');
  const frameCounter = createAdvancedFrameCounter(document.querySelector('[data-policy-frame-counter]'), {
    label: 'Policy loop',
    metrics: [
      { key: 'visualFrame', label: 'Visual frame' },
      { key: 'simStep', label: 'Sim step' },
      { key: 'policyStep', label: 'Policy' },
      { key: 'heldFramesRemaining', label: 'held' },
      { key: 'lastPolicyDecisionMs', label: 'policy', unit: 'ms' },
      { key: 'lastExpertStepMs', label: 'step', unit: 'ms' },
      { key: 'lastRenderMs', label: 'render', unit: 'ms' },
      { key: 'lastAutoFrameGapMs', label: 'raf', unit: 'ms' },
    ],
  });
  const trainingField = createPolicyRunnerTrainingField(8);
  const controlledDrivers = trainingField.drivers.map((driver) => driver.id);
  const primaryRaceDriver = DEMO_PROJECT_DRIVERS[0].id;
  let history = await loadCheckpointHistoryManifest(LOCAL_CHECKPOINT_HISTORY_URL);
  let activeCheckpointUrl = LOCAL_CHECKPOINT_POLICY_URL;
  let activeHistoryItem = null;
  let activePayload = await loadCheckpointPolicyPayload(LOCAL_CHECKPOINT_POLICY_URL);
  if (!activePayload && history?.items?.length) {
    activeHistoryItem = history.items.at(-1);
    activeCheckpointUrl = checkpointPolicyUrl(activeHistoryItem.policy);
    activePayload = await loadCheckpointPolicyPayload(activeCheckpointUrl);
  }
  if (!activePayload && controllerSelect) controllerSelect.value = 'heuristic';
  let activeController = null;
  let simulator = null;
  let controllerLoop = null;
  let result = null;
  let animationFrame = null;
  let growthTimer = null;
  let historyRefreshTimer = null;
  let heldAction = null;
  let heldFramesRemaining = 0;
  let policyStep = 0;
  let visualFrame = 0;
  let lastPolicyDecisionMs = 0;
  let lastExpertStepMs = 0;
  let lastRenderMs = 0;
  let lastVisualFrameMs = 0;
  let lastAutoFrameGapMs = 0;
  let lastAutoTickAt = 0;
  let activeControlledDrivers = [controlledDrivers[0]];
  let activePrimaryDriver = controlledDrivers[0];
  let trainingReplayRuntime = new Map();
  let trainingReplayStats = {
    enabled: false,
    resetCount: 0,
    resetReasons: {},
    lastResetDrivers: [],
  };

  const configurationOptions = createPolicyRunnerConfigurations(trainingField, primaryRaceDriver);
  configurationSelect?.replaceChildren(
    ...configurationOptions.map((option) => new Option(option.label, option.id)),
  );
  activeController = createSelectedController();

  async function mountSelectedConfiguration() {
    stop();
    root.replaceChildren();
    const selectedConfiguration = getSelectedConfiguration();
    const selectedOptions = {
      ...selectedConfiguration.options,
      physicsMode: selectedPolicyRunnerPhysicsMode(selectedConfiguration),
      observation: {
        ...(selectedConfiguration.options.observation ?? {}),
        lookaheadMeters: activeLookaheadMeters(),
      },
      sensors: {
        ...(selectedConfiguration.options.sensors ?? {}),
        rays: {
          ...(selectedConfiguration.options.sensors?.rays ?? {}),
          layout: activeRayLayout(),
        },
      },
    };
    controllerLoop?.stop();
    controllerLoop = null;
    simulator?.destroy?.();
    activeControlledDrivers = selectedConfiguration.controlledDrivers;
    activePrimaryDriver = activeControlledDrivers[0];
    initializeTrainingReplayRuntime(selectedConfiguration);
    simulator = await mountF1Simulator(root, {
      ...commonOptions('policy-runner'),
      ...selectedOptions,
      preset: 'compact-race',
      title: 'Policy Runner',
      kicker: 'controller.decideBatch(observations) -> actions',
      seed: 71,
      trackSeed: selectedConfiguration.trackSeed ?? SHOWCASE_TRACK_SEED,
      totalLaps: selectedConfiguration.totalLaps ?? 3,
      expert: {
        enabled: true,
        controlledDrivers: activeControlledDrivers,
        frameSkip: 1,
        visualizeSensors: { rays: true, drivers: 'selected' },
      },
      ui: previewUi({
        raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
      }),
      onDriverSelect(driver) {
        appendEvent('policy-runner:select', driver.code ?? driver.id);
        activePrimaryDriver = activeControlledDrivers.includes(driver.id) ? driver.id : null;
        render(heldAction);
      },
    });
    addController('policy-runner', simulator);
    activeController = createSelectedController();
    controllerLoop = createPaddockDriverControllerLoop({
      runtime: simulator.expert,
      controller: activeController,
      actionRepeat: POLICY_ACTION_HOLD_FRAMES,
      mode: 'browser-policy-runner',
    });
    await reset();
  }

  async function reset() {
    result = await controllerLoop.reset();
    initializeTrainingReplayRuntime(getSelectedConfiguration());
    activePrimaryDriver = activeControlledDrivers[0] ?? null;
    if (activePrimaryDriver) simulator.selectDriver(activePrimaryDriver);
    heldAction = null;
    heldFramesRemaining = 0;
    policyStep = 0;
    visualFrame = 0;
    lastPolicyDecisionMs = 0;
    lastExpertStepMs = 0;
    lastRenderMs = 0;
    lastVisualFrameMs = 0;
    lastAutoFrameGapMs = 0;
    lastAutoTickAt = 0;
    syncControllerLoopStats();
    render(null);
  }

  function initializeTrainingReplayRuntime(configuration) {
    trainingReplayRuntime = new Map(activeControlledDrivers.map((driverId) => [
      driverId,
      createTrainingReplayDriverRuntime(),
    ]));
    trainingReplayStats = {
      enabled: Boolean(configuration?.trainingBatchReplay),
      resetCount: 0,
      resetReasons: {},
      lastResetDrivers: [],
    };
  }

  async function stepVisualFrame() {
    const frameStartedAt = performance.now();
    const stepStartedAt = performance.now();
    result = await controllerLoop.stepFrame();
    lastExpertStepMs = performance.now() - stepStartedAt;
    syncControllerLoopStats();
    visualFrame += 1;
    await applyTrainingReplayLimits();
    const renderStartedAt = performance.now();
    render(heldAction);
    lastRenderMs = performance.now() - renderStartedAt;
    lastVisualFrameMs = performance.now() - frameStartedAt;
    renderFrameCounter();
    if (result.done) stop();
  }

  async function step() {
    const frameStartedAt = performance.now();
    const stepStartedAt = performance.now();
    result = await controllerLoop.step();
    lastExpertStepMs = performance.now() - stepStartedAt;
    syncControllerLoopStats();
    visualFrame = result?.info?.step ?? visualFrame;
    await applyTrainingReplayLimits();
    const renderStartedAt = performance.now();
    render(heldAction);
    lastRenderMs = performance.now() - renderStartedAt;
    lastVisualFrameMs = performance.now() - frameStartedAt;
    renderFrameCounter();
    if (result?.done) stop();
  }

  function render(action) {
    const observation = activePrimaryDriver ? result?.observation?.[activePrimaryDriver] : null;
    renderPolicySenses(
      sensesPanel,
      observation,
      activeController,
      activePrimaryDriver,
      selectedPolicyRunnerPhysicsMode(getSelectedConfiguration()),
    );
    readout.textContent = JSON.stringify({
      configuration: getSelectedConfiguration().id,
      controller: activeControllerMetadata(),
      checkpoint: activeControllerKind() === 'hybrid-checkpoint' ? activeCheckpointUrl : null,
      labRemote: activeControllerKind() === 'lab-remote' ? activeController.debugState : null,
      physicsMode: selectedPolicyRunnerPhysicsMode(getSelectedConfiguration()),
      loadedCheckpoint: activeControllerKind() === 'hybrid-checkpoint' && Boolean(activePayload),
      generation: activeControllerKind() === 'hybrid-checkpoint' ? activeHistoryItem?.generation ?? activePayload?.generation ?? null : null,
      policyStep,
      visualFrame,
      activeCars: activeControlledDrivers.length,
      selectedDriver: activePrimaryDriver,
      trainingBatchReplay: trainingReplayStats,
      visualFrameSkip: POLICY_ACTION_HOLD_FRAMES,
      heldFramesRemaining,
      frameMetrics: currentFrameMetrics(),
      metadata: activeControllerKind() === 'hybrid-checkpoint' && activePayload ? {
        format: activePayload.format,
        stage: activePayload.stage,
        steps: activePayload.steps,
        obsDim: activePayload.obsDim,
        hiddenSize: activePayload.hiddenSize,
        rayLayout: activeRayLayout(),
        physicsMode: activePolicyPhysicsMode(),
        score: activeHistoryItem?.score ?? activePayload.score,
      } : null,
      step: result?.info?.step,
      action,
      self: observation?.object?.self ?? null,
      nearbyCars: observation?.object?.nearbyCars?.slice(0, 3),
      rays: observation?.object?.rays,
      actionSpec: controllerLoop?.actionSpec,
      observationSpec: controllerLoop?.observationSpec,
    }, null, 2);
    if (status) {
      status.textContent = activeControllerKind() === 'lab-remote'
        ? [
          'Active controller Lab remote server',
          activeController.debugState?.connected ? 'connected' : 'waiting for http://127.0.0.1:8787',
          `physics ${activePolicyPhysicsMode()}`,
          activeController.debugState?.session?.checkpoint ? 'Python checkpoint loaded' : null,
          activeController.debugState?.error ? `error ${activeController.debugState.error}` : null,
        ].filter(Boolean).join(' · ')
        : activeControllerKind() === 'hybrid-checkpoint' && activePayload
        ? [
          'Active controller Hybrid checkpoint',
          activeHistoryItem ? activeHistoryItem.label : 'Latest best',
          `Loaded ${activePayload.format}`,
          activePayload.stage ? `stage ${activePayload.stage}` : null,
          `physics ${activePolicyPhysicsMode()}`,
          Number.isFinite(activePayload.steps) ? `${activePayload.steps} training steps` : null,
        ].filter(Boolean).join(' · ')
        : 'Active controller Heuristic baseline · no checkpoint required.';
    }
    renderFrameCounter();
  }

  function currentFrameMetrics() {
    return {
      simStep: result?.info?.step ?? 0,
      visualFrame,
      policyStep,
      heldFramesRemaining,
      lastPolicyDecisionMs: roundMs(lastPolicyDecisionMs),
      lastExpertStepMs: roundMs(lastExpertStepMs),
      lastRenderMs: roundMs(lastRenderMs),
      lastVisualFrameMs: roundMs(lastVisualFrameMs),
      lastAutoFrameGapMs: roundMs(lastAutoFrameGapMs),
    };
  }

  function renderFrameCounter() {
    frameCounter.update(currentFrameMetrics());
  }

  function stop() {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    autoInput.checked = false;
    lastAutoTickAt = 0;
  }

  async function applyTrainingReplayLimits() {
    const configuration = getSelectedConfiguration();
    if (!configuration.trainingBatchReplay || !result?.metrics) return;
    const resetPlacements = {};
    const resetDrivers = [];
    activeControlledDrivers.forEach((driverId, index) => {
      const metric = result.metrics[driverId] ?? {};
      const runtime = trainingReplayRuntime.get(driverId) ?? createTrainingReplayDriverRuntime();
      trainingReplayRuntime.set(driverId, runtime);
      updateTrainingReplayRuntime(runtime, metric);
      const reason = trainingReplayResetReason(runtime, metric);
      if (!reason) return;
      runtime.episodeId += 1;
      recordTrainingReplayReset(trainingReplayStats, driverId, reason);
      resetDrivers.push(driverId);
      resetPlacements[driverId] = trainingReplayPlacement(driverId, index, runtime, configuration.trainingStage ?? 'basic-track-follow');
      trainingReplayRuntime.set(driverId, createTrainingReplayDriverRuntime(runtime.episodeId));
    });
    if (!resetDrivers.length) return;
    result = await controllerLoop.resetDrivers(resetPlacements, {
      observationScope: 'all',
      resetDriversObservationScope: 'all',
      stateOutput: 'minimal',
    });
    syncControllerLoopStats();
  }

  function startAutoRun() {
    stop();
    autoInput.checked = true;
    let ticking = false;
    const tick = async () => {
      if (!autoInput.checked) return;
      if (ticking) return;
      ticking = true;
      try {
        const now = performance.now();
        lastAutoFrameGapMs = lastAutoTickAt > 0 ? now - lastAutoTickAt : 0;
        lastAutoTickAt = now;
        await stepVisualFrame();
      } finally {
        ticking = false;
      }
      if (!result?.done && autoInput.checked) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };
    animationFrame = window.requestAnimationFrame(tick);
  }

  function stopGrowthReplay() {
    if (growthTimer) window.clearInterval(growthTimer);
    growthTimer = null;
    if (growthAutoInput) growthAutoInput.checked = false;
  }

  async function loadPolicySelection(value) {
    stop();
    const selectedItem = history?.items?.find((item) => String(item.generation) === value) ?? null;
    const nextUrl = selectedItem ? checkpointPolicyUrl(selectedItem.policy) : LOCAL_CHECKPOINT_POLICY_URL;
    const nextPayload = await loadCheckpointPolicyPayload(nextUrl);
    if (!nextPayload) return;
    activeCheckpointUrl = nextUrl;
    activeHistoryItem = selectedItem;
    activePayload = nextPayload;
    if (controllerSelect) controllerSelect.value = 'hybrid-checkpoint';
    activeController = createSelectedController();
    if (growthSelect) growthSelect.value = selectedItem ? String(selectedItem.generation) : 'latest';
    await mountSelectedConfiguration();
  }

  async function loadAdjacentGeneration(direction) {
    if (!history?.items?.length || !growthSelect) return;
    const values = history.items.map((item) => String(item.generation));
    const matchedIndex = values.indexOf(growthSelect.value);
    const currentIndex = matchedIndex >= 0 ? matchedIndex : -1;
    const nextIndex = Math.min(values.length - 1, Math.max(0, currentIndex + direction));
    await loadPolicySelection(values[nextIndex]);
  }

  function setupGrowthControls() {
    if (!growthSelect || !growthPrevButton || !growthNextButton || !growthAutoInput) return;
    growthSelect.disabled = false;
    renderGrowthOptions();
    growthSelect.addEventListener('change', () => {
      stopGrowthReplay();
      loadPolicySelection(growthSelect.value);
    });
    growthPrevButton.addEventListener('click', () => {
      stopGrowthReplay();
      loadAdjacentGeneration(-1);
    });
    growthNextButton.addEventListener('click', () => {
      stopGrowthReplay();
      loadAdjacentGeneration(1);
    });
    growthAutoInput.addEventListener('change', async () => {
      if (!growthAutoInput.checked) {
        stopGrowthReplay();
        return;
      }
      await refreshCheckpointHistory();
      if (!history?.items?.length) {
        growthAutoInput.checked = false;
        return;
      }
      await loadPolicySelection(String(history.items[0].generation));
      startAutoRun();
      growthTimer = window.setInterval(async () => {
        const currentIndex = history.items.findIndex((item) => String(item.generation) === growthSelect.value);
        const nextIndex = currentIndex + 1;
        if (nextIndex >= history.items.length) {
          await refreshCheckpointHistory();
          return;
        }
        await loadPolicySelection(String(history.items[nextIndex].generation));
        startAutoRun();
      }, POLICY_GROWTH_INTERVAL_MS);
    });
    historyRefreshTimer = window.setInterval(refreshCheckpointHistory, POLICY_GROWTH_INTERVAL_MS);
  }

  function renderGrowthOptions() {
    if (!growthSelect || !growthPrevButton || !growthNextButton || !growthAutoInput) return;
    const previousValue = growthSelect.value || 'latest';
    const items = history?.items ?? [];
    growthPrevButton.disabled = !items.length;
    growthNextButton.disabled = !items.length;
    growthAutoInput.disabled = !items.length;
    growthSelect.replaceChildren(
      new Option(activePayload ? 'Latest exported' : 'No checkpoint exported', 'latest'),
      ...items.map((item) => new Option(
        `${item.label} · score ${Number(item.score ?? 0).toFixed(0)}`,
        String(item.generation),
      )),
    );
    const optionValues = new Set(Array.from(growthSelect.options).map((option) => option.value));
    growthSelect.value = optionValues.has(previousValue) ? previousValue : 'latest';
  }

  async function refreshCheckpointHistory() {
    const nextHistory = await loadCheckpointHistoryManifest(LOCAL_CHECKPOINT_HISTORY_URL);
    if (!nextHistory) return;
    const previousKey = (history?.items ?? []).map((item) => `${item.generation}:${item.score}`).join('|');
    const nextKey = nextHistory.items.map((item) => `${item.generation}:${item.score}`).join('|');
    history = nextHistory;
    if (previousKey !== nextKey) renderGrowthOptions();
  }

  function getSelectedConfiguration() {
    return configurationOptions.find((option) => option.id === configurationSelect?.value) ?? configurationOptions[0];
  }

  function createSelectedController() {
    if (activeControllerKind() === 'lab-remote') {
      return createLabRemoteController({
        checkpoint: activeHistoryItem?.checkpoint ?? activePayload?.createdFrom,
        stage: getSelectedConfiguration().trainingStage ?? activePayload?.stage ?? 'basic-track-follow',
        maxSteps: POLICY_TRAINING_REPLAY_MAX_POLICY_STEPS,
        frameSkip: POLICY_ACTION_HOLD_FRAMES,
      });
    }
    if (activeControllerKind() === 'hybrid-checkpoint' && activePayload) {
      return createHybridCheckpointController(activePayload);
    }
    return createHeuristicController();
  }

  function activeControllerKind() {
    return controllerSelect?.value ?? (activePayload ? 'hybrid-checkpoint' : 'heuristic');
  }

  function activeControllerMetadata() {
    return {
      id: activeController?.id ?? activeControllerKind(),
      label: activeController?.label ?? activeControllerKind(),
      batched: true,
      actionRepeat: POLICY_ACTION_HOLD_FRAMES,
    };
  }

  function syncControllerLoopStats() {
    const stats = controllerLoop?.stats;
    if (!stats) return;
    heldAction = stats.actions;
    heldFramesRemaining = stats.heldFramesRemaining;
    policyStep = stats.policyStep;
    lastPolicyDecisionMs = stats.lastDecisionMs;
  }

  function activeRayLayout() {
    return activePayload?.model?.rayLayout ?? activePayload?.rayLayout ?? 'driver-front-heavy';
  }

  function activeLookaheadMeters() {
    const value = activePayload?.model?.lookaheadMeters ?? activePayload?.lookaheadMeters;
    return Array.isArray(value) ? value : [];
  }

  function activePolicyPhysicsMode() {
    const value = activeHistoryItem?.physicsMode
      ?? activePayload?.physicsMode
      ?? activePayload?.metadata?.physicsMode
      ?? activePayload?.model?.physicsMode;
    return value === 'arcade' ? 'arcade' : 'simulator';
  }

  function selectedPolicyRunnerPhysicsMode(configuration) {
    const previewOverride = explicitPreviewPhysicsMode();
    if (previewOverride) return previewOverride;
    if (activeControllerKind() === 'hybrid-checkpoint' || activeControllerKind() === 'lab-remote') {
      return activePolicyPhysicsMode();
    }
    return configuration?.options?.physicsMode === 'arcade' ? 'arcade' : 'simulator';
  }

  controllerSelect?.addEventListener('change', async () => {
    stopGrowthReplay();
    activeController = createSelectedController();
    await mountSelectedConfiguration();
  });
  configurationSelect?.addEventListener('change', mountSelectedConfiguration);
  resetButton.addEventListener('click', reset);
  stepButton.addEventListener('click', step);
  autoInput.addEventListener('change', () => {
    if (!autoInput.checked) {
      stop();
      return;
    }
    startAutoRun();
  });

  setupGrowthControls();
  await mountSelectedConfiguration();
}

function createPolicyRunnerTrainingField(count = 20) {
  const drivers = Array.from({ length: count }, (_, index) => {
    const source = DEMO_PROJECT_DRIVERS[index % DEMO_PROJECT_DRIVERS.length];
    return {
      ...source,
      id: `policy-agent-${String(index + 1).padStart(2, '0')}`,
      code: `P${String(index + 1).padStart(2, '0')}`,
      icon: `${index + 1}`,
      raceName: `POLICY-${String(index + 1).padStart(2, '0')}`,
      name: `Policy Agent ${index + 1}`,
      color: colorForPolicyAgent(index),
      tire: 'M',
    };
  });
  const entries = drivers.map((driver, index) => {
    const source = CHAMPIONSHIP_ENTRY_BLUEPRINTS[index % CHAMPIONSHIP_ENTRY_BLUEPRINTS.length] ?? {};
    return {
      ...source,
      driverId: driver.id,
      driverNumber: 71 + index,
      timingName: driver.code,
      driver: {
        ...(source.driver ?? {}),
        pace: 75,
        racecraft: 75,
        aggression: 55,
        riskTolerance: 55,
        patience: 65,
        consistency: 70,
      },
      vehicle: {
        ...(source.vehicle ?? {}),
        id: `${driver.id}-car`,
        name: `Policy ${index + 1}`,
        power: 75,
        braking: 70,
        aero: 72,
        dragEfficiency: 68,
        mechanicalGrip: 74,
        weightControl: 70,
        tireCare: 100,
      },
    };
  });
  return { drivers, entries };
}

function colorForPolicyAgent(index) {
  const colors = ['#e10600', '#00a3ff', '#f1c65b', '#49d17d', '#ff7b00', '#a855f7', '#06b6d4', '#ef4444'];
  return colors[index % colors.length];
}

function createPolicyRunnerConfigurations(trainingField, primaryControlledDriver) {
  const controlledDrivers = trainingField.drivers.map((driver) => driver.id);
  return [
    {
      id: 'generation',
      label: `Generation - ${controlledDrivers.length} self-learning cars`,
      trackSeed: 2097,
      totalLaps: 5,
      controlledDrivers,
      options: {
        drivers: trainingField.drivers,
        entries: trainingField.entries,
        trackQueryIndex: true,
        participantInteractions: {
          defaultProfile: 'batch-training',
        },
        scenario: {
          placements: policyRunnerTrainingPlacements(controlledDrivers, 'basic-track-follow'),
        },
        rules: trainingPolicyRules(),
      },
    },
    {
      id: 'training-batch',
      label: `Training Batch Replay - ${controlledDrivers.length} cars`,
      trackSeed: 2097,
      totalLaps: 5,
      controlledDrivers,
      trainingBatchReplay: true,
      trainingStage: 'basic-track-follow',
      options: {
        drivers: trainingField.drivers,
        entries: trainingField.entries,
        trackQueryIndex: true,
        participantInteractions: {
          defaultProfile: 'batch-training',
        },
        scenario: {
          placements: policyRunnerTrainingPlacements(controlledDrivers, 'basic-track-follow'),
        },
        rules: trainingPolicyRules(),
      },
    },
    {
      id: 'race',
      label: 'Race - full real field',
      controlledDrivers: [primaryControlledDriver],
      options: {
        drivers: DEMO_PROJECT_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      },
    },
  ].map((configuration) => ({
    ...configuration,
    options: {
      ...configuration.options,
      trackQueryIndex: configuration.options.trackQueryIndex ?? true,
      controlledDrivers: configuration.controlledDrivers,
      physicsMode: previewPhysicsMode(),
      observation: {
        ...(configuration.options.observation ?? {}),
        profile: 'physical-driver',
        output: 'full',
        includeSchema: true,
      },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
          precision: 'driver',
          ...(configuration.options.sensors?.rays ?? {}),
        },
        nearbyCars: {
          enabled: configuration.id === 'race',
          maxCars: 6,
          radiusMeters: 160,
          ...(configuration.options.sensors?.nearbyCars ?? {}),
        },
      },
    },
  }));
}

function policyRunnerTrainingPlacements(driverIds, stage = 'basic-track-follow') {
  return Object.fromEntries(driverIds.map((driverId, index) => [
    driverId,
    trainingReplayPlacement(driverId, index, { episodeId: 0 }, stage),
  ]));
}

function createTrainingReplayDriverRuntime(episodeId = 0) {
  return {
    episodeId,
    policyStep: 0,
    visualFramesInEpisode: 0,
    consecutiveUnder30Frames: 0,
    consecutiveSpinFrames: 0,
    completedLaps: 0,
  };
}

function updateTrainingReplayRuntime(runtime, metric) {
  runtime.visualFramesInEpisode += 1;
  if (runtime.visualFramesInEpisode % POLICY_ACTION_HOLD_FRAMES === 1) {
    runtime.policyStep += 1;
  }
  runtime.consecutiveUnder30Frames = metric.under30kph ? runtime.consecutiveUnder30Frames + 1 : 0;
  runtime.consecutiveSpinFrames = metric.spinOrBackwards ? runtime.consecutiveSpinFrames + 1 : 0;
  if (metric.completedLap) runtime.completedLaps += 1;
}

function trainingReplayResetReason(runtime, metric) {
  if (metric.destroyed) return 'destroyed';
  if (metric.fullyOutsideWhiteLine || metric.severeCut) return 'illegal';
  if (metric.offTrack && !metric.kerb) return 'illegal';
  if (runtime.consecutiveUnder30Frames >= POLICY_TRAINING_REPLAY_STALL_POLICY_STEPS * POLICY_ACTION_HOLD_FRAMES) return 'stall';
  if (runtime.consecutiveSpinFrames >= POLICY_TRAINING_REPLAY_SPIN_POLICY_STEPS * POLICY_ACTION_HOLD_FRAMES) return 'spin';
  if (runtime.policyStep >= POLICY_TRAINING_REPLAY_MAX_POLICY_STEPS) return 'episode-cap';
  return null;
}

function recordTrainingReplayReset(stats, driverId, reason) {
  stats.resetCount += 1;
  stats.resetReasons[reason] = (stats.resetReasons[reason] ?? 0) + 1;
  stats.lastResetDrivers = [
    `${driverId}:${reason}`,
    ...stats.lastResetDrivers,
  ].slice(0, 8);
}

function trainingReplayPlacement(driverId, index, runtime, stage = 'basic-track-follow') {
  const lane = index % 4;
  const group = Math.floor(index / 4);
  const basicOffset = [-0.45, -0.15, 0.15, 0.45][lane] ?? 0;
  const recoveryOffset = [-3.0, -1.0, 1.0, 3.0][lane] ?? 0;
  const jitter = policyRunnerSeededJitter(71 + runtime.episodeId, index);
  if (stage === 'recovery') {
    return {
      distanceMeters: 2250 + group * 16 + lane * 3,
      offsetMeters: recoveryOffset + (index % 2 === 0 ? 12 : -12),
      speedKph: 55,
      headingErrorRadians: (index % 2 === 0 ? -0.55 : 0.55) + jitter * 0.12,
    };
  }
  if (stage === 'cornering') {
    return {
      distanceMeters: 1050 + group * 16 + lane * 3,
      offsetMeters: basicOffset,
      speedKph: 145,
      headingErrorRadians: jitter * 0.08,
    };
  }
  return {
    distanceMeters: group * 16 + lane * 3,
    offsetMeters: basicOffset,
    speedKph: 80,
    headingErrorRadians: jitter * 0.05,
  };
}

function policyRunnerSeededJitter(seed, index) {
  const x = Math.sin((Number(seed) + 1) * 12.9898 + (index + 1) * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function renderPolicySenses(root, observation, policy = null, driverId = null, physicsMode = previewPhysicsMode()) {
  if (!root) return;
  const object = observation?.object;
  if (!object) {
    root.replaceChildren(textElement('h2', 'Active observation senses'), textElement('p', 'Select a controlled car to show its active senses.'));
    return;
  }

  root.replaceChildren(
    textElement('h2', 'Active observation senses'),
    metricGrid([
      ['Profile', object.profile ?? 'default'],
      ['Vector', `${observation.vector?.length ?? 0} values`],
      ['Schema', `${observation.schema?.length ?? 0} fields`],
      ['Ray channels', activeRayChannelNames(object.rays).join(', ') || 'none'],
      ['Physics', physicsMode],
      ['Memory bin', policy?.debugStateFor?.(driverId)?.memoryBin ?? policy?.debugState?.memoryBin ?? 'n/a'],
      ['Memory writes', policy?.debugStateFor?.(driverId)?.memoryWrites ?? policy?.debugState?.memoryWrites ?? 'n/a'],
    ]),
    senseSection('Car body', [
      ['Speed', formatNumber(object.self.speedKph, 'kph')],
      ['Steering', formatRadians(object.self.steeringAngleRadians)],
      ['Throttle', formatPercent(object.self.throttle)],
      ['Brake', formatPercent(object.self.brake)],
      ['Yaw rate', `${formatNumber(object.self.yawRateRadiansPerSecond, 'rad/s')}`],
      ['Lateral G', formatNumber(object.self.lateralG, 'g')],
      ['Longitudinal G', formatNumber(object.self.longitudinalG, 'g')],
      ['Grip usage', formatNumber(object.self.gripUsage)],
      ['Slip angle', formatRadians(object.self.slipAngleRadians)],
      ['Stability', object.self.stabilityState],
      ['Destroyed', object.self.destroyed ? (object.self.destroyReason ?? 'yes') : 'no'],
      ['Traction limit', object.self.tractionLimited ? 'yes' : 'no'],
    ]),
    senseSection('Track relationship', [
      ['Offset', formatNumber(object.trackRelation?.lateralOffsetMeters, 'm')],
      ['Heading error', formatRadians(object.trackRelation?.headingErrorRadians)],
      ['Left boundary', formatNumber(object.trackRelation?.leftBoundaryMeters, 'm')],
      ['Right boundary', formatNumber(object.trackRelation?.rightBoundaryMeters, 'm')],
      ['Legal width', formatNumber(object.trackRelation?.legalWidthMeters, 'm')],
      ['Surface', object.trackRelation?.surface ?? object.self.surface],
      ['Legal surface', object.trackRelation?.onLegalSurface ? 'yes' : 'no'],
    ]),
    senseSection('Contact patches', (object.contactPatches ?? []).map((patch) => [
      patch.id,
      `${patch.surface}${patch.onLegalSurface ? ' legal' : ' illegal'} · ${formatNumber(patch.signedOffsetMeters, 'm')}`,
    ])),
    senseSection('Opponent radar', (object.nearbyCars ?? []).slice(0, 6).map((car) => [
      car.id,
      [
        `${formatNumber(car.relativeForwardMeters, 'm')} fwd`,
        `${formatNumber(car.relativeRightMeters, 'm')} right`,
        `${formatNumber(car.relativeSpeedKph, 'kph')} rel`,
        `${formatNumber(car.closingRateMetersPerSecond, 'm/s')} closing`,
        car.leftOverlap ? 'left overlap' : null,
        car.rightOverlap ? 'right overlap' : null,
      ].filter(Boolean).join(' · '),
    ])),
    senseSection('Rays', (object.rays ?? []).map((ray) => [
      ray.id ?? `${ray.angleDegrees}deg`,
      [
        `${formatNumber(ray.angleDegrees, 'deg')}`,
        `edge ${formatRayHit(ray.track)}`,
        `kerb ${formatRayHit(ray.kerb)}`,
        `illegalSurface ${formatRayHit(ray.illegalSurface)}`,
        `car ${formatRayHit(ray.car)}`,
      ].join(' · '),
    ])),
  );
}

function activeRayChannelNames(rays) {
  const firstRay = Array.isArray(rays) ? rays[0] : null;
  if (!firstRay) return [];
  return ['track', 'kerb', 'illegalSurface', 'car'].filter((channel) => firstRay[channel]);
}

function senseSection(title, rows) {
  const section = document.createElement('section');
  section.className = 'policy-senses-section';
  section.append(textElement('h3', title));
  if (!rows.length) {
    section.append(textElement('p', 'No current readings.'));
    return section;
  }
  const dl = document.createElement('dl');
  rows.forEach(([label, value]) => {
    dl.append(textElement('dt', label), textElement('dd', value));
  });
  section.append(dl);
  return section;
}

function metricGrid(rows) {
  const grid = document.createElement('dl');
  grid.className = 'policy-senses-metrics';
  rows.forEach(([label, value]) => {
    grid.append(textElement('dt', label), textElement('dd', value));
  });
  return grid;
}

function textElement(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text == null ? 'n/a' : String(text);
  return node;
}

function formatRayHit(hit) {
  if (!hit?.hit) return 'clear';
  const suffix = hit.surface ? ` ${hit.surface}` : hit.kind ? ` ${hit.kind}` : '';
  return `${formatNumber(hit.distanceMeters, 'm')}${suffix}`;
}

function formatRadians(value) {
  return formatNumber(value, 'rad');
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatNumber(value, unit = '') {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'n/a';
  const digits = Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2;
  return `${number.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function trainingPolicyRules() {
  return {
    standingStart: false,
    modules: {
      pitStops: { enabled: false },
      tireDegradation: { enabled: false },
      penalties: {
        trackLimits: { strictness: 0 },
        collision: { strictness: 0 },
      },
    },
  };
}

async function loadCheckpointHistoryManifest(url) {
  let response = null;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let manifest = null;
  try {
    manifest = await response.json();
  } catch {
    return null;
  }
  if (!['paddockjs-training-lab-hybrid-history-v1', 'paddockjs-training-lab-population-history-v1'].includes(manifest?.format)) return null;
  if (!Array.isArray(manifest.items)) return null;
  return {
    ...manifest,
    items: manifest.items.filter((item) => Number.isInteger(item?.generation) && typeof item?.policy === 'string'),
  };
}

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

const COLLISION_LAB_CENTER_Y = 310;
const COLLISION_LAB_START_X = 80;
const COLLISION_LAB_SAMPLE_SPACING = 20;
const COLLISION_LAB_TRACK = {
  name: 'Collision Lab Straight',
  width: 230,
  kerbWidth: 34,
  gravelWidth: 165,
  runoffWidth: 180,
  length: 880,
  pitLane: { enabled: false },
  samples: Array.from({ length: 45 }, (_, index) => ({
    x: COLLISION_LAB_START_X + index * COLLISION_LAB_SAMPLE_SPACING,
    y: COLLISION_LAB_CENTER_Y,
    distance: index * COLLISION_LAB_SAMPLE_SPACING,
    heading: 0,
    normalX: 0,
    normalY: 1,
    curvature: 0,
  })),
};

function createLabCar(id, label, color, x, y, heading = 0) {
  return {
    id,
    label,
    color,
    x,
    y,
    previousX: x,
    previousY: y,
    heading,
    previousHeading: heading,
    progress: Math.max(0, Math.min(COLLISION_LAB_TRACK.length, x - COLLISION_LAB_START_X)),
    raceDistance: Math.max(0, x - COLLISION_LAB_START_X),
    speed: 0,
  };
}

function setLabCarPose(car, pose) {
  car.previousX = Number.isFinite(pose.previousX) ? pose.previousX : car.x;
  car.previousY = Number.isFinite(pose.previousY) ? pose.previousY : car.y;
  car.previousHeading = Number.isFinite(pose.previousHeading) ? pose.previousHeading : car.heading;
  car.x = pose.x;
  car.y = pose.y;
  car.heading = pose.heading;
  car.progress = Math.max(0, Math.min(COLLISION_LAB_TRACK.length, car.x - COLLISION_LAB_START_X));
  car.raceDistance = car.progress;
}

function createCollisionLabScenarios() {
  const y = COLLISION_LAB_CENTER_Y;
  return {
    'body-body': {
      alpha: { x: 410, y, heading: 0, previousX: 360, previousY: y, previousHeading: 0 },
      beta: { x: 445, y, heading: 0, previousX: 445, previousY: y, previousHeading: 0 },
    },
    'wheel-body': {
      alpha: { x: 410, y, heading: 0, previousX: 370, previousY: y, previousHeading: 0 },
      beta: { x: 470, y, heading: 0, previousX: 470, previousY: y, previousHeading: 0 },
    },
    'near-miss': {
      alpha: { x: 410, y, heading: 0, previousX: 370, previousY: y, previousHeading: 0 },
      beta: { x: 504, y: y + 31, heading: 0, previousX: 504, previousY: y + 31, previousHeading: 0 },
    },
    'one-kerb': {
      alpha: { x: 380, y: y + 95, heading: Math.PI / 2, previousX: 380, previousY: y + 40, previousHeading: Math.PI / 2 },
      beta: { x: 540, y: y - 42, heading: 0, previousX: 540, previousY: y - 42, previousHeading: 0 },
    },
    'one-gravel': {
      alpha: { x: 380, y: y + 130, heading: Math.PI / 2, previousX: 380, previousY: y + 80, previousHeading: Math.PI / 2 },
      beta: { x: 540, y: y - 42, heading: 0, previousX: 540, previousY: y - 42, previousHeading: 0 },
    },
    'all-outside': {
      alpha: { x: 390, y: y + 155, heading: 0, previousX: 340, previousY: y + 155, previousHeading: 0 },
      beta: { x: 550, y: y - 42, heading: 0, previousX: 550, previousY: y - 42, previousHeading: 0 },
    },
    'diagonal-transition': {
      alpha: { x: 410, y: y + 118, heading: Math.PI / 4, previousX: 360, previousY: y + 92, previousHeading: Math.PI / 4 },
      beta: { x: 560, y: y - 42, heading: 0, previousX: 560, previousY: y - 42, previousHeading: 0 },
    },
  };
}

function drawLabRect(context, shape, fill, stroke, lineWidth = 2) {
  context.beginPath();
  shape.corners.forEach((corner, index) => {
    if (index === 0) context.moveTo(corner.x, corner.y);
    else context.lineTo(corner.x, corner.y);
  });
  context.closePath();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.fill();
  context.stroke();
}

function drawLabTrack(context, canvas) {
  const trackEdge = COLLISION_LAB_TRACK.width / 2;
  const kerbEdge = trackEdge + COLLISION_LAB_TRACK.kerbWidth;
  const gravelEdge = kerbEdge + COLLISION_LAB_TRACK.gravelWidth;
  const runoffEdge = gravelEdge + COLLISION_LAB_TRACK.runoffWidth;
  const left = COLLISION_LAB_START_X;
  const right = COLLISION_LAB_START_X + COLLISION_LAB_TRACK.length;
  const fillBand = (offset, color) => {
    context.fillStyle = color;
    context.fillRect(left, COLLISION_LAB_CENTER_Y - offset, right - left, offset * 2);
  };

  context.fillStyle = '#182015';
  context.fillRect(0, 0, canvas.width, canvas.height);
  fillBand(runoffEdge, '#314024');
  fillBand(gravelEdge, '#67553e');
  fillBand(kerbEdge, '#7b1f24');
  fillBand(trackEdge, '#30343a');
  context.fillStyle = '#e8e5dc';
  context.fillRect(left, COLLISION_LAB_CENTER_Y - trackEdge - 2, right - left, 4);
  context.fillRect(left, COLLISION_LAB_CENTER_Y + trackEdge - 2, right - left, 4);
  context.strokeStyle = 'rgba(241, 198, 91, 0.42)';
  context.lineWidth = 2;
  context.setLineDash([12, 14]);
  context.beginPath();
  context.moveTo(left, COLLISION_LAB_CENTER_Y);
  context.lineTo(right, COLLISION_LAB_CENTER_Y);
  context.stroke();
  context.setLineDash([]);
}

function drawLabCar(context, car, surfaceState, selected) {
  const geometry = createVehicleGeometry(car);
  const previousGeometry = createVehicleGeometry(car, { previous: true });
  const stroke = selected ? '#f1c65b' : car.color;

  context.strokeStyle = `${car.color}66`;
  context.lineWidth = 1.5;
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(previousGeometry.body.center.x, previousGeometry.body.center.y);
  context.lineTo(geometry.body.center.x, geometry.body.center.y);
  context.stroke();
  context.setLineDash([]);

  drawLabRect(context, geometry.body, `${car.color}44`, stroke, selected ? 3 : 2);
  geometry.wheels.forEach((wheel) => {
    const wheelState = surfaceState.wheels.find((candidate) => candidate.id === wheel.id);
    const fill = wheelState?.surface === 'track'
      ? '#d8dee944'
      : wheelState?.surface === 'kerb'
        ? '#ff4d5f77'
        : wheelState?.surface === 'gravel'
          ? '#d4a15f88'
          : '#7aa65d88';
    drawLabRect(context, wheel, fill, '#f4f1ea', 1.4);
    context.fillStyle = '#f4f1ea';
    context.font = '11px IBM Plex Sans, sans-serif';
    context.fillText(`${wheel.id}:${wheelState?.surface ?? 'n/a'}`, wheel.center.x + 8, wheel.center.y - 8);
  });

  context.fillStyle = '#f4f1ea';
  context.font = '700 13px IBM Plex Sans, sans-serif';
  context.fillText(car.label, geometry.body.center.x - 14, geometry.body.center.y - 18);
}

function mountCollisionLabPage() {
  const root = document.querySelector('[data-collision-lab]');
  const canvas = document.querySelector('[data-collision-lab-canvas]');
  const readout = document.querySelector('[data-collision-lab-readout]');
  if (!root || !canvas || !readout) return;

  const context = canvas.getContext('2d');
  const scenarios = createCollisionLabScenarios();
  const cars = {
    alpha: createLabCar('lab-alpha', 'A', '#58a6ff', 410, COLLISION_LAB_CENTER_Y),
    beta: createLabCar('lab-beta', 'B', '#ff5f7a', 445, COLLISION_LAB_CENTER_Y),
  };
  let selectedId = 'alpha';
  let drag = null;
  let snapshot = null;

  function applyScenario(name) {
    const scenario = scenarios[name] ?? scenarios['body-body'];
    setLabCarPose(cars.alpha, scenario.alpha);
    setLabCarPose(cars.beta, scenario.beta);
    selectedId = 'alpha';
    render();
  }

  function computeSnapshot() {
    const alphaSurface = calculateWheelSurfaceState({ car: cars.alpha, track: COLLISION_LAB_TRACK });
    const betaSurface = calculateWheelSurfaceState({ car: cars.beta, track: COLLISION_LAB_TRACK });
    const collision = detectVehicleCollision(cars.alpha, cars.beta);
    return {
      collision: collision ? {
        contactType: collision.contactType,
        firstShapeId: collision.firstShapeId,
        secondShapeId: collision.secondShapeId,
        depth: Number(collision.depth.toFixed(3)),
        timeOfImpact: Number(collision.timeOfImpact.toFixed(3)),
        axis: {
          x: Number(collision.axis.x.toFixed(3)),
          y: Number(collision.axis.y.toFixed(3)),
        },
      } : null,
      cars: {
        alpha: {
          surface: alphaSurface.effectiveSurface,
          trackLimits: alphaSurface.trackLimits,
          wheels: alphaSurface.wheels.map((wheel) => ({
            id: wheel.id,
            surface: wheel.surface,
            signedOffset: Number(wheel.signedOffset.toFixed(2)),
            fullyOutsideWhiteLine: wheel.fullyOutsideWhiteLine,
          })),
        },
        beta: {
          surface: betaSurface.effectiveSurface,
          trackLimits: betaSurface.trackLimits,
          wheels: betaSurface.wheels.map((wheel) => ({
            id: wheel.id,
            surface: wheel.surface,
            signedOffset: Number(wheel.signedOffset.toFixed(2)),
            fullyOutsideWhiteLine: wheel.fullyOutsideWhiteLine,
          })),
        },
      },
    };
  }

  function render() {
    snapshot = computeSnapshot();
    drawLabTrack(context, canvas);
    const alphaSurface = calculateWheelSurfaceState({ car: cars.alpha, track: COLLISION_LAB_TRACK });
    const betaSurface = calculateWheelSurfaceState({ car: cars.beta, track: COLLISION_LAB_TRACK });
    drawLabCar(context, cars.alpha, alphaSurface, selectedId === 'alpha');
    drawLabCar(context, cars.beta, betaSurface, selectedId === 'beta');

    if (snapshot.collision) {
      const centerX = (cars.alpha.x + cars.beta.x) / 2;
      const centerY = (cars.alpha.y + cars.beta.y) / 2;
      context.strokeStyle = '#f1c65b';
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(
        centerX + snapshot.collision.axis.x * 46,
        centerY + snapshot.collision.axis.y * 46,
      );
      context.stroke();
    }

    readout.textContent = JSON.stringify(snapshot, null, 2);
    window.__paddockCollisionLab = {
      snapshot,
      setScenario: applyScenario,
      cars,
    };
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function pickCar(point) {
    const candidates = Object.entries(cars).map(([id, car]) => ({
      id,
      distance: Math.hypot(point.x - car.x, point.y - car.y),
    })).sort((first, second) => first.distance - second.distance);
    return candidates[0]?.distance < 70 ? candidates[0].id : selectedId;
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    selectedId = pickCar(point);
    const car = cars[selectedId];
    drag = {
      id: selectedId,
      dx: point.x - car.x,
      dy: point.y - car.y,
    };
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const point = canvasPoint(event);
    const car = cars[drag.id];
    setLabCarPose(car, {
      x: point.x - drag.dx,
      y: point.y - drag.dy,
      heading: car.heading,
    });
    render();
  });

  canvas.addEventListener('pointerup', (event) => {
    drag = null;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const car = cars[selectedId];
    setLabCarPose(car, {
      x: car.x,
      y: car.y,
      heading: car.heading + (event.deltaY > 0 ? 0.08 : -0.08),
    });
    render();
  }, { passive: false });

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-collision-scenario]')
      : null;
    if (!button) return;
    applyScenario(button.dataset.collisionScenario);
  });

  applyScenario('body-body');
}

async function main() {
  mountSharedPreviewHeader();
  synchronizePreviewPhysicsLinks();
  if (page === 'templates') await mountTemplatesPage();
  if (page === 'components') await mountComponentsPage();
  if (page === 'api') await mountApiPage();
  if (page === 'behavior') await mountBehaviorPage();
  if (page === 'stewarding') await mountStewardingPage();
  if (page === 'collision-lab') mountCollisionLabPage();
  if (page === 'policy-runner') await mountPolicyRunnerPage();

  window.paddockPreview = Object.fromEntries(controllers);
}

main().catch((error) => {
  console.error('[PaddockJS preview] failed to mount', error);
});
