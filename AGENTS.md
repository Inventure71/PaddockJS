# AGENTS.md

## Project

PaddockJS is an installable browser component package for an F1-style project race simulator.

The package lives independently from the portfolio website. Host websites install it and mount it with:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';
```

It can also be mounted as rearrangeable package-owned pieces with:

```js
import { createPaddockSimulator } from '@inventure71/paddockjs';
```

## What Is In This Repo

- `src/index.js`: public package API.
- `src/api/`: public composable mounting controller.
- `src/app/`: browser runtime, DOM bindings, PixiJS app lifecycle, controls, readouts, and camera orchestration.
- `src/config/`: default options and bundled default asset mapping.
- `src/data/`: driver/project data normalization, driver/car pairing, rating conversion, and demo data.
- `src/rendering/`: PixiJS rendering helpers, render interpolation, and `src/rendering/track/` feature-owned procedural track drawing.
- `src/simulation/`: deterministic race simulation facade plus feature-owned race, rules, driver, vehicle, timing, pit, and track modules.
- `src/simulation/track/`: canonical track model implementation. `src/simulation/trackModel.js` is only a compatibility re-export.
- `src/simulation/vehicle/`: canonical vehicle geometry, physics, wheel-surface, runoff, and contact behavior. Root `vehicleGeometry.js`, `vehiclePhysics.js`, and `wheelSurface.js` are compatibility re-exports.
- `src/simulation/driver/`: canonical driver AI policy modules. Root `driverController.js` is a compatibility export.
- `src/simulation/timing/`: canonical lap telemetry, timing-line, history, sector-performance, and gap-estimation modules. `raceTiming.js` is the timing export surface.
- `src/simulation/pit/`: pit intent, state, flow, routing, service, queue, penalty service, tire service, and route movement.
- `src/environment/sensors/`: canonical environment sensor implementation. `src/environment/sensors.js` is a compatibility barrel.
- `src/ui/`: generated markup for the all-in-one shell and individually mounted UI surfaces. `componentTemplates.js` is a compatibility barrel; individual surfaces live in focused `*Template.js` files.
- `src/__tests__/`: package tests.
- `assets/`: simulator-owned default assets.
- `docs/`: package specs and design documentation.
- `INSTALL_AND_UPDATE.md`: install/update workflow.

## Required Documentation Discipline

When changing simulator behavior, update docs in the same change.

Use this mapping:

- Public API, lifecycle, install assumptions: update `docs/system_specs.md` and `README.md` if needed.
- Race behavior, DRS, safety car, starts, physics, collisions: update `docs/rules.md`.
- Vocabulary or domain model: update `docs/concepts.md`.
- Driver/entry/options/assets callback shapes: update `docs/data_contract.md`.
- Module ownership or data/control flow: update `docs/architecture.md`.
- Local install/update workflow: update `INSTALL_AND_UPDATE.md`.

Do not leave docs describing old behavior after code changes.

## Linear Work Logging

For any implementation that is more than a trivial/no-op change, log the work in the PaddockJS project on Linear.

The Linear update must include:

- what task was done
- how it was solved
- any important verification or remaining follow-up

## Engineering Rules

- Preserve the package boundary: PaddockJS should stay reusable and host-agnostic.
- Host-specific routing belongs in `onDriverOpen(driver)`, not package internals.
- Host-specific project data should be passed as `drivers` and `entries`, not hardcoded into the runtime.
- The package should own default simulator assets so hosts do not need to copy them.
- Treat the timing board width and broadcast proportions as package-owned. Do not resize or retune timing-board width as a casual fix; preserve its intended width and solve layout bugs through internal column/content constraints unless the user explicitly asks to redesign the timing board sizing.
- Keep facade files thin. New implementation details should go into the feature-owned modules above, not into compatibility barrels or broad facades such as `F1SimulatorApp.js`, `raceSimulation.js`, `rulesConfig.js`, `raceTiming.js`, `pitService.js`, `componentTemplates.js`, or `driverController.js`.
- Keep simulation logic deterministic for the same seed, track seed, drivers, entries, and rules.
- Do not claim completion without running verification.
- Keep model-facing senses and sense visualization aligned. The active environment observation contract is the source of truth: policies receive it, Policy Runner/expert visualizations render it, and no model-sense panel may recompute or display more precise/different values. Extra high-precision diagnostics may exist only as clearly labeled debug overlays and must not be presented as what the model receives.

## Verification

Run the normal local package gate before claiming package changes are complete:

```bash
npm run check
```

`npm run check` is intentionally the fast default. It runs fast Vitest coverage, public type checking, dry-pack verification, packed-consumer install/build verification, the tracked showcase build, and the quick Chromium browser smoke. The browser smoke reuses the `local-preview` build produced by `showcase:ci`; do not add a second preview build back into this path.

Run the exhaustive release gate when a change touches broad simulator behavior, browser/showcase behavior, packaging, public APIs, slow characterization coverage, or before release handoff:

```bash
npm run check:release
```

`npm run check:release` runs the slow characterization tests and the full Chromium browser smoke matrix. If only browser behavior needs rechecking after an already-built showcase, use:

```bash
npm run browser:smoke:full -- --skip-build
```

For portfolio integration changes, also run from the portfolio repo:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
npm run check
```

Browser behavior changes need a browser smoke test against the host page.
