# PaddockJS

PaddockJS is an installable F1-style simulator component for browser host websites. It owns the simulator source, bundled simulator assets, CSS, demo data, and public mount API.

## Install

From npm:

```bash
npm install @inventure71/paddockjs
```

## Documentation

Start with [docs/index.md](docs/index.md) for the full package map: what to install, which API to use, what data to pass, how rules modules work, how the browser and headless runtimes differ, and which verification commands prove a change. If you are integrating the package into a host site, read [System Specs](docs/system_specs.md), [Data Contract](docs/data_contract.md), and [Rules](docs/rules.md) first. If you already trained a driver model and want to run it in PaddockJS, use the [Custom Model Controller Guide](docs/custom_model_controller.md).

## Package Workflow

The repo includes the full package-release boundary:

- a tracked showcase host in `local-preview/`
- public TypeScript declarations in `src/index.d.ts`
- GitHub Actions CI in `.github/workflows/ci.yml`
- Changesets release automation in `.github/workflows/release.yml`
- npm trusted publishing support through GitHub Actions OIDC

Useful commands:

```bash
npm run check
npm run check:release
npm run consumer:smoke
npm run browser:smoke
npm run showcase:dev
npm run showcase:build
npm run changeset
```

`npm run check` is the normal local gate: fast runtime tests, public declarations, dry package contents, packed-package consumption in a fresh Vite app, the showcase build, and a quick Chromium smoke against the showcase. `npm run check:release` runs the same package gates plus slow characterization tests and the full browser smoke matrix.

Local development and showcase builds require Node `20.19.0` or newer. CI currently runs the package check on Node 22 and releases on Node 24.

## 3.0 Release Highlights

The `3.0.0` release line adds semantic theme customization with complete resolved light/dark themes, reusable derivative theme packages, component/team theme selectors, cached opposite-mode color generation, and validated color tokens. Indexed track queries are now canonical/internal, so hosts should remove any `trackQueryIndex` option usage. The local preview adds first-class Customization and playable keyboard routes, including theme package switching, selected-team theming, component overrides, pit request/commit/clear, and target-compound controls. The public camera contract includes the opt-in `driver` camera, and full public car snapshots document `car.trackState` as the stable car-center track classification shape.

The release also hardens public URL handling for options such as `backLinkHref`, keeps package readouts safe for partial startup or external-renderer snapshots, preserves scheduler cancellation behavior in `createPaddockDriverControllerLoop()`, and keeps the release workflow centered on `npm run check` plus the final `npm run check:release` gate.

The package still does not ship trained model weights, model storage, a Python Gymnasium/PettingZoo package, static obstacles, weather, reliability failures, fuel-load effects, or debug mutation APIs. Those remain host-owned or future scope.

## Expert Environment API

Headless training code imports the environment subpath:

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';
```

The package root remains the browser component API. The environment subpath is intentionally browser-free and does not import DOM, PixiJS, or package CSS.
PaddockJS is a bring-your-own-model environment. It does not choose an ML framework, store model weights, or ship a trained driver. The shared `createPaddockDriverControllerLoop()` helper lets a user-owned controller run against either browser expert mode or `createPaddockEnvironment()` with the same batched `decideBatch(context)` call shape.

Browser and headless environments default to `physicsMode: 'arcade'` for existing hosts. Opt into the stricter vehicle model with `physicsMode: 'advanced'` when you want 2D velocity/yaw dynamics, traction limits, steering scrub, derived slip telemetry, reduced off-road grip, and advanced-mode AI tuning:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  frameSkip: 2,
  physicsMode: 'advanced',
});

let result = env.reset();
result = env.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});
```

Action steering is an absolute normalized steering target: `-1` points the wheel to maximum left, `0` points it to center, `1` points it to maximum right, and intermediate values target the same percentage of the maximum angle. Physics still rate-limits how quickly the steering wheel reaches that target.

The environment can run with no reward, as above, or with a host-supplied `reward(context)` callback. Reward formulas stay user-owned; PaddockJS only supplies the neutral facts:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  reward({ metrics, episode }) {
    if (metrics.destroyed) return -200;
    if (metrics.offTrack) return -12;
    if (episode.terminated) return 0;
    return metrics.legalProgressDeltaMeters;
  },
});
```

Reward callback results are converted to numbers per controlled driver. Missing, `NaN`, or infinite callback results become a neutral `0` so one bad callback value cannot poison a training batch.

The repository also includes dependency-free examples that use the same environment contract:

```bash
node examples/train-basic-policy.mjs --generations=4 --candidates=5 --episodes=1 --steps=240
```

The starter script imports the public `@inventure71/paddockjs/environment` subpath and uses self-contained example data from `examples/trainingData.mjs`, so it does not depend on private package source modules for demo drivers. `createProgressReward()` remains available as example/demo reward code only; it is not the official reward and not part of the environment objective.

Each default ray reports track-transition distance and car distance. A track hit uses `kind: 'exit'` when the ray leaves the road and `kind: 'entry'` when an off-track ray points back to the road. Richer sensor layouts are opt-in: rays can use per-ray lengths, predefined layouts such as `driver-front-heavy`, channels for `roadEdge`, `kerb`, `illegalSurface`, and `car`, and `precision: 'driver' | 'debug'`. Driver precision is the default model-facing contract; debug precision is only for clearly labeled diagnostics. Surface channels are computed only when requested. Barrier walls are rendered and enforced as hard destruction boundaries in both physics modes, but they are not model-facing ray targets. `observation.object.self.onTrack` follows the simulator's wheel-level legality rules, so track, kerb, and legal pit-lane/box surfaces are on-track for reward and observation purposes. `pitIntent: 0` is always accepted as the no-op clear value, including environments where pit stops are disabled.

For realistic local-perception policies, use `physicsMode: 'advanced'` with `observation.profile: 'physical-driver'`. It exposes yaw rate, local boundary distances, contact-patch surface readings, richer opponent radar, and surface-aware ray fields in the versioned vector schema. The profile defaults track lookahead to `[]` so the policy does not receive privileged future curvature unless the host explicitly opts back in.

External training code can inspect the environment contract without guessing field ranges:

```js
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
```

Controller modules own model loading, inference, memory, rewards, and logs. PaddockJS supplies cached specs, stable controlled-driver ordering, compact observations, action validation, and repeated stepping through normal physics controls:

```js
import { createPaddockDriverControllerLoop } from '@inventure71/paddockjs';

