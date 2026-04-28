# AGENTS.md

## Project

PaddockJS is an installable browser component package for an F1-style project race simulator.

The package lives independently from the portfolio website. Host websites install it and mount it with:

```js
import { mountF1Simulator } from '@inventure71/paddockjs';
```

## What Is In This Repo

- `src/index.js`: public package API.
- `src/F1SimulatorApp.js`: browser runtime, PixiJS renderer, controls, readouts, camera, and lifecycle.
- `src/raceSimulation.js`: race rules and simulation state.
- `src/driverController.js`: driver AI.
- `src/vehiclePhysics.js`: vehicle physics.
- `src/trackModel.js`: track model and procedural track generation.
- `src/driverData.js`: driver rating conversion.
- `src/vehicleData.js`: vehicle rating conversion.
- `src/championship.js`: driver/car pairing and timing metadata.
- `src/normalizeDrivers.js`: host data validation and normalization.
- `src/shellTemplate.js`: generated simulator DOM.
- `src/defaultAssets.js`: bundled default asset mapping.
- `src/demoDrivers.js`: sample/demo drivers.
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

## Engineering Rules

- Preserve the package boundary: PaddockJS should stay reusable and host-agnostic.
- Host-specific routing belongs in `onDriverOpen(driver)`, not package internals.
- Host-specific project data should be passed as `drivers` and `entries`, not hardcoded into the runtime.
- The package should own default simulator assets so hosts do not need to copy them.
- Prefer small, focused modules when extracting from `F1SimulatorApp.js`.
- Keep simulation logic deterministic for the same seed, track seed, drivers, entries, and rules.
- Do not claim completion without running verification.

## Verification

Run before claiming package changes are complete:

```bash
npm run check
```

For portfolio integration changes, also run from the portfolio repo:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
npm run check
```

Browser behavior changes need a browser smoke test against the host page.
