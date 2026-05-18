const SHOWCASE_CODE_EXAMPLES = {
  'templates.complete-broadcast': {
    summary: 'Example code',
    hint: 'createPaddockSimulator() + mountRaceTelemetryDrawer()',
    code: `import { createPaddockSimulator, mountRaceTelemetryDrawer } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  rules: {
    ruleset: 'custom',
    modules: {
      stalledDnf: { enabled: true },
      tireStrategy: { enabled: true, mandatoryDistinctDryCompounds: 2 },
      penalties: {
        collision: { strictness: 1, consequences: [{ type: 'time', seconds: 5 }] },
        trackLimits: { strictness: 1, warningsBeforePenalty: 3, consequences: [{ type: 'time', seconds: 5 }] },
      },
    },
  },
  ui: {
    penaltyBanners: true,
    timingPenaltyBadges: true,
    raceDataBannerSize: 'auto',
    timingTowerVerticalFit: 'expand-race-view',
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});

mountRaceTelemetryDrawer(root, simulator, {
  raceDataTelemetryDetail: true,
  timingTowerVerticalFit: 'expand-race-view',
});

await simulator.start();`,
  },
  'templates.dashboard': {
    summary: 'Example code',
    hint: 'mountF1Simulator() with preset-first defaults',
    code: `import { mountF1Simulator } from '@inventure71/paddockjs';

const controller = await mountF1Simulator(root, {
  preset: 'dashboard',
  drivers,
  entries,
  ui: {
    raceDataBannerSize: 'custom',
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});`,
  },
  'templates.timing-overlay': {
    summary: 'Example code',
    hint: 'mountF1Simulator() with the overlay preset',
    code: `import { mountF1Simulator } from '@inventure71/paddockjs';

const controller = await mountF1Simulator(root, {
  preset: 'timing-overlay',
  drivers,
  entries,
  theme: {
    accentColor: '#ff2d55',
    timingTowerMaxWidth: '370px',
    raceViewMinHeight: '680px',
  },
  ui: {
    showFps: true,
    raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
  },
});`,
  },
  'templates.banner-option': {
    summary: 'Example code',
    hint: 'mountRaceCanvas() with the project/radio lower-third',
    code: `import { createPaddockSimulator, mountCameraControls, mountRaceCanvas } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    raceDataBannerSize: 'auto',
    raceDataTelemetryDetail: true,
    timingTowerVerticalFit: 'expand-race-view',
    raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
  },
});

mountRaceCanvas(root, simulator, {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'expand-race-view',
});
mountCameraControls(cameraControlsRoot, simulator);

await simulator.start();`,
  },
  'templates.compact-race': {
    summary: 'Example code',
    hint: 'mountF1Simulator() for smaller embeds',
    code: `import { mountF1Simulator } from '@inventure71/paddockjs';

const controller = await mountF1Simulator(root, {
  preset: 'compact-race',
  drivers,
  entries,
  theme: {
    raceViewMinHeight: '520px',
    timingTowerMaxWidth: '320px',
  },
});`,
  },
  'templates.full-dashboard': {
    summary: 'Example code',
    hint: 'mountF1Simulator() with the dense inspector shell',
    code: `import { mountF1Simulator } from '@inventure71/paddockjs';

const controller = await mountF1Simulator(root, {
  preset: 'full-dashboard',
  drivers,
  entries,
  theme: {
    accentColor: '#00ff84',
    timingTowerMaxWidth: '380px',
    raceViewMinHeight: '700px',
  },
});`,
  },
  'templates.drawer': {
    summary: 'Example code',
    hint: 'mountRaceTelemetryDrawer() as a reusable workbench',
    code: `import { createPaddockSimulator, mountRaceTelemetryDrawer } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    raceDataBannerSize: 'auto',
    timingTowerVerticalFit: 'expand-race-view',
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});

mountRaceTelemetryDrawer(root, simulator, {
  timingTowerVerticalFit: 'expand-race-view',
  raceDataTelemetryDetail: true,
});

await simulator.start();`,
  },
  'components.embedded-window': {
    summary: 'Example code',
    hint: 'mountRaceCanvas() as a reusable race window',
    code: `import { createPaddockSimulator, mountCameraControls, mountRaceCanvas } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    penaltyBanners: true,
    timingPenaltyBadges: true,
    raceDataBannerSize: 'auto',
    timingTowerVerticalFit: 'expand-race-view',
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});

mountRaceCanvas(root, simulator, {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'expand-race-view',
});
mountCameraControls(cameraControlsRoot, simulator);

await simulator.start();`,
  },
  'components.race-controls': {
    summary: 'Example code',
    hint: 'mountRaceControls()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountRaceControls(root, simulator);
await simulator.start();`,
  },
  'components.safety-car': {
    summary: 'Example code',
    hint: 'mountSafetyCarControl()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountSafetyCarControl(root, simulator);
await simulator.start();`,
  },
  'components.camera-controls': {
    summary: 'Example code',
    hint: 'mountCameraControls()',
    code: `const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: { cameraControls: false },
});

mountCameraControls(root, simulator);
await simulator.start();`,
  },
  'components.timing-tower': {
    summary: 'Example code',
    hint: 'mountTimingTower()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTimingTower(root, simulator);
await simulator.start();`,
  },
  'components.race-canvas': {
    summary: 'Example code',
    hint: 'mountRaceCanvas() with a canvas-only surface',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountRaceCanvas(root, simulator);
await simulator.start();`,
    note: 'Add includeTimingTower, includeRaceDataPanel, or includeTelemetrySectorBanner when the race window should own those surfaces too.',
  },
  'components.telemetry-core': {
    summary: 'Example code',
    hint: 'mountTelemetryCore()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTelemetryCore(root, simulator);
await simulator.start();`,
  },
  'components.telemetry-sectors': {
    summary: 'Example code',
    hint: 'mountTelemetrySectors()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTelemetrySectors(root, simulator);
await simulator.start();`,
  },
  'components.telemetry-sector-banner': {
    summary: 'Example code',
    hint: 'mountTelemetrySectorBanner()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTelemetrySectorBanner(root, simulator);
await simulator.start();`,
  },
  'components.telemetry-panel': {
    summary: 'Example code',
    hint: 'mountTelemetryPanel()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTelemetryPanel(root, simulator, { includeOverview: true });
await simulator.start();`,
    note: 'Pass { includeOverview: false } when the host wants the telemetry stack without the car/driver overview block.',
  },
  'components.telemetry-lap-times': {
    summary: 'Example code',
    hint: 'mountTelemetryLapTimes()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTelemetryLapTimes(root, simulator);
await simulator.start();`,
  },
  'components.telemetry-sector-times': {
    summary: 'Example code',
    hint: 'mountTelemetrySectorTimes()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountTelemetrySectorTimes(root, simulator);
await simulator.start();`,
  },
  'components.overview': {
    summary: 'Example code',
    hint: 'mountCarDriverOverview()',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountCarDriverOverview(root, simulator);
await simulator.start();`,
  },
  'components.race-data-panel': {
    summary: 'Example code',
    hint: 'mountRaceDataPanel()',
    code: `const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});