const controller = {
  async decideBatch(ctx) {
    return Object.fromEntries(ctx.orderedObservations.map(({ driverId, vector }) => [
      driverId,
      userModelAction(vector),
    ]));
  },
};

const loop = createPaddockDriverControllerLoop({
  runtime: env,
  controller,
  actionRepeat: 4,
});
await loop.reset();
await loop.step();
```

`loop.start()` may begin from a fresh runtime and will lazily reset before the first scheduled step. In `onStep(ctx)`, `ctx.actions` is the current applied action map and `ctx.previousActions` is the action map applied on the prior physics step. Scheduled playback stops on controller/runtime errors and exposes the value through `loop.stats.lastError`.

The environment also exposes reset-only scenario placement, neutral rollout recording, deterministic evaluation metrics, and a JSON-serializable worker protocol for external bridges:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  scenario: {
    preset: 'off-track-recovery',
    placements: {
      budget: { distanceMeters: 420, offsetMeters: 16, speedKph: 65 },
    },
  },
});
```

Scenario placement is an environment reset feature, not a policy assist. During `step(actions)`, controlled cars still move only through normalized steering, throttle, brake, and pit intent. `steering`, `throttle`, and `brake` are required for each controlled-driver action; missing or non-finite values fail validation instead of becoming silent zero controls.

For same-environment batched learning, controlled cars can use compact vector observations and reset independently at episode boundaries:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: agentIds,
  physicsMode: 'advanced',
  participantInteractions: { defaultProfile: 'batch-training' },
  observation: {
    profile: 'physical-driver',
    output: 'vector',
    includeSchema: false,
    vectorType: 'float32',
  },
  result: {
    stateOutput: 'none',
    resetDriversObservationScope: 'reset',
  },
});

const schema = env.getObservationSpec();
let result = env.reset();
result = env.step(actionsByDriver);

env.resetDrivers({
  [agentIds[0]]: { distanceMeters: 1200, offsetMeters: 3, speedKph: 80 },
}, {
  stateOutput: 'none',
  observationScope: 'reset',
});
```

`batch-training` cars remain real rendered cars in `snapshot.cars`, but they are non-colliding, sensor-hidden, pit-non-blocking, and excluded from race order by default. Step results include `info.drivers[driverId]` episode state and neutral `metrics[driverId]` facts for external logging or user-defined rewards. `stateOutput: 'none'` suppresses repeated `state.snapshot` payloads for high-throughput loops; use `minimal` when the loop still needs the observation snapshot, or omit the option for the full backward-compatible public snapshot. Deterministic evaluation helpers can accept compact no-state base options and internally request the minimal snapshot needed for evaluation metrics. Reset placements are classified against the same runoff/barrier rules before observations are returned: recovery starts stay physical, while cars placed inside terminal barrier space return destroyed metrics and stable miss-valued rays instead of running far-out ray geometry.

On the package's local 20-car simulator benchmark with front-heavy physical-driver rays, compact vector/no-state output measured around `3.3ms` per environment action, with a no-ray baseline around `1.5ms`. Those numbers are hardware dependent, but they show the intended usage: keep schema/spec lookup separate, request compact vectors in training loops, and reserve full snapshots for debugging or visualization.

For multi-car training and visual comparison, PaddockJS separates real participants from replay overlays:

- `participantInteractions` changes how physics-driven cars interact with collisions, sensors, pit occupancy, and race order. Those cars remain in `snapshot.cars` and still move through steering, throttle, brake, pit intent, tire state, timing, and rules.
- `replayGhosts` are trajectory-driven overlays for reference laps, debugging, or comparison. They appear in `snapshot.replayGhosts`, never in `snapshot.cars`, and do not collide, rank, pit, or trigger penalties. They are sensor-hidden by default and only appear in rays or nearby observations when their own sensor flags opt in.
- In the browser view, non-colliding participants remain solid clickable cars but get a blue no-collision outline marker. Replay ghosts remain translucent overlays.

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['model-a', 'model-b'],
  participantInteractions: {
    drivers: {
      'model-a': { profile: 'isolated-training' },
      'model-b': { profile: 'isolated-training' },
    },
  },
});
```

