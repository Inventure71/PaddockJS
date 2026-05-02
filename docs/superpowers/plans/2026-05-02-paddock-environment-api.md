# Paddock Environment API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first useful `0.3.0` expert environment slice: a Gym-style JavaScript environment API for headless training plus a narrow browser expert wrapper that drives the exact same visual `RaceSimulation` instance.

**Architecture:** Add a browser-free `src/environment/` package subpath whose shared runtime operates on a supplied `RaceSimulation` host. The headless API owns its own `RaceSimulation`; browser expert mode wraps `F1SimulatorApp.sim`, disables automatic ticker advancement, and renders only after explicit expert `reset()` / `step(actions)`.

**Tech Stack:** JavaScript ESM, Vitest, TypeScript declaration file checks, existing PaddockJS `RaceSimulation`, existing local-preview Vite host.

---

## Decisions This Plan Implements

Source: `Q&A.md` in the repo root.

- `createPaddockEnvironment()` is exported only from `@inventure71/paddockjs/environment`.
- The environment subpath must not import CSS, Pixi, DOM app code, or `src/index.js`.
- `controlledDrivers` is required.
- Actions are normalized `{ steering: -1..1, throttle: 0..1, brake: 0..1 }`.
- `step(actions)` manually advances fixed simulation ticks; `frameSkip` repeats an action for multiple ticks.
- Observation includes readable object data in real units plus vector/schema data with fixed documented scaling.
- Full simulator truth is returned separately under `state`.
- Basic rays detect track and cars.
- Nearby cars are included.
- Global and per-driver events are returned.
- Reward is optional and user-defined; there is no built-in reward preset in this slice.
- First-slice scenario support is `participants: 'all' | 'controlled-only' | string[]` and `nonControlled: 'ai'`.
- Browser expert mode is opt-in and narrow: `reset()`, `step(actions)`, `getObservation()`, `getState()`.
- Browser expert mode must reuse `F1SimulatorApp.sim`, not create a parallel simulation.

## File Structure

Create:

- `src/environment/index.js`: public subpath export.
- `src/environment/index.d.ts`: public subpath types.
- `src/environment/options.js`: validates/normalizes environment options, controlled drivers, scenario participants, frame skip, sensor config, episode config, action policy.
- `src/environment/runtime.js`: shared Gym-like runtime over an injected simulation host.
- `src/environment/actions.js`: validates normalized action maps and maps steering into simulator control units.
- `src/environment/observations.js`: builds object observations, vector/schema, per-driver events, and state wrapper.
- `src/environment/sensors.js`: builds basic ray and nearby-car sensor readings.
- `src/environment/events.js`: normalizes step events for global and per-driver consumers.
- `src/environment/episode.js`: tracks step count, termination/truncation, max steps, stuck detection.
- `src/app/BrowserExpertAdapter.js`: wraps the already-mounted `F1SimulatorApp` simulation using the shared runtime.
- `src/__tests__/environment.test.js`: headless environment contract tests.
- `src/__tests__/browserExpert.test.js`: visual expert adapter behavior tests using app stubs where possible.
- `local-preview/expert-environment.html`: executable example page.

Modify:

- `package.json`: add `./environment` export and include `src/environment` in published files.
- `src/app/F1SimulatorApp.js`: create/attach expert adapter when `options.expert.enabled` is true; disable automatic ticker simulation advancement in expert mode; expose render-after-step helper.
- `src/api/PaddockSimulatorController.js`: expose `expert` on composable controller after `start()` when enabled.
- `src/index.js`: keep root browser API unchanged; do not export `createPaddockEnvironment()` from root.
- `src/index.d.ts`: add browser `expert` option and mounted/controller `expert` property types; do not add headless environment export here.
- `src/__tests__/publicApi.types.ts`: type-check browser expert property and subpath environment import.
- `local-preview/src/main.js`: mount the expert example page.
- `local-preview/src/styles.css`: add restrained example styles.
- `local-preview/package.json` or Vite config only if needed for the subpath import; prefer no config change.
- `README.md`: document environment subpath and link to detailed contract.
- `docs/data_contract.md`: add expert environment input/output contract.
- `docs/architecture.md`: document shared environment runtime and browser adapter boundary.
- `docs/system_specs.md`: document public lifecycle and package export boundary.
- `.changeset/steady-race-package-hardening.md`: ensure the existing `0.3.0` changeset mentions the expert environment foundation if this is implemented in the same release stack.

Do not create:

- Python Gymnasium wrapper.
- Debug mutation API.
- Static obstacle placement API.
- Assisted control modes.
- Root export for `createPaddockEnvironment()`.

---

## Task 1: Package Export Boundary

**Files:**
- Modify: `package.json`
- Create: `src/environment/index.js`
- Create: `src/environment/index.d.ts`
- Modify: `src/__tests__/publicApi.types.ts`

- [ ] **Step 1: Add a failing type/import test for the subpath**

  Add this to `src/__tests__/publicApi.types.ts`:

  ```ts
  import { createPaddockEnvironment } from '../environment/index.js';

  const env = createPaddockEnvironment({
    drivers: options.drivers,
    controlledDrivers: ['budget'],
  });

  const resetResult = env.reset();
  resetResult.info.controlledDrivers.includes('budget');
  env.step({
    budget: { steering: 0, throttle: 1, brake: 0 },
  });
  env.destroy();
  ```

- [ ] **Step 2: Run type check and confirm it fails**

  Run:

  ```bash
  npm run types:check
  ```

  Expected: FAIL because `src/environment/index.d.ts` does not exist yet.

- [ ] **Step 3: Add the package subpath export**

  In `package.json`, add:

  ```json
  "./environment": {
    "types": "./src/environment/index.d.ts",
    "import": "./src/environment/index.js",
    "default": "./src/environment/index.js"
  }
  ```

  Also add `"src/environment"` to `files`.

