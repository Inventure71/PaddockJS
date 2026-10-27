# v11 improvement evidence — 2026-10-13

This pass improves built-in racecraft, removes redundant high-refresh rendering and preview allocations, and fixes browser startup/callback cleanup. Implementation is isolated on `v11-improvements` in a separate worktree based on `5bd587528a1b95cd78dd77768129e71a2b09a0e6`. The original v11 checkout and ref are preserved. No commit, push, release or publication was performed.

## Subsequent efficiency and maintainability pass

The follow-up requested after motion testing is recorded separately in [the measured efficiency audit](efficiency_cleanup_2026-10-13.md). It covers decision-local capacity reuse, render/sensor allocation reduction, observer and timing DOM convergence, ownership cleanup, native GPU frame-time/memory probes and current package gates. Earlier verification tables below remain historical evidence for the first pass.

## Racecraft results

The same six production demo fields were run in both physics modes, with ten cars, their normal tires/pit rules, fixed seeds, fixed `1/60` steps and a 1,200-second ceiling. Baseline and final cases each ran twice. Every case finished with all ten cars, zero DNFs, and exact repeated trajectory/event/result hashes. Measurements are simulation seconds, not wall-clock speed.

| Mode / field | Contacts before → after | Off-road car-seconds before → after | Full-field finish seconds before → after |
| --- | ---: | ---: | ---: |
| Arcade / hero | 50 → 6 | 0 → 0.050 | 724.667 → 716.783 |
| Arcade / components | 65 → 8 | 2.467 → 2.350 | 501.733 → 500.450 |
| Arcade / dashboard | 43 → 7 | 0 → 0.450 | 445.800 → 448.350 |
| Arcade / timing-overlay | 52 → 5 | 0 → 0 | 497.467 → 493.617 |
| Arcade / compact-race | 57 → 7 | 0.167 → 0.333 | 407.633 → 407.850 |
| Arcade / full-dashboard | 38 → 6 | 1.067 → 1.017 | 329.283 → 313.917 |
| Advanced / hero | 12 → 2 | 0 → 0 | 887.817 → 879.133 |
| Advanced / components | 3 → 0 | 0.300 → 0.050 | 597.350 → 596.767 |
| Advanced / dashboard | 1 → 0 | 0.467 → 0 | 528.933 → 524.133 |
| Advanced / timing-overlay | 3 → 0 | 0.767 → 0 | 604.583 → 601.017 |
| Advanced / compact-race | 3 → 1 | 0.433 → 0 | 486.567 → 483.500 |
| Advanced / full-dashboard | 6 → 4 | 0 → 0 | 356.183 → 354.667 |

Arcade contacts fall from **305 to 39 (87.2%)**; advanced contacts fall from **28 to 7 (75%)**. Advanced off-road time falls from 1.967 to 0.050 car-seconds. Arcade retains a small tradeoff: aggregate off-road time rises from 3.700 to 4.200 car-seconds, and two fields finish slightly later. Its aggregate full-field finish time falls by 25.617 seconds; advanced falls by 22.217 seconds. These are fixed demo fixtures, not a guarantee for every track, rating sheet or traffic arrangement.

Off-road time uses the harness's wheel-derived `trackState.onTrack === false` during active running intervals, outside pit-controlled routing and pit-lane travel. Contact counts are physical contact events consumed once per step, rather than penalty consequences counted again. Lap times use canonical timing-line crossings. The harness prints track lengths, source/options hashes, per-car laps, incidents, tire state and pit completion facts.

Simulation/data source SHA-256:

- Baseline: `a70d95444f064aa70ecea1d407347dffc97403f2ae00f309590f94f92a7c0800`.
- Final: `2e4c4d81b0ecc12505110f2bd7ed882229c1fa8b1dbb6cf64ab582d63d25a01a`.

The final narrow-road comfort-margin correction was also checked against the prior wide-road candidate: all 12 field result hashes remained identical. A separate 405-combination check preserved ordinary-road offset calculations while fixing a six-meter road's negative comfort limit.

## What changed and why

