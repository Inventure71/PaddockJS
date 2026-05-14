# Bring Your Own Model

PaddockJS does not train models for you. It provides a simulator environment contract so users can train with any toolchain, then run the resulting policy in the visual simulator.

If you already have a trained model and need to connect it to PaddockJS, see [Custom Model Controller Guide](custom_model_controller.md).

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
- `createPaddockDriverControllerLoop()` for shared browser/headless controller orchestration
- explicit `controlledDrivers`
- normalized actions: `steering`, `throttle`, `brake`, optional `pitIntent`, and optional `pitCompound`
- manual stepping with optional `frameSkip`
- object observations in real units plus a versioned numeric vector and schema, including rays, nearby cars, track lookahead/curvature, local physical driver senses, pit-lane surface, pit target compound, pit service state, pit-lane open state, and red-flag state
- `observation.object.self.appliedControls`, which reports the normalized steering, throttle, and brake controls that actually drove the latest physics step
- compact observation output modes for vector-only or object-only training loops
- full simulator state under `result.state.snapshot`
- global and per-controlled-driver events
- optional host-owned `reward(context)` callbacks, or no reward
- `getActionSpec()` and `getObservationSpec()`
- scenarios with `participants: 'all'`, `'controlled-only'`, or an explicit driver-id list
- reset-only scenario placement through `scenario.preset`, `scenario.placements`, `scenario.traffic`, and episode-boundary `resetDrivers(placements)`
- multi-car interaction profiles through `participantInteractions`, including no-collision training cars that are hidden from other cars' ray and nearby-car sensors by default
- per-driver episode state and neutral step metrics for batched training loops
- neutral rollout recording through `createRolloutRecorder()`
- deterministic evaluation metrics through `runEnvironmentEvaluation()` and `createEvaluationTracker()`
- a JSON-serializable worker protocol wrapper through `createEnvironmentWorkerProtocol()`
- built-in AI for non-controlled cars
- browser expert mode through `mountF1Simulator(..., { expert })`
- opt-in browser ray visualization with `expert.visualizeSensors`

The environment also accepts `rules` as a narrow override of the existing race rules, such as `standingStart: false` for training loops. Rule overrides change simulator behavior; keep them fixed when comparing policy runs.

`reward(context)` is a user-owned formula over package-owned facts. The context includes the same neutral `metrics` and per-driver `episode` state returned by each step result, so training code does not need to re-derive legality, destruction, or episode termination from raw snapshots:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  reward({ metrics, episode }) {
    if (metrics.destroyed) return -200;
    if (metrics.offTrack) return -12;
    if (episode.terminated) return 0;
    return metrics.legalProgressDeltaMeters;
  },
});
```

PaddockJS does not define an official reward. It exposes neutral simulator facts; users choose the objective.

## Deferred

These are not part of the current package API:

- Python Gymnasium wrapper
- static obstacle scenario modes
- debug mutation APIs for arbitrary simulator state
- assisted-control modes that blend model output with built-in AI
- model loading, model storage, model registries, or trained policies

Those features need separate design work because they change scenario ownership, reproducibility, and the safety boundary between user experiments and package internals. The worker protocol is intentionally only a message wrapper around the JavaScript environment; it is not a Gymnasium package and does not choose a Python RL stack.

## Controller Shape

Use a user-owned controller for browser playback and JavaScript training-style loops:

```js
import {
  createPaddockDriverControllerLoop,
} from '@inventure71/paddockjs';

const controller = {
  async init(ctx) {
    this.model = await loadUserModel(ctx.observationSpec);
  },
  async reset(ctx) {
    this.hidden = resetHidden(ctx.controlledDrivers.length);
  },
  async decideBatch(ctx) {
    const vectors = ctx.orderedObservations.map((item) => item.vector);
    const outputs = await this.model.predictBatch(vectors, this.hidden);
    return Object.fromEntries(ctx.controlledDrivers.map((driverId, index) => [
      driverId,
      {
        steering: outputs[index].steering,
        throttle: Math.max(outputs[index].accel, 0),
        brake: Math.max(-outputs[index].accel, 0),
      },
    ]));
  },
  onStep(ctx) {
    recordUserOwnedRewardOrStats(ctx.metrics, ctx.actions);
  },
};

