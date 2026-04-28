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
  -> simulator.mountTimingTower(timingRoot)
  -> simulator.mountRaceCanvas(canvasRoot)
  -> simulator.mountTelemetryPanel(telemetryRoot)
  -> simulator.mountRaceDataPanel(raceDataRoot)
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

## Runtime App

`src/app/F1SimulatorApp.js` owns browser runtime behavior.

Responsibilities:

- PixiJS application setup.
- Asset loading.
- Sprite creation.
- Control event binding.
- Fixed-step simulation pacing.
- Camera modes.
- Timing tower rendering.
- Telemetry rendering.
- Race data panel rendering.
- Safety car button.
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

`src/simulation/trackModel.js` owns track construction, procedural track generation, DRS zones, and nearest-track queries.

`src/rendering/renderSnapshot.js` owns interpolation for rendering.

## Data Layer

`src/data/driverData.js` converts driver rating sheets into constructor arguments.

`src/data/vehicleData.js` converts vehicle rating sheets into physical setup values.

`src/data/championship.js` pairs drivers with entries and generates timing codes, numbers, and converted constructor data.

`src/data/normalizeDrivers.js` validates host driver data and invokes championship pairing.

`src/data/demoDrivers.js` is demo/portfolio-flavored sample data. It should not become the only supported data path.

## UI Shell

`src/ui/componentTemplates.js` owns the generated markup for individual UI surfaces:

- Race controls.
- Timing tower.
- Race canvas.
- Race-data panel.
- Telemetry panel.

`src/ui/shellTemplate.js` composes those component templates into the default all-in-one simulator DOM. Hosts should not provide the internal simulator markup.

Composable hosts may choose where each package-owned component root is placed, but they still receive package-generated markup through the public mount functions.

`src/styles.css` styles the generated shell and imports package fonts.

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
