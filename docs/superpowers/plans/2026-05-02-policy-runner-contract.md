# Policy Runner Contract Implementation Plan

> Historical note (2026-05): This plan includes legacy route/page examples (for example `expert-environment`) kept for historical context. The active preview route for policy workflows is `/policy-runner.html`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete PaddockJS as a bring-your-own-model simulator contract: users can train however they want, then run their policy in the same visual simulator without PaddockJS owning the ML stack.

**Architecture:** Keep ML logic outside package internals. Add only contract-level APIs, docs, examples, and parity tests: policy shape convention, observation/action specs, and a visual policy runner example that calls `simulator.expert.step(actions)`. The package must not add neural-network dependencies, model persistence, registries, official trained drivers, or additional reward preset libraries.

**Tech Stack:** JavaScript ESM, PaddockJS environment subpath, browser expert mode, Vitest, Vite local preview, existing docs.

---

## Scope Guardrails

Allowed:

- Document a policy convention: `policy.predict(observation) -> { steering, throttle, brake }`.
- Add `getActionSpec()` and `getObservationSpec()` to the environment runtime and browser expert adapter through the shared runtime.
- Add a visual runner example that uses a toy hand-written policy object.
- Add docs showing how to plug any external model into the visual simulator.
- Add tests proving the contract and headless/visual parity.

Not allowed in this slice:

- TensorFlow.js, ONNX, PyTorch, Gymnasium, or any other ML dependency.
- Model save/load APIs.
- Model registries or checkpoints.
- A package-owned trained model.
- More reward presets beyond the existing optional `createProgressReward()`.
- Scenario curriculum, debug mutation API, or assisted controls.

---

## File Structure

- Modify `src/environment/specs.js`: new small module that builds action and observation specs from resolved environment options.
- Modify `src/environment/runtime.js`: expose `getActionSpec()` and `getObservationSpec()` from the shared runtime so headless and browser expert mode use the same implementation.
- Modify `src/environment/index.d.ts`: public types for specs and new environment methods.
- Modify `src/__tests__/environment.test.js`: tests for spec shape and no ML ownership.
- Modify `src/__tests__/browserExpert.test.js`: headless-to-browser-expert parity test.
- Modify `src/__tests__/publicApi.types.ts`: type smoke for new spec methods.
- Create `local-preview/policy-runner.html`: visual bring-your-own-policy demo page.
- Modify `local-preview/src/main.js`: mount the policy runner page using a local toy policy.
- Modify local-preview nav files: add the new demo link where existing pages link to preview pages.
- Create `docs/training.md`: bring-your-own-model guide.
- Modify `README.md`: link to the guide and show the shortest visual policy runner snippet.
- Modify `docs/data_contract.md`: document spec methods and policy convention.
- Modify `docs/system_specs.md`: document the package boundary explicitly.
- Modify `.changeset/steady-race-package-hardening.md`: mention policy-runner contract and specs.

---

### Task 1: Environment Spec API

**Files:**

- Create: `src/environment/specs.js`
- Modify: `src/environment/runtime.js`
- Modify: `src/environment/index.d.ts`
- Modify: `src/__tests__/environment.test.js`
- Modify: `src/__tests__/publicApi.types.ts`

- [ ] **Step 1: Write failing tests for action and observation specs**

Add to `src/__tests__/environment.test.js` inside `describe('paddock environment observations and runtime', ...)`:

```js
  test('exposes action and observation specs without choosing an ML framework', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      frameSkip: 4,
      sensors: {
        rays: {
          enabled: true,
          anglesDegrees: [-90, 0, 90],
          lengthMeters: 80,
        },
        nearbyCars: {
          enabled: true,
          maxCars: 4,
          radiusMeters: 120,
        },
      },
    });

    expect(env.getActionSpec()).toEqual({
      version: 1,
      controlledDrivers: [driverId],
      action: {
        type: 'continuous',
        perDriver: {
          steering: { min: -1, max: 1, unit: 'normalized' },
          throttle: { min: 0, max: 1, unit: 'normalized' },
          brake: { min: 0, max: 1, unit: 'normalized' },
        },
      },
    });

    expect(env.getObservationSpec()).toMatchObject({
      version: 1,
      controlledDrivers: [driverId],
      object: {
        self: expect.arrayContaining([
          { name: 'speedKph', unit: 'kph' },
          { name: 'trackOffsetMeters', unit: 'm' },
          { name: 'trackHeadingErrorRadians', unit: 'rad' },
          { name: 'onTrack', unit: 'boolean' },
        ]),
        rays: {
          enabled: true,
          anglesDegrees: [-90, 0, 90],
          lengthMeters: 80,
          track: {
            distanceMeters: { unit: 'm', noHitValue: 80 },
            hit: { unit: 'boolean' },
            kind: { values: ['exit', 'entry', null] },
          },
          car: {
            distanceMeters: { unit: 'm', noHitValue: 80 },
            hit: { unit: 'boolean' },
            driverId: { nullable: true },
            relativeSpeedKph: { unit: 'kph' },
          },
        },
        nearbyCars: {
          enabled: true,
          maxCars: 4,
          radiusMeters: 120,
        },
      },
      vector: {
        schema: expect.arrayContaining([
          { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
        ]),
      },
    });
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/__tests__/environment.test.js
```

Expected: fail because `env.getActionSpec` and `env.getObservationSpec` are not functions.

- [ ] **Step 3: Implement spec builders**

Create `src/environment/specs.js`:

```js
export function buildActionSpec(options) {
  return {
    version: 1,
    controlledDrivers: [...options.controlledDrivers],
    action: {
      type: 'continuous',
      perDriver: {
        steering: { min: -1, max: 1, unit: 'normalized' },
        throttle: { min: 0, max: 1, unit: 'normalized' },
        brake: { min: 0, max: 1, unit: 'normalized' },
      },
    },
  };
}

export function buildObservationSpec(options) {
  const rayOptions = options.sensors.rays;
  const nearbyOptions = options.sensors.nearbyCars;
  return {
    version: 1,
    controlledDrivers: [...options.controlledDrivers],
    object: {
      self: [
        { name: 'id', unit: 'id' },
        { name: 'speedKph', unit: 'kph' },
        { name: 'speedMetersPerSecond', unit: 'm/s' },
        { name: 'headingRadians', unit: 'rad' },
        { name: 'steeringAngleRadians', unit: 'rad' },
        { name: 'throttle', unit: 'normalized' },
        { name: 'brake', unit: 'normalized' },
        { name: 'lap', unit: 'count' },
        { name: 'completedLaps', unit: 'count' },
        { name: 'lapProgressMeters', unit: 'm' },
        { name: 'trackOffsetMeters', unit: 'm' },
        { name: 'trackHeadingErrorRadians', unit: 'rad' },
        { name: 'onTrack', unit: 'boolean' },
        { name: 'surface', unit: 'label' },
        { name: 'tireEnergy', unit: 'nullable:number' },
      ],
      race: [
        { name: 'position', unit: 'rank' },
        { name: 'totalCars', unit: 'count' },
        { name: 'raceMode', unit: 'label' },
        { name: 'totalLaps', unit: 'count' },
      ],
      rays: {
        enabled: Boolean(rayOptions.enabled),
        anglesDegrees: [...rayOptions.anglesDegrees],
        lengthMeters: rayOptions.lengthMeters,
        track: {
          distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
          hit: { unit: 'boolean' },
          kind: { values: ['exit', 'entry', null] },
        },
        car: {
          distanceMeters: { unit: 'm', noHitValue: rayOptions.lengthMeters },
          hit: { unit: 'boolean' },
          driverId: { nullable: true },
          relativeSpeedKph: { unit: 'kph' },
        },
      },
      nearbyCars: {
        enabled: Boolean(nearbyOptions.enabled),
        maxCars: nearbyOptions.maxCars,
        radiusMeters: nearbyOptions.radiusMeters,
      },
      events: { type: 'array' },
    },
    vector: {
      schema: [
        { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
        { name: 'self.trackOffsetMeters', unit: 'm', scale: 'fixed:meters' },
        { name: 'self.trackHeadingErrorRadians', unit: 'rad', scale: 'fixed:pi' },
        { name: 'self.onTrack', scale: 'boolean' },
        { name: 'race.position', scale: 'fixed:field-position' },
      ],
    },
  };
}
```