`isolated-training` is the no-collision profile for real cars that should still remain in race order. `batch-training` is the preferred no-collision profile for same-environment learner batches because it is also excluded from race order. Both profiles hide the car from other cars' ray sensors and `nearbyCars` observations by default; use `phantom-race` or explicit `detectableByRays` / `detectableAsNearby` overrides only when sensor visibility is intentional.

Browser expert mode is opt-in through the normal mount API. When enabled, the visual simulator advances only when host code calls `simulator.expert.step(actions)`. Expert mode is a mount-time boundary; changing `expert` through `restart(nextOptions)` is rejected so ticker ownership cannot silently change under a mounted simulator.
Browser expert mode uses the same episode lifecycle as the headless environment. The default episode horizon is a high safety cap (`1_000_000` expert steps, roughly 4.6 hours at 60Hz with `frameSkip: 1`) so normal user-facing sessions should end by race finish, not by the safety cap. Training and evaluation loops should set a smaller explicit `expert.episode.maxSteps` or `episode.maxSteps` when they need bounded rollouts; `episode.endOnRaceFinish` keeps normal race completion as the terminal condition.
Set `expert.visualizeSensors` to draw expert sensor rays inside the actual race canvas for visual debugging:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
    frameSkip: 4,
    visualizeSensors: {
      rays: true,
    },
  },
});
```

The overlay renders ray values from the same active observation returned by `simulator.expert.step(actions)`; it does not recompute a separate sensor model for the browser layer. Each detected ray channel is shown as its own colored marker, so road-edge, kerb, illegal surface, and car hits can be inspected independently. This applies to every model-facing sense: Policy Runner and expert visualizations must show what the policy receives, while extra high-precision diagnostics must be labeled separately.

When multiple drivers are controlled, sensor visualization renders the selected controlled driver by default so batch-training previews do not draw every agent's rays every frame. Use `visualizeSensors: { rays: true, drivers: 'all' }` only when you intentionally want the heavier all-controlled-car overlay.

## API

The root package exports the browser mounts, composable helper mounts, data/rating helpers, bundled asset and preset constants, procedural-track helper, simulator unit converters, and `createPaddockDriverControllerLoop`. The browser-free training runtime lives under `@inventure71/paddockjs/environment`; see [docs/system_specs.md](docs/system_specs.md) for the full export catalog.

All-in-one mount:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';

const simulator = await mountF1Simulator(document.getElementById('sim-root'), {
  preset: 'timing-overlay',
  drivers: [
    {
      id: 'budget',
      name: 'Budget Buddy',
      color: '#ff2d55',
      link: '/project_details/project-budget-buddy.html',
      raceData: ['AI finance coach', 'Python + LLM', 'Budget guardrails'],
    },
  ],
  entries: [
    {
      driverId: 'budget',
      driverNumber: 71,
      timingName: 'Budget',
      driver: { pace: 52, racecraft: 74, aggression: 38, riskTolerance: 47, patience: 81, consistency: 86 },
      vehicle: { id: 'budget-bb01', name: 'BB-01 Ledger', power: 48, braking: 72, aero: 55, dragEfficiency: 66, mechanicalGrip: 63, weightControl: 58, tireCare: 82 },
    },
  ],
  initialCameraMode: 'show-all',
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
  },
  onDriverOpen(driver) {
    window.location.href = driver.link;
  },
});
```

Composable mount:

```js
import { createPaddockSimulator } from '@inventure71/paddockjs';

const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen(driver) {
    window.location.href = driver.link;
  },
});

simulator.mountRaceControls(document.getElementById('sim-controls'));
simulator.mountCameraControls(document.getElementById('sim-camera-controls'));
simulator.mountSafetyCarControl(document.getElementById('sim-safety-car'));
simulator.mountTimingTower(document.getElementById('sim-timing'));
simulator.mountRaceCanvas(document.getElementById('sim-race'), {
  includeRaceDataPanel: true,
});
simulator.mountTelemetryCore(document.getElementById('sim-telemetry-core'));
simulator.mountTelemetrySectors(document.getElementById('sim-telemetry-sectors'));
simulator.mountTelemetrySectorBanner(document.getElementById('sim-telemetry-sector-banner'));
simulator.mountTelemetryLapTimes(document.getElementById('sim-telemetry-laps'));
simulator.mountTelemetrySectorTimes(document.getElementById('sim-telemetry-sector-times'));
simulator.mountCarDriverOverview(document.getElementById('sim-overview'));

await simulator.start();
```

The race canvas can also own the timing tower when a host wants a single reusable race-window component:

```js
simulator.mountRaceCanvas(document.getElementById('sim-race'), {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'scroll',
});
```

For a packaged race-window template with a right-side telemetry drawer:

```js
simulator.mountRaceTelemetryDrawer(document.getElementById('sim-race-workbench'), {
  timingTowerVerticalFit: 'expand-race-view',
  raceDataTelemetryDetail: true,
});
```

When a composable host intends to use pit APIs or automatic pit behavior, include the pit rules in the simulator options before mounting components:

```js
const simulator = createPaddockSimulator({
  drivers,
  entries,
  rules: {
    ruleset: 'custom',
    modules: {
      pitStops: { enabled: true },
      stalledDnf: { enabled: true },
      tireStrategy: { enabled: true, mandatoryDistinctDryCompounds: 2 },
    },
  },
});
```

