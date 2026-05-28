# PaddockJS Showcase Host

This folder is the tracked showcase website for testing PaddockJS as an embedded package.

It stays inside the repo on purpose so package changes, consumer examples, and CI all verify the same host integration.

## First-Time Setup

From the PaddockJS repo root:

```bash
npm run showcase:install
```

Use Node `20.19.0` or newer; the showcase host builds through the current Vite toolchain.

This installs the showcase host dependencies inside `local-preview/` and links PaddockJS with:

```json
"@inventure71/paddockjs": "file:.."
```

The Vite dependency optimization cache is intentionally stored at `../.vite/local-preview` instead of inside `local-preview/node_modules`. The repo-level verification command runs a clean showcase install, and keeping the cache outside the showcase `node_modules` prevents a running dev server from serving stale optimized dependency URLs after that install.

## Run The Preview

From the PaddockJS repo root:

```bash
npm run showcase:dev
```

Open the local URL printed by Vite, usually:

```txt
http://127.0.0.1:5173/
```

If port `5173` is already in use, Vite will print another port, such as `5174`.

## Build Smoke Test

To verify the preview host can bundle PaddockJS and its assets:

```bash
npm run showcase:build
```

This builds the tracked host into `local-preview/dist/`.

### Policy Runner Server Mode

The Policy Runner includes a `Policy server` controller for bring-your-own-model
debugging. Start a server that implements the package example contract:

```bash
python -m pip install -r examples/python/requirements.txt
python examples/python/base_policy_server.py
```

Then open `policy-runner.html`, select `Policy server`, and point it at the
server URL. The browser owns the simulator and sends public observations to the
server; the server returns normalized controls.

## What This Tests

The preview imports the package by name:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';
```

The preview is organized as a small multi-page host website:

- `/`: overview and navigation.
- `/templates.html`: all-in-one shell presets.
- `/components.html`: composable mount surfaces.
- `/customization.html`: semantic theme packages, light/dark/system mode, selected-team theming, component overrides, and a copyable theme config.
- `/api.html`: controller methods and lifecycle callbacks.
- `/behavior.html`: timing fit, embedded race-window variants, banner sizing, procedural track profiles, loading, and finish/classification behavior.
- `/rules.html`: host-configurable rules, active rule modules, and reserved future module keys.
- `/stewarding.html`: penalty banners, track-limit penalties, and penalty controller methods.
- `/collision-lab.html`: shared geometry, wheel surface, and track-limit math in a manual fake-track harness.
- `/policy-runner.html`: visual controller playback through the shared driver-controller loop, with supported `Distilled policy`, `Policy server`, and `Live preview stream` modes, selectable car configurations, advanced physics, and a live panel showing the physical-driver senses fed to the selected controller.

Each route now includes a coverage checklist plus hideable example-code panels so the showcase stays auditable without leaving large code blocks permanently open.

It tests both public mounting paths:

```js
import {
  createPaddockSimulator,
  mountF1Simulator,
  mountCameraControls,
  mountCarDriverOverview,
  mountRaceCanvas,
  mountRaceControls,
  mountRaceDataPanel,
  mountRaceTelemetryDrawer,
  mountSafetyCarControl,
  mountTimingTower,
  mountTelemetryCore,
  mountTelemetryPanel,
  mountTelemetrySectors,
  mountTelemetrySectorBanner,
  mountTelemetryLapTimes,
  mountTelemetrySectorTimes,
} from '@inventure71/paddockjs';
```

The templates page mounts complete shells into normal webpage roots:

```html
<div id="f1-simulator-root"></div>
```

One complete-shell showcase uses the package-owned overlay preset:

```js
mountF1Simulator(root, {
  preset: 'timing-overlay',
  theme: {
    mode: 'system',
    tokens: {
      primary: '#ff2d55',
      pitLane: '#7c3aed',
    },
    timingTowerMaxWidth: '370px',
    raceViewMinHeight: '680px',
  },
  ui: {
    showFps: true,
  },
});
```

That verifies preset-first mounting, theme sizing variables, the timing board inside the race view, the camera safe area reserved beside the tower, and the adaptive race-data banner sizing. The complete race workbench uses a fresh procedural track seed on normal page reloads; pass `?completeTrackSeed=20260430` when a deterministic local-preview run is needed. The templates page also shows `dashboard`, `compact-race`, `full-dashboard`, a dedicated radio/project banner option with `raceDataTelemetryDetail: true`, and the race telemetry drawer template with integrated project telemetry detail. In that drawer template, the package-owned safety-car control remains available while the telemetry drawer is open.

The templates page lazy-starts heavy simulator demos before their host roots enter the viewport. This keeps the showcase from initializing every offscreen PixiJS app at once while still starting the next visible simulator early enough that users should not land on a static loading placeholder.

The components and behavior pages verify the composable race-canvas option:

```js
mountRaceCanvas(canvasRoot, simulator, {
  includeTimingTower: true,
  includeRaceDataPanel: true,
  timingTowerVerticalFit: 'expand-race-view',
});
```

That checks the embedded timing tower, camera safe area, project/radio lower-third, and loading overlay in a single composable race-window mount. The behavior page also covers `ui.cameraControls: 'embedded'` and `includeTelemetrySectorBanner: true` inside the race window, while the independent sector lower-third is still exercised separately by `mountTelemetrySectorBanner()`.

The API and behavior pages wire lifecycle callbacks and include winner data in live JSON so callback and final-classification behavior can be inspected without host-specific routing. The API page also documents the convenience wrappers and snapshot/speed reads that hosts can call on the returned controller.

The playable page maps keyboard driving and pit commands through the browser expert action contract. `P` requests a stop if the lane is free, `O` commits the stop, `X` clears the request, and `1`/`2`/`3` select soft/medium/hard target compounds.

The components page mounts each package-owned piece into separate host containers, then starts one shared controller:

- race controls
- safety car control
- camera controls
- timing tower
- race canvas
- full telemetry panel
- telemetry panel pieces, including core telemetry, the sector graph, sector banner, lap table, and sector table
- race telemetry drawer
- car and driver overview
- race data panel

The API page controls call the returned controller methods:

- `selectDriver(driverId)`
- `restart(nextOptions)`
- `toggleSafetyCar()`
- `setRedFlagDeployed(deployed)`
- `setPitLaneOpen(open)`
- `setPitIntent(driverId, intent, targetCompound)`
- `getPitIntent(driverId)`
- `getPitTargetCompound(driverId)`
- `servePenalty(penaltyId)`
- `cancelPenalty(penaltyId)`
- `getSnapshot()`

That means the page exercises the same public API paths a real host website should use, without relying on package internals.

The browser smoke uses the showcase to verify the layout support contract at desktop, tablet, mobile, 320px mobile, and short-wide geometries. The preview host deliberately removes its own narrow-screen side padding at the 320px edge so the package receives the documented minimum supported container width. Separate smoke coverage constrains a component below `320px` and expects the package-owned unsupported-size placeholder instead of a clipped component.

## Normal Package Verification

Before treating package changes as complete, still run:

```bash
npm run check
```

This runs the unit/type/package/consumer checks, rebuilds the preview with `npm --prefix local-preview ci && npm --prefix local-preview run build`, and runs the Playwright browser smoke suite against the preview pages.

Use `npm run check:release` from the package root when a change needs the slow characterization tests and full browser smoke matrix.