- [ ] **Step 4: Create the public environment module skeleton**

  Create `src/environment/index.js`:

  ```js
  export { createPaddockEnvironment } from './runtime.js';
  ```

  Create `src/environment/index.d.ts` with the initial public types:

  ```ts
  import type {
    ChampionshipEntryBlueprint,
    RaceEvent,
    RaceSnapshot,
    SimulatorDriver,
  } from '../index.js';

  export interface PaddockAction {
    steering: number;
    throttle: number;
    brake: number;
  }

  export type PaddockActionMap = Record<string, PaddockAction>;

  export interface PaddockEnvironmentOptions {
    drivers: SimulatorDriver[];
    entries?: ChampionshipEntryBlueprint[];
    controlledDrivers: string[];
    seed?: number;
    trackSeed?: number;
    totalLaps?: number;
    frameSkip?: number;
    actionPolicy?: 'strict' | 'report';
    scenario?: {
      participants?: 'all' | 'controlled-only' | string[];
      nonControlled?: 'ai';
    };
  }

  export interface PaddockDriverObservation {
    object: Record<string, unknown>;
    vector: number[];
    schema: Array<{ name: string; unit?: string; scale?: string }>;
    events: RaceEvent[];
  }

  export interface PaddockEnvironmentResult {
    observation: Record<string, PaddockDriverObservation>;
    reward: null | Record<string, number>;
    terminated: boolean;
    truncated: boolean;
    done: boolean;
    events: RaceEvent[];
    state: { snapshot: RaceSnapshot };
    info: {
      step: number;
      elapsedSeconds: number;
      seed: number;
      trackSeed: number;
      controlledDrivers: string[];
      actionErrors: string[];
      endReason: string | null;
    };
  }

  export interface PaddockEnvironment {
    reset(options?: Partial<PaddockEnvironmentOptions>): PaddockEnvironmentResult;
    step(actions: PaddockActionMap): PaddockEnvironmentResult;
    getObservation(): PaddockEnvironmentResult['observation'];
    getState(): PaddockEnvironmentResult['state'];
    destroy(): void;
  }

  export function createPaddockEnvironment(options: PaddockEnvironmentOptions): PaddockEnvironment;
  ```

- [ ] **Step 5: Run type check**

  Run:

  ```bash
  npm run types:check
  ```

  Expected: the type import should pass or fail only because implementation files are still missing.

---

## Task 2: Environment Options And Scenario Resolution

**Files:**
- Create: `src/environment/options.js`
- Create/modify: `src/__tests__/environment.test.js`

- [ ] **Step 1: Write tests for required controlled drivers and participant selection**

  Create `src/__tests__/environment.test.js` with:

  ```js
  import { describe, expect, test } from 'vitest';
  import { CHAMPIONSHIP_ENTRY_BLUEPRINTS, DEMO_PROJECT_DRIVERS } from '../index.js';
  import {
    resolveEnvironmentOptions,
  } from '../environment/options.js';

  describe('paddock environment options', () => {
    test('requires explicit controlled drivers', () => {
      expect(() => resolveEnvironmentOptions({
        drivers: DEMO_PROJECT_DRIVERS,
      })).toThrow('controlledDrivers is required');
    });

    test('resolves controlled-only participants', () => {
      const options = resolveEnvironmentOptions({
        drivers: DEMO_PROJECT_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
        controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
        scenario: { participants: 'controlled-only' },
      });

      expect(options.drivers.map((driver) => driver.id)).toEqual([DEMO_PROJECT_DRIVERS[0].id]);
      expect(options.controlledDrivers).toEqual([DEMO_PROJECT_DRIVERS[0].id]);
      expect(options.scenario.nonControlled).toBe('ai');
    });
  });
  ```

- [ ] **Step 2: Run the targeted test and confirm it fails**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: FAIL because `src/environment/options.js` does not exist.

- [ ] **Step 3: Implement `resolveEnvironmentOptions()`**

  Create `src/environment/options.js`:

  ```js
  import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';

  const DEFAULT_FRAME_SKIP = 1;
  const DEFAULT_MAX_STEPS = 10000;
  const DEFAULT_SENSOR_OPTIONS = {
    rays: {
      enabled: true,
      anglesDegrees: [-135, -60, -20, 0, 20, 60, 135, 180],
      lengthMeters: 120,
      detectTrack: true,
      detectCars: true,
    },
    nearbyCars: {
      enabled: true,
      maxCars: 6,
      radiusMeters: 150,
    },
  };

  export function resolveEnvironmentOptions(options = {}) {
    if (!Array.isArray(options.controlledDrivers) || options.controlledDrivers.length === 0) {
      throw new Error('PaddockJS environment controlledDrivers is required.');
    }

    const resolved = resolveF1SimulatorOptions(options);
    const driverIds = new Set(resolved.drivers.map((driver) => driver.id));
    const controlledDrivers = [...new Set(options.controlledDrivers)];
    controlledDrivers.forEach((driverId) => {
      if (!driverIds.has(driverId)) {
        throw new Error(`PaddockJS environment controlled driver does not exist: ${driverId}`);
      }
    });

    const scenario = resolveScenario(options.scenario, controlledDrivers, driverIds);
    const participants = resolveParticipants(scenario.participants, controlledDrivers, resolved.drivers);

    return {
      ...resolved,
      drivers: resolved.drivers.filter((driver) => participants.has(driver.id)),
      controlledDrivers,
      frameSkip: normalizePositiveInteger(options.frameSkip, DEFAULT_FRAME_SKIP, 'frameSkip'),
      actionPolicy: options.actionPolicy === 'report' ? 'report' : 'strict',
      scenario,
      sensors: mergeSensorOptions(options.sensors),
      sensorsByDriver: options.sensorsByDriver ?? {},
      episode: {
        maxSteps: normalizePositiveInteger(options.episode?.maxSteps, DEFAULT_MAX_STEPS, 'episode.maxSteps'),
        endOnRaceFinish: options.episode?.endOnRaceFinish !== false,
      },
      reward: typeof options.reward === 'function' ? options.reward : null,
    };
  }

  function resolveScenario(scenario = {}, controlledDrivers, driverIds) {
    const participants = scenario.participants ?? 'all';
    if (
      participants !== 'all' &&
      participants !== 'controlled-only' &&
      !Array.isArray(participants)
    ) {
      throw new Error('PaddockJS environment scenario.participants must be "all", "controlled-only", or an array of driver ids.');
    }
    if (scenario.nonControlled != null && scenario.nonControlled !== 'ai') {
      throw new Error('PaddockJS environment first slice only supports scenario.nonControlled: "ai".');
    }
    if (Array.isArray(participants)) {
      participants.forEach((driverId) => {
        if (!driverIds.has(driverId)) {
          throw new Error(`PaddockJS environment scenario participant does not exist: ${driverId}`);
        }
      });
      controlledDrivers.forEach((driverId) => {
        if (!participants.includes(driverId)) {
          throw new Error(`PaddockJS environment controlled driver must be included in scenario participants: ${driverId}`);
        }
      });
    }
    return {
      participants,
      nonControlled: 'ai',
    };
  }

  function resolveParticipants(participants, controlledDrivers, drivers) {
    if (participants === 'controlled-only') return new Set(controlledDrivers);
    if (Array.isArray(participants)) return new Set(participants);
    return new Set(drivers.map((driver) => driver.id));
  }

  function normalizePositiveInteger(value, fallback, label) {
    if (value == null) return fallback;
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number < 1) {
      throw new Error(`PaddockJS environment ${label} must be a positive integer.`);
    }
    return number;
  }

  function mergeSensorOptions(sensors = {}) {
    return {
      rays: {
        ...DEFAULT_SENSOR_OPTIONS.rays,
        ...(sensors.rays ?? {}),
      },
      nearbyCars: {
        ...DEFAULT_SENSOR_OPTIONS.nearbyCars,
        ...(sensors.nearbyCars ?? {}),
      },
    };
  }
  ```