`drivers` is the host-owned project/pilot list. `entries` is the optional driver/car/team pairing sheet. The car/driver overview uses the existing driver and vehicle rating components from each entry. Driver and vehicle entries can also include `customFields` as extra label/value metadata. Entries can include `team: { id, name, color, icon, theme, pitCrew }`; the timing tower uses the team icon, defaults team color to the car color when omitted, and can map `team.theme` into the semantic theme system. `team.pitCrew` accepts `speed`, `consistency`, and `reliability` values from `0` to `1` for optional pit-service variability. Assets, including the default car image and generic driver helmet, are bundled by default, so the host website does not need to provide simulator images or textures.

The returned object supports:

- `destroy()`
- `restart(nextOptions)` for non-asset, non-expert race/data/seed changes
- `selectDriver(driverId)`
- `setSafetyCarDeployed(deployed)`
- `setRedFlagDeployed(deployed)`
- `setPitLaneOpen(open)`
- `callSafetyCar()`
- `clearSafetyCar()`
- `toggleSafetyCar()`
- `setPitIntent(driverId, intent, targetCompound?)`
- `getPitIntent(driverId)`
- `getPitTargetCompound(driverId)`
- `getSimulationSpeed()`
- `setTimingGapMode(mode)`
- `getTimingGapMode()`
- `toggleTimingGapMode()`
- `servePenalty(penaltyId)`
- `cancelPenalty(penaltyId)`
- `getSnapshot()`
- `expert` when explicitly enabled, otherwise `null`

Timing gap mode is controller-owned, not tied to whether the manual tower toggle is visible. `setTimingGapMode('interval')` makes timing rows show interval to the car ahead, `setTimingGapMode('leader')` makes them show gap to P1, and `toggleTimingGapMode()` switches between those two values. These methods can be called after mounting or while the race is running; mounted timing towers update immediately and keep the same selected driver/order state.

Useful UI options:

```js
preset: 'timing-overlay',
theme: {
  mode: 'system',
  use: 'trackside',
  tokens: {
    primary: { light: '#008c55', dark: '#00ff84' },
    pitLane: '#7c3aed',
  },
  themes: {
    trackside: {
      extends: 'default',
      tokens: { yellowFlag: { dark: '#ffcc00' } },
      components: {
        button: { background: 'pitLane', text: 'primaryText', border: 'primary' },
      },
    },
  },
  componentThemes: {
    'race-controls': 'trackside',
  },
  timingTowerMaxWidth: '360px',
  raceViewMinHeight: '720px',
},
ui: {
  layoutPreset: 'left-tower-overlay',
  cameraControls: 'external',
  showFps: false,
  telemetryIncludesOverview: false,
  telemetryModules: ['core', 'sectors', 'lapTimes', 'sectorTimes'],
  raceDataBanners: {
    initial: 'project',
    enabled: ['project', 'radio'],
  },
  raceDataBannerSize: 'auto',
  raceDataTelemetryDetail: true,
  timingTowerVerticalFit: 'expand-race-view',
  timingGapMode: 'interval',
  timingGapModeToggle: true,
},
debug: {
  physicsModeIndicator: false,
}
```

`preset` is resolved before explicit host options. Available presets are `dashboard`, `timing-overlay`, `compact-race`, and `full-dashboard`; hosts can start from a preset and override any `ui`, `debug`, or `theme` field. `debug.physicsModeIndicator: true` renders a small top-left race-canvas square: blue for arcade physics and red for advanced physics. It defaults to `false` for package consumers and is intended only for debug/development use. `theme` resolves semantic package tokens into complete light/dark themes, can define reusable named theme packages with `extends`, and can assign a named theme to component scopes such as `race-controls` through `componentThemes`. Component theme keys accept package `data-paddock-component` names and camelCase aliases such as `raceControls` or `timingTower`; `selectedDriverPanel` targets both selected-driver package surfaces. Selected-driver surfaces such as the car/driver overview and race-data panel use the selected team's theme by default when one is available. Unknown theme tokens or component slots are ignored, one-sided light/dark token overrides generate and cache the opposite mode, and theme plus driver/team colors are validated before they are written to CSS variables. Legacy aliases such as `accentColor`, `greenColor`, and `yellowColor` still map to the semantic token system for migration.

### Layout Support Contract

PaddockJS supports the all-in-one shell and host mount roots in containers at least `320px` wide. Hosts should size the outer mount root with normal responsive CSS, for example `width: 100%; min-width: 0;`, and avoid adding host rules that target package internals such as `.sim-grid`, `.sim-timing`, or `.race-data-panel`. The host owns page placement; PaddockJS owns the shell, timing-board width, camera safe area, lower-thirds, drawer behavior, focus styles, and touch target sizing. Package-owned subcomponents can have smaller internal widths when their own layout is designed for it; for example, the broadcast timing tower remains valid at its package-owned narrow width. Responsive narrow template variants are enabled by default and can be disabled with `ui.responsiveNarrowLayout: false` or the matching composable mount option when a host intentionally wants the older stacked timing/drawer behavior.

The package uses container-width density tiers:

- `320px` to `519px`: mobile density. Controls wrap, embedded timing towers stop reserving a side gutter and use the package timing reveal, telemetry drawers reveal over the race view, and lower-thirds compress inside the race view. The lower-third may cover empty timing-tower chrome, but if it would cover any timing entries the race view adds package-owned banner clearance to its minimum height. If the entries remain clear, no extra banner height is reserved.
- `520px` to `759px`: narrow tablet density. Race surfaces keep readable controls while standalone telemetry and overview modules collapse to single-column layouts.
- `760px` to `1119px`: tablet density. Side-by-side host sections may still give an individual component a narrow container, so package components use their own container width rather than viewport width.
- `1120px` and wider: desktop density. The broadcast timing tower can sit in the left race gutter at its package-owned width, and telemetry/drawer layouts use wider horizontal space.

If the shell/mount root receives less than `320px` inline size, or an individual package component is constrained below its component-specific minimum, PaddockJS marks it with `data-paddock-size-unsupported="true"` and shows an accessible `Unsupported size` placeholder. That is intentional: below the support envelope, the package prefers a clear placeholder over clipped controls, horizontal scrolling, or overlapping race UI. The placeholder is package-owned and uses `role="status"` with polite live-region behavior.

Package controls, timing rows, drawer toggles, lower-third actions, and close buttons maintain practical `44px` touch targets. Touch driving controls are not part of the package; the playable preview remains keyboard/expert-action driven and does not add a virtual joystick.

If `trackSeed` is omitted, each mounted browser simulator creates a fresh procedural circuit. Passing `trackSeed` makes the track deterministic so multiple embeds can share the same generated circuit; repeated procedural seeds are cached within the page runtime as immutable track definitions. Treat values returned by `createProceduralTrack()` as read-only and pass custom mutable copies when experimenting with track-definition edits. `restart({ trackSeed })` rebuilds the race on the deterministic circuit for the new seed. Asset URL changes are not restartable; destroy and mount a new simulator when changing assets.

Warmup is enabled by default across browser, headless environment, and direct simulation creation. The runtime warms a disposable instance during loading and caches by configuration fingerprint, so identical resets/restarts skip repeated warmup while seed/config changes warm again automatically. Override with `warmup: { enabled, policy: 'config-change' | 'always' | 'never', steps }` or `warmup: false`.

Generated circuits are built from seeded connected region boundaries that are smoothed and warped into a validated centerline, so tracks can include concave infield/outfield sections and chicane-like bends instead of simple oval-like fallback shapes. Hosts can pass `trackGeneration` alongside `trackSeed` to choose a profile and override semantic generation controls:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  trackSeed: 4101,
  trackGeneration: {
    profile: 'training-short',
    length: { minMeters: 900, maxMeters: 1800 },
    startStraight: { gridMeters: 0 },
    pitLane: { enabled: false },
  },
  rules: {
    modules: {
      pitStops: { enabled: false },
    },
  },
});

simulator.restart({
  trackSeed: 5051,
  trackGeneration: { profile: 'race' },
});
```

Advanced callers can import `createProceduralTrack(seed, options)` when they need the generated track definition directly instead of mounting a simulator:

```js
import { createProceduralTrack } from '@inventure71/paddockjs';

