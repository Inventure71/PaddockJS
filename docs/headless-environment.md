# Headless Environment

Use the environment subpath for browser-free simulation, JavaScript training loops, evaluation, and worker bridges.

```js
import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';
```

Do not import the root package from raw Node or headless tooling. The root package is a browser component entry and imports CSS and image assets.

## Basic Loop

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  frameSkip: 4,
  physicsMode: 'advanced',
});

let result = env.reset();
result = env.step({
  budget: { steering: 0, throttle: 1, brake: 0 },
});

env.destroy();
```

`controlledDrivers` is required. Controlled actions use normalized `steering`, `throttle`, and `brake`, plus optional `pitIntent` and `pitCompound`.

## Training Boundary

PaddockJS owns deterministic stepping, observations, action validation, specs, neutral metrics, scenario reset placement, browser playback hooks, and optional reward callback plumbing. The user owns the ML framework, model weights, reward formula, storage, checkpoints, logs, and training algorithm.

For realistic local-perception policies, prefer:

```js
const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['budget'],
  physicsMode: 'advanced',
  observation: { profile: 'physical-driver' },
});
```

Use `env.getActionSpec()` and `env.getObservationSpec()` instead of guessing action ranges or vector fields.

## Browser Expert Mode

Browser expert mode is opt-in through the browser mount API and is for visual policy playback/debugging:

```js
const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  expert: {
    enabled: true,
    controlledDrivers: ['budget'],
    frameSkip: 4,
  },
});
```

When expert mode is enabled, the visual simulator advances only when host code calls `simulator.expert.step(actions)`. Do not enable expert mode in basic consumer examples; it is easy to think the simulator is broken because it is intentionally waiting for model actions.

For the full contract, see [Bring Your Own Model](training.md), [Custom Model Controller Guide](custom_model_controller.md), and [Model Sense Contract](sense_contract.md).
