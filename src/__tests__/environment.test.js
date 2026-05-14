import { describe, expect, test, vi } from 'vitest';
import { slowTest } from './testModes.js';
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
} from '../index.js';
import { resolveActionMap } from '../environment/actions.js';
import {
  createPaddockDriverControllerLoop,
  createEnvironmentWorkerProtocol,
  createPaddockEnvironment,
  createProgressReward,
  createRolloutRecorder,
  runEnvironmentEvaluation,
} from '../environment/index.js';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createEnvironmentRuntime } from '../environment/runtime.js';
import { buildRaySensors, getCarRayOrigin, normalizeRayOptions } from '../environment/sensors.js';
import { createTrackRayContext } from '../environment/sensors/trackRays.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { createProceduralTrack, nearestTrackState, offsetTrackPoint, pointAt, TRACK } from '../simulation/trackModel.js';
import { nearestTrackStateForCar } from '../simulation/track/trackStatePolicy.js';
import { resetTrackQueryStats, snapshotTrackQueryStats } from '../simulation/track/trackQueryIndex.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../simulation/vehicleGeometry.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';

const ENVIRONMENT_TEST_DRIVERS = DEMO_PROJECT_DRIVERS.slice(0, 3);
const CONTROLLED_DRIVER_ID = ENVIRONMENT_TEST_DRIVERS[0].id;
const SENSOR_TARGET_DRIVER_ID = ENVIRONMENT_TEST_DRIVERS[1].id;
const PROCEDURAL_TRACK_TEST_TIMEOUT_MS = 20000;

function createBatchTrainingDrivers(count = 20) {
  const colors = ['#e10600', '#00a3ff', '#f1c65b', '#38bdf8', '#22c55e'];
  const drivers = Array.from({ length: count }, (_, index) => ({
    id: `agent-${index}`,
    code: `A${index}`,
    icon: `A${index}`,
    raceName: `A${index}`,
    name: `Agent ${index}`,
    color: colors[index % colors.length],
    tire: 'M',
    pace: 1,
    racecraft: 0.8,
  }));
  const entries = drivers.map((driver, index) => ({
    driverId: driver.id,
    driverNumber: 70 + index,
    timingName: driver.code,
    driver: {
      pace: 75,
      racecraft: 75,
      aggression: 55,
      riskTolerance: 55,
      patience: 65,
      consistency: 70,
    },
    vehicle: {
      id: `agent-car-${index}`,
      name: `Agent ${index}`,
      power: 75,
      braking: 70,
      aero: 72,
      dragEfficiency: 68,
      mechanicalGrip: 74,
      weightControl: 70,
      tireCare: 70,
    },
  }));
  return { drivers, entries, ids: drivers.map((driver) => driver.id) };
}

function placeSensorPair(sim, targetDriverId = SENSOR_TARGET_DRIVER_ID) {
  const base = pointAt(sim.track, metersToSimUnits(800));
  const target = pointAt(sim.track, metersToSimUnits(820));
  sim.setCarState(CONTROLLED_DRIVER_ID, {
    x: base.x,
    y: base.y,
    previousX: base.x,
    previousY: base.y,
    heading: base.heading,
    previousHeading: base.heading,
    progress: base.distance,
    raceDistance: base.distance,
    speed: kphToSimSpeed(100),
  });
  sim.setCarState(targetDriverId, {
    x: target.x,
    y: target.y,
    previousX: target.x,
    previousY: target.y,
    heading: target.heading,
    previousHeading: target.heading,
    progress: target.distance,
    raceDistance: target.distance,
    speed: kphToSimSpeed(90),
  });
}

function marchTrackEdgeDistance(track, car, angleDegrees, lengthMeters) {
  const heading = car.heading + (angleDegrees * Math.PI) / 180;
  const origin = getCarRayOrigin(car);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(1);
  let previousDistance = 0;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const point = {
      x: origin.x + Math.cos(heading) * distance,
      y: origin.y + Math.sin(heading) * distance,
    };
    const state = nearestTrackState(track, point, car.progress);
    if (state.crossTrackError > track.width / 2) {
      let low = previousDistance;
      let high = distance;
      for (let index = 0; index < 12; index += 1) {
        const middle = (low + high) / 2;
        const middlePoint = {
          x: origin.x + Math.cos(heading) * middle,
          y: origin.y + Math.sin(heading) * middle,
        };
        const middleState = nearestTrackState(track, middlePoint, car.progress);
        if (middleState.crossTrackError > track.width / 2) high = middle;
        else low = middle;
      }
      return simUnitsToMeters(high);
    }
    previousDistance = distance;
  }

  return lengthMeters;
}

function marchTrackTransition(track, car, angleDegrees, lengthMeters) {
  const heading = car.heading + (angleDegrees * Math.PI) / 180;
  const origin = getCarRayOrigin(car);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(1);
  let previousInside = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const point = {
      x: origin.x + Math.cos(heading) * distance,
      y: origin.y + Math.sin(heading) * distance,
    };
    const state = nearestTrackState(track, point, car.progress, { allowPitOverride: false });
    const inside = state.crossTrackError <= track.width / 2;
    if (previousInside == null) {
      previousInside = inside;
      continue;
    }
    if (inside !== previousInside) {
      return {
        hit: true,
        kind: previousInside ? 'exit' : 'entry',
        distanceMeters: simUnitsToMeters(distance),
      };
    }
    previousInside = inside;
  }

  return { hit: false, kind: null, distanceMeters: lengthMeters };
}

function expectCarRayMiss(lengthMeters) {
  return {
    hit: false,
    distanceMeters: lengthMeters,
    driverId: null,
    targetId: null,
    targetType: null,
    relativeSpeedKph: 0,
  };
}

describe('paddock environment options', () => {
  test('requires explicit controlled drivers', () => {
    expect(() => resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
    })).toThrow('controlledDrivers is required');
  });

  test('uses environment-specific driver validation messages', () => {
    expect(() => resolveEnvironmentOptions({
      drivers: [],
      controlledDrivers: ['budget'],
    })).toThrow('createPaddockEnvironment requires a non-empty drivers array.');
  });

  test('resolves controlled-only participants', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      scenario: { participants: 'controlled-only' },
    });

    expect(options.drivers.map((driver) => driver.id)).toEqual([CONTROLLED_DRIVER_ID]);
    expect(options.controlledDrivers).toEqual([CONTROLLED_DRIVER_ID]);
    expect(options.scenario.nonControlled).toBe('ai');
  });

  slowTest('can disable tire degradation through race rules', () => {
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed: 71,
      trackSeed: 2097,
      frameSkip: 4,
      scenario: { participants: 'controlled-only' },
      rules: {
        standingStart: false,
        modules: {
          tireDegradation: { enabled: false },
        },
      },
      episode: { maxSteps: 10 },
    });

    let result = env.reset();
    expect(result.observation[CONTROLLED_DRIVER_ID].object.self.tireEnergy).toBe(100);
    for (let index = 0; index < 8; index += 1) {
      result = env.step({
        [CONTROLLED_DRIVER_ID]: { steering: 0.2, throttle: 1, brake: 0 },
      });
      expect(result.observation[CONTROLLED_DRIVER_ID].object.self.tireEnergy).toBe(100);
    }
    env.destroy();
  });

  slowTest('steps a no-pit generated training profile through the public environment', () => {
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed: 71,
      trackSeed: 4101,
      trackGeneration: { profile: 'training-short' },
      frameSkip: 2,
      scenario: { participants: 'controlled-only' },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireDegradation: { enabled: false },
        },
      },
      result: { stateOutput: 'full' },
      episode: { maxSteps: 20, endOnRaceFinish: false },
    });

    let result = env.reset();
    expect(result.state.snapshot.track.pitLane).toBeNull();
    expect(simUnitsToMeters(result.state.snapshot.track.length)).toBeGreaterThanOrEqual(900);
    expect(result.observation[CONTROLLED_DRIVER_ID].object.rays.length).toBeGreaterThan(0);

    result = env.step({
      [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 0.8, brake: 0 },
    });

    expect(result.state.snapshot.track.pitLane).toBeNull();
    expect(result.metrics[CONTROLLED_DRIVER_ID]).toBeTruthy();
    env.destroy();
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('rejects unsupported first-slice scenario modes', () => {
    expect(() => resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      scenario: { nonControlled: 'static-obstacles' },
    })).toThrow('first slice only supports scenario.nonControlled: "ai"');
  });

  test('resolves scenario placements without changing participant ownership', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      scenario: {
        participants: 'controlled-only',
        placements: {
          [CONTROLLED_DRIVER_ID]: {
            distanceMeters: 180,
            offsetMeters: 8,
            speedKph: 70,
            headingErrorRadians: -0.25,
          },
        },
      },
    });

    expect(options.scenario.placements[CONTROLLED_DRIVER_ID]).toMatchObject({
      distanceMeters: 180,
      offsetMeters: 8,
      speedKph: 70,
      headingErrorRadians: -0.25,
    });
    expect(options.drivers.map((driver) => driver.id)).toEqual([CONTROLLED_DRIVER_ID]);
  });
});

describe('paddock environment actions', () => {
  test('maps normalized steering to absolute steering targets', () => {
    const controls = resolveActionMap({
      left: { steering: -1, throttle: 0, brake: 0 },
      center: { steering: 0, throttle: 0, brake: 0 },
      right: { steering: 1, throttle: 2, brake: -1 },
      partial: { steering: 0.5, throttle: 0, brake: 0 },
    }, ['left', 'center', 'right', 'partial'], { policy: 'strict' });

    expect(controls.controlsByDriver.left.steering).toBeCloseTo(-VEHICLE_LIMITS.maxSteer);
    expect(controls.controlsByDriver.center.steering).toBe(0);
    expect(controls.controlsByDriver.right).toEqual({
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 1,
      brake: 0,
    });
    expect(controls.controlsByDriver.partial.steering).toBeCloseTo(VEHICLE_LIMITS.maxSteer * 0.5);
    expect(controls.errors).toEqual([]);
  });

  test('zero steering action recenters the physical steering wheel target', () => {
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed: 71,
      trackSeed: 2097,
      frameSkip: 1,
      physicsMode: 'simulator',
      scenario: { participants: 'controlled-only' },
      rules: {
        standingStart: false,
        modules: {
          tireDegradation: { enabled: false },
        },
      },
      episode: { maxSteps: 30 },
    });

    let result = env.reset();
    for (let index = 0; index < 6; index += 1) {
      result = env.step({
        [CONTROLLED_DRIVER_ID]: { steering: 1, throttle: 0.5, brake: 0 },
      });
    }

    const turnedAngle = result.observation[CONTROLLED_DRIVER_ID].object.self.steeringAngleRadians;
    expect(turnedAngle).toBeGreaterThan(0);

    for (let index = 0; index < 8; index += 1) {
      result = env.step({
        [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 0.5, brake: 0 },
      });
    }

    const centeredAngle = result.observation[CONTROLLED_DRIVER_ID].object.self.steeringAngleRadians;
    expect(Math.abs(centeredAngle)).toBeLessThan(Math.abs(turnedAngle));
    expect(Math.abs(centeredAngle)).toBeLessThan(0.02);
    env.destroy();
  });

  test('throws for missing controlled-driver actions in strict mode', () => {
    expect(() => resolveActionMap({}, ['budget'], { policy: 'strict' }))
      .toThrow('Missing action for controlled driver: budget');
  });

  test('reports missing controlled-driver actions in report mode', () => {
    const result = resolveActionMap({}, ['budget'], { policy: 'report' });
    expect(result.errors).toEqual(['Missing action for controlled driver: budget']);
  });

  test('maps optional pit intent separately from vehicle controls', () => {
    const result = resolveActionMap({
      budget: { steering: 0.5, throttle: 1, brake: 0, pitIntent: 2 },
    }, ['budget'], { policy: 'strict' });

    expect(result.controlsByDriver.budget).toEqual({
      steering: VEHICLE_LIMITS.maxSteer * 0.5,
      throttle: 1,
      brake: 0,
    });
    expect(result.pitIntentByDriver.budget).toBe(2);
  });

  test('rejects unsupported pit intent action values', () => {
    expect(() => resolveActionMap({
      budget: { steering: 0, throttle: 1, brake: 0, pitIntent: 3 },
    }, ['budget'], { policy: 'strict' })).toThrow('Invalid pitIntent action for controlled driver: budget');
  });
});

