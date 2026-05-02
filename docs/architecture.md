# Architecture

## Package Boundary

PaddockJS is the simulator package. A host website imports it and passes data.

The package owns:

- Simulator source.
- Bundled assets.
- CSS.
- DOM shell generation.
- PixiJS renderer.
- Simulation rules and physics.
- Demo data.
- Tests.

The host owns:

- Project-specific driver data.
- Navigation behavior.
- Page placement.
- Host build and deployment.

## Main Flow

All-in-one flow:

```txt
host page
  -> mountF1Simulator(root, options)
  -> resolveF1SimulatorOptions(options)
  -> normalizeSimulatorDrivers(drivers, entries)
  -> createF1SimulatorShell(options)
  -> new F1SimulatorApp(shell, resolvedOptions)
  -> createRaceSimulation(...)
  -> PixiJS render loop + DOM readout updates
```

Composable flow:

```txt
host page
  -> createPaddockSimulator(options)
  -> resolveF1SimulatorOptions(options)
  -> simulator.mountRaceControls(controlsRoot)
  -> simulator.mountCameraControls(cameraControlsRoot)
  -> simulator.mountSafetyCarControl(safetyCarRoot)
  -> simulator.mountTimingTower(timingRoot)
  -> simulator.mountRaceCanvas(canvasRoot, { includeRaceDataPanel })
  -> simulator.mountTelemetryCore(coreTelemetryRoot)
  -> simulator.mountTelemetrySectors(sectorGraphRoot)
  -> simulator.mountTelemetrySectorBanner(sectorBannerRoot)
  -> simulator.mountTelemetryLapTimes(lapTimesRoot)
  -> simulator.mountTelemetrySectorTimes(sectorTimesRoot)
  -> simulator.mountRaceTelemetryDrawer(raceWorkbenchRoot) [optional template alternative]
  -> simulator.mountRaceDataPanel(raceDataRoot) [optional standalone alternative]
  -> simulator.start()
  -> new F1SimulatorApp(compositeRoot, resolvedOptions)
  -> PixiJS render loop + DOM readout updates
```

Headless environment flow:

```txt
training script
  -> import from @inventure71/paddockjs/environment
  -> createPaddockEnvironment(options)
  -> resolveEnvironmentOptions(options)
  -> createRaceSimulation(...)
  -> env.reset()
  -> env.step(actions)
  -> resolveActionMap(actions)
  -> RaceSimulation.step(...) repeated by frameSkip
  -> buildEnvironmentObservation(...)
  -> optional reward(context)
```

Browser expert mode reuses the same environment runtime around the visual app's existing `RaceSimulation` instance. When `expert.enabled` is true, the visual ticker does not advance simulation time automatically; `simulator.expert.reset()` and `simulator.expert.step(actions)` are the only simulation-advance entry points.

## Public Entry

`src/index.js` is the public package entry.

Responsibilities:

- Import CSS.
- Export package API and data helpers.
- Validate the root element.
- Resolve options.
- Create the DOM shell.
- Construct and initialize `F1SimulatorApp`.
- Return the controller methods.
- Re-export the composable mount API.

`src/index.js` does not export the headless environment API. Training and automation code imports `@inventure71/paddockjs/environment`, which resolves to `src/environment/index.js`.

`src/environment/` owns the browser-free expert environment:

- `index.js` and `index.d.ts` expose the public subpath API.
- `runtime.js` owns environment-loop `reset()`, `step(actions)`, `getObservation()`, and `getState()` around an injected race-simulation host.
- `options.js` validates `controlledDrivers`, scenario participants, frame skip, action policy, sensor config, and episode limits.
- `actions.js` maps normalized public controls onto simulator steering/throttle/brake controls.
- `observations.js`, `sensors.js`, and `events.js` build sensor-style observations, fixed-schema vectors, ray/nearby-car readings, and global/per-driver events.

The environment subpath must not import `src/index.js`, package CSS, PixiJS, `F1SimulatorApp`, or DOM-specific code.

`src/api/PaddockSimulatorController.js` owns composable mounting.

Responsibilities:

- Resolve host options once for component templates and runtime.
- Render each independently mounted component into its host root.
- Build a composite DOM query surface for `F1SimulatorApp`.
- Initialize and control the shared simulator runtime through `start()`, `restart()`, `destroy()`, and state methods.
- Expose explicit safety-car methods for callers that want to deploy or release the safety car without using package-rendered buttons.

