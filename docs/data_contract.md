# Data Contract

This file documents the data that host websites pass into PaddockJS.

## Mount Options

All-in-one API:

```js
mountF1Simulator(root, {
  preset,
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  trackQueryIndex,
  warmup,
  totalLaps,
  physicsMode,
  rules,
  participantInteractions,
  replayGhosts,
  initialCameraMode,
  theme,
  title,
  kicker,
  backLinkHref,
  backLinkLabel,
  showBackLink,
  ui,
  assets,
  expert,
  onLoadingChange,
  onReady,
  onError,
  onDriverSelect,
  onRaceEvent,
  onLapChange,
  onRaceFinish,
});
```

Composable API:

```js
const simulator = createPaddockSimulator({
  drivers,
  entries,
  onDriverOpen,
  seed,
  trackSeed,
  trackQueryIndex,
  warmup,
  totalLaps,
  physicsMode,
  rules,
  participantInteractions,
  replayGhosts,
  initialCameraMode,
  preset,
  theme,
  ui,
  assets,
  expert,
});

simulator.mountRaceCanvas(canvasRoot, {
  includeRaceDataPanel: true,
  includeTimingTower: true,
  timingTowerVerticalFit: 'scroll',
});
await simulator.start();
```

Additional optional components:

```js
simulator.mountRaceControls(controlsRoot);
simulator.mountCameraControls(cameraControlsRoot);
simulator.mountSafetyCarControl(safetyCarRoot);
simulator.mountTimingTower(timingRoot);
simulator.mountTelemetryPanel(telemetryRoot);
simulator.mountTelemetryCore(coreTelemetryRoot);
simulator.mountTelemetrySectors(sectorGraphRoot);
simulator.mountTelemetrySectorBanner(sectorBannerRoot);
simulator.mountTelemetryLapTimes(lapTimesRoot);
simulator.mountTelemetrySectorTimes(sectorTimesRoot);
simulator.mountRaceTelemetryDrawer(raceWorkbenchRoot, {
  timingTowerVerticalFit: 'expand-race-view',
  raceDataTelemetryDetail: true,
});
simulator.mountCarDriverOverview(overviewRoot);
simulator.mountRaceDataPanel(raceDataRoot);
```

## Expert Environment Contract

Headless training code imports the browser-free environment subpath:

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';

const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  seed: 71,
  trackSeed: 2026,
  totalLaps: 3,
  frameSkip: 2,
  rules: {
    ruleset: 'custom',
    standingStart: false,
    modules: {
      penalties: {
        trackLimits: { strictness: 0.25 },
      },
    },
  },
  scenario: {
    participants: 'all',
    nonControlled: 'ai',
  },
});

