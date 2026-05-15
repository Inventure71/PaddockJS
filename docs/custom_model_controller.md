# Custom Model Controller Guide

This guide explains how to connect a trained driver model to PaddockJS without adding model-specific code to PaddockJS itself.

PaddockJS does not load weights, run neural-network layers, choose rewards, store checkpoints, or own a training algorithm. Your integration module owns those pieces. PaddockJS only provides the simulator runtime, observations, cached specs, action validation, stable driver ordering, and normal physics stepping.

## What You Build

Build a small controller module around your model:

```js
export function createMyDriverController({ modelUrl }) {
  return {
    async init(ctx) {
      this.model = await loadMyModel(modelUrl, ctx.observationSpec);
    },

    async reset(ctx) {
      this.hiddenState = createHiddenState(ctx.controlledDrivers.length);
    },

    async decideBatch(ctx) {
      const vectors = ctx.orderedObservations.map((item) => item.vector);
      const outputs = await this.model.predictBatch(vectors, this.hiddenState);

      return Object.fromEntries(ctx.controlledDrivers.map((driverId, index) => [
        driverId,
        actionFromModelOutput(outputs[index]),
      ]));
    },

    onStep(ctx) {
      recordMyStats(ctx.metrics, ctx.actions);
    },
  };
}
```

The required method is `decideBatch(ctx)`. The other methods are optional:

- `init(ctx)`: load model files, allocate inference runtime, inspect specs.
- `reset(ctx)`: reset hidden state, memory, per-driver buffers, or episode stats.
- `decideBatch(ctx)`: run one batched inference call and return actions for all controlled drivers.
- `onStep(ctx)`: log metrics, rewards, traces, memory activity, or debugging data.

## Controller Context

`decideBatch(ctx)` receives the same shape in browser visualization and JavaScript training-style loops:

```js
{
  controlledDrivers,
  orderedObservations,
  observation,
  metrics,
  events,
  previousActions,
  orderedPreviousActions,
  actionSpec,
  observationSpec,
  policyStep,
  runtimeStep,
  actionRepeat,
  resetDriverIds,
}
```

Use `ctx.controlledDrivers` and `ctx.orderedObservations` for batching. Their order is stable for the runtime, so index `0` in your tensor batch belongs to `ctx.controlledDrivers[0]`.

Specs are cached by the controller loop. Do not call `getObservationSpec()` or `getActionSpec()` every frame.

## Actions

Return normalized physical controls:

```js
{
  [driverId]: {
    steering: -1, // max left
    throttle: 1,
    brake: 0,
    pitIntent: 0,
  }
}
```

`steering` is an absolute steering-wheel target:

- `-1`: maximum left
- `0`: centered
- `1`: maximum right

The vehicle physics still rate-limits the wheel motion. The controller cannot snap car position, heading, speed, or steering state.

If your model outputs `accel` in `[-1, 1]`, map it like this:

```js
function actionFromModelOutput(output) {
  const steering = clamp(output.steering, -1, 1);
  const accel = clamp(output.accel, -1, 1);
  return {
    steering,
    throttle: Math.max(accel, 0),
    brake: Math.max(-accel, 0),
  };
}
```

## Efficient Observation Setup

For high-throughput model inference, prefer compact vectors:

```js
observation: {
  profile: 'physical-driver',
  output: 'vector',
  includeSchema: false,
  vectorType: 'float32',
}
```

This gives each observation a `Float32Array` vector and avoids per-frame object/schema allocation.

For visual debugging, use `output: 'full'` or `output: 'object'` so you can display human-readable senses. Policy Runner uses the active observation values; it should not recompute sharper or different senses than the model receives.

## Headless Runtime

Use the browser-free environment when training or evaluating outside a mounted page:

```js
import {
  createPaddockDriverControllerLoop,
  createPaddockEnvironment,
} from '@inventure71/paddockjs/environment';

const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['agent-1', 'agent-2'],
  physicsMode: 'simulator',
  participantInteractions: { defaultProfile: 'batch-training' },
  observation: {
    profile: 'physical-driver',
    output: 'vector',
    includeSchema: false,
    vectorType: 'float32',
  },
  result: {
    stateOutput: 'none',
    resetDriversObservationScope: 'reset',
  },
});

const loop = createPaddockDriverControllerLoop({
  runtime: env,
  controller: createMyDriverController({ modelUrl: './model.onnx' }),
  actionRepeat: 4,
  mode: 'headless-eval',
});

let result = await loop.reset();
while (!result.done) {
  result = await loop.step();
}
```

## Browser Runtime

Use browser expert mode when you want to watch the model drive:

```js
import {
  createPaddockDriverControllerLoop,
  mountF1Simulator,
} from '@inventure71/paddockjs';

const simulator = await mountF1Simulator(root, {
  drivers,
  entries,
  physicsMode: 'simulator',
  expert: {
    enabled: true,
    controlledDrivers: ['agent-1'],
    frameSkip: 1,
    visualizeSensors: { rays: true, drivers: 'selected' },
  },
  observation: {
    profile: 'physical-driver',
    output: 'full',
    includeSchema: true,
  },
});

const loop = createPaddockDriverControllerLoop({
  runtime: simulator.expert,
  controller: createMyDriverController({ modelUrl: '/models/my-driver.json' }),
  actionRepeat: 4,
  mode: 'browser',
});

await loop.reset();
loop.start();
```

`actionRepeat: 4` means one model decision every four simulator frames. At a 60 FPS visual rate, that is a 15 Hz control cadence.

## Runtime Modes (Single Architecture)

Use one expert runtime with two explicit modes:

1. Local expert mode (default): browser owns stepping through `loop.step()` / `loop.start()`.
2. External render-only mode: browser does not step physics and only renders authoritative external frames.

Switching modes is done by attaching or detaching the external renderer source on `simulator.expert`.

## External Render-Only Mode

Browser expert runtime can also run in render-only mode from external frames:

```js
const source = {
  subscribe(onFrame) {
    const socket = new WebSocket('ws://127.0.0.1:8787/preview');
    socket.addEventListener('message', (event) => {
      const packet = JSON.parse(event.data);
      if (packet?.type !== 'preview:snapshot') return;
      onFrame({
        snapshot: packet.snapshot,
        observation: packet.observation,
        meta: packet.meta,
      });
    });
    return () => socket.close();
  },
};

simulator.expert.attachExternalRenderer(source);
```

Policy Runner live node view can also poll an HTTP endpoint that returns the same frame packet shape (for example `http://127.0.0.1:8787/preview/frame`) when push WebSockets are not available in your training process.

When external renderer mode is attached:

- local expert `step()` is blocked
- local expert `resetDrivers()` is blocked
- local expert `reset()` is blocked in strict mode

Detach before returning to browser-owned stepping:

```js
simulator.expert.detachExternalRenderer();
```

This keeps exactness for live node visualization: the browser renders authoritative external frames and does not advance local physics.

## Python + JS Environment Bridge (Recommended Flow)

When your training orchestration is Python but simulation state comes from the JS environment:

1. Keep the simulator loop authoritative in your JS environment bridge.
2. After each `reset/step/resetDrivers`, publish `{ snapshot, observation, meta }` through your transport.
3. In browser Policy Runner, use `Live node view` and connect that transport URL.
4. While attached, do not issue local browser step/reset calls.

The provided Python base server is transport/inference scaffolding only. It does not own training logic, reward design, checkpoint selection, or simulation stepping.

## Per-Driver Resets

When the runtime supports `resetDrivers()`, the controller loop forwards selected-driver resets and calls `controller.reset(ctx)` with `ctx.resetDriverIds`.

Use this to clear only the affected model state:

```js
reset(ctx) {
  for (const driverId of ctx.resetDriverIds) {
    this.hiddenByDriver.delete(driverId);
    this.memoryByDriver.delete(driverId);
  }
}
```

If `ctx.resetDriverIds` contains every controlled driver, treat it as a full episode reset.

## Model Runtime Choices

The controller can use any inference backend:

- ONNX Runtime Web
- TensorFlow.js
- WebGPU
- Web Worker
- WebAssembly
- a remote HTTP inference service
- plain JavaScript heuristics
- a custom checkpoint format

Keep that code in your app or local experiment. Do not add checkpoint-format parsing or model-runtime dependencies to PaddockJS core unless the package explicitly decides to support that runtime as a generic simulator feature.

## Safety Checklist

Before trusting a controller:

- Confirm it returns one action per controlled driver.
- Confirm it uses `ctx.orderedObservations` instead of relying on object key order.
- Confirm it never mutates `ctx.result`, simulator state, car position, heading, speed, or hidden physics fields.
- Confirm `throttle` and `brake` stay in `[0, 1]`.
- Confirm `steering` stays in `[-1, 1]`.
- Confirm hidden state resets for `ctx.resetDriverIds`.
- Confirm browser visualization and headless evaluation use the same controller code.
- Confirm any reward/stat logic lives in `onStep()` or external training code, not in PaddockJS core.

## Minimal Debug Controller

Use this controller to verify your runtime wiring before connecting a real model:

```js
export function createStraightLineController() {
  return {
    decideBatch(ctx) {
      return Object.fromEntries(ctx.controlledDrivers.map((driverId) => [
        driverId,
        { steering: 0, throttle: 0.35, brake: 0 },
      ]));
    },
  };
}
```

If this controller drives physically and your model does not, the integration loop is probably correct and the issue is in model inputs, normalization, hidden state, or action decoding.