## Runtime App

`src/app/F1SimulatorApp.js` owns browser runtime behavior.

Responsibilities:

- PixiJS application setup.
- Asset loading.
- Sprite creation.
- Control event binding.
- Fixed-step simulation pacing.
- Viewport/document visibility throttling for the PixiJS ticker.
- Camera modes.
- Overlay-safe camera framing for the left timing-tower preset.
- Timing tower rendering.
- Telemetry rendering.
- Race data panel rendering.
- Safety car button.
- Multiple package-rendered safety-car buttons bound to one simulation state.
- Restart behavior for race data, seed, and track changes. Asset URL changes are intentionally outside restart because texture loading is part of initialization.
- Lifecycle cleanup, including partial-init failure cleanup and destruction of replaced PixiJS display children without destroying shared textures.

When `options.expert.enabled` is true, `F1SimulatorApp` creates a narrow browser expert adapter around its existing `this.sim` race simulation. The adapter uses the same shared environment runtime as the headless API, but it must not create a second race simulation for the visual mount. Expert browser mounts disable automatic ticker-driven simulation advancement; the canvas updates only after `simulator.expert.reset()` or `simulator.expert.step(actions)` renders the new snapshot.

Expert sensor visualization belongs to the browser app layer, not the headless environment. The environment result owns the observation contract; `BrowserExpertAdapter` passes that observation into `F1SimulatorApp.renderExpertFrame()`, and `F1SimulatorApp` draws opt-in sensor rays in a Pixi world layer so they share the same camera transform as the track and cars.

This file is still large. When changing it substantially, prefer extracting cohesive modules rather than adding unrelated responsibilities.

`src/app/domBindings.js` owns DOM selector lookup and null-safe readout text writes for package-generated UI surfaces.

## Simulation Core

`src/simulation/raceSimulation.js` owns race state and rules.

Responsibilities:

- Race-control mode.
- Start sequence.
- Safety car.
- Car creation.
- Race ordering.
- Lap calculation.
- Per-car lap and sector telemetry.
- Timing history.
- DRS eligibility.
- Collision response.
- Snapshot creation.

`src/simulation/driverController.js` owns AI control decisions.

`src/simulation/vehiclePhysics.js` owns vehicle integration and surface physics.

`src/simulation/trackModel.js` owns track construction, procedural track generation, automatic three-sector metadata, DRS zones, and nearest-track queries. Browser mounts generate a fresh procedural seed when `trackSeed` is omitted; explicit procedural track seeds are cached so repeated mounts with the same seed do not regenerate or rebuild the same model.

`src/simulation/units.js` owns conversion between simulator units and public meter/km/h display values. Physics stays in simulator units; snapshots expose calibrated display fields such as `speedKph`, `distanceMeters`, and `gapMeters`.

`src/rendering/renderSnapshot.js` owns interpolation for rendering.

The app runtime pauses its PixiJS ticker when the race canvas is outside the viewport or the document is hidden, then resets the frame clock before resuming. This prevents host pages with several simulator embeds from running every race while only one is visible, and avoids a large simulation catch-up step when the canvas re-enters view. Camera safe-area layout measurements are cached and invalidated by resize observation so the 60 FPS render path does not force repeated DOM geometry reads. Runtime readouts avoid redundant DOM writes for unchanged text, timing markup, finish classification, and static selected-car overview data. Long project-radio delays are also treated as stale schedule state instead of replaying every missed lower-third transition.

## Data Layer

`src/data/driverData.js` converts driver rating sheets into constructor arguments.

`src/data/vehicleData.js` converts vehicle rating sheets into physical setup values.

`src/data/championship.js` pairs drivers with entries and generates timing codes, numbers, team metadata, and converted constructor data. It rejects duplicate entry driver IDs, ignores omitted driver numbers during uniqueness checks, and falls back to stable grid-order numbers when host entries do not provide numbers.

`src/data/normalizeDrivers.js` validates host driver data, rejects duplicate driver IDs before runtime maps are created, and invokes championship pairing.

`src/data/demoDrivers.js` is demo/portfolio-flavored sample data. It should not become the only supported data path.

## UI Shell

`src/ui/componentTemplates.js` owns the generated markup for individual UI surfaces:

- Race controls.
- Camera controls.
- Safety-car control.
- Timing tower.
- Race canvas.
- Race-data panel, including the optional project telemetry detail variant.
- Telemetry stack template.
- Detached telemetry core, sector graph, lap-time table, and sector-time table.
- Broadcast sector banner.
- Race telemetry drawer template.
- Car/driver overview panel.

`src/ui/shellTemplate.js` composes those component templates into the default all-in-one simulator DOM and package-owned layout presets such as `left-tower-overlay`. Telemetry graph/table surfaces are independent package-owned components controlled by `ui.telemetryModules` when used through stack/drawer templates; the app renders them from `car.lapTelemetry` without requiring host-owned DOM. The telemetry stack can embed the car/driver overview, but the overview is also a separately mountable package-owned component. The broadcast sector banner is a separate lower-third-style sector graph that can be mounted standalone or embedded inside the race canvas only when a host explicitly asks for that independent popup; `F1SimulatorApp` binds the selected car name/code/color to it through the same readout path as the other telemetry surfaces. The race telemetry drawer template composes a race canvas with embedded timing tower, project/radio lower-third, safety-car control, and detached telemetry components in a right drawer. Its open/close state is owned by `F1SimulatorApp`; the safety-car control remains available while telemetry is open. The drawer reserves final race-view space with a stable margin while the sidebar itself animates with a compositor transform, avoiding grid-template reflow during the slide. The drawer race area inherits the workbench height so host embeds do not leave unused black space below the simulation. The left-tower overlay preset is responsible for internal component placement and package-owned proportions; the project/radio lower-third remains owned by the race canvas so it can either use the race space beside the timing tower in `auto` sizing mode or overlap the tower when space is constrained. Composable hosts can also ask the race-canvas template to embed the timing tower directly with `includeTimingTower`, using the same expand-vs-scroll vertical fit contract. `F1SimulatorApp` measures the resulting timing-tower gutter when framing the PixiJS camera, whether the tower comes from the prebuilt shell or from an embedded composable race canvas. On narrow hosts, CSS stacks timing boards full-width and the camera safe-area measurement treats those boards as stacked content instead of side gutters. Hosts should not provide the internal simulator markup or tune preset internals with raw sizing options.

`src/config/defaultOptions.js` owns preset resolution, telemetry module normalization, and the public theme contract. Presets are merged before host options; theme fields are applied as package CSS variables by the all-in-one app and composable controller. This keeps sizing/color customization explicit without turning internal layout ratios into public API.

Race completion is owned by `src/simulation/raceSimulation.js`. The app layer reads `raceControl.finished`, `winner`, and `classification` from snapshots, renders the winner banner, and emits lifecycle callbacks. UI code must not infer finish state from lap text or timing rows.

Composable hosts may choose where each package-owned component root is placed, but they still receive package-generated markup through the public mount functions. The controller marks each mounted root as an `f1-sim-component` styling scope so standalone pieces receive the same package variables as the all-in-one shell.

`src/styles.css` styles the generated shell, imports package fonts, caps timing-tower width for readability, and owns the fixed-height timing-list scroll behavior. Timing rows are fixed grid rows stacked from the top, so rank positions do not stretch or redistribute when the number of entries changes. The timing tower owns its runtime interval-vs-leader-gap switch, while `F1SimulatorApp` reads both timing values from the race snapshot. Component templates include lightweight package-owned loading overlays; `F1SimulatorApp` removes them after startup initialization has completed.

The host page should only provide:

```html
<div id="f1-simulator-root"></div>
```

## Assets

`src/config/defaultAssets.js` imports bundled assets from `assets/` and exposes default asset resolution.

Assets are bundled by the host build tool when the package is imported.

## Tests

Tests live in `src/__tests__/`.

Current coverage includes:

- Championship metadata.
- Component API and callback behavior.
- Driver controller behavior.
- Expert environment actions, observations, rewards, events, and browser adapter behavior.
- Procedural track rendering helpers.
- Race simulation rules.
- Render interpolation.
- Track model behavior.

Run:

```bash
npm test
```

## Design Rule

Keep reusable simulator behavior in PaddockJS. Keep website-specific data and routing in the host.

If a change adds portfolio-only behavior to package internals, move it to the host integration layer instead.
