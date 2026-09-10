# Racing-driver AI improvements: arcade and advanced

## Goal and acceptance

Improve both built-in drivers relative to the September 9 advanced-AI closeout. Measure braking, corner exit and traffic decisions under unchanged physics. Preserve arcade defaults, public actions/observations, deterministic stepping, recovery, pits and package layout. Faster solo driving is insufficient if representative full fields become substantially less reliable. No claim of globally optimal driving.

## Checkable plan

- [x] Preserve a source snapshot and inspect current dirty Git state and driver ownership.
- [x] Complete baseline package gate and matched solo/full-field measurements for both modes.
- [x] Diagnose concrete pace losses; compare bounded independent candidates in isolated source copies.
- [x] Select changes on lap times, contacts, off-road time and finish rate; reject fragile gains.
- [x] Integrate feature-owned controls, meaningful production regressions and authoritative docs.
- [x] Repeat accepted races, compare unchanged raw physics, measure CPU cost with paired existing benchmarks.
- [x] Pass package/release/browser/packed-consumer gates; update Linear and report read-only Git status.

## Ownership and design gate

`driver/racingControls.js` dispatches modes and preserves its existing internal exports. Arcade `arcadeRacingControls.js` owns target-line composition, geometric steering, edge guarding and pedals; `arcadeRacePace.js` owns preview and corner-line planning. `driverController.js` owns the backward-facing recovery transition. Advanced `advancedRacingControls.js` composes geometric steering, existing traffic planning and `advancedRacePace.js` speed envelopes; `advancedPathControls.js` also serves recovery/safety driving, which must remain stable. `racingLinePlan.js` owns shared overtaking intentions. Vehicle modules exclusively own physical forces/integration and the analytic arcade tarmac corner-capacity estimate; physical laws and constants are not tuning targets.

Inputs are track geometry, vehicle capability/state, existing traffic and racing intentions. Outputs remain bounded steering/throttle/brake. Candidate logic must have a narrow feature owner, no whole-app helper or hidden persistent state. The racing-driver hypotheses are braking too early or too late, unnecessary coasting, failing to unwind steering on exit, and confusing overtaking intention with available space. Each must be supported by simulation traces before adoption.

Risks: corner-entry understeer, exit oversteer, oscillatory controls, unsafe passing, tire wear, pit-coordinate mismatches and procedural-track overfitting. Evaluate development and held-out tracks, complete ten-car races with wear/pits, recovery regressions and deterministic repeats. Any structural or behavior change requires evidence and matching documentation.

## Baseline and artifacts

Baseline source: `/tmp/paddockjs-racing-ai-20260909/baseline`. Earlier ongoing work, including the first advanced AI improvement, is preserved. No Git/GitHub mutations are authorized or performed.

## Verified findings and candidate decisions

- Arcade speed preview (`driver/racingControls.js`): the sharpest future curvature became the current corner target, ignoring braking distance. In track 20260427, the car slowed from 283 km/h at 239 m to 151 km/h at 432 m while the road was still straight; the first bend began around 540 m. A distance-aware envelope avoids unnecessary early braking while retaining conservative reaction distance.
- Arcade steering combined target-point angle, future-heading feedforward and lateral correction. On track 7110 at 1319 m, the target required negative steering, but the combined controller commanded positive steering before any tire saturation. Pure pursuit inverted through arcade's own bicycle yaw relation points toward the intended path and compensates tire condition, avoiding contradictory corrections.
- Arcade corner targets barely responded to tire wear. Its physical lateral capacity scales static grip with tire factor squared and downforce with tire factor. Worn tires therefore require much lower corner speeds than the old 96 km/h corner floor. The driver must respect a physical ceiling after intentional pace floors and DRS bonuses.
- Baseline arcade full fields finished 44/60: all 16 retirements were stalled off track. Worn-tire gravel drive capacity can be lower than rolling resistance even at maximum drive, so simply raising recovery throttle cannot fix these departures. The accepted direction prevents avoidable departures instead of altering physics.
- Advanced: tighter/longer geometric pursuit and a corner-profile offset did not give useful repeatable gains. Aggressively later braking was faster alone but slower and less clean in traffic. These variants are rejected. The accepted advanced change restrains lateral lane movement under corner load, releasing it on exit. Combined with a modest braking-preview reserve change from 50% to 55%, it improves solo pace and field reliability; the 60% corner reserve, steering model and recovery controls remain unchanged.

