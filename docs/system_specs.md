# System Specs

## Purpose

PaddockJS mounts an interactive F1-style race simulator into a host webpage. The package owns the simulator UI, PixiJS renderer, bundled simulator assets, simulation core, default demo data, and public mount API.

The host website owns only:

- The root DOM element where the simulator mounts.
- The driver/project list.
- Optional driver/car pairing entries.
- Optional display/config overrides.
- `onDriverOpen(driver)` navigation behavior.

## Public API

Main import:

```js
import {
  createPaddockSimulator,
  mountF1Simulator,
} from '@inventure71/paddockjs';
```

All-in-one mount call:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  totalLaps,
  initialCameraMode,
  preset,
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  ui,
  theme,
  assets,
  onLoadingChange,
  onReady,
  onError,
  onDriverSelect,
  onRaceEvent,
  onLapChange,
  onRaceFinish,
});
```

Composable mount call:

```js
const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  totalLaps,
  initialCameraMode,
});

simulator.mountRaceControls(controlsRoot);
simulator.mountCameraControls(cameraControlsRoot);
simulator.mountSafetyCarControl(safetyCarRoot);
simulator.mountTimingTower(timingRoot);
simulator.mountRaceCanvas(canvasRoot, {
  includeRaceDataPanel: true,
  includeTimingTower: true,
  timingTowerVerticalFit: 'scroll',
});
simulator.mountTelemetryPanel(telemetryRoot);

