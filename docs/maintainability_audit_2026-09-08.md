# Maintainability audit — 2026-09-08

This records the initial pass and its original evidence. The subsequent repository-wide review, resolved follow-ups, final verification, and current Linear status are in [cleanup coverage](cleanup_coverage.md). Counts, locations, and deferred decisions below describe that earlier baseline.

## Scope and baseline

This is a bounded audit of package entry points, data/configuration, environment input boundaries, pit and vehicle snapshot assembly, runtime/readout loops, sensor infrastructure, selected tests, and documentation. It is not a claim that every module is clean. Existing product behavior, supported exports, sensor precision, snapshot ownership, deterministic stepping, lifecycle recovery, and timing-board sizing must remain unchanged.

Initial checkout: `v11` at `fedff4e`, tracking the locally recorded `origin/v11` at the same commit. No fetch was performed. There were 55 modified tracked files and 11 untracked top-level status entries, including substantial ongoing runtime, sensor, API, test, documentation, and demo work. The initial contents of 376 tracked/untracked files, their SHA-256 hashes, status, and binary Git diff were saved outside the repository in `/tmp/paddockjs-audit-20260908/` before any edits. Changes described here are relative to that working-tree baseline, not relative to HEAD.

Baseline `npm run check`: **passed**, including 44 fast test files, 846 passing tests and 78 intentionally skipped tests, public types, dry pack, packed consumer install/build and subpath bundle boundaries, showcase/demo builds, quick Chromium smoke, and desktop/mobile demo smoke. Existing build warnings about large chunks were present; no baseline gate failure was observed. Baseline log: `/tmp/paddockjs-audit-20260908/baseline-check.log`.

## Checkable plan

- [x] Preserve the initial file contents and inspect read-only Git state.
- [x] Read supported exports, architecture, contracts, and verification commands; run the baseline gate.
- [x] Audit candidate defects and check internal, dynamic, type, documentation, and local portfolio consumer references.
- [x] Define bounded fixes and ownership before implementation (below).
- [x] Collect three standard runtime benchmark runs before implementation.
- [x] Apply dead-code and stale-documentation cleanup first.
- [x] Consolidate pit-intent policy, pit snapshot ownership, and participant validation.
- [x] Add meaningful boundary and snapshot ownership characterization; keep existing assertions.
- [x] Run final `npm run check` and `npm run check:release`.
- [x] Repeat the same standard runtime benchmark three times and report noise separately from cleanup; additionally alternate three baseline/current pairs to control for observed timing drift.
- [x] Log task, solution, verification, and remaining concerns in the PaddockJS Linear project (completed during the continuation).
- [x] Compare final files against the saved baseline and report read-only Git status.

## Verified findings selected for cleanup

Locations in this section refer to the saved pre-edit baseline. Each finding was checked as a hypothesis before selection.