let result = env.reset();
result = env.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});
```

`controlledDrivers` is required. It supports one or many externally controlled cars. Non-controlled participants use the built-in driver AI in the stable 1.0 environment API.
`externalRenderer` is optional and observer-only. It can be a function or `{ onFrame(frame) }`, and receives `{ snapshot, observation, meta }` on `reset`, `step`, and `resetDrivers`. The hook does not mutate simulation state and hook failures are isolated so stepping continues.
`warmup` is optional and enabled by default. It primes a disposable runtime during load/reset creation and caches by configuration fingerprint so repeated identical resets skip warmup. Use `warmup: { enabled, policy: 'config-change' | 'always' | 'never', steps }` or `warmup: false` to disable.
`physicsMode` is optional and accepts `'arcade'` or `'simulator'`. Invalid values fall back to `'arcade'`, which is the default compatibility mode. `'simulator'` keeps the same public action contract but uses stricter 2D velocity/yaw dynamics and exposes additional telemetry fields on snapshots and observations: `lateralG`, `longitudinalG`, `gripUsage`, `slipAngleRadians`, `tractionLimited`, and `stabilityState`. In simulator mode, `slipAngleRadians` is derived from the car heading versus actual velocity direction, and mixed wheel surfaces are averaged for physics while wheel snapshots still report each contact patch.
`rules` is an optional override object for the race rules documented in [rules.md](rules.md). Flat keys such as `standingStart: false` still work for existing behavior. Advanced systems live under `rules.modules` so hosts can choose a preset and then override individual modules:

```js
rules: {
  ruleset: 'fia2025',
  modules: {
    pitStops: {
      enabled: true,
      pitLaneSpeedLimitKph: 80,
      maxConcurrentPitLaneCars: 3,
      minimumPitLaneGapMeters: 20,
      tirePitRequestThresholdPercent: 50,
      tirePitCommitThresholdPercent: 30,
    },
    tireDegradation: {
      enabled: false,
    },
    penalties: {
      trackLimits: { strictness: 0.8 },
      collision: { strictness: 0.5, consequences: [{ type: 'time', seconds: 5 }] },
      tireRequirement: { strictness: 1, consequences: [{ type: 'time', seconds: 10 }] },
      pitLaneSpeeding: { strictness: 1, speedLimitKph: 80 },
    },
  },
}
```

Supported rulesets are `paddock`, `grandPrix2025`, `fia2025`, and `custom`. The `fia2025` name is a 2024-2025-era grand-prix-style package preset; explicit module config always wins over preset defaults. `rules.modules.tireDegradation.enabled: false` freezes tyre energy for deterministic training or visual comparison without changing tire compounds or pit rules. Penalty strictness is clamped from `0` to `1`, where `0` disables enforcement for that subsection and `1` uses the configured rule margin. `rules` is not a direct state-mutation API.

Scenario support:

```js
scenario: {
  participants: 'all' | 'controlled-only' | ['budget', 'alpha'],
  nonControlled: 'ai',
  preset: 'cornering' | 'off-track-recovery' | 'overtaking-pack' | 'pit-entry',
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
      headingErrorRadians: 0,
    },
  ],
}
```

Scenario placement is applied only during environment creation/reset through the simulator state API. It does not give policies a state-mutation path during `step(actions)`. Explicit `placements` override preset placement for the same driver, and `traffic` places another participant relative to a placed or existing car. `env.reset(partialOptions)` preserves omitted nested option groups, but an explicitly supplied `scenario.placements` object replaces the old placement map so callers can clear stale reset placements with `{ scenario: { placements: {} } }`. Static obstacles, debug mutation, assisted controls, and Python Gymnasium wrappers are intentionally deferred. Replay ghosts and participant interaction profiles are supported separately below. The supported package boundary today is JavaScript Gym-style control plus a JSON worker protocol, not a Python Gym package and not a scenario editor.

`env.resetDrivers(placements)` applies the same placement shape to selected controlled drivers without recreating the whole environment. It is an episode-boundary API for batched training: selected drivers get a new `episodeId`, `episodeStep: 0`, cleared manual controls, and cleared pit intent. Non-selected controlled drivers keep their current car state and episode counters. Max-step truncation is evaluated from each reported driver's own `episodeStep`, so resetting one truncated driver clears that driver's done state without rewinding the environment `info.step` or changing other drivers' episode state. Reset placement is still validated against the normal track/runoff/barrier model before observations are returned. If a reset placement puts a car into the barrier destruction boundary, the returned result reports that driver as `destroyed` with `endReason: 'destroyed'` and stable miss-valued rays instead of doing an expensive far-out sensor scan. This API is not accepted inside `step(actions)`.

Participant interaction profiles are simulator-owned environment setup, not RL logic. They let hosts run multiple real cars in one environment without forcing every car to collide with or appear in every other car's sensors:

```js
participantInteractions: {
  defaultProfile: 'normal',
  drivers: {
    'model-a': { profile: 'normal' },
    'model-b': { profile: 'isolated-training' },
  },
}
```

Supported profiles are:

- `normal`: collidable, ray-detectable, nearby-detectable, pit-lane-blocking, and race-order-affecting.
- `isolated-training`: non-colliding, hidden from rays and nearby-car observations, non-blocking in pit-lane occupancy, but still included in race order.
- `batch-training`: non-colliding, hidden from rays and nearby-car observations, non-blocking in pit-lane occupancy, and excluded from race order/classification while still being a rendered physics-driven car in `snapshot.cars`.
- `phantom-race`: non-colliding and non-blocking in pit-lane occupancy, but visible to rays and nearby-car observations and included in race order.
- `time-trial-overlay`: non-colliding, sensor-hidden, non-blocking, and excluded from race order/classification while still being a physics-driven car in `snapshot.cars`.

Every profile flag can be overridden per driver. This does not add teleport, assisted steering, or trainer behavior: cars still advance through the normal vehicle physics and public action/state APIs.

For multi-car learner batches, `batch-training` is the default no-collision profile. It hides each learner from other cars' ray sensors and `nearbyCars` observations, excludes learner cars from race order, and still keeps them visible as normal physics cars in snapshots/rendering. Use `isolated-training` when a non-colliding car should still affect order. If a non-colliding car should remain sensor-visible, use `phantom-race` or explicitly override `detectableByRays` / `detectableAsNearby`.

Browser render snapshots include each car's resolved `interaction` object. The default browser renderer uses that to draw a blue outline marker around non-colliding physics participants while keeping them solid and clickable. That visual marker does not change collision, sensor, timing, pit, or control behavior.

Replay ghosts are separate trajectory-driven reference entities:

```js
replayGhosts: [
  {
    id: 'best-lap',
    label: 'Best Lap',
    color: '#00ff84',
    opacity: 0.35,
    visible: true,
    trajectory: [
      {
        timeSeconds: 0,
        x: 100,
        y: 200,
        headingRadians: 1.2,
        speedKph: 180,
        progressMeters: 0,
      },
    ],
    sensors: {
      detectableByRays: false,
      detectableAsNearby: false,
    },
  },
]
```

Replay ghosts appear in `snapshot.replayGhosts`, interpolate by `timeSeconds`, render as translucent browser overlays, and never enter `snapshot.cars`, timing rows, race order, pit logic, collision resolution, or steward penalties. They are hidden from rays and nearby-car observations by default. If `sensors.detectableByRays` or `sensors.detectableAsNearby` is explicitly enabled, observations may report that replay ghost as a sensor target with `targetType` / `entityType: 'replayGhost'`; it still remains a non-physics reference entity.

Actions use normalized low-level controls:

```js
{
  budget: {
    steering: -1, // full left
    throttle: 1,
    brake: 0,
  },
}
```

Browser expert mode also exposes an external render hook for authoritative node-frame visualization:

```js
simulator.expert.attachExternalRenderer(source);
simulator.expert.detachExternalRenderer();
const state = simulator.expert.getExternalRendererState();
```

`source` contract:

```js
{
  subscribe(onFrame) {
    // call onFrame({ snapshot, observation, meta? })
    return () => { /* unsubscribe */ };
  },
}
```

While attached, expert runtime is strict render-only and rejects local `step()`, `resetDrivers()`, and `reset()`. Package core stays transport-agnostic: WebSocket connection/discovery belongs to host integration code, not to `src/`.

Operationally this is one architecture with two modes:

- local expert mode: browser owns stepping
- external render mode: browser only renders authoritative external frames

Policy Runner maps this directly through supported controller modes: `Distilled policy` and `Policy server` for browser-owned stepping, and `Live preview stream` for external render-only frames.

`steering` is an absolute steering-wheel target: `-1` points at the maximum left steering limit, `0` points at center, `1` points at the maximum right steering limit, and intermediate values are percentages of that limit. The vehicle physics moves the steering angle toward that target through the configured steering-rate limit, so centering is physical rather than an instantaneous snap. `throttle` and `brake` are clamped from `0` to `1`. `steering`, `throttle`, and `brake` are required on every controlled-driver action; missing or non-finite values fail action validation instead of defaulting to zero.

Actions may also include `pitIntent`. `0` clears a pending pit request and is accepted as a no-op even when pit stops are disabled, so fixed-shape policies can always send the full action object. `1` keeps trying until the next free-enough pit-entry window, and `2` commits to entering at the next pit-entry window even when pit-lane capacity or gap checks would block an opportunistic stop. Expert-controlled drivers start with `pitIntent: 0`, and tire-threshold automatic pit calls are disabled for those drivers so models do not manually steer into pit-lane geometry or get surprise pit calls from the built-in strategy. If pit stops are disabled, if the car has no pit assignment, or if the car is already entering, queued, servicing, or exiting, the environment rejects non-zero pit requests through the configured `actionPolicy`.

Pit actions may also include `pitCompound` or `pitTargetCompound`, for example `{ pitIntent: 2, pitCompound: 'H' }`. The value must be one of `rules.modules.tireStrategy.compounds`. If omitted, the simulator keeps the existing pending target or picks the first configured compound different from the current tire. The model never steers down pit-lane geometry directly; once a request is accepted, the simulator owns pit entry, queueing, penalty hold, tire service, and pit exit.

The recommended runtime convention is a user-owned driver controller with `decideBatch(context) -> { [driverId]: { steering, throttle, brake, pitIntent? } }`. Controllers may load any model format or call any inference backend. PaddockJS only provides the simulator runtime context, stable controlled-driver ordering, cached specs, compact observations, and normalized action validation.

```js
import { createPaddockDriverControllerLoop } from '@inventure71/paddockjs';

const controller = {
  async init(ctx) {
    this.model = await loadUserModel(ctx.observationSpec);
  },
  async reset(ctx) {
    this.hidden = resetHiddenState(ctx.controlledDrivers.length);
  },
  async decideBatch(ctx) {
    const vectors = ctx.orderedObservations.map((item) => item.vector);
    return this.model.predictBatch(vectors, this.hidden);
  },
  onStep(ctx) {
    recordUserOwnedStats(ctx.metrics, ctx.actions);
  },
};

