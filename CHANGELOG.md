# Changelog

## 2.0.0

### Major Changes

- Promote the `v6` simulator work as the next major PaddockJS release. This release keeps the package boundary focused on browser-mounted simulator components, composable simulator surfaces, and browser-free JavaScript environment/control APIs.
- Add the stricter opt-in `physicsMode: 'simulator'` vehicle model with 2D velocity/yaw dynamics, traction limits, speed-sensitive steering, steering scrub, slip telemetry, reduced off-road grip, and simulator-mode AI tuning. The default remains `physicsMode: 'arcade'` for existing hosts.
- Add richer procedural track generation with semantic profiles (`race`, `training-short`, `training-medium`, and `training-technical`), validated connected-region centerlines, profile-level generation controls, deterministic `trackGeneration` options, DRS zones, pit-lane access geometry, and cached track query indexes.
- Add hard barrier-wall consequences and opt-in stalled off-track DNF handling. Barrier contact now marks cars destroyed/DNF in both physics modes, while `rules.modules.stalledDnf` can retire cars that remain stopped off legal surfaces.
- Expand the headless environment contract for real training loops: compact vector/object/full observation output, optional `Float32Array` vectors, schema caching, no-state/minimal/full result output, per-driver episode info, selected-driver resets, reset-only scenario placements, reward normalization, evaluation helpers, rollout metrics, and a shared driver-controller loop.
- Add physical-driver observation support with richer body/boundary/contact senses, opponent radar, configurable ray layouts, surface-aware ray channels, driver/debug precision modes, and model-sense visualization that renders the active observation rather than recomputing browser-only values.
- Add participant interaction profiles and replay ghosts for training/comparison workflows. `batch-training`, `isolated-training`, and related profiles can make real physics participants non-colliding, sensor-hidden, pit-non-blocking, or race-order-excluded, while replay ghosts remain separate trajectory overlays outside car physics/rules.
- Add Policy Runner support for the three package-supported controller paths: browser-run distilled policy playback, JSON policy-server action loops, and live preview streams for externally rendered snapshots.
- Add Python bridge examples for policy-server integration through `examples/python/base_policy_server.py` plus a minimal `requirements.txt`.
- Add UI/runtime controls for simulation speed, external rendering/live preview, replay ghost drawing, no-collision markers, debug-only physics-mode indicators, runtime warmup, visibility-aware frame loops, and reduced high-speed DOM refresh cost.

### Package UI And Showcase

- Rework the tracked `local-preview` showcase into release coverage pages for templates, components, API controls, behavior/layout contracts, stewarding, collision lab, Policy Runner, and rules.
- Add generated showcase coverage cards and hideable example-code panels so each documented mount/control path has an accurate colocated example.
- Add the Rules page and update showcase navigation across all tracked pages.
- Clean up showcase composition bugs around loaded simulator heights, placeholder min-heights, section-title wrapping, empty/wrong code examples, and host embed overflow.
- Remove the old standalone `expert-environment.html` page after folding the supported environment/control coverage into the broader docs and Policy Runner paths.

### Architecture And Maintenance

- Split large facade files into feature-owned modules for app banners, camera control, readouts, rendering, runtime lifecycle, sensors, track generation/querying, pit flow, race lifecycle, race order, race finish/classification, rules, timing, driver control, vehicle physics, and snapshots.
- Keep compatibility barrels thin while moving implementation into canonical feature directories such as `src/simulation/track/`, `src/simulation/vehicle/`, `src/simulation/driver/`, `src/simulation/timing/`, `src/simulation/pit/`, `src/environment/sensors/`, and `src/app/`.
- Add fast/slow Vitest mode helpers, release browser-smoke coverage, local-preview markup regressions, policy-runner encoder/server tests, warmup tests, physics-mode tests, expert sensor renderer tests, and a track-query-index benchmark script.
- Update package release gates so `npm run check` runs fast tests, public type checks, dry pack, packed-consumer smoke, tracked showcase build, and quick Chromium smoke; `npm run check:release` adds slow characterization and the full browser smoke matrix.

### Fixes And Behavior Cleanup

- Ensure browser expert teardown destroys the expert adapter and detaches external renderer subscriptions.
- Preserve external renderer driver IDs when incoming live-preview frames already use local simulator driver IDs.
- Keep browser expert rendering stable when compact environment result options request no returned state payload.
- Validate missing/non-finite controlled-driver actions instead of silently applying stale or zero controls.
- Keep environment reset behavior stable when partial reset options omit nested groups or intentionally replace scenario placements.
- Keep no-collision participants and replay ghosts aligned across rendering, sensors, race order, collision, pit occupancy, and public snapshots.
- Keep model-facing observations and visual sensor overlays aligned to the active observation contract, with debug precision reserved for labeled diagnostics.
- Make the debug physics-mode square opt-in through `debug.physicsModeIndicator` and hidden by default for package consumers.
- Remove the deleted `training-lab` workflow from the package boundary; release artifacts include supported docs/examples only.

### Documentation

- Add the Custom Model Controller Guide for wrapping a trained model as a batched controller usable from browser playback or headless loops.
- Expand README, system specs, data contract, training guide, rules, concepts, architecture notes, learnings, and install/update workflow for the new simulator, environment, Policy Runner, showcase, and release-gate behavior.
- Document the Python policy-server boundary as an example bridge, not a packaged Python Gymnasium/PettingZoo integration.