const loop = createPaddockDriverControllerLoop({
  runtime: env,
  controller,
  actionRepeat: 4,
});
```

`decideBatch()` receives all controlled drivers in a stable order and returns one normalized action map:

- `steering`: absolute steering target, where `-1` is maximum left, `0` is centered, `1` is maximum right, and values between are percentages of the maximum steering angle
- `throttle`: `0` to `1`
- `brake`: `0` to `1`
- `pitIntent`: optional `0`, `1`, or `2`; `0` means no pit request and is accepted as a no-op even when pit stops are disabled, `1` means keep trying until a free-enough pit-entry window appears, and `2` means commit to entering at the next pit-entry window even if pit-lane capacity or gap checks would block mode `1`
- `pitCompound`: optional tire target such as `'S'`, `'M'`, or `'H'`; it must be one of `rules.modules.tireStrategy.compounds`

`steering`, `throttle`, and `brake` are required for every controlled-driver action. Missing or non-finite vehicle-control fields fail validation instead of silently defaulting to zero, so broken model output does not become a hidden coast or brake command.

The controller owns model loading, hidden state, reward/stat logging, and any checkpoint format. PaddockJS owns only cached action/observation specs, compact observation delivery, action validation, batching order, optional action repeat, and normal physics stepping. A one-car `policy.predict(observation)` function can still be wrapped inside `decideBatch()`, but package examples should prefer the batched controller shape.

In `onStep(ctx)`, `ctx.actions` is the action map used for the current physics step and `ctx.previousActions` is the last action map actually applied before it. The first frame after reset has no previous per-driver action. Scheduled `loop.start()` playback may begin from a fresh loop without an explicit `reset()`, and controller/runtime errors stop playback while leaving the thrown value in `loop.stats.lastError`.

Controlled drivers do not receive tire-threshold automatic pit calls from the built-in strategy. A model must request a stop with `pitIntent`, and may choose the tire with `pitCompound`; then the simulator owns the pit entry, queue, service, penalty hold, tire change, and pit exit sequence until `pitStopStatus` returns to `completed`. For deterministic training, keep `rules.modules.pitStops.variability.enabled` false or set `rules.modules.pitStops.variability.perfect: true`; when variability is enabled without `perfect`, team `pitCrew` speed, consistency, and reliability affect service time from the same seeded simulation RNG. For single-car driving skill work where tyre management is out of scope, set `rules.modules.tireDegradation.enabled: false` so `tireEnergy` stays fixed and the model does not learn a hidden degradation schedule.

`observation.object.self.onTrack` follows the simulator's wheel-level legality rules: track, kerb, and legal pit-lane/box surfaces are on-track for reward/observation purposes, while gravel, grass, and barrier surfaces are off-track. Invalid `observation.lookaheadMeters` values fall back to `[20, 50, 100, 150]` so fixed observation schemas stay usable.

Use `observation.profile: 'physical-driver'` when training a policy that should rely on local driver-like senses instead of privileged future track data. This profile keeps the normal action contract, exposes yaw rate, local left/right boundary distance, four contact-patch surface readings, richer opponent radar fields, and surface-aware ray channels in the vector schema. Unless `lookaheadMeters` is explicitly provided, the physical-driver profile uses no track lookahead samples.

`observation.object.self.appliedControls` is diagnostic/reference data for the
latest physics step. For controlled cars it mirrors the normalized action after
environment validation. In `actionPolicy: 'report'` mode, stepping with a
missing or invalid vehicle action releases stale manual controls, lets the
built-in driver own that step, and exposes the exact normalized controls the
built-in driver applied. This is intended for audits or clean local imitation
datasets; it does not blend built-in AI with a model during normal controlled
stepping.

For model training, prefer `physicsMode: 'simulator'` so the policy learns against the same grip, yaw-rate, contact-patch, kerb, and runoff behavior exposed by those senses. Arcade physics can still be useful as a debugging baseline, but it should not be treated as the main training target for realistic driver policies.

Surface-aware rays are opt-in because they are more expensive than the default road-edge/car channels. The environment normalizes both the legacy compact ray shape and the newer per-ray layout:

```js
const env = createPaddockEnvironment({
  drivers,
  controlledDrivers: ['budget'],
  physicsMode: 'simulator',
  observation: { profile: 'physical-driver' },
  sensors: {
    rays: {
      layout: 'driver-front-heavy',
      channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
      precision: 'driver',
      rays: [
        { id: 'front', angleDegrees: 0, lengthMeters: 260 },
        { id: 'right', angleDegrees: 90, lengthMeters: 80 },
      ],
    },
  },
});
```

Only requested ray channels are computed. The default compact config still computes the existing road-edge and car readings, so existing policy vectors keep their current shape unless the profile or sensor config opts into richer fields. Barrier walls are not a ray channel; they are visible track geometry and a terminal destruction condition in both physics modes. Active ray objects, vectors, schemas, and visualizations must not expose barrier ray fields.

`precision: 'driver'` is the default and the recommended model-facing ray contract. It returns the normal sampled driver-sensor distances without extra refinement. `precision: 'debug'` exists only for clearly labeled diagnostics with additional edge refinement. If the Policy Runner or expert visualization is showing model senses, it must render the active observation values exactly and must not replace them with debug-precision readings.

Track-position, wheel-surface, pit-lane, and ray fallback queries can be backed by an internal startup-built track query index. Compact vector-only, schema-free, no-state environment runs enable that index on the environment-owned simulation, and `batch-training` ray runs enable it even when full state output is returned for inspection. This applies whether `batch-training` is set as the default interaction profile or as a per-driver override. Internal benchmarks can explicitly compare indexed and legacy-disabled modes. Browser/expert mounts may pass `trackQueryIndex: true`; the local Policy Runner does this for its controller-debug configurations even when it keeps richer visual observations for inspection. This does not change the observation contract; it makes repeated `nearestTrackState()` style queries use small spatial candidate sets instead of scanning the whole track when the indexed path is active. Rays also use indexed boundary intersections for nearby off-track recovery cases, so the same driver-facing sensor values stay fast without switching to a debug-only precision contract. The broad visual race simulation keeps legacy behavior unless that option is set, preserving existing characterization while letting training and Policy Runner views use the indexed path.

`resetDrivers()` is part of episode control, not policy action. After reset placement, the environment immediately reclassifies the selected cars against the same runoff/barrier rules used during stepping before building observations. Recovery starts inside the legal recovery band remain normal physical starts. Placements that are already inside the barrier destruction boundary return a terminal per-driver episode state and miss-valued rays, so a batch loop can assign its own negative reward and reset that driver without paying for far-out ray geometry.

## Headless Training Loop

```js
import {
  createPaddockDriverControllerLoop,
  createPaddockEnvironment,
} from '@inventure71/paddockjs/environment';

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