- [ ] **Step 4: Expose specs from shared runtime**

Modify `src/environment/runtime.js`:

```js
import { buildActionSpec, buildObservationSpec } from './specs.js';
```

Inside `createEnvironmentRuntime(host)`, add:

```js
  function getActionSpec() {
    return buildActionSpec(host.getOptions());
  }

  function getObservationSpec() {
    return buildObservationSpec(host.getOptions());
  }
```

Update the return object:

```js
  return { reset, step, getObservation, getState, getActionSpec, getObservationSpec, destroy };
```

- [ ] **Step 5: Add public TypeScript declarations**

Modify `src/environment/index.d.ts`:

```ts
export interface PaddockActionSpec {
  version: 1;
  controlledDrivers: string[];
  action: {
    type: 'continuous';
    perDriver: {
      steering: { min: -1; max: 1; unit: 'normalized' };
      throttle: { min: 0; max: 1; unit: 'normalized' };
      brake: { min: 0; max: 1; unit: 'normalized' };
    };
  };
}

export interface PaddockObservationSpec {
  version: 1;
  controlledDrivers: string[];
  object: Record<string, unknown>;
  vector: {
    schema: PaddockObservationSchemaEntry[];
  };
}
```

Add methods to `PaddockEnvironment`:

```ts
  getActionSpec(): PaddockActionSpec;
  getObservationSpec(): PaddockObservationSpec;
```

- [ ] **Step 6: Add public type smoke**

Modify `src/__tests__/publicApi.types.ts` after `env.reset()`:

```ts
const actionSpec = env.getActionSpec();
const observationSpec = env.getObservationSpec();
const firstActionDriver: string | undefined = actionSpec.controlledDrivers[0];
const firstVectorField: string | undefined = observationSpec.vector.schema[0]?.name;
void firstActionDriver;
void firstVectorField;
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- src/__tests__/environment.test.js
npm run types:check
```

Expected: both pass.

---

### Task 2: Bring-Your-Own-Policy Visual Runner Example

**Files:**

- Create: `local-preview/policy-runner.html`
- Modify: `local-preview/src/main.js`
- Modify: `local-preview/index.html`
- Modify: `local-preview/api.html`
- Modify: `local-preview/behavior.html`
- Modify: `local-preview/components.html`
- Modify: `local-preview/templates.html`
- Modify: `local-preview/expert-environment.html`

- [ ] **Step 1: Create the preview page**

