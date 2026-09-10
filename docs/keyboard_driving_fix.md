# Advanced lab keyboard driving

## Scope and ownership

This change fixes manual driving in the demo's `#expert` lab. It preserves the
vehicle integrators, both AI controllers, normalized public policy actions,
observation precision, package layout and automatic arcade demos.

- `demo/src/runtime/expertKeyboard.js` owns held keys, progressive key travel,
  pedal commands, focus cleanup and human-only traction assistance. Its only
  vehicle inputs are the active observation's speed, grip usage and applied
  throttle; outputs remain ordinary normalized actions.
- `demo/src/runtime/expertFrameScheduler.js` owns 60 Hz wall-time pacing and
  cancellation. It preserves deadlines across display frames and discards
  accumulated delay after a stall. It has no simulation or input state access.
- `demo/src/runtime/expertLab.js` supplies that scheduler to the existing
  controller loop. The public loop's default scheduler remains unchanged.

## Verified causes and bounded fixes

1. The lab used one fixed 1/60-second simulation step per animation callback.
   The observed browser delivered 120 callbacks in 987.5 ms, making manual
   driving approximately twice as fast as real time. The explicit lab scheduler
   produces 60 steps/second on 60, 120, 144 and 165 Hz display schedules. It never
   performs multiple catch-up steps in one callback. Slow rendering may still
   slow playback; it does not accelerate input after a stall.
2. The keyboard ramped an already speed-limited steering angle. At 200 km/h,
   its allowed normalized lock is only about 0.047, reached from center in about
   0.052 seconds at the old 0.9/second rate. A short tap therefore reached full
   allowed steering. The controller now ramps normalized key travel first and
   then applies the existing speed-dependent lock. Full held-key lock is
   preserved, while brief taps are small at every speed.
3. Holding the digital accelerator while turning could saturate rear tire
   forces and spin the car. A fixed steering-dependent throttle reduction was
   tested and rejected because it still spun at 30–100 km/h. The retained
   keyboard assistance reduces throttle from observed applied demand when
   reported grip usage exceeds 0.9, reserving a margin of 0.85 divided by that
   usage. Normal progressive throttle recovery resumes as grip permits. This
   assistance does not steer toward the track, write vehicle state, add grip or
   alter the commands received from external policies.

## Measurements

Before/after steering maneuvers used the same normalized demo car, asphalt
contact patches, seed 171, track seed 7301, fixed 1/60-second integration,
2-frame keyboard action repeat and disabled tire degradation. Each coasting
maneuver held right for 0.3 seconds and settled for 0.7 seconds. These are
handling measurements, not CPU-performance improvements or lap-time claims.

| Initial speed | Old peak lateral acceleration | New peak lateral acceleration | Old heading change | New heading change |
| --- | --- | --- | --- | --- |
| 80 km/h | 1.35 g | 0.42 g | 10.3° | 2.7° |
| 150 km/h | 1.60 g | 0.39 g | 8.0° | 1.7° |
| 250 km/h | 1.72 g | 0.36 g | 4.9° | 1.0° |

Combined accelerator/steering characterization covered four car configurations,
five initial speeds (30, 60, 100, 160 and 220 km/h), and 0.3-second taps or
2-second holds followed by 0.7-second recovery. The retained normal-throttle-rise
feedback variant kept peak body slip below 0.057 radians across all 40 cases.
The original controls reached approximately 3.14 radians. A slower throttle-rise
variant reduced pedal cycling but added another steering-dependent rule without
improving the slip envelope, so it was not retained.

In the actual 120 Hz browser, the old 300 ms coasting right tap reached 132%
reported grip usage and left the track during the following 700 ms. With the
new controls and pacing, the same input reached approximately 23% reported usage,
settled on track, and the lab displayed approximately 60 FPS. A combined
accelerator/right/left/release/braking sequence stayed on track. Losing focus clears held inputs but does not pause the race; with two-frame
action repeat, one previously held action frame can precede neutral input.
Tire saturation indicators can still appear transiently; this is assistance, not immunity from
spins, missed corners or crashes.

## Verification

Baseline `npm run check` passed: 1,051 fast tests, 93 slow skips, public types,
dry pack, packed consumer, bundle boundaries, showcase/demo builds and browser
smokes. Existing build chunk-size warnings are unrelated. No pre-existing gate
failure was found.

Thirteen physical keyboard regressions pass; substituting the preserved original
keyboard handler makes eleven fail. These tests use actual demo car normalization
and snapshot-derived body senses through keyboard actions, public action
normalization and the unmodified advanced integrator. They cover mirrored taps,
combined acceleration/turning, release, countersteering and exact replay.

Final `npm run check` passed: 1,078 fast tests, 93 slow skips, public types,
pack/consumer/bundle boundaries, both builds, quick Chromium and the expanded
demo driving smoke. `npm run check:release` passed all 1,171 tests across 64 files, the same package
gates, the full Chromium matrix and the expanded demo smoke. Input tests cover speed-independent short key taps,
countersteering, release, observed-load throttle relief, focus/visibility and
disposal; scheduler coverage includes refresh rates, long stalls and cancellation.
The demo smoke now physically presses left/right and checks settling and track
surface, then checks that accelerator input clears when focus leaves the lab.

Reproduction artifacts for this session are in
`/tmp/paddockjs-keyboard-20260909/` and
`/tmp/paddockjs-manual-steering-20260909/`. Existing repository changes were
preserved; no Git or GitHub mutation is part of this fix.

## Changed files and handoff

The three demo runtime files above contain the control changes.
`src/__tests__/expertKeyboard.test.js`, `expertKeyboardDriving.test.js`,
`expertFrameScheduler.test.js` and `demoLifecycle.test.js` verify input, physical
response, cadence and wiring. `smoke/demo-smoke.mjs` verifies actual browser keys.
`demo/index.html`, `demo/README.md`, `docs/rules.md`, `docs/architecture.md` and this
report document the new human-only behavior.

Read-only Git inspection: branch `v11` at `fedff4eec4e213f910748d67282542120454354c`,
123 modified tracked files, 53 untracked entries and an empty index. The locally
recorded upstream comparison is 0 ahead / 0 behind; no fetch was performed. All
117 simulation JavaScript files hash-identically to this task's baseline.

Review and staging/commit proposals remain separate approval-gated Git actions.
The repository already contains extensive ongoing work; this fix does not claim
the entire repository is clean or ready to publish.
