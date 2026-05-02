## Q1

Question: Is the `0.3.0` Car API primarily for external observation/telemetry, or should it support real external control loops for training an AI/model to drive a car?

Answer: The API update should be a Gym-ready expert system. Users should have full access to the simulator through an expert area that can be turned off when not needed.

## Q2

Question: Should `createPaddockEnvironment()` be a first-class public export in `0.3.0`, separate from `mountF1Simulator()` and usable without DOM/Pixi?

Answer: Yes. Add `createPaddockEnvironment()` as a first-class public API, and make browser expert mode a wrapper around that same environment contract.

## Q3

Question: Should `createPaddockEnvironment()` be single-agent by default, multi-agent by default, or explicitly support both modes?

Answer: Explicitly support both modes with `controlledDrivers`, where `step()` accepts actions only for controlled drivers, returns observations and rewards keyed by controlled driver ID, and all non-controlled cars continue using the built-in driver AI.

## Q4

Question: Should PaddockJS provide a built-in default reward function, or should reward calculation be entirely host/user-defined?

Answer: Reward calculation should be user-defined. PaddockJS should expose all useful simulator state needed for training, and users should build their own reward functions. Optional reward adapters may exist later, but the core expert API should not force one reward design.

## Q5

Question: Should the expert environment return one large full simulator snapshot to every controlled driver, or should it return two layers: a full global state plus per-driver observations?

Answer: Unresolved. The goal is a web-based F1 simulation environment where custom models can drive cars, users can train models in the environment, and the API exposes enough external control and sensing to support that. Candidate data includes collisions, configurable car rays, car position, other-car positions, car rotation, other-car rotations, speed, and related driving state.

## Q6

Question: Should the agent observation be based on realistic sensors by default, with full simulator truth available separately for debugging and reward calculation?

Answer: Yes. Default model input should be sensor-style observation, and full simulator truth should live separately under `state`.

## Q7

Question: Should the default observation use a compact numeric shape suitable for ML training, or a readable object shape suitable for JavaScript users?

Answer: Provide both. Object observations should be the readable source of truth, and each controlled driver observation should also include a numeric `vector` plus a `schema` so training loops can consume fixed numeric input directly.

## Q8

Question: Should model actions use normalized control values, or physical units?

Answer: Use normalized controls as the public action space: `steering` from `-1` to `1`, `throttle` from `0` to `1`, and `brake` from `0` to `1`. PaddockJS maps normalized steering to the simulator's internal steering limits. Do not include DRS, pit request, ERS, tire strategy, or team orders in the `0.3.0` action space.

## Q9

Question: When a controlled driver's action is missing or invalid during `env.step()`, should the environment fail loudly, reuse the previous action, or fall back to built-in AI?

Answer: Support both strict and non-throwing behavior. The default should fail loudly. An explicit relaxed mode should continue running and return a simple message/report about the invalid or missing action instead of silently falling back to AI.

## Q10

Question: What should end an episode: only race finish, or also severe driving failures like repeated collisions/off-track/stuck behavior?

Answer: Use configurable episode rules with conservative defaults. Race finish should set `terminated`. Max steps or controlled-car stuck behavior should set `truncated`. Collisions and off-track events should not end the episode by default; they should be returned as events. Include a convenience `done` alias and an `info.endReason`.

## Q11

Question: Should `reset()` require explicit seeds for reproducible training, or should it allow random resets by default?

Answer: Allow both explicit and generated seeds. Fixed `seed` and `trackSeed` should make runs reproducible for the same actions. If seeds are omitted, PaddockJS may generate them, but `reset()` must report the actual `seed` and `trackSeed` used so the run can be reproduced later.

## Q12

Question: Should browser expert mode be opt-in only, or should every mounted simulator expose `simulator.expert` by default?

Answer: Browser expert mode should be opt-in only. Normal mounted simulators should stay simple. When expert mode is not enabled, `simulator.expert` should be `null`; the headless `createPaddockEnvironment()` API implies expert capability.

## Q13

Question: In browser expert mode, should `expert.step(actions)` manually advance the simulation, or should it only set controls while the normal visual ticker keeps advancing time?

Answer: Expert mode should use manual stepping. The user is responsible for saying "next tick" by calling `step(actions)`. Avoid mixing expert stepping with automatic visual ticker advancement.

## Q14

Question: Should each `step(actions)` advance exactly one fixed physics tick, or should users be able to configure frame-skip, like "apply this action for 4 ticks"?

Answer: Each `step(actions)` should advance one fixed tick by default, with optional configurable positive-integer `frameSkip` / action repeat. `step()` should apply the action, advance `frameSkip` fixed simulation ticks, return the final observation, and include accumulated events from all internal ticks.

## Q15

Question: Should the expert API allow users to mutate simulator state directly, or only control cars through actions and read full state?

Answer: Expose direct simulator-state mutation as an expert option. The normal training flow should still be `reset()`, `step(actions)`, `getObservation()`, and `getState()`, but expert users should be able to opt into mutation/debug controls for scenarios and advanced experiments.

## Q16

Question: Should the model-facing observation vector use car-relative normalized values by default, or raw world coordinates and raw simulator units?

Answer: Unresolved. The user disagrees with fully standardized/normalized values because normalization can hide important physical differences. For example, if speed is normalized by a car-specific max speed, changing max speed without changing handling could make the model learn the wrong relationship.

## Q17

Question: Should the default observation object use real physical units, while the optional training vector uses fixed, documented scaling based on global simulator constants rather than per-car normalization?

Answer: Yes. Default observations should use real physical units such as kph, meters/second, meters, and radians. Optional vectors may use fixed, documented scaling based on global simulator constants, but should not use hidden per-car normalization unless explicitly requested by the user.

## Q18

Question: Should ray sensors detect only track boundaries, only cars/obstacles, or both in the same ray result?

Answer: Rays should detect both track boundaries and cars, with separate `track` and `car` result fields. Default rays should be configurable and include angles like `[-75, -45, -20, 0, 20, 45, 75]`, a sensible range such as 120 meters, and options to enable or disable track and car detection.

## Q19

Question: Should events be returned globally only, per controlled driver only, or both?

Answer: Return both global step events and per-controlled-driver events. Global events give race-wide context; per-driver events make reward functions and agent feedback easier without forcing users to filter every event manually.

## Q20

Question: Should external model control fully replace the built-in driver AI, or should PaddockJS offer optional driver-assist modes?

Answer: For `0.3.0`, external model control should default to full replacement of the built-in driver AI for controlled cars. Design the API so explicit assist modes can be added later, but do not make assists part of the first required scope.

## Q21

Question: Should the expert API be a small flat environment object, or split into namespaces like `env.controls`, `env.sensors`, `env.debug`, and `env.state`?

Answer: Keep core Gym-like methods flat, such as `reset()`, `step(actions)`, `getObservation()`, `getState()`, and `destroy()`. Put advanced or dangerous tools behind namespaces such as `debug`, `sensors`, and `controls`.

## Q22

Question: Should `step(actions)` return a Gymnasium-like result shape exactly, or a PaddockJS-specific shape that is close to Gym but more JavaScript-friendly?

Answer: Use a JavaScript object that maps cleanly to Gymnasium concepts. Include `observation`, `reward`, `terminated`, `truncated`, `done`, `events`, `state`, and `info`. Reward may be `null` unless the user supplied a reward function. The shape should be Gym-ready but idiomatic for JavaScript and multi-agent use.