const loop = createPaddockDriverControllerLoop({
  runtime: env,
  controller,
  actionRepeat: 4,
});

let result = await loop.reset();
while (!result.done) result = await loop.step();
```

## Multi-Car No-Collision Training

Use `participantInteractions` when you want several physics-driven cars in the same environment without having them collide or contaminate each other's sensors. For batched same-environment learning, use `batch-training`.

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
    defaultProfile: 'batch-training',
  },
  observation: {
    profile: 'physical-driver',
    output: 'vector',
    includeSchema: false,
  },
});

let result = env.reset();
result = env.step({
  'model-a': policyA.predict(result.observation['model-a']),
  'model-b': policyB.predict(result.observation['model-b']),
});
```

`batch-training` is still a real car mode, not a replay ghost and not a teleport path:

- the car remains in `result.state.snapshot.cars`
- the car still moves only through steering, throttle, brake, and optional pit intent
- the car still has tire, pit, timing, lap, and rules state
- the car is excluded from race order/classification by default
- the car does not collide with other cars
- the car does not block pit-lane service occupancy
- the car is hidden from other cars' ray sensors by default
- the car is hidden from other cars' `nearbyCars` observations by default

In the browser renderer, no-collision participants still look like solid cars, but get a blue non-collision outline marker. Replay ghosts remain visually separate: translucent trajectory overlays from `snapshot.replayGhosts`, not physics cars from `snapshot.cars`.

