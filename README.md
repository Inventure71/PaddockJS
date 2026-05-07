# PaddockJS

PaddockJS is an installable F1-style simulator component for browser host websites. It owns the simulator source, bundled simulator assets, CSS, demo data, and public mount API.

## Install

From npm:

```bash
npm install @inventure71/paddockjs
```

## Documentation

Start with [docs/index.md](docs/index.md) for system specs, rules, concepts, data contracts, and architecture notes.

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
npm run consumer:smoke
npm run browser:smoke
npm run showcase:dev
npm run showcase:build
npm run changeset
```

`npm run check` verifies runtime tests, public declarations, dry package contents, packed-package consumption in a fresh Vite app, the showcase build, and real Chromium smoke tests against the showcase pages.

Local development and showcase builds require Node `20.19.0` or newer. CI currently runs the package check on Node 22 and releases on Node 24.

## Expert Environment API

Headless training code imports the environment subpath:

```js
import { createPaddockEnvironment, createProgressReward } from '@inventure71/paddockjs/environment';
```

The package root remains the browser component API. The environment subpath is intentionally browser-free and does not import DOM, PixiJS, or package CSS.
PaddockJS is a bring-your-own-model environment. It does not choose an ML framework, store model weights, or ship a trained driver. See [Bring Your Own Model](docs/training.md) for the policy shape and visual playback loop.

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  frameSkip: 2,
  reward: createProgressReward(),
});

let result = env.reset();
result = env.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});
```

The repository includes a dependency-free starter training loop that uses the same environment contract:

```bash
node examples/train-basic-policy.mjs --generations=4 --candidates=5 --episodes=1 --steps=240
```

The starter script imports the public `@inventure71/paddockjs/environment` subpath and uses self-contained example data from `examples/trainingData.mjs`, so it does not depend on private package source modules for demo drivers.

Each ray reports track-transition distance and car distance. A track hit uses `kind: 'exit'` when the ray leaves the road and `kind: 'entry'` when an off-track ray points back to the road.

External training code can inspect the environment contract without guessing field ranges:

```js
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
```

Browser expert mode is opt-in through the normal mount API. When enabled, the visual simulator advances only when host code calls `simulator.expert.step(actions)`. Expert mode is a mount-time boundary; changing `expert` through `restart(nextOptions)` is rejected so ticker ownership cannot silently change under a mounted simulator.
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

## API

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

`drivers` is the host-owned project/pilot list. `entries` is the optional driver/car/team pairing sheet. The car/driver overview uses the existing driver and vehicle rating components from each entry. Driver and vehicle entries can also include `customFields` as extra label/value metadata. Entries can include `team: { id, name, color, icon }`; the timing tower uses the team icon and defaults team color to the car color when omitted. Assets, including the default car image and generic driver helmet, are bundled by default, so the host website does not need to provide simulator images or textures.

The returned object supports:

- `destroy()`
- `restart(nextOptions)` for non-asset, non-expert race/data/seed changes
- `selectDriver(driverId)`
- `setSafetyCarDeployed(deployed)`
- `callSafetyCar()`
- `clearSafetyCar()`
- `toggleSafetyCar()`
- `getSnapshot()`
- `expert` when explicitly enabled, otherwise `null`

Useful UI options:

```js
preset: 'timing-overlay',
theme: {
  accentColor: '#00ff84',
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
}
```

`preset` is resolved before explicit host options. Available presets are `dashboard`, `timing-overlay`, `compact-race`, and `full-dashboard`; hosts can start from a preset and override any `ui` or `theme` field. `theme` maps to package CSS variables for the stable sizing/color contract: `accentColor`, `greenColor`, `yellowColor`, `timingTowerMaxWidth`, and `raceViewMinHeight`.

If `trackSeed` is omitted, each mounted browser simulator creates a fresh procedural circuit. Passing `trackSeed` makes the track deterministic so multiple embeds can share the same generated circuit; repeated procedural seeds are cached within the page runtime. `restart({ trackSeed })` rebuilds the race on the deterministic circuit for the new seed. Asset URL changes are not restartable; destroy and mount a new simulator when changing assets.

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

Supported rulesets are `paddock`, `grandPrix2025`, `fia2025`, and `custom`. Presets only choose defaults; explicit module config wins. Penalty subsections use `strictness` from `0` to `1` instead of plain booleans. Track limits use the white line as the legal edge and require both outside wheel points on the excursion side to be beyond the line. Collision stewarding considers impact severity, closing speed, and whether one car clearly hit another from behind; clear rear contact penalizes only the trailing car, while unclear meaningful contact records shared-fault penalties for both cars. Track-limit warnings are emitted as `track-limits` events, while penalty decisions are exposed through `snapshot.penalties` plus `penalty` events. Penalty consequences support warning, time, and drive-through payloads; time consequences are additive and derive `penaltySeconds` for UI consumers and final classification.