const loop = createPaddockDriverControllerLoop({
  runtime: env,
  controller,
  actionRepeat: 4,
});
```

The older one-car `policy.predict(driverObservation)` style remains easy to wrap inside a controller, but new browser playback and training-style loops should use `decideBatch()` so one inference call can cover every controlled car.

The environment exposes specs for external training code:

```js
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
```

`actionSpec` describes controlled drivers, normalized action ranges, and the optional pit intent values. `observationSpec` describes object observation fields, ray layout, nearby-car limits, track lookahead fields, and the versioned vector schema. `observation.lookaheadMeters` is sanitized to a finite numeric array; invalid or empty values fall back to the default `[20, 50, 100, 150]`. The opt-in `observation.profile: 'physical-driver'` profile defaults lookahead to `[]` so policies can use local driver-like senses without receiving privileged future track curvature. Realistic training runs should pair this profile with `physicsMode: 'simulator'`; that keeps the model's observed yaw, grip, contact-patch, kerb, and runoff behavior aligned with the physics it is learning to control.

Observation output can be compacted for training throughput:

```js
observation: {
  profile: 'physical-driver',
  output: 'vector', // 'full' | 'vector' | 'object'
  includeSchema: false,
  vectorType: 'float32', // 'array' | 'float32'
}
```

The default remains `output: 'full'`, `includeSchema: true`, and `vectorType: 'array'`, which returns `{ object, vector, schema, events }` for backward compatibility. `output: 'vector'` returns `{ vector, events }` unless schema inclusion is requested. `output: 'object'` returns `{ object, events }` unless schema inclusion is requested. `getObservationSpec()` remains the canonical schema source for compact loops. `vectorType: 'float32'` returns a `Float32Array` for JavaScript consumers that want typed numeric buffers; JSON worker users should keep the default array output unless their bridge explicitly handles typed arrays. Destroyed or out-of-race cars keep the same ray/vector schema and return miss-valued ray channels so model code does not need a separate terminal tensor shape.

Result state output can also be compacted:

```js
result: {
  stateOutput: 'none', // 'full' | 'minimal' | 'none'
  resetDriversObservationScope: 'reset', // 'all' | 'reset'
}
```

The default `stateOutput: 'full'` preserves the public `{ state: { snapshot } }` payload. `minimal` returns the lean observation snapshot used by the environment. `none` returns `state: null`, so external loops should rely on `observation`, `metrics`, and `info` instead. `resetDriversObservationScope: 'reset'` makes `resetDrivers()` return observations and metrics only for reset drivers by default; callers can override per call with `env.resetDrivers(placements, { observationScope: 'all' | 'reset', stateOutput })`. Partial `env.reset(options)` calls merge plain nested option groups such as `rules.modules`, `trackGeneration`, `sensors`, `observation`, `result`, and `episode`; arrays and explicit placement maps replace the old value.

The JSON worker protocol exposes the same reset-result controls through `resultOptions`:

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

`getState` accepts `stateOptions: { output: 'full' | 'minimal' | 'none' }`. For compatibility with reset-style messages, `resultOptions.stateOutput` is also mapped to the same state output selector on `getState` messages.

This is still an environment-control message, not an action. A policy cannot submit `resetDrivers` inside `step(actions)`.

`createProgressReward()` is non-canonical demo reward code for examples and quick smoke tests, not the official reward. It returns a callback compatible with `reward(context)` and combines:

- forward progress in meters from `state.snapshot.cars[].distanceMeters`
- on-track speed in `current.object.self.speedKph`
- off-track penalty from `current.object.self.onTrack`
- collision penalty from global/per-driver step events
- steering and brake smoothness penalties from the submitted normalized action

Weights are explicit and overridable:

```js
const reward = createProgressReward({
  weights: {
    progress: 1,
    speed: 0.01,
    offTrack: -2,
    collision: -10,
    steering: -0.03,
    brake: -0.02,
  },
});
```

Custom reward functions receive the same context plus neutral environment facts:

```js
reward({ driverId, previous, current, action, events, state, metrics, episode }) {
  if (metrics.destroyed) return -200;
  if (metrics.offTrack) return -12;
  if (episode.terminated) return 0;
  return metrics.legalProgressDeltaMeters;
}
```

`metrics` is the same neutral per-driver metrics object returned in `result.metrics[driverId]`, and `episode` is the same per-driver runtime state returned in `result.info.drivers[driverId]`. These are package-owned facts, not reward policy. If no reward callback is provided, `result.reward` is `null`. If a callback returns `undefined`, `null`, `NaN`, or an infinite value, that driver's reward is normalized to `0`. PaddockJS does not infer, select, or tune rewards.

Neutral rollout recording is available for external training loops:

```js
import { createRolloutRecorder } from '@inventure71/paddockjs/environment';

const recorder = createRolloutRecorder();
const previous = env.reset();
const action = { budget: { steering: 0, throttle: 1, brake: 0 } };
const next = env.step(action);
recorder.recordStep(previous, action, next);
```

Each recorded transition has `{ observation, action, reward, nextObservation, terminated, truncated, info }`. This is data export only; it does not train or update a model.

Deterministic evaluation helpers run fixed seeds/scenarios and report environment quality metrics:

```js
import { runEnvironmentEvaluation } from '@inventure71/paddockjs/environment';

