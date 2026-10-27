# Skill-dependent limit driving — 2026-10-14

Work is isolated in `PaddockJS-v11-improvements`, branch `v11-improvements`, from approved v11 commit `5bd587528a1b95cd78dd77768129e71a2b09a0e6`. Original v11 remains untouched. This report follows the completed efficiency/cleanup pass; it does not replace that pass’s measured resource limitations.

## Goal and boundaries

Built-in racers should exploit their actual vehicle’s speed, braking and handling capabilities. Ability and consistency determine control precision; risk tolerance and aggression determine willingness to use smaller margins. Strong cautious and strong aggressive drivers both exist. Risk is not skill, and incidents are not deliberately scheduled.

Vehicle force/integration equations, setup coefficients, action limits, deterministic seed ordering, model observation precision and the 330 km/h ceiling are preserved. Only racing policy, additive physical prediction/inverse helpers, normalized consistency retention, and timing-line boundary correctness change. Recovery, safety-car and pit routing retain their ownership. No host-specific behavior or new public options are introduced. Existing legacy vehicle fallbacks remain: when explicit vehicle coefficients are omitted, car creation derives power from pace and grip partly from racecraft. Use explicit vehicle entries for comparisons that must hold the car identical across skills.

## Implementation

- `racingDriverProfile`: existing pace/racecraft → ability; consistency → bounded continuous distance-based judgement variation; aggression/risk tolerance → smaller chosen margins. No RNG calls, new per-car controller history, extra power or grip.
- `advancedRacingEnvelope`: transferred four-contact capacities, yaw-balanced limiting axle, equal rear drive and 57/43 brake allocation. Safeguarded root solving finds nonzero feasible braking windows near front-axle saturation.
- `advancedRacingSteering`: velocity-oriented pursuit and inverse nonlinear brush slip, including current-pedal front force projection. Steering remains a normal rate-limited physical wheel-angle request.
- `advancedRacingTiming` / pace: shared pursuit/yaw response; contiguous curvature preview. The braking recurrence counts only distance outside its pursuit, response, driver anticipation and one-sample reserve.
- Arcade: actual model corner and longitudinal limits plus racing-only 8–35 m smooth pursuit horizon. Arcade has no fictitious combined friction circle.
- Timing: exact forward half-open line boundaries replace a tolerance dead zone that could permanently omit a lap timestamp.

## Verification evidence

The final source hash is `8f7349f261feda96cceb40647e645636ba270b1fb7d3ef6d151707964007c5c0`; envelope harness hash is `9d8d1d433086c97fa4c8742a4b3ed72b83b6a16ff633c97857ebe8262deeb564`. Across both modes, five profiles × six development/held-out tracks × two repeats produce **120 full three-lap solo runs: all finished, no off-road time or DNFs, all 60 repeat pairs exact**. Profiles are novice, expert, skilled-cautious, expert-risky and skilled-risky. The cautious/expert-risky pair has identical ability, consistency and vehicle coefficients; only personality changes. The less consistent skilled-risky profile is slower despite greater risk willingness.

Same-car advanced expert flying-lap means on tracks 12 / 7110 / 7203 are **138.59 → 122.11 s**, **167.50 → 147.39 s**, **103.00 → 92.49 s** (about 10–12% faster). Final novice means are 134.96 / 164.32 / 100.59 s. Cautious experts average 122.64 / 148.13 / 92.81 s; aggressive experts 121.93 / 147.15 / 92.37 s. Risk influences pace modestly and does not manufacture ability.

The six actual worn/pitting demo fields run twice in each mode: **24 final executions, all 240 car results finished without DNF, all 12 repeat pairs exact**, compared against 24 baseline executions. First-repeat results below count every field interval; off-road time uses wheel-derived `onTrack=false` outside pit routing, which differs from all-four-wheels white-line stewarding. Contacts are physical event counts, not penalty consequences.

