# PaddockJS 1.0 Simulation Modularization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `src/simulation/raceSimulation.js` into a thin deterministic orchestrator while preserving current 1.0 behavior.

**Architecture:** Split simulation code by feature ownership: vehicle, pit, timing, rules, race lifecycle, and track. Keep public APIs, snapshots, training API behavior, race rules, collisions, pit stops, timing, and rendering output unchanged.

**Tech Stack:** JavaScript ES modules, Vitest, PixiJS browser runtime, PaddockJS simulation/environment APIs.

---

## Summary

Weather effects, reliability failures, and fuel-load performance effects are future work, not active 1.0 behavior. They should be documented as reserved/future modules and tracked in Linear.

The 1.0 refactor should focus on making the current system scalable without changing behavior. `src/simulation/raceSimulation.js` should own fixed-step ordering, shared state containers, event collection, and module coordination only. Detailed feature behavior should live in focused simulation modules.

## Target Ownership

### `src/simulation/raceSimulation.js`

Owns:

- constructor wiring
- fixed-step execution order
- shared race state containers
- event collection
- calls into feature modules
- public `F1RaceSimulation` facade methods

Must not own:

- detailed pit routing or service logic
- timing gap math
- DRS eligibility math
- car creation or serialization
- physics logic
- steward decision logic
- track geometry generation

### `src/simulation/vehicle/`

Owns:

- car creation and default car state
- pose normalization and previous/current pose capture
- geometry state cache
- wheel surface state
- physics integration adapters
- runoff response
- full/render/observation car serializers

Files to create or move toward:

- `src/simulation/vehicle/vehicleState.js`
- `src/simulation/vehicle/vehicleSnapshots.js`
- `src/simulation/vehicle/vehiclePhysics.js`
- `src/simulation/vehicle/vehicleGeometry.js`
- `src/simulation/vehicle/wheelSurface.js`

### `src/simulation/pit/`

Owns:

- pit lane team and box assignment
- pit stop initialization
- manual pit intent
- automatic pit intent
- pit stop scheduling and rearming
- pit route generation and sampling
- pit route movement
- queue occupancy
- service timing
- tire change application
- pit release checks
- pit lane status snapshots

Files to create:

- `src/simulation/pit/pitState.js`
- `src/simulation/pit/pitIntent.js`
- `src/simulation/pit/pitRouting.js`
- `src/simulation/pit/pitService.js`
- `src/simulation/pit/pitSnapshots.js`

Pit penalties stay in `src/simulation/rules/`.

### `src/simulation/timing/`

Owns:

- lap telemetry
- sector timing
- timing history
- timing line creation and crossings
- gap estimation
- ordered-car timing data
- DRS detection windows
- DRS eligibility/latch state

Files to create:

- `src/simulation/timing/raceTiming.js`
- `src/simulation/timing/drsTiming.js`

Vehicle physics remains responsible for applying DRS performance effects once timing has decided eligibility and activation state.

### `src/simulation/rules/`

Owns stewarded decisions only:

- penalties
- track limits
- collisions
- pit-lane speeding
- tire requirements

Existing files stay here:

- `collisionSteward.js`
- `trackLimitsSteward.js`
- `pitLaneSpeedingSteward.js`
- `tireRequirementSteward.js`
- `penaltyLedger.js`

Add `rulesReview.js` only if it prevents `raceSimulation.js` from knowing every steward call directly.

### `src/simulation/race/`

Owns race lifecycle:

- start lights
- grid hold/release
- red flag state
- safety car state
- pit lane open/closed state transitions
- finish detection
- final classification
- race-control mode transitions

Files to create:

- `src/simulation/race/raceLifecycle.js`
- `src/simulation/race/safetyCar.js`
- `src/simulation/race/classification.js`

### `src/simulation/track/`

Owns:

- track model building
- procedural track generation
- pit lane and pit box geometry
- surface classification helpers
- DRS zone geometry
- world and track constants

Move current `src/simulation/trackModel.js` behind this folder boundary. Do not deeply split it in the first pass unless the move reveals a concrete coupling problem.

## Refactor Contract

