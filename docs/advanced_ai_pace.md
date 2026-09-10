# Advanced AI pace improvement

This records the first September 9 improvement. The subsequent [both-mode racing AI report](racing_ai_improvements.md) uses this implementation as its baseline.

## Goal and boundaries

Improve the built-in advanced driver through measurable lap-time gains under unchanged vehicle physics. Arcade remains the default. This is not a claim of globally optimal driving or a change to model-facing observations/actions. Preserve traffic, recovery, safety-car, pit and deterministic replay contracts.

## Checkable plan

- [x] Inspect current Git and advanced controller; preserve all existing work in place.
- [x] Run baseline `npm run check` and record any pre-existing failures.
- [x] Measure identical single-car stints across development and held-out track seeds, plus complete representative demo fields. Record lap times, off-road time, DNFs and repeat hashes.
- [x] Diagnose pace losses and compare bounded controller candidates without changing physics.
- [x] Integrate the smallest coherent improvement, add behavioral regression coverage and update authoritative docs.
- [x] Run `npm run check`, `npm run check:release`, browser flows and paired runtime benchmarks.
- [x] Log results in Linear and report read-only Git status and proposed next steps.

## Ownership before implementation

`advancedRacingControls` owns race pace and traffic-aware target selection, reading track geometry and existing lane plans. `advancedPathControls` owns physical steering/longitudinal action conversion and is shared with recovery/safety-car driving, so racing-only changes must remain explicit. The vehicle modules own tire, force, aero and integration rules; they are read-only dependencies for this task. The race facade owns car lifecycle and state; the driver returns only steering/throttle/brake, with no pose writes or extra grip.

Inputs are current vehicle capability/state, track geometry and traffic. Outputs are existing bounded physical controls. Failure modes include optimistic future grip, braking too late, rear saturation on corner exit, off-road excursions, tire-wear regressions, traffic collisions, recovery stalls and slower CPU execution. Verification combines fixed-step production simulation, independent handling/contract tests, complete races and browser smoke.

## Baseline

Source snapshot: `/tmp/paddockjs-ai-pace-20260909/baseline`. Branch `v11`, HEAD `fedff4e`; index empty, extensive pre-existing working changes. No remote refresh or Git mutation.

## Investigation evidence and rejected approaches

Baseline `npm run check` passed: 1015 fast tests, 84 slow skips, types, packing/consumer builds, showcase/demo builds and Chromium smoke. Baseline eight development and eight held-out single-car three-lap stints had zero off-road time or DNFs. Six complete demo fields finished 60/60 with zero DNFs.

- `advancedPathControls.js`: proportional pedal demand drops to zero at the target, so drag creates steady speed error. Actual straight tests at targets 40/60/80 m/s settled at 39.194/57.534/74.672 m/s. Physical resistance compensation fixes this without adding grip.
- `advancedRacingControls.js`: the old preview uses current-speed downforce for future corners and a fixed 7 m/s² braking envelope. A force-based preview can be faster, but the controller response must be fast enough to follow its braking ramp. Early candidates caused two reproducible barrier retirements; evolve's slip began while braking on healthy tires, with no preceding collision. These candidates are rejected.
- Raising the old corner margin alone gave faster solo laps but worse full fields. Steering gain/lookahead changes were negligible; inverse-brush steering and extra per-wheel traction budgeting did not solve the braking regression. Their extra code is not retained.
- Existing traffic penalties subtract a fixed speed amount without matching a slower car's actual speed. A same-lane following target based on physical gap and closing speed reduced the difficult field's contacts from 18 to 9 in an intermediate comparison.
- A fixed-point corner solver left up to 10.15 km/h unused in a representative 200 m radius corner. A bounded chord solve in speed squared uses the physical model's concavity to approach the limit conservatively. Independent comparison across 7728 curvature/tire/surface/DRS cases found no overshoot, maximum error 0.000237 m/s and mean 2.85 capacity evaluations. These are numerical call counts, not a runtime speedup claim.

All experiments and frozen source copies are under `/tmp/paddockjs-ai-pace-20260909/`. Final acceptance must use the complete combined candidate, not cherry-picked single-car results.

## Accepted implementation

