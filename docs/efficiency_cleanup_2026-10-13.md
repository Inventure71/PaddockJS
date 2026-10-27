# Efficiency and maintainability follow-up — 2026-10-13

This continues the isolated v11 improvement pass after the user requested sustained hardware-browser measurements and a broader cleanup audit. The starting point includes the earlier AI, lifecycle and motion fixes, not untouched v11. Source, scripts and both built consumers were preserved under `/tmp/paddock-v11-efficiency-20261013-pass2/` before edits. Work remains uncommitted on `v11-improvements`; original v11 is preserved and no Git/GitHub mutation is part of this pass.

## Checkable scope

- [x] Inspect live branch/worktree state, current ownership, existing cleanup records and test contracts.
- [x] Scan package/runtime/environment/data/config/UI/rendering and both consumers for large modules, duplication and unused paths; deeply inspect concrete candidates and callsites.
- [x] Preserve the exact starting source and builds and identify the native GPU.
- [x] Implement bounded work reduction and ownership cleanup with focused tests and exact-output comparisons.
- [x] Complete matched hardware frame-time, CPU and retained-memory measurements.
- [x] Run standard performance contracts and both package gates against the final candidate.
- [x] Verify final interactions, update Linear and record remaining limits.

This is an audit of the full module map and demonstrated risks, not a claim that every line is optimal. Historical [cleanup coverage](cleanup_coverage.md) and [the September audit](maintainability_audit_2026-09-08.md) informed candidate selection; their old evidence was not treated as current proof. Supported compatibility barrels remain intact. Large geometry/surface kernels retain their current boundaries because splitting them by line count would add numerical/invalidation risk without a demonstrated benefit.

## Findings and target ownership

| Finding | Change | Proof |
| --- | --- | --- |
| Overlay synchronization observes the class/style attributes it writes, risking observer → RAF feedback | Compare current values before writing/removing clearance state; retain geometry and timing-board width | Modeled observer convergence plus native-browser idle follow-up |
| Replay halos rebuild fixed Graphics geometry each frame | Cache tint/effective opacity, keeping all pose and sprite/label updates | 120 moving frames produce zero additional halo rebuilds; changed appearance and removal/recreation covered |
| Timing refreshes rewrite unchanged attributes/classes/styles and append every existing row | Guard writes against DOM values and reconcile keyed positions only when order changes | Gap-only updates produce one text write, no row moves and preserve focus; insertion, removal, order and penalty changes covered |
| Pooled render snapshots still build rank-wrapper/order collections | Direct ranked-then-index-sorted writer with per-target weak scratch | Real-simulation order/identity tests and exact baseline/current frames including excluded participants, DNF and classification |
| Nearby projections and radar lookup are rebuilt per controlled driver | Lazy preparation shared within one observation build; fresh returned records | Multi-driver flags, retained results, limits, ties, car/ghost IDs and direct-vector equivalence |
| Nearby candidates allocate complete payloads before losing the shortlist | Admit by squared distance/order first | Crowded fields, exact radius boundaries, stable ties and zero limits |
| Advanced braking previews repeatedly query identical capacity endpoints | Decision-local lazy reuse of speed-zero and maximum-speed endpoints | Exact controls/trajectories on four tracks; tire/DRS/surface mutation tests; measured query count reduction |
| Display destruction policy is duplicated between app and track layers | `src/rendering/displayLifecycle.js` owns child destruction, preserving shared textures | Real Pixi nested destruction and repeated cleanup |
| Workbench DOM mechanics and sense presentation expand broad entrypoints | Focused controls/disclosure modules and Policy Runner `senseReadout.js` | Existing lifecycle/control suites, focused missing/vector/physical sense cases and full browser smoke |
| Two driver constants and a now-obsolete internal sensor wrapper have no consumers | Remove only proven internal dead declarations after named/import/export screening | Public types, import graph and package gates; no public barrel removal |

The app retains race state, selection, options, camera invalidation and layout orchestration. Control modules accept explicit DOM references, signal and command callbacks, not the whole mutable runtime. Sense presentation reads the active observation only. Snapshot scratch adds no public fields and releases participant references; nearby contexts never persist across builds or mutable snapshots.