- [ ] **Step 4: Run targeted test**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: PASS for options tests.

---

## Task 3: Action Validation And Control Mapping

**Files:**
- Create: `src/environment/actions.js`
- Modify: `src/__tests__/environment.test.js`

- [ ] **Step 1: Add action validation tests**

  Add:

  ```js
  import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';
  import { resolveActionMap } from '../environment/actions.js';

  test('maps normalized steering to simulator steering angle', () => {
    const controls = resolveActionMap({
      budget: { steering: 1, throttle: 2, brake: -1 },
    }, ['budget'], { policy: 'strict' });

    expect(controls.controlsByDriver.budget).toEqual({
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 1,
      brake: 0,
    });
    expect(controls.errors).toEqual([]);
  });

  test('throws for missing controlled-driver actions in strict mode', () => {
    expect(() => resolveActionMap({}, ['budget'], { policy: 'strict' }))
      .toThrow('Missing action for controlled driver: budget');
  });

  test('reports missing controlled-driver actions in report mode', () => {
    const result = resolveActionMap({}, ['budget'], { policy: 'report' });
    expect(result.errors).toEqual(['Missing action for controlled driver: budget']);
  });
  ```

- [ ] **Step 2: Run targeted test and confirm it fails**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: FAIL because `actions.js` is missing.

- [ ] **Step 3: Implement action normalization**

  Create `src/environment/actions.js`:

  ```js
  import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';
  import { clamp } from '../simulation/simMath.js';

  export function resolveActionMap(actions = {}, controlledDrivers = [], { policy = 'strict' } = {}) {
    const errors = [];
    const controlsByDriver = {};

    controlledDrivers.forEach((driverId) => {
      const action = actions?.[driverId];
      if (!action || typeof action !== 'object') {
        const message = `Missing action for controlled driver: ${driverId}`;
        if (policy === 'strict') throw new Error(message);
        errors.push(message);
        return;
      }
      controlsByDriver[driverId] = normalizeAction(action);
    });

    return { controlsByDriver, errors };
  }

  export function normalizeAction(action) {
    return {
      steering: clamp(Number(action.steering ?? 0), -1, 1) * VEHICLE_LIMITS.maxSteer,
      throttle: clamp(Number(action.throttle ?? 0), 0, 1),
      brake: clamp(Number(action.brake ?? 0), 0, 1),
    };
  }
  ```

- [ ] **Step 4: Run targeted test**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: PASS for options and actions.

---

## Task 4: Observation, Nearby Cars, And Rays

**Files:**
- Create: `src/environment/sensors.js`
- Create: `src/environment/observations.js`
- Modify: `src/__tests__/environment.test.js`

- [ ] **Step 1: Add observation contract tests**

  Add:

  ```js
  import { createRaceSimulation } from '../simulation/raceSimulation.js';
  import { buildEnvironmentObservation } from '../environment/observations.js';
  import { resolveEnvironmentOptions } from '../environment/options.js';

  test('builds object and vector observations with real units', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
      trackSeed: 99,
    });
    const sim = createRaceSimulation(options);
    const snapshot = sim.snapshot();
    const observation = buildEnvironmentObservation({
      snapshot,
      previousSnapshot: null,
      options,
      events: [],
    });
    const driverId = options.controlledDrivers[0];

    expect(observation[driverId].object.self.speedKph).toEqual(expect.any(Number));
    expect(observation[driverId].object.self.trackOffsetMeters).toEqual(expect.any(Number));
    expect(observation[driverId].object.rays.length).toBeGreaterThan(0);
    expect(observation[driverId].object.nearbyCars).toEqual(expect.any(Array));
    expect(observation[driverId].vector.length).toBe(observation[driverId].schema.length);
    expect(observation[driverId].schema[0]).toHaveProperty('name');
  });
  ```

- [ ] **Step 2: Run targeted test and confirm it fails**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: FAIL because observation modules are missing.