Baseline `npm run check` passed with 1043 fast tests and 88 slow skips, plus types, packing, consumer/build and browser gates. There were no pre-existing gate failures. Both modes completed all 16 wear-disabled solo stints. Arcade accumulated 273.733 seconds off road; advanced had zero. Advanced baseline full fields finished 60/60.

## Accepted implementation and limits

Arcade uses inverse bicycle-model pursuit with tire-condition compensation, a 12 m sampled speed preview and conservative braking/reaction distance. Existing rating, aggression, DRS, edge and traffic inputs remain, but they cannot exceed the worn-tire corner ceiling. The old generic control profile and discarded additive steering calculations were removed. Recovery handles backward-facing placements; it does not alter the physical ability to escape a surface.

Advanced keeps the existing pursuit model and following-distance safety. Its selected lane target interpolates from the actual chassis center toward the planned lane according to unused cornering budget, preventing abrupt lateral moves while heavily loaded. The braking preview uses 55% of estimated available capacity after lateral demand, still below the longitudinal control limit. The shared 60% racing corner reserve remains unchanged. There are no persistent new state owners, caches, added grip, position corrections or public API changes.

Both controllers remain deterministic heuristic drivers. Results do not establish global optimality or guarantee clean racing on every procedural track, setup or user placement. Nonzero contacts and brief field excursions remain. Arcade's physical worn-tire gravel stall limitation is unchanged.

## Driving measurements

Same Node v24.13.0, Darwin arm64, fixed 1/60 s step, seeds, tracks, drivers, entries and rules before/after. Solo tests use race seed 100, one bundled driver, three laps, no standing-start sequence and tire wear disabled. Flying time is the mean of laps two and three. The first eight tracks are development cases; the remaining eight are held-out cases. All 32 final solo runs finish without off-road time or DNFs.

| Track seed | Arcade before (s) | Arcade after (s) | Quicker | Advanced before (s) | Advanced after (s) | Quicker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 7109 | 137.150 | 123.317 | 10.09% | 144.167 | 143.550 | 0.43% |
| 7110 | 173.533 | 138.183 | 20.37% | 168.150 | 167.050 | 0.65% |
| 7200 | 149.911 | 129.508 | 13.61% | 150.284 | 149.227 | 0.70% |
| 7201 | 161.142 | 136.633 | 15.21% | 169.517 | 168.683 | 0.49% |
| 12 | 138.833 | 122.031 | 12.10% | 139.349 | 138.300 | 0.75% |
| 26 | 131.171 | 107.467 | 18.07% | 123.000 | 122.083 | 0.75% |
| 61 | 178.065 | 148.900 | 16.38% | 179.783 | 178.733 | 0.58% |
| 20260427 | 151.693 | 132.901 | 12.39% | 155.567 | 154.983 | 0.37% |
| 28 | 167.533 | 140.450 | 16.17% | 176.150 | 174.817 | 0.76% |
| 62 | 161.783 | 136.908 | 15.38% | 161.267 | 160.250 | 0.63% |
| 69 | 147.695 | 131.817 | 10.75% | 158.598 | 157.742 | 0.54% |
| 7202 | 141.001 | 117.417 | 16.73% | 138.433 | 137.667 | 0.55% |
| 7203 | 104.985 | 96.867 | 7.73% | 104.033 | 102.988 | 1.00% |
| 101 | 134.817 | 118.967 | 11.76% | 136.767 | 136.267 | 0.37% |
| 9099 | 182.923 | 156.383 | 14.51% | 199.017 | 198.400 | 0.31% |
| 12345 | 153.847 | 127.745 | 16.97% | 149.667 | 148.783 | 0.59% |

Full fields use the six actual demo configurations with ten driver/entry pairs, normal tire wear, pits and interactions. Hero runs five laps; others run three. **Arcade baseline retires 16 cars, so its field-duration differences are not equal-completion race comparisons.** Finish counts, incidents and clean solo pace must be considered together.

### Arcade full fields