### Known Future Scope

- Weather effects, reliability failures, fuel-load performance effects, static obstacles, debug mutation APIs, assisted controls, and packaged Python Gymnasium/PettingZoo wrappers remain intentionally out of 2.0.0.

## 1.0.0

### Major Changes

- Promote PaddockJS to the first stable release for reusable browser embeds and headless JavaScript training/control workflows. The package now exposes the production simulator through `mountF1Simulator()`, composable mount helpers through `createPaddockSimulator()`, and a browser-free environment API through `@inventure71/paddockjs/environment`.
- Stabilize the 1.0 race-simulation feature set around pit-lane and pit-stop behavior, stewarded penalties, more realistic vehicle geometry and wheel-level surface handling, improved timing/DRS data, and lower-cost simulation/runtime paths.

### Race Simulation

- Add deterministic procedural tracks with pit-lane geometry, service areas, team queue slots, garage boxes, legal pit-lane surfaces, pit entry/exit routes, pit-lane open/closed state, and red-flag gating.
- Add automatic and host-controlled pit-stop intent, target tire compounds, service timing, penalty service before tire work, team queue behavior, pit-service countdown display, and optional pit-crew service variability.
- Add penalty ledger support for time, drive-through, stop-go, position-drop, grid-drop, and disqualification consequences, including service/cancel/final-classification conversion behavior.
- Enforce track limits from all four wheel contact patches, not car center position, and resolve each car's physics surface from the worst wheel surface.
- Add pit-lane speeding steward enforcement on speed-limited pit-lane parts while keeping pit-entry and pit-exit connector roads legal but not speed-limited.
- Use body-hull car collision geometry instead of transparent sprite bounds, with swept checks to prevent endpoint tunneling and contact metadata for callbacks/debugging.
- Fix lapped-traffic collision fault assignment so rear contact is judged by physical track order rather than cumulative race distance.
- Fix DRS detection so physically-ahead lapped traffic can be the DRS reference car.
- Improve race timing with fixed timing-line crossing history, interval and leader-gap modes, lap-gap labels for lapped cars, sector telemetry, provisional waved-flag status, and final classification after the full field finishes.

### Performance And Runtime

- Cache per-car geometry and wheel-surface state for repeated collision, surface, snapshot, and debug consumers.
- Reduce collision candidate work with circular-track distance-window pruning before swept AABB/SAT checks.
- Reduce headless/runtime cost by avoiding repeated full snapshot serialization during frame skips and by adding lean render/observation snapshot paths.
- Reduce observation cost by reusing ray-origin track state and broadphasing ray/car tests before exact footprint intersection.
- Reduce browser work by throttling noncritical DOM/timing refreshes at high playback speeds, reusing supplied snapshots for camera-control availability, caching stable pit-lane status graphics, pruning DRS trail histories in place, and skipping repeated text/markup writes.

### Public API And Docs

- Add and document the expert/headless environment API, action and observation specs, starter progress reward helper, rollout recorder/evaluation helpers, and worker-protocol wrapper.
- Add public controller methods for safety car, red flag, pit-lane open/closed state, pit intent/compound control, and penalty serve/cancel controls.
- Add the `ui.simulationSpeedControl` TypeScript option and document the browser playback speed control.
- Expand local preview and browser smoke coverage for templates, composable mounts, API controls, behavior, stewarding, collision lab, expert environment, and policy runner pages.
- Update package docs for 1.0 behavior, data contracts, architecture boundaries, rules, training/control usage, and installation/update workflow.

### Known Future Scope

- Weather effects, reliability failures, and fuel-load performance effects remain intentionally out of 1.0.0 and are tracked as future work.

## 0.3.0

### Minor Changes

- eabe042: Prepare the major 0.3.0 feature release with published-package docs, runtime restart hardening, and the first expert environment API. Public install docs now target npm consumption, package dry-run contents exclude repo-agent files and unexported standalone code, lockfiles are synchronized to the package version, host driver/entry validation rejects duplicate IDs, invalid lap counts normalize to one-lap races, restart can rebuild deterministic tracks from a new `trackSeed`, asset URL changes are explicitly remount-only, and rerender paths destroy replaced PixiJS display children. The release also adds a browser-free JavaScript environment contract through the `@inventure71/paddockjs/environment` subpath and an opt-in browser expert wrapper that reuses the visual simulator's race state, including opt-in in-canvas ray sensor visualization for controlled expert drivers, center-origin geometry-based ray detection for track exit/re-entry transitions and car footprints, a starter `createProgressReward()` callback, and a dependency-free headless training/evaluation example. It also documents the bring-your-own-model boundary, adds environment action/observation specs, and includes a visual policy-runner example that demonstrates `policy.predict(observation)` driving browser expert mode without adding ML dependencies or model persistence.

## 0.2.0

### Minor Changes

- 846f388: Add detached telemetry surfaces, sector timing status colors, a broadcast sector banner, and a race telemetry drawer template with embedded timing tower, safety-car control, and lower-third race data.

### Patch Changes

- 21cf4e5: Document the official release workflow and switch automated publishing to npm trusted publishing through GitHub Actions.

All notable changes to this project will be documented in this file.

The npm release workflow updates this changelog from committed Changesets.