const report = runEnvironmentEvaluation({
  baseOptions: { drivers, entries, controlledDrivers: ['budget'] },
  policy(observation) {
    return myPolicy.predict(observation);
  },
});
```

Evaluation reports include distance, lap progress, off-track step count, contact count, recovery success, pass count, and first lap time when available. They follow the same wheel-level legal-surface and contact-event definitions as environment metrics. `runEnvironmentEvaluation()` can accept compact base options with `result.stateOutput: 'none'`; it internally requests the minimal snapshot needed for evaluation bookkeeping. Direct `createEvaluationTracker(result)` usage requires `state.snapshot`, so use `stateOutput: 'minimal'` or `full` when wiring the tracker manually. These metrics are not rewards.

`step(actions)` returns a JavaScript object designed for environment loops:

```js
{
  observation: {
    budget: {
      object: {
        self: {
          speedKph,
          speedMetersPerSecond,
          headingRadians,
          steeringAngleRadians,
          throttle,
          brake,
          lap,
          completedLaps,
          lapProgressMeters,
          trackOffsetMeters,
          trackHeadingErrorRadians,
          onTrack, // true for track, kerb, and legal pit-lane/box surfaces
          surface,
          inPitLane,
          pitLanePart,
          pitBoxId,
          tireEnergy,
          pitIntent,
          pitStopStatus,
          pitStopPhase,
          pitStopServiceRemainingSeconds,
          pitStopPenaltyServiceRemainingSeconds,
          pitStopsCompleted,
        },
        trackRelation: {
          lateralOffsetMeters,
          headingErrorRadians,
          legalWidthMeters,
          leftBoundaryMeters,
          rightBoundaryMeters,
          onLegalSurface,
          surface,
        },
        contactPatches,
        race: {
          position,
          totalCars,
          raceMode,
          totalLaps,
        },
        rays,
        nearbyCars,
        events,
      },
      vector,
      schema,
      events,
    },
  },
  reward,
  metrics: {
    budget: {
      progressDeltaMeters,
      legalProgressDeltaMeters,
      offTrack,
      kerb,
      fullyOutsideWhiteLine,
      severeCut,
      destroyed,
      destroyReason,
      under30kph,
      spinOrBackwards,
      completedLap,
      lapTimeSeconds,
      contactCount,
    },
  },
  terminated,
  truncated,
  done,
  events,
  state: {
    snapshot,
  },
  info: {
    step,
    elapsedSeconds,
    seed,
    trackSeed,
    controlledDrivers,
    actionErrors,
    endReason,
    drivers: {
      budget: {
        terminated,
        truncated,
        endReason,
        episodeStep,
        episodeId,
      },
    },
  },
}
```

`state.snapshot.cars` contains physics-driven participants only. Each car includes `interaction` with the resolved profile flags. `state.snapshot.replayGhosts` contains trajectory-driven replay/reference entities only. This invariant is shared by browser and headless snapshots:

```txt
snapshot.cars = physics-driven race participants
snapshot.replayGhosts = trajectory-driven replay/reference entities
```

Observation objects use physical units such as kph, meters/second, meters, and radians. Optional `vector` values use fixed documented scaling from `schema`; they do not use hidden per-car normalization. Full simulator truth remains available under `state.snapshot`. Internally, the environment avoids rebuilding full snapshots during each `frameSkip` substep and defaults to the non-public track query index unless `trackQueryIndex: false` is set, but the returned `state.snapshot`, reward callback `previous` snapshot, and reward callback `state.snapshot` keep the same public shape.

The environment observation now exposes local physical driver senses separately from full snapshot truth. `self.yawRateRadiansPerSecond` is the car's current yaw rate. `self.appliedControls` reports the normalized controls that actually drove the latest physics step: `steering` in `-1..1`, `steeringRadians` in simulator radians, `throttle` in `0..1`, and `brake` in `0..1`. For controlled cars this mirrors the accepted environment action; in `actionPolicy: 'report'` mode, a missing or invalid vehicle action releases stale manual controls, lets the built-in AI drive that step, and exposes its exact controls for auditing or clean local imitation datasets. `trackRelation` gives immediate local road relationship: lateral offset, heading error, legal width, left/right boundary distance, legal-surface state, and current surface. `contactPatches` exposes the four wheel/contact-patch surface readings as stable public observation data, with `surfaceCode` intended only as a compact vector encoding.

Default rays use a compact center-origin set with forward, side, and rear awareness:

```js
[-135, -60, -20, 0, 20, 60, 135, 180]
```

Track distances are sampled against the actual track model. When the ray starts inside the track border, `track.kind: 'exit'` means the distance is where the ray leaves the valid road. When the ray starts outside the track border, `track.kind: 'entry'` means the distance is where the ray re-enters the valid road. If no track transition is visible within the ray length, `track.hit` is `false`, `track.distanceMeters` equals `lengthMeters`, and `track.kind` is `null`. Car hits require the ray to intersect the other car's footprint and also return max distance when no car is visible:

```js
{
  angleDegrees,
  angleRadians,
  lengthMeters,
  roadEdge: {
    hit,
    distanceMeters,
    kind, // 'exit' | 'entry' | null
  },
  track: {
    hit,
    distanceMeters,
    kind, // 'exit' | 'entry' | null
  },
  kerb: { hit, distanceMeters, surface },
  illegalSurface: { hit, distanceMeters, surface },
  car: {
    hit,
    distanceMeters,
    driverId,
    relativeSpeedKph,
  },
}
```

`track` is kept as the compatibility alias for `roadEdge`. New ray configs may use a per-ray layout and opt into additional channels only when needed:

```js
sensors: {
  rays: {
    layout: 'driver-front-heavy',
    channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
    precision: 'driver', // 'driver' | 'debug'
    rays: [
      { id: 'front', angleDegrees: 0, lengthMeters: 260 },
      { id: 'right', angleDegrees: 90, lengthMeters: 80 },
    ],
  },
}
```

Ray precision defaults to `driver`. Driver precision is the active model-facing sensor contract and uses the normal sampled ray step without extra refinement. `precision: 'debug'` is available for clearly labeled diagnostics with additional edge refinement, but debug precision must not be displayed as model senses unless the policy is also running with that exact sensor config.

Surface channels are computed only when requested. `kerb` is legal racing surface. `illegalSurface` reports the first grass or gravel surface crossed by the ray. The same model-facing ray contract is accelerated for both normal on-track driving and nearby off-track recovery starts using indexed ray-boundary intersections. Ambiguous pit-connector and unusual geometry cases may use indexed sampled fallback internally, but the returned ray object shape is unchanged. Barrier walls are not exposed as a model-facing ray target; active ray objects, vectors, schemas, and visualizations must not expose a `barrier` ray channel. Barrier contact is enforced as a shared destruction boundary in both physics modes at the rendered wall's inner face and reported through events, snapshots, metrics, and per-driver episode state.

Nearby-car observations are car-relative:

```js
{
  id,
  relativeForwardMeters,
  relativeRightMeters,
  relativeDistanceMeters,
  relativeSpeedKph,
  relativeHeadingRadians,
  ahead,
  behind,
  sameLap,
  closingRateMetersPerSecond,
  timeToContactSeconds,
  leftOverlap,
  rightOverlap,
}
```

If no `reward` callback is provided, `result.reward` is `null`. If provided, rewards are returned by controlled driver ID. The callback receives `driverId`, `previous`, `current`, `action`, `events`, `state.snapshot`, `metrics`, and `episode`.

Browser expert mode is opt-in through the browser mount API:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
    frameSkip: 4,
    visualizeSensors: {
      rays: true,
    },
  },
});

simulator.expert.reset();
simulator.expert.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});
```

When browser expert mode is enabled, automatic ticker simulation advancement is disabled. The visual canvas advances only when host code calls `simulator.expert.reset()` or `simulator.expert.step(actions)`. Browser expert mode is a mount-time option; `restart(nextOptions)` rejects `expert` changes. Destroy and mount a new simulator to switch between built-in ticker control and expert stepping.

`expert.visualizeSensors` is a browser-only visual debugging option. When `visualizeSensors: true` or `visualizeSensors: { rays: true }` is set, the simulator draws the selected controlled driver's ray sensors in the Pixi world layer from the car's current position. Ray lengths and hit markers are based on the same observation data returned from the expert environment result. Every detected ray channel gets its own colored marker so road-edge, kerb, illegal surface, and car hits can be debugged independently. Barrier walls are rendered as track geometry, not model-facing ray hits. In multi-driver expert runs, use `visualizeSensors: { rays: true, drivers: 'all' }` only when every controlled car's overlay is intentionally needed; hosts may also pass `drivers: ['driver-a']` to pin the overlay to a fixed controlled subset.

## Lap Telemetry Snapshot

Each `car.lapTelemetry` snapshot includes current/last/best lap and sector timing, plus sector performance classes used by package UI:

```js
{
  currentLap,
  currentSector,
  currentLapTime,
  currentSectorElapsed,
  currentSectorProgress,
  currentSectors,
  sectorProgress,
  liveSectors,
  lastLapTime,
  bestLapTime,
  lastSectors,
  bestSectors,
  completedLaps,
  sectorPerformance: {
    current: ['overall-best', 'personal-best', null],
    last: [null, 'slower', null],
    best: ['overall-best', null, 'personal-best'],
  },
}
```

`currentSectors` contains completed split times for the current lap only, so the active sector remains `null` until its boundary is crossed and sectors after the active sector are cleared. `sectorProgress` is a `0..1` progress array for the live sector-map surface: recorded completed sectors before the active sector are `1`, the active sector is live, and missing or future sectors are `0`. `liveSectors` mirrors recorded completed current-lap sector times before the active sector and fills only the active sector with its live elapsed time. It does not infer earlier sector values purely from the current sector number, and it never displays future-sector values for the current lap, so skipped, missing, or stale split data stays blank instead of creating stale S1/S2 readouts. `overall-best` means fastest sector time currently known across the field, `personal-best` means that driver's own fastest non-overall sector, and `slower` marks a completed sector that is slower than the driver's personal best. Missing or future sector values are `null`.

## Required Options

`drivers` is required and must be a non-empty array. Driver `id` values must be unique.

`totalLaps` is optional. Values are normalized to a finite positive integer, with invalid or non-positive input falling back to a one-lap race.

`trackSeed` is optional. If omitted, each mounted browser simulator creates a fresh procedural circuit. Passing a `trackSeed` makes the track deterministic; repeated procedural seeds are cached so multiple mounts can reuse the same immutable generated track definition when the resolved generation options also match. Callers should treat `createProceduralTrack(seed, options)` results as read-only. Calling `restart({ trackSeed })` rebuilds the simulation on the deterministic circuit for that seed.

`trackGeneration` is optional and applies only when a procedural `trackSeed` is used. It accepts profile presets plus explicit overrides:

```js
{
  profile: 'training-short',
  length: { minMeters: 900, maxMeters: 1800 },
  startStraight: { gridMeters: 0, exitMeters: 80, blendMeters: 80 },
  pitLane: { enabled: false },
  shape: { scale: 0.2, cornerDensity: 1.3, variation: 0.22 },
  validation: { minClearanceMultiplier: 1, maxLocalTurnRadians: 1.85 },
  attempts: { primary: 80, fallback: 200 },
}
```

