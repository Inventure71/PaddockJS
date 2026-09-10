# Repository cleanup coverage

This continues the initial [maintainability audit](maintainability_audit_2026-09-08.md) across the repository. The stopping condition is coverage of every repository area, resolution of verified actionable cleanup findings, preserved supported behavior, and passing package/release gates. It is not a promise that software contains no undiscovered defects, and it does not mean discarding or committing the existing working tree.

## Plan and constraints

- [x] Recheck `v11` / `fedff4e` and preserve all 380 current tracked/untracked files in a second baseline outside Git.
- [x] Run three unchanged standard runtime benchmark baselines; retain the prior passing package/release gates as the verified starting state.
- [x] Restore Linear logging and record completed work plus this continuation in the PaddockJS project.
- [x] Review simulation, environment, browser/API/rendering/UI, data/configuration, tests, scripts, demo/showcase, docs, assets, and package/workflow configuration.
- [x] Check compiler-assisted unused-local/missing-name hypotheses and static/dynamic/type/consumer references; retain intentional compile-time assertion bindings.
- [x] Remove proven dead paths and consolidate identical feature rules with explicit owners.
- [x] Fix verified snapshot isolation, cached geometry ownership, and default-path defects with regression tests.
- [x] Update authoritative docs and reconcile every earlier deferred concern with evidence.
- [x] Review integrated changes, run `npm run check` and `npm run check:release`, compare deterministic outputs and repeated benchmarks against the saved source.
- [x] Record final coverage, changed files, measurement limits, preservation checks, read-only Git status, and Linear results.

No dependency upgrades, product redesign, speculative optimization, or Git/GitHub mutation is part of this work. Existing timing-board proportions, model-facing sensor precision, deterministic arithmetic/random order, public exports/types, and intentional asset/callback recovery remain acceptance constraints.

## Ownership before implementation

- **Simulation:** remove definition-only internals after checking barrels and consumers. `raceDistance` owns wrapped progress arithmetic; `penaltyStats` owns penalty totals; pit geometry constants belong to existing pit routing/state owners. Snapshot serializers own copies of supported mutable nested data; race orchestration selects snapshots. Cached track grid topology is static and must be frozen without freezing per-runtime query scratch.
- **Environment:** `events` owns shared driver-ID extraction/deduplication; metrics retains contact filtering/counting and observations retain distribution/order, each with separate scratch. Sensor modules retain the indexed/analytic/sampled hierarchy but lose mathematically unreachable branches and producerless internal encoding paths. Public sensor precision and output ownership are verified with existing independent oracles and differential runs.
- **Browser:** the radio feature owns scheduling transitions while the app retains radio state, driver data, and seeded RNG. Renderer modules own sprite transforms and geometry; unreachable disabled raw-renderer paths do not need replacement. Pure HTML escaping has a dependency-free UI owner, shared by templates, readouts, and the standalone placeholder. Asset recovery remains intact. Track-stroke defaults must import their existing constant owner.
- **Data/configuration:** a focused rating-scale module owns common bounds, coercion/clamping, and linear conversion; driver/vehicle classes retain stat definitions, output selection, direction policy, and exact domain-specific errors. Telemetry-module normalization belongs in config and must serve both normalized app options and raw template callers. Boundary-specific normalization with different semantics stays separate.
- **Tooling/tests/docs:** remove unused private harness paths without deleting behavior coverage. Keep intentional type-only assertions and independent numerical test oracles. Inspect showcase/demo lifecycle and use their existing smoke tests; do not replace host-specific orchestration with package internals. Historical plans remain historical, while authoritative docs are corrected alongside implementation.

## Coverage and results

The inventory contains 391 tracked/untracked files, including all existing work. Every area received reference/contract screening; depth and executable coverage are recorded separately below. Ignored local training/checkpoint/output content and generated dependency/build directories were excluded; this covers repository product and verification files, not arbitrary local artifacts. Evidence is under `/tmp/paddockjs-audit-20260908/phase2/`.