| ID | Exact evidence and unnecessary cost | Smallest coherent fix | Compatibility risk and verification |
| --- | --- | --- | --- |
| F1 | `src/config/themeOptions.js:370-383`: `deriveDarkColor`, `deriveLightColor`, and `resolveModePair` forward fixed primary-token arguments to existing implementations. No code, dynamic import, type, supported export, documentation, or local portfolio source consumer references them. Three unused internal exports suggest alternate theme APIs without providing a boundary. | Remove the three wrappers; retain active token derivation and every supported theme alias. | Unsupported source imports outside the audited workspace cannot be disproved. Public types, theme tests, packed consumers, and browser checks cover supported usage. |
| F2 | `src/data/championship.js:243` builds `CHAMPIONSHIP_PROJECT_DRIVERS` eagerly; only `src/__tests__/championship.test.js:5,16-29,89` reads it. Package exports and declarations do not expose it. Production import initialization owns a fixture it never uses. | Construct the default grid in the test file and remove the internal fixture export. Keep the default builder and entry data unchanged. | Preserve all existing championship assertions and verify data subpath consumers. This removes unused initialization; no startup speed claim is made. |
| F3 | `src/simulation/raceSimulation.js:392-394` exposes `vehicleSnapshotDependencies()` with no callers. Actual snapshot functions call their factory directly. Neither the class nor this method is a supported export. | Remove the unused facade method and its otherwise unused factory import. | Check all snapshot variants and packed consumers. Do not remove the factory used by snapshot assembly. |
| F4 | `src/simulation/pit/pitFlow.js:4` imports `normalizePitIntent` without reading it. | Remove that binding only. | No changed execution; package gate verifies module loading. |
| F5 | `src/environment/actions.js:56-60` duplicates the exact numeric conversion and integer range `0..2` from `src/simulation/pit/pitIntent.js:16-20`. Two owners can drift. | Use the canonical pit normalizer and test for `!= null`, retaining valid zero. | Preserve coercion, omitted-field handling, compound validation, strict/report errors, and their ordering. Exercise accepted/coerced/rejected inputs through `resolveActionMap`. |
| F6 | `src/simulation/pit/pitSnapshots.js:16,50` requests a normalizer and default constant as injected arguments; its only callers at `src/simulation/snapshots/raceSnapshots.js:41-46` always pass identical pit-owned values through closures. The assembly layer must know and repeat pit policy. | Import the existing policy in pit snapshots and pass the serializers directly from race assembly. | Preserve full/observation/render/training shapes, null/nonfinite defaults, and copied mutable arrays/profile objects. Verify through real simulation snapshots. |
| F7 | `src/environment/options.js:62-68` creates a second participant ID set and checks membership already proved by `resolveScenario` at `132-136`. `all` and `controlled-only` include already validated controlled IDs by construction at `145-148`. | Remove the second set and loop; retain the earlier validation owner. | Test all participant modes, duplicate IDs, unknown IDs, missing controlled IDs, and error precedence. No stricter input rules or changed defaults. |
| F8 | `docs/data_model.md:97` calls `tireCare` reserved, but both vehicle integrators divide wear by it at `src/simulation/vehicle/vehiclePhysics.js:196-197,375-377`. Constructor-output examples at `53-66,99-113` omit current `customFields`. | Correct the active behavior description and output examples. | Documentation only; compare with implementations and run the docs checker. |

## Ownership and data flow before refactoring

F1–F4 remove paths without a runtime owner or caller; no replacement abstraction is needed. Championship tests own their fixture, while the public builder continues to own normalization.

For F5, `pitIntent.js` owns numeric pit intent values and coercion. `actions.js` owns external action presence, driver identity, required controls, compound shape, and strict/report error handling. Input is an optional action field; output is a normalized intent or the existing error. Simulation receives the same numeric value or intent/compound object. Invalid integer range and nonfinite inputs remain failures; coercible zero remains valid. No simulation or app object crosses this boundary.

For F6, pit snapshot serializers own pit field selection, fallback values, and copies of mutable pit state. Their sole input is a pit-stop state object; their output is the requested public pit snapshot variant. They depend on the existing pit normalizer/default and finite-number serializer. Race snapshot assembly owns selecting cars and constructing the overall snapshot, and vehicle serializers continue selecting the pit snapshot variant. Existing broader vehicle dependency injection is retained in this bounded change; no new dependency cycle or generic service is introduced. Missing pit state remains `null`; nonfinite service values remain `null`; returned penalty ID arrays and top-level profile objects must not alias live pit state. Existing nested pit-crew metadata is shared; this cleanup does not change that ownership.

For F7, the environment option boundary validates controlled driver IDs first, then scenario membership/placements, then filters normalized drivers. `resolveScenario` is the only owner of explicit participant-list membership validation. The return shape and validation order remain unchanged. Default participant modes require no second validation because their construction proves membership.

## Findings retained or deferred