Profiles are presets, not separate generators. `race` preserves the default full-length circuit with pit lane; `training-short`, `training-medium`, and `training-technical` generate smaller pitless circuits for training or demos. Resolution is `race` defaults, selected profile defaults, then explicit overrides. Procedural tracks are generated by tracing, smoothing, and warping package-owned seeded region masks, then validating the resulting centerline instead of falling back to pure ovals. Invalid candidates are rejected for length, world bounds, non-adjacent clearance, turn sharpness, self-intersections, and weak shape variation. The start/finish area is normalized into an explicit straight window so the starting grid, pit-entry approach, and immediate pit-exit merge area are straight even when the rest of the circuit is generated from curved controls.

`trackQueryIndex` controls indexed track/surface query acceleration. Browser/expert simulator mounts, headless environments, and direct race-simulation construction default this option to `true`, so visual race simulation, expert controls, Policy Runner playback, headless training/evaluation runs, and model-sense visualization use the indexed path by default. Set `trackQueryIndex: false` to force legacy non-indexed queries for comparison or debugging. It does not change public snapshot or observation shapes.

`initialCameraMode` is optional and accepts `'overview'`, `'leader'`, `'selected'`, `'show-all'`, or `'pit'`. Invalid values fall back to `'leader'`. The `overview` camera frames the generated track bounds with package-owned padding and pit-lane extent. The `pit` camera frames the active track's `pitLane` geometry, zooms out when needed to keep the full pit lane inside the active race-view safe area, and falls back to `leader` when no pit lane is available. Camera zoom controls and wheel zoom apply to every mode, with zoom-out bounded by the active track frame.

Each driver must have:

```js
{
  id: 'budget',
  name: 'Budget Buddy',
  color: '#ff2d55',
}
```

## Recommended Driver Shape

```js
{
  id: 'budget',
  name: 'Budget Buddy',
  color: '#ff2d55',
  link: '/project_details/project-budget-buddy.html',
  icon: 'BB',
  code: 'BUD',
  tire: 'M',
  raceData: ['AI finance coach', 'Python + LLM', 'Budget guardrails'],
  customFields: {
    Specialty: 'Late braking',
  },
}
```

Fields:

- `id`: stable unique ID used for matching entries and selection.
- `name`: display name.
- `color`: car/team color.
- `link`: optional host-owned navigation target.
- `icon`: short display mark in timing/telemetry.
- `code`: fallback timing code.
- `tire`: `S`, `M`, or `H`.
- `raceData`: short project/radio lines shown in the UI.
- `customFields`: optional driver overview fields. Use an object or an array of `{ label, value }`.

## Entry Shape

Entries are optional. If omitted, defaults are used.

```js
{
  driverId: 'budget',
  driverNumber: 71,
  timingName: 'Budget',
  driver: {
    pace: 52,
    racecraft: 74,
    aggression: 38,
    riskTolerance: 47,
    patience: 81,
    consistency: 86,
    customFields: {
      Style: 'Patient race manager',
    },
  },
  vehicle: {
    id: 'budget-bb01',
    name: 'BB-01 Ledger',
    power: 48,
    braking: 72,
    aero: 55,
    dragEfficiency: 66,
    mechanicalGrip: 63,
    weightControl: 58,
    tireCare: 82,
    customFields: [
      { label: 'Aero kit', value: 'Low drag' },
      { label: 'Battery map', value: 'Conservative' },
    ],
  },
  team: {
    id: 'ledger-racing',
    name: 'Ledger Racing',
    color: '#00ff84',
    icon: 'LR',
    pitCrew: {
      speed: 0.72,
      consistency: 0.81,
      reliability: 0.9,
    },
  },
}
```

Entries match drivers by `driverId`. Entry `driverId` values must be unique. `driverNumber` is optional; if omitted, PaddockJS falls back to stable grid order. When `driverNumber` is provided, values must be unique.
The car/driver overview primarily renders the existing driver and vehicle rating components from `driver` and `vehicle`. `team` is optional team-level metadata for race identity and pit behavior; `color` defaults to the driver/car color, and `icon` defaults from the team name or timing code. `team.pitCrew` may define `speed`, `consistency`, and `reliability` from `0` to `1`; these values affect optional pit-stop variability when `rules.modules.pitStops.variability.enabled` is true. The timing tower uses the team icon in the car/team column. `driver.customFields`, `vehicle.customFields`, and top-level driver `customFields` are accepted as extra metadata after those defined components.

## Rating Rules

Driver and vehicle ratings use `0-100`.

- `0`: minimum.
- `50`: neutral.
- `100`: maximum.

Rating conversion lives in:

- `src/data/driverData.js`
- `src/data/vehicleData.js`

## Callback Contract

PaddockJS does not directly own host navigation. The host should provide:

```js
onDriverOpen(driver) {
  window.location.href = driver.link;
}
```

The callback receives the normalized driver object. If the host wants modals, routing, analytics, or external tabs, it should implement that inside this callback.

Optional lifecycle callbacks:

```js
{
  onLoadingChange({ loading, phase }) {},
  onReady({ snapshot }) {},
  onError(error, context) {},
  onDriverSelect(driver, snapshot) {},
  onRaceEvent(event, snapshot) {},
  onLapChange({ previousLeaderLap, leaderLap, leader, snapshot }) {},
  onRaceFinish({ winner, classification, snapshot }) {},
}
```

`onRaceEvent` receives simulation events such as `contact`, `penalty`, `track-limits`, `pit-lane-speeding`, `safety-car`, `green-flag`, `start-lights-out`, and `race-finish`. `contact` events include metadata from the production body collision solver: `firstShapeId`, `secondShapeId`, `contactType`, `depth`, and `timeOfImpact`. Host callback errors are caught; if `onError` exists, it receives `{ callback: name }` context for callback failures.

Race snapshots include a top-level `penalties` array. Each penalty entry includes `id`, `type`, `driverId`, `strictness`, `status`, `penaltySeconds`, `pendingPenaltySeconds`, `serviceType`, `serviceRequired`, `serviceServedAt`, `appliedAt`, `cancelledAt`, `unserved`, `positionDrop`, `gridDrop`, `disqualified`, `consequences`, `lap`, `at`, and rule-specific context such as `otherCarId`, `aheadDriverId`, `atFaultDriverId`, `sharedFault`, and `impactSpeedKph` for collision penalties or `speedKph`, `speedLimitKph`, `excessKph`, and `pitLanePart` for pit-lane speeding penalties. Clear rear contact has one at-fault driver; unclear meaningful contact records one shared-fault penalty per involved driver. Multiple time penalties for the same driver are summed into the car snapshot's `penaltySeconds` and adjusted finish/classification time.

Penalty status values are `issued`, `served`, `applied`, and `cancelled`. Time, position-drop, grid-drop, and disqualification consequences are immediate `applied` penalties. Drive-through and stop-go consequences are service penalties: they start as `issued`, can be completed with `servePenalty(penaltyId)`, and convert to applied time if unserved when final classification is calculated. Pit stops also serve eligible penalties before tire work starts: applied time penalties add their seconds as a hold, stop-go penalties add their configured service seconds, and drive-through penalties are marked served by the pit-lane traversal without extra stationary hold time.

## Asset Overrides

Assets are optional because PaddockJS bundles defaults.

Override shape:

```js
assets: {
  car: '/custom/car.png',
  carOverview: '/custom/car-overview.png',
  driverHelmet: '/custom/driver-helmet.png',
  safetyCar: '/custom/safety-car.png',
  broadcastPanel: '/custom/broadcast-panel.png',
  f1Logo: '/custom/logo.png',
  trackTextures: {
    asphalt: '/custom/asphalt.png',
  },
}
```

Do not require hosts to copy PaddockJS default assets into their own project. If defaults are missing, fix the package.

## UI Options

Preset-first options:

```js
preset: 'timing-overlay',
```

Available presets are:

- `dashboard`: the default all-in-one shell behavior.
- `timing-overlay`: left timing-tower overlay, external camera controls, auto lower-third sizing.
- `compact-race`: a smaller race-canvas-focused setup with fewer surfaces.
- `full-dashboard`: full telemetry/timing shell with external camera controls.

Explicit host options are merged after the preset, so `ui` and `theme` fields can override preset defaults.

Current UI options:

```js
ui: {
  layoutPreset: 'standard',
  cameraControls: 'external',
  showFps: true,
  showTimingTower: true,
	  showTelemetry: true,
	  telemetryIncludesOverview: true,
  telemetryModules: {
    core: true,
    sectors: true,
    lapTimes: true,
    sectorTimes: true,
	  },
	  showRaceDataPanel: true,
	  showPhysicsModeIndicator: false,
	  raceDataBanners: {
    initial: 'project',
    enabled: ['project', 'radio'],
  },
  raceDataBannerSize: 'custom',
  raceDataTelemetryDetail: false,
  timingTowerVerticalFit: 'expand-race-view',
}
```

- `layoutPreset`: `'standard'` or `'left-tower-overlay'`. The overlay preset creates a left broadcast gutter inside the race canvas, places the timing tower in that gutter at the same width as the default timing-board column, and frames the camera around the remaining race-view area. Camera controls are external by default. In the combined shell, the project/radio lower-third stays inside the race window and can render over the timing sidebar.
- `cameraControls`: `'embedded'`, `'external'`, or `false`. The default is external so camera controls do not cover the race view. Embedded controls render inside the race canvas only when explicitly requested. External controls are mounted with `mountCameraControls(root)` or included in package-owned workbench templates. The generated controls include mode buttons, zoom buttons, and a `Mute banners` toggle that temporarily disables project/radio lower-thirds while active. A browser-playback speed button is optional for normal camera controls through `ui.simulationSpeedControl: true`; the complete race workbench enables it by default and cycles `1x`, `2x`, `3x`, `4x`, `5x`, `10x`, then back to `1x`. `false` leaves camera controls unrendered, though callers can still drive selection through controller methods.
- `showFps`: controls whether the race canvas renders the FPS readout.
- `showRaceDataPanel`: controls whether the precombined shell includes the project/radio lower-third inside the race window.
- `showPhysicsModeIndicator`: when `true`, renders a small top-left square in the race canvas. Blue means `physicsMode: 'arcade'`; red means `physicsMode: 'simulator'`. It defaults to `false` for package consumers.
- `showTimingTower`, `showTelemetry`: reserved component visibility flags for host layout decisions.
- `telemetryIncludesOverview`: controls whether the telemetry stack template embeds the car/driver overview. Composable hosts can also pass `mountTelemetryPanel(root, { includeOverview: false })`.
- `telemetryModules`: controls optional telemetry surfaces inside stack/drawer templates. The default object enables `core` scalar readouts, `sectors` progress bars, `lapTimes`, and `sectorTimes`. It can also be `false` to disable all telemetry modules, or an array such as `['sectors', 'lapTimes']` to render only named modules. These modules are also individually mountable with `mountTelemetryCore`, `mountTelemetrySectors`, `mountTelemetryLapTimes`, and `mountTelemetrySectorTimes`.
- `raceDataBanners.initial`: `'project'`, `'radio'`, or `'hidden'`. This controls which lower-third appears first in the precombined shell.
- `raceDataBanners.enabled`: array containing `'project'` and/or `'radio'`. Disabled banner types never appear, including after driver selection.
- Project/radio lower-thirds include a package-owned top-right close button. Clicking it hides the current pill before its scheduled timeout and waits for the next normal driver selection or radio schedule before showing another pill. The camera-control `Mute banners` toggle is off by default and suppresses both project and radio lower-thirds until toggled off again; steward penalty banners are not part of this mute state.
- `raceDataBannerSize`: `'custom'` preserves the default lower-third geometry and exposes package CSS variables for host tuning. `'auto'` uses the race space to the right of the timing board when there is enough room and falls back to full lower-third overlap when there is not.
- `raceDataTelemetryDetail`: when `true`, the project lower-third includes compact S1/S2/S3 sector progress and timing readouts and stays visible until the user dismisses it, banners are muted, or another banner state replaces it. Radio mode keeps the normal quote layout and schedule. The separate `mountTelemetrySectorBanner()` component remains available for hosts that explicitly want an independent sector banner.
- `penaltyBanners`: when `true`, the race view shows a top steward message for track-limit warnings and new steward penalty decisions. Time penalties show a large `+10s` style chip in the left block, with the affected car and rule/reason beside it. Warning-only messages use warning colors and remain separate from penalty decisions. It does not replace the project/radio lower-third.
- `timingPenaltyBadges`: when `true`, timing rows for penalized drivers show a red `!` badge with an accessible penalty label. Warning-only events do not count as penalties and do not show the badge.
- `timingTowerVerticalFit`: `'expand-race-view'` lets the combined race window grow to contain the timing tower. `'scroll'` keeps the race window height and scrolls the timing list inside the cropped tower. The same values can be passed to `mountRaceCanvas(root, { includeTimingTower: true, timingTowerVerticalFit })` for an embedded composable timing tower.

No UI option exists for raw timing-tower width, max width, or horizontal ratio. The timing tower is capped by the package CSS variable `--timing-board-max-width` because very wide timing boards read poorly. Host pages can scale the whole simulator by changing the mount container, but package-owned layout presets keep their internal proportions inside PaddockJS. For standalone timing towers, give the mount root a fixed height when a fixed vertical footprint is needed; the package keeps the frame inside that height and scrolls only the timing entries. Narrow hosts are handled internally: side-gutter timing towers become stacked/full-width, embedded timing towers stop behaving like desktop side overlays, and the camera safe area stops reserving a left gutter when the measured timing board is effectively full-width.

## Theme And Sizing Contract

```js
theme: {
  accentColor: '#e10600',
  greenColor: '#14c784',
  yellowColor: '#ffd166',
  timingTowerMaxWidth: '390px',
  raceViewMinHeight: '620px',
}
```

These values are applied as package CSS variables:

- `accentColor` -> `--paddock-accent-color`
- `greenColor` -> `--paddock-green-color`
- `yellowColor` -> `--paddock-yellow-color`
- `timingTowerMaxWidth` -> `--paddock-timing-tower-max-width`
- `raceViewMinHeight` -> `--paddock-race-view-min-height`

Prefer these fields over host CSS overrides. They are the stable styling surface for reusable embeds.

## Race Completion Snapshot

After every car completes `totalLaps`, `getSnapshot()` returns:

```js
{
  raceControl: {
    mode: 'safety-car',
    finished: true,
    finishedAt: 123.4,
    winner: { id, code, name, rank, finished },
    classification: [
      { id, code, timingCode, name, rank, lap, lapsCompleted, distanceMeters, gapMeters, gapSeconds, intervalSeconds, gapLaps, intervalLaps, finished, finishTime, dnf, dnfReason, dnfAt, dnfOrder, penaltySeconds, adjustedFinishTime, positionDrop, disqualified },
    ],
  },
}
```