mountRaceDataPanel(root, simulator);
await simulator.start();`,
  },
  'components.telemetry-drawer': {
    summary: 'Example code',
    hint: 'mountRaceTelemetryDrawer()',
    code: `const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    raceDataBannerSize: 'auto',
    raceDataTelemetryDetail: true,
    raceDataBanners: { initial: 'radio', enabled: ['project', 'radio'] },
  },
});

mountRaceTelemetryDrawer(root, simulator, {
  drawerInitiallyOpen: true,
  raceDataTelemetryDetail: true,
  timingTowerVerticalFit: 'expand-race-view',
});

await simulator.start();`,
  },
  'api.mount': {
    summary: 'Example code',
    hint: 'createPaddockSimulator() + mountRaceTelemetryDrawer()',
    code: `const controller = createPaddockSimulator({
  drivers,
  entries,
  preset: 'timing-overlay',
  onReady({ snapshot }) {
    console.log('ready', snapshot.raceControl.mode);
  },
  onRaceFinish({ winner, classification }) {
    console.log('finish', winner?.id, classification.length);
  },
});

mountRaceTelemetryDrawer(root, controller, {
  raceDataTelemetryDetail: true,
  timingTowerVerticalFit: 'expand-race-view',
});

await controller.start();`,
  },
  'api.methods': {
    summary: 'Example code',
    hint: 'Imperative controller calls',
    code: `controller.selectDriver('bud-driver');
