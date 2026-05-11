# Bring Your Own Model

PaddockJS does not train models for you. It provides a simulator environment contract so users can train with any toolchain, then run the resulting policy in the visual simulator.

## Boundary

PaddockJS owns:

- deterministic simulator stepping
- observations
- normalized actions
- events
- optional reward callback hooks
- race-rule overrides for the existing simulator rules
- browser expert stepping
- sensor visualization

Users own:

- ML framework choice
- training algorithm
- model weights
- model storage
- model loading
- reward design

## Supported Now

The current expert API is a JavaScript environment contract. It supports:

- `createPaddockEnvironment()` from `@inventure71/paddockjs/environment`
- explicit `controlledDrivers`
- normalized actions: `steering`, `throttle`, `brake`, optional `pitIntent`, and optional `pitCompound`
- manual stepping with optional `frameSkip`
- object observations in real units plus a versioned numeric vector and schema, including rays, nearby cars, track lookahead/curvature, pit-lane surface, pit target compound, pit service state, pit-lane open state, and red-flag state
- full simulator state under `result.state.snapshot`
- global and per-controlled-driver events
- optional host-owned `reward(context)` callbacks, or no reward
- `getActionSpec()` and `getObservationSpec()`
- scenarios with `participants: 'all'`, `'controlled-only'`, or an explicit driver-id list
- reset-only scenario placement through `scenario.preset`, `scenario.placements`, and `scenario.traffic`
- multi-car interaction profiles through `participantInteractions`, including no-collision training cars that are hidden from other cars' ray and nearby-car sensors by default
- neutral rollout recording through `createRolloutRecorder()`
- deterministic evaluation metrics through `runEnvironmentEvaluation()` and `createEvaluationTracker()`
- a JSON-serializable worker protocol wrapper through `createEnvironmentWorkerProtocol()`
- built-in AI for non-controlled cars
- browser expert mode through `mountF1Simulator(..., { expert })`
- opt-in browser ray visualization with `expert.visualizeSensors`

The environment also accepts `rules` as a narrow override of the existing race rules, such as `standingStart: false` for training loops. Rule overrides change simulator behavior; keep them fixed when comparing policy runs.

## Deferred

These are not part of the current package API:

- Python Gymnasium wrapper
- static obstacle scenario modes
- debug mutation APIs for arbitrary simulator state
- assisted-control modes that blend model output with built-in AI
- model loading, model storage, model registries, or trained policies

Those features need separate design work because they change scenario ownership, reproducibility, and the safety boundary between user experiments and package internals. The worker protocol is intentionally only a message wrapper around the JavaScript environment; it is not a Gymnasium package and does not choose a Python RL stack.

## Policy Shape

Use this convention for browser playback:

```js
const policy = {
  predict(observation) {
    return {
      steering: 0,
      throttle: 1,
      brake: 0,
    };
  },
};
```

`predict()` receives one controlled driver's observation. It returns normalized controls:

- `steering`: `-1` full left, `1` full right
- `throttle`: `0` to `1`
- `brake`: `0` to `1`
- `pitIntent`: optional `0`, `1`, or `2`; `0` means no pit request and is accepted as a no-op even when pit stops are disabled, `1` means keep trying until a free-enough pit-entry window appears, and `2` means commit to entering at the next pit-entry window even if pit-lane capacity or gap checks would block mode `1`
- `pitCompound`: optional tire target such as `'S'`, `'M'`, or `'H'`; it must be one of `rules.modules.tireStrategy.compounds`

Controlled drivers do not receive tire-threshold automatic pit calls from the built-in strategy. A model must request a stop with `pitIntent`, and may choose the tire with `pitCompound`; then the simulator owns the pit entry, queue, service, penalty hold, tire change, and pit exit sequence until `pitStopStatus` returns to `completed`. For deterministic training, keep `rules.modules.pitStops.variability.enabled` false or set `rules.modules.pitStops.variability.perfect: true`; when variability is enabled without `perfect`, team `pitCrew` speed, consistency, and reliability affect service time from the same seeded simulation RNG.

`observation.object.self.onTrack` follows the simulator's wheel-level legality rules: track, kerb, and legal pit-lane/box surfaces are on-track for reward/observation purposes, while gravel, grass, and barrier surfaces are off-track. Invalid `observation.lookaheadMeters` values fall back to `[20, 50, 100, 150]` so fixed observation schemas stay usable.

## Headless Training Loop

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';

const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  frameSkip: 4,
  rules: {
    standingStart: false,
  },
  reward: myReward,
});