- Physical traffic gaps wrap around the circuit. Lapped cars and start-line neighbors can no longer disappear because their classification distances differ by a lap.
- Traffic uses chassis centers in the main-track frame. Outer-wheel surface offsets and pit-local offsets cannot exaggerate passing clearance. Separate pit traffic is excluded from tactical targets; merging traffic remains relevant.
- Both modes follow stopped/slow blockers until there is real lateral clearance. Arcade's minimum maneuvering speed no longer overrides the blocker limit.
- Passing intent no longer fights reactive defense. Drivers avoid defending against a physically rearward lapping car.
- Arcade holds its line through loaded turns with traffic, retaining inward edge recovery priority. Advanced constrains its final target beside overlapping cars and permits inward correction near the edge.

An initial center-space tactical candidate substantially increased off-road time and was rejected. Swept lane constraints at intermediate intention/scoring boundaries also caused arcade regressions and were rejected. Final constraints are applied to the advanced controller's actual composed target; arcade retains its independently verified corner-hold policy. Physics forces, grip, pose integration and model observations were not changed.

## Resource and lifecycle improvements

The actual private Pixi ticker is capped at 60 FPS and stays stopped during loading. Real Pixi ticker tests drive synthetic 30/60/120/144 Hz refreshes and check both draw counts and elapsed fixed-step simulation. High-refresh tests produce approximately 60 draws per second instead of 120/144 draws of a scene updated at 60 Hz. This proves reduced draw work; it is not a claim of a measured device-wide CPU/GPU percentage.

### Follow-up: reported car/camera stutter

Interactive review exposed a clock defect missed by the original average-FPS checks: simulation advancement rounded elapsed time to whole 16.667 ms frames, leaving almost no interpolation remainder. A second frame gate could also skip pose updates while Pixi still drew the scene. Real-ticker regressions reproduced uneven movement at 30/60/90/120/144 Hz with scheduling jitter. The runtime now updates on every capped draw, accumulates measured wall time with the existing four-frame catch-up ceiling, and renders the fractional fixed-step remainder. Camera target, scale and rotation damping use that elapsed interval. Destroyed/out-of-race cars render at their frozen current pose so their last moving endpoints cannot oscillate with render phase. Physics and AI policies remain unchanged by this follow-up.

The new coverage checks each rendered position against elapsed time at 1x and 10x playback, bounds long-stall recovery, checks camera wall-time response, and exercises frozen-car rendering through a real race simulation. The collaborative preview additionally ran through SwiftShader software rendering: 45 sampled animation intervals averaged 106.3 ms (about 9.4 FPS), and its GPU process exceeded eight CPU cores of load. That environment limits visual-performance acceptance; the demo was also opened in the normal desktop browser. The timing fix does not claim to make software rendering reach 60 FPS.

Follow-up verification: `npm run check` passed 1,164 fast tests plus its packaging, type, showcase and quick browser/demo checks; the subsequently added frozen-car cases passed in targeted coverage. The final `npm run check:release` passed all **1,259 tests**, four dependency audits, type checking, packed-consumer checks, both showcase builds, and the full browser and demo smoke gates. A live Pixi probe saw 30 draw callbacks, 30 pose updates and zero interpolation error; Overview and Selected camera interactions also passed. Evidence is in `/tmp/paddock-v11-stutter-check.log`, `/tmp/paddock-v11-stutter-release.log`, and `/tmp/paddock-v11-stutter-live-motion.json`.

Advanced preview geometry reuses one point across sampled braking decisions; target geometry uses separate reusable scratch. A production sampling test asserts stable buffer identity and repeat speed results. Isolated pre/post scratch substitutions preserved every-step controls and trajectories for 45-second three-car advanced runs on track seeds 12, 7110 and 7203. This equivalence concerns the allocation substitution, not the later tactical changes. Following decisions reuse the lane scan rather than scanning the field a second time.

The standard runtime benchmark passes all 23 cases, covering simulation phases, indexed track/pit queries, collisions, sensors, compact environment output, snapshots/JSON, policy transport, interpolation and DOM readouts. Desktop background activity made wall-clock comparisons unsuitable for a reliable speedup claim; acceptance uses the benchmark's cost/identity counters and focused draw/allocation invariants.

Pending Pixi initialization now has explicit resource ownership. Destroy waits to release eventual resources after init settles, while a cancelled start cannot append a canvas, restore textures or emit ready. Partial resize/ticker plugin failures release their listeners/tickers as well as the stage/renderer. Independent disposer errors are reported without abandoning the rest of cleanup or masking the original initialization error.

