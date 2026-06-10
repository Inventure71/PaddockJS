# Testing Reliability Guide

PaddockJS reliability work is risk-driven. Do not add tests for coverage vanity. Add or change tests when they protect a package contract, a simulator state transition, a browser lifecycle path, or a performance invariant that can silently regress.

## Confidence Model

Use the smallest verification layer that proves the behavior, then run the broader gate before claiming package quality.

- Unit tests in `src/__tests__/` prove deterministic simulation, data normalization, sensor math, controller loops, and focused UI rendering helpers.
- Public type tests in `src/__tests__/publicApi.types.ts` prove the TypeScript consumer contract for root, `/data`, `/environment`, and `/placeholder` imports.
- `npm run consumer:smoke` proves the packed tarball installs and builds in a fresh Vite consumer through public package imports.
- `npm run consumer:bundle-boundaries` proves the packed root browser import remains the CSS/asset-owning simulator bundle while `/placeholder`, `/data`, and `/environment` stay CSS-free or lightweight according to their documented roles.
- `npm run showcase:ci` proves the tracked browser showcase still builds.
- `npm run browser:smoke:quick -- --skip-build` proves the built showcase can mount, paint a nonblank canvas, avoid key overflow regressions, exercise public controls, and keep live customization paths working.
- `npm run browser:smoke:full -- --skip-build` is required for broad browser/showcase/layout behavior and release handoff.
- `npm run benchmark:runtime -- --profile=standard --verify --json` proves simulation, sensor, rendering-data, snapshot, DOM-readout, and compact-transport performance contracts.

## Change Matrix

| Change area | Required focused proof | Required broader proof |
| --- | --- | --- |
| Public root, `/data`, `/environment`, or `/placeholder` API/types | `npm run types:check` plus a public API type assertion when the contract changes | `npm run check` |
| Package install, exports, files, CSS/assets, subpath bundle boundaries, or build assumptions | `npm run pack:dry`, `npm run consumer:smoke`, or `npm run consumer:bundle-boundaries` | `npm run check` |
| Race rules, ordering, DRS, starts, safety car, red flag, pits, penalties, collisions, or finish/classification | Focused Vitest file for the changed rule path | `npm run check`; use `npm run check:release` for broad behavior |
| Track geometry, query index, wheel surfaces, runoff, contact patches, or sensor rays | Focused geometry/sensor tests plus benchmark verification when hot paths change | `npm run check`; benchmark command required for performance-sensitive edits |
| Headless environment, controller loop, worker protocol, Policy Runner, observation/vector/schema contract | Focused environment/controller/transport tests and active observation contract assertions | `npm run check`; benchmark if compact/vector/snapshot cost changes |
| Browser runtime, Pixi lifecycle, layout support, readouts, controls, theme, loading, or smoke pages | Focused DOM/render helper tests where possible | `npm run check`; full browser smoke for broad layout/showcase changes |
| Docs-only consumer guidance | `npm run docs:check` | `npm run check` when docs describe package behavior changed in code |

## Test Quality Rules

- Test behavior through the production path whenever practical. Avoid tests that recreate private helper logic and only prove the helper still matches itself.
- Include negative, stale-state, restart/remount, and partial-update cases for lifecycle code.
- For deterministic simulation changes, fix the seed, track seed, drivers, entries, rules, and scenario inputs in the test.
- For model-facing senses, assert the active observation/vector/schema contract. Debug overlays may have extra data, but no model-sense panel should display a recomputed or more precise value as model input.
- For performance-sensitive paths, assert counters that explain the cost, such as fallback counts, allocation counters, or compact payload sizes. Do not rely only on elapsed time.
- For package boundary work, prove public imports from the packed package, not internal relative paths.
- For browser layout work, prove rendered behavior with browser smoke or a focused DOM/canvas check. Static markup snapshots are not enough when resize observers, canvas painting, or runtime CSS state are involved.

## High-Risk Behaviors To Map In Audits

- `mountF1Simulator()` and `createPaddockSimulator()` lifecycle: initial shell, loading overlays, start, restart, theme sync, destroy, and repeated mount behavior.
- Public subpath boundaries: root imports browser/CSS runtime, `/environment` stays browser-free and CSS-free, `/data` stays CSS-free, `/placeholder` stays tiny and inert.
- Determinism: same seed, track seed, drivers, entries, rules, and scenario produce stable simulation behavior.
- Track query index propagation: built runtime tracks keep the internal non-enumerable index, while public JSON snapshots do not leak engine helpers.
- Race state transitions: start sequence, safety car, red flag, pit-lane open/closed, pit stops, penalties, DNF, finish, and final classification.
- Model-facing observations: object/vector/schema alignment, per-driver overrides, compact/vector-only outputs, reset-only observations, and external renderer frames.
- Rendering and layout: nonblank canvas, timing tower constraints, unsupported-size placeholders, lower-third/timing clearance, theme variables, and composable roots.
- Package consumption: dry pack contents, fresh consumer install/build, browser showcase build, and documented host update path.

## Reporting Standard

Every reliability audit should report:

- current confidence: what is proven and what remains unproven;
- findings ranked by user impact and regression likelihood;
- exact files and behavior paths affected;
- smallest test or verification change that would close each gap;
- commands run, with the gate level they prove;
- any rejected critique, with the technical reason it is not accepted.

If a required command is blocked by the environment, report the command, failure text, retry state, and the exact proof still missing. Do not replace a broad required gate with a narrow check.