- [ ] **Step 3: Implement basic sensor builders**

  Create `src/environment/sensors.js`:

  ```js
  import { simUnitsToMeters } from '../simulation/units.js';

  export function buildNearbyCars(car, snapshot, { maxCars = 6, radiusMeters = 150 } = {}) {
    return snapshot.cars
      .filter((other) => other.id !== car.id)
      .map((other) => {
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const distanceMeters = simUnitsToMeters(Math.hypot(dx, dy));
        const forward = Math.cos(car.heading) * dx + Math.sin(car.heading) * dy;
        const right = -Math.sin(car.heading) * dx + Math.cos(car.heading) * dy;
        return {
          id: other.id,
          relativeForwardMeters: simUnitsToMeters(forward),
          relativeRightMeters: simUnitsToMeters(right),
          relativeDistanceMeters: distanceMeters,
          relativeSpeedKph: other.speedKph - car.speedKph,
          relativeHeadingRadians: normalizeRelativeHeading(other.heading - car.heading),
          ahead: forward > 0,
          sameLap: other.lap === car.lap,
        };
      })
      .filter((entry) => entry.relativeDistanceMeters <= radiusMeters)
      .sort((a, b) => a.relativeDistanceMeters - b.relativeDistanceMeters)
      .slice(0, maxCars);
  }

  export function buildRaySensors(car, snapshot, rayOptions = {}) {
    const angles = rayOptions.anglesDegrees ?? [-135, -60, -20, 0, 20, 60, 135, 180];
    const lengthMeters = rayOptions.lengthMeters ?? 120;
    const trackHalfWidthMeters = simUnitsToMeters(snapshot.track.width / 2);
    const offsetMeters = car.trackState?.signedOffsetMeters ?? 0;

    return angles.map((angleDegrees) => ({
      angleDegrees,
      angleRadians: (angleDegrees * Math.PI) / 180,
      lengthMeters,
      track: {
        hit: true,
        distanceMeters: Math.max(0, estimateEdgeDistance(angleDegrees, offsetMeters, trackHalfWidthMeters, lengthMeters)),
        kind: 'exit',
      },
      car: estimateCarHit(car, snapshot, angleDegrees, lengthMeters),
    }));
  }

  function estimateEdgeDistance(angleDegrees, offsetMeters, halfWidthMeters, lengthMeters) {
    const lateral = Math.sin((angleDegrees * Math.PI) / 180);
    if (Math.abs(lateral) < 0.08) return lengthMeters;
    const targetEdge = lateral > 0 ? halfWidthMeters - offsetMeters : halfWidthMeters + offsetMeters;
    return Math.min(lengthMeters, Math.abs(targetEdge / lateral));
  }

  function estimateCarHit(car, snapshot, angleDegrees, lengthMeters) {
    const coneRadians = Math.PI / 10;
    const rayAngle = car.heading + (angleDegrees * Math.PI) / 180;
    let closest = null;
    snapshot.cars.forEach((other) => {
      if (other.id === car.id) return;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const distanceMeters = simUnitsToMeters(Math.hypot(dx, dy));
      if (distanceMeters > lengthMeters) return;
      const angleToCar = Math.atan2(dy, dx);
      const delta = Math.abs(normalizeRelativeHeading(angleToCar - rayAngle));
      if (delta > coneRadians) return;
      if (!closest || distanceMeters < closest.distanceMeters) {
        closest = {
          hit: true,
          distanceMeters,
          driverId: other.id,
          relativeSpeedKph: other.speedKph - car.speedKph,
        };
      }
    });
    return closest ?? { hit: false, distanceMeters: lengthMeters, driverId: null, relativeSpeedKph: 0 };
  }

  function normalizeRelativeHeading(angle) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }
  ```

  This is a first-slice approximation. A later implementation can replace ray-edge estimation with geometric ray/track intersection without changing the public observation shape.

- [ ] **Step 4: Implement observation builder**

  Create `src/environment/observations.js`:

  ```js
  import { simSpeedToMetersPerSecond, simUnitsToMeters } from '../simulation/units.js';
  import { buildNearbyCars, buildRaySensors } from './sensors.js';

  export function buildEnvironmentObservation({ snapshot, previousSnapshot, options, events = [] }) {
    return Object.fromEntries(options.controlledDrivers.map((driverId) => {
      const car = snapshot.cars.find((entry) => entry.id === driverId);
      if (!car) return [driverId, emptyObservation(driverId)];

      const driverEvents = events.filter((event) =>
        event.driverId === driverId ||
        event.carId === driverId ||
        event.driverIds?.includes?.(driverId));
      const object = buildDriverObservationObject(car, snapshot, options, driverEvents);
      const { vector, schema } = buildDriverVector(object);
      return [driverId, { object, vector, schema, events: driverEvents }];
    }));
  }

  function buildDriverObservationObject(car, snapshot, options, events) {
    const trackState = car.trackState ?? {};
    return {
      self: {
        id: car.id,
        speedKph: car.speedKph,
        speedMetersPerSecond: simSpeedToMetersPerSecond(car.speed ?? 0),
        headingRadians: car.heading,
        steeringAngleRadians: car.steeringAngle ?? 0,
        throttle: car.throttle ?? 0,
        brake: car.brake ?? 0,
        lap: car.lap,
        completedLaps: car.lapTelemetry?.completedLaps ?? 0,
        lapProgressMeters: simUnitsToMeters(car.progress ?? 0),
        trackOffsetMeters: simUnitsToMeters(trackState.signedOffset ?? 0),
        trackHeadingErrorRadians: trackState.headingError ?? 0,
        onTrack: Boolean(trackState.onTrack),
        surface: trackState.surface ?? 'track',
        tireEnergy: car.tireEnergy ?? null,
      },
      race: {
        position: car.rank,
        totalCars: snapshot.cars.length,
        raceMode: snapshot.raceControl.mode,
        totalLaps: snapshot.totalLaps,
      },
      rays: options.sensors.rays.enabled ? buildRaySensors(car, snapshot, effectiveSensorOptions(options, car.id).rays) : [],
      nearbyCars: options.sensors.nearbyCars.enabled
        ? buildNearbyCars(car, snapshot, effectiveSensorOptions(options, car.id).nearbyCars)
        : [],
      events,
    };
  }

  function buildDriverVector(object) {
    const schema = [
      { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
      { name: 'self.trackOffsetMeters', unit: 'm', scale: 'fixed:trackHalfWidth' },
      { name: 'self.trackHeadingErrorRadians', unit: 'rad', scale: 'fixed:pi' },
      { name: 'self.onTrack', scale: 'boolean' },
      { name: 'race.position', scale: 'fixed:fieldSize' },
    ];
    const vector = [
      object.self.speedKph / 400,
      object.self.trackOffsetMeters,
      object.self.trackHeadingErrorRadians / Math.PI,
      object.self.onTrack ? 1 : 0,
      object.race.position,
    ];
    return { vector, schema };
  }

  function effectiveSensorOptions(options, driverId) {
    return {
      rays: {
        ...options.sensors.rays,
        ...(options.sensorsByDriver?.[driverId]?.rays ?? {}),
      },
      nearbyCars: {
        ...options.sensors.nearbyCars,
        ...(options.sensorsByDriver?.[driverId]?.nearbyCars ?? {}),
      },
    };
  }

  function emptyObservation(driverId) {
    return {
      object: { self: { id: driverId, missing: true }, race: {}, rays: [], nearbyCars: [], events: [] },
      vector: [],
      schema: [],
      events: [],
    };
  }
  ```

