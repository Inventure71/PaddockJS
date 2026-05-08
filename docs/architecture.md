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
- `actions.js` maps normalized public controls onto simulator steering/throttle/brake controls plus pit intent and optional target compound requests.
- `observations.js`, `sensors.js`, and `events.js` build sensor-style observations, fixed-schema vectors, ray/nearby-car readings, and global/per-driver events.

The environment subpath must not import `src/index.js`, package CSS, PixiJS, `F1SimulatorApp`, or DOM-specific code.

`src/simulation/rulesConfig.js` owns ruleset normalization and modular race-rule defaults. It keeps old flat rule keys compatible while adding preset/module config for pit stops, tire strategy, penalties, weather, reliability, and fuel load. Race modules should be added there first, then consumed by simulation logic through the normalized `race.rules` object.

`src/simulation/trackModel.js` owns procedural track geometry, including start/finish normalization, sectors, DRS zones, and the deterministic pit-lane model. The model explicitly straightens the start/finish window so the starting grid, pit-entry approach area, and immediate post-line exit area are geometrically straight instead of merely choosing the least-curved generated segment. The pit lane is generated next to that start straight for every built track and exposes entry/exit connectors, explicit procedural road centerlines that overlap the track surface, connect on the lane-facing side of the main track, are tangent to the track at merge points and to the main pit lane at pit-lane endpoints, a straight main fast lane, a parallel working lane, one shared service area per team, queue geometry behind each service area, and two garage boxes per team. `nearestTrackState()` classifies `pit-entry`, `pit-lane`, `pit-exit`, and `pit-box` as legal drivable states while preserving main-track `crossTrackError` for existing consumers. `src/rendering/proceduralTrackAsset.js` renders the same model with team-colored service areas, queue slots, and paired garage boxes, but draws main-circuit asphalt, kerbs, and borders above pit-lane asphalt so visual crossings are owned by the race track; it also renders an oversized grass background beyond the simulated world bounds, while the transparent race canvas host uses the same grass color as a fallback so free-camera pan and deep zoom-out views do not expose host-page background. `F1SimulatorApp` overlays the dynamic pit-lane status light because open/closed/red-flag state belongs to race control, not the static track texture. `src/simulation/raceSimulation.js` owns the current pit-stop state machine: team/service-area assignment, bounded pit-train scheduling, active pit-lane capacity/gap checks, pit-lane open/closed and red-flag gating, same-team staged service queueing, target-compound selection, pit-crew service-time variability, forward approach-route generation, route segment speed-limiter metadata, fast-lane routing, steering-based route following, snap-limited queue capture, physical service-area occupancy checks, movement-based queue-to-service release, service timing, tire change, and exit routing all consume `track.pitLane` instead of recreating a separate visual-only path.

`src/simulation/rules/` owns focused rule calculation helpers. Each stewarded rule should have its own function and, once non-trivial, its own file. `raceSimulation.js` should orchestrate timing/state and call those helpers; rule modules should return events or penalty payloads rather than mutating the whole simulation directly.

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
- Restart behavior for race data, seed, and track changes. Asset URL changes and browser expert mode changes are intentionally outside restart because texture loading and ticker ownership are part of initialization.
- Lifecycle cleanup, including partial-init failure cleanup and destruction of replaced PixiJS display children without destroying shared textures.

When `options.expert.enabled` is true, `F1SimulatorApp` creates a narrow browser expert adapter around its existing `this.sim` race simulation. The adapter uses the same shared environment runtime as the headless API, but it must not create a second race simulation for the visual mount. Expert browser mounts disable automatic ticker-driven simulation advancement; the canvas updates only after `simulator.expert.reset()` or `simulator.expert.step(actions)` renders the new snapshot. The shared runtime owns controlled-driver pit intent defaults: controlled cars start with `pitIntent` set to `0`, tire-threshold automatic pit calls are disabled for them, and expert actions may request `0`, `1`, or `2` plus optional `pitCompound` through the simulation API instead of steering into the pit lane directly. Expert mode is a mount-time boundary; runtime restart rejects `expert` changes instead of attempting to rewire ticker ownership in place.

Expert sensor visualization belongs to the browser app layer, not the headless environment. The environment result owns the observation contract; `BrowserExpertAdapter` passes that observation into `F1SimulatorApp.renderExpertFrame()`, and `F1SimulatorApp` draws opt-in sensor rays in a Pixi world layer so they share the same camera transform as the track and cars.

This file is still large. When changing it substantially, prefer extracting cohesive modules rather than adding unrelated responsibilities.

`src/app/domBindings.js` owns DOM selector lookup and null-safe readout text writes for package-generated UI surfaces.

## Simulation Core

`src/simulation/raceSimulation.js` owns race state and rules.

Responsibilities:

- Race-control mode.
- Normalized ruleset/module state received from `rulesConfig.js`.
- Start sequence.
- Safety car.
- Car creation.
- Race ordering.
- Lap calculation.
- Per-car lap and sector telemetry.
- Timing history.
- DRS eligibility.
- Steward penalty ledger orchestration using focused rule helpers.
- Collision response.
- Snapshot creation.

