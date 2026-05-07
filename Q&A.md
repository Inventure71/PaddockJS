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

## Q23

Question: Is `0.3.0` only responsible for the JavaScript environment API, or should it also include a real Python Gym/Gymnasium wrapper?

Answer: For `0.3.0`, ship the JavaScript environment API and document it as Gym-style/Gym-ready. Do not ship a Python Gymnasium wrapper yet. Create a follow-up issue for a Python Gymnasium bridge after the JS environment contract is stable. Until that bridge exists, examples should say "JavaScript environment" or "Gym-style" rather than implying a Python package.

## Q24

Question: Should the headless environment import from the package root, or should it have a separate export path that avoids browser/Pixi/CSS code?

Answer: Use an environment subpath only, with strong documentation. `createPaddockEnvironment()` should be imported from `@inventure71/paddockjs/environment`, and that subpath must avoid browser, Pixi, DOM, and CSS dependencies.

## Q25

Question: Should browser expert mode reuse the exact same `PaddockEnvironment` instance internally, or should it adapt the existing `F1SimulatorApp`/`RaceSimulation` instance to look like the environment API?

Answer: Create a basic shared environment runtime layer over `RaceSimulation` that can be reused by both the visual web environment and the headless training environment. Browser expert mode should adapt the existing visual `RaceSimulation` instance instead of creating a second simulation.

## Q26

Question: Should browser expert mode pause/disable the visual ticker completely and render only after `expert.step()` or `expert.reset()`?

Answer: Yes. When `expert.enabled` is true, the visual ticker should not advance simulation automatically. The canvas updates only when expert code calls `reset()` or `step(actions)`.

## Q27

Question: If `controlledDrivers` is omitted, should the environment control no cars, the first car, or all cars?

Answer: Require explicit `controlledDrivers` for training/control. If omitted in `createPaddockEnvironment()` or browser `expert.enabled` mode, throw a clear error instead of guessing.

## Q28

Question: What should happen to non-controlled cars by default: built-in AI, frozen/static obstacles, or removed from the training scenario?

Answer: Default non-controlled cars to built-in AI. Also allow explicit scenario options for non-controlled cars to be off/static obstacles and for the environment to include only controlled cars rather than the full driver field.

## Q29

Question: Should training scenario options be a separate `scenario` config, instead of overloading `drivers`, `entries`, or `controlledDrivers`?

Answer: Use a separate `scenario` object. `drivers` define available data, `controlledDrivers` define externally controlled cars, `scenario.participants` defines which cars spawn in the episode, and `scenario.nonControlled` defines behavior for spawned cars that are not externally controlled.

## Q30

Question: Should sensor configuration be global for all controlled cars, or configurable per controlled driver?

Answer: Support global sensor config first, with optional per-driver overrides only if explicitly provided. The effective observation schema should be reported per driver so users know the exact object/vector shape used for training.

## Q31

Question: For `scenario.nonControlled: 'static-obstacles'`, how should obstacle cars be placed?

Answer: Static obstacles should use normal participant cars, but their movement controls are forced to brake/zero throttle. If no placements are provided, they spawn on the normal grid and stay still. Optional `scenario.placements` can position obstacle cars by progress meters, offset meters, and heading mode.

## Q32

Question: What minimum detail must collision and off-track events include for training?

Answer: Events should include enough structured data for reward functions without implementing a full stewarding system. Collision events should include participants, severity, relative speed, and contact point. Off-track events should include driver ID, surface, and track offset. Return transition events such as `off-track` and `rejoined-track`, and include current `onTrack`/surface state in every observation.

## Q33

Question: Should PaddockJS execute an optional user-provided reward callback, or should it never calculate reward and only return state/events/observations?

Answer: Support optional user-provided reward callbacks, but no built-in reward preset in `0.3.0`. If no callback is provided, `result.reward` should be `null`. If a callback is provided, return rewards keyed by controlled driver ID.

## Q34

Question: What examples must ship with `0.3.0` so this API is understandable and testable?

Answer: Create one executable example that uses the expert environment API and can also serve as the project smoke test for understanding whether the feature works.

## Q35

Question: Should the one executable example be headless-only, browser-visual-only, or both in one page/script?

Answer: The example should have the option to run both headless and visual modes, so users can understand the training API and also see the same expert-driven environment rendered visually.

## Q36

Question: In the example, should visual mode auto-play steps on a timer, or require a manual "step" button by default?

Answer: Manual step should be the default, but the example should include a setting to auto-run steps as well.

## Q37

Question: For the first `0.3.0` implementation, should we ship the complete expert environment in one large slice, or split it into a minimal first slice plus follow-up issues?

Answer: Split it, but make the first slice genuinely useful. The first slice should include `@inventure71/paddockjs/environment`, `createPaddockEnvironment()`, `reset()`, `step()`, `getObservation()`, `getState()`, explicit `controlledDrivers`, direct normalized controls, manual stepping plus `frameSkip`, object observations with real units, full state, global/per-driver events, optional reward callback, basic rays and nearby cars, race-rule overrides for existing rules, and executable headless/visual examples. Follow-ups should include advanced scenario placements, static obstacle refinements, deeper debug mutation API, Python Gymnasium bridge, and assisted control modes.

## Q38

Question: Is browser expert mode itself part of the first slice, or should the first slice be headless-only with the visual example added later?

Answer: Include browser expert mode in the first slice, but keep it narrow. Support `expert.enabled`, `expert.controlledDrivers`, automatic ticker disabled, `simulator.expert.reset()`, `simulator.expert.step(actions)`, `simulator.expert.getObservation()`, and `simulator.expert.getState()`. Do not include debug mutation, scenario placements, or assisted control in browser expert mode yet.

## Q39

Question: For the first slice, should scenario support be limited to participant selection and AI non-controlled cars only?

Answer: Yes. First-slice scenario support should include `scenario.participants` as `'all'`, `'controlled-only'`, or a string array, and `scenario.nonControlled: 'ai'` only. Defer static obstacles, placements, ghost cars, and direct scenario mutation.