| Area | Review and disposition |
| --- | --- |
| Simulation: 108 modules | Import/export/unused-local screening throughout; feature ownership review of race/driver/vehicle/pit/rules/timing/track/replay/warmup groups. Dead adapters removed; shared rules and snapshot ownership corrected. Numerical kernels remain covered by characterization and differential checks. |
| Environment: 38 files after cleanup | Every implementation module read; action/reset/observation/vector/spec/event/metric/controller/transport boundaries checked. Shared schema and event rules consolidated; direct/rich channel ordering corrected. |
| Browser/API/rendering/UI/placeholder | All 55 original JS modules read with declarations, dynamic consumers, DOM bindings and lifecycle tests. Dead rendering and forwarding paths removed; radio and escaping have single owners. Timing-board CSS/proportions are unchanged. |
| Data/config: 19 files after cleanup | Public exports/types/defaults/assets and every implementation screened. Shared rating and telemetry normalization consolidated without changing stat definitions or coercion/error contracts. |
| Demo: 17 existing files | Five runtime lifecycle/state defects fixed with real public controller-shaped stubs and deferred mounts. Product layout, feature catalogue, host/package boundary and styles retained. |
| Engineering showcase: 26 files | Routes, Policy Runner transport, sensor display, fixtures and package imports inspected. Removed one unused placement parameter and made Vite's ESM root explicit. Distinct policy fallback semantics retained. |
| Tests: 56 files after cleanup | Compiler/import and source-coupling screen across all files; affected suites reviewed in detail. Independent numerical oracles, type assertions, slow fixtures, and boundary checks retained. Added focused behavior/failure suites; replaced radio method spies with seeded observable schedule assertions. |
| Scripts/smoke: 13 files | Gate/pack/consumer/benchmark/build ownership and cleanup inspected. Removed an uncalled preview helper and needless single-item chunking; slow tests still execute in isolated per-file batches. Existing benchmark workloads/settings retained. |
| Docs/root guidance | Authoritative docs checked against affected implementation and package contracts; ownership and stale precision statements corrected. Historical design notes, root `Q&A.md`, and the first-pass report explicitly remain historical. Link/spec checker runs in both gates. |
| Assets/dependencies/packaging/workflows | All six bundled assets have default mappings. Pixi, Vitest, TypeScript, Playwright and Changesets each have active consumers. Public exports and package file list checked against types and packed builds. No dependency upgrades or workflow changes. |
| Python example: 3 files | Transport, extension hooks, README and declared dependencies inspected. Server hooks and preview disconnect isolation are intentional example boundaries; no implementation change or external server execution claimed. |

### Verified findings and smallest coherent fixes

Package paths in the finding table are relative to `src/`; demo/tooling paths are relative to the repository root. Locations below identify functions in the saved phase-two baseline where code was removed, and current owners where code remains. The first-pass F1–F8 evidence remains in the linked historical report.