Sensor hiding is per target car. If `model-b` is `batch-training`, then `model-a`'s rays and `nearbyCars` ignore `model-b`. If every training car should be invisible to every other training car, set `participantInteractions.defaultProfile: 'batch-training'`.

Replay ghosts are also sensor-hidden by default. If a replay reference should be visible to policy sensors for comparison experiments, opt it in through its own `sensors.detectableByRays` or `sensors.detectableAsNearby` flags. Sensor results mark those targets as replay ghosts; they still do not collide, rank, pit, or receive controls.

If you need a non-colliding car that still appears in sensors, use `phantom-race` instead. If you need a one-off exception, override the flag explicitly:

```js
participantInteractions: {
  drivers: {
    'model-b': {
      profile: 'batch-training',
      detectableByRays: true,
      detectableAsNearby: true,
    },
  },
}
```

Use that override deliberately. The default no-collision training profile is sensor-hidden because parallel training rollouts usually should not alter each other's observation tensors.

Compact vector mode is intended for high-throughput loops. `env.getObservationSpec()` remains the canonical schema source, so external code can request `output: 'vector'` and `includeSchema: false` without serializing object observations and schema data on every step. JavaScript training loops can also request `vectorType: 'float32'` for typed numeric buffers. Keep the default array output for JSON-only bridges unless the bridge explicitly packs typed arrays.

Use `result.stateOutput` to avoid returning more state than the loop needs:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: agentIds,
  observation: { profile: 'physical-driver', output: 'vector', includeSchema: false },
  result: {
    stateOutput: 'none',
    resetDriversObservationScope: 'reset',
  },
});
```

`stateOutput: 'minimal'` returns the lean public observation snapshot. `stateOutput: 'none'` returns `state: null`. The default is still `full` for existing callers. When `stateOutput: 'none'`, `observation.output: 'vector'`, and `includeSchema: false`, the environment uses an internal compact training snapshot before building observations and metrics. That optimization is not exposed as policy state, and reward callbacks still receive the documented reward context rather than a browser/render-only snapshot.

On the local 20-car batch-training benchmark used for this package work (`physicsMode: 'simulator'`, `frameSkip: 4`, `physical-driver`, `driver-front-heavy` rays), the measured environment action cost after compact output and indexed track queries was approximately:

```txt
nearest track states                   1.52x faster than legacy-disabled
pit lane states                        2.02x faster than legacy-disabled
sampled high-curvature off-track rays  14.81x faster than legacy-disabled
wheel surface near pit connector       1.12x faster than legacy-disabled
20-car batch recovery environment      1.03x faster than legacy-disabled
```

These numbers are hardware- and track-dependent, but the relative result is the useful guidance: compact state/observation output reduces serialization/allocation overhead, and indexed track queries prevent off-track recovery rays from becoming the dominant cost center.

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

For batched training, individual controlled cars can be reset between episodes without recreating the whole simulation:

```js
env.resetDrivers({
  'model-a': {
    distanceMeters: 1200,
    offsetMeters: 3,
    speedKph: 80,
    headingErrorRadians: 0.2,
  },
}, {
  observationScope: 'reset',
  stateOutput: 'none',
});
```

`resetDrivers()` is an episode-boundary API. It increments that driver's `episodeId`, resets its `episodeStep`, clears manual controls and pit intent, and places the car through the same simulator state-reset path used by scenarios. It does not rewind global `info.step`; max-step truncation is evaluated from the selected driver's own `episodeStep`, so one truncated driver can be reset while the rest of the batch keeps its current episode state. It is not available through `step(actions)` and is not a movement shortcut during an episode. Passing `{ observationScope: 'reset', stateOutput: 'none' }` keeps reset responses small for batched runners.

The worker protocol mirrors this with a `resetDrivers` message:

```js
protocol.handle({
  id: 'reset-agent-3',
  type: 'resetDrivers',
  placements: {
    'agent-3': { distanceMeters: 1200, offsetMeters: 0, speedKph: 80 },
  },
  resultOptions: {
    observationScope: 'reset',
    stateOutput: 'none',
  },
});
```

For state polling, worker `getState` messages accept `stateOptions: { output: 'full' | 'minimal' | 'none' }`; `resultOptions.stateOutput` is accepted as a compatibility alias on that message type.

## Rollouts And Evaluation

PaddockJS can export neutral transition data without owning a trainer:

```js
import { createRolloutRecorder } from '@inventure71/paddockjs/environment';

