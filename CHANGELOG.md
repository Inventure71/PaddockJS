# Changelog

## 2.0.0

### Major Changes

- Prepare the next major release after the simulator, environment, controller, and showcase changes on the `v6` branch.
- Clean up the visual Policy Runner around the supported package-facing controller modes: browser-run distilled policy, policy server action loop, and live preview stream.

### Fixes

- Ensure browser expert teardown destroys the expert adapter and detaches external renderer subscriptions.
- Preserve external renderer driver IDs when incoming live-preview frames already use local simulator driver IDs.
- Keep browser expert rendering stable when compact environment result options request no returned state payload.

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