| Mode / field | Field finish seconds, baseline → final | Off-road seconds | Contacts | Final finishers |
| --- | --- | --- | --- | --- |
| advanced / hero | 879.13 → 780.93 | 0.000 → 0.000 | 2 → 1 | 10/10 |
| advanced / components | 596.77 → 544.07 | 0.050 → 0.083 | 0 → 2 | 10/10 |
| advanced / dashboard | 524.13 → 479.13 | 0.000 → 0.100 | 0 → 1 | 10/10 |
| advanced / timing-overlay | 601.02 → 551.95 | 0.000 → 0.000 | 0 → 0 | 10/10 |
| advanced / compact-race | 483.50 → 445.15 | 0.000 → 0.117 | 1 → 2 | 10/10 |
| advanced / full-dashboard | 354.67 → 340.07 | 0.000 → 1.983 | 4 → 5 | 10/10 |
| arcade / hero | 716.78 → 658.53 | 0.050 → 0.000 | 6 → 10 | 10/10 |
| arcade / components | 500.45 → 461.40 | 2.350 → 0.000 | 8 → 12 | 10/10 |
| arcade / dashboard | 448.35 → 406.95 | 0.450 → 0.000 | 7 → 8 | 10/10 |
| arcade / timing-overlay | 493.62 → 465.40 | 0.000 → 0.000 | 5 → 12 | 10/10 |
| arcade / compact-race | 407.85 → 368.57 | 0.333 → 0.000 | 7 → 5 | 10/10 |
| arcade / full-dashboard | 313.92 → 289.62 | 1.017 → 0.533 | 6 → 3 | 10/10 |

All fields finish faster. Advanced aggregate first-repeat off-road time rises 0.050 → 2.283 s and contacts 7 → 11; arcade off-road time falls 4.200 → 0.533 s while contacts rise 39 → 50. These regressions in contacts are retained as a tradeoff; this is not a claim of universally cleaner racing. There are no scheduled accidents or forced contact effects.

A read-only advanced integrator hook observes every one of four contacts in every substep. On minimum supported Node 20.19, observed/unobserved final expert runs have identical trajectory, event and behavior hashes across three complete tracks and two repeats. Contact counts equal exactly 16 per active fixed frame. Final force equations match the prior accepted implementation exactly across 288 contact cases and 2,400 integrated car frames (hash `c42a9690aba8b69920558544f166c36fadc52fbe3f802ffbb9ec826fea8509a8`).

Phase-specific delivered forces, pedal occupancy, speed-ceiling fractions, slips and denominators are in the JSONL records. Advanced expert corner delivered combined utilization is 0.681 / 0.676 / 0.701; steady corner utilization 0.789 / 0.752 / 0.727, with short steady windows. Actual-integrator circle tests additionally verify both turn directions at 93% of physical corner speed, track within half a car width and deliver at least 90% of actual-speed turning demand. These are bounded measurements, not a global optimal-lap certificate.

## Resource cost

Invocation-local input reuse refreshes surfaces, nominal loads, drag and rolling characteristics on every public helper call, then reuses them inside its transfer/bracket passes. Surface scans drop 60 → 4 straight, 156 → 4 mixed, 28 → 4 brake preview, and 20 → 4 corner estimation. One thousand helper cases and three tracks × 1,800 frames × four cars retain exact outputs, including immediate DRS, tire and surface changes. All 120 final solo records also have identical trajectory/event/behavior/metric hashes to the uncached candidate.

Five alternating fresh-process pairs share identical serialized real 20-car states and 2,000 production driver decisions. Median policy CPU is **124.376 → 113.352 ms** after reuse (8.86% less); wall time **89.813 → 76.958 ms** (14.31% less), with identical control hashes. The old pre-limit policy uses **43.521 ms**: the optimized advanced policy still costs **2.60×** the old policy in this fixture. These are policy-only CPU measurements, not whole browser/physics CPU or frame rate.

## Hardware frame measurements

An isolated headed Chrome uses `ANGLE Metal Renderer: Apple M4 Pro`, fixed 1,280 × 800 viewport, DPR/renderer density 2 and identical 2,450 × 1,210 pixel canvases. Each 30-second sample uses ten cars, the complete broadcast host, same seeds/setup, a 10-second fixed-step warmup, leader camera and settled visible runtime. The initial paths differ because the driving policy changes; this is not a claim of identical post-warmup poses. No tests/field benchmarks run during frame sampling; typed-array instrumentation and CDP metrics are restored afterward.

| Mode | FPS, baseline → final | Draw p95 ms | Draw p99 ms | Mean update work ms | Draw gaps >50 ms |
| --- | --- | --- | --- | --- | --- |
| arcade1 | 58.53 → 58.49 | 23.1 → 23.6 | 25.5 → 26.1 | 0.998 → 0.911 | 0 → 0 |
| advanced1 | 58.54 → 58.60 | 23.6 → 23.4 | 25.7 → 26.1 | 0.851 → 1.379 | 0 → 0 |
| advanced10 | 58.59 → 58.59 | 20.4 → 25.8 | 26.5 → 27.9 | 2.034 → 5.150 | 0 → 0 |

