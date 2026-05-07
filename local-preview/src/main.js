import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
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
  mountTelemetrySectorBanner,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  mountTimingTower,
} from '@inventure71/paddockjs';
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';

const page = document.body.dataset.page ?? 'home';
const controllers = new Map();
const eventLog = document.querySelector('[data-event-log]');
const snapshotReadout = document.querySelector('[data-preview-snapshot]');
const finishSnapshotReadout = document.querySelector('[data-finish-snapshot]');
const penaltySnapshotReadout = document.querySelector('[data-penalty-snapshot]');
const SHOWCASE_TRACK_SEED = 20260430;
const EXPERT_AUTO_INTERVAL_MS = 32;
const EXPERT_AUTO_STEPS_PER_TICK = 8;
const LAZY_START_ROOT_MARGIN = '760px 0px';

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

function commonOptions(label = 'preview') {
  return {
    drivers: DEMO_PROJECT_DRIVERS,
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    backLinkHref: '/',
    backLinkLabel: 'Preview',
    onDriverOpen: hostDriverOpen,
    onLoadingChange({ phase }) {
      appendEvent(`${label}:loading`, phase);
    },
    onReady({ snapshot }) {
      appendEvent(`${label}:ready`, snapshot.raceControl.mode);
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
    standingStart: false,
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
  sim.step(1 / 60);

  const snapshot = sim.snapshot();
  controller.app.updateDom(snapshot);
  renderPenaltySnapshot(controller);
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
      return;
    }

    if (button.dataset.action === 'safety') {
      controllers.forEach((controller) => controller.toggleSafetyCar?.());
      return;
    }

    if (button.dataset.action === 'snapshot') {
      renderSnapshot();
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
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 14,
    rules: stewardRules(),
    theme: {
      accentColor: '#f1c65b',
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '680px',
    },
    ui: {
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    },
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
    ui: {
      raceDataBannerSize: 'custom',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    },
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
    ui: {
      showFps: true,
      raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
    },
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
    ui: {
      raceDataBannerSize: 'auto',
      raceDataTelemetryDetail: true,
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
    },
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
    ui: {
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    },
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
    ui: {
      showFps: false,
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    },
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
    ui: {
      cameraControls: false,
    },
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
  mountCarDriverOverview(requiredElement('component-overview'), pieces);
  mountRaceDataPanel(requiredElement('component-race-data'), pieces);

  await pieces.start();
  addController('pieces', pieces);
}

async function mountApiPage() {
  const controller = await mountF1Simulator(requiredElement('api-simulator-root'), {
    ...commonOptions('api'),
    preset: 'timing-overlay',
    title: 'API Target',
    kicker: 'controller + callbacks',
    seed: 8171,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 5,
    theme: {
      accentColor: '#f1c65b',
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '650px',
    },
    ui: {
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    },
  });
  addController('api-target', controller);
  wireDriverButtons();
  wireActions();
  renderSnapshot();
  window.setInterval(renderSnapshot, 1000);
}

async function mountBehaviorPage() {
  const expand = createPaddockSimulator({
    ...commonOptions('expand-fit'),
    seed: 9111,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 6,
    theme: { raceViewMinHeight: '620px', timingTowerMaxWidth: '340px' },
    ui: { raceDataBannerSize: 'auto', timingTowerVerticalFit: 'expand-race-view' },
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
    ui: { raceDataBannerSize: 'auto', timingTowerVerticalFit: 'scroll' },
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
    ui: {
      raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
    },
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
      standingStart: false,
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
    ui: {
      penaltyBanners: true,
      timingPenaltyBadges: true,
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    },
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

async function mountExpertEnvironmentPage() {
  const controlledDriver = DEMO_PROJECT_DRIVERS[0].id;
  const modeSelect = document.querySelector('[data-expert-mode]');
  const autoRun = document.querySelector('[data-expert-auto-run]');
  const readout = document.querySelector('[data-expert-readout]');
  const visualRoot = requiredElement('expert-visual-root');
  let visualSimulator = null;
  let headlessEnv = null;
  let result = null;
  let timer = null;

  function expertOptions() {
    return {
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [controlledDriver],
      seed: 71,
      trackSeed: SHOWCASE_TRACK_SEED,
      totalLaps: 3,
      frameSkip: 4,
      reward({ current }) {
        return current.object.self.speedKph / 100;
      },
    };
  }

  function controller(observation) {
    const self = observation?.[controlledDriver]?.object?.self;
    const headingError = self?.trackHeadingErrorRadians ?? 0;
    const trackOffset = self?.trackOffsetMeters ?? 0;
    return {
      [controlledDriver]: {
        steering: Math.max(-1, Math.min(1, -headingError * 1.7 - trackOffset * 0.08)),
        throttle: 0.72,
        brake: 0,
      },
    };
  }

  async function ensureVisual() {
    if (visualSimulator) return visualSimulator;
    visualSimulator = await mountF1Simulator(visualRoot, {
      ...commonOptions('expert'),
      preset: 'compact-race',
      title: 'Expert Visual Environment',
      kicker: 'manual expert stepping',
      expert: {
        enabled: true,
        controlledDrivers: [controlledDriver],
        frameSkip: 4,
        visualizeSensors: {
          rays: true,
        },
      },
      seed: 71,
      trackSeed: SHOWCASE_TRACK_SEED,
      totalLaps: 3,
      ui: {
        raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
      },
    });
    visualSimulator.selectDriver(controlledDriver);
    addController('expert-visual', visualSimulator);
    return visualSimulator;
  }

  function ensureHeadless() {
    if (!headlessEnv) headlessEnv = createPaddockEnvironment(expertOptions());
    return headlessEnv;
  }

  async function activeEnvironment() {
    if (modeSelect.value === 'visual') return (await ensureVisual()).expert;
    return ensureHeadless();
  }

  async function reset() {
    const env = await activeEnvironment();
    result = env.reset();
    render();
  }

  async function step() {
    const env = await activeEnvironment();
    if (!result) result = env.reset();
    result = env.step(controller(result.observation));
    render();
    if (result.done) stopAutoRun();
  }

  function render() {
    const driverObservation = result?.observation?.[controlledDriver];
    readout.textContent = JSON.stringify({
      mode: modeSelect.value,
      step: result?.info?.step,
      done: result?.done,
      reward: result?.reward,
      self: driverObservation?.object?.self,
      rays: driverObservation?.object?.rays,
      nearbyCars: driverObservation?.object?.nearbyCars?.slice(0, 3),
      events: result?.events,
      vectorLength: driverObservation?.vector?.length,
      schema: driverObservation?.schema,
      seed: result?.info?.seed,
      trackSeed: result?.info?.trackSeed,
    }, null, 2);
  }

  function stopAutoRun() {
    if (timer) window.clearInterval(timer);
    timer = null;
    autoRun.checked = false;
  }

  document.querySelector('[data-expert-reset]').addEventListener('click', reset);
  document.querySelector('[data-expert-step]').addEventListener('click', step);
  autoRun.addEventListener('change', () => {
    if (!autoRun.checked) {
      stopAutoRun();
      return;
    }
    timer = window.setInterval(async () => {
      for (let index = 0; index < EXPERT_AUTO_STEPS_PER_TICK && autoRun.checked; index += 1) {
        await step();
        if (result?.done) break;
      }
    }, EXPERT_AUTO_INTERVAL_MS);
  });
  modeSelect.addEventListener('change', async () => {
    stopAutoRun();
    result = null;
    await reset();
  });

  await reset();
}

async function mountPolicyRunnerPage() {
  const root = requiredElement('policy-runner-root');
  const readout = document.querySelector('[data-policy-runner-readout]');
  const resetButton = document.querySelector('[data-policy-runner-reset]');
  const stepButton = document.querySelector('[data-policy-runner-step]');
  const autoInput = document.querySelector('[data-policy-runner-auto]');
  const controlledDriver = DEMO_PROJECT_DRIVERS[0].id;
  let result = null;
  let timer = null;

  const simulator = await mountF1Simulator(root, {
    ...commonOptions('policy-runner'),
    preset: 'compact-race',
    title: 'Policy Runner',
    kicker: 'policy.predict(observation) -> action',
    seed: 71,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 3,
    expert: {
      enabled: true,
      controlledDrivers: [controlledDriver],
      frameSkip: 4,
      visualizeSensors: { rays: true },
    },
    ui: {
      raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
    },
  });
  simulator.selectDriver(controlledDriver);
  addController('policy-runner', simulator);

  const policy = {
    predict(observation) {
      const self = observation.object.self;
      const frontRay = observation.object.rays.find((ray) => ray.angleDegrees === 0);
      const leftRay = observation.object.rays.find((ray) => ray.angleDegrees === -60);
      const rightRay = observation.object.rays.find((ray) => ray.angleDegrees === 60);
      const frontDistance = frontRay?.track?.distanceMeters ?? 120;
      const rayBalance = (rightRay?.track?.distanceMeters ?? 120) - (leftRay?.track?.distanceMeters ?? 120);
      return {
        steering: clampPolicyAction(-self.trackHeadingErrorRadians * 1.4 - self.trackOffsetMeters * 0.08 + rayBalance * 0.004, -1, 1),
        throttle: clampPolicyAction(0.72 - Math.max(0, 35 - frontDistance) / 80, 0, 1),
        brake: clampPolicyAction(Math.max(0, 28 - frontDistance) / 60, 0, 1),
      };
    },
  };

  function reset() {
    result = simulator.expert.reset();
    render(null);
  }

  function step() {
    if (!result) result = simulator.expert.reset();
    const observation = result.observation[controlledDriver];
    const action = policy.predict(observation);
    result = simulator.expert.step({ [controlledDriver]: action });
    render(action);
    if (result.done) stop();
  }

  function render(action) {
    const observation = result?.observation?.[controlledDriver];
    readout.textContent = JSON.stringify({
      step: result?.info?.step,
      action,
      self: observation?.object?.self,
      rays: observation?.object?.rays,
      actionSpec: simulator.expert.getActionSpec(),
      observationSpec: simulator.expert.getObservationSpec(),
    }, null, 2);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    autoInput.checked = false;
  }

  resetButton.addEventListener('click', reset);
  stepButton.addEventListener('click', step);
  autoInput.addEventListener('change', () => {
    if (!autoInput.checked) {
      stop();
      return;
    }
    timer = window.setInterval(() => {
      for (let index = 0; index < 6 && autoInput.checked; index += 1) step();
    }, EXPERT_AUTO_INTERVAL_MS);
  });

  reset();
}

function clampPolicyAction(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function main() {
  if (page === 'templates') await mountTemplatesPage();
  if (page === 'components') await mountComponentsPage();
  if (page === 'api') await mountApiPage();
  if (page === 'behavior') await mountBehaviorPage();
  if (page === 'stewarding') await mountStewardingPage();
  if (page === 'expert-environment') await mountExpertEnvironmentPage();
  if (page === 'policy-runner') await mountPolicyRunnerPage();

  window.paddockPreview = Object.fromEntries(controllers);
}

main().catch((error) => {
  console.error('[PaddockJS preview] failed to mount', error);
});
