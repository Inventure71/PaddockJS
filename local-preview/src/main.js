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
  mountTelemetryPanel,
  mountTelemetrySectorBanner,
  mountTelemetrySectorTimes,
  mountTelemetrySectors,
  mountTimingTower,
} from '@inventure71/paddockjs';
import {
  hydrateShowcaseCodeExamples,
  hydrateShowcaseCoverage,
} from './showcaseCatalog.js';

const page = document.body.dataset.page ?? 'home';
const controllers = new Map();
const eventLog = document.querySelector('[data-event-log]');
const snapshotReadout = document.querySelector('[data-preview-snapshot]');
const finishSnapshotReadout = document.querySelector('[data-finish-snapshot]');
const penaltySnapshotReadout = document.querySelector('[data-penalty-snapshot]');
const SHOWCASE_TRACK_SEED = 20260430;
const LAZY_START_ROOT_MARGIN = '760px 0px';
const COMPLETE_WORKBENCH_TRACK_SEED = readNumericQueryParam('completeTrackSeed') ?? createPreviewTrackSeed();
const CUSTOMIZATION_TEAM_THEMES = {
  budget: { id: 'budget', name: 'Budget GP', color: '#ff2d55', theme: 'budgetTeam' },
  vinyl: { id: 'vinyl', name: 'HoloVinyl Racing', color: '#00c2a8', theme: 'vinylTeam' },
  core: { id: 'core', name: 'Core Works', color: '#38bdf8', theme: 'coreTeam' },
};
const CUSTOMIZATION_DRIVER_IDS = new Set(Object.keys(CUSTOMIZATION_TEAM_THEMES));
const CUSTOMIZATION_ENTRIES = CHAMPIONSHIP_ENTRY_BLUEPRINTS.map((entry) => {
  const team = CUSTOMIZATION_TEAM_THEMES[entry.driverId];
  return team ? { ...entry, team } : entry;
});

window.__paddockCompleteWorkbenchTrackSeed = COMPLETE_WORKBENCH_TRACK_SEED;

const PREVIEW_NAV_ITEMS = [
  { page: 'home', href: '/', label: 'Overview' },
  { page: 'templates', href: '/templates.html', label: 'Templates' },
  { page: 'components', href: '/components.html', label: 'Components' },
  { page: 'customization', href: '/customization.html', label: 'Customization' },
  { page: 'api', href: '/api.html', label: 'API' },
  { page: 'playable', href: '/playable.html', label: 'Playable' },
  { page: 'behavior', href: '/behavior.html', label: 'Behavior' },
  { page: 'rules', href: '/rules.html', label: 'Rules' },
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

function readStringQueryParam(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value == null) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
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

const COMPONENT_PIECE_MOUNTS = [
  { id: 'component-race-controls', mount: mountRaceControls },
  { id: 'component-safety-car', mount: mountSafetyCarControl },
  { id: 'component-camera-controls', mount: mountCameraControls },
  { id: 'component-timing-tower', mount: mountTimingTower },
  { id: 'component-race-canvas', mount: mountRaceCanvas },
  { id: 'component-telemetry-core', mount: mountTelemetryCore },
  { id: 'component-telemetry-sectors', mount: mountTelemetrySectors },
  { id: 'component-telemetry-sector-banner', mount: mountTelemetrySectorBanner },
  { id: 'component-telemetry-panel', mount: mountTelemetryPanel, options: { includeOverview: true } },
  { id: 'component-telemetry-lap-times', mount: mountTelemetryLapTimes },
  { id: 'component-telemetry-sector-times', mount: mountTelemetrySectorTimes },
  { id: 'component-overview', mount: mountCarDriverOverview },
  { id: 'component-race-data', mount: mountRaceDataPanel },
];

function mountComponentPieces(simulator) {
  COMPONENT_PIECE_MOUNTS.forEach(({ id, mount, options }) => {
    mount(requiredElement(id), simulator, options);
  });
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

const PREVIEW_PHYSICS_MODES = ['arcade', 'advanced'];

function explicitPreviewPhysicsMode() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('physicsMode');
  return PREVIEW_PHYSICS_MODES.includes(value) ? value : null;
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
    ...ui,
  };
}