- **Dependencies:** all declared dependencies have identifiable runtime, verification, or release consumers. No unused dependency was established; no upgrades are proposed.
- **Compatibility paths:** track, vehicle, driver, sensor, and UI barrels still have active imports. Their small size is not evidence of a defect. Supported legacy theme aliases remain contracts.
- **Shared rating conversion:** `src/data/driverData.js:3-25` and `src/data/vehicleData.js:3-27` duplicate rating limits and conversion. A focused rating-scale owner is plausible, but vehicle direction and domain-specific error strings must remain distinct. Maintenance cost is modest, so defer instead of expanding this change. Verify coercion, clamping, defaults, nonfinite input, and inverse direction before consolidation.
- **Asset error scope:** `src/app/rendering/appAssets.js:3-10` catches both asset loading and texture configuration failures. Returning `Texture.WHITE` intentionally recovers from missing assets, but also hides configuration faults. Separating those failure modes would change initialization behavior; characterize both and obtain a behavior decision before changing it.
- **Intentional error containment:** environment external-renderer callbacks, host lifecycle callbacks, controller-loop scheduling, and external-renderer state reporting provide deliberate failure boundaries. Their catches are not removed. Warmup is best effort and its failure path preserves normal execution.
- **Nested snapshot ownership:** `src/simulation/pit/pitSnapshots.js:37` shallow-copies `serviceProfile`, while `src/simulation/pit/pitServiceProfile.js:20` includes a nested `pitCrew` object. The snapshot therefore retains that nested reference. Tests exercise a real generated service profile and verify top-level isolation only. Clarify the intended nested ownership contract before adding deeper cloning; no snapshot ownership change is bundled here.
- **Whole-runtime dependencies:** `src/app/runtime/frameLoop.js:12` and pit orchestration consume broad mutable owners. Moving their methods into helpers with the same app/simulation object would not reduce coupling. The pit snapshot adapters are a smaller demonstrated ownership problem that can be corrected now.
- **Tests:** `src/__tests__/componentApi.test.js:1611-1617,1864-1870,2059-2068` includes source-text assertions coupled to spelling, but they guard documented module boundaries. Replacing them requires equivalent import-graph or behavior checks; deleting them would remove coverage. Large test files alone do not justify splitting.
- **Documentation:** architecture and sensor contract passages repeat detailed hot-path information, but distinguish ownership from externally observable precision. No broad prose rewrite is justified without checking every corresponding claim. Historical design plans are not authoritative runtime contracts.

## Performance audit and measurement protocol

Inspect existing runtime benchmarks across simulation phases, pit routing, collision, track queries, road/surface/recovery rays, wheel surfaces, environment stepping, snapshots/JSON, policy JSON, render interpolation, and DOM readouts. Run `node scripts/benchmark-runtime-efficiency.mjs --profile=standard --verify --json` three times before and three times after, sequentially without concurrent package gates. Keep the existing benchmark code, seeds, settings, and operation counts identical. Record raw JSON under `/tmp/paddockjs-audit-20260908/{before,after}-{1,2,3}.json`.

Environment: Node `v24.13.0`, arm64 macOS `27.0` build `26A5421a`. Wall-clock timings include normal local-machine noise and fixture setup. Compare per-operation medians and ranges; retain deterministic counters/checks. These runs characterize structural cleanup, not a controlled claim about a specific optimization.

Representative browser workloads are the existing quick/full showcase smoke matrix and product demo smoke, covering mounted/composable lifecycle, expert/headless flows, readouts, presets, and desktop/mobile sizing. They verify behavior rather than establish browser latency gains. The benchmark DOM workload uses a test DOM, so do not describe its timings as real-browser rendering performance.

Hot-path decisions: retain frame pacing, throttled DOM updates, separate render/full snapshots, sensor scratch reuse, track query indexing, precision-aware ray fallback, and timing-row reconciliation. The frame loop at `src/app/runtime/frameLoop.js:43-68` already avoids most full snapshots; `src/app/readouts/timingTowerRenderer.js` reuses row DOM. Repeated overview key construction in `src/app/readouts/carOverviewRenderer.js:61-84` is a candidate only if a real-browser profile identifies it as material. No new cache, pooling, precision change, or algorithmic optimization is planned.

## Results and work log

