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
import './styles.css';

const page = document.body.dataset.page ?? 'home';
const controllers = new Map();
const eventLog = document.querySelector('[data-event-log]');
const snapshotReadout = document.querySelector('[data-preview-snapshot]');
const finishSnapshotReadout = document.querySelector('[data-finish-snapshot]');
const SHOWCASE_TRACK_SEED = 20260430;

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
  return controller;
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

async function mountTemplatesPage() {
  addController('dashboard', await mountF1Simulator(requiredElement('template-dashboard-root'), {
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

  addController('timing-overlay', await mountF1Simulator(requiredElement('template-overlay-root'), {
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

  addController('compact-race', await mountF1Simulator(requiredElement('template-compact-root'), {
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

  addController('full-dashboard', await mountF1Simulator(requiredElement('template-full-dashboard-root'), {
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
  });
  await drawer.start();
  addController('drawer-template', drawer);
}

async function mountComponentsPage() {
  const embedded = createPaddockSimulator({
    ...commonOptions('embedded-window'),
    title: 'Embedded Race Window',
    kicker: 'mountRaceCanvas',
    seed: 6111,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 8,
    theme: {
      timingTowerMaxWidth: '360px',
      raceViewMinHeight: '640px',
    },
    ui: {
      cameraControls: 'embedded',
      showFps: false,
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
  await embedded.start();
  addController('embedded-window', embedded);

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

  const finish = await mountF1Simulator(requiredElement('behavior-finish-root'), {
    ...commonOptions('finish'),
    preset: 'compact-race',
    title: 'Finish Contract',
    kicker: 'totalLaps: 1',
    seed: 9333,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 1,
    theme: {
      accentColor: '#00ff84',
      raceViewMinHeight: '520px',
      timingTowerMaxWidth: '330px',
    },
    ui: {
      raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
    },
  });
  addController('finish-contract', finish);
  renderFinishSnapshot(finish);
  window.setInterval(() => renderFinishSnapshot(finish), 1000);
}

async function main() {
  if (page === 'templates') await mountTemplatesPage();
  if (page === 'components') await mountComponentsPage();
  if (page === 'api') await mountApiPage();
  if (page === 'behavior') await mountBehaviorPage();

  window.paddockPreview = Object.fromEntries(controllers);
}

main().catch((error) => {
  console.error('[PaddockJS preview] failed to mount', error);
});