Cars also include `team`, `speedKph`, `distanceMeters`, `gapAheadMeters`, `gapAheadSeconds`, `intervalAheadSeconds`, `leaderGapSeconds`, `gapAheadLaps`, `intervalAheadLaps`, `leaderGapLaps`, `finished`, `finishTime`, `finishRank`, `status`, `raceStatus`, `wavedFlag`, `destroyed`, `destroyReason`, `destroyedAt`, `dnf`, `dnfReason`, `dnfAt`, `dnfOrder`, `penaltySeconds`, `adjustedFinishTime`, `classifiedRank`, and `lapTelemetry`. A car that has crossed the finish before the whole race is complete exposes `status: 'waved-flag'`, `raceStatus: 'waved-flag'`, and `wavedFlag: true`; the timing order keeps those cars frozen by provisional `finishRank` until final classification is available, and later barrier contact does not convert that result into DNF. A destroyed/out-of-race car exposes `dnf: true`, keeps compatibility `raceStatus: 'destroyed'`, shows `DNF` in the timing tower, and is ordered below running cars by `dnfOrder`. Classification entries also expose `gapLaps`, `intervalLaps`, `positionDrop`, `disqualified`, and DNF metadata. `gapAheadSeconds` and `intervalAheadSeconds` are the interval to the car directly ahead when both cars are on the same lead-lap cycle; `gapAheadLaps` and `intervalAheadLaps` are the whole-lap deficit to that car when it is at least one lap ahead. `leaderGapSeconds` is the same-lead-lap gap to P1. `leaderGapLaps` is the whole-lap deficit to P1. Seconds gaps are measured from the timestamp difference when both cars crossed the same hidden timing line, with fallback interpolation only when no shared timing line exists yet. The timing tower prefers lap labels such as `+1` over seconds when the relevant lap gap is positive, shows `WAVED` for a finished car before full race classification, and shows `DNF` for retired cars. The first car to finish sets a provisional `raceControl.winner` and receives a `car-finish` event, but the race keeps running until every race participant has finished or is DNF. A DNF car restored before final classification re-enters live timing and must finish; after final classification, resurrection does not reopen the race. Final `raceControl.classification` sorts finishers by `finishTime + penaltySeconds` after converting unserved drive-through and stop-go penalties, applies position-drop and disqualification consequences, then appends DNF entries after finishers.

When `rules.modules.pitStops.enabled` is true, cars also expose `pitIntent`, `pitStop`, and `usedTireCompounds`. `pitIntent` and `pitStop.intent` use `0` for no request, `1` for an opportunistic request that stays active until a free-enough entry window appears, and `2` for a committed request that enters at the next pit-entry window even if pit capacity or gap checks would block mode `1`. `pitStop.status` is one of `pending`, `entering`, `queued`, `servicing`, `exiting`, or `completed`; `pitStop.phase` may be `entry`, `queue`, `queue-release`, `penalty`, `service`, `exit`, or `null`. It also includes the assigned shared service `boxId`/`boxIndex`, the driver's `garageBoxId`/`garageBoxIndex`, optional team id/color, planned pit-call race distance, physical pit-entry race distance, service seconds remaining, `penaltyServiceRemainingSeconds`, `penaltyServiceTotalSeconds`, `servingPenaltyIds`, target tire, optional `serviceProfile`, queue flag, and completed stop count. Host APIs and expert actions can choose the target tire compound with `setPitIntent(driverId, intent, targetCompound)` or `pitCompound`; invalid compounds are rejected. Automatic pit calls can share the same entry lap, but a pending mode `1` car only joins when the active pit-lane population is below `maxConcurrentPitLaneCars` and the nearest active pit-lane car is at least `minimumPitLaneGapMeters` ahead; mode `2` bypasses that opportunistic-capacity gate and commits to the automatic pit-entry route. Team-mates share one service area; every car enters through the working-lane queue point first. If the service area is free, the queue point behaves as a rolling gate and the car immediately follows a short `queue-release` route into service without exposing `queued`; if the area is occupied, the car exposes `status: queued` until servicing, queue-release, and just-exiting cars have physically cleared the active spot. Completed stops can be re-armed by later tire condition or host intent, so `stopsCompleted` can increase beyond one during longer races. `pitLaneSpeedLimitKph` applies only while the automatic route is inside the straight main pit lane/working lane; entry and exit connector roads remain legal pit surfaces but are not limiter zones. The automatic route brakes before the main lane start, travels along the main fast lane, and crosses into the team service area only near the assigned stop. If `phase` is `penalty`, the car is stationary before tire service and the browser renderer shows a red `+Ns` countdown above the car; if `phase` is `service`, it shows a yellow `Ns` countdown for the normal pit-service time. Optional pit-stop variability records the resolved `serviceProfile`; `pitStops.variability.perfect: true` forces the configured default service time for deterministic training. `usedTireCompounds` starts with the initial tire and receives the tire selected by completed automatic pit stops.

Car snapshots expose `surface`, `signedOffset`, `crossTrackError`, `inPitLane`, `pitLanePart`, `pitBoxId`, and `pitLaneCrossTrackError` so hosts can distinguish main-circuit running from pit entry, fast lane, working lane, pit exit, and service-box states without recalculating geometry. `surface` is the worst current wheel/contact-patch surface, not only the center point. Each car also exposes `wheels`, with one entry per contact patch:

```js
{
  id: 'front-left',
  x,
  y,
  signedOffset,
  crossTrackError,
  surface,
  onTrack,
  inPitLane,
  fullyOutsideWhiteLine,
}
```

Use `wheels` when a host needs exact debug overlays, per-wheel surface labels, or track-limit state. A car is track-limit illegal only when all four wheel contact patches are fully outside the same white line; a mixed state such as one wheel on gravel and one wheel still inside the white line reports the worse physics surface but does not count as a track-limit violation.

## Track And Lap Telemetry Snapshot

Every built track is automatically divided into three equal sectors. `snapshot.track.sectors` exposes:

```js
[
  { index: 1, id: 's1', label: 'S1', start, end, startRatio, endRatio, length },
  { index: 2, id: 's2', label: 'S2', start, end, startRatio, endRatio, length },
  { index: 3, id: 's3', label: 'S3', start, end, startRatio, endRatio, length },
]
```

Every built track also exposes hidden `snapshot.track.timingLines`. Timing lines are spaced from the track length at an F1-style mini-sector target of roughly `150m..200m`; they are simulation metadata for gap calculation and are not rendered by default.

Every built track also exposes `snapshot.track.pitLane`. The pit lane is deterministic for the track seed and contains:

- `entry`: track distance before the start line, the true track `edgePoint`, an overlapping lane-facing `trackConnectPoint` on the track surface, connector points from the racing surface to the pit lane, and a procedural `roadCenterline` that is tangent to the main track at entry and tangent to the straight pit lane at the pit-lane start.
- `layout`: the model-owned pit sizing data, including the box-run length, total main-lane length, entry/exit distances relative to start/finish, and entry/exit buffers. The main lane is sized from the configured team/box count instead of using a fixed oversized straight.
- `mainLane`: straight pit-lane fast-lane start/end points, heading, and length.
- `workingLane`: parallel pit box lane start/end points, offset, width, and centerline points.
- `exit`: connector points from the pit lane back to the racing surface after the start line, plus the true track `edgePoint`, an overlapping lane-facing `trackConnectPoint` on the track surface, and a procedural `roadCenterline` that is tangent to the straight pit lane at pit-lane end and tangent to the main track at merge.
- `teams`: team pit groups with id, name, color, index, the two assigned garage box ids, and one shared service area id.
- `serviceAreas`: 10 team service areas, one per team, each with center, queue point, corners, queue corners, team index, and optional `teamId`, `teamName`, and `teamColor`.
- `boxes`: 20 unused garage boxes as 10 team pairs, each with center, lane target, corners, team index, box index, and optional `teamId`, `teamName`, and `teamColor`.