F1–F8 are implemented. The audit added 32 characterization tests for action coercion/errors, participant modes/error precedence, and real simulation snapshot fields/copy ownership. They pass against the original implementation and the cleanup; the real generated-service-profile fixture was also checked independently against both trees. Existing championship assertions remain intact. Independent review of the input/pit/snapshot delta found no actionable issue.

Verification:

- Baseline `npm run check`: passed (846 tests; 78 intentionally skipped).
- Final `npm run check`: passed (878 tests; 78 intentionally skipped).
- `npm run check:release`: passed (956 tests across 47 test batches, public types, dry pack, packed consumer build/subpath boundaries, showcase/demo builds, full Chromium showcase matrix and demo smoke).
- Full browser matrix: loading overlays, desktop/mobile/tablet and timing breakpoints, composable components, customization, API, playable, Policy Runner, behavior, stewarding, and collision lab passed. Demo desktop/mobile runtime, public surfaces, presets, expert/headless, and search passed.
- Exact serialized environment output matches between the saved baseline and current source for seed `71`, track seed `2097`, full/vector/object observation modes, reset, 60 steps per mode with frame skip 4, and final state. Combined SHA-256: `4ea290b6504cfe3b4903de58baab9e2eb32ff979255a393628e00ee28eb4b06d`.
- `git diff --check`: passed. No pre-existing gate failures were found. Existing chunk-size build warnings remain.

Logs and comparison scripts are in `/tmp/paddockjs-audit-20260908/`; these are local temporary evidence, not published assets. `audit-only.patch` isolates this task from the larger uncommitted tree. The exhaustive gate was run because the cleanup crosses environment and simulation snapshot boundaries; no portfolio integration source was changed.

### Measurement result

The first consecutive before/after groups suggested a roughly one-third speedup even in untouched algorithms. That was not credible evidence of a cleanup benefit. The measurement plan was revised to alternate the preserved baseline and current source in fresh Node processes, using the same installed dependencies without creating a Git worktree or changing either benchmark harness. Three pairs ran after the gates finished. Simulation uses seed `71` and the benchmark's explicit canonical `TRACK`; environment settings and operation counts are unchanged.

All 22 workload identities, operation counts, and non-timing checks match across the six paired runs. Before/after ranges overlap for every workload. No material performance gain is established, and no hot-path optimization was introduced. The table reports milliseconds per benchmark-defined operation; the DOM workload is synthetic, not browser paint latency. Browser smoke supplies behavior evidence only.

| Workload | Before median [min, max] ms/op | After median [min, max] ms/op |
| --- | ---: | ---: |
| simulation.step advanced field | 0.032442 [0.031945, 0.034029] | 0.031913 [0.031660, 0.033126] |
| simulation phase profile | 0.355519 [0.351087, 0.357263] | 0.350887 [0.348334, 0.355748] |
| timing history and line maintenance | 0.000122 [0.000121, 0.000128] | 0.000122 [0.000117, 0.000129] |
| timing-line gap without stored crossings | 0.000054 [0.000054, 0.000055] | 0.000057 [0.000054, 0.000061] |
| lap telemetry in-progress sync | 0.000153 [0.000148, 0.000164] | 0.000154 [0.000154, 0.000155] |
| pit route transition geometry | 0.000600 [0.000590, 0.000645] | 0.000613 [0.000612, 0.000621] |
| collision candidate and narrowphase | 0.014346 [0.014100, 0.014780] | 0.014325 [0.014252, 0.014630] |
| nearest track query index | 0.002226 [0.002203, 0.002256] | 0.002278 [0.002214, 0.002325] |
| sensor ray road and surface channels | 0.032712 [0.032159, 0.033753] | 0.032801 [0.032604, 0.035977] |
| batch-training sensor surface channels | 0.016548 [0.016198, 0.017499] | 0.016499 [0.015432, 0.022635] |
| sensor ray barrier illegal-surface validation | 0.042978 [0.042229, 0.044926] | 0.040824 [0.040024, 0.042457] |
| sensor ray barrier off-track recovery | 0.056817 [0.054710, 0.057457] | 0.053189 [0.052965, 0.059095] |
| sensor ray pit-lane direct boundary | 0.014867 [0.013823, 0.018707] | 0.014279 [0.013579, 0.015012] |
| wheel surface near pit connector | 0.012874 [0.012743, 0.013432] | 0.012937 [0.012330, 0.014278] |
| wheel surface connector local-refresh path | 0.003203 [0.002642, 0.003578] | 0.002867 [0.002862, 0.003264] |
| wheel surface main-track analytic | 0.002045 [0.001932, 0.002120] | 0.002089 [0.001967, 0.002196] |
| headless environment vector step | 0.051907 [0.050513, 0.087385] | 0.050693 [0.050625, 0.051605] |
| snapshot construction | 0.018195 [0.017968, 0.018811] | 0.018014 [0.017356, 0.018649] |
| snapshot JSON serialization | 0.231152 [0.230037, 0.235442] | 0.234313 [0.231366, 0.235079] |
| policy server compact JSON transport | 0.056871 [0.056494, 0.059002] | 0.057974 [0.054731, 0.058445] |
| render snapshot interpolation | 0.000570 [0.000563, 0.000624] | 0.000626 [0.000610, 0.000678] |
| timing tower row markup | 0.003913 [0.003845, 0.004045] | 0.003741 [0.003425, 0.004084] |

