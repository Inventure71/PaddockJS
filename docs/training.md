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
- reward design beyond optional starter helpers

## Supported Now

The current expert API is a JavaScript environment contract. It supports:

- `createPaddockEnvironment()` from `@inventure71/paddockjs/environment`
- explicit `controlledDrivers`
- normalized actions: `steering`, `throttle`, and `brake`
- manual stepping with optional `frameSkip`
- object observations in real units plus a numeric vector and schema
- full simulator state under `result.state.snapshot`
- global and per-controlled-driver events
- optional `reward(context)` callbacks and `createProgressReward()`
- `getActionSpec()` and `getObservationSpec()`
- first-slice scenarios with `participants: 'all'`, `'controlled-only'`, or an explicit driver-id list
- built-in AI for non-controlled cars
- browser expert mode through `mountF1Simulator(..., { expert })`
- opt-in browser ray visualization with `expert.visualizeSensors`

The environment also accepts `rules` as a narrow override of the existing race rules, such as `standingStart: false` for training loops. Rule overrides change simulator behavior; keep them fixed when comparing policy runs.

## Deferred

These are not part of the current package API:

- Python Gymnasium wrapper
- custom scenario placements or direct spawn mutation
- static obstacle/ghost-car scenario modes
- debug mutation APIs for arbitrary simulator state
- assisted-control modes that blend model output with built-in AI
- model loading, model storage, model registries, or trained policies

Those features need separate design work because they change scenario ownership, reproducibility, and the safety boundary between user experiments and package internals.

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