await simulator.start();
```

Standalone helper functions are also exported for host code that prefers function calls:

```js
mountRaceControls(root, simulator);
mountTimingTower(root, simulator);
mountRaceCanvas(root, simulator, {
  includeRaceDataPanel: true,
  includeTimingTower: true,
  timingTowerVerticalFit: 'scroll',
});
mountTelemetryPanel(root, simulator);
mountRaceDataPanel(root, simulator);
```

Returned controller:

```js
{
  // Included on composable controllers only:
  mountRaceControls(root),
  mountCameraControls(root),
  mountSafetyCarControl(root),
  mountTimingTower(root),
  mountRaceCanvas(root, { includeRaceDataPanel, includeTimingTower, timingTowerVerticalFit }),
  mountTelemetryPanel(root),
  mountRaceDataPanel(root),
  start(),

  // Included on both APIs:
  destroy(),
  restart(nextOptions),
  selectDriver(driverId),
  setSafetyCarDeployed(deployed),
  callSafetyCar(),
  clearSafetyCar(),
  toggleSafetyCar(),
  getSnapshot(),
}
```

## Required Behavior

- Mounting creates the simulator shell inside the provided root.
- Composable mounting can place controls, timing tower, canvas, telemetry, car/driver overview, and race-data panels into separate host roots.
- Composable mounting can also place camera controls and a safety-car button into separate host roots while keeping package-owned markup.
- Composable mounting can embed the timing tower directly inside the race canvas with `mountRaceCanvas(root, { includeTimingTower: true })`.
- The race canvas is required before `start()` because PixiJS needs a canvas host.
- Timing tower, telemetry, controls, and race-data panels are optional from a runtime safety perspective; omitted panels simply do not render their readouts.
- Timing tower entries are fixed rows stacked from the top of the timing list. Row vertical position must be based on rank/index, never distributed by available height or total entry count.
- Timing tower entries display team icons. The tower can switch at runtime between interval-to-car-ahead timing and cumulative gap-to-leader timing.
- Snapshots expose calibrated display units through `speedKph`, `distanceMeters`, and `gapMeters`; internal physics remains in simulator units.
- Entries can include optional `team` metadata. Team color defaults to car color when omitted.
- Mounted package surfaces show a package-owned red start-light loading overlay until `start()` finishes PixiJS, asset, control, and initial readout initialization.
- `preset` is a preset-first API. Presets are resolved before explicit host overrides so hosts can use `dashboard`, `timing-overlay`, `compact-race`, or `full-dashboard` as a starting point and still override specific `ui` or `theme` fields.
- `theme` is the public sizing/color contract. It maps to package CSS variables for `accentColor`, `greenColor`, `yellowColor`, `timingTowerMaxWidth`, and `raceViewMinHeight`.
- Camera controls can be embedded in the race canvas, externally mounted, or omitted by `ui.cameraControls`.
- Telemetry can include the car/driver overview directly or stay text-only through `ui.telemetryIncludesOverview` / `mountTelemetryPanel(root, { includeOverview: false })`.
- The FPS readout can be shown or hidden with `ui.showFps`.
- `ui.layoutPreset: 'left-tower-overlay'` is a package-owned preset that creates a left broadcast gutter inside the race view, places the timing tower there at the same width as the default timing-board column, frames the PixiJS camera around the remaining usable race area, and keeps camera controls and start lights out of the tower area. In the combined shell, project and radio lower-thirds stay inside the race window while being allowed to cover the timing sidebar.
- `ui.raceDataBanners.initial` controls the starting lower-third (`'project'`, `'radio'`, or `'hidden'`), and `ui.raceDataBanners.enabled` controls which lower-third types can appear.
- `ui.raceDataBannerSize` controls lower-third sizing: `'custom'` keeps the default CSS-variable-driven banner size for host tuning, while `'auto'` uses the race space to the right of the timing board when wide enough and overlaps the timing board only when space is constrained.
- `ui.timingTowerVerticalFit` controls vertical tower behavior in the combined overlay preset: `'expand-race-view'` grows the race window to fit the tower, while `'scroll'` crops the tower area and scrolls timing rows inside it. The same values are accepted as `mountRaceCanvas()` options when `includeTimingTower` embeds the tower in the race canvas.
- Hosts may scale the whole mounted simulator through the container. The horizontal proportions inside package-owned presets are not public API and should not be configurable through raw width or ratio options. The camera reads the current canvas dimensions so wider or taller host windows reveal more of the race view without needing host-owned camera math. The timing tower has a package-owned max width because overly wide timing boards degrade readability; standalone hosts can constrain vertical height through the mount container and let the timing entries scroll internally. Mobile and narrow embeds are handled by package CSS: timing boards stack full-width when they no longer work as side gutters, camera controls are repositioned into the remaining race area, and full-width timing boards do not reserve horizontal camera gutter space.
- The host does not need to provide simulator assets.
- The host passes data, not internal DOM.
- `onDriverOpen(driver)` is the navigation boundary.
- Lifecycle callbacks are optional: `onLoadingChange`, `onReady`, `onError`, `onDriverSelect`, `onRaceEvent`, `onLapChange`, and `onRaceFinish`. Host callback failures are routed to `onError` when possible and must not stop the simulator loop.
- Race completion is part of the simulation snapshot. Cars receive individual `finished`, `finishTime`, and `classifiedRank` values as they cross the finish distance. The first finisher sets `raceControl.winner`; final `raceControl.classification` and `raceControl.finished` are set only after every car finishes. At that point race control switches to `safety-car`, the final order freezes, and the field keeps circulating under safety-car behavior.
- The simulator must stay interactive after being installed through `npm install ../PaddockJS`.
- The package must build correctly through a browser bundler that supports JavaScript modules, CSS imports, and image imports.
- The simulation should remain deterministic for the same seed, track seed, drivers, entries, and rules.
- When `trackSeed` is omitted in a browser mount, the simulator creates a fresh procedural circuit for that mount. Explicit `trackSeed` values are deterministic and cached by seed for repeated mounts.
- The renderer should target a paced 60 FPS simulation/render loop.
- The render loop should pause while the race canvas is offscreen or the document is hidden, then resume without catching up the elapsed hidden time. Layout measurements needed for overlay camera safe areas should be cached between resize/layout invalidations. Runtime DOM updates should skip unchanged text/markup so visible embeds do not rewrite stable readouts every frame.

## Current Visible Features

- Timing tower with position, team icon, timing code, interval/gap switch, and tire compound.
- Race canvas rendered with PixiJS.
- Procedural track rendering with asphalt texture and DRS overlays.
- Driver selection from cars and timing tower rows.
- Camera modes: overview, leader, selected, show all.
  Overview is a closer static circuit view centered on the world; show all is the mode that dynamically fits the active pack.
- Zoom controls.
- FPS readout.
- Start lights.
- Safety car toggle.
- External safety-car control through controller methods and optional mounted button.
- Restart button.
- Selected-car text telemetry.
- Car/driver overview panel with a center visual, linked stat cells, and a Car/Driver toggle.
- Project/race data lower-third.
- Intermittent project radio quotes.
- Race-finish winner banner and final top-three classification.
- `Open project` button driven by `onDriverOpen(driver)`.

## Runtime Requirements

- Browser environment with DOM APIs.
- A host build tool that handles CSS and image imports. Vite is the currently verified bundler.
- `pixi.js` available through the package dependency graph.

Raw Node imports are not a supported runtime check because the package imports CSS and image assets. Verify through a browser bundler and host page instead.

## Verification

Run from this package:

```bash
npm run check
```

Expected:

- All Vitest tests pass.
- `npm pack --dry-run` succeeds and includes source files plus bundled assets.

Run from the portfolio host:

```bash
npm install ../PaddockJS
npm run check
```

Expected:

- PaddockJS tests pass through the host script.
- The host F1 bundle builds.
- Browser smoke shows shell, canvas, driver rows, FPS readout, and working `Open project` navigation.