- Preserve `createRaceSimulation()`.
- Preserve `F1RaceSimulation`.
- Preserve `snapshot()`.
- Preserve `snapshotRender()`.
- Preserve `snapshotObservation()`.
- Preserve environment `reset()` and `step()` return shapes.
- Preserve exported package types.
- Preserve deterministic behavior for the same seed, track seed, drivers, entries, rules, and controls.
- Preserve public snapshot shape unless a focused test proves the current shape is wrong.
- Each module must receive narrow inputs and return narrow outputs.
- UI and environment code must consume snapshots or observation helpers only; it must not duplicate simulation rules.

## Implementation Tasks

### Task 1: Add Characterization Tests

**Files:**

- Modify: `src/__tests__/raceSimulation.test.js`
- Modify: `src/__tests__/environment.test.js`
- Modify: `src/__tests__/componentApi.test.js`

- [x] Add tests that lock representative full public snapshot shape.
- [x] Add tests that lock render snapshot fields used by the browser runtime.
- [x] Add tests that lock observation snapshot fields used by training.
- [x] Add deterministic same-seed simulation tests after several fixed steps.
- [x] Add pit lifecycle tests for entry, queue/service/exit, penalty service, and pit-lane speeding.
- [x] Add DRS tests around the one-second threshold.
- [x] Add collision, track-limit, tire-requirement, and classification tests.
- [x] Run focused tests before extraction:

```bash
npm test -- src/__tests__/raceSimulation.test.js src/__tests__/environment.test.js src/__tests__/componentApi.test.js
```

Expected result: all tests pass before refactoring starts.

### Task 2: Extract Vehicle Ownership

**Files:**

- Create: `src/simulation/vehicle/vehicleState.js`
- Create: `src/simulation/vehicle/vehicleSnapshots.js`
- Move or re-export: `src/simulation/vehiclePhysics.js`
- Move or re-export: `src/simulation/vehicleGeometry.js`
- Move or re-export: `src/simulation/wheelSurface.js`
- Modify: `src/simulation/raceSimulation.js`

- [x] Move `createCar` and related car initialization helpers into `vehicleState.js`.
- [x] Move previous/current pose capture and pose normalization into `vehicleState.js`.
- [x] Move `setCarState` internals into a vehicle helper while keeping the public method on `F1RaceSimulation`.
- [x] Move `serializeCar`, `serializeRenderCar`, `serializeObservationCar`, and `serializeWheels` into `vehicleSnapshots.js`.
- [x] Keep old import paths as temporary re-exports if needed to reduce churn.
- [x] Run focused tests:

```bash
npm test -- src/__tests__/raceSimulation.test.js src/__tests__/environment.test.js
```

Expected result: behavior and snapshot shape unchanged.

### Task 3: Extract Timing And DRS

**Files:**

- Create: `src/simulation/timing/raceTiming.js`
- Create: `src/simulation/timing/drsTiming.js`
- Modify: `src/simulation/raceSimulation.js`

- [x] Move sector telemetry helpers into `raceTiming.js`.
- [x] Move timing history helpers into `raceTiming.js`.
- [x] Move timing line creation and crossing helpers into `raceTiming.js`.
- [x] Move gap estimation helpers into `raceTiming.js`.
- [x] Move DRS detection and latch helpers into `drsTiming.js`.
- [x] Keep vehicle physics as the owner of the DRS speed effect.
- [x] Run focused tests:

```bash
npm test -- src/__tests__/raceSimulation.test.js src/__tests__/environment.test.js
```

Expected result: timing, DRS, and training observations unchanged.

### Task 4: Extract Pit System

**Files:**

- Create: `src/simulation/pit/pitState.js`
- Create: `src/simulation/pit/pitIntent.js`
- Create: `src/simulation/pit/pitRouting.js`
- Create: `src/simulation/pit/pitService.js`
- Create: `src/simulation/pit/pitSnapshots.js`
- Modify: `src/simulation/raceSimulation.js`