`F1SimulatorApp.js` decreases from 1,347 to 1,275 lines; the showcase entrypoint decreases from 3,211 to 3,069. These reductions describe responsibility placement, not a performance metric. Numerical kernels and supported facades are not removed merely to improve counts.

## Semantic and work-reduction evidence

The first serializer/sensor cleanup preserves **5,558,802 serialized bytes** exactly across 160 retained environment results, eight resets, 50 render frames and 50 ghost observations. SHA-256: `ac2bd02e4de2d52498e500f03b5d3d4960a86f0ddd8f4ae2250a739731e4845a`.

Advanced endpoint reuse preserves exact controls and trajectory/observation hashes on the canonical track and procedural seeds 12, 7110 and 7203, each with 1,200 steps and eight advanced cars, including changes to tires, DRS and wheel surfaces between decisions. Lateral-capacity queries fall **1,273,206 → 637,075 (49.96%)**. One real driver decision falls **53 → 14**, with the interior query sequence unchanged. Counting instrumentation is confined to temporary copies; actual tire-force kernels are unchanged.

Three alternating fresh-process runs of the same 10,000-step, 20-car advanced workload report baseline totals 2,290.6 / 2,222.9 / 2,243.6 ms and candidate totals 1,873.5 / 1,869.6 / 1,909.9 ms. Median falls 2,243.6 → 1,873.5 ms, about **16.5%**. This is a measured result for this workload on this machine, not a universal CPU/FPS speedup. Other desktop development activity remains a timing-noise source.

## Hardware-browser measurements

An isolated headed Chrome 154 session reports `ANGLE Metal Renderer: Apple M4 Pro`. Sampling uses a 1,280 × 800 viewport and device/canvas density 2, the built complete workbench, fixed race/track seeds, 60-second intervals, and real Pixi draw callbacks. Each case starts after exactly 600 fixed simulation steps, with matching car-state SHA-256 across sources. Typed arrays bound instrumentation; hooks and observers are restored afterward. Update-work samples measure the runtime callback, while CDP metrics cover broader page task/style/layout costs. Heap samples request GC outside frame-timing intervals.

| Mode | Baseline → final FPS | Draw p95 ms | Draw p99 ms | Gaps over 50 ms | Mean update work ms |
| --- | --- | --- | --- | --- | --- |
| Arcade 1x | 58.57 → 58.51 | 23.0 → 23.7 | 25.5 → 25.5 | 0 → 0 | 0.412 → 0.808 |
| Advanced 1x | 58.53 → 58.53 | 23.7 → 23.4 | 25.6 → 25.5 | 0 → 0 | 0.512 → 0.825 |
| Advanced 10x | 58.57 → 58.60 | 23.5 → 22.8 | 26.3 → 26.3 | 0 → 0 | 1.775 → 1.993 |

Frame pacing is maintained; these data do not establish a browser CPU or FPS improvement. Average callback work rises in these samples even as exact operation counts fall. Broader page task time is mixed: estimated task CPU is 22.09% → 24.82% arcade, 23.18% → 24.36% advanced and 27.71% → 27.12% advanced 10x. This is page task duration divided by elapsed time, not total process, device or GPU utilization. The final arcade sample overlapped the end of the demo smoke gate; a separate baseline/final repeat is retained to examine the variation rather than silently dropping results.

A subsequent arcade pair, without the package gate running, reports FPS 58.60 → 58.49, p95 22.8 → 19.3 ms, p99 25.5 → 25.4 ms, callback mean 0.444 → 0.697 ms and page task CPU 24.16% → 24.70%. The final repeat contains two gaps over 50 ms. The higher callback cost is therefore retained as a measured limitation, not dismissed as a single overlapping-gate artifact or hidden behind the simulation speedup.

An earlier uncontrolled 10x baseline had one 368 ms gap; its raw record remains in the evidence. A diagnostic sample that changed browser density after mounting is excluded because the Pixi canvas retained its old density. Neither sample is used to claim a speedup. The collaborative preview's SwiftShader results do not establish hardware performance.