const trainingTrack = createProceduralTrack(4101, {
  profile: 'training-short',
  length: { minMeters: 900, maxMeters: 1800 },
  startStraight: { gridMeters: 0, exitMeters: 80, blendMeters: 80 },
  pitLane: { enabled: false },
  shape: { scale: 0.2, cornerDensity: 1.3, variation: 0.22 },
  validation: { minClearanceMultiplier: 1, maxLocalTurnRadians: 1.85 },
  attempts: { primary: 80, fallback: 200 },
});
```

Profiles are presets, not separate generators. `race` preserves the default full circuit with pit lane; `training-short`, `training-medium`, and `training-technical` generate smaller pitless circuits for training or demos. Resolution is `race` defaults, then the selected profile, then explicit overrides.

Pit-lane geometry depends on the resolved generation options. The `race` profile includes:

- rendered pit lane beside the start/finish straight
- lane-aligned procedural entry and exit roads
- main fast lane sized from the team/box layout
- parallel working lane
- 10 shared team service areas
- 20 unused garage boxes arranged as 10 team pairs

Training profiles disable pit-lane generation by default. If a host explicitly sets `pitLane: { enabled: false }`, pit-related rules should also be disabled or left in a no-op configuration.

Pit-lane asphalt, working-lane service areas, and garage boxes are legal drivable surfaces for sensors, runoff handling, track-limit stewarding, and stalled-DNF timing. In both physics modes, the rendered barrier wall marks the hard outer runoff boundary; cars whose footprint reaches the wall's inner face are marked `destroyed`, stopped, removed from active collision/sensor participation, and treated as DNF entries at the bottom of the timing order. `physicsMode` changes vehicle integration and grip behavior, not barrier consequences. Environment results expose destruction as neutral `metrics[driverId].destroyed` and a per-driver `endReason: 'destroyed'`, so training loops can assign their own negative reward and then call `resetDrivers()` for a new episode. Opt-in stalled off-track DNF uses `endReason: 'stalled-off-track'` without setting `destroyed`. Tire energy degrades down to 1% and affects grip nonlinearly, so badly worn tires are slower and harder to rotate without making the car instantly undrivable.

When `rules.modules.pitStops.enabled` is true, cars automatically form bounded pit trains when lane space is available. They brake to the limiter by the main pit-lane start, drive along the main fast lane, pass through the team queue spot as a rolling gate, roll into the team-colored working-lane service area when it is clear, stop, serve eligible penalties before tire work, show the remaining stationary service time above the car, change to the requested configured tire compound or the default alternate compound, and exit back to the race track.

`tireStrategy` does not enable automatic pit stops. It controls available compounds, pit-stop target compound choices, and tire-requirement stewarding. Use `rules.modules.pitStops.enabled: true` for automatic pit routing and pit APIs, or choose a preset such as `ruleset: 'fia2025'` / `ruleset: 'grandPrix2025'` that enables both pit stops and the two-compound tire strategy by default.

Team-mates share one service area. Every car enters through the queue spot first, but it only stops there when the active service spot is blocked. A second team car waits in the queue spot until the active service spot is physically clear, including the previous car's first movement out of the box, without blocking the main fast lane.

By default, built-in AI cars request an opportunistic `pitIntent: 1` below 50% tire energy and commit `pitIntent: 2` below 30%. Hosts can change those thresholds with `tirePitRequestThresholdPercent` and `tirePitCommitThresholdPercent`. Expert/headless controlled drivers do not receive those automatic tire-threshold calls and must request service with `pitIntent`.

Hosts can override the pit call with `setPitIntent(driverId, 0 | 1 | 2, 'H')` or expert action `{ pitIntent: 2, pitCompound: 'H' }`:

- `0` means no request
- `1` means keep trying until a free pit-entry window is available
- `2` means commit to entering at the next pit-entry window even when pit-lane capacity or gap checks would block an opportunistic stop

Completed stops can be re-armed later by tire condition or by `setPitIntent`, so pit stops are not one-use per race. Optional `pitStops.variability` uses `team.pitCrew` speed, consistency, and reliability to adjust service time and slow-stop chance; `pitStops.variability.perfect: true` forces deterministic default service time for training.

`setPitLaneOpen(false)` keeps new pending pit calls on track until reopened and the canvas shows a small red/green/yellow light near pit entry. `setRedFlagDeployed(true)` freezes race movement, closes the effective pit lane, and emits red-flag race-control state until cleared. The pit speed limiter applies on the straight main pit lane/working lane, not on the entry and exit connector roads, but automatic pit-entry routing still keeps connector speeds bounded so cars can reach the limiter safely.

Race behavior is configurable through `rules`. Flat existing options such as `standingStart: false` remain supported, and advanced behavior is grouped under module config:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  rules: {
    ruleset: 'fia2025',
    modules: {
      pitStops: {
        enabled: true,
        pitLaneSpeedLimitKph: 80,
        maxConcurrentPitLaneCars: 3,
        minimumPitLaneGapMeters: 20,
        tirePitRequestThresholdPercent: 50,
        tirePitCommitThresholdPercent: 30,
        variability: {
          enabled: true,
          perfect: false,
        },
      },
      tireStrategy: {
        enabled: true,
        mandatoryDistinctDryCompounds: 2,
      },
      tireDegradation: {
        enabled: true,
      },
      stalledDnf: {
        enabled: true,
        maxStoppedSeconds: 12,
        speedThresholdKph: 5,
      },
      penalties: {
        trackLimits: { strictness: 0.8 },
        collision: { strictness: 0.5, consequences: [{ type: 'time', seconds: 5 }] },
        tireRequirement: { strictness: 1, consequences: [{ type: 'time', seconds: 10 }] },
        pitLaneSpeeding: { strictness: 1, speedLimitKph: 80 },
      },
    },
  },
  ui: {
    penaltyBanners: true,
    timingPenaltyBadges: true,
  },
});
```

For deterministic single-skill training or visual checkpoint comparison, set `rules.modules.tireDegradation.enabled: false` so tyre energy remains fixed while the car still drives through normal steering, throttle, brake, and surface physics. `rules.modules.stalledDnf` defaults to `enabled: false` so base simulator and training environments keep stuck off-track cars live unless a host opts in. Set `enabled: true` to retire cars that are off legal racing or pit surfaces while below `speedThresholdKph` for `maxStoppedSeconds`.

Supported rulesets are `paddock`, `grandPrix2025`, `fia2025`, and `custom`. Presets only choose defaults; explicit module config wins. Weather, reliability, and fuel-load performance effects are reserved future modules and are not active `3.0.0` behavior. Penalty subsections use `strictness` from `0` to `1` instead of plain booleans. Track limits use the white line as the legal edge and require all four wheel contact patches to be fully outside the same side of the line before recording a violation, so normal kerb riding is not punished. Per-car `surface` is resolved from the worst wheel surface, snapshots include `car.wheels` for per-wheel surface and white-line state, and asymmetric left/right wheel resistance adds a small capped yaw tug toward the slower side when only one side is on a worse surface. Collision stewarding is driven by a body collision hull, not transparent sprite bounds or wheel-only overlap, and contact events include shape ids, contact type, depth, and time of impact. It considers impact severity, closing speed, and whether one car clearly hit another from behind; clear rear contact penalizes only the physically trailing car, including lapped traffic cases, while unclear meaningful contact records shared-fault penalties for both cars. Stalled off-track DNFs emit `car-dnf` with `reason: 'stalled-off-track'`, freeze the car, remove it from active control/collision/sensor/pit participation, and classify it with the existing DNF metadata. Pit-lane speeding is enforced on the main fast lane, working lane, service areas, and garage boxes, but not on pit-entry or pit-exit connector roads. Track-limit warnings are emitted as `track-limits` events, while penalty decisions are exposed through `snapshot.penalties` plus `penalty` events. Penalty consequences support warning, time, drive-through, stop-go, position-drop, grid-drop, and disqualification payloads. Time consequences are additive, drive-through and stop-go penalties are service obligations, and unserved service penalties convert to configured time at final classification.