| Finding and exact evidence | Unnecessary cost and fix | Compatibility risk and verification |
| --- | --- | --- |
| `simulation/rules/penaltyLedger.js:50` spread-copied a penalty but shared nested consequences; changing returned seconds from 5 to 99 changed later live pit service. `pit/pitSnapshots.js:38` and `vehicle/vehicleSnapshots.js` shared declared crew objects. | Public result edits could mutate the state owner. Serializers now copy only supported nested arrays/records, preserving optional fields and the documented live-track exception. | Intentional contract repair; tests exercise actual normalized entries and live pit penalty service, plus two-way snapshot isolation. |
| `simulation/track/trackModel.js:212-261` froze only Map cells and carried a Map proxy, but current grids use arrays. | Obsolete representation branch left shared cells mutable across simulations. Freeze existing arrays/buckets and remove unused proxy. Keep per-runtime query scratch/stats separate. | No query math change. Test attempted mutation through shared geometry, unaffected second simulation, separate scratch/stats; repeated query/runtime benchmarks. |
| `environment/specs.js` and `observationVector.js` separately declared names/order/units/scales. Compact ray writing in `sensors/index.js` followed configured surface order while rich vectors/specs used canonical order. | New senses required duplicate metadata edits; reversed channel arrays silently mislabeled compact values. `observationSchema.js` owns metadata and canonical surface order; numeric encoding stays explicit. | Contract repair for reversed `illegalSurface`/`kerb` options. Thirty full/compact/schema/array/Float32/per-driver cases, including three reproduced failures, plus independent sense oracles. |
| `environment/observations.js` and `metrics.js` duplicated participant ID extraction/deduplication. | Changes to event ID shapes had two owners. `events.js:writeEventDriverIds` writes IDs into caller-owned scratch. Distribution and contact filtering remain distinct. | Ordering and one-contact-per-driver semantics tested through environment results; no shared mutable scratch introduced. |
| `environment/observationVector.js:96` consumed `source.rayVectorValues`, but no producer existed. `sensors/trackRays.js`, `surfaceRays.js:229,253`, `rayBandTrace.js` carried unreachable/redundant checks and sampled branches. `rayGeometry.js`, `rayGuards.js`, `indexedRayBands.js` contained unreferenced exports. | Removed producerless encoding and proven dead helpers/branches; retain active indexed, analytic and bounded sampled recovery paths. | All exports, types, tests, dynamic references and consumers checked. 82 before/after nominal cases are byte-identical; driver/debug and road/curve/pit/recovery oracles retained. No precision shortcut. |
| `app/F1SimulatorApp.js:1034 updateRadioSchedule` duplicated `app/banners/raceDataBannerController.js:updateRadioSchedule`. | Two copies of deadline/catch-up state transitions could drift. App supplies narrow state/time/drivers/enabled/RNG inputs to the existing feature owner. | Seeded random-call order, normal deadlines, long pauses, boundary times and muted behavior asserted without method spies. |
| `app/rendering/carRenderer.js:8,98` had constant-false `TEMP_RENDER_RAW_CAR_GEOMETRY`, an unreachable renderer and repeated conditions. `F1SimulatorApp.js` had uncalled render/camera/steward forwards and write-only banner state; `domBindings.js` collected unused arrays. | Removed dead code/state/dependencies with no replacement abstraction. Active sprite geometry and useful facade delegation remain. | Dynamic references, tests, types and root controller checked; renderer/component tests and Chromium flows exercise retained paths. |
| `ui/templateUtils.js`, `app/readouts/readoutFormatters.js`, `placeholder/index.js` duplicated identical escaping. | Three copies of a presentation rule. Dependency-free `ui/htmlEscaping.js` owns the exact existing mapping and coercion. | Existing escaping tests plus packed root/placeholder/data/environment boundary checks; no browser dependency enters placeholder. |
| `rendering/track/offsetStrokeSafety.js:89 traceSegmentedOffsetStroke` used an unimported `SEGMENTED_STROKE_STEP` default. | Default invocation threw before drawing. Import its existing constant owner. | Omitted-default reproduction failed before; real-track omitted versus explicit default test now passes. No material/proportion change. |
| `data/driverData.js:3-25` and `vehicleData.js:3-27` repeated rating bounds/conversion; `config/defaultOptions.js` and `ui/telemetryTemplates.js` repeated module defaults/normalization. | Focused `ratingScale.js` and `telemetryModules.js` own shared rules. Classes retain definitions/direction/error labels; templates consume resolved policy. | Eighteen normalization cases cover coercion, clamp limits, inverse vehicle direction, errors and public markup. Existing data/type/consumer suites remain. |
| `simulation/rules/rulesReview.js:21` duplicated wrapped progress; `race/classification.js` duplicated penalty-stat defaults; pit intent/state/routing repeated approach limits. | Use existing `raceDistance`, `penaltyStats`, and `pitServiceConstants` owners. No generic utility/service added. | Preserve arithmetic order, defaults and constants; race, pit, collision characterization and deterministic comparisons. |
| Definition-only `race/raceOrder.js:222 buildDrsReferenceByCarId`, `rules/collisionSteward.js:3 calculateCollisionPenalties`, `track/spatialQueries.js:131 nearestSampleGlobal`, `track/trackConstants.js:37 NEAREST_HINT_WINDOW_SAMPLES`, `vehicle/vehicleGeometry.js:241,458,463` geometry adapters and private collision/track/wheel helpers. | Remove unused adapters, old constants/templates, unused imports/locals and private parameters. Keep actively imported compatibility barrels and canonical algorithms. | Checked package exports, declarations, direct/dynamic/test/benchmark consumers before removal; all simulation tests and packed consumers verify retained surfaces. |
| `demo/src/runtime/presetShowcase.js:12,23,32 mount` allowed concurrent mounts on one root; generation checks ran too late. | Serialize root ownership, skip superseded requests, invalidate pending results on disposal. | Deferred real-shaped mount tests reproduce root collisions and late disposal; Chromium rapidly selects three presets and verifies the final ready route. |
| `demo/src/runtime/mainShowcase.js:37,45,72`, `expertLab.js:50,104,115`, `headlessLab.js:50,109` released resources only after successful initialization/run. | Owner cleans up on failure; expert disposal invalidates late mounts and failed launches allow retry. | Regressions cover failed hero start, headless step, expert loop start, retry and pending disposal. No package lifecycle API changes. |
| `demo/src/runtime/controlDeck.js:2-5,69` maintained duplicate safety/red-flag/pit/theme booleans and read nonexistent `raceControl.totalLaps`. | Read public state getters and `snapshot.totalLaps`; remove listeners on cleanup. | Reproduced Lap 2/5 with a three-lap race. Tests verify actual state-derived controls, including deployment legitimately rejected during pre-start/red flag; Chromium waits for observable green, toggles embedded controls and checks host synchronization. |
| `smoke/browser-smoke.mjs:startPreviewController` was uncalled; `scripts/run-vitest.mjs:chunk` always used size 1; two tests had unused setup/imports. | Remove private dead harness code and iterate slow files directly; no assertion or slow isolation removed. `local-preview/vite.config.js` uses explicit ESM file URL resolution. | Both gates, slow per-file batches, existing showcase build reuse and updated browser/demo smoke. Benchmark callback signatures and positional compatibility parameters remain intentional. |
| Stale tire-care/custom-field docs (first pass), current ownership prose, sampled-only driver-precision wording, historical Linear blocker. | Correct authoritative docs with source; retain invariant/numerical explanations and explicitly mark historical reports. | Docs checker and source/contract review; final Linear log contains both passes. |