describe('paddock environment observations and runtime', () => {
  test('controlled environment cars still crash on main-track barrier near pit-exit geometry', () => {
    const seed = 71;
    const trackSeed = 2097;
    const baseline = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed,
      trackSeed,
      rules: { standingStart: false, ruleset: 'fia2025' },
      scenario: { participants: 'controlled-only' },
    });
    const track = baseline.getState().snapshot.track;
    const pitExitDistanceMeters = simUnitsToMeters(track.pitLane.exit.trackDistance ?? track.pitLane.exit.distanceFromStart);
    const barrierInnerMeters = simUnitsToMeters(
      track.width / 2 +
      (track.kerbWidth ?? 0) +
      track.gravelWidth +
      track.runoffWidth -
      (track.barrierWidth ?? 0) / 2,
    );
    baseline.destroy();

    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed,
      trackSeed,
      physicsMode: 'simulator',
      rules: { standingStart: false, ruleset: 'fia2025' },
      scenario: {
        participants: 'controlled-only',
        placements: {
          [CONTROLLED_DRIVER_ID]: {
            distanceMeters: pitExitDistanceMeters,
            offsetMeters: -(barrierInnerMeters + 1),
            speedKph: 0,
            headingErrorRadians: 0,
          },
        },
      },
    });

    const result = env.step({
      [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 0, brake: 0 },
    });
    const car = result.state.snapshot.cars.find((entry) => entry.id === CONTROLLED_DRIVER_ID);

    expect(car?.destroyed).toBe(true);
    expect(car?.destroyReason).toBe('barrier');
    expect(result.info.drivers[CONTROLLED_DRIVER_ID].endReason).toBe('destroyed');
    env.destroy();
  });

  test('controlled environment pit override is gated by committed pit routing intent', () => {
    const track = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
    }).snapshot().track;
    const point = track.pitLane.exit.roadCenterline[Math.floor(track.pitLane.exit.roadCenterline.length / 2)];
    const progress = track.pitLane.exit.trackDistance;
    const unrestricted = nearestTrackState(track, point, progress);
    expect(unrestricted.surface).toMatch(/^pit-/);
    expect(Boolean(unrestricted.inPitLane)).toBe(true);

    const blocked = nearestTrackStateForCar(track, {
      id: CONTROLLED_DRIVER_ID,
      x: point.x,
      y: point.y,
      progress,
      environmentControlled: true,
      pitStop: { intent: 0, status: 'pending' },
    }, point, progress);
    expect(Boolean(blocked.inPitLane)).toBe(false);
    expect(String(blocked.surface)).not.toMatch(/^pit-/);

    const committed = nearestTrackStateForCar(track, {
      id: CONTROLLED_DRIVER_ID,
      x: point.x,
      y: point.y,
      progress,
      environmentControlled: true,
      pitStop: { intent: 2, status: 'pending' },
    }, point, progress);
    expect(Boolean(committed.inPitLane)).toBe(true);
    expect(String(committed.surface)).toMatch(/^pit-/);
  });

  test('track ray context follows the same pit-override guard for controlled cars', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
    });
    const snapshot = sim.snapshot();
    const mid = snapshot.track.pitLane.exit.roadCenterline[Math.floor(snapshot.track.pitLane.exit.roadCenterline.length / 2)];
    const baseHeading = pointAt(snapshot.track, snapshot.track.pitLane.exit.trackDistance).heading;

    const controlledCar = {
      ...snapshot.cars[0],
      x: mid.x,
      y: mid.y,
      heading: baseHeading,
      progress: snapshot.track.pitLane.exit.trackDistance,
      environmentControlled: true,
      pitStop: { ...(snapshot.cars[0].pitStop ?? {}), intent: 0, status: 'pending' },
    };

    const blocked = createTrackRayContext(controlledCar, snapshot, getCarRayOrigin(controlledCar));
    expect(Boolean(blocked.originState?.inPitLane)).toBe(false);

    const committed = createTrackRayContext({
      ...controlledCar,
      pitStop: { ...controlledCar.pitStop, intent: 2, status: 'pending' },
    }, snapshot, getCarRayOrigin(controlledCar));
    expect(Boolean(committed.originState?.inPitLane)).toBe(true);
  });

  test('batch-training profile isolates cars while keeping them visible in snapshots', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 2),
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      participantInteractions: {
        defaultProfile: 'batch-training',
      },
    });

    const snapshot = sim.snapshot();

    expect(snapshot.cars).toHaveLength(2);
    expect(snapshot.cars[0].interaction).toMatchObject({
      profile: 'batch-training',
      collidable: false,
      detectableByRays: false,
      detectableAsNearby: false,
      blocksPitLane: false,
      affectsRaceOrder: false,
    });
  });

  test('participant interaction profiles control ray and nearby-car visibility without changing sensor shape', () => {
    const isolated = createRaceSimulation({
      seed: 71,
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 2),
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      participantInteractions: {
        drivers: {
          [SENSOR_TARGET_DRIVER_ID]: { profile: 'isolated-training' },
        },
      },
    });
    placeSensorPair(isolated);
    const isolatedSnapshot = isolated.snapshot();
    const isolatedCar = isolatedSnapshot.cars.find((car) => car.id === CONTROLLED_DRIVER_ID);
    const isolatedObservation = buildEnvironmentObservation({
      snapshot: isolatedSnapshot,
      previousSnapshot: null,
      options: {
        controlledDrivers: [CONTROLLED_DRIVER_ID],
        sensors: {
          rays: { enabled: true, anglesDegrees: [0], lengthMeters: 80, detectTrack: false, detectCars: true },
          nearbyCars: { enabled: true, maxCars: 4, radiusMeters: 100 },
        },
        sensorsByDriver: {},
        observation: {},
      },
      events: [],
    })[CONTROLLED_DRIVER_ID];

    expect(buildRaySensors(isolatedCar, isolatedSnapshot, {
      anglesDegrees: [0],
      lengthMeters: 80,
      detectTrack: false,
      detectCars: true,
    })[0].car).toEqual(expectCarRayMiss(80));
    expect(isolatedObservation.object.nearbyCars).toEqual([]);
    expect(isolatedObservation.schema.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'rays[0].car.hit',
      'nearbyCars[0].present',
    ]));

    const phantom = createRaceSimulation({
      seed: 71,
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 2),
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      participantInteractions: {
        drivers: {
          [SENSOR_TARGET_DRIVER_ID]: { profile: 'phantom-race' },
        },
      },
    });
    placeSensorPair(phantom);
    const phantomSnapshot = phantom.snapshot();
    const phantomCar = phantomSnapshot.cars.find((car) => car.id === CONTROLLED_DRIVER_ID);
    const phantomObservation = buildEnvironmentObservation({
      snapshot: phantomSnapshot,
      previousSnapshot: null,
      options: {
        controlledDrivers: [CONTROLLED_DRIVER_ID],
        sensors: {
          rays: { enabled: true, anglesDegrees: [0], lengthMeters: 80, detectTrack: false, detectCars: true },
          nearbyCars: { enabled: true, maxCars: 4, radiusMeters: 100 },
        },
        sensorsByDriver: {},
        observation: {},
      },
      events: [],
    })[CONTROLLED_DRIVER_ID];

    expect(buildRaySensors(phantomCar, phantomSnapshot, {
      anglesDegrees: [0],
      lengthMeters: 80,
      detectTrack: false,
      detectCars: true,
    })[0].car).toEqual(expect.objectContaining({
      hit: true,
      driverId: SENSOR_TARGET_DRIVER_ID,
    }));
    expect(phantomObservation.object.nearbyCars.map((car) => car.id)).toContain(SENSOR_TARGET_DRIVER_ID);
    expect(phantomObservation.schema).toEqual(isolatedObservation.schema);
  });

  test('replay ghosts stay sensor-hidden by default and become detectable only when opted in', () => {
    function createGhostSensorSimulation(sensors = {}) {
      const trackModel = createRaceSimulation({
        seed: 71,
        drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
        track: TRACK,
        rules: { standingStart: false, ruleset: 'fia2025' },
      }).track;
      const ghostPoint = pointAt(trackModel, metersToSimUnits(820));
      const sim = createRaceSimulation({
        seed: 71,
        drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
        track: TRACK,
        rules: { standingStart: false, ruleset: 'fia2025' },
        replayGhosts: [
          {
            id: 'reference-ghost',
            label: 'Reference Ghost',
            trajectory: [
              {
                timeSeconds: 0,
                x: ghostPoint.x,
                y: ghostPoint.y,
                headingRadians: ghostPoint.heading,
                speedKph: 140,
              },
            ],
            sensors,
          },
        ],
      });
      const base = pointAt(sim.track, metersToSimUnits(800));
      sim.setCarState(CONTROLLED_DRIVER_ID, {
        x: base.x,
        y: base.y,
        previousX: base.x,
        previousY: base.y,
        heading: base.heading,
        previousHeading: base.heading,
        progress: base.distance,
        raceDistance: base.distance,
        speed: kphToSimSpeed(100),
      });
      return sim;
    }

    const hidden = createGhostSensorSimulation();
    const hiddenSnapshot = hidden.snapshot();
    const hiddenCar = hiddenSnapshot.cars.find((car) => car.id === CONTROLLED_DRIVER_ID);
    expect(buildRaySensors(hiddenCar, hiddenSnapshot, {
      anglesDegrees: [0],
      lengthMeters: 80,
      detectTrack: false,
      detectCars: true,
    })[0].car).toEqual(expectCarRayMiss(80));

    const visible = createGhostSensorSimulation({
      detectableByRays: true,
      detectableAsNearby: true,
    });
    const visibleSnapshot = visible.snapshot();
    const visibleCar = visibleSnapshot.cars.find((car) => car.id === CONTROLLED_DRIVER_ID);
    const rayHit = buildRaySensors(visibleCar, visibleSnapshot, {
      anglesDegrees: [0],
      lengthMeters: 80,
      detectTrack: false,
      detectCars: true,
    })[0].car;
    const observation = buildEnvironmentObservation({
      snapshot: visibleSnapshot,
      previousSnapshot: null,
      options: {
        controlledDrivers: [CONTROLLED_DRIVER_ID],
        sensors: {
          rays: { enabled: true, anglesDegrees: [0], lengthMeters: 80, detectTrack: false, detectCars: true },
          nearbyCars: { enabled: true, maxCars: 4, radiusMeters: 100 },
        },
        sensorsByDriver: {},
        observation: {},
      },
      events: [],
    })[CONTROLLED_DRIVER_ID];

    expect(rayHit).toEqual(expect.objectContaining({
      hit: true,
      driverId: 'reference-ghost',
      targetId: 'reference-ghost',
      targetType: 'replayGhost',
    }));
    expect(observation.object.nearbyCars).toEqual([
      expect.objectContaining({
        id: 'reference-ghost',
        entityType: 'replayGhost',
        sameLap: false,
      }),
    ]);
  });

  test('environment reset and step keep the training API state and observation shapes stable', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      sensors: {
        rays: { enabled: true, anglesDegrees: [-30, 0, 30], lengthMeters: 80 },
        nearbyCars: { enabled: true, maxCars: 2, radiusMeters: 100 },
      },
    });

    const initial = env.reset();
    const result = env.step({
      [driverId]: { steering: 0.1, throttle: 1, brake: 0, pitIntent: 0 },
    });

    expect(initial).toMatchObject({
      observation: {
        [driverId]: {
          object: {
            self: expect.any(Object),
            race: expect.any(Object),
            track: expect.any(Object),
            rays: expect.any(Array),
            nearbyCars: expect.any(Array),
          },
          vector: expect.any(Array),
          schema: expect.any(Array),
        },
      },
      reward: null,
      terminated: false,
      truncated: false,
      info: expect.any(Object),
      state: {
        snapshot: expect.objectContaining({
          time: expect.any(Number),
          raceControl: expect.any(Object),
          cars: expect.any(Array),
        }),
      },
    });
    expect(result).toMatchObject({
      observation: {
        [driverId]: {
          object: {
            self: expect.objectContaining({
              speedKph: expect.any(Number),
              pitIntent: 0,
              pitStopStatus: expect.any(String),
            }),
            race: expect.objectContaining({
              raceMode: expect.any(String),
              pitLaneOpen: expect.any(Boolean),
            }),
          },
          vector: expect.any(Array),
          schema: expect.any(Array),
        },
      },
      reward: null,
      terminated: expect.any(Boolean),
      truncated: expect.any(Boolean),
      info: expect.any(Object),
      state: {
        snapshot: expect.objectContaining({
          events: expect.any(Array),
          cars: expect.any(Array),
        }),
      },
    });
    expect(result.observation[driverId].vector).toHaveLength(result.observation[driverId].schema.length);
  });

  test('builds object and vector observations with real units', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      track: TRACK,
    });
    const sim = createRaceSimulation(options);
    const snapshot = sim.snapshot();
    const observation = buildEnvironmentObservation({
      snapshot,
      previousSnapshot: null,
      options,
      events: [],
    });
    const driverId = CONTROLLED_DRIVER_ID;

    expect(observation[driverId].object.self.speedKph).toEqual(expect.any(Number));
    expect(observation[driverId].object.self.trackOffsetMeters).toEqual(expect.any(Number));
    expect(observation[driverId].object.rays.length).toBeGreaterThan(0);
    expect(observation[driverId].object.nearbyCars).toEqual(expect.any(Array));
    expect(observation[driverId].object.track.lookahead.length).toBeGreaterThan(0);
    expect(observation[driverId].vector.length).toBe(observation[driverId].schema.length);
    expect(observation[driverId].schema[0]).toHaveProperty('name');
    expect(observation[driverId].schema.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'track.lookahead[0].curvature',
      'rays[0].track.distanceRatio',
      'rays[0].car.hit',
      'nearbyCars[0].present',
      'race.redFlag',
      'self.pitIntent',
    ]));
  });

  test('supports opt-in physical driver observations without privileged lookahead by default', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      observation: { profile: 'physical-driver' },
      sensors: {
        rays: {
          enabled: true,
          rays: [
            { id: 'front', angleDegrees: 0, lengthMeters: 220 },
            { id: 'right', angleDegrees: 90, lengthMeters: 80 },
          ],
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'barrier', 'car'],
        },
        nearbyCars: { enabled: true, maxCars: 2, radiusMeters: 100 },
      },
    });

    const spec = env.getObservationSpec();
    const result = env.reset();
    const observation = result.observation[driverId];

    expect(spec.version).toBe(4);
    expect(spec.object.track.lookaheadMeters).toEqual([]);
    expect(observation.object.profile).toBe('physical-driver');
    expect(observation.object.track.lookahead).toEqual([]);
    expect(observation.object.self.yawRateRadiansPerSecond).toEqual(expect.any(Number));
    expect(observation.object.trackRelation).toEqual(expect.objectContaining({
      leftBoundaryMeters: expect.any(Number),
      rightBoundaryMeters: expect.any(Number),
      legalWidthMeters: expect.any(Number),
    }));
    expect(observation.object.contactPatches).toHaveLength(4);
    expect(observation.object.rays.map((ray) => ray.lengthMeters)).toEqual([220, 80]);
    expect(observation.schema.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'self.yawRateRadiansPerSecond',
      'trackRelation.leftBoundaryMeters',
      'contactPatches[0].surfaceCode',
      'rays[1].kerb.hit',
      'rays[1].illegalSurface.hit',
      'nearbyCars[0].closingRateMetersPerSecond',
    ]));
    expect(spec.object.rays.channels).toEqual(['roadEdge', 'kerb', 'illegalSurface', 'car']);
    expect(observation.object.rays[0]).not.toHaveProperty('barrier');
    expect(observation.schema.map((entry) => entry.name).filter(Boolean).join('\n')).not.toContain('.barrier.');
    expect(observation.vector).toHaveLength(observation.schema.length);

    env.destroy();
  });

  test('supports compact vector-only observations while specs keep the full schema', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      sensors: {
        rays: { enabled: true, anglesDegrees: [0], lengthMeters: 80 },
        nearbyCars: { enabled: false },
      },
    });

    const spec = env.getObservationSpec();
    const result = env.reset();
    const observation = result.observation[driverId];

    expect(spec.vector.schema.length).toBeGreaterThan(0);
    expect(observation.vector).toEqual(expect.any(Array));
    expect(observation.events).toEqual(expect.any(Array));
    expect(observation).not.toHaveProperty('object');
    expect(observation).not.toHaveProperty('schema');
    expect(observation.vector).toHaveLength(spec.vector.schema.length);
    env.destroy();
  });

  test('compact vector-only observations match full observations without requiring object output', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const sim = createRaceSimulation({
      seed: 71,
      drivers: ENVIRONMENT_TEST_DRIVERS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshotObservation();
    const baseOptions = {
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      observation: {
        profile: 'physical-driver',
      },
      sensors: {
        rays: {
          enabled: true,
          anglesDegrees: [-30, 0, 30],
          lengthMeters: 120,
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'barrier', 'car'],
        },
        nearbyCars: { enabled: false },
      },
    };
    const full = buildEnvironmentObservation({
      snapshot,
      options: resolveEnvironmentOptions({
        ...baseOptions,
        observation: { ...baseOptions.observation, output: 'full', includeSchema: true },
      }),
      events: [],
    })[driverId];
    const compact = buildEnvironmentObservation({
      snapshot,
      options: resolveEnvironmentOptions({
        ...baseOptions,
        observation: { ...baseOptions.observation, output: 'vector', includeSchema: false },
      }),
      events: [],
    })[driverId];

    expect(compact).not.toHaveProperty('object');
    expect(compact).not.toHaveProperty('schema');
    expect(compact.vector).toHaveLength(full.schema.length);
    expect(compact.vector).toEqual(full.vector);
  });

  test('supports typed vector observations and lean state output for training loops', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
        vectorType: 'float32',
      },
      result: {
        stateOutput: 'none',
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });

    const result = env.reset();

    expect(result.state).toBeNull();
    expect(result.observation[driverId].vector).toBeInstanceOf(Float32Array);
    expect(result.observation[driverId]).not.toHaveProperty('object');
    expect(result.observation[driverId]).not.toHaveProperty('schema');
    env.destroy();
  });

  test('batch-training vector mode preserves internal track query diagnostics', () => {
    const batch = createBatchTrainingDrivers(4);
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      physicsMode: 'simulator',
      frameSkip: 2,
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: { participants: batch.ids },
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      result: { stateOutput: 'none' },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
        nearbyCars: { enabled: false },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireDegradation: { enabled: false },
        },
      },
    });

    env.reset();
    const track = env.getState({ output: 'minimal' }).snapshot.track;
    resetTrackQueryStats(track);
    env.step(Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0.1, throttle: 0.3, brake: 0 },
    ])));

    const stats = snapshotTrackQueryStats(env.getState({ output: 'minimal' }).snapshot.track);
    expect(stats.nearestQueries).toBeGreaterThan(0);
    expect(stats.nearestFallbacks).toBe(0);
    env.destroy();
  });

  test('destroyed batch-training cars skip expensive ray geometry while keeping stable ray shape', () => {
    const batch = createBatchTrainingDrivers(4);
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      trackQueryIndex: true,
      physicsMode: 'simulator',
      frameSkip: 2,
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: { participants: batch.ids },
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      result: { stateOutput: 'none' },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
        nearbyCars: { enabled: false },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireDegradation: { enabled: false },
        },
      },
    });
    const track = env.getState({ output: 'minimal' }).snapshot.track;
    const farOutsideMeters = simUnitsToMeters(
      track.width / 2 +
      track.kerbWidth +
      track.gravelWidth +
      track.runoffWidth +
      metersToSimUnits(260),
    );

    env.reset();
    resetTrackQueryStats(env.getState({ output: 'minimal' }).snapshot.track);
    const reset = env.resetDrivers(Object.fromEntries(batch.ids.map((driverId, index) => [
      driverId,
      {
        distanceMeters: 800 + index * 3,
        offsetMeters: farOutsideMeters,
        speedKph: 65,
        headingErrorRadians: -Math.PI / 2,
      },
    ])), { observationScope: 'reset', stateOutput: 'none' });
    const resetStats = snapshotTrackQueryStats(env.getState({ output: 'minimal' }).snapshot.track);

    expect(reset.metrics[batch.ids[0]].destroyed).toBe(true);
    expect(resetStats.nearestQueries).toBeLessThan(500);
    expect(resetStats.nearestFallbacks).toBeLessThan(20);
    resetTrackQueryStats(env.getState({ output: 'minimal' }).snapshot.track);

    const result = env.step(Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0.35, throttle: 0.25, brake: 0 },
    ])));
    const stats = snapshotTrackQueryStats(env.getState({ output: 'minimal' }).snapshot.track);

    expect(result.metrics[batch.ids[0]].destroyed).toBe(true);
    expect(stats.nearestQueries).toBeLessThan(500);
    expect(stats.nearestFallbacks).toBeLessThan(20);
    expect(stats.nearestFallbackReasons['spatial-grid-no-candidates']).toBe(stats.nearestFallbacks);
    expect(result.observation[batch.ids[0]].vector.length).toBeGreaterThan(0);
    env.destroy();
  });

  test('resetDrivers resets selected drivers without recreating the whole environment', () => {
    const batch = createBatchTrainingDrivers(3);
    const [firstDriver, secondDriver] = batch.ids;
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      physicsMode: 'simulator',
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: { participants: batch.ids },
      observation: { profile: 'physical-driver' },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      rules: { standingStart: false },
    });

    env.reset();
    const afterStep = env.step(Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0, throttle: 0.4, brake: 0 },
    ])));
    const beforeSecond = afterStep.state.snapshot.cars.find((car) => car.id === secondDriver).distanceMeters;
    const reset = env.resetDrivers({
      [firstDriver]: {
        distanceMeters: 1200,
        offsetMeters: 3,
        speedKph: 80,
        headingErrorRadians: 0.2,
      },
    });
    const resetFirst = reset.state.snapshot.cars.find((car) => car.id === firstDriver);
    const resetSecond = reset.state.snapshot.cars.find((car) => car.id === secondDriver);

    expect(reset.info.drivers[firstDriver]).toMatchObject({
      episodeStep: 0,
      episodeId: 1,
      truncated: false,
      terminated: false,
      endReason: null,
    });
    expect(reset.info.drivers[secondDriver].episodeId).toBe(0);
    expect(resetFirst.distanceMeters).toBeCloseTo(1200, 1);
    expect(resetFirst.speedKph).toBeCloseTo(80, 0);
    expect(resetSecond.distanceMeters).toBeCloseTo(beforeSecond, 6);
    env.destroy();
  });

  test('resetDrivers can return only reset-driver observations with lean state', () => {
    const batch = createBatchTrainingDrivers(3);
    const [firstDriver, secondDriver] = batch.ids;
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      physicsMode: 'simulator',
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: { participants: batch.ids },
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      result: {
        stateOutput: 'minimal',
        resetDriversObservationScope: 'reset',
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      rules: { standingStart: false },
    });

    env.reset();
    const reset = env.resetDrivers({
      [firstDriver]: { distanceMeters: 1200, offsetMeters: 0, speedKph: 80 },
    }, {
      stateOutput: 'none',
    });

    expect(Object.keys(reset.observation)).toEqual([firstDriver]);
    expect(Object.keys(reset.metrics)).toEqual([firstDriver]);
    expect(reset.observation).not.toHaveProperty(secondDriver);
    expect(reset.info.drivers[firstDriver].episodeId).toBe(1);
    expect(reset.info.drivers[secondDriver].episodeId).toBe(0);
    expect(reset.state).toBeNull();
    env.destroy();
  });

  test('reports per-driver runtime state and neutral metrics for batched training', () => {
    const batch = createBatchTrainingDrivers(2);
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      physicsMode: 'simulator',
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: {
        participants: batch.ids,
        placements: {
          [batch.ids[0]]: { distanceMeters: 800, offsetMeters: 0, speedKph: 80 },
          [batch.ids[1]]: { distanceMeters: 800, offsetMeters: 14, speedKph: 20, headingErrorRadians: 1.6 },
        },
      },
      observation: { profile: 'physical-driver' },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      rules: { standingStart: false },
    });

    env.reset();
    const result = env.step(Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0, throttle: 0.2, brake: 0 },
    ])));

    expect(result.info.drivers[batch.ids[0]]).toMatchObject({
      episodeStep: 1,
      episodeId: 0,
      terminated: false,
      truncated: false,
      endReason: null,
    });
    expect(result.metrics[batch.ids[0]]).toEqual(expect.objectContaining({
      progressDeltaMeters: expect.any(Number),
      legalProgressDeltaMeters: expect.any(Number),
      offTrack: false,
      kerb: expect.any(Boolean),
      fullyOutsideWhiteLine: false,
      severeCut: false,
      under30kph: expect.any(Boolean),
      spinOrBackwards: expect.any(Boolean),
      completedLap: false,
      lapTimeSeconds: null,
      contactCount: 0,
    }));
    expect(result.metrics[batch.ids[1]]).toEqual(expect.objectContaining({
      offTrack: true,
      severeCut: true,
      under30kph: true,
      spinOrBackwards: true,
    }));
    env.destroy();
  });

  slowTest('steps 20 compact physical-driver agents with accelerated rays inside the performance budget', () => {
    const batch = createBatchTrainingDrivers(20);
    const baseOptions = {
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      physicsMode: 'simulator',
      frameSkip: 4,
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: { participants: batch.ids },
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'barrier', 'car'],
        },
        nearbyCars: { enabled: false },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireDegradation: { enabled: false },
        },
      },
      episode: { maxSteps: 1000, endOnRaceFinish: false },
    };
    const noRayEnv = createPaddockEnvironment({
      ...baseOptions,
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });
    noRayEnv.reset();
    const actions = Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0, throttle: 0.5, brake: 0 },
    ]));
    const noRayStartedAt = performance.now();
    for (let index = 0; index < 10; index += 1) {
      noRayEnv.step(actions);
    }
    const noRayMsPerStep = (performance.now() - noRayStartedAt) / 10;
    noRayEnv.destroy();

    const env = createPaddockEnvironment(baseOptions);

    env.reset();
    const startedAt = performance.now();
    let result = null;
    for (let index = 0; index < 10; index += 1) {
      result = env.step(actions);
    }
    const msPerStep = (performance.now() - startedAt) / 10;

    expect(Object.keys(result.observation)).toHaveLength(20);
    expect(result.observation[batch.ids[0]]).not.toHaveProperty('object');
    expect(noRayMsPerStep).toBeLessThan(25);
    expect(msPerStep).toBeLessThan(25);
    env.destroy();
  });

  slowTest('keeps compact generated training-track ray observations inside the Policy Runner budget', () => {
    const batch = createBatchTrainingDrivers(8);
    const placements = Object.fromEntries(batch.ids.map((driverId, index) => [
      driverId,
      {
        distanceMeters: 80 + index * 14,
        offsetMeters: ((index % 4) - 1.5) * 2.5,
        speedKph: 95,
      },
    ]));
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      trackSeed: 4101,
      trackGeneration: { profile: 'training-short' },
      physicsMode: 'arcade',
      frameSkip: 1,
      participantInteractions: { defaultProfile: 'batch-training' },
      scenario: { participants: batch.ids, placements },
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      result: {
        stateOutput: 'none',
        resetDriversObservationScope: 'reset',
      },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
        nearbyCars: { enabled: false },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireDegradation: { enabled: false },
        },
      },
      episode: { maxSteps: 1000, endOnRaceFinish: false },
    });

    env.reset();
    const actions = Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0, throttle: 0.5, brake: 0 },
    ]));
    const timings = [];
    let result = null;
    for (let index = 0; index < 35; index += 1) {
      const startedAt = performance.now();
      result = env.step(actions);
      timings.push(performance.now() - startedAt);
    }
    timings.sort((a, b) => a - b);
    const averageMs = timings.reduce((total, value) => total + value, 0) / timings.length;
    const p95Ms = timings[Math.floor(timings.length * 0.95)];

    expect(Object.keys(result.observation)).toHaveLength(8);
    expect(result.state).toBeNull();
    expect(averageMs).toBeLessThan(20);
    expect(p95Ms).toBeLessThan(30);
    env.destroy();
  });


  test('surface ray channels reuse one per-ray layout and do not expose barrier distance', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      track: TRACK,
      sensors: {
        rays: {
          enabled: true,
          rays: [{ id: 'right-side', angleDegrees: 90, lengthMeters: 90 }],
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'barrier'],
          detectCars: false,
        },
        nearbyCars: { enabled: false },
      },
    });
    const sim = createRaceSimulation(options);
    const center = pointAt(sim.track, sim.track.length * 0.3);
    sim.setCarState(CONTROLLED_DRIVER_ID, {
      x: center.x,
      y: center.y,
      previousX: center.x,
      previousY: center.y,
      heading: center.heading,
      previousHeading: center.heading,
      progress: center.distance,
      raceDistance: center.distance,
      speed: kphToSimSpeed(90),
    });

    const observation = buildEnvironmentObservation({
      snapshot: sim.snapshot(),
      options,
      events: [],
    })[CONTROLLED_DRIVER_ID];
    const ray = observation.object.rays[0];

    expect(ray.id).toBe('right-side');
    expect(ray.track.hit).toBe(true);
    expect(ray.roadEdge).toEqual(ray.track);
    expect(ray.kerb).toEqual(expect.objectContaining({
      hit: true,
      surface: 'kerb',
    }));
    expect(ray.illegalSurface.hit).toBe(true);
    expect(['gravel', 'grass']).toContain(ray.illegalSurface.surface);
    expect(ray).not.toHaveProperty('barrier');
    expect(ray.car.hit).toBe(false);
    expect(observation.schema.map((entry) => entry.name).filter(Boolean).join('\n')).not.toContain('.barrier.');
  });

  test('barrier destruction terminates controlled driver episodes until resetDrivers recreates them', () => {
    const barrierOffsetMeters = simUnitsToMeters(
      TRACK.width / 2 + (TRACK.kerbWidth ?? 0) + TRACK.gravelWidth + TRACK.runoffWidth,
    ) + 6;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 2),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      track: TRACK,
      physicsMode: 'simulator',
      frameSkip: 1,
      rules: { standingStart: false },
      scenario: {
        placements: {
          [CONTROLLED_DRIVER_ID]: {
            distanceMeters: 720,
            offsetMeters: barrierOffsetMeters,
            speedKph: 180,
            headingErrorRadians: Math.PI / 2,
          },
        },
      },
    });

    const destroyed = env.step({
      [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 0, brake: 0 },
    });

    expect(destroyed.metrics[CONTROLLED_DRIVER_ID].destroyed).toBe(true);
    expect(destroyed.info.drivers[CONTROLLED_DRIVER_ID]).toEqual(expect.objectContaining({
      terminated: true,
      truncated: false,
      endReason: 'destroyed',
    }));
    expect(destroyed.done).toBe(true);

    const reset = env.resetDrivers({
      [CONTROLLED_DRIVER_ID]: {
        distanceMeters: 720,
        offsetMeters: 0,
        speedKph: 80,
        headingErrorRadians: 0,
      },
    });

    expect(reset.metrics[CONTROLLED_DRIVER_ID].destroyed).toBe(false);
    expect(reset.info.drivers[CONTROLLED_DRIVER_ID]).toEqual(expect.objectContaining({
      terminated: false,
      truncated: false,
      endReason: null,
      episodeId: 1,
      episodeStep: 0,
    }));
  });

  test('driver ray precision keeps sampled near-hit distances while debug refinement remains opt-in', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      trackQueryIndex: true,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const edgeOffset = snapshot.track.width / 2 - metersToSimUnits(0.25);
    const base = pointAt(snapshot.track, snapshot.track.pitLane.entry.trackDistance - metersToSimUnits(12));
    const position = offsetTrackPoint(base, edgeOffset);
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading,
      progress: base.distance,
      signedOffset: edgeOffset,
      inPitLane: false,
      pitLanePart: null,
      interaction: { profile: 'normal' },
    };
    const driverRay = buildRaySensors(car, snapshot, {
      anglesDegrees: [90],
      lengthMeters: 20,
      channels: ['roadEdge'],
      precision: 'driver',
    })[0];
    const debugRay = buildRaySensors(car, snapshot, {
      anglesDegrees: [90],
      lengthMeters: 20,
      channels: ['roadEdge'],
      precision: 'debug',
    })[0];

    expect(driverRay.track).toMatchObject({ hit: true, kind: 'exit' });
    expect(debugRay.track).toMatchObject({ hit: true, kind: 'exit' });
    expect(driverRay.track.distanceMeters).toBeGreaterThanOrEqual(debugRay.track.distanceMeters);
    expect(driverRay.track.distanceMeters).toBeLessThanOrEqual(1);
    expect(debugRay.track.distanceMeters).toBeLessThan(0.5);
  });

  test('physical driver observations stay finite for extreme off-track and missing contact patches', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      track: TRACK,
      observation: { profile: 'physical-driver' },
      sensors: {
        rays: {
          enabled: true,
          rays: [
            { id: 'front-long', angleDegrees: 0, lengthMeters: 300 },
            { id: 'side-short', angleDegrees: 90, lengthMeters: 40 },
          ],
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'barrier', 'car'],
        },
        nearbyCars: { enabled: true, maxCars: 2, radiusMeters: 120 },
      },
    });
    const sim = createRaceSimulation(options);
    const center = pointAt(sim.track, sim.track.length * 0.42);
    const outside = offsetTrackPoint(center, sim.track.width * 8);
    sim.setCarState(CONTROLLED_DRIVER_ID, {
      x: outside.x,
      y: outside.y,
      previousX: outside.x,
      previousY: outside.y,
      heading: center.heading + Math.PI,
      previousHeading: center.heading + Math.PI,
      progress: center.distance,
      raceDistance: center.distance,
      speed: kphToSimSpeed(12),
    });

    const snapshot = sim.snapshot();
    const observation = buildEnvironmentObservation({
      snapshot: {
        ...snapshot,
        cars: snapshot.cars.map((car) => car.id === CONTROLLED_DRIVER_ID
          ? {
              ...car,
              wheels: [],
              signedOffset: sim.track.width * 8,
              surface: 'barrier',
              onTrack: false,
            }
          : car),
      },
      options,
      events: [],
    })[CONTROLLED_DRIVER_ID];

    expect(observation.object.self.onTrack).toBe(false);
    expect(observation.object.contactPatches).toHaveLength(4);
    expect(observation.object.contactPatches.every((patch) => patch.present === false)).toBe(true);
    expect(observation.object.rays).toHaveLength(2);
    expect(observation.vector.every((value) => Number.isFinite(value))).toBe(true);
    expect(observation.vector).toHaveLength(observation.schema.length);
  });

  test('rich ray normalization degrades safely without track samples or valid ray input', () => {
    const car = {
      id: CONTROLLED_DRIVER_ID,
      x: 0,
      y: 0,
      heading: 0,
      progress: 0,
      speedKph: 0,
    };
    const rayOptions = normalizeRayOptions({
      rays: [{ id: 'broken', angleDegrees: Number.NaN, lengthMeters: -50 }],
      defaultLengthMeters: 40,
      channels: ['kerb', 'barrier'],
    });
    const rays = buildRaySensors(car, { track: {}, cars: [], replayGhosts: [] }, rayOptions);

    expect(rayOptions.rays).toEqual([
      expect.objectContaining({ id: 'broken', angleDegrees: -135, lengthMeters: 40 }),
    ]);
    expect(rays).toEqual([
      expect.objectContaining({
        id: 'broken',
        lengthMeters: 40,
        track: { hit: false, distanceMeters: 40, kind: null },
        kerb: { hit: false, distanceMeters: 40, surface: null },
        car: expectCarRayMiss(40),
      }),
    ]);
  });

  test('treats kerb and legal pit-lane surfaces as on-track observations', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      track: TRACK,
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });
    const sim = createRaceSimulation(options);
    const snapshot = sim.snapshot();
    const driverId = CONTROLLED_DRIVER_ID;
    const wheel = (overrides = {}) => ({
      onTrack: true,
      inPitLane: false,
      surface: 'track',
      ...overrides,
    });
    const observed = (carOverrides) => buildEnvironmentObservation({
      snapshot: {
        ...snapshot,
        cars: [{ ...snapshot.cars[0], ...carOverrides }],
      },
      options,
      events: [],
    })[driverId].object.self.onTrack;

    expect(observed({
      surface: 'kerb',
      wheels: [wheel({ surface: 'kerb' }), wheel(), wheel(), wheel()],
    })).toBe(true);
    expect(observed({
      surface: 'pit-lane',
      inPitLane: true,
      wheels: [
        wheel({ surface: 'pit-lane', inPitLane: true, onTrack: false }),
        wheel({ surface: 'pit-lane', inPitLane: true, onTrack: false }),
        wheel({ surface: 'pit-lane', inPitLane: true, onTrack: false }),
        wheel({ surface: 'pit-lane', inPitLane: true, onTrack: false }),
      ],
    })).toBe(true);
    expect(observed({
      surface: 'gravel',
      wheels: [wheel({ surface: 'gravel', onTrack: false }), wheel(), wheel(), wheel()],
    })).toBe(false);
  });

  test('sanitizes invalid observation lookahead options before building specs and observations', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      observation: {
        lookaheadMeters: '100',
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });

    const spec = env.getObservationSpec();
    const initial = env.reset();

    expect(spec.object.track.lookaheadMeters).toEqual([20, 50, 100, 150]);
    expect(initial.observation[driverId].object.track.lookahead.map((sample) => sample.distanceMeters))
      .toEqual([20, 50, 100, 150]);
  });

  test('applies absolute, relative traffic, and preset reset scenario placement through simulator state API', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const trafficDriverId = ENVIRONMENT_TEST_DRIVERS[1].id;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
      scenario: {
        preset: 'off-track-recovery',
        placements: {
          [driverId]: {
            distanceMeters: 420,
            offsetMeters: 16,
            speedKph: 65,
            headingErrorRadians: 0.4,
          },
        },
        traffic: [
          {
            driverId: trafficDriverId,
            relativeTo: driverId,
            deltaDistanceMeters: 24,
            offsetMeters: -1.5,
            speedKph: 68,
          },
        ],
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: true, maxCars: 2, radiusMeters: 80 },
      },
    });

    const initial = env.reset();
    const self = initial.observation[driverId].object.self;
    const traffic = initial.state.snapshot.cars.find((car) => car.id === trafficDriverId);
    const controlled = initial.state.snapshot.cars.find((car) => car.id === driverId);

    expect(self.speedKph).toBeCloseTo(65, 0);
    expect(self.trackOffsetMeters).toBeGreaterThan(14);
    expect(self.trackHeadingErrorRadians).toBeCloseTo(0.4, 1);
    expect(controlled.positionSource).toBe('integrated-vehicle');
    expect(traffic.distanceMeters - controlled.distanceMeters).toBeCloseTo(24, 0);
  });

  test('ray track distances follow actual curved track geometry', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      trackQueryIndex: true,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const base = pointAt(snapshot.track, 15083);
    const position = offsetTrackPoint(base, 0);
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading,
      progress: base.distance,
      signedOffset: 0,
    };

    const ray = buildRaySensors(car, snapshot, {
      anglesDegrees: [90],
      lengthMeters: 120,
    })[0];
    const expectedDistance = marchTrackEdgeDistance(snapshot.track, car, 90, 120);

    expect(ray.track.distanceMeters).toBeCloseTo(expectedDistance, 0);
    expect(ray.track).toMatchObject({
      hit: true,
      kind: 'exit',
    });
    expect(ray.track).not.toHaveProperty('surface');
  });

  test('batch-training rays still see upcoming curved track geometry', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      trackQueryIndex: true,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const base = pointAt(snapshot.track, metersToSimUnits(450));
    const position = offsetTrackPoint(base, 0);
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading,
      progress: base.distance,
      signedOffset: 0,
      interaction: { profile: 'batch-training' },
    };

    const ray = buildRaySensors(car, snapshot, {
      anglesDegrees: [0],
      lengthMeters: 260,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
    })[0];
    const expectedDistance = marchTrackEdgeDistance(snapshot.track, car, 0, 260);

    expect(expectedDistance).toBeLessThan(180);
    expect(ray.track).toMatchObject({
      hit: true,
      kind: 'exit',
    });
    expect(ray.track.distanceMeters).toBeCloseTo(expectedDistance, 0);
    expect(ray.kerb.hit).toBe(true);
    expect(ray.illegalSurface.hit).toBe(true);
  });

  slowTest('batch-training rays fall back to indexed geometry for curved rear and shallow entry cases', () => {
    const defaultSim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      trackQueryIndex: true,
      rules: { standingStart: false },
    });
    const defaultSnapshot = defaultSim.snapshot();
    const defaultBase = pointAt(defaultSnapshot.track, metersToSimUnits(9600));
    const defaultPosition = offsetTrackPoint(defaultBase, metersToSimUnits(5));
    const rearCurvedCar = {
      ...defaultSnapshot.cars[0],
      x: defaultPosition.x,
      y: defaultPosition.y,
      heading: defaultBase.heading,
      progress: defaultBase.distance,
      signedOffset: metersToSimUnits(5),
      inPitLane: false,
      pitLanePart: null,
      interaction: { profile: 'batch-training' },
    };
    const rearRay = buildRaySensors(rearCurvedCar, defaultSnapshot, {
      anglesDegrees: [180],
      lengthMeters: 160,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
    })[0];
    const expectedRear = marchTrackTransition(defaultSnapshot.track, rearCurvedCar, 180, 160);

    expect(expectedRear).toMatchObject({ hit: true, kind: 'exit' });
    expect(rearRay.track).toMatchObject({ hit: true, kind: 'exit' });
    expect(rearRay.track.distanceMeters).toBeCloseTo(expectedRear.distanceMeters, 0);
    expect(rearRay.kerb.hit).toBe(true);

    const trainingSim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: createProceduralTrack(4101, { profile: 'training-short' }),
      trackQueryIndex: true,
      rules: { standingStart: false },
    });
    const trainingSnapshot = trainingSim.snapshot();
    const trainingBase = pointAt(trainingSnapshot.track, metersToSimUnits(1500));
    const trainingPosition = offsetTrackPoint(trainingBase, metersToSimUnits(10));
    const shallowEntryCar = {
      ...trainingSnapshot.cars[0],
      x: trainingPosition.x,
      y: trainingPosition.y,
      heading: trainingBase.heading,
      progress: trainingBase.distance,
      signedOffset: metersToSimUnits(10),
      inPitLane: false,
      pitLanePart: null,
      interaction: { profile: 'batch-training' },
    };
    const shallowRay = buildRaySensors(shallowEntryCar, trainingSnapshot, {
      anglesDegrees: [20],
      lengthMeters: 160,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
    })[0];
    const expectedShallow = marchTrackTransition(trainingSnapshot.track, shallowEntryCar, 20, 160);

    expect(expectedShallow).toMatchObject({ hit: true, kind: 'entry' });
    expect(shallowRay.track).toMatchObject({ hit: true, kind: 'entry' });
    expect(shallowRay.track.distanceMeters).toBeCloseTo(expectedShallow.distanceMeters, 0);
    expect(shallowRay.kerb.hit).toBe(true);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('batch-training surface rays preserve exact illegal and curved kerb distances', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      trackQueryIndex: true,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const offTrackBase = pointAt(snapshot.track, 0);
    const offTrackPosition = offsetTrackPoint(offTrackBase, metersToSimUnits(-10));
    const offTrackCar = {
      ...snapshot.cars[0],
      x: offTrackPosition.x,
      y: offTrackPosition.y,
      heading: offTrackBase.heading,
      progress: offTrackBase.distance,
      signedOffset: metersToSimUnits(-10),
      inPitLane: false,
      pitLanePart: null,
    };

    const exactIllegal = buildRaySensors({
      ...offTrackCar,
      interaction: { profile: 'normal' },
    }, snapshot, {
      anglesDegrees: [180],
      lengthMeters: 160,
      channels: ['illegalSurface'],
    })[0];
    const batchIllegal = buildRaySensors({
      ...offTrackCar,
      interaction: { profile: 'batch-training' },
    }, snapshot, {
      anglesDegrees: [180],
      lengthMeters: 160,
      channels: ['illegalSurface'],
    })[0];

    expect(batchIllegal.illegalSurface).toEqual(exactIllegal.illegalSurface);

    const curvedBase = pointAt(snapshot.track, metersToSimUnits(560));
    const curvedPosition = offsetTrackPoint(curvedBase, 0);
    const curvedCar = {
      ...snapshot.cars[0],
      x: curvedPosition.x,
      y: curvedPosition.y,
      heading: curvedBase.heading,
      progress: curvedBase.distance,
      signedOffset: 0,
      inPitLane: false,
      pitLanePart: null,
    };
    const exactKerb = buildRaySensors({
      ...curvedCar,
      interaction: { profile: 'normal' },
    }, snapshot, {
      anglesDegrees: [30],
      lengthMeters: 160,
      channels: ['roadEdge', 'kerb'],
    })[0];
    const batchKerb = buildRaySensors({
      ...curvedCar,
      interaction: { profile: 'batch-training' },
    }, snapshot, {
      anglesDegrees: [30],
      lengthMeters: 160,
      channels: ['roadEdge', 'kerb'],
    })[0];

    expect(batchKerb.track.distanceMeters).toBeCloseTo(exactKerb.track.distanceMeters, 0);
    expect(batchKerb.kerb.distanceMeters).toBeCloseTo(exactKerb.kerb.distanceMeters, 0);
  });

  test('per-driver batch-training overrides enable the internal track query index', () => {
    const batch = createBatchTrainingDrivers(4);
    const env = createPaddockEnvironment({
      drivers: batch.drivers,
      entries: batch.entries,
      controlledDrivers: batch.ids,
      seed: 71,
      track: TRACK,
      physicsMode: 'simulator',
      frameSkip: 2,
      participantInteractions: {
        drivers: Object.fromEntries(batch.ids.map((driverId) => [
          driverId,
          { profile: 'batch-training' },
        ])),
      },
      scenario: { participants: batch.ids },
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
        nearbyCars: { enabled: false },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireDegradation: { enabled: false },
        },
      },
    });

    const result = env.step(Object.fromEntries(batch.ids.map((driverId) => [
      driverId,
      { steering: 0.1, throttle: 0.3, brake: 0 },
    ])));
    const stats = snapshotTrackQueryStats(result.state.snapshot.track);

    expect(result.state.snapshot.track.queryIndex).toBeTruthy();
    expect(stats.nearestQueries).toBeGreaterThan(0);
    expect(stats.nearestFallbacks).toBe(0);
    env.destroy();
  });

  test('ray track distances use the same result on analytic straight-track cases', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const base = pointAt(snapshot.track, 600);
    const position = offsetTrackPoint(base, 0);
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading,
      progress: base.distance,
      signedOffset: 0,
    };

    const ray = buildRaySensors(car, snapshot, {
      anglesDegrees: [90],
      lengthMeters: 120,
    })[0];
    const expectedDistance = marchTrackEdgeDistance(snapshot.track, car, 90, 120);

    expect(ray.track).toMatchObject({
      hit: true,
      kind: 'exit',
    });
    expect(ray.track.distanceMeters).toBeCloseTo(expectedDistance, 3);
  });

  test('ray sensors reuse the origin track-state lookup across default rays', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const base = pointAt(snapshot.track, 600);
    const position = offsetTrackPoint(base, 0);
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading,
      progress: base.distance,
      signedOffset: 0,
    };
    let sampleReads = 0;
    const samples = new Proxy(snapshot.track.samples, {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property))) sampleReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    buildRaySensors(car, {
      ...snapshot,
      track: { ...snapshot.track, samples },
    }, {
      detectTrack: true,
      detectCars: false,
      anglesDegrees: [90, 90, 90, 90],
      lengthMeters: 120,
    });

    expect(sampleReads).toBeLessThan(900);
  });

  test('off-track ray pointing back to the circuit reports track entry distance', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const outsideByMeters = 12;
    let selected = null;

    for (let distanceAlong = 600; distanceAlong < snapshot.track.length && !selected; distanceAlong += 180) {
      const base = pointAt(snapshot.track, distanceAlong);
      const position = offsetTrackPoint(base, snapshot.track.width / 2 + metersToSimUnits(outsideByMeters));
      const car = {
        ...snapshot.cars[0],
        x: position.x,
        y: position.y,
        heading: base.heading,
        progress: base.distance,
        signedOffset: snapshot.track.width / 2 + metersToSimUnits(outsideByMeters),
        surface: 'gravel',
      };
      const towardTrack = buildRaySensors(car, snapshot, {
        anglesDegrees: [-90],
        lengthMeters: 80,
      })[0];
      const awayFromTrack = buildRaySensors(car, snapshot, {
        anglesDegrees: [90],
        lengthMeters: 20,
      })[0];
      if (towardTrack.track.hit && !awayFromTrack.track.hit) selected = { towardTrack, awayFromTrack };
    }

    expect(selected).toBeTruthy();

    expect(selected.towardTrack.track).toMatchObject({
      hit: true,
      kind: 'entry',
    });
    expect(selected.towardTrack.track.distanceMeters).toBeCloseTo(outsideByMeters, 0);
    expect(selected.awayFromTrack.track).toEqual({
      hit: false,
      distanceMeters: 20,
      kind: null,
    });
  });

  test('off-track batch-training rays report legal-surface re-entry from the active driver contract', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const base = pointAt(snapshot.track, 6240);
    const signedOffset = -(snapshot.track.width / 2 + metersToSimUnits(8));
    const position = offsetTrackPoint(base, signedOffset);

    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading - Math.PI / 2,
      progress: base.distance,
      signedOffset,
      interaction: { profile: 'batch-training' },
    };

    const ray = buildRaySensors(car, snapshot, {
      anglesDegrees: [100],
      lengthMeters: 80,
      channels: ['kerb'],
    })[0];

    expect(ray.kerb).toMatchObject({
      hit: true,
      surface: 'kerb',
    });
    expect(ray.kerb.distanceMeters).toBeGreaterThan(0);
    expect(ray.kerb.distanceMeters).toBeLessThan(80);
  });

  test('ray track distances treat pit lane asphalt as legal road', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const pitLane = snapshot.track.pitLane;
    const position = {
      x: (pitLane.mainLane.start.x + pitLane.mainLane.end.x) / 2,
      y: (pitLane.mainLane.start.y + pitLane.mainLane.end.y) / 2,
    };
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: pitLane.mainLane.heading,
      progress: pitLane.entry.trackDistance,
      signedOffset: 0,
      surface: 'pit-lane',
    };
    const right = {
      x: -Math.sin(pitLane.mainLane.heading),
      y: Math.cos(pitLane.mainLane.heading),
    };
    const rayAwayFromBoxes = right.x * pitLane.serviceNormal.x + right.y * pitLane.serviceNormal.y > 0
      ? -90
      : 90;

    const sideRay = buildRaySensors(car, snapshot, {
      anglesDegrees: [rayAwayFromBoxes],
      lengthMeters: 80,
    })[0];
    const forwardRay = buildRaySensors(car, snapshot, {
      anglesDegrees: [0],
      lengthMeters: 80,
    })[0];

    expect(sideRay.track).toMatchObject({
      hit: true,
      kind: 'exit',
    });
    expect(sideRay.track.distanceMeters).toBeGreaterThan(simUnitsToMeters(pitLane.width / 2 - 2));
    expect(sideRay.track.distanceMeters).toBeLessThan(simUnitsToMeters(pitLane.width / 2 + pitLane.workingLane.width));
    expect(forwardRay.track).toEqual({
      hit: false,
      distanceMeters: 80,
      kind: null,
    });
  });

  test('ray sensors originate from the car center', () => {
    const car = {
      id: CONTROLLED_DRIVER_ID,
      x: 1000,
      y: 1200,
      heading: Math.PI / 3,
    };

    expect(getCarRayOrigin(car)).toEqual({
      x: car.x,
      y: car.y,
    });
  });

  test('default ray set stays small and includes rear awareness', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const rays = buildRaySensors(snapshot.cars[0], snapshot);
    const angles = rays.map((ray) => ray.angleDegrees);

    expect(rays).toHaveLength(8);
    expect(angles).toEqual([-135, -60, -20, 0, 20, 60, 135, 180]);
  });

  test('disabled ray options return no ray sensors from the helper', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();

    expect(buildRaySensors(snapshot.cars[0], snapshot, {
      enabled: false,
      anglesDegrees: [0],
      lengthMeters: 80,
    })).toEqual([]);
  });

  test('ray car hits require the ray to intersect the other car footprint', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 2),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const car = {
      ...snapshot.cars[0],
      x: 1000,
      y: 1000,
      heading: 0,
    };
    const hitCar = {
      ...snapshot.cars[1],
      id: 'direct-hit',
      x: 1000 + metersToSimUnits(30),
      y: 1000,
      heading: 0,
      speedKph: 80,
    };
    const nearMissCar = {
      ...snapshot.cars[1],
      id: 'near-miss',
      x: 1000 + metersToSimUnits(18),
      y: 1000 + VEHICLE_LIMITS.carWidth * 2.2,
      heading: 0,
      speedKph: 80,
    };
    const transparentSpaceCar = {
      ...snapshot.cars[1],
      id: 'transparent-space',
      x: 1000 + metersToSimUnits(18),
      y: 1000 + VEHICLE_GEOMETRY.bodyWidth / 2 + metersToSimUnits(0.2),
      heading: 0,
      speedKph: 80,
    };

    const hitRay = buildRaySensors(car, {
      ...snapshot,
      cars: [car, hitCar],
    }, {
      anglesDegrees: [0],
      lengthMeters: 80,
    })[0];
    const missRay = buildRaySensors(car, {
      ...snapshot,
      cars: [car, nearMissCar],
    }, {
      anglesDegrees: [0],
      lengthMeters: 80,
    })[0];
    const transparentSpaceRay = buildRaySensors(car, {
      ...snapshot,
      cars: [car, transparentSpaceCar],
    }, {
      anglesDegrees: [0],
      lengthMeters: 80,
    })[0];

    expect(hitRay.car).toMatchObject({
      hit: true,
      driverId: 'direct-hit',
    });
    expect(hitRay.car.distanceMeters).toBeGreaterThan(10);
    expect(hitRay.car.distanceMeters).toBeLessThan(30);
    expect(missRay.car).toEqual(expectCarRayMiss(80));
    expect(transparentSpaceRay.car).toEqual(expectCarRayMiss(80));
  });

  test('steps a controlled car manually and returns gym-style result', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      track: TRACK,
      totalLaps: 2,
      frameSkip: 2,
    });

    const initial = env.reset();
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(result.info.step).toBe(1);
    expect(result.info.seed).toBe(71);
    expect(result.info.trackSeed).toBe(2026);
    expect(result.state.snapshot.time).toBeGreaterThan(initial.state.snapshot.time);
    expect(result.reward).toBeNull();
    expect(result.done).toBe(result.terminated || result.truncated);
  });

  test('environment frame-skip consumes step events without full snapshot serialization per substep', () => {
    const options = resolveEnvironmentOptions({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed: 71,
      track: TRACK,
      frameSkip: 4,
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });
    const sim = createRaceSimulation(options);
    const originalSnapshot = sim.snapshot.bind(sim);
    const snapshot = vi.fn(() => originalSnapshot());
    sim.snapshot = snapshot;

    const runtime = createEnvironmentRuntime({
      getSimulation: () => sim,
      getOptions: () => options,
      afterReset() {},
      afterStep() {},
    });

    runtime.step({
      [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  test('reward callbacks keep the lean training snapshot path for vector-only no-state runs', () => {
    const options = resolveEnvironmentOptions({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed: 71,
      track: TRACK,
      frameSkip: 2,
      observation: {
        profile: 'physical-driver',
        output: 'vector',
        includeSchema: false,
      },
      result: {
        stateOutput: 'none',
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      reward() {
        return 1;
      },
    });
    const sim = createRaceSimulation(options);
    const originalSnapshot = sim.snapshot.bind(sim);
    const originalObservation = sim.snapshotObservation.bind(sim);
    const originalTraining = sim.snapshotTraining.bind(sim);
    sim.snapshot = vi.fn(() => originalSnapshot());
    sim.snapshotObservation = vi.fn(() => originalObservation());
    sim.snapshotTraining = vi.fn(() => originalTraining());

    const runtime = createEnvironmentRuntime({
      getSimulation: () => sim,
      getOptions: () => options,
      afterReset() {},
      afterStep() {},
    });

    runtime.step({
      [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(sim.snapshotTraining).toHaveBeenCalled();
    expect(sim.snapshot).not.toHaveBeenCalled();
  });

  test('custom reward still receives previous and current full snapshots', () => {
    const previousTimes = [];
    const currentTimes = [];
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      seed: 71,
      track: TRACK,
      frameSkip: 3,
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      reward({ previous, state }) {
        previousTimes.push(previous?.time);
        currentTimes.push(state.snapshot.time);
        return 1;
      },
    });

    const initial = env.reset();
    previousTimes.length = 0;
    currentTimes.length = 0;
    const result = env.step({
      [CONTROLLED_DRIVER_ID]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(result.reward).toEqual({ [CONTROLLED_DRIVER_ID]: 1 });
    expect(previousTimes).toEqual([initial.state.snapshot.time]);
    expect(currentTimes[0]).toBe(result.state.snapshot.time);
    expect(currentTimes[0]).toBeGreaterThan(previousTimes[0]);
  });

  test('controlled drivers start with no automatic pit request and can request a pit by action', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      totalLaps: 4,
      frameSkip: 1,
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: true },
          tireStrategy: { enabled: true },
        },
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });

    const initial = env.reset();
    expect(initial.observation[driverId].object.self.pitIntent).toBe(0);
    expect(initial.observation[driverId].object.self).toMatchObject({
      inPitLane: false,
      pitLanePart: null,
      pitBoxId: null,
      pitStopStatus: 'pending',
      pitStopPhase: null,
      pitStopServiceRemainingSeconds: 0,
      pitStopPenaltyServiceRemainingSeconds: 0,
      pitStopsCompleted: 0,
    });
    expect(initial.state.snapshot.cars.find((car) => car.id === driverId).pitStop.intent).toBe(0);

    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0, pitIntent: 2, pitCompound: 'H' },
    });

    expect(result.observation[driverId].object.self.pitIntent).toBe(2);
    expect(result.observation[driverId].object.self.pitTargetCompound).toBe('H');
    expect(result.observation[driverId].object.race).toMatchObject({
      pitLaneOpen: true,
      redFlag: false,
    });
    expect(result.state.snapshot.cars.find((car) => car.id === driverId).pitStop).toMatchObject({
      intent: 2,
      targetTire: 'H',
    });
  });

  test('shared expert runtime disables tire-threshold pit automation for controlled drivers', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const sim = {
      setAutomaticPitIntentEnabled: vi.fn(),
      setPitIntent: vi.fn(),
    };

    createEnvironmentRuntime({
      getSimulation: () => sim,
      getOptions: () => ({ controlledDrivers: [driverId] }),
    });

    expect(sim.setAutomaticPitIntentEnabled).toHaveBeenCalledWith(driverId, false);
    expect(sim.setPitIntent).toHaveBeenCalledWith(driverId, 0);
  });

  test('reports unavailable pit intent actions through the environment action policy', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      actionPolicy: 'report',
      seed: 71,
      track: TRACK,
      totalLaps: 4,
      frameSkip: 1,
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
        },
      },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });

    env.reset();
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0, pitIntent: 2 },
    });

    expect(result.info.actionErrors).toEqual([
      `Pit intent could not be applied for controlled driver: ${driverId}`,
    ]);
  });

  test('accepts no-op pit intent actions when pit stops are unavailable', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      totalLaps: 4,
      frameSkip: 1,
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });

    env.reset();
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0, pitIntent: 0 },
    });

    expect(result.info.actionErrors).toEqual([]);
    expect(result.observation[driverId].object.self.pitIntent).toBe(0);
  });

  test('physical-driver observations expose applied controls from the active driver policy', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      actionPolicy: 'report',
      seed: 71,
      track: TRACK,
      totalLaps: 4,
      frameSkip: 1,
      physicsMode: 'simulator',
      observation: { profile: 'physical-driver' },
      rules: { standingStart: false },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
    });

    env.reset();
    const aiResult = env.step({});
    expect(aiResult.observation[driverId].object.self.appliedControls).toEqual(expect.objectContaining({
      steering: expect.any(Number),
      steeringRadians: expect.any(Number),
      throttle: expect.any(Number),
      brake: expect.any(Number),
    }));

    const manualResult = env.step({
      [driverId]: { steering: 0.25, throttle: 0.7, brake: 0 },
    });
    expect(manualResult.observation[driverId].object.self.appliedControls).toEqual(expect.objectContaining({
      steering: expect.closeTo(0.25, 5),
      throttle: expect.closeTo(0.7, 5),
      brake: 0,
    }));
  });

  test('runs an optional reward callback per controlled driver', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      track: TRACK,
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

  test('reward callbacks receive neutral metrics and per-driver episode state', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const contexts = [];
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      reward(context) {
        contexts.push(context);
        return context.metrics.legalProgressDeltaMeters + (context.episode.terminated ? 1000 : 0);
      },
    });

    env.reset();
    contexts.length = 0;
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.at(-1)).toMatchObject({
      driverId,
      metrics: result.metrics[driverId],
      episode: result.info.drivers[driverId],
    });
    expect(result.reward?.[driverId]).toBeCloseTo(result.metrics[driverId].legalProgressDeltaMeters);
  });

  test('reward callbacks can branch on destroyed metrics and episode termination', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
      reward({ metrics, episode }) {
        if (metrics.destroyed) return -200;
        if (metrics.offTrack) return -12;
        if (episode.terminated) return -50;
        return metrics.legalProgressDeltaMeters;
      },
    });

    const track = env.getState({ output: 'minimal' }).snapshot.track;
    const farOutsideMeters = simUnitsToMeters(
      track.width / 2 +
      track.kerbWidth +
      track.gravelWidth +
      track.runoffWidth +
      metersToSimUnits(260),
    );
    env.resetDrivers({
      [driverId]: {
        distanceMeters: 600,
        offsetMeters: farOutsideMeters,
        speedKph: 80,
      },
    });
    const result = env.step({
      [driverId]: { steering: 0, throttle: 0.5, brake: 0 },
    });

    expect(result.metrics[driverId].destroyed).toBe(true);
    expect(result.info.drivers[driverId].terminated).toBe(true);
    expect(result.reward).toEqual({ [driverId]: -200 });
  });

  test('reward callbacks receive per-driver metrics in multi-driver runs', () => {
    const controlledDrivers = ENVIRONMENT_TEST_DRIVERS.slice(0, 2).map((driver) => driver.id);
    const seen = [];
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers,
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
      sensors: {
        rays: { enabled: false },
        nearbyCars: { enabled: false },
      },
      reward(context) {
        seen.push({
          driverId: context.driverId,
          metrics: context.metrics,
          episode: context.episode,
        });
        return context.metrics.legalProgressDeltaMeters;
      },
    });

    const result = env.step(Object.fromEntries(controlledDrivers.map((driverId, index) => [
      driverId,
      { steering: index === 0 ? 0.05 : -0.05, throttle: 0.6, brake: 0 },
    ])));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      driverId: controlledDrivers[0],
      metrics: result.metrics[controlledDrivers[0]],
      episode: result.info.drivers[controlledDrivers[0]],
    });
    expect(seen[1]).toMatchObject({
      driverId: controlledDrivers[1],
      metrics: result.metrics[controlledDrivers[1]],
      episode: result.info.drivers[controlledDrivers[1]],
    });
  });

  test('exposes action and observation specs without choosing an ML framework', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      track: TRACK,
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
          pitIntent: { values: [0, 1, 2], unit: 'request', optional: true },
          pitCompound: { values: ['S', 'M', 'H'], unit: 'compound', optional: true },
        },
      },
    });

    expect(env.getObservationSpec()).toMatchObject({
      version: 2,
      controlledDrivers: [driverId],
      object: {
        self: expect.arrayContaining([
          { name: 'speedKph', unit: 'kph' },
          { name: 'trackOffsetMeters', unit: 'm' },
          { name: 'trackHeadingErrorRadians', unit: 'rad' },
          { name: 'onTrack', unit: 'boolean' },
          { name: 'inPitLane', unit: 'boolean' },
          { name: 'pitLanePart', unit: 'nullable:label' },
          { name: 'pitBoxId', unit: 'nullable:id' },
          { name: 'pitIntent', unit: '0:none|1:if-free|2:committed' },
          { name: 'pitTargetCompound', unit: 'nullable:compound' },
          { name: 'pitStopStatus', unit: 'nullable:label' },
          { name: 'pitStopPhase', unit: 'nullable:label' },
          { name: 'pitStopServiceRemainingSeconds', unit: 'nullable:seconds' },
          { name: 'pitStopPenaltyServiceRemainingSeconds', unit: 'nullable:seconds' },
          { name: 'pitStopsCompleted', unit: 'count' },
        ]),
        race: expect.arrayContaining([
          { name: 'pitLaneOpen', unit: 'boolean' },
          { name: 'redFlag', unit: 'boolean' },
        ]),
        rays: {
          enabled: true,
          anglesDegrees: [-90, 0, 90],
          lengthMeters: 80,
          precision: 'driver',
          track: {
            distanceMeters: { unit: 'm', noHitValue: 80 },
            hit: { unit: 'boolean' },
            kind: { values: ['exit', 'entry', null] },
          },
          car: {
            distanceMeters: { unit: 'm', noHitValue: 80 },
            hit: { unit: 'boolean' },
            driverId: { nullable: true },
            targetId: { nullable: true },
            targetType: { values: ['car', 'replayGhost', null] },
            relativeSpeedKph: { unit: 'kph' },
          },
        },
        nearbyCars: {
          enabled: true,
          maxCars: 4,
          radiusMeters: 120,
        },
        track: {
          lookaheadMeters: expect.any(Array),
        },
      },
      vector: {
        schema: expect.arrayContaining([
          { name: 'self.speedKph', unit: 'kph', scale: 'fixed:400' },
          { name: 'race.redFlag', scale: 'boolean' },
          { name: 'rays[0].track.distanceRatio', scale: '0..1' },
          { name: 'nearbyCars[0].present', scale: 'boolean' },
        ]),
      },
    });
  });

  test('records neutral gym-style rollout transitions without training policy assumptions', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
    });
    const recorder = createRolloutRecorder();
    const initial = env.reset();
    const action = { [driverId]: { steering: 0, throttle: 1, brake: 0 } };
    const next = env.step(action);

    const transition = recorder.recordStep(initial, action, next);

    expect(transition).toEqual({
      observation: initial.observation,
      action,
      reward: next.reward,
      nextObservation: next.observation,
      terminated: next.terminated,
      truncated: next.truncated,
      info: next.info,
    });
    expect(recorder.toJSON()).toEqual([transition]);
  });

  test('runs deterministic environment evaluation cases with neutral quality metrics', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const cases = [{
      name: 'recovery-smoke',
      seed: 71,
      trackSeed: 2026,
      maxSteps: 6,
      scenario: {
        participants: 'controlled-only',
        preset: 'off-track-recovery',
      },
    }];

    const report = runEnvironmentEvaluation({
      baseOptions: {
        drivers: ENVIRONMENT_TEST_DRIVERS,
        entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
        controlledDrivers: [driverId],
        track: TRACK,
        rules: { standingStart: false },
      },
      cases,
      policy() {
        return { steering: 0, throttle: 1, brake: 0 };
      },
    });

    expect(report.cases).toHaveLength(1);
    expect(report.cases[0]).toMatchObject({
      name: 'recovery-smoke',
      seed: 71,
      trackSeed: 2026,
      steps: expect.any(Number),
      metrics: {
        [driverId]: {
          distanceMeters: expect.any(Number),
          offTrackSteps: expect.any(Number),
          contactCount: expect.any(Number),
          recoverySuccess: expect.any(Boolean),
          passCount: expect.any(Number),
          lapTimeSeconds: null,
        },
      },
    });
    expect(report.cases[0].metrics[driverId].lapProgressMeters).toBeGreaterThan(0);
  });

  test('runs batched driver controllers with cached specs and action repeat', async () => {
    const controlledDrivers = ENVIRONMENT_TEST_DRIVERS.slice(0, 2).map((driver) => driver.id);
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers,
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
      observation: {
        profile: 'physical-driver',
        output: 'full',
        includeSchema: false,
        vectorType: 'float32',
      },
      result: { stateOutput: 'none' },
    });
    const getActionSpec = vi.spyOn(env, 'getActionSpec');
    const getObservationSpec = vi.spyOn(env, 'getObservationSpec');
    const decideBatch = vi.fn(async (context) => {
      expect(context.controlledDrivers).toEqual(controlledDrivers);
      expect(context.orderedObservations).toHaveLength(2);
      expect(context.orderedObservations[0].driverId).toBe(controlledDrivers[0]);
      expect(context.orderedObservations[0].observation.vector).toBeInstanceOf(Float32Array);
      expect(context.actionSpec.controlledDrivers).toEqual(controlledDrivers);
      return Object.fromEntries(controlledDrivers.map((driverId) => [
        driverId,
        { steering: 2, throttle: 2, brake: -1 },
      ]));
    });
    const onStep = vi.fn();
    const loop = createPaddockDriverControllerLoop({
      runtime: env,
      controller: { decideBatch, onStep },
      actionRepeat: 4,
    });

    await loop.reset();
    const result = await loop.step();

    expect(decideBatch).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledTimes(4);
    expect(result.info.step).toBe(4);
    expect(getActionSpec).toHaveBeenCalledTimes(1);
    expect(getObservationSpec).toHaveBeenCalledTimes(1);
    expect(result.observation[controlledDrivers[0]].object.self.appliedControls).toMatchObject({
      steering: 1,
      throttle: 1,
      brake: 0,
    });
  });

  test('driver controller loop resets only selected driver state through resetDrivers', async () => {
    const controlledDrivers = ENVIRONMENT_TEST_DRIVERS.slice(0, 2).map((driver) => driver.id);
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers,
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
      result: { stateOutput: 'none' },
    });
    const reset = vi.fn();
    const loop = createPaddockDriverControllerLoop({
      runtime: env,
      controller: {
        reset,
        decideBatch(context) {
          return Object.fromEntries(context.controlledDrivers.map((driverId) => [
            driverId,
            { steering: 0, throttle: 0.5, brake: 0 },
          ]));
        },
      },
      actionRepeat: 2,
    });

    await loop.reset();
    await loop.stepFrame();
    const result = await loop.resetDrivers({
      [controlledDrivers[1]]: { distanceMeters: 500, offsetMeters: 0, speedKph: 80 },
    });

    expect(result.info.drivers[controlledDrivers[0]].episodeId).toBe(0);
    expect(result.info.drivers[controlledDrivers[1]].episodeId).toBe(1);
    expect(reset).toHaveBeenLastCalledWith(expect.objectContaining({
      resetDriverIds: [controlledDrivers[1]],
      controlledDrivers,
    }));
  });

  test('exposes a JSON-serializable worker protocol wrapper for external bridges', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      track: TRACK,
      rules: { standingStart: false },
    });
    const protocol = createEnvironmentWorkerProtocol(env);

    const reset = protocol.handle({ id: 'a', type: 'reset' });
    const step = protocol.handle({
      id: 'b',
      type: 'step',
      actions: { [driverId]: { steering: 0, throttle: 1, brake: 0 } },
    });
    const resetDrivers = protocol.handle({
      id: 'driver-reset',
      type: 'resetDrivers',
      placements: { [driverId]: { distanceMeters: 1000, offsetMeters: 0, speedKph: 60 } },
      resultOptions: { stateOutput: 'none' },
    });
    const spec = protocol.handle({ id: 'c', type: 'getObservationSpec' });
    const unknown = protocol.handle({ id: 'd', type: 'train' });

    expect(reset).toMatchObject({ id: 'a', ok: true, type: 'reset:result' });
    expect(step).toMatchObject({ id: 'b', ok: true, type: 'step:result' });
    expect(resetDrivers).toMatchObject({ id: 'driver-reset', ok: true, type: 'resetDrivers:result' });
    expect(resetDrivers.result.state).toBeNull();
    expect(spec.result).toMatchObject({ version: 2 });
    expect(unknown).toMatchObject({
      id: 'd',
      ok: false,
      type: 'error',
      error: expect.stringContaining('Unsupported PaddockJS environment worker message type'),
    });
    expect(() => JSON.stringify(step)).not.toThrow();
  });

  test('starter progress reward favors forward progress and on-track speed', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const reward = createProgressReward({
      weights: {
        progress: 1,
        speed: 0.01,
        steering: 0,
        brake: 0,
      },
    });

    const value = reward({
      driverId,
      previous: {
        cars: [{ id: driverId, distanceMeters: 100 }],
      },
      current: {
        object: {
          self: {
            speedKph: 120,
            onTrack: true,
          },
        },
      },
      action: { steering: 0.4, throttle: 1, brake: 0 },
      events: [],
      state: {
        snapshot: {
          cars: [{ id: driverId, distanceMeters: 108 }],
        },
      },
    });

    expect(value).toBeCloseTo(9.2);
  });

  test('starter progress reward penalizes off-track collisions and harsh controls', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const reward = createProgressReward({
      weights: {
        progress: 1,
        speed: 0,
        offTrack: -3,
        collision: -8,
        steering: -0.5,
        brake: -0.25,
      },
    });

    const value = reward({
      driverId,
      previous: {
        cars: [{ id: driverId, distanceMeters: 100 }],
      },
      current: {
        object: {
          self: {
            speedKph: 80,
            onTrack: false,
          },
        },
      },
      action: { steering: -0.8, throttle: 0.2, brake: 1 },
      events: [{ type: 'collision', driverId }],
      state: {
        snapshot: {
          cars: [{ id: driverId, distanceMeters: 101 }],
        },
      },
    });

    expect(value).toBeCloseTo(-10.65);
  });
});