Create `local-preview/policy-runner.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PaddockJS Policy Runner</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body data-page="policy-runner">
    <nav class="preview-nav" aria-label="PaddockJS preview pages">
      <a href="/">All-in-one</a>
      <a href="/components.html">Components</a>
      <a href="/templates.html">Templates</a>
      <a href="/api.html">API</a>
      <a href="/behavior.html">Behavior</a>
      <a href="/expert-environment.html">Expert</a>
      <a href="/policy-runner.html" aria-current="page">Policy Runner</a>
    </nav>

    <main class="preview-page">
      <section class="preview-hero">
        <p class="eyebrow">Bring your own model</p>
        <h1>Visual policy runner</h1>
        <p>
          A policy object reads expert observations, returns normalized actions,
          and advances the same visual simulator through expert stepping.
        </p>
      </section>

      <section class="showcase-block">
        <div id="policy-runner-root" class="preview-sim preview-sim--expert"></div>
      </section>

      <section class="showcase-block showcase-block--split">
        <div>
          <h2>Policy output</h2>
          <pre data-policy-runner-readout class="preview-code"></pre>
        </div>
        <div>
          <h2>Runner controls</h2>
          <div class="preview-controls">
            <button type="button" data-policy-runner-reset>Reset</button>
            <button type="button" data-policy-runner-step>Step</button>
            <label>
              <input type="checkbox" data-policy-runner-auto />
              Auto run
            </label>
          </div>
        </div>
      </section>
    </main>

    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Add policy runner code**

Modify `local-preview/src/main.js` by adding:

```js
async function mountPolicyRunnerPage() {
  const root = requiredElement('policy-runner-root');
  const readout = document.querySelector('[data-policy-runner-readout]');
  const resetButton = document.querySelector('[data-policy-runner-reset]');
  const stepButton = document.querySelector('[data-policy-runner-step]');
  const autoInput = document.querySelector('[data-policy-runner-auto]');
  const controlledDriver = DEMO_PROJECT_DRIVERS[0].id;
  let result = null;
  let timer = null;

  const simulator = await mountF1Simulator(root, {
    ...commonOptions('policy-runner'),
    preset: 'compact-race',
    title: 'Policy Runner',
    kicker: 'policy.predict(observation) -> action',
    seed: 71,
    trackSeed: SHOWCASE_TRACK_SEED,
    totalLaps: 3,
    expert: {
      enabled: true,
      controlledDrivers: [controlledDriver],
      frameSkip: 4,
      visualizeSensors: { rays: true },
    },
    ui: {
      raceDataBanners: { initial: 'hidden', enabled: ['project', 'radio'] },
    },
  });
  simulator.selectDriver(controlledDriver);
  addController('policy-runner', simulator);

  const policy = {
    predict(observation) {
      const self = observation.object.self;
      const frontRay = observation.object.rays.find((ray) => ray.angleDegrees === 0);
      const leftRay = observation.object.rays.find((ray) => ray.angleDegrees === -60);
      const rightRay = observation.object.rays.find((ray) => ray.angleDegrees === 60);
      const frontDistance = frontRay?.track?.distanceMeters ?? 120;
      const rayBalance = (rightRay?.track?.distanceMeters ?? 120) - (leftRay?.track?.distanceMeters ?? 120);
      return {
        steering: clampPolicyAction(-self.trackHeadingErrorRadians * 1.4 - self.trackOffsetMeters * 0.08 + rayBalance * 0.004, -1, 1),
        throttle: clampPolicyAction(0.72 - Math.max(0, 35 - frontDistance) / 80, 0, 1),
        brake: clampPolicyAction(Math.max(0, 28 - frontDistance) / 60, 0, 1),
      };
    },
  };

  function reset() {
    result = simulator.expert.reset();
    render(null);
  }

  function step() {
    if (!result) result = simulator.expert.reset();
    const observation = result.observation[controlledDriver];
    const action = policy.predict(observation);
    result = simulator.expert.step({ [controlledDriver]: action });
    render(action);
    if (result.done) stop();
  }

  function render(action) {
    const observation = result?.observation?.[controlledDriver];
    readout.textContent = JSON.stringify({
      step: result?.info?.step,
      action,
      self: observation?.object?.self,
      rays: observation?.object?.rays,
      actionSpec: simulator.expert.getActionSpec(),
      observationSpec: simulator.expert.getObservationSpec(),
    }, null, 2);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    autoInput.checked = false;
  }

  resetButton.addEventListener('click', reset);
  stepButton.addEventListener('click', step);
  autoInput.addEventListener('change', () => {
    if (!autoInput.checked) {
      stop();
      return;
    }
    timer = window.setInterval(() => {
      for (let index = 0; index < 6 && autoInput.checked; index += 1) step();
    }, 32);
  });

  reset();
}