const recorder = createRolloutRecorder();
let result = env.reset();
const action = { budget: { steering: 0, throttle: 1, brake: 0 } };
const next = env.step(action);
recorder.recordStep(result, action, next);
```

Each transition has `{ observation, action, reward, nextObservation, terminated, truncated, info }`. If the environment has no reward callback, `reward` is still `null`; the recorder does not invent one.

Environment step results also include reward-neutral `metrics[driverId]` facts such as progress delta, legal progress delta, kerb use, illegal/off-track state, severe cuts, destruction state, under-30-kph state, spin/backwards state, lap completion, lap time, and contact count. `contactCount` counts each normalized physical contact event once per involved driver even when the event carries both legacy `carId`/`otherCarId` fields and normalized `driverIds`. These metrics are facts for logging, evaluation, and user-defined reward functions; PaddockJS does not turn them into a built-in objective. If a car touches the rendered barrier wall's inner face in either physics mode, that driver receives `metrics[driverId].destroyed: true` and `info.drivers[driverId].endReason: 'destroyed'`; external training code should assign any super-negative crash reward itself and then call `resetDrivers()` for the next episode.

Deterministic evaluation helpers report simulator quality metrics such as distance, off-track steps, contacts, recovery success, pass count, and first lap time when available. They use the same wheel-level legal-surface and contact-event semantics as environment metrics. `runEnvironmentEvaluation()` can accept compact base options with `result.stateOutput: 'none'`; it internally requests the minimal snapshot needed for evaluation bookkeeping. Direct `createEvaluationTracker(result)` calls require a result with `state.snapshot`, so use `stateOutput: 'minimal'` or `full` for manual tracker wiring. Evaluation helpers do not update a model or compute rewards.

## Example Rewards

`createProgressReward()` is exported for examples and quick smoke tests, but it is non-canonical demo code. It is not the official reward function and should not be treated as the recommended objective for every user. Real training code should pass a domain-specific `reward(context)` or omit rewards entirely when collecting observations or imitation data.

## Visual Playback Loop

```js
import {
  createPaddockDriverControllerLoop,
  mountF1Simulator,
} from '@inventure71/paddockjs';

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

const loop = createPaddockDriverControllerLoop({
  runtime: simulator.expert,
  controller,
  actionRepeat: 4,
  mode: 'browser',
});

await loop.reset();
loop.start();
```

## Specs

Use specs to connect external training code without guessing:

```js
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
```

These specs describe the action ranges, controlled drivers, ray layout, nearby-car limits, and vector schema.