let result = env.reset();
while (!result.done) {
  const observation = result.observation.budget;
  const action = policy.predict(observation);
  result = env.step({ budget: action });
}
```

## Multi-Car No-Collision Training

Use `participantInteractions` when you want several physics-driven cars in the same environment without having them collide or contaminate each other's sensors. The training mode for this is `isolated-training`.

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';

const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['model-a', 'model-b'],
  frameSkip: 4,
  scenario: {
    participants: ['model-a', 'model-b'],
  },
  participantInteractions: {
    drivers: {
      'model-a': { profile: 'isolated-training' },
      'model-b': { profile: 'isolated-training' },
    },
  },
});

let result = env.reset();
result = env.step({
  'model-a': policyA.predict(result.observation['model-a']),
  'model-b': policyB.predict(result.observation['model-b']),
});
```

`isolated-training` is still a real car mode, not a replay ghost and not a teleport path:

- the car remains in `result.state.snapshot.cars`
- the car still moves only through steering, throttle, brake, and optional pit intent
- the car still has tire, pit, timing, lap, and rules state
- the car is still included in race order by default
- the car does not collide with other cars
- the car does not block pit-lane service occupancy
- the car is hidden from other cars' ray sensors by default
- the car is hidden from other cars' `nearbyCars` observations by default

In the browser renderer, no-collision participants still look like solid cars, but get a blue non-collision outline marker. Replay ghosts remain visually separate: translucent trajectory overlays from `snapshot.replayGhosts`, not physics cars from `snapshot.cars`.

Sensor hiding is per target car. If `model-b` is `isolated-training`, then `model-a`'s rays and `nearbyCars` ignore `model-b`. If every training car should be invisible to every other training car, set every one of them to `isolated-training`.

If you need a non-colliding car that still appears in sensors, use `phantom-race` instead. If you need a one-off exception, override the flag explicitly:

```js
participantInteractions: {
  drivers: {
    'model-b': {
      profile: 'isolated-training',
      detectableByRays: true,
      detectableAsNearby: true,
    },
  },
}
```

Use that override deliberately. The default no-collision training profile is sensor-hidden because parallel training rollouts usually should not alter each other's observation tensors.

## Scenario Reset Control

Scenario placement belongs to environment reset, not to model control. It is useful for deterministic training or evaluation starts such as cornering, recovery, overtaking packs, and pit entry:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  scenario: {
    preset: 'off-track-recovery',
    placements: {
      budget: {
        distanceMeters: 420,
        offsetMeters: 16,
        speedKph: 65,
        headingErrorRadians: 0.4,
      },
    },
    traffic: [
      {
        driverId: 'alpha',
        relativeTo: 'budget',
        deltaDistanceMeters: 24,
        offsetMeters: -1.5,
        speedKph: 68,
      },
    ],
  },
});
```

Supported fixed presets are `cornering`, `off-track-recovery`, `overtaking-pack`, and `pit-entry`. Explicit `placements` override preset placement for the same driver. `traffic` places cars relative to another placed or existing car. After reset, `step(actions)` still advances controlled cars only through the normal action contract.

## Rollouts And Evaluation

PaddockJS can export neutral transition data without owning a trainer:

```js
import { createRolloutRecorder } from '@inventure71/paddockjs/environment';

const recorder = createRolloutRecorder();
let result = env.reset();
const action = { budget: policy.predict(result.observation.budget) };
const next = env.step(action);
recorder.recordStep(result, action, next);
```

Each transition has `{ observation, action, reward, nextObservation, terminated, truncated, info }`. If the environment has no reward callback, `reward` is still `null`; the recorder does not invent one.

Deterministic evaluation helpers report simulator quality metrics such as distance, off-track steps, contacts, recovery success, pass count, and first lap time when available. They do not update a model or compute rewards.

## Example Rewards

`createProgressReward()` is exported for examples and quick smoke tests, but it is non-canonical demo code. It is not the official reward function and should not be treated as the recommended objective for every user. Real training code should pass a domain-specific `reward(context)` or omit rewards entirely when collecting observations or imitation data.

## Visual Playback Loop

```js
import { mountF1Simulator } from '@inventure71/paddockjs';

const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
    frameSkip: 4,
    visualizeSensors: { rays: true },
  },
});

function frame() {
  const observation = simulator.expert.getObservation().budget;
  const action = policy.predict(observation);
  simulator.expert.step({ budget: action });
  requestAnimationFrame(frame);
}

frame();
```

## Specs

Use specs to connect external training code without guessing:

```js
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
```

These specs describe the action ranges, controlled drivers, ray layout, nearby-car limits, and vector schema.
