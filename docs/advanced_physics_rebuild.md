# Advanced physics rebuild

Follow-up: the [advanced AI pace report](advanced_ai_pace.md) records the September 9 controller changes and current driving measurements. The vehicle force model from this rebuild is unchanged.

Status: implementation complete; local package and exhaustive release gates passed. Driving feel remains subject to user feedback and the documented model approximations. Arcade remains the default and its trajectories must remain unchanged.

## Target and scope

Build a deterministic planar Formula-style racing car using the existing 3.6 m wheelbase, 798 kg baseline setup and DRS-era package contract. This is a handling model, not a claim of matching a particular team's confidential tire/aero data. The model must earn its realism through measured response, not a label. Suspension travel, vertical jumps, tire carcass/temperature simulation and detailed gearbox/electrical deployment are outside this planar model.

## Checkable plan

- [x] Inspect dirty Git state and preserve a separate pre-change source snapshot under `/tmp/paddockjs-advanced-rebuild-20260908/baseline`.
- [x] Audit vehicle, AI, external controls, telemetry and lifecycle boundaries; start the existing package baseline gate.
- [x] Replace the advanced integrator with four contact-patch forces, yaw inertia, longitudinal/lateral load transfer, nonlinear combined tire forces, rear drive and physically scaled aerodynamic resistance/load. Keep arcade integration byte-for-byte intact.
- [x] Measure straight-line acceleration/braking, steady cornering, transient steering, force saturation, coast-down, rest/reverse behavior and timestep convergence. Add meaningful regression bounds and an executable characterization report.
- [x] Adapt advanced-only AI steering/pace/recovery to physical wheel angles and tire capacity; validate actual multi-car demo seeds, safety-car and pit transitions.
- [x] Check advanced contacts and manual keyboard lifecycle; preserve public normalized actions and exact model-sense visualization ownership.
- [x] Update authoritative rules/architecture/contracts and the advanced demo description. Record results in Linear.
- [x] Run `npm run check` and `npm run check:release`, packed-consumer and browser checks, repeat representative runtime measurements, and report every remaining failure honestly.

## Ownership and data flow

`vehiclePhysics.js` selects the public physics mode and retains arcade implementation. Feature-owned advanced modules own physical setup, tire/contact forces and rigid-body integration. Inputs are the current vehicle state, physical wheel-angle/throttle/brake commands, four sampled road surfaces and timestep; outputs update the existing world pose/velocity, yaw rate, speed, tire energy and physics telemetry. Calculations use SI internally, converting world coordinates/velocity at the boundary.

Tire forces come from local contact velocity and normal load. Their force/moment sums accelerate the body; yaw is not assigned from an ideal turn radius. Surface forces are per wheel rather than an averaged surface. Public vehicle setup fields retain their units: `powerNewtons` is a force parameter used to derive a bounded engine-force curve; it is not relabeled as watts. Setup and model constants must have documented units.

Driver policy owns desired path/speed and actuator commands, never pose correction or extra grip. Browser keyboard conditioning belongs at the human input boundary and must not alter environment policy actions. Race/pit/reset/contact modules retain lifecycle ownership; any new persistent state must have explicit reset rules. Prefer forces derived from the existing current state over hidden history.

## Verification criteria and risks

Require exact arcade replay checks, deterministic advanced replays, finite zero-speed behavior, no braking-induced reverse launch, passive force energy dissipation, left/right symmetry, force capacity and load conservation, smoother timestep convergence, faster/harder high-speed braking from aero load, and reduced combined cornering authority under throttle/braking. Compare countersteer against a matched initial slip/yaw state rather than assuming an arbitrary old full-lock sequence must end stable.

Record acceleration/braking distances, speeds and G values before selecting final calibration bounds. Use published performance only as broad plausibility context, since tracks, tires, aero and driver actions differ. Full-field completion, legal-surface time and progress matter alongside unit dynamics. Existing old-model steering-scrub/status assertions may need intentional replacement by these physical behaviors; do not simply delete failing coverage or weaken lifecycle/API assertions.