- [ ] **Step 5: Run targeted test**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: PASS for options, actions, and observation tests.

---

## Task 5: Shared Runtime And Headless Environment

**Files:**
- Create: `src/environment/runtime.js`
- Create: `src/environment/episode.js`
- Create: `src/environment/events.js`
- Modify: `src/environment/index.js`
- Modify: `src/__tests__/environment.test.js`

- [ ] **Step 1: Add runtime tests**

  Add:

  ```js
  import { createPaddockEnvironment } from '../environment/index.js';

  test('steps a controlled car manually and returns gym-style result', () => {
    const env = createPaddockEnvironment({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
      seed: 71,
      trackSeed: 2026,
      totalLaps: 2,
      frameSkip: 2,
    });

    const initial = env.reset();
    const result = env.step({
      [DEMO_PROJECT_DRIVERS[0].id]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(result.info.step).toBe(1);
    expect(result.info.seed).toBe(71);
    expect(result.info.trackSeed).toBe(2026);
    expect(result.state.snapshot.time).toBeGreaterThan(initial.state.snapshot.time);
    expect(result.reward).toBeNull();
    expect(result.done).toBe(result.terminated || result.truncated);
  });

  test('runs an optional reward callback per controlled driver', () => {
    const driverId = DEMO_PROJECT_DRIVERS[0].id;
    const env = createPaddockEnvironment({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      reward({ driverId: callbackDriverId }) {
        return callbackDriverId === driverId ? 7 : 0;
      },
    });

    env.reset();
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(result.reward).toEqual({ [driverId]: 7 });
  });
  ```

- [ ] **Step 2: Run targeted test and confirm it fails**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: FAIL because runtime is still skeleton-only.

- [ ] **Step 3: Implement episode helpers**

  Create `src/environment/episode.js`:

  ```js
  export function createEpisodeState() {
    return {
      step: 0,
      previousSnapshot: null,
      lastObservation: null,
      lastResult: null,
    };
  }

  export function evaluateEpisode(snapshot, options, episodeState) {
    if (snapshot.raceControl.finished && options.episode.endOnRaceFinish) {
      return { terminated: true, truncated: false, endReason: 'race-finish' };
    }
    if (episodeState.step >= options.episode.maxSteps) {
      return { terminated: false, truncated: true, endReason: 'max-steps' };
    }
    return { terminated: false, truncated: false, endReason: null };
  }
  ```

- [ ] **Step 4: Implement event normalization**

  Create `src/environment/events.js`:

  ```js
  export function collectStepEvents(events = []) {
    return events.map((event) => ({ ...event }));
  }
  ```

- [ ] **Step 5: Implement shared runtime**

  Create `src/environment/runtime.js`:

  ```js
  import { createRaceSimulation } from '../simulation/raceSimulation.js';
  import { FIXED_STEP } from '../simulation/raceSimulation.js';
  import { resolveActionMap } from './actions.js';
  import { collectStepEvents } from './events.js';
  import { createEpisodeState, evaluateEpisode } from './episode.js';
  import { buildEnvironmentObservation } from './observations.js';
  import { resolveEnvironmentOptions } from './options.js';

  export function createPaddockEnvironment(options = {}) {
    let resolvedOptions = resolveEnvironmentOptions(options);
    let sim = createRaceSimulation(resolvedOptions);
    const runtime = createEnvironmentRuntime({
      getSimulation: () => sim,
      setSimulation(nextSim) {
        sim = nextSim;
      },
      createSimulation(nextOptions) {
        return createRaceSimulation(nextOptions);
      },
      getOptions: () => resolvedOptions,
      setOptions(nextOptions) {
        resolvedOptions = nextOptions;
      },
      afterReset() {},
      afterStep() {},
    });
    return runtime;
  }

  export function createEnvironmentRuntime(host) {
    const episodeState = createEpisodeState();

    function reset(nextOptions = {}) {
      const options = resolveEnvironmentOptions({
        ...host.getOptions(),
        ...nextOptions,
      });
      host.setOptions(options);
      host.setSimulation(host.createSimulation(options));
      episodeState.step = 0;
      episodeState.previousSnapshot = null;
      const result = buildResult({ host, episodeState, events: [], actionErrors: [] });
      episodeState.lastResult = result;
      host.afterReset(result);
      return result;
    }

    function step(actions = {}) {
      const options = host.getOptions();
      const sim = host.getSimulation();
      const { controlsByDriver, errors } = resolveActionMap(actions, options.controlledDrivers, {
        policy: options.actionPolicy,
      });

      Object.entries(controlsByDriver).forEach(([driverId, controls]) => {
        sim.setCarControls(driverId, controls);
      });

      episodeState.previousSnapshot = sim.snapshot();
      const stepEvents = [];
      for (let index = 0; index < options.frameSkip; index += 1) {
        sim.step(FIXED_STEP);
        stepEvents.push(...collectStepEvents(sim.snapshot().events));
      }
      episodeState.step += 1;
      const result = buildResult({ host, episodeState, events: stepEvents, actionErrors: errors, actions });
      episodeState.lastResult = result;
      host.afterStep(result);
      return result;
    }

    function getObservation() {
      return episodeState.lastResult?.observation ?? buildResult({ host, episodeState, events: [], actionErrors: [] }).observation;
    }

    function getState() {
      return { snapshot: host.getSimulation().snapshot() };
    }

    function destroy() {
      episodeState.lastResult = null;
      episodeState.previousSnapshot = null;
    }

    return { reset, step, getObservation, getState, destroy };
  }

  function buildResult({ host, episodeState, events, actionErrors, actions = {} }) {
    const options = host.getOptions();
    const snapshot = host.getSimulation().snapshot();
    const observation = buildEnvironmentObservation({
      snapshot,
      previousSnapshot: episodeState.previousSnapshot,
      options,
      events,
    });
    const episode = evaluateEpisode(snapshot, options, episodeState);
    const reward = computeReward({ options, observation, events, snapshot, actions, previousSnapshot: episodeState.previousSnapshot });
    return {
      observation,
      reward,
      terminated: episode.terminated,
      truncated: episode.truncated,
      done: episode.terminated || episode.truncated,
      events,
      state: { snapshot },
      info: {
        step: episodeState.step,
        elapsedSeconds: snapshot.time,
        seed: options.seed,
        trackSeed: options.trackSeed,
        controlledDrivers: [...options.controlledDrivers],
        actionErrors,
        endReason: episode.endReason,
      },
    };
  }

  function computeReward({ options, observation, events, snapshot, actions, previousSnapshot }) {
    if (!options.reward) return null;
    return Object.fromEntries(options.controlledDrivers.map((driverId) => [
      driverId,
      Number(options.reward({
        driverId,
        previous: previousSnapshot,
        current: observation[driverId],
        action: actions?.[driverId],
        events: observation[driverId]?.events ?? events,
        state: { snapshot },
      }) ?? 0),
    ]));
  }
  ```

  If `FIXED_STEP` is not exported today, add an export in `src/simulation/raceSimulation.js`:

  ```js
  export const FIXED_STEP = 1 / 60;
  ```

  If the file already uses an internal fixed-step constant elsewhere, export that same value instead of defining a duplicate.