function clampPolicyAction(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
```

At the bottom page router, add:

```js
  if (page === 'policy-runner') await mountPolicyRunnerPage();
```

- [ ] **Step 3: Add nav links**

Add this link beside the existing Expert link in each local preview nav:

```html
<a href="/policy-runner.html">Policy Runner</a>
```

On `local-preview/policy-runner.html`, keep:

```html
<a href="/policy-runner.html" aria-current="page">Policy Runner</a>
```

- [ ] **Step 4: Run preview build**

Run:

```bash
npm --prefix local-preview run build
```

Expected: build includes `dist/policy-runner.html`.

---

### Task 3: Headless-To-Visual Parity Test

**Files:**

- Modify: `src/__tests__/browserExpert.test.js`

- [ ] **Step 1: Write failing parity test**

Add imports:

```js
import { createPaddockEnvironment } from '../environment/index.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
```

Add test:

```js
  test('matches headless environment state for the same seed and actions', () => {
    const driverId = DEMO_PROJECT_DRIVERS[0].id;
    const options = {
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 3),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      frameSkip: 3,
      totalLaps: 2,
      scenario: { participants: 'controlled-only' },
      rules: { standingStart: false },
    };
    const headless = createPaddockEnvironment(options);
    let visualSim = createRaceSimulation(options);
    const app = {
      sim: visualSim,
      options: {
        ...options,
        expert: {
          enabled: true,
          controlledDrivers: [driverId],
          frameSkip: 3,
        },
      },
      applyExpertOptions: vi.fn(),
      createRaceSimulation: vi.fn((nextOptions) => {
        visualSim = createRaceSimulation(nextOptions);
        return visualSim;
      }),
      renderExpertFrame: vi.fn(),
      renderTrack: vi.fn(),
    };
    const expert = createBrowserExpertAdapter(app, {
      enabled: true,
      controlledDrivers: [driverId],
      frameSkip: 3,
    });

    headless.reset();
    expert.reset();

    const actions = [
      { [driverId]: { steering: 0, throttle: 1, brake: 0 } },
      { [driverId]: { steering: 0.2, throttle: 0.8, brake: 0 } },
      { [driverId]: { steering: -0.1, throttle: 0.6, brake: 0.1 } },
    ];

    let headlessResult = null;
    let visualResult = null;
    actions.forEach((action) => {
      headlessResult = headless.step(action);
      visualResult = expert.step(action);
    });

    const headlessCar = headlessResult.state.snapshot.cars.find((car) => car.id === driverId);
    const visualCar = visualResult.state.snapshot.cars.find((car) => car.id === driverId);

    expect(visualResult.info.step).toBe(headlessResult.info.step);
    expect(visualCar.distanceMeters).toBeCloseTo(headlessCar.distanceMeters, 5);
    expect(visualCar.speedKph).toBeCloseTo(headlessCar.speedKph, 5);
    expect(visualResult.observation[driverId].object.rays).toEqual(headlessResult.observation[driverId].object.rays);
  });