The final candidate preserves the 60% corner-grip share and steering/lookahead calibration. It uses a conservative candidate-speed corner solve, a backward braking envelope and force feedback with a 62.5 ms response target. A slower response missed the braking envelope; a separate target-acceleration feedforward term caused premature braking and was discarded. Drag/rolling compensation eliminates the straight-line steady-speed deficit while the existing longitudinal tire budget limits the pedals.

Following speed uses chassis-center lateral positions, physical longitudinal gap and the other car's speed. Selection filters actual lateral overlap before choosing a blocker; a nearby adjacent car cannot hide a farther blocker. Retired and non-colliding participants do not impose this additional physical following constraint. Existing shared lane planning and traffic penalties remain intact. Production tests cover same-lane braking, adjacent masking and overlapping cars on opposite sides of the centerline. The centerline point/normal already retained by wheel-surface state supplies center offsets; representative wheel offsets are not used as chassis coordinates. Pit-route state retains `mainTrackSignedOffset`, which keeps pit and main-road comparisons in the same coordinate system. Regression tests cover both a separate pit lane and an overlapping merge.

The drag-factor helper extraction preserves the exact force expression. No physics constants, grip, mass, power, contacts, public actions, observation precision, arcade defaults, pit ownership or timing-board dimensions change.

## Driving measurements

Environment: Node v24.13.0, Darwin arm64, fixed simulation step 1/60 s. Each before/after comparison uses identical seeds, vehicles, rules and track generation. Driving times are simulated seconds, not wall-clock execution times. Artifacts and source snapshots are in the task directory above.

Solo trials use seed 100, the first bundled project driver, three laps, standing-start sequencing disabled and tire degradation disabled. Reported flying time is the mean of laps two and three. The first eight seeds are development cases; the last eight are held-out tracks. All 16 complete with zero off-road time and zero DNFs, before and after.

| Track seed | Before flying lap (s) | After flying lap (s) | Quicker |
| --- | ---: | ---: | ---: |
| 7109 | 153.492 | 144.167 | 6.08% |
| 7110 | 178.742 | 168.150 | 5.93% |
| 7200 | 159.705 | 150.284 | 5.90% |
| 7201 | 180.262 | 169.517 | 5.96% |
| 12 | 147.950 | 139.349 | 5.81% |
| 26 | 130.580 | 123.000 | 5.80% |
| 61 | 191.017 | 179.783 | 5.88% |
| 20260427 | 165.217 | 155.567 | 5.84% |
| 28 | 187.593 | 176.150 | 6.10% |
| 62 | 171.430 | 161.267 | 5.93% |
| 69 | 168.767 | 158.598 | 6.03% |
| 7202 | 147.717 | 138.433 | 6.28% |
| 7203 | 111.000 | 104.033 | 6.28% |
| 101 | 145.533 | 136.767 | 6.02% |
| 9099 | 211.382 | 199.017 | 5.85% |
| 12345 | 159.267 | 149.667 | 6.03% |

Full fields use the exact six demo configurations, ten normalized driver/entry pairs, existing wear, pits, rules and participant interactions. Hero runs five laps; the others run three. All 60 cars finish before and after; zero DNFs. Race completion improves 2.85–4.04%, and contacts fall from 123 to 44 (64.2%). These are complete race times including race flow and service, not isolated hot laps.