`initialCameraMode` accepts `'overview'`, `'leader'`, `'selected'`, or `'show-all'`; invalid values fall back to `'leader'`. `layoutPreset: 'left-tower-overlay'` creates a left broadcast gutter inside the race view, frames the camera around the remaining race area, and places the timing tower in that gutter without covering camera controls. The project/radio lower-third stays inside the race window and can intentionally render over the timing sidebar instead of shrinking around it. Composable hosts should pass `{ includeRaceDataPanel: true }` to `mountRaceCanvas()` when they want that lower-third clipped and layered by the race window; `mountRaceDataPanel()` remains available for hosts that intentionally want the banner as a standalone surface. `raceDataTelemetryDetail: true` makes the project lower-third include a compact S1/S2/S3 sector strip; radio mode stays the same and the standalone `mountTelemetrySectorBanner()` surface remains available only when a host explicitly mounts it. `includeTimingTower: true` embeds the timing tower directly inside the race canvas and reserves camera space from the measured tower gutter when the tower is a side overlay. In narrow mobile hosts, package CSS stacks the embedded timing tower full-width and the camera stops reserving a fake left gutter. `mountRaceTelemetryDrawer()` is a higher-level template that mounts an external top control row, race canvas, embedded timing tower, lower-third, top steward message, safety-car control, and a right telemetry drawer together; pass `{ raceDataTelemetryDetail: true }` when the drawer lower-third should include compact sector detail. The top row contains camera controls, safety car, and the telemetry toggle so those controls do not cover the race. Opening the drawer reduces the race area instead of overlaying it, and closing it removes the drawer from interaction. The drawer uses the same package-owned `telemetry-stack` component as `mountTelemetryPanel()`, so constrained host heights scroll telemetry vertically instead of letting the sidebar escape its frame. `raceDataBanners.initial` selects the starting banner state (`'project'`, `'radio'`, or `'hidden'`), while `raceDataBanners.enabled` chooses which banner types may appear. `raceDataBannerSize: 'auto'` uses the race space to the right of the timing board when it is wide enough and falls back to the full lower-third overlap when it is not; `'custom'` preserves the default CSS-variable-driven lower-third size for hosts that want to tune their own banner geometry. `timingTowerVerticalFit: 'expand-race-view'` lets the race window grow tall enough for the tower; `'scroll'` keeps the race window height and scrolls the timing list inside the cropped tower. The same fit values can be passed to `mountRaceCanvas()` when `includeTimingTower` is enabled. Standalone timing towers are capped by `--timing-board-max-width` and fill their mount root height; placing the root in a fixed-height container makes only the timing entries scroll. Timing entries always stack from the top as fixed rows, so P1/P2 occupy the same vertical positions whether the race has 2 cars or 20. The timing tower includes an `Int`/`Gap` broadcast switch: `Int` shows the interval to the car ahead, while `Gap` shows total gap to the leader. `cameraControls` defaults to `'external'`; set it to `'embedded'` only when controls should intentionally appear inside the canvas, or `false` to omit them. `penaltyBanners: true` shows warnings and penalties in the top steward message instead of the project/radio lower-third; time penalties put a large `+10s` style chip in the left block and the affected car/rule beside it. Warning messages use warning colors and do not create timing-row `!` badges. `showFps: false` hides the FPS readout. `telemetryIncludesOverview: false` keeps the car/driver overview out of the telemetry stack so hosts can mount `mountCarDriverOverview()` separately. `telemetryModules` controls optional package-owned telemetry surfaces: `core`, `sectors`, `lapTimes`, and `sectorTimes`; those same surfaces are also available as fully detached mount methods.

### Composable overlay layout contract

`ui.layoutPreset: 'left-tower-overlay'` is package-owned. Hosts should not recreate or depend on internal shell classes such as `.sim-shell--left-tower-overlay` or `.sim-grid` as their public integration contract.

For the all-in-one simulator, call `mountF1Simulator()` and let PaddockJS generate the shell. For composable layouts, hosts should provide mount roots and call package mount methods such as `mountRaceCanvas(root, { includeTimingTower: true, includeRaceDataPanel: true })` or `mountRaceTelemetryDrawer(root)`. Host CSS may size the outer container, but timing-tower placement, gutter measurement, camera safe area, and narrow-screen stacking are owned by PaddockJS.

Mounted package surfaces include a lightweight red start-light loading overlay. The runtime removes each overlay after PixiJS, assets, controls, and the initial readouts are ready.

The runtime also pauses its render ticker when the race canvas is offscreen or the browser tab is hidden. This keeps pages with multiple PaddockJS embeds responsive without requiring host code to manually start and stop each simulator.

Lifecycle callbacks are optional and host-owned. PaddockJS emits `onLoadingChange`, `onReady`, `onError`, `onDriverSelect`, `onRaceEvent`, `onLapChange`, and `onRaceFinish`; callback errors are routed to `onError` when provided and do not stop the simulator loop. Race snapshots include per-car interval timing, leader-gap timing, calibrated `speedKph`, automatic `track.sectors`, per-car `lapTelemetry`, finish state, `raceControl.winner` after the first finisher, and final `raceControl.classification` only after the whole field finishes. Final classification applies time penalties through `adjustedFinishTime`. The field then circulates in safety-car mode and the race canvas shows a package-owned winner banner.

## License

PaddockJS is released under `Apache-2.0`. See [LICENSE](LICENSE).