```

- [ ] **Step 2: Run the parity test**

Run:

```bash
npm test -- src/__tests__/browserExpert.test.js
```

Expected before Task 1 runtime method work may fail if specs are missing elsewhere; after Task 1 it should pass. If it fails because browser expert options differ from headless options, fix `createBrowserExpertAdapter` option merging rather than loosening the test.

---

### Task 4: Bring-Your-Own-Model Guide

**Files:**

- Create: `docs/training.md`
- Modify: `README.md`
- Modify: `docs/index.md`
- Modify: `docs/data_contract.md`
- Modify: `docs/system_specs.md`

- [ ] **Step 1: Create guide**

Create `docs/training.md`:

```md
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
```

- [ ] **Step 2: Link guide from docs index**

Modify `docs/index.md`:

```md
- [Bring Your Own Model](training.md): environment contract, policy convention, and visual playback loop.
```

- [ ] **Step 3: Add README short section**

Add under Expert Environment API in `README.md`:

```md
PaddockJS is a bring-your-own-model environment. It does not choose an ML framework, store model weights, or ship a trained driver. See [Bring Your Own Model](docs/training.md) for the policy shape and visual playback loop.
```

- [ ] **Step 4: Update system specs boundary**

Add to `docs/system_specs.md` near the expert environment section:

```md
The package must not own model training, model persistence, model registries, or trained policy behavior. The supported contract is: external code reads observations, returns normalized actions, and advances either the headless environment or browser expert mode.
```

- [ ] **Step 5: Update data contract**

Add to `docs/data_contract.md` near the environment contract:

```md
The recommended policy convention is `policy.predict(driverObservation) -> { steering, throttle, brake }`. This is a convention, not a base class. Users can wrap any model or algorithm behind that shape.
```

---

### Task 5: Package Metadata And Release Notes

**Files:**

- Modify: `.changeset/steady-race-package-hardening.md`
- Modify: `package.json` if `files` needs to include the new doc path; current `docs/*.md` already includes `docs/training.md`.

- [ ] **Step 1: Update changeset**

Append this sentence to `.changeset/steady-race-package-hardening.md`:

```md
It also documents the bring-your-own-model boundary, adds environment action/observation specs, and includes a visual policy-runner example that demonstrates `policy.predict(observation)` driving browser expert mode without adding ML dependencies or model persistence.
```

- [ ] **Step 2: Verify docs are included in package**

Run:

```bash
npm run pack:dry
```

Expected: tarball contents include `docs/training.md`; `local-preview/policy-runner.html` is not required in the published package because local preview is a repo verification host.

---

### Task 6: Final Verification

**Files:**

- No new files. Verification only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/__tests__/environment.test.js src/__tests__/browserExpert.test.js
npm run types:check
```

Expected: tests and type check pass.

- [ ] **Step 2: Run full package check**

Run:

```bash
npm_config_cache=/private/tmp/paddockjs-npm-cache npm run check
```

Expected: test suite, type check, dry pack, and local-preview build pass.

- [ ] **Step 3: Browser smoke policy runner**

Start or reuse the local preview server:

```bash
npm --prefix local-preview run dev
```

Open:

```txt
http://127.0.0.1:5174/policy-runner.html
```

Verify with Playwright:

```js
await page.goto('http://127.0.0.1:5174/policy-runner.html');
await page.click('[data-policy-runner-reset]');
await page.click('[data-policy-runner-step]');
const readout = JSON.parse(await page.locator('[data-policy-runner-readout]').textContent());
expect(readout.action).toHaveProperty('steering');
expect(readout.actionSpec.action.perDriver.steering).toEqual({ min: -1, max: 1, unit: 'normalized' });
expect(readout.observationSpec.object.rays.track.kind.values).toEqual(['exit', 'entry', null]);
```

Expected: visual simulator renders, one explicit step advances, readout includes action, action spec, and observation spec.

- [ ] **Step 4: Linear log**

Add a Linear comment to `MGI-19`:

```md
Completed the policy-runner contract slice:

- Added action and observation specs to the shared environment runtime.
- Added a bring-your-own-policy visual runner example.
- Documented the policy convention and package boundary.
- Added headless-to-browser-expert parity coverage.

Verification:
- focused environment/browser expert tests passed
- type check passed
- full package check passed
- browser smoke passed on policy runner page

Boundary preserved:
- no ML dependencies
- no model persistence
- no registry
- no package-owned trained model
```

---

## Self-Review

Spec coverage:

- Visual policy runner example: Task 2.
- Documented policy shape: Task 4.
- Observation/action specs: Task 1.
- Headless-to-visual parity test: Task 3.
- Bring-your-own-model guide: Task 4.
- Boundary against training-framework overreach: Scope Guardrails, Task 4, Task 5, Task 6.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified implementation steps.
- Each code-facing task includes concrete code or exact expected command behavior.

Type consistency:

- Runtime methods: `getActionSpec()` and `getObservationSpec()`.
- Policy convention: `policy.predict(observation) -> { steering, throttle, brake }`.
- Ray contract remains `{ hit, distanceMeters, kind }` for track and `{ hit, distanceMeters, driverId, relativeSpeedKph }` for car.