- [ ] **Step 6: Run targeted test**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js
  ```

  Expected: PASS.

---

## Task 6: Browser Expert Adapter

**Files:**
- Create: `src/app/BrowserExpertAdapter.js`
- Modify: `src/app/F1SimulatorApp.js`
- Modify: `src/index.js`
- Modify: `src/index.d.ts`
- Modify: `src/api/PaddockSimulatorController.js`
- Create/modify: `src/__tests__/browserExpert.test.js`

- [ ] **Step 1: Add browser expert adapter tests**

  Create `src/__tests__/browserExpert.test.js`:

  ```js
  import { describe, expect, test, vi } from 'vitest';
  import { createBrowserExpertAdapter } from '../app/BrowserExpertAdapter.js';
  import { CHAMPIONSHIP_ENTRY_BLUEPRINTS, DEMO_PROJECT_DRIVERS } from '../index.js';

  describe('browser expert adapter', () => {
    test('uses the app simulation host instead of creating a parallel visible simulation', () => {
      const sim = {
        snapshot: vi.fn(() => ({
          time: 0,
          cars: [],
          events: [],
          raceControl: { mode: 'green', finished: false },
          totalLaps: 1,
          track: { width: 100 },
        })),
        setCarControls: vi.fn(),
        step: vi.fn(),
      };
      const app = {
        sim,
        options: {
          drivers: DEMO_PROJECT_DRIVERS,
          entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
          controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
          expert: {
            enabled: true,
            controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
          },
        },
        createRaceSimulation: vi.fn(() => sim),
        renderExpertFrame: vi.fn(),
      };

      const expert = createBrowserExpertAdapter(app, {
        enabled: true,
        controlledDrivers: [DEMO_PROJECT_DRIVERS[0].id],
      });

      expert.getState();
      expect(sim.snapshot).toHaveBeenCalled();
      expect(app.createRaceSimulation).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run targeted test and confirm it fails**

  Run:

  ```bash
  npm test -- src/__tests__/browserExpert.test.js
  ```

  Expected: FAIL because `BrowserExpertAdapter.js` is missing.

- [ ] **Step 3: Implement `BrowserExpertAdapter`**

  Create `src/app/BrowserExpertAdapter.js`:

  ```js
  import { createEnvironmentRuntime } from '../environment/runtime.js';
  import { resolveEnvironmentOptions } from '../environment/options.js';

  export function createBrowserExpertAdapter(app, expertOptions = {}) {
    const baseOptions = resolveEnvironmentOptions({
      ...app.options,
      ...expertOptions,
      controlledDrivers: expertOptions.controlledDrivers,
    });
    let resolvedOptions = baseOptions;

    return createEnvironmentRuntime({
      getSimulation: () => app.sim,
      setSimulation(nextSim) {
        app.sim = nextSim;
      },
      createSimulation(nextOptions) {
        return app.createRaceSimulation(nextOptions);
      },
      getOptions: () => resolvedOptions,
      setOptions(nextOptions) {
        resolvedOptions = nextOptions;
      },
      afterReset(result) {
        app.renderExpertFrame(result.state.snapshot);
      },
      afterStep(result) {
        app.renderExpertFrame(result.state.snapshot);
      },
    });
  }
  ```

- [ ] **Step 4: Integrate into `F1SimulatorApp`**

  In `src/app/F1SimulatorApp.js`:

  - Import:

    ```js
    import { createBrowserExpertAdapter } from './BrowserExpertAdapter.js';
    ```

  - Add constructor fields:

    ```js
    this.expert = null;
    this.expertMode = Boolean(options.expert?.enabled);
    ```

  - After the initial simulation is created in `init()` and before ticker setup:

    ```js
    if (this.expertMode) {
      this.expert = createBrowserExpertAdapter(this, this.options.expert);
    }
    ```

  - Only add/start ticker when expert mode is not enabled:

    ```js
    if (!this.expertMode) {
      this.tickerCallback = () => this.tick();
      this.app.ticker.add(this.tickerCallback);
      this.observeRuntimeVisibility();
    }
    ```

  - Add:

    ```js
    renderExpertFrame(snapshot = this.sim?.snapshot()) {
      if (!snapshot) return;
      const renderSnapshot = createRenderSnapshot(snapshot, 0);
      this.applyCamera(renderSnapshot);
      this.renderDrsTrails(renderSnapshot);
      this.renderCars(renderSnapshot);
      this.updateDom(snapshot, { emitLifecycle: false });
    }
    ```

  - In `restart()`, recreate expert adapter if expert mode is enabled after assigning `this.sim`.

- [ ] **Step 5: Expose browser expert from mount APIs**

  In `src/index.js`, return:

  ```js
  get expert() {
    return app.expert ?? null;
  }
  ```

  In `src/api/PaddockSimulatorController.js`, add:

  ```js
  get expert() {
    return this.app?.expert ?? null;
  }
  ```

- [ ] **Step 6: Update browser types**

  In `src/index.d.ts`, add:

  ```ts
  export interface F1SimulatorExpertOptions {
    enabled: boolean;
    controlledDrivers: string[];
  }
  ```

  Add to `F1SimulatorOptions`:

  ```ts
  expert?: F1SimulatorExpertOptions;
  ```

  Add to `F1MountedSimulator` and `PaddockSimulatorController`:

  ```ts
  readonly expert: null | {
    reset(options?: unknown): unknown;
    step(actions: Record<string, { steering: number; throttle: number; brake: number }>): unknown;
    getObservation(): unknown;
    getState(): unknown;
    destroy(): void;
  };
  ```

  Keep the precise environment types in `src/environment/index.d.ts`; avoid circular root/subpath typing until the implementation is stable.

- [ ] **Step 7: Run browser expert tests**

  Run:

  ```bash
  npm test -- src/__tests__/browserExpert.test.js src/__tests__/componentApi.test.js
  ```

  Expected: PASS.

---

## Task 7: Executable Expert Example

**Files:**
- Create: `local-preview/expert-environment.html`
- Modify: `local-preview/src/main.js`
- Modify: `local-preview/src/styles.css`

- [ ] **Step 1: Add example page shell**

  Create `local-preview/expert-environment.html`:

  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>PaddockJS Expert Environment</title>
    </head>
    <body data-page="expert-environment">
      <main class="preview-page expert-page">
        <section class="preview-hero">
          <h1>Expert Environment</h1>
          <p>Run the same model loop headless or against the visual simulator.</p>
        </section>

        <section class="expert-toolbar">
          <label>
            <span>Mode</span>
            <select data-expert-mode>
              <option value="visual">Visual</option>
              <option value="headless">Headless</option>
            </select>
          </label>
          <label>
            <span>Auto run</span>
            <input type="checkbox" data-expert-auto-run />
          </label>
          <button type="button" data-expert-reset>Reset</button>
          <button type="button" data-expert-step>Step</button>
        </section>

        <section class="expert-layout">
          <div id="expert-visual-root"></div>
          <pre data-expert-readout>Waiting for reset...</pre>
        </section>
      </main>
      <script type="module" src="/src/main.js"></script>
    </body>
  </html>
  ```

- [ ] **Step 2: Wire example logic**

  In `local-preview/src/main.js`, import the subpath:

  ```js
  import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';
  ```

  Add:

  ```js
  async function mountExpertEnvironmentPage() {
    const controlledDriver = DEMO_PROJECT_DRIVERS[0].id;
    const modeSelect = document.querySelector('[data-expert-mode]');
    const autoRun = document.querySelector('[data-expert-auto-run]');
    const readout = document.querySelector('[data-expert-readout]');
    const visualRoot = requiredElement('expert-visual-root');
    let visualSimulator = null;
    let headlessEnv = null;
    let result = null;
    let timer = null;

    function expertOptions() {
      return {
        drivers: DEMO_PROJECT_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
        controlledDrivers: [controlledDriver],
        seed: 71,
        trackSeed: SHOWCASE_TRACK_SEED,
        totalLaps: 3,
        frameSkip: 2,
        reward({ previous, current }) {
          const previousProgress = previous?.cars?.find?.((car) => car.id === controlledDriver)?.progress ?? 0;
          return (current.object.self.lapProgressMeters ?? 0) - previousProgress;
        },
      };
    }

    function controller(observation) {
      const self = observation?.[controlledDriver]?.object?.self;
      const headingError = self?.trackHeadingErrorRadians ?? 0;
      return {
        [controlledDriver]: {
          steering: Math.max(-1, Math.min(1, -headingError * 1.7)),
          throttle: 0.72,
          brake: 0,
        },
      };
    }

    async function ensureVisual() {
      if (visualSimulator) return visualSimulator;
      visualSimulator = await mountF1Simulator(visualRoot, {
        ...commonOptions('expert'),
        expert: {
          enabled: true,
          controlledDrivers: [controlledDriver],
        },
        seed: 71,
        trackSeed: SHOWCASE_TRACK_SEED,
        totalLaps: 3,
      });
      return visualSimulator;
    }

    function ensureHeadless() {
      if (!headlessEnv) headlessEnv = createPaddockEnvironment(expertOptions());
      return headlessEnv;
    }

    async function activeEnvironment() {
      if (modeSelect.value === 'visual') return (await ensureVisual()).expert;
      return ensureHeadless();
    }

    async function reset() {
      const env = await activeEnvironment();
      result = env.reset();
      render();
    }

    async function step() {
      const env = await activeEnvironment();
      if (!result) result = env.reset();
      result = env.step(controller(result.observation));
      render();
      if (result.done) stopAutoRun();
    }

    function render() {
      const driverObservation = result?.observation?.[controlledDriver];
      readout.textContent = JSON.stringify({
        mode: modeSelect.value,
        step: result?.info?.step,
        done: result?.done,
        reward: result?.reward,
        self: driverObservation?.object?.self,
        rays: driverObservation?.object?.rays,
        nearbyCars: driverObservation?.object?.nearbyCars?.slice(0, 3),
        events: result?.events,
        vectorLength: driverObservation?.vector?.length,
        schema: driverObservation?.schema,
      }, null, 2);
    }

    function stopAutoRun() {
      if (timer) window.clearInterval(timer);
      timer = null;
      autoRun.checked = false;
    }

    document.querySelector('[data-expert-reset]').addEventListener('click', reset);
    document.querySelector('[data-expert-step]').addEventListener('click', step);
    autoRun.addEventListener('change', () => {
      if (!autoRun.checked) {
        stopAutoRun();
        return;
      }
      timer = window.setInterval(step, 120);
    });
    modeSelect.addEventListener('change', reset);

    await reset();
  }
  ```

  Add to the page switch:

  ```js
  if (page === 'expert-environment') {
    mountExpertEnvironmentPage();
  }
  ```

- [ ] **Step 3: Add example styles**

  In `local-preview/src/styles.css`, add:

  ```css
  .expert-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    margin: 1rem 0;
  }

  .expert-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.8fr);
    gap: 1rem;
  }

  .expert-layout pre {
    min-height: 520px;
    overflow: auto;
    padding: 1rem;
    background: #10131a;
    color: #e8edf7;
    border-radius: 8px;
  }

  @media (max-width: 900px) {
    .expert-layout {
      grid-template-columns: 1fr;
    }
  }
  ```

- [ ] **Step 4: Build local preview**

  Run:

  ```bash
  npm run showcase:build
  ```

  Expected: PASS and Vite resolves both `@inventure71/paddockjs` and `@inventure71/paddockjs/environment`.

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/data_contract.md`
- Modify: `docs/architecture.md`
- Modify: `docs/system_specs.md`

- [ ] **Step 1: Update README with the official import boundary**

  Add a section:

  ```md
  ## Expert Environment API

  Headless training code imports the environment subpath:

  ```js
  import { createPaddockEnvironment } from '@inventure71/paddockjs/environment';
  ```

  The package root remains the browser component API. The environment subpath is intentionally browser-free and does not import DOM, PixiJS, or package CSS.
  ```

- [ ] **Step 2: Update `docs/data_contract.md`**

  Add the full option/result example:

  ```js
  const env = createPaddockEnvironment({
    drivers,
    entries,
    controlledDrivers: ['budget'],
    scenario: {
      participants: 'all',
      nonControlled: 'ai',
    },
    frameSkip: 2,
  });

  const result = env.step({
    budget: { steering: 0, throttle: 1, brake: 0 },
  });
  ```

  Document `observation`, `state`, `events`, `reward`, `terminated`, `truncated`, `done`, and `info`.

- [ ] **Step 3: Update `docs/architecture.md`**

  Add the ownership rule:

  ```text
  Browser expert mode wraps the existing `F1SimulatorApp.sim` instance. It must not create a second RaceSimulation for the same visual mount.
  ```

- [ ] **Step 4: Update `docs/system_specs.md`**

  Document:

  - `@inventure71/paddockjs/environment` is the only public environment import path.
  - Browser expert mode is opt-in.
  - Expert visual mounts disable automatic ticker simulation advancement.

- [ ] **Step 5: Run docs-related package checks**

  Run:

  ```bash
  npm run types:check
  npm run pack:dry
  ```

  Expected: PASS and pack output includes `src/environment` and excludes no unintended files.

---

## Task 9: Full Verification And Browser Smoke

**Files:**
- No new code files unless failures reveal missing fixes.

- [ ] **Step 1: Run focused tests**

  Run:

  ```bash
  npm test -- src/__tests__/environment.test.js src/__tests__/browserExpert.test.js src/__tests__/publicApi.types.ts
  ```

  Expected: PASS.

- [ ] **Step 2: Run full package check**

  Run:

  ```bash
  npm_config_cache=/private/tmp/paddockjs-npm-cache npm run check
  ```

  Expected: PASS for Vitest, TypeScript declarations, `npm pack --dry-run`, local-preview clean install, and local-preview production build.

- [ ] **Step 3: Run browser smoke test**

  Start:

  ```bash
  npm run showcase:dev
  ```

  Open:

  ```text
  http://127.0.0.1:5173/expert-environment.html
  ```

  Verify:

  - Visual mode renders a canvas.
  - Canvas does not move after reset until `Step` or auto-run is used.
  - `Step` advances `info.step`.
  - Readout shows `self`, `rays`, `nearbyCars`, `vectorLength`, `schema`, and `state`-derived values.
  - Switching to headless mode keeps stepping and readout working without relying on the canvas.
  - Auto-run advances only through repeated expert `step()` calls.

- [ ] **Step 4: Run package export smoke**

  Run:

  ```bash
  node -e "import('@inventure71/paddockjs/environment').catch(err => { console.error(err); process.exit(1); })"
  ```

  If this command cannot resolve from the repo root before install, run the equivalent inside `local-preview` after `npm --prefix local-preview ci`.

- [ ] **Step 5: Inspect tarball contents**

  Run:

  ```bash
  npm pack --dry-run --json
  ```

  Expected:

  - includes `src/environment/index.js`
  - includes `src/environment/index.d.ts`
  - includes all environment implementation files
  - no accidental Q&A or planning files unless intentionally included under `docs`

---

## Task 10: Linear And Release Notes

**Files / Tools:**
- Linear issue `MGI-19`
- Existing changeset `.changeset/steady-race-package-hardening.md`

- [ ] **Step 1: Update `MGI-19` description/comment**

  Add a Linear comment with:

  ```md
  Agreed first-slice scope:
  - `@inventure71/paddockjs/environment`
  - headless `createPaddockEnvironment()`
  - narrow browser expert wrapper over the visual RaceSimulation
  - explicit controlled drivers
  - normalized direct controls
  - manual stepping plus frameSkip
  - object observations in real units plus vector/schema
  - full state under `state`
  - global/per-driver events
  - optional user reward callback
  - basic rays and nearby cars
  - executable headless/visual example

  Deferred:
  - static obstacles and placements
  - debug mutation API
  - Python Gymnasium bridge
  - assisted control modes
  ```

- [ ] **Step 2: Update changeset prose**

  If this work lands in the current `0.3.0` release stack, add a sentence:

  ```md
  Adds the first expert environment API foundation for Gym-style JavaScript training through the `@inventure71/paddockjs/environment` subpath and an opt-in browser expert wrapper.
  ```

  Keep Changesets frontmatter technically correct for `0.2.0 -> 0.3.0`; do not describe the human release as minor.

---

## Self-Review Checklist

- [ ] The headless subpath does not import `src/index.js`, `src/styles.css`, `pixi.js`, or `src/app/F1SimulatorApp.js`.
- [ ] Browser expert mode wraps `F1SimulatorApp.sim`; it does not create a parallel race simulation.
- [ ] `controlledDrivers` is required everywhere expert control is enabled.
- [ ] `step(actions)` is the only thing advancing expert simulations.
- [ ] Root package API does not export `createPaddockEnvironment()`.
- [ ] Observation object uses real units; vector scaling is documented and fixed.
- [ ] Reward remains user-defined; no built-in preset is added.
- [ ] Static obstacles, placements, debug mutation, Python Gymnasium bridge, and assisted control are not included in this first slice.
- [ ] `npm run check` passes.
- [ ] Browser smoke proves manual stepping and headless/visual example modes.
