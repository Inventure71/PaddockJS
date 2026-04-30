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
  -> simulator.mountTelemetryPanel(telemetryRoot)
  -> simulator.mountRaceDataPanel(raceDataRoot) [optional standalone alternative]
  -> simulator.start()
  -> new F1SimulatorApp(compositeRoot, resolvedOptions)
  -> PixiJS render loop + DOM readout updates
```

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
- Restart behavior.
- Lifecycle cleanup.

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
- Timing history.
- DRS eligibility.
- Collision response.
- Snapshot creation.

`src/simulation/driverController.js` owns AI control decisions.

`src/simulation/vehiclePhysics.js` owns vehicle integration and surface physics.

`src/simulation/trackModel.js` owns track construction, procedural track generation, DRS zones, and nearest-track queries. Browser mounts generate a fresh procedural seed when `trackSeed` is omitted; explicit procedural track seeds are cached so repeated mounts with the same seed do not regenerate or rebuild the same model.

`src/simulation/units.js` owns conversion between simulator units and public meter/km/h display values. Physics stays in simulator units; snapshots expose calibrated display fields such as `speedKph`, `distanceMeters`, and `gapMeters`.

`src/rendering/renderSnapshot.js` owns interpolation for rendering.

The app runtime pauses its PixiJS ticker when the race canvas is outside the viewport or the document is hidden, then resets the frame clock before resuming. This prevents host pages with several simulator embeds from running every race while only one is visible, and avoids a large simulation catch-up step when the canvas re-enters view. Camera safe-area layout measurements are cached and invalidated by resize observation so the 60 FPS render path does not force repeated DOM geometry reads. Long project-radio delays are also treated as stale schedule state instead of replaying every missed lower-third transition.

## Data Layer

`src/data/driverData.js` converts driver rating sheets into constructor arguments.

`src/data/vehicleData.js` converts vehicle rating sheets into physical setup values.

`src/data/championship.js` pairs drivers with entries and generates timing codes, numbers, team metadata, and converted constructor data.

`src/data/normalizeDrivers.js` validates host driver data and invokes championship pairing.

`src/data/demoDrivers.js` is demo/portfolio-flavored sample data. It should not become the only supported data path.

## UI Shell

`src/ui/componentTemplates.js` owns the generated markup for individual UI surfaces:

- Race controls.
- Camera controls.
- Safety-car control.
- Timing tower.
- Race canvas.
- Race-data panel.
- Telemetry panel.
- Car/driver overview panel.

`src/ui/shellTemplate.js` composes those component templates into the default all-in-one simulator DOM and package-owned layout presets such as `left-tower-overlay`. The telemetry panel can embed the car/driver overview, but the overview is also a separately mountable package-owned component. The left-tower overlay preset is responsible for internal component placement and package-owned proportions; the project/radio lower-third remains owned by the race canvas so it can either use the race space beside the timing tower in `auto` sizing mode or overlap the tower when space is constrained. Composable hosts can also ask the race-canvas template to embed the timing tower directly with `includeTimingTower`, using the same expand-vs-scroll vertical fit contract. `F1SimulatorApp` measures the resulting timing-tower gutter when framing the PixiJS camera, whether the tower comes from the prebuilt shell or from an embedded composable race canvas. Hosts should not provide the internal simulator markup or tune preset internals with raw sizing options.

`src/config/defaultOptions.js` owns preset resolution and the public theme contract. Presets are merged before host options; theme fields are applied as package CSS variables by the all-in-one app and composable controller. This keeps sizing/color customization explicit without turning internal layout ratios into public API.

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