### Complexity deliberately retained

- Active root track/vehicle/driver/timing/sensor/UI compatibility exports and legacy public aliases have consumers. Removing them would not simplify supported use.
- Physics-mode profiles, narrow numerical helpers, public/controller forwarding and frame/pit orchestration represent actual boundaries. Moving methods into helpers receiving the entire owner would merely relocate coupling.
- Timing rings, indexed geometry, bounded ray recovery, wheel/ray scratch, render/full/training snapshot distinctions, visibility pacing and keyed DOM rows have benchmark or behavior evidence. No new cache, pool, precision tradeoff or hot-path algorithm was introduced.
- Asset load **and texture-configuration** failures intentionally recover per asset to the white texture. Tests now characterize both; changing the failure policy would violate the requested behavior preservation. Host callback containment, optional warmup, controller cancellation and external-renderer error isolation remain intentional.
- Reward/legal-surface rules, DNF race-order versus interaction participation, driver versus ray heading normalization, and Policy Runner model math have different semantics despite similar code. They remain separate.
- Unused positional callback parameters and type-only assertion bindings are intentional. Large files, cohesive benchmark fixtures, slow characterization setup and source-level module-boundary assertions were not removed merely for size or line-count targets.
- Cached private typed index buffers remain shared and immutable by convention; arbitrary mutation of private internal buffers is unsupported. Public nested snapshots are isolated, while the documented in-memory track reference remains live.

### Verification and measurements

Both final gates passed end to end. Initial `npm run check` had no failures: 846 fast tests passed with 78 intentional slow skips. The first pass ended with 878 fast / 956 exhaustive tests passing. The final results are:

| Verification | Result |
| --- | --- |
| `npm run check` | Passed: 947 tests across 53 files, 78 intentional slow skips; docs, public types, dry pack, packed-consumer install/build, subpath bundle boundaries, showcase/demo builds, quick Chromium and demo smoke. |
| `npm run check:release` | Passed: all 1,025 tests across 53 isolated files, no skips; all packaging/build gates and full Chromium matrix plus demo smoke. |
| Browser workloads | Desktop, 464px narrow, 390px/320px mobile, tablet, short-wide, timing breakpoints, loading, components, customization, API, playable expert, Policy Runner, race behavior, stewarding, collision lab; demo rapid presets, embedded-control synchronization, expert/headless/search/mobile. |
| Packed boundaries | Root 1,033.5 kB JS; placeholder 2.0 kB JS, no assets; data 99.1 kB JS, no CSS/assets; environment 353.9 kB JS, no CSS/assets. All existing budgets passed. |
| Deterministic differential | Original baseline versus final: exact serialized full/vector/object reset, 60 steps per mode, and getState with seeds 71/2097 and frameSkip 4. SHA-256 `4ea290b6504cfe3b4903de58baab9e2eb32ff979255a393628e00ee28eb4b06d`. |
| Sensor differential | 82 nominal before/after driver/debug, normal/batch, road/curve/pit/recovery cases byte-identical. Reversed channel ordering is separately verified as an intentional contract correction. |
| Independent integration review | No actionable issue found in schema/event/rating/telemetry changes; 51 focused tests passed. |
| Static and preservation checks | Missing-name scan clean; remaining unused diagnostic bindings are intentional positional callbacks/type assertions. Diff whitespace check passed. No original file deleted; manifests, locks, public entry files/declarations, package CSS and benchmark harness unchanged. |

Raw gate logs are `final-check.log` and `final-release.log` in the phase-two evidence directory. The initially failing smoke and its correction are preserved in `check-before-smoke-correction.log`. Python example syntax was checked without running a policy server. No portfolio integration files were changed, so no portfolio install/update gate was needed.

### Performance results, separate from structural cleanup

The unchanged standard runtime harness ran three initial baselines before edits, followed by six paired baseline/final repetitions across all 22 workloads. Pairs 1–3 ran baseline then final; pairs 4–6 reversed the order because initial sub-millisecond results were noisy. All runs used the same existing seeds, operation counts, profile/settings, Node v24.13.0, darwin arm64 / Darwin 27.0.0, Apple M4 Pro, and installed dependencies. Package gates and browser workloads were stopped before measurement. Saved baseline source was loaded through a dependency symlink; no Git worktree or checkout was created.

All benchmark verification invariants passed. Every before/after range overlaps across the six pairs. Some medians move in either direction, but these measurements do not establish a general speedup or justify additional hot-path complexity. No new optimization, cache, pool, or sensor precision change was introduced. Browser workloads establish behavior and layout; no browser FPS or latency improvement is claimed.

| Workload | Before median [min, max] ms/op | After median [min, max] ms/op |
| --- | ---: | ---: |
| simulation.step advanced field | 0.032801 [0.031272, 0.033599] | 0.032442 [0.031833, 0.033704] |
| simulation phase profile | 0.357059 [0.349806, 0.370971] | 0.355280 [0.349018, 0.358573] |
| timing history and line maintenance | 0.000127 [0.000122, 0.000135] | 0.000126 [0.000119, 0.000170] |
| timing-line gap without stored crossings | 0.000054 [0.000052, 0.000055] | 0.000054 [0.000052, 0.000072] |
| lap telemetry in-progress sync | 0.000145 [0.000144, 0.000154] | 0.000148 [0.000143, 0.000163] |
| pit route transition geometry | 0.000588 [0.000580, 0.000596] | 0.000605 [0.000569, 0.000623] |
| collision candidate and narrowphase | 0.014253 [0.013958, 0.014692] | 0.014490 [0.014137, 0.016212] |
| nearest track query index | 0.002214 [0.002175, 0.002272] | 0.002259 [0.002206, 0.002336] |
| sensor ray road and surface channels | 0.032233 [0.030728, 0.032894] | 0.032314 [0.030969, 0.034062] |
| batch-training sensor surface channels | 0.016790 [0.014976, 0.017522] | 0.016528 [0.015295, 0.017793] |
| sensor ray barrier illegal-surface validation | 0.044455 [0.041261, 0.045982] | 0.039740 [0.038388, 0.044068] |
| sensor ray barrier off-track recovery | 0.057815 [0.054281, 0.065055] | 0.057022 [0.053003, 0.061740] |
| sensor ray pit-lane direct boundary | 0.014588 [0.013090, 0.019442] | 0.015052 [0.013519, 0.018638] |
| wheel surface near pit connector | 0.013048 [0.012234, 0.014348] | 0.012633 [0.011986, 0.015194] |
| wheel surface connector local-refresh path | 0.003137 [0.002559, 0.003902] | 0.003449 [0.002298, 0.004560] |
| wheel surface main-track analytic | 0.001910 [0.001775, 0.002772] | 0.002159 [0.001801, 0.002632] |
| headless environment vector step | 0.052542 [0.050919, 0.055145] | 0.051610 [0.051316, 0.052461] |
| snapshot construction | 0.018148 [0.017784, 0.021723] | 0.018441 [0.018166, 0.019232] |
| snapshot JSON serialization | 0.236370 [0.232869, 0.248784] | 0.236371 [0.231430, 0.240804] |
| policy server compact JSON transport | 0.055986 [0.054528, 0.061248] | 0.056397 [0.054168, 0.060892] |
| render snapshot interpolation | 0.000588 [0.000564, 0.000697] | 0.000636 [0.000575, 0.000672] |
| timing tower row markup | 0.003828 [0.003767, 0.004122] | 0.003908 [0.003659, 0.004013] |