controller.callSafetyCar();
controller.clearSafetyCar();
controller.toggleSafetyCar();
controller.setRedFlagDeployed(true);
controller.setPitLaneOpen(false);

controller.setPitIntent('bud-driver', 2, 'M');
console.log(controller.getPitIntent('bud-driver'));
console.log(controller.getPitTargetCompound('bud-driver'));

console.log(controller.getSimulationSpeed());
console.log(controller.getSnapshot());

controller.restart({ seed: 9001 });
controller.destroy();`,
  },
  'api.callbacks': {
    summary: 'Example code',
    hint: 'Lifecycle callback shape',
    code: `const controller = await mountF1Simulator(root, {
  drivers,
  entries,
  onLoadingChange({ phase }) {
    hostLog('loading', phase);
  },
  onReady({ snapshot }) {
    hostLog('ready', snapshot.leader?.id);
  },
  onDriverSelect(driver) {
    hostLog('select', driver.id);
  },
  onRaceEvent(event) {
    hostLog('event', event.type);
  },
  onRaceFinish({ winner, classification }) {
    hostLog('finish', winner?.id, classification.length);
  },
  onError(error, context) {
    hostLog('error', context?.phase ?? context?.callback, error.message);
  },
});`,
  },
  'behavior.timing-fit': {
    summary: 'Example code',
    hint: 'Race-window timing fit options',
    code: `const simulator = createPaddockSimulator({ drivers, entries });

mountRaceCanvas(root, simulator, {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'expand-race-view', // or 'scroll'
});

await simulator.start();`,
  },
  'behavior.embedded-camera': {
    summary: 'Example code',
    hint: "ui.cameraControls: 'embedded'",
    code: `const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    cameraControls: 'embedded',
    simulationSpeedControl: true,
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});

mountRaceCanvas(root, simulator, {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'expand-race-view',
});

await simulator.start();`,
  },
  'behavior.sector-banner-canvas': {
    summary: 'Example code',
    hint: 'includeTelemetrySectorBanner inside the race window',
    code: `const simulator = createPaddockSimulator({
  drivers,
  entries,
  ui: {
    raceDataBanners: { initial: 'project', enabled: ['project', 'radio'] },
  },
});

mountRaceCanvas(root, simulator, {
  includeRaceDataPanel: true,
  includeTelemetrySectorBanner: true,
});

await simulator.start();`,
  },
  'behavior.banner-sizing': {
    summary: 'Example code',
    hint: 'Race-data banner sizing contract',
    code: `await mountF1Simulator(root, {
  preset: 'timing-overlay',
  drivers,
  entries,
  ui: {
    raceDataBannerSize: 'auto', // or 'custom'
    raceDataBanners: {
      initial: 'project',
      enabled: ['project', 'radio'],
    },
  },
});`,
  },
  'behavior.theme': {
    summary: 'Example code',
    hint: 'Public theme CSS variables',
    code: `await mountF1Simulator(root, {
  preset: 'timing-overlay',
  drivers,
  entries,
  theme: {
    accentColor: '#ff2d55',
    greenColor: '#14c784',
    yellowColor: '#ffd166',
    timingTowerMaxWidth: '370px',
    raceViewMinHeight: '680px',
  },
});`,
  },
  'behavior.track-profiles': {
    summary: 'Example code',
    hint: 'Procedural track helper and mount option',
    code: `import { createProceduralTrack, mountF1Simulator } from '@inventure71/paddockjs';

