# Bring Your Own Model

PaddockJS does not train models for you. It provides a simulator environment contract so users can train with any toolchain, then run the resulting policy in the visual simulator.

## Boundary

PaddockJS owns:

- deterministic simulator stepping
- observations
- normalized actions
- events
- optional reward callback hooks
- browser expert stepping
- sensor visualization

Users own:

- ML framework choice
- training algorithm
- model weights
- model storage
- model loading
- reward design beyond optional starter helpers

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