Raw results are `paired-before-1.json` through `paired-before-6.json` and their `paired-after-*` counterparts. The first-pass measurements remain in the historical audit report.



Linear work log: [2026-09-08 repository cleanup audit](https://linear.app/mgiorgetti/document/2026-09-08-repository-cleanup-audit-14d678a1a82c).

### Pre-existing findings outside the cleanup changes

The original package gate had no failures. Vite's existing large-chunk warnings remain; bundle-boundary budgets pass and chunk-size warnings alone do not justify a redesign. A read-only npm dependency audit found five root advisories (four high, one moderate), two high advisories each in demo/showcase dependency trees, and one moderate production-only advisory (`@xmldom/xmldom`). The root high advisories name `js-yaml`, `nanoid`, `postcss`, and `vite`; demo/showcase name `nanoid` and `postcss`. All three manifests and lockfiles are byte-identical to the user's original tree. No `npm audit fix` or dependency upgrade was run, as unrelated upgrades were explicitly excluded. Remediation should be a separate focused dependency change with its own verification; the repository is not being claimed dependency-advisory-free.

The first integrated demo smoke failure was diagnosed during cleanup: its old assertion assumed safety-car deployment during pre-start, while the simulator intentionally rejects that command. The old shadow boolean concealed rejection. The smoke now waits for the actual green readout; real-simulation tests preserve rejected-command behavior. No production assertion or race rule was weakened.

### Cumulative changed-file inventory

Compared with the saved original user tree (not with HEAD):

**Existing files edited**

- `Q&A.md`
- `demo/src/runtime/controlDeck.js`
- `demo/src/runtime/expertLab.js`
- `demo/src/runtime/headlessLab.js`
- `demo/src/runtime/mainShowcase.js`
- `demo/src/runtime/presetShowcase.js`
- `docs/architecture.md`
- `docs/data_contract.md`
- `docs/data_model.md`
- `docs/rules.md`
- `docs/sense_contract.md`
- `local-preview/src/main.js`
- `local-preview/vite.config.js`
- `scripts/run-vitest.mjs`
- `smoke/browser-smoke.mjs`
- `smoke/demo-smoke.mjs`
- `src/__tests__/championship.test.js`
- `src/__tests__/componentApi.test.js`
- `src/__tests__/proceduralTrackAsset.test.js`
- `src/__tests__/raceSimulation.test.js`
- `src/__tests__/timingHistory.test.js`
- `src/app/BrowserExpertAdapter.js`
- `src/app/F1SimulatorApp.js`
- `src/app/camera/cameraController.js`
- `src/app/domBindings.js`
- `src/app/readouts/readoutFormatters.js`
- `src/app/readouts/telemetryRenderer.js`
- `src/app/rendering/appAssets.js`
- `src/app/rendering/carRenderer.js`
- `src/config/defaultOptions.js`
- `src/config/themeOptions.js`
- `src/config/timingGapMode.js`
- `src/data/championship.js`
- `src/data/driverData.js`
- `src/data/vehicleData.js`
- `src/environment/actions.js`
- `src/environment/events.js`
- `src/environment/metrics.js`
- `src/environment/observationVector.js`
- `src/environment/observations.js`
- `src/environment/options.js`
- `src/environment/runtime.js`
- `src/environment/sensors/index.js`
- `src/environment/sensors/indexedRayBands.js`
- `src/environment/sensors/rayBandTrace.js`
- `src/environment/sensors/rayGeometry.js`
- `src/environment/sensors/rayGuards.js`
- `src/environment/sensors/surfaceRays.js`
- `src/environment/sensors/trackRays.js`
- `src/environment/specs.js`
- `src/placeholder/index.js`
- `src/rendering/track/offsetStrokeSafety.js`
- `src/rendering/track/trackMaterialRenderer.js`
- `src/rendering/track/trackRenderConstants.js`
- `src/simulation/collisionGeometry.js`
- `src/simulation/driver/edgeRecovery.js`
- `src/simulation/driver/racingControls.js`
- `src/simulation/driver/racingLinePlan.js`
- `src/simulation/driver/rejoinControls.js`
- `src/simulation/driver/trafficScan.js`
- `src/simulation/pit/pitFlow.js`
- `src/simulation/pit/pitIntent.js`
- `src/simulation/pit/pitOccupancy.js`
- `src/simulation/pit/pitRouting.js`
- `src/simulation/pit/pitServiceConstants.js`
- `src/simulation/pit/pitSnapshots.js`
- `src/simulation/pit/pitState.js`
- `src/simulation/race/classification.js`
- `src/simulation/race/raceOrder.js`
- `src/simulation/raceSimulation.js`
- `src/simulation/rules/collisionSteward.js`
- `src/simulation/rules/penaltyLedger.js`
- `src/simulation/rules/rulesReview.js`
- `src/simulation/snapshots/raceSnapshots.js`
- `src/simulation/track/pitLaneAccess.js`
- `src/simulation/track/pitLaneState.js`
- `src/simulation/track/spatialQueries.js`
- `src/simulation/track/trackConstants.js`
- `src/simulation/track/trackMath.js`
- `src/simulation/track/trackModel.js`
- `src/simulation/vehicle/mainTrackWheelSurface.js`
- `src/simulation/vehicle/pitWheelSurface.js`
- `src/simulation/vehicle/vehicleGeometry.js`
- `src/simulation/vehicle/vehiclePhysics.js`
- `src/simulation/vehicle/vehicleSnapshots.js`
- `src/simulation/vehicle/wheelSurface.js`
- `src/ui/telemetryTemplates.js`
- `src/ui/templateUtils.js`

**New files added**

- `docs/cleanup_coverage.md`
- `docs/maintainability_audit_2026-09-08.md`
- `src/__tests__/appAssets.test.js`
- `src/__tests__/configurationNormalization.test.js`
- `src/__tests__/demoLifecycle.test.js`
- `src/__tests__/environmentEventOwnership.test.js`
- `src/__tests__/environmentObservationSchema.test.js`
- `src/__tests__/environmentParticipants.test.js`
- `src/__tests__/environmentPitActions.test.js`
- `src/__tests__/pitSnapshots.test.js`
- `src/__tests__/simulationSnapshotOwnership.test.js`
- `src/config/telemetryModules.js`
- `src/data/ratingScale.js`
- `src/environment/observationSchema.js`
- `src/ui/htmlEscaping.js`

### Final preservation and Git handoff

The original tree contained 376 files with substantial ongoing work. Across both passes, 288 original files remain byte-identical, 88 existing files have intentional cleanup edits, 15 files were added, and no original file was removed. The external original and phase-two baselines, manifests and cumulative `audit-only.patch` preserve review evidence independently of Git. This comparison separates this task from pre-existing edits; it does not claim those earlier edits were committed.

Current read-only Git state: branch `v11`, HEAD `fedff4e`, tracking the locally recorded `origin/v11` with 0 ahead / 0 behind. Remote freshness is unknown because no fetch was authorized or run. The index is empty. There are 116 modified tracked paths and 26 untracked status entries (directories count as one status entry). The working tree remains dirty intentionally, including all original ongoing work. No Git or GitHub mutation was performed.

Proposed next steps are to review the cumulative audit-only diff and select the exact cleanup hunks to carry forward. Any staging, branch creation, commit, fetch, push or PR action remains subject to AGENTS.md's exact command/target/risk approval gate. No such action is being executed as part of cleanup completion.

## Follow-up: demo physics configuration

After the cleanup, manual use exposed excessive automatic-demo retirements. All six exact demo configurations forced advanced physics. At 180 simulated seconds, five races had 10/10 DNFs and the sixth 5/10, all `stalled-off-track` under the five-second cutoff. Their checkpoint snapshots matched the original pre-cleanup source exactly. With arcade and otherwise identical settings, every field had zero DNFs over that interval. Earlier single-car advanced survival tests and short browser smoke did not establish healthy full-field demo races.

The user confirmed arcade should remain the general default and advanced should be a separate section for later rework. Shared automatic-demo options and the neutral headless example now select arcade. The existing expert chapter/anchor is retained and labeled Advanced physics; its keyboard/sensor runtime remains an explicit, lazy advanced opt-in with a visible limitation note. No package physics, AI tuning, mode normalization or public API was changed. New regressions exercise actual demo settings and six ten-car fields for 180 simulated seconds; this is bounded survival coverage, not a guarantee of zero incidents over every complete race.


### Mode-correction verification status

The targeted demo physics and lifecycle suite passed 23/23 tests, including six 180-second full-field cases. Documentation validation, public types, demo feature coverage (54 records / 78 API symbols / seven chapters), and the rebuilt demo also passed. These checks establish the requested mode selection and bounded simulation behavior; they do not establish a fully passing browser session.

The subsequent `npm run check` was interrupted after existing tests became unusually slow and reported failures; it did not complete. `npm run check:release` passed the new demo cases again, then stopped on two existing environment test timeouts: the generated no-pit profile exceeded 20 seconds and canonical indexed-ray determinism exceeded 60 seconds. The host reported memory pressure level 2 and roughly 10 GB of swap use. An isolated unchanged physics-mode suite passed on retry. Resource pressure is a likely contributor, but these results must not be presented as a green full gate.

The rebuilt demo responds at the running local preview, with arcade and Advanced physics copy in place. Its standalone browser smoke timed out waiting for the race to reach green. Diagnostic browser runs showed very low page animation throughput, while a blank page animated normally; no application exception was reported. The source review did not establish a ticker or lifecycle regression. Browser playback verification remains open. Test assertions, production timing and physics/AI parameters were not weakened to bypass these failures.

No performance optimization was made in this follow-up. The 55/60 advanced versus 0/60 arcade retirement comparison is behavior diagnosis under fixed simulation settings, not a performance benchmark. Remaining work is to obtain passing full gates and browser playback verification, then address advanced physics and AI recovery in the separately requested future rework.


Packed-consumer installation/build, subpath bundle-boundary verification, and dry-pack verification passed independently after the full-gate failure. A diagnostic browser-only replacement restoring the old advanced demo mode also remained at pre-start with no FPS reading before the diagnostic deadline; the browser stall is not specific to the arcade selection. This does not resolve its underlying cause.

At mode-correction handoff, read-only Git inspection still shows `v11` at `fedff4e`, empty index, 116 modified tracked paths and 27 untracked status entries. The locally recorded upstream comparison is 0 ahead / 0 behind; no fetch was performed. Preserve the ongoing dirty work and review the bounded demo changes before proposing any exact, separately approved Git/GitHub action.


Files changed for the mode correction: `demo/src/data/demoOptions.js`, `demo/src/runtime/headlessLab.js`, `demo/src/runtime/expertLab.js`, `demo/src/data/featureCatalog.js`, `demo/index.html`, `demo/README.md`, `smoke/demo-smoke.mjs`, `src/__tests__/demoLifecycle.test.js`, `src/__tests__/demoPhysics.test.js` (new), `docs/architecture.md`, `docs/system_specs.md`, and this report.