| Field | Finishers before → after | Last finish before → after (s) | Mean finish before → after (s) | Contacts | Off-road (car-seconds) |
| --- | ---: | ---: | ---: | ---: | ---: |
| hero | 8 → 10 | 796.733 → 724.667 | 776.554 → 701.100 | 82 → 50 | 279.933 → 0.000 |
| components | 7 → 10 | 627.967 → 501.733 | 584.274 → 482.592 | 73 → 65 | 542.517 → 2.467 |
| dashboard | 5 → 10 | 530.417 → 445.800 | 503.560 → 433.562 | 70 → 43 | 371.350 → 0.000 |
| timing-overlay | 6 → 10 | 618.467 → 497.467 | 568.528 → 479.483 | 82 → 52 | 381.100 → 0.000 |
| compact-race | 8 → 10 | 509.283 → 407.633 | 478.856 → 393.245 | 75 → 57 | 228.617 → 0.167 |
| full-dashboard | 10 → 10 | 350.583 → 329.283 | 336.478 → 311.360 | 57 → 38 | 79.733 → 1.067 |

Total finishers: 44/60 → 60/60. Contacts: 439 → 305. Aggregate off-road time: 1883.250 → 3.700 car-seconds.

### Advanced full fields

| Field | Finishers before → after | Last finish before → after (s) | Mean finish before → after (s) | Contacts | Off-road (car-seconds) |
| --- | ---: | ---: | ---: | ---: | ---: |
| hero | 10 → 10 | 864.083 → 887.817 | 846.897 → 839.533 | 10 → 12 | 5.650 → 0.000 |
| components | 10 → 10 | 601.567 → 597.350 | 590.820 → 586.737 | 7 → 3 | 0.100 → 0.300 |
| dashboard | 10 → 10 | 532.883 → 528.933 | 520.068 → 516.378 | 5 → 1 | 0.000 → 0.467 |
| timing-overlay | 10 → 10 | 609.700 → 604.583 | 595.245 → 591.433 | 6 → 3 | 0.100 → 0.767 |
| compact-race | 10 → 10 | 491.167 → 486.567 | 478.878 → 475.007 | 7 → 3 | 0.000 → 0.433 |
| full-dashboard | 10 → 10 | 370.817 → 356.183 | 353.282 → 345.350 | 9 → 6 | 3.917 → 0.000 |

Total finishers: 60/60 → 60/60. Contacts: 44 → 28. Aggregate off-road time: 9.767 → 1.967 car-seconds.

Advanced mean finishing times improve in every field, but hero's last-car completion is 2.75% slower (864.083 → 887.817 s). This is an explicit tradeoff, not a universal race-duration improvement. Five other fields finish sooner. The tight full-dashboard field improves from 370.817 to 356.183 s. Arcade's baseline means include only its surviving finishers; they are shown for context rather than treated as a matched population speed claim.

## Measurement integrity

The two existing AI harnesses now accept validated `--physics-mode arcade|advanced`; advanced remains the default for existing invocations. Solo records include source fingerprints. Field benchmark v2 derives lap intervals from canonical timing-line crossings, because pit movement can advance completed-lap counters before `lastLapTime` updates. Each finished car's lap intervals reconcile with its finish time within one fixed step. Completed pit exits are read from `pitStop.stopsCompleted` and checked against pit-exit events; pit service completion is a separate event. This corrects reporting only and leaves trajectory/event hashes unchanged.

All final solo trajectories match the accepted isolated candidates exactly. Both modes' six full fields are repeated twice with exact deterministic result hashes. Source fingerprint for the final simulation/data tree: `29c71119c480dfca686dc479545ad4b7e4098af9738c63e85100067ba83a6998`.

## Verification and runtime cost