`initialCameraMode` accepts `'overview'`, `'leader'`, `'selected'`, `'driver'`, `'show-all'`, or `'pit'`; invalid values fall back to `'leader'`. The overview camera frames the active generated track bounds, including package-owned track padding and pit-lane extent, instead of using a fixed world-center zoom. Camera mode changes ease from the current camera target to the next target after the initial frame, so switching between leader, selected, driver, overview, show-all, and pit views does not snap the world view.

The pit camera targets the generated operational pit-lane geometry, including the lane, boxes, service areas, and queue areas, while excluding the longer entry/exit access roads. It zooms out as needed to fit that work area inside the active race-view safe area, and its control is hidden when the active track has no pit lane.

The driver camera follows the selected car from a lower screen anchor and rotates the world so the car's heading points upward. Its control is opt-in through `ui.driverCamera: true`, and setting `initialCameraMode: 'driver'` enables that control automatically.

Zoom buttons and wheel zoom apply to every camera mode. Zoom-out is bounded by the active generated track frame so the camera cannot pull far beyond the circuit. The renderer keeps grass coverage larger than the simulated world, and the transparent canvas host uses the same grass color as a fallback around the framed circuit.

`layoutPreset: 'left-tower-overlay'` creates a left broadcast gutter inside the race view, frames the camera around the remaining race area, and places the timing tower in that gutter without covering camera controls. The project/radio lower-third stays inside the race window and can intentionally render over the timing sidebar instead of shrinking around it.

Composable hosts should pass `{ includeRaceDataPanel: true }` to `mountRaceCanvas()` when they want that lower-third clipped and layered by the race window. `mountRaceDataPanel()` remains available for hosts that intentionally want the banner as a standalone surface.

`raceDataTelemetryDetail: true` makes the project lower-third include a compact S1/S2/S3 sector strip with live sector elapsed time and per-sector progress. That telemetry project lower-third stays visible until dismissed, muted, or replaced, while radio mode keeps its normal schedule. The standalone `mountTelemetrySectorBanner()` surface remains available only when a host explicitly mounts it.

`includeTimingTower: true` embeds the timing tower directly inside the race canvas and reserves camera space from the measured tower gutter when the tower is a side overlay. In narrow hosts, the embedded timing tower becomes a package-owned left reveal panel opened by the race view's Timing control instead of taking permanent height above the track. The control updates `aria-expanded`, the closed tower is inert/hidden to assistive tech, and the renderer/camera keep resizing through the transition without remounting the simulator. This responsive narrow behavior is enabled by default; pass `responsiveNarrowLayout: false` to `mountRaceCanvas()` or set `ui.responsiveNarrowLayout: false` to opt out.

`mountRaceTelemetryDrawer()` is a higher-level template that mounts an external top control row, race canvas, embedded timing tower, lower-third, top steward message, safety-car control, and a telemetry drawer together. Pass `{ raceDataTelemetryDetail: true }` when the drawer lower-third should include compact sector detail. On narrow hosts the responsive template is enabled by default: the telemetry drawer reveals over the race view instead of forcing the race canvas to reserve permanent drawer height, and the race view measures lower-third/timing-entry geometry before adding extra vertical clearance. Pass `{ responsiveNarrowLayout: false }` to opt out.

The drawer top row contains camera controls, a `1x` simulation-speed button that cycles through `2x`, `3x`, `4x`, `5x`, `10x`, and back to `1x`, a `Mute banners` toggle, safety car, and the telemetry toggle so those controls do not cover the race. For other camera-control placements the speed button is hidden by default and can be enabled with `ui.simulationSpeedControl: true`.

`Mute banners` is off by default and temporarily suppresses project/radio lower-thirds while it is pressed; steward penalty banners are separate and remain controlled by `penaltyBanners`. Opening the drawer reduces the race area instead of overlaying it, and closing it removes the drawer from interaction. The drawer uses the same package-owned `telemetry-stack` component as `mountTelemetryPanel()`, so constrained host heights scroll telemetry vertically instead of letting the sidebar escape its frame.

Banner and timing layout options:

- `raceDataBanners.initial` selects the starting banner state: `'project'`, `'radio'`, or `'hidden'`.
- `raceDataBanners.enabled` chooses which banner types may appear.
- `raceDataBannerSize: 'auto'` uses the race space to the right of the timing board when it is wide enough and falls back to the full lower-third overlap when it is not.
- `raceDataBannerSize: 'custom'` preserves the default CSS-variable-driven lower-third size for hosts that want to tune their own banner geometry.
- `timingTowerVerticalFit: 'expand-race-view'` lets the race window grow tall enough for the tower.
- `timingTowerVerticalFit: 'scroll'` keeps the race window height and scrolls the timing list inside the cropped tower.
- `timingGapMode: 'interval'` starts the timing tower in `Int` mode, showing interval to the car ahead. Use `'leader'` to start in `Gap` mode, showing the total gap to P1.
- `timingGapModeToggle: true` shows the compact timing-tower header toggle by default. Set it to `false` when the host should own mode changes through `setTimingGapMode()`, `getTimingGapMode()`, or `toggleTimingGapMode()`.