| Field | Before race (s) | After race (s) | Quicker | Contacts | Aggregate off-road (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| hero | 900.433 | 864.083 | 4.04% | 23 → 10 | 0.000 → 5.650 |
| components | 623.467 | 601.567 | 3.51% | 22 → 7 | 0.000 → 0.100 |
| dashboard | 554.217 | 532.883 | 3.85% | 24 → 5 | 0.000 → 0.000 |
| timing-overlay | 630.683 | 609.700 | 3.33% | 26 → 6 | 0.000 → 0.100 |
| compact-race | 510.667 | 491.167 | 3.82% | 10 → 7 | 8.783 → 0.000 |
| full-dashboard | 381.683 | 370.817 | 2.85% | 18 → 9 | 1.417 → 3.917 |

Aggregate off-road time falls slightly from 10.20 to 9.77 seconds across the six fields, although hero and full-dashboard individually have more excursions. These excursions recover without retirements. This is not a claim of perfect or globally optimal driving, nor a guarantee over every procedural track, setup or external policy. More aggressive candidates were rejected when race quality worsened substantially or a DNF appeared.

## CPU runtime measurements

Six paired runs of the existing standard 22-workload benchmark, alternating before/after order, all with `--verify`. Same host, Node, profile and workload settings; no concurrent benchmark/test process during these pairs. The accepted simulation/data source matches the measured candidate.

- Advanced 16-car, 180-step field: median 161.720 → 170.199 ms, +5.24%; ranges 157.316–181.689 and 168.306–174.461 ms. Five of six paired comparisons were slower; one baseline outlier overlaps the ranges. This is roughly 0.898 → 0.946 ms per simulation step for that workload, not a browser frame-time claim.
- Headless vector workload: median 133.194 → 135.363 ms, +1.63%; overlapping ranges 130.515–137.456 and 134.654–137.080 ms. Treat this small median difference as noise, not a demonstrated throughput change.

The improvement is racing pace and control quality, not CPU throughput. The added deterministic planning has a measured cost; no speculative cache or unrelated optimization was introduced. See `runtime-comparison.json` and `benchmarks/` for all workload results.

## Verification and changed ownership

- Baseline package gate passed with no pre-existing failures.
- Raw advanced handling acceleration/braking/cornering values match the saved baseline exactly; only source-root metadata and measurement runtime differ.
- All six ordinary arcade demo snapshot hashes match baseline exactly.
- Independent recovery/safety control comparisons match across 840 speed/target/surface/tire/yaw cases.
- Independent corner solver comparison: 7728 cases, no overshoot, maximum root error 0.000237 m/s.
- Final fast suite: 1043 passed, 88 slow tests skipped. Added coverage includes same-lane following, adjacent blockers, chassis-center overlap, separate pit corridors and pit merges.
- All 16 final solo records exactly match the accepted lap/result/trajectory records. Hero and full-dashboard each repeat twice with identical result, trajectory, event and options hashes and lap histories.
- Final `npm run check` passed: docs, 1043 fast tests (88 slow skips), public types, dry pack, packed consumers/bundle boundaries, showcase/demo builds and quick Chromium smoke.
- Final `npm run check:release` passed: all 1131 tests across 61 files, types/pack/consumer/build gates, full Chromium matrix and demo smoke (desktop runtime, public surfaces, presets, expert, headless, search and mobile layout).
- `git diff --check` passed. No pre-existing gate failure was found.

Changed runtime files: `src/simulation/driver/advancedRacingControls.js`, `advancedPathControls.js`, new `advancedRacePace.js`; `src/simulation/vehicle/advancedVehicleModel.js` and `advancedVehiclePhysics.js` for the identical drag-factor extraction. Added `src/__tests__/advancedRacePace.test.js` and `advancedAIRacing.test.js`, plus reproducible `scripts/benchmark-advanced-ai.mjs` and `benchmark-advanced-ai-fields.mjs`. Updated `docs/rules.md`, `docs/architecture.md`, a follow-up pointer in `docs/advanced_physics_rebuild.md`, and this report. Existing dirty work is preserved; this is an advanced-AI change, not a repository-wide clean audit.

Reproduce driving checks:

```sh
node scripts/benchmark-advanced-ai.mjs
node scripts/benchmark-advanced-ai.mjs . 28,62,69,7202,7203,101,9099,12345
node scripts/benchmark-advanced-ai-fields.mjs . --repeats=2
npm run check
npm run check:release
```

A source-root argument lets the same harness compare a preserved baseline. No Git/GitHub mutation is authorized or performed. Review the combined dirty diff before proposing exact staging/commit actions; do not stage whole mixed files without reviewing their earlier work.

## Closeout

Read-only Git status: branch `v11`, HEAD `fedff4e`, recorded upstream `origin/v11` at 0 ahead/0 behind without fetching. The index is empty; 122 tracked paths are modified and 46 untracked entries are present. Most are earlier ongoing work, which is preserved. No branch, index, commit, remote or GitHub state was changed.

Proposed next step: review the bounded AI diff against the saved task baseline and the combined working diff, then request exact staging/commit approval if desired. No Git next step has been executed.

Work log: [Advanced AI pace measured controller improvements](https://linear.app/mgiorgetti/document/advanced-ai-pace-measured-controller-improvements-884b829d9aac).