## Physical references

- [MathWorks Vehicle Body 3DOF](https://www.mathworks.com/help/vdynblks/ref/vehiclebody3dof.html): force/moment balance, wheel-frame transformations and normal-load transfer.
- [Project Chrono tire models](https://api.chrono.projectchrono.org/wheeled_tire.html): nonlinear tire models, combined slip and the importance of low-speed treatment. The implementation here is a simplified force-based brush approximation, not a calibrated Chrono/Fiala tire dataset.
- [Formula 1 braking performance explanation](https://www.formula1.com/en/latest/article/rob-smedley-explains-how-the-new-aws-braking-performance-graphic-works-and.3A8cnQLZGXFbMjCR2fFBnB): downforce-dependent braking and peak deceleration context.


## Calibration and verification evidence

The baseline `npm run check` passed: 955 fast tests, 84 intentional slow skips, types, package/consumer/build checks and both browser smokes. After the rebuild, the fast test stage passes 1011 tests with the same 84 slow skips; complete package/release results are pending below.

Run `node scripts/characterize-advanced-physics.mjs` for deterministic open-loop handling measurements. Pass a source-root argument to run the same maneuvers against a preserved implementation. At 60 Hz with tire wear disabled, the default 798 kg setup (43000 N power rating, 59000 N braking, 6.1 aero, 0.33 drag, 2.35 grip) gives these local characterization results:

| Maneuver | Previous advanced | Rebuilt advanced |
|---|---:|---:|
| 0–100 km/h, DRS closed | 1.83 s | 2.82 s |
| 0–200 km/h, DRS closed | 3.85 s | 5.10 s |
| 0–300 km/h, DRS closed | 7.78 s | 13.42 s |
| 100–below 1 km/h braking | 16.6 m / 1.25 s | 20.0 m / 1.52 s |
| 200–below 1 km/h braking | 59.4 m / 2.28 s | 59.7 m / 2.48 s |
| 300–below 1 km/h braking | 120.6 m / 3.18 s | 99.0 m / 3.07 s |


These are measured simulation outcomes, not claims of matching a named real car or performance optimizations. No traction-control/ABS system or wheel rotational state is modeled. Tire-force saturation and sliding-brake direction are approximations. Human keyboard steering/pedals are conditioned outside physics; human feel still needs driving feedback.

The new unit coverage verifies static load conservation, transfer direction, load sensitivity, combined adhesion bounds, braking slip direction, near-rest force/energy stability, passive forward/reverse/sideways motion, default simultaneous throttle/brake holding, left/right symmetry, low-speed wheelbase curvature, 60/120 Hz convergence, actual velocity/G telemetry, and deterministic replay. The old arbitrary full-lock zig-zag-stays-stable and fixed-countersteer-sequence expectations were intentionally replaced with actual slip reporting and matched initial oversteer recovery. Kerb/mixed-surface comparisons now separate coasting/straight-line traction from turning: lower lateral grip can reduce turning-induced speed loss, so speed ordering under unrelated trajectories was not a sound physical invariant.

Advanced contacts pass normal-impulse, momentum, yaw-energy, symmetry, fixed pit ownership and existing contact-event/render-pose checks, including 64 deterministic oblique contacts. A separate 20,000-case seeded passive vehicle probe found no energy increase. A review found and fixed double-spending of the low-speed stopping impulse by braking and rolling resistance; track/gravel brake+steer+yaw tests now cover that case.

All six actual ten-car demo fields survive 180 simulated seconds without DNFs; existing advanced legal-surface/recovery tests also pass. The new controller accounts for its intended passing/correction curvature, not only centerline curvature. An independent ten-car safety-car workload stays on legal surfaces with zero DNFs. Longer-race results are recorded separately when available. All six arcade public snapshot hashes match the pre-rebuild states, and the arcade integrator/controller body remain unchanged.


The rigid-body origin is the same centered chassis point used by wheel sampling, rendering, collisions and public pose/velocity. The model therefore uses a centered 50/50 static mass approximation and derives its 3.6 m wheelbase / 1.52 m tire-center track width from canonical geometry. Front aero balance (44%) and brake balance (57%) remain independent. This is deliberately not a strict F1 weight-distribution replica; introducing an offset CG would require consistent transforms across all pose/velocity/contact/sensor boundaries. A direct wheel-center equality regression protects this alignment.


Final extended-race characterization: all 60 cars finished across the six actual demo configurations, with zero DNFs. Hero completed in 900.43 simulated seconds; other races finished within 631 seconds. This exercises standing starts, tire wear and pit service, and remains a finite six-seed acceptance set. The first long run exposed worn-gravel AI drive demand below rolling resistance; the fix compensates at low speed within remaining rear-tire adhesion and has a regression that failed before the correction.


## Changed files in this rebuild

Existing ongoing changes were preserved. This rebuild changed these pre-existing files relative to its own source snapshot:

- `README.md`
- `demo/README.md`
- `demo/index.html`
- `demo/src/data/featureCatalog.js`
- `demo/src/runtime/expertLab.js`
- `docs/architecture.md`
- `docs/concepts.md`
- `docs/data_contract.md`
- `docs/rules.md`
- `docs/system_specs.md`
- `smoke/demo-smoke.mjs`
- `src/__tests__/physicsMode.test.js`
- `src/__tests__/vehiclePhysics.test.js`
- `src/simulation/driver/driverController.js`
- `src/simulation/driver/racingControls.js`
- `src/simulation/driver/rejoinControls.js`
- `src/simulation/driver/safetyCarControls.js`
- `src/simulation/vehicle/contactResolution.js`
- `src/simulation/vehicle/vehiclePhysics.js`

New files:

- `demo/src/runtime/expertKeyboard.js`
- `docs/advanced_physics_rebuild.md`
- `scripts/characterize-advanced-physics.mjs`
- `src/__tests__/advancedContactResponse.test.js`
- `src/__tests__/advancedDriverControls.test.js`
- `src/__tests__/advancedTireForces.test.js`
- `src/__tests__/advancedVehicleDynamics.test.js`
- `src/__tests__/expertKeyboard.test.js`
- `src/simulation/driver/advancedPathControls.js`
- `src/simulation/driver/advancedRacingControls.js`
- `src/simulation/vehicle/advancedContactResponse.js`
- `src/simulation/vehicle/advancedTireForces.js`
- `src/simulation/vehicle/advancedVehicleModel.js`
- `src/simulation/vehicle/advancedVehiclePhysics.js`


Compatibility note: advanced trajectories and grip-response distributions intentionally change. Previously trained advanced policies need reevaluation or retraining; preserving the observation/action schema does not promise identical policy behavior. Arcade remains the compatibility/default mode.


## Final package and browser verification

The final `npm run check` passed: 1,015 fast tests with 84 intentional slow skips, public types, dry-pack, fresh packed-consumer installation/build and subpath boundaries, showcase/demo builds, quick Chromium and demo smoke. The final `npm run check:release` passed all 1,099 tests across 59 files with no skips/failures, plus the exhaustive Chromium matrix and demo smoke. The previous task's resource-related test/browser failures did not recur in this baseline or final verification.

A separate live demo check launched the Advanced physics lab, focused the race, applied throttle and steering, observed active controls and speed response, and confirmed zero held keys after blur with no runtime errors. This validates input wiring/lifecycle, not a substitute for subjective driving feedback. The local preview remains available at `http://127.0.0.1:4173/#expert`.

Logs and characterization artifacts are under `/tmp/paddockjs-advanced-rebuild-20260908/`; long-race and arcade-equivalence JSONL evidence is under `/tmp/paddockjs-demo-crashes-20260908/`. No original source file was removed. This rebuild changed 19 pre-existing files and added 14 files, separate from the substantial changes already present when it began.


## Runtime measurements

Six paired standard benchmark runs used the same Darwin/arm64 host, Node v24.13.0, benchmark script/profile, seeds and settings; before/after execution order alternated. All 22 benchmark workloads and invariant checks passed for all 12 runs. The before source snapshot uses unchanged package metadata and showcase policy helpers needed by the existing benchmark. These whole-workload totals include setup and changed simulation trajectories, so they are not isolated per-function costs or browser FPS predictions.

The advanced-field workload median rose from 96.47 to 108.33 ms (+12.3%); the headless vector workload from 74.71 to 90.82 ms (+21.6%). The non-overlapping ranges show real added work in these workloads. This is an intentional richer-model cost, not a speed improvement. No unrelated optimization was introduced to mask it. The full browser matrix and separate live keyboard workload passed; browser throughput was not compared against a separately rebuilt old bundle.

| Existing benchmark workload | Before median [min–max], ms | After median [min–max], ms |
|---|---:|---:|
| simulation.step advanced field | 96.47 [94.32–100.27] | 108.33 [105.51–112.18] |
| simulation phase profile | 65.33 [64.37–66.58] | 77.09 [75.19–80.49] |
| timing history and line maintenance | 13.67 [12.94–15.12] | 14.35 [13.79–14.92] |
| timing-line gap without stored crossings | 0.27 [0.25–0.30] | 0.32 [0.27–0.40] |
| lap telemetry in-progress sync | 11.93 [11.41–12.99] | 14.49 [14.04–16.26] |
| pit route transition geometry | 3.74 [3.46–3.86] | 3.83 [3.64–4.05] |
| collision candidate and narrowphase | 20.93 [20.21–23.33] | 22.45 [21.91–23.93] |
| nearest track query index | 72.31 [70.09–74.25] | 72.67 [70.57–128.58] |
| sensor ray road and surface channels | 10.39 [10.08–10.74] | 11.37 [11.06–17.60] |
| batch-training sensor surface channels | 5.55 [5.29–5.86] | 5.33 [5.18–5.44] |
| sensor ray barrier illegal-surface validation | 3.54 [3.15–3.80] | 4.06 [3.89–4.50] |
| sensor ray barrier off-track recovery | 4.52 [4.38–4.73] | 4.81 [4.34–5.11] |
| sensor ray pit-lane direct boundary | 1.23 [1.04–1.44] | 1.33 [1.16–1.59] |
| wheel surface near pit connector | 3.81 [3.71–4.14] | 4.10 [3.86–4.65] |
| wheel surface connector local-refresh path | 0.95 [0.76–1.02] | 0.91 [0.77–1.04] |
| wheel surface main-track analytic | 0.63 [0.59–0.74] | 0.63 [0.54–1.03] |
| headless environment vector step | 74.71 [74.25–80.27] | 90.82 [88.62–94.95] |
| snapshot construction | 10.24 [10.07–11.17] | 14.05 [13.87–14.62] |
| snapshot JSON serialization | 129.32 [128.66–140.25] | 130.38 [128.74–133.94] |
| policy server compact JSON transport | 94.07 [91.18–100.21] | 94.99 [92.80–100.15] |
| render snapshot interpolation | 5.26 [4.78–5.89] | 6.00 [5.65–6.51] |
| timing tower row markup | 9.39 [8.93–10.67] | 11.31 [10.57–12.25] |


## Read-only Git handoff

Branch `v11` at `fedff4e`; locally recorded upstream `origin/v11`, ahead/behind `0/0`. No fetch was performed, so remote freshness is unknown. The index is empty. There are 122 modified tracked paths and 40 untracked status entries, including the ongoing work that predated this rebuild. No Git/GitHub mutation was performed.

Next Git/GitHub step is review of the bounded rebuild diff alongside existing changes. Staging, branch/commit/push/PR actions remain unexecuted and require the exact action/target approval specified in AGENTS.md. Remaining product work is subjective driving feedback and any later decision to add full wheel rotation, suspension/vertical dynamics, calibrated real-car datasets or offset-CG transforms; none is silently claimed here.