- Baseline package gate passed without pre-existing failures.
- Focused AI suite: 44 passed, including worn-tire/DRS/braking/steering/wrong-way cases, loaded-corner lane restraint, clean stints and complete fields. Existing advanced full-field assertions were strengthened.
- An initial release run failed the old assertion that a particular 30-second approach must reach over 7 m lateral offset. The new faster line reaches 6.181 m there, but reaches 8.085 m on the tight demo circuit with legal kerb use. The original pace fixture and all its speed/off-road thresholds remain; the unchanged 7 m threshold now has a dedicated 90-second tight-circuit test, additionally requiring actual kerb contact, legal surfaces and average speed above 180 km/h. All 10 driver-controller tests passed after this coverage separation; no runtime change or relaxed numeric threshold was used to pass it.
- Raw physics: 216 combinations across both modes, three surfaces, three tire states, three speeds and four control patterns, each integrated for 120 steps. Complete vehicle states match baseline exactly.
- Package `npm run check` passed on the final runtime source: 1051 fast tests, 92 slow skips, docs, public types, dry pack, packed-consumer install/build and bundle checks, showcase/demo builds, quick Chromium and demo smoke. Final `npm run check:release` passed with all 1144 tests across 62 files, public types, pack/consumer/build checks, the full Chromium matrix and demo smoke (desktop runtime, public surfaces, presets, expert, headless, search and mobile layout).
- Twelve paired runs (two batches of six, alternating before/after order) of all 23 standard runtime workloads passed `--verify`. Same Apple M4 Pro host, Node v24.13.0 and settings; our test/benchmark processes were otherwise stopped. The unchanged local-preview source dependency was copied into the frozen baseline to run the common harness. The measured field workloads include setup, instrumentation and 180 steps for 16 cars; these are not browser frame timings.

| CPU workload | Before median (ms) | After median (ms) | Before range (ms) | After range (ms) |
| --- | ---: | ---: | ---: | ---: |
| Arcade field | 46.916 | 52.846 | 45.239–69.124 | 50.845–154.979 |
| Advanced field | 174.944 | 163.604 | 167.632–250.340 | 159.241–400.565 |
| Headless vector | 140.565 | 134.068 | 132.149–163.235 | 127.945–275.706 |

Arcade has a consistent planning cost: the two batch median comparisons are +13.26% and +13.11%; the pooled comparison is +12.64% (about 5.93 ms per whole field workload). Advanced's batch signs disagree (+17.38% versus −7.17%), with overlapping ranges/outliers; the pooled −6.48% median is **not a reliable throughput improvement claim**. The headless-vector batches likewise disagree. No CPU speedup is claimed or speculative cache introduced. All raw runs and per-workload comparisons remain in the task artifacts.

## Changed files and closeout

Runtime: `src/simulation/driver/racingControls.js`, new `arcadeRacingControls.js` and `arcadeRacePace.js`, `driverController.js`, `advancedRacingControls.js`, `advancedRacePace.js`, and `src/simulation/vehicle/vehiclePhysics.js` (analytic planning helper only). Tests: new `src/__tests__/arcadeAIRacing.test.js`, updated `advancedAIRacing.test.js`, and a separated kerb-use characterization in `driverController.test.js`. Measurement: `scripts/benchmark-advanced-ai.mjs`, `benchmark-advanced-ai-fields.mjs`, `runtimeEfficiencyBenchmarks.mjs`. Documentation: `docs/rules.md`, `architecture.md`, a historical follow-up link in `advanced_ai_pace.md`, and this report.

Artifacts: `/tmp/paddockjs-racing-ai-20260909/`, including frozen baseline, accepted/rejected source copies, JSONL measurements, physics comparison and gate logs. Reproduce:

```sh
node scripts/benchmark-advanced-ai.mjs . 7109,7110,7200,7201,12,26,61,20260427,28,62,69,7202,7203,101,9099,12345 --physics-mode arcade
node scripts/benchmark-advanced-ai.mjs . 7109,7110,7200,7201,12,26,61,20260427,28,62,69,7202,7203,101,9099,12345 --physics-mode advanced
node scripts/benchmark-advanced-ai-fields.mjs . --physics-mode arcade --repeats 2
node scripts/benchmark-advanced-ai-fields.mjs . --physics-mode advanced --repeats 2
node scripts/benchmark-runtime-efficiency.mjs --profile=standard --json --verify
npm run check
npm run check:release
```

Git remains approval-gated. Existing dirty work is preserved; this task does not establish repository-wide cleanliness. Review the bounded changes against the task snapshot and the combined working diff before proposing exact staging/commit actions. No Git/GitHub mutation is authorized or performed.

Work log: [Racing-driver AI improvements: arcade and advanced](https://linear.app/mgiorgetti/document/racing-driver-ai-improvements-arcade-and-advanced-9dac1149e8ab).

Current read-only Git inspection: branch `v11`, HEAD `fedff4e`, recorded `origin/v11` at 0 ahead/0 behind without fetching; index empty, 123 modified tracked paths and 50 untracked entries. Earlier work is preserved.