Raw paired results: `/tmp/paddockjs-audit-20260908/paired-{before,after}-{1,2,3}.json`. The initial six results are retained separately as `before-*.json` and `after-*.json` so the timing drift is auditable.

### Changed file inventory

This task changed 11 existing files:

- `src/config/themeOptions.js`: remove unused internal theme wrappers.
- `src/data/championship.js`, `src/__tests__/championship.test.js`: relocate the test-only default grid fixture.
- `src/environment/actions.js`: consume canonical pit-intent normalization.
- `src/environment/options.js`: remove redundant participant validation.
- `src/simulation/pit/pitFlow.js`: remove unused import.
- `src/simulation/pit/pitSnapshots.js`, `src/simulation/snapshots/raceSnapshots.js`: put pit serialization policy in the pit module and remove fixed adapters.
- `src/simulation/raceSimulation.js`: remove unused snapshot dependency facade method.
- `docs/architecture.md`, `docs/data_model.md`: document actual ownership and data behavior.

Four files were added: this report and `src/__tests__/environmentPitActions.test.js`, `src/__tests__/environmentParticipants.test.js`, and `src/__tests__/pitSnapshots.test.js`.

Preservation check: 365 of the 376 baseline files remain byte-identical. The other 11 were reviewed against the saved contents; existing edits in the three overlapping dirty files (`themeOptions.js`, `options.js`, and `architecture.md`) were preserved. Initial untracked work, package exports/types, dependency versions, benchmark harnesses, and browser implementation remain unchanged by this task.

Read-only final Git state: branch `v11`, HEAD `fedff4e`, locally recorded upstream `origin/v11`, ahead/behind `0/0` without fetching. There are 63 modified tracked files, 15 untracked status entries (including pre-existing directory entries), and no staged changes. No Git/GitHub mutation was performed. Proposed next step is review of the audit-only diff; any later staging, commit, branch, or push requires separate approval of exact commands and targets.

### Initial Linear logging blocker (resolved)

The required Linear work log could not be posted. The official connector returned `UNAUTHORIZED` / reauthentication required; the prescribed `mcp-remote` route opened authorization and waited for sign-in before timing out. A reauthentication request was sent to the user during local work. The task summary, implementation rationale, verification, and remaining concerns are preserved here and in `/tmp/paddockjs-audit-20260908/linear-work-log.md`, ready to log in the PaddockJS project once authentication is restored. No Linear write is claimed.

Authentication was restored during the continuation. Both passes are logged in the [PaddockJS audit document](https://linear.app/mgiorgetti/document/2026-09-08-repository-cleanup-audit-14d678a1a82c). Shared ratings and nested snapshot ownership were resolved, asset recovery was characterized and retained, and repository-wide dispositions are recorded in the current coverage report.