Pit-lane road and box states are legal drivable surfaces. Track state may report `surface: 'pit-entry'`, `'pit-lane'`, `'pit-exit'`, or `'pit-box'` with `inPitLane: true`; `crossTrackError` remains the distance from the main race track for compatibility, while pit-specific offsets are exposed as pit-lane fields on the internal state.

Each car exposes `lapTelemetry`:

```js
{
  currentLap,
  currentSector,
  currentLapTime,
  currentSectorElapsed,
  currentSectorProgress,
  currentSectors: [s1Time, s2Time, s3Time],
  sectorProgress: [s1Progress, s2Progress, s3Progress],
  liveSectors: [s1LiveTime, s2LiveTime, s3LiveTime],
  lastLapTime,
  bestLapTime,
  lastSectors: [s1Time, s2Time, s3Time],
  bestSectors: [s1Time, s2Time, s3Time],
  completedLaps,
}
```

Times are seconds or `null` when no timing exists yet. `currentSectorProgress` is `0..1` within the active sector. `sectorProgress` is the live fill state for the current lap: completed sectors before the active sector are filled only when a real split was recorded, the active sector progresses live, and missing/future sectors stay empty. `currentSectors` contains only completed current-lap split times before the active sector, while `liveSectors` combines those recorded completed splits with the active sector's elapsed time and clears any stale future-sector values.

## Unit Conversion

The simulation keeps its internal physics in simulator units. Public speed and distance display fields use `src/simulation/units.js`:

- `simUnitsToMeters(simUnits)`
- `metersToSimUnits(meters)`
- `simSpeedToKph(simUnitsPerSecond)`
- `simSpeedToMetersPerSecond(simUnitsPerSecond)`
- `kphToSimSpeed(kph)`

All public timer, lap-time, sector-time, gap-time, penalty-time, and service-countdown values are seconds. Public distance values with a `Meters` suffix are meters. Internal cumulative fields such as `raceDistance` stay in simulator units and must be converted before being presented as physical distance. The current calibrated speed scale maps `VEHICLE_LIMITS.maxSpeed` to an F1-like `330 km/h`. Rendered car sprite size remains a visual scale and is intentionally larger than physical car length for readability.

## Returned Controller

```js
const simulator = await mountF1Simulator(root, options);
```

Controller methods:

- `destroy()`: removes listeners, destroys PixiJS runtime, clears the host root.
- `restart(nextOptions)`: restarts the simulation with merged non-asset options. Use `destroy()` and mount a new simulator to change bundled or host-provided asset URLs.
- `selectDriver(driverId)`: selects and focuses a driver.
- `setSafetyCarDeployed(deployed)`: toggles safety car state.
- `setRedFlagDeployed(deployed)`: freezes or releases the race under red-flag race control.
- `setPitLaneOpen(open)`: opens or closes the pit lane for new pending pit entries.
- `callSafetyCar()`: deploys the safety car.
- `clearSafetyCar()`: releases the safety car.
- `toggleSafetyCar()`: switches safety car deployment based on the current snapshot.
- `setPitIntent(driverId, intent, targetCompound?)`: requests, clears, or updates a pending automatic pit stop and optional target tire.
- `getPitIntent(driverId)`: reads the current pit intent.
- `getPitTargetCompound(driverId)`: reads the current pit target tire.
- `getSimulationSpeed()`: returns the active browser playback multiplier from the package-owned simulation-speed control, defaulting to `1`.
- `servePenalty(penaltyId)`: marks an issued drive-through or stop-go penalty as served.
- `cancelPenalty(penaltyId)`: cancels a penalty so it no longer affects service, timing, grid, or classification.
- `getSnapshot()`: returns the latest simulation snapshot.

Composable controllers additionally expose:

- `mountRaceControls(root)`: renders the top control/header component.
- `mountCameraControls(root)`: renders package-owned camera mode, zoom, and project/radio banner mute controls outside the race canvas.
- `mountSafetyCarControl(root)`: renders a package-owned safety-car button that binds to the same race-control state as other safety buttons.
- `mountTimingTower(root)`: renders the timing tower component. The tower includes one hidden race-control status banner slot above the timing rows; `raceControl.mode: 'safety-car'` shows the yellow safety-car status, and `raceControl.mode: 'red-flag'` shows the red red-flag status.
- `mountRaceCanvas(root, { includeRaceDataPanel, includeTimingTower, includeTelemetrySectorBanner, timingTowerVerticalFit })`: renders the PixiJS canvas host, optional FPS, start lights, and the top steward message. Camera controls are external by default and render inside the race canvas only when `ui.cameraControls: 'embedded'` is explicitly requested. Pass `includeRaceDataPanel: true` to place the project/radio lower-third inside the race window so it shares race-canvas clipping and layering. Pass `includeTelemetrySectorBanner: true` only when the host intentionally wants the independent sector lower-third in addition to the project/radio banner. Pass `includeTimingTower: true` to place the timing tower inside the race canvas; `timingTowerVerticalFit: 'expand-race-view'` grows the canvas to the tower height, while `'scroll'` keeps the canvas height and scrolls timing rows inside the tower frame. This is required before `start()`.
- `mountTelemetryPanel(root, { includeOverview })`: renders the package-owned telemetry stack template. The stack is only a composition of detached telemetry surfaces, owns vertical scrolling when its host is shorter than its contents, and includes the car/driver overview by default unless `includeOverview: false` is passed or `ui.telemetryIncludesOverview` is `false`.
- `mountTelemetryCore(root)`: renders selected-car scalar telemetry only.
- `mountTelemetrySectors(root)`: renders the live sector progress graph only.
- `mountTelemetryLapTimes(root)`: renders current, last, and best lap timing only.
- `mountTelemetrySectorTimes(root)`: renders last and best sector timing only.
- `mountRaceTelemetryDrawer(root, { timingTowerVerticalFit, drawerInitiallyOpen, raceDataTelemetryDetail })`: renders a template that combines an external top control row, race canvas, embedded timing tower, the project/radio lower-third, top steward message, safety-car control, and a right-side telemetry drawer. The control row contains camera controls, the `1x..10x` simulation-speed toggle, banner mute, the safety-car button, and the telemetry toggle so those controls do not cover the race view. Pass `raceDataTelemetryDetail: true` when this template should put compact S1/S2/S3 detail in the project lower-third instead of mounting a second sector popup. The drawer embeds the same package-owned telemetry stack used by `mountTelemetryPanel()` and takes layout space from the race window when opened.
- `mountCarDriverOverview(root)`: renders the package-owned car/driver overview as a separate component with a Car/Driver toggle, center visual, and linked stat cells from the existing driver/vehicle rating components.
- `mountRaceDataPanel(root)`: renders the project/race-data lower-third as a separate component for hosts that intentionally want it outside the race canvas.
- `start()`: initializes PixiJS, binds mounted controls, and starts the simulation loop.

Mount component roots before calling `start()`. If a component is not mounted, the runtime skips that UI surface instead of requiring hidden placeholder DOM. Mounted surfaces render a package-owned loading overlay immediately; `start()` removes those overlays after PixiJS, assets, controls, and initial readouts have initialized.