A canonical stopped-runtime probe observes the complete panel for three seconds after settling: baseline performs **360 class writes**, the final candidate performs **zero class/style writes**, with the private ticker stopped and timing tower still **255 px** wide. This isolates the overlay observer feedback loop from normal racing activity.

## Verification and remaining limits

Focused control/startup/lifecycle, replay/disposal, observer, render-order, nearby and advanced pace tests pass. Independent review finds no ordering, aliasing, stale-cache or precision issue in the current simulation/environment changes. A nearby configuration with `maxCars: 0` still prepares one context; this minor overhead is retained to avoid widening the change.

`npm run check` passes **75 files, 1,195 fast tests**, with 93 intentionally deferred slow cases, public types, dry pack, fresh packed-consumer install/build, bundle boundaries, both consumer builds, quick Chromium smoke and complete demo smoke. The final standard runtime benchmark validates all **23 cases**. Three earlier alternating baseline/candidate runs also preserve every non-timing contract across all 23 cases; timing-valued diagnostic fields are explicitly excluded from equality checks. `npm run check:release` passes all **75 exhaustive batches / 1,288 tests**, four dependency audits with zero vulnerabilities, types/pack/consumers/builds, the full Chromium showcase matrix and complete demo smoke. Source changes preceded both final gates; subsequent changes only document evidence.

Native focus acceptance updates one actual timing gap text node with zero row moves and the same focused button. This guarantee concerns unchanged ordering; actual reordering can still blur a moved row and remains a preexisting interaction limitation. Native interaction at **390 × 844** additionally exercises telemetry open/close, timing reveal, Budget Buddy selection, interval-to-leader gap switching and Overview camera; document width remains 390 px with all ten rows present. The painted native screenshot is `output/playwright/final-narrow.png`.

After two warm-up mounts, **ten native GPU mount/destroy cycles** leave nodes **3,131 → 3,131**, listeners **94 → 94**, documents **1 → 1** and the existing page canvas count **2**. Post-GC heap rises 99.94 → 100.86 MB, so this does not claim zero heap growth. Each temporary controller mounted one hardware-rendered canvas and removed it on destroy. Private GPU/driver allocation retention is not quantified by these JavaScript/CDP metrics.

The final **five-minute, eleven-sample** advanced-mode soak performs ten seeded restarts with alternating driver selection and drawer state. Nodes remain within **3,131–3,135** and finish at **3,131**; listeners **94**, documents **1**, and canvases **2** are constant throughout. Heap starts at 74.32 MB immediately after restart, warms to 102.18 MB, briefly reaches 129.29 MB, then returns to 103.10 MB. Samples three through ten stay within **102.99–103.36 MB**; final heap is **103.36 MB**. This supports bounded retention over the measured window, not a guarantee for unlimited runtimes or all GPU allocations. The exhaustive package gate runs in parallel with the retention probe; it is excluded from native frame-time repeat measurements.

 All temporary comparisons, raw profiles, browser records and inventory are under `/tmp/paddock-v11-efficiency-20261013-pass2/`; CLI probes live in ignored `output/playwright/`.

The broader numerical geometry/surface kernels remain large; the pass does not claim complete architectural decomposition. No new browser CPU/FPS gain is claimed, and the callback-cost increase remains a useful profiling follow-up. Existing release-only publishing/lock synchronization items in `v11_improvements.md` remain outside this optimization task. Original v11 stays clean at the approved starting commit, while all candidate changes remain uncommitted without an upstream.

The PaddockJS Linear project document was updated with task, implementation, verification and remaining limits: [v11 improvement pass](https://linear.app/mgiorgetti/document/v11-improvement-pass-racecraft-render-cost-and-lifecycle-reliability-b6c4a20b8501). Temporary browser/profiling servers are closed; the candidate demo remains available at `http://127.0.0.1:4181/`.

Subsequent skill-dependent physical-envelope tuning, timing-line boundary repair and measured limitations are documented in [limit driving, 2026-10-14](limit_driving_2026-10-14.md). Earlier results above describe their recorded candidate.