Normal/expert frames and readout updates stop when host callbacks destroy or replace the race. Callback dispatch itself captures the simulation and reset generation, preventing remaining obsolete events or finish/lap bookkeeping from corrupting a successor race.

Independent sprite and track texture loads start concurrently. Fresh root tests resolve repository-demo imports to the current public source entrypoints; fresh packed consumers separately prove package resolution. The option-normalization test now fixes seed/track seed instead of making random track generation part of its timing/reproducibility.

## Tooling and package boundary

Clean installs exposed missing optional peer entries in both browser consumer lockfiles; those are repaired. All three consumer/root locks use the patched `source-map-js@1.2.2`.

Changesets v2's release-only dependency chain contained an [unpatched braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Release tooling is now a pinned, private, nonworkspace Changesets 3.0.3 package. The simulator retains Node `>=20.19.0`; tooling uses its supported newer Node versions, with Node 24 in the release workflow. The root launcher preserves arguments, exit status and repository-root working directory. The release audit checks all four graphs with no exclusions. Local auditing found zero vulnerabilities in each graph.

The workflow uses Changesets action v2 with explicit version/publish scripts. `npm publish --provenance` is preserved. Read-only CLI status identifies only PaddockJS's pending minor release, excludes private tooling, and leaves package/lock/changelog/Changesets inputs unchanged. Default changelog resolution was verified from the isolated tool installation.

Two preexisting publishing follow-ups remain outside local verification: plain npm publishing supplies no structured Changesets publication events for automatic published-package/tag/release reporting, and the version script does not regenerate release lock metadata automatically. Synchronizing version/lock/changelog inputs and authorizing/testing real release execution remain release-handoff requirements. No versioning or publishing command was run against the live checkout.

## Verification

| Gate | Result | Scope |
| --- | --- | --- |
| `npm run check` — Node 24.15.0 / npm 11.6.2 | Passed | 67 fast test files; 1,150 passed / 93 intentionally deferred slow tests; types, dry pack, fresh packed consumers, bundle boundaries, both builds, quick showcase smoke and complete demo smoke |
| `npm run check:release` — Node 24.15.0 / npm 11.6.2 | Passed | All 67 exhaustive test batches / 1,243 tests; four dependency audits; types/pack/consumers/builds; full showcase matrix and complete demo smoke |
| Minimum Node 20.19.0 / npm 11.6.2 | Passed | Docs, all fast tests (1,150 passed / 93 slow skips), public types and dry pack |
| Standard runtime benchmark `--verify` | Passed | All 23 benchmark cases on baseline and final source |
| Exact-source production field matrix | Passed | 24 final executions plus 24 baseline executions; all cars finish, no DNFs, exact within-case repeat hashes |
| Independent runtime integration review | Passed after fixes | Partial plugin cleanup and stale callback delivery reproduced before fixes and independently rechecked after them |

The first broad run hit the option-normalization test's five-second timeout during unseeded track generation under desktop load. Fixing that test's seed/track seed made its inputs deterministic; the focused test and both supported-Node gates passed without increasing its timeout or disabling warmup. Changes after the broad gates were evidence/documentation updates only; final documentation checks and diff whitespace checks passed.

Relevant reproducible commands from this checkout:

```bash
npm run check
npm run check:release
node scripts/benchmark-runtime-efficiency.mjs --profile=standard --verify --json
node scripts/benchmark-advanced-ai-fields.mjs --physics-mode arcade --repeats 2
node scripts/benchmark-advanced-ai-fields.mjs --physics-mode advanced --repeats 2
```

Pass the untouched baseline checkout as the field harness's optional first source-root argument to reproduce baseline comparisons. Use a supported release-tool Node version for `check:release`; ordinary package tests remain compatible with Node 20.19.

Direct built-browser verification additionally exercised overview/selection, timing gap switching, telemetry open/close, safety-car deploy/clear, and 390-pixel timing reveal/resizing without horizontal overflow. A real Pixi startup was destroyed before completion, released its stage/renderer, left no canvas, delivered no ready/error callback, then retried successfully with one canvas and a 60 FPS ticker. Automated smoke also verifies painted canvases and the broader public controls, expert/headless and preset paths.

Subsequent skill-dependent physical-envelope tuning, timing-line boundary repair and measured limitations are documented in [limit driving, 2026-10-14](limit_driving_2026-10-14.md). Earlier results above describe their recorded candidate.