const trainingTrack = createProceduralTrack(4101, {
  profile: 'training-short',
});

await mountF1Simulator(root, {
  drivers,
  entries,
  trackSeed: 4101,
  trackGeneration: {
    profile: 'training-short',
  },
});`,
    note: 'The live Policy Runner page uses these same public profile names for its track selector.',
  },
  'behavior.finish': {
    summary: 'Example code',
    hint: 'Finish callback and final classification contract',
    code: `await mountF1Simulator(root, {
  preset: 'compact-race',
  drivers: drivers.slice(0, 2),
  entries: entries.slice(0, 2),
  totalLaps: 1,
  onRaceFinish({ winner, classification }) {
    console.log('winner', winner?.id);
    console.log('classification', classification);
  },
});`,
  },
  'stewarding.rules': {
    summary: 'Example code',
    hint: 'Strictness-based stewarding rules',
    code: `const controller = createPaddockSimulator({
  drivers,
  entries,
  rules: {
    ruleset: 'custom',
    modules: {
      stalledDnf: { enabled: true },
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
  },
});

mountRaceCanvas(root, controller, {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'expand-race-view',
});

await controller.start();`,
  },
  'collision-lab.harness': {
    summary: 'Example code',
    hint: 'Repo-only geometry harness',
    code: `import { detectVehicleCollision } from '../../src/simulation/collisionGeometry.js';
import { createVehicleGeometry } from '../../src/simulation/vehicleGeometry.js';
import { calculateWheelSurfaceState } from '../../src/simulation/wheelSurface.js';

const carGeometry = createVehicleGeometry(carState);
const collision = detectVehicleCollision(carA, carB);
const wheelSurface = calculateWheelSurfaceState(trackLimits, wheelContact);`,
    note: 'Collision Lab is a repo debugging harness. These imports are internal simulator modules, not package exports.',
  },
  'policy-runner.distilled-policy': {
    summary: 'Example code',
    hint: 'Browser-loaded distilled policy',
    code: `import {
  createDistilledPolicyController,
  createPaddockDriverControllerLoop,
} from '@inventure71/paddockjs';

const policy = await loadCheckpointPolicyPayload('/local-checkpoints/latest-distilled-policy.json');
const simulator = createPaddockSimulator({ drivers, entries, physicsMode: 'simulator' });

const loop = createPaddockDriverControllerLoop({
  simulator,
  controlledDrivers: [drivers[0].id],
  controller: createDistilledPolicyController(policy),
});`,
    note: 'The repo preview uses a local helper around the public controller loop to load the browser-side distilled payload.',
  },
  'policy-runner.policy-server': {
    summary: 'Example code',
    hint: 'Browser simulator + external policy server',
    code: `const serverController = createPolicyServerController({
  url: 'http://127.0.0.1:8787',
});

const loop = createPaddockDriverControllerLoop({
  simulator,
  controlledDrivers: [drivers[0].id],
  controller: serverController,
});`,
    note: 'The browser owns the simulator. The server only receives public observations and returns normalized controls.',
  },
  'policy-runner.live-node-view': {
    summary: 'Example code',
    hint: 'Live preview stream',
    code: `const liveController = createLiveNodeViewController({
  url: 'ws://127.0.0.1:8787/preview',
});

const loop = createPaddockDriverControllerLoop({
  simulator,
  controlledDrivers: [drivers[0].id],
  controller: liveController,
});`,
    note: 'In live preview mode the remote source is authoritative for the rendered frames, and the browser follows that stream.',
  },
};

const SHOWCASE_ROUTE_COVERAGE = {
  templates: [
    'dashboard preset',
    'timing-overlay preset',
    'compact-race preset',
    'full-dashboard preset',
    'complete race workbench template',
    'race telemetry drawer template',
    'project/radio lower-third variant',
  ],
  components: [
    'mountRaceControls()',
    'mountSafetyCarControl()',
    'mountCameraControls()',
    'mountTimingTower()',
    'mountRaceCanvas()',
    'mountTelemetryCore()',
    'mountTelemetrySectors()',
    'mountTelemetrySectorBanner()',
    'mountTelemetryPanel()',
    'mountTelemetryLapTimes()',
    'mountTelemetrySectorTimes()',
    'mountCarDriverOverview()',
    'mountRaceDataPanel()',
    'mountRaceTelemetryDrawer()',
  ],
  api: [
    'callback surface',
    'driver selection',
    'restart()',
    'callSafetyCar() / clearSafetyCar() / toggleSafetyCar()',
    'setRedFlagDeployed() / setPitLaneOpen()',
    'setPitIntent() / getPitIntent() / getPitTargetCompound()',
    'servePenalty() / cancelPenalty()',
    'getSimulationSpeed() / getSnapshot() / destroy()',
  ],
  behavior: [
    "timingTowerVerticalFit: 'expand-race-view'",
    "timingTowerVerticalFit: 'scroll'",
    "ui.cameraControls: 'embedded'",
    'includeTelemetrySectorBanner',
    'raceDataBannerSize: auto vs custom',
    'theme CSS variables',
    'procedural track profiles',
    'finish callback and classification',
  ],
  stewarding: [
    'collision penalties',
    'track-limits penalties',
    'tire-requirement penalties',
    'top steward message',
    'timing penalty badges',
    'adjusted classification snapshot',
  ],
  'collision-lab': [
    'body/body contact',
    'wheel/body ignore path',
    'near miss',
    'one wheel on kerb',
    'one wheel on gravel',
    'all wheels outside',
    'diagonal surface transition',
  ],
  'policy-runner': [
    'distilled policy',
    'policy server',
    'live preview stream',
    'track profile selector',
    'step / auto-run / reset loop',
    'policy senses panel',
    'no-collision preview markers',
  ],
};

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent != null) element.textContent = textContent;
  return element;
}

export function hydrateShowcaseCodeExamples(root = document) {
  root.querySelectorAll('[data-code-example]').forEach((slot) => {
    const key = slot.dataset.codeExample;
    const example = SHOWCASE_CODE_EXAMPLES[key];
    if (!example) return;

    const details = createElement('details', 'example-code');
    details.dataset.codeExample = key;
    const summary = createElement('summary', 'example-code__summary');
    const summaryCopy = createElement('span', 'example-code__summary-copy');
    summaryCopy.append(
      createElement('span', 'example-code__label', example.summary ?? 'Example code'),
      createElement('span', 'example-code__hint', example.hint ?? 'Package usage example'),
    );
    const action = createElement('span', 'example-code__action');
    action.append(
      createElement('span', 'example-code__action-show', 'Show code'),
      createElement('span', 'example-code__action-hide', 'Hide code'),
    );
    summary.append(summaryCopy, action);

    const pre = createElement('pre');
    const code = createElement('code');
    code.textContent = example.code;
    pre.append(code);
    details.append(summary, pre);

    if (example.note) {
      details.append(createElement('p', 'example-code__note', example.note));
    }

    slot.replaceChildren(details);
  });
}

export function hydrateShowcaseCoverage(root = document) {
  root.querySelectorAll('[data-showcase-coverage]').forEach((slot) => {
    const key = slot.dataset.showcaseCoverage;
    const items = SHOWCASE_ROUTE_COVERAGE[key];
    if (!items?.length) return;

    const list = createElement('ul', 'coverage-chip-list');
    items.forEach((item) => {
      const entry = createElement('li', 'coverage-chip-list__item', item);
      list.append(entry);
    });
    slot.replaceChildren(list);
  });
}
