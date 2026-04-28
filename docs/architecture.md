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

## Runtime App

`src/F1SimulatorApp.js` owns browser runtime behavior.

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

## Simulation Core

`src/raceSimulation.js` owns race state and rules.

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

`src/driverController.js` owns AI control decisions.

`src/vehiclePhysics.js` owns vehicle integration and surface physics.

`src/trackModel.js` owns track construction, procedural track generation, DRS zones, and nearest-track queries.

`src/renderSnapshot.js` owns interpolation for rendering.

## Data Layer

`src/driverData.js` converts driver rating sheets into constructor arguments.

`src/vehicleData.js` converts vehicle rating sheets into physical setup values.

`src/championship.js` pairs drivers with entries and generates timing codes, numbers, and converted constructor data.

`src/normalizeDrivers.js` validates host driver data and invokes championship pairing.

`src/demoDrivers.js` is demo/portfolio-flavored sample data. It should not become the only supported data path.

## UI Shell

`src/shellTemplate.js` generates the simulator DOM. Hosts should not provide the internal simulator markup.

`src/styles.css` styles the generated shell and imports package fonts.

The host page should only provide:

```html
<div id="f1-simulator-root"></div>
```

## Assets

`src/defaultAssets.js` imports bundled assets from `assets/` and exposes default asset resolution.

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