The same timing fit values can be passed to `mountRaceCanvas()` when `includeTimingTower` is enabled. Standalone timing towers are capped by `--timing-board-max-width` and fill their mount root height; placing the root in a fixed-height container makes only the timing entries scroll. Timing entries always stack from the top as fixed rows, so P1/P2 occupy the same vertical positions whether the race has 2 cars or 20.

The timing tower defaults to `Int` mode and includes a single compact `Int`/`Gap` header toggle unless `ui.timingGapModeToggle: false` is set. The toggle lives in the timing header's gap column and is package-owned: it keeps the same header alignment as `POS`, `TEAM`, `PROJECT`, and `TYRE`, uses a practical `44px` hit target, and draws selected/focus states inside the tower header so the broadcast proportions do not shift. Hosts should not replace this with custom CSS against package internals. If a host needs a different control placement, hide the header toggle and call the controller methods from host-owned UI instead.

Hosts can set the initial mode with `ui.timingGapMode` and can change it at any time with `setTimingGapMode('interval' | 'leader')`, `getTimingGapMode()`, or `toggleTimingGapMode()`. `Int` shows the interval to the car ahead, while `Gap` shows total gap to the leader. Seconds gaps are measured from hidden fixed timing-line crossings on the track. If a car is one or more whole laps behind in the selected mode, the tower shows labels such as `+1` or `+2` instead of a seconds estimate.

Other UI switches:

- `cameraControls` defaults to `'external'`; set it to `'embedded'` only when controls should intentionally appear inside the canvas, or `false` to omit them.
- `penaltyBanners: true` shows warnings and penalties in the top steward message instead of the project/radio lower-third.
- `showFps: false` hides the FPS readout.
- `telemetryIncludesOverview: false` keeps the car/driver overview out of the telemetry stack so hosts can mount `mountCarDriverOverview()` separately.
- `telemetryModules` controls optional package-owned telemetry surfaces: `core`, `sectors`, `lapTimes`, and `sectorTimes`.

Project/radio lower-thirds include a package-owned top-right close button that hides the current pill before its scheduled timeout. Time penalties put a large `+10s` style chip in the left block of the steward message and the affected car/rule beside it. Warning messages use warning colors and do not create timing-row `!` badges. The telemetry surfaces are also available as fully detached mount methods.

### Composable overlay layout contract

`ui.layoutPreset: 'left-tower-overlay'` is package-owned. Hosts should not recreate or depend on internal shell classes such as `.sim-shell--left-tower-overlay` or `.sim-grid` as their public integration contract.

For the all-in-one simulator, call `mountF1Simulator()` and let PaddockJS generate the shell. For composable layouts, hosts should provide mount roots and call package mount methods such as `mountRaceCanvas(root, { includeTimingTower: true, includeRaceDataPanel: true })` or `mountRaceTelemetryDrawer(root)`. Host CSS may size the outer container, but timing-tower placement, gutter measurement, camera safe area, and narrow-screen stacking are owned by PaddockJS.

Mounted package surfaces include a lightweight red start-light loading overlay. The runtime removes each overlay after PixiJS, assets, controls, and the initial readouts are ready.

The runtime also pauses its render ticker when the race canvas is offscreen or the browser tab is hidden. This keeps pages with multiple PaddockJS embeds responsive without requiring host code to manually start and stop each simulator. At `5x` and `10x` browser playback, noncritical timing/readout DOM refreshes run at a lower cadence while fixed-step simulation and race events keep using authoritative race state.

Lifecycle callbacks are optional and host-owned. PaddockJS emits `onLoadingChange`, `onReady`, `onError`, `onDriverSelect`, `onRaceEvent`, `onLapChange`, and `onRaceFinish`; lifecycle callback errors are routed to `onError` when provided and do not stop the simulator loop. `onDriverOpen(driver)` is host-owned navigation code and is not wrapped as a lifecycle callback. Race snapshots include per-car interval timing, leader-gap timing, whole-lap gap counts, calibrated `speedKph`, automatic `track.sectors`, hidden `track.timingLines`, per-car `lapTelemetry`, finish state, `raceControl.winner` after the first finisher, and final `raceControl.classification` only after the whole field is finished or DNF. Sector telemetry clears future-sector values so banners and sidebars show completed splits before the active sector plus the active live timer, not stale later-sector entries. Cars that have crossed the line before full race completion expose `raceStatus: 'waved-flag'` / `wavedFlag: true` and stay frozen in provisional finish order; later barrier contact or stalled-off-track detection does not turn that result into DNF. Destroyed/out-of-race cars expose DNF metadata, show `DNF` at the bottom of the timing tower, render faded/gray in the race canvas, and appear after finishers in final classification with no finish time. If a DNF car is restored before final classification, it re-enters live timing and the race waits for it again; once `raceControl.finished` is true, classification stays final. Final classification applies time penalties and unserved service conversions through `adjustedFinishTime`, then applies position-drop and disqualification consequences to finishers before DNF entries. The field then circulates in safety-car mode and the race canvas shows a package-owned winner banner.

## License

PaddockJS is released under `Apache-2.0`. See [LICENSE](LICENSE).