FPS is maintained in the measured hardware configuration. Advanced update work rises and 10× draw tail times worsen, despite no >50 ms gaps or long tasks. No browser CPU/FPS improvement is claimed; slower devices and larger fields can expose this added controller cost. Arcade’s single paired callback decrease is not a general performance claim. The collaborative preview reports SwiftShader and is excluded from hardware timing. An off-screen probe correctly paused with zero draw frames and is excluded; the first cold baseline is retained separately, with the settled repeat used above.

## Package and interaction gates

`npm run check` passes 81 fast files / 1,254 tests, with 93 intentional slow skips, public types, dry pack, fresh packed consumer/build, bundle boundaries, both builds, quick Chromium showcase smoke and complete demo smoke. Minimum Node20.19 passes the 74 focused new/affected tests and full observed/unobserved advanced characterization. The final standard runtime benchmark validates all 23 cases. `npm run check:release` passes all 81 exhaustive test batches / 1,347 tests, four dependency audits with zero vulnerabilities, public types, dry pack, fresh packed consumer/build, bundle boundaries, both builds, the full Chromium showcase matrix and complete demo smoke.

Native interaction verifies telemetry open/close, timing reveal, Budget Buddy selection, interval→leader gap switching and Overview camera at 390 × 844. Document width remains 390 px with all ten rows. An open telemetry drawer intentionally overlays timing controls; the interaction closes the drawer before selecting/toggling the board. Package-owned sizing is untouched. Raw successful readback is `native-interaction-verified.txt`.

All source changes precede the final gates. Subsequent edits only record evidence; final documentation and whitespace checks are rerun. Original v11 remains clean at the approved starting commit; candidate changes remain uncommitted with no upstream. No remote fetch, commit or publication occurs. Raw frozen-source experiments and final measurements are under `/tmp/paddock-v11-limit-driving-20261014/`; observational harnesses under `scripts/` are excluded from package runtime.

The release gate’s old natural-kerb assertion was found to depend on overshoot: the baseline chassis moved 2.45 m beyond its requested line before touching a kerb. The shorter pursuit follows its intended line more closely. The 90-second legal-surface and >180 kph mean-pace requirements remain; both-side public-state placement tests now directly verify two outer wheels on legal kerb, real AI/physics motion, bounded controls, speed and return to asphalt. No apex change was made solely to recreate overshoot.


## Rejected approaches and limits

Raising the old static grip multiplier alone caused excursions/retirements. Front slip feedforward alone also failed. A shifted preview origin could skip nearby bends and accelerate into a corner; extra constant anticipation hid that defect in some solo races but did not pass full fields. The accepted preview keeps near-field constraints contiguous and reserves response distance. A tighter reserve was quicker solo but worse in traffic; an adaptive brush-slope predictor added cost and conservatism without superior field evidence.

Higher raw `gripUsage` is not proof of better delivered force. The nonlinear brush model can report demand above one before actual lateral force reaches contact capacity. Delivered utilization is measured independently from the integrator. Phase-specific steady tight-corner windows can be sparse; no claim of continuous 100% grip use or globally optimal racing lines is made. Top-speed, engine and traffic constraints also prevent a meaningful 100% grip expectation on every bend.

Arcade pursuit validation against its preceding candidate reduced six-field aggregate off-road time 46.517 → 0.533 s, all 60 cars finished, and contacts 51 → 50; combined finish times increased 2.09% and pit stops changed 19 → 22. Faster isolated laps do not automatically imply faster worn/pitting races.

No Git staging, commit, fetch, push, merge or publication has been authorized or performed. Release publishing and lock synchronization follow-ups remain separately approval-gated.

The [PaddockJS Linear project document](https://linear.app/mgiorgetti/document/v11-improvement-pass-racecraft-render-cost-and-lifecycle-reliability-b6c4a20b8501) is updated with task, solution, verification and tradeoffs; readback preserves previous content and verifies the new section. Temporary profiling servers and the isolated native QA browser are closed. The rebuilt demo stays available at `http://127.0.0.1:4181/`. Native painted-track capture: `output/playwright/limit-final-track-narrow.png`.