function previewDebug(debug = {}) {
  return {
    physicsModeIndicator: true,
    ...debug,
  };
}

function previewRules(rules = {}) {
  return {
    ...rules,
    modules: {
      ...(rules.modules ?? {}),
      stalledDnf: {
        enabled: true,
        ...(rules.modules?.stalledDnf ?? {}),
      },
    },
  };
}

function commonOptions(label = 'preview') {
  const physicsMode = previewPhysicsMode();
  return {
    drivers: DEMO_PROJECT_DRIVERS,
    entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
    physicsMode,
    rules: previewRules(),
    ui: previewUi(),
    debug: previewDebug(),
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
  return previewRules({
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
  });
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
    standingStart: false,
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

function createCustomizationThemeConfig({
  mode = 'dark',
  packageName = 'trackside',
  controlsCarbon = false,
  timingSelectedTeam = true,
} = {}) {
  return {
    mode,
    use: packageName,
    tokens: {
      raceViewMinHeight: '620px',
      timingTowerMaxWidth: '360px',
    },
    themes: {
      trackside: {
        extends: 'default',
        tokens: {
          primary: { light: '#c90400', dark: '#ff2d55' },
          secondary: { light: '#f3d9dc', dark: '#451520' },
          surfacePanel: { light: '#fff7f7', dark: '#171016' },
          yellowFlag: { dark: '#ffd166' },
          pitLane: '#7c3aed',
        },
      },
      electric: {
        extends: 'default',
        tokens: {
          primary: { light: '#006adc', dark: '#00c2ff' },
          secondary: { light: '#d7ecff', dark: '#0e2a3f' },
          surfacePanel: { light: '#f5fbff', dark: '#071923' },
          info: '#38bdf8',
          drsActive: '#a78bfa',
        },
      },
      mint: {
        extends: 'default',
        tokens: {
          primary: { light: '#087f5b' },
          secondary: { dark: '#12352b' },
          surfacePanel: { light: '#f3fff9', dark: '#0d1d18' },
          success: '#14c784',
          pitLane: '#00c2a8',
        },
      },
      carbon: {
        extends: 'default',
        tokens: {
          primary: '#f1c65b',
          surfacePanel: { light: '#1b1f27', dark: '#050608' },
          surfaceRaised: { light: '#252b35', dark: '#111318' },
          text: '#ffffff',
          border: 'rgba(241, 198, 91, 0.38)',
        },
        components: {
          button: { background: 'primary', text: 'primaryText', border: 'primary' },
          raceControls: { background: 'surfacePanel', text: 'text', border: 'border', accent: 'primary' },
          cameraControls: { background: 'surfacePanel', text: 'text', border: 'border', accent: 'primary' },
        },
      },
      budgetTeam: {
        extends: 'default',
        tokens: {
          primary: { dark: '#ff2d55' },
          secondary: '#451520',
          surfacePanel: { dark: '#1f0f16' },
        },
      },
      vinylTeam: {
        extends: 'default',
        tokens: {
          primary: { light: '#008f7c', dark: '#00c2a8' },
          secondary: '#0d3b35',
          surfacePanel: { dark: '#0a1f1c' },
        },
      },
      coreTeam: {
        extends: 'default',
        tokens: {
          primary: { light: '#0b79b7', dark: '#38bdf8' },
          secondary: '#0d2b3f',
          surfacePanel: { dark: '#091824' },
        },
      },
    },
    componentThemes: {
      selectedDriverPanel: 'selectedTeam',
      timingTower: timingSelectedTeam ? 'selectedTeam' : 'active',
      ...(controlsCarbon ? {
        raceControls: 'carbon',
        cameraControls: 'carbon',
      } : {}),
    },
    teamThemes: {
      budget: 'budgetTeam',
      vinyl: 'vinylTeam',
      core: 'coreTeam',
    },
  };
}

function stringifyCustomizationTheme(theme) {
  return `theme: ${JSON.stringify(theme, null, 2)}`;
}

function resolveCustomizationHostThemeMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
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
  const startCompletePreview = startPreviewControllerWhenNear(completeRoot, 'complete-broadcast', async () => {
    await complete.start();
    return complete;
  });
  startCompletePreview().catch((error) => appendEvent('complete-broadcast:error', error.message));

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

  mountComponentPieces(pieces);

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

async function mountCustomizationPage() {
  const state = {
    mode: 'dark',
    packageName: 'trackside',
    driverId: 'budget',
    controlsCarbon: false,
    timingSelectedTeam: true,
  };
  const snippet = document.querySelector('[data-customization-snippet]');
  const copyButton = document.querySelector('[data-customization-copy]');
  const modeControls = document.querySelector('[data-customization-mode]');
  const packageControls = document.querySelector('[data-customization-package]');
  const driverControls = document.querySelector('[data-customization-driver]');
  const controlsOverride = document.querySelector('[data-component-override="controls"]');
  const timingOverride = document.querySelector('[data-component-override="timing"]');
  const colorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: light)');

  const simulator = createPaddockSimulator({
    ...commonOptions('customization'),
    title: 'Theme Workbench',
    kicker: 'public theme object',
    seed: 5271,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    entries: CUSTOMIZATION_ENTRIES,
    theme: createCustomizationThemeConfig(state),
    ui: previewUi({
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });

  mountRaceCanvas(requiredElement('customization-race-root'), simulator, {
    includeTimingTower: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  mountCarDriverOverview(requiredElement('customization-overview'), simulator);
  mountRaceDataPanel(requiredElement('customization-race-data'), simulator);
  mountRaceControls(requiredElement('customization-component-race-controls'), simulator);
  mountCameraControls(requiredElement('customization-component-camera-controls'), simulator);
  mountTimingTower(requiredElement('customization-component-timing-tower'), simulator);
  mountTelemetryCore(requiredElement('customization-component-telemetry-core'), simulator);

  function applyCustomizationHostTheme() {
    const activeMode = resolveCustomizationHostThemeMode(state.mode);
    document.documentElement.dataset.previewThemeMode = activeMode;
    document.body.dataset.previewThemeMode = activeMode;
    document.body.dataset.previewThemeSelection = state.mode;
  }

  function renderCustomizationControls() {
    applyCustomizationHostTheme();
    modeControls?.querySelectorAll('[data-theme-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.themeMode === state.mode ? 'true' : 'false');
    });
    packageControls?.querySelectorAll('[data-theme-package]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.themePackage === state.packageName ? 'true' : 'false');
    });
    driverControls?.querySelectorAll('[data-driver-id]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.driverId === state.driverId ? 'true' : 'false');
    });
    if (controlsOverride) controlsOverride.checked = state.controlsCarbon;
    if (timingOverride) timingOverride.checked = state.timingSelectedTeam;
    if (snippet) snippet.textContent = stringifyCustomizationTheme(createCustomizationThemeConfig(state));
  }

  function applyRuntimeTheme() {
    simulator.setTheme(createCustomizationThemeConfig(state));
    simulator.selectDriver(state.driverId);
    renderCustomizationControls();
  }

  modeControls?.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-theme-mode]')
      : null;
    if (!button?.dataset.themeMode) return;
    state.mode = button.dataset.themeMode;
    applyRuntimeTheme();
  });

  packageControls?.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-theme-package]')
      : null;
    if (!button?.dataset.themePackage) return;
    state.packageName = button.dataset.themePackage;
    applyRuntimeTheme();
  });

  driverControls?.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-driver-id]')
      : null;
    if (!button?.dataset.driverId || !CUSTOMIZATION_DRIVER_IDS.has(button.dataset.driverId)) return;
    state.driverId = button.dataset.driverId;
    simulator.selectDriver(state.driverId);
    renderCustomizationControls();
  });

  controlsOverride?.addEventListener('change', () => {
    state.controlsCarbon = Boolean(controlsOverride.checked);
    applyRuntimeTheme();
  });

  timingOverride?.addEventListener('change', () => {
    state.timingSelectedTeam = Boolean(timingOverride.checked);
    applyRuntimeTheme();
  });

  colorSchemeQuery?.addEventListener?.('change', () => {
    if (state.mode === 'system') applyRuntimeTheme();
    else applyCustomizationHostTheme();
  });

  copyButton?.addEventListener('click', async () => {
    const text = snippet?.textContent ?? '';
    if (!text) return;
    await navigator.clipboard?.writeText?.(text).catch(() => {});
    copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      copyButton.textContent = 'Copy config';
    }, 1400);
  });

  await simulator.start();
  addController('customization', simulator);
  simulator.selectDriver(state.driverId);
  renderCustomizationControls();
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

  const embeddedCamera = createPaddockSimulator({
    ...commonOptions('embedded-camera'),
    seed: 9233,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 6,
    theme: { raceViewMinHeight: '620px', timingTowerMaxWidth: '340px' },
    ui: previewUi({
      cameraControls: 'embedded',
      simulationSpeedControl: true,
      raceDataBannerSize: 'auto',
      timingTowerVerticalFit: 'expand-race-view',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceCanvas(requiredElement('behavior-embedded-camera-root'), embeddedCamera, {
    includeTimingTower: true,
    includeRaceDataPanel: true,
    timingTowerVerticalFit: 'expand-race-view',
  });
  await embeddedCamera.start();
  addController('embedded-camera', embeddedCamera);

  const sectorBanner = createPaddockSimulator({
    ...commonOptions('sector-banner-canvas'),
    seed: 9244,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 6,
    theme: { raceViewMinHeight: '620px', timingTowerMaxWidth: '340px' },
    ui: previewUi({
      raceDataBannerSize: 'auto',
      raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
    }),
  });
  mountRaceCanvas(requiredElement('behavior-sector-banner-root'), sectorBanner, {
    includeRaceDataPanel: true,
    includeTelemetrySectorBanner: true,
  });
  await sectorBanner.start();
  addController('sector-banner-canvas', sectorBanner);

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
    rules: previewRules({
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
    }),
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

async function main() {
  mountSharedPreviewHeader();
  synchronizePreviewPhysicsLinks();
  hydrateShowcaseCoverage();
  hydrateShowcaseCodeExamples();
  if (page === 'templates') await mountTemplatesPage();
  if (page === 'components') await mountComponentsPage();
  if (page === 'customization') await mountCustomizationPage();
  if (page === 'api') await mountApiPage();
  if (page === 'playable') {
    const { mountPlayablePage } = await import('./playablePage.js');
    await mountPlayablePage({ requiredElement, commonOptions, previewPhysicsMode, previewUi, raceStrategyRules, addController, trackSeed: COMPLETE_WORKBENCH_TRACK_SEED });
  }
  if (page === 'behavior') await mountBehaviorPage();
  if (page === 'stewarding') await mountStewardingPage();
  if (page === 'collision-lab') {
    const { mountCollisionLabPage } = await import('./collisionLab.js');
    mountCollisionLabPage();
  }
  if (page === 'policy-runner') {
    const { mountPolicyRunnerPage } = await import('./policyRunner/page.js');
    await mountPolicyRunnerPage({ requiredElement, readStringQueryParam, commonOptions, previewUi,
      previewRules, previewPhysicsMode, explicitPreviewPhysicsMode, appendEvent, addController, trackSeed: SHOWCASE_TRACK_SEED });
  }

  window.paddockPreview = Object.fromEntries(controllers);
}

main().catch((error) => {
  console.error('[PaddockJS preview] failed to mount', error);
});