`src/simulation/driverController.js` owns AI control decisions.

`src/simulation/vehiclePhysics.js` owns vehicle integration and surface physics.

`src/simulation/trackModel.js` owns track construction, procedural track generation, automatic three-sector metadata, DRS zones, and nearest-track queries. Browser mounts generate a fresh procedural seed when `trackSeed` is omitted; explicit procedural track seeds are cached so repeated mounts with the same seed do not regenerate or rebuild the same model. Procedural generation starts from package-owned spline-like templates with deterministic jitter, validates shape and clearance, and falls back to another template-derived control set instead of an oval control ring when attempts fail.

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

`src/ui/shellTemplate.js` composes those component templates into the default all-in-one simulator DOM and package-owned layout presets such as `left-tower-overlay`. Telemetry graph/table surfaces are independent package-owned components controlled by `ui.telemetryModules` when used through stack/drawer templates; the app renders them from `car.lapTelemetry` without requiring host-owned DOM. The telemetry stack can embed the car/driver overview, owns vertical scrolling when the host constrains its height, and is also embedded by the hide/show race telemetry drawer. The overview is also a separately mountable package-owned component. The broadcast sector banner is a separate lower-third-style sector graph that can be mounted standalone or embedded inside the race canvas only when a host explicitly asks for that independent popup; `F1SimulatorApp` binds the selected car name/code/color to it through the same readout path as the other telemetry surfaces. The race telemetry drawer template composes an external top control row, race canvas with embedded timing tower, project/radio lower-third, top steward message, safety-car control, and the telemetry stack in a right drawer. Its open/close state is owned by `F1SimulatorApp`; the safety-car control, project/radio banner mute toggle, and telemetry toggle stay in the top row while telemetry is open. The drawer reserves final race-view space with a stable margin while the sidebar itself animates with a compositor transform, avoiding grid-template reflow during the slide. The drawer race area uses the configured workbench height so host embeds do not leave unused black space below the simulation. The left-tower overlay preset is responsible for internal component placement and package-owned proportions; the project/radio lower-third remains owned by the race canvas so it can either use the race space beside the timing tower in `auto` sizing mode or overlap the tower when space is constrained. Composable hosts can also ask the race-canvas template to embed the timing tower directly with `includeTimingTower`, using the same expand-vs-scroll vertical fit contract. `F1SimulatorApp` measures the resulting timing-tower gutter when framing the PixiJS camera, whether the tower comes from the prebuilt shell or from an embedded composable race canvas. It also owns camera mode availability, wheel/button zoom for every camera mode, free-camera pan targets created by dragging the canvas, temporary project/radio banner muting, hiding the pit camera control when the active track has no pit-lane geometry, and fitting the pit camera from `track.pitLane` bounds instead of host-provided coordinates. On narrow hosts, CSS stacks timing boards full-width and the camera safe-area measurement treats those boards as stacked content instead of side gutters. Hosts should not provide the internal simulator markup or tune preset internals with raw sizing options.

Penalty UI is display-only. `F1SimulatorApp` may show track-limit warning events and `snapshot.penalties` in the top steward message, and may show timing-row penalty badges when the host enables those UI options, but the UI must not infer, modify, or recalculate steward decisions.

`src/config/defaultOptions.js` owns preset resolution, telemetry module normalization, and the public theme contract. Presets are merged before host options; theme fields are applied as package CSS variables by the all-in-one app and composable controller. This keeps sizing/color customization explicit without turning internal layout ratios into public API.

Race completion is owned by `src/simulation/raceSimulation.js`. The app layer reads `raceControl.finished`, `winner`, and `classification` from snapshots, renders the winner banner, and emits lifecycle callbacks. Penalty lifecycle, pit-stop penalty service, service conversion, time adjustment, position drops, grid drops, and disqualification effects are applied inside the simulation, not in the UI. UI code may display countdowns from `pitStop.phase`, `serviceRemainingSeconds`, and `penaltyServiceRemainingSeconds`, but it must not infer, serve, or recalculate steward outcomes from lap text, timing rows, or car position.

Composable hosts may choose where each package-owned component root is placed, but they still receive package-generated markup through the public mount functions. The controller marks each mounted root as an `f1-sim-component` styling scope so standalone pieces receive the same package variables as the all-in-one shell.

`src/styles.css` styles the generated shell, imports package fonts, caps timing-tower width for readability, and owns the fixed-height timing-list scroll behavior. Timing rows are fixed grid rows stacked from the top, so rank positions do not stretch or redistribute when the number of entries changes. The timing tower owns its runtime interval-vs-leader-gap switch, while `F1SimulatorApp` reads both seconds and whole-lap gap values from the race snapshot and formats positive lap deficits as `+N` before seconds. Fixed hidden timing-line creation, crossing timestamps, and seconds-gap calculation stay inside `src/simulation/raceSimulation.js`. Sector-map surfaces read `lapTelemetry.sectorProgress` for bar fill and `lapTelemetry.liveSectors` for live active-sector time; the simulation owns those values so UI components do not infer active split state from DOM state. Component templates include lightweight package-owned loading overlays; `F1SimulatorApp` removes them after startup initialization has completed.

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