- [x] Move pit team assignment and pit stop initialization into `pitState.js`.
- [x] Move manual and automatic pit intent into `pitIntent.js`.
- [x] Move pit route creation, route sampling, route progress, and limiter route helpers into `pitRouting.js`.
- [x] Move queue occupancy, service timing, tire change, and release checks into `pitService.js`.
- [x] Move `pitLaneStatusSnapshot`, `serializePitStop`, and render/observation pit serializers into `pitSnapshots.js`.
- [x] Keep pit-lane speeding review in `src/simulation/rules/pitLaneSpeedingSteward.js`.
- [x] Run focused tests:

```bash
npm test -- src/__tests__/raceSimulation.test.js src/__tests__/environment.test.js
```

Expected result: pit behavior, pit penalties, and pit performance optimizations unchanged.

### Task 5: Extract Race Lifecycle

**Files:**

- Create: `src/simulation/race/raceLifecycle.js`
- Create: `src/simulation/race/safetyCar.js`
- Create: `src/simulation/race/classification.js`
- Modify: `src/simulation/raceSimulation.js`

- [x] Move start light and grid release logic into `raceLifecycle.js`.
- [x] Move red flag and pit lane open/closed transitions into `raceLifecycle.js`.
- [x] Move safety car state movement and update logic into `safetyCar.js`.
- [x] Move finish detection, winner snapshot, classification, and classification consequences into `classification.js`.
- [x] Keep public setter methods on `F1RaceSimulation` as facade methods.
- [x] Run focused tests:

```bash
npm test -- src/__tests__/raceSimulation.test.js
```

Expected result: lifecycle behavior unchanged.

### Task 6: Move Track Boundary

**Files:**

- Create: `src/simulation/track/trackModel.js`
- Modify: imports from `src/simulation/trackModel.js`

- [x] Move current track model code behind `src/simulation/track/trackModel.js`.
- [x] Leave a compatibility re-export at `src/simulation/trackModel.js` if needed.
- [x] Do not split track internals unless required by import cycles or direct coupling.
- [x] Run focused tests:

```bash
npm test -- src/__tests__/raceSimulation.test.js src/__tests__/componentApi.test.js
```

Expected result: generated tracks, pit lane geometry, surfaces, and DRS zones unchanged.

### Task 7: Mark Future Modules Clearly

**Files:**

- Modify: `src/simulation/rulesConfig.js`
- Modify: `docs/rules.md`
- Modify: `docs/architecture.md`
- Modify: `README.md` only if public feature claims need correction

- [x] Ensure weather effects are documented as future/non-active behavior.
- [x] Ensure reliability failures are documented as future/non-active behavior.
- [x] Ensure fuel-load performance effects are documented as future/non-active behavior.
- [x] Ensure default rules/config do not imply active behavior that does not exist.
- [x] Add architecture notes showing where these future modules will live.

### Task 8: Linear Updates

**Files:** none.

- [x] Update the existing 1.0 readiness Linear issue with this modularization plan.
- [x] Create or update a Linear issue for `Split raceSimulation into feature-owned simulation modules`.
- [x] Create future Linear issues for:
  - `Add weather effects module`
  - `Add reliability failures module`
  - `Add fuel-load performance effects module`
- [x] Mark only the modularization issue as 1.0-blocking.

### Task 9: Final Verification

**Files:** none.

- [x] Run package verification:

```bash
npm run check
```

Expected result: pass.

- [x] Run portfolio integration verification:

```bash
cd /Users/inventure71/VSProjects/Inventure71.github.io
npm install ../PaddockJS
npm run check
```

Expected result: pass.

- [x] Browser smoke if app/render paths changed:
  - mount simulator
  - start race
  - switch cameras
  - run pit entry
  - verify timing board, cars, pit state, penalties, and camera behavior still work

## Acceptance Criteria

- `raceSimulation.js` is reduced to orchestration and public facade behavior.
- Feature logic lives in the module that owns that feature.
- Public snapshot, render snapshot, and observation snapshot behavior are unchanged.
- Training/environment behavior is unchanged.
- Pit stops, penalties, collisions, DRS, timing, track limits, and classification still work.
- Weather, reliability, and fuel-load effects are clearly tracked as future work.
- `npm run check` passes.
- Portfolio integration check passes.
- Linear is updated with completed architecture work and future feature issues.
