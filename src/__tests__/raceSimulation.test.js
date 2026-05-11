import { describe, expect, test } from 'vitest';
import { slowTest } from './testModes.js';
import { PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { decideDriverControls, planRacingLine } from '../simulation/driverController.js';
import { FIXED_STEP, createRaceSimulation } from '../simulation/raceSimulation.js';
import { buildTrackModel, nearestTrackState, offsetTrackPoint, pointAt, TRACK } from '../simulation/trackModel.js';
import {
  REAL_F1_CAR_LENGTH_METERS,
  REAL_F1_CAR_WIDTH_METERS,
  SIM_UNITS_PER_METER,
  TARGET_F1_TOP_SPEED_KPH,
  VISUAL_CAR_LENGTH_METERS,
  VISUAL_CAR_WIDTH_METERS,
  kphToSimSpeed,
  metersToSimUnits,
  simSpeedToKph,
  simUnitsToMeters,
} from '../simulation/units.js';
import { getCarCorners, integrateVehiclePhysics, tirePerformanceFactor, VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';

const HEAVY_INTEGRATION_TEST_TIMEOUT_MS = 15000;

const drivers = [
  { id: 'budget', code: 'BUD', name: 'Budget Buddy', color: '#ff3860', pace: 0.94, racecraft: 0.74 },
  { id: 'noir', code: 'NOI', name: 'Neural Noir', color: '#ff9f1c', pace: 0.98, racecraft: 0.8 },
  { id: 'vinyl', code: 'HOL', name: 'HoloVinyl', color: '#06d6a0', pace: 1.02, racecraft: 0.7 },
  { id: 'clip', code: 'CLP', name: 'ClipClop', color: '#118ab2', pace: 1.05, racecraft: 0.88 },
];

function run(sim, seconds, dt = 1 / 60) {
  let contactCount = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    sim.step(dt);
    contactCount += sim.snapshot().events.filter((event) => event.type === 'contact').length;
  }
  return contactCount;
}

function simulationSignature(sim) {
  const snapshot = sim.snapshot();
  return {
    time: Number(snapshot.time.toFixed(6)),
    raceControl: snapshot.raceControl.mode,
    cars: snapshot.cars.map((car) => ({
      id: car.id,
      rank: car.rank,
      x: Number(car.x.toFixed(6)),
      y: Number(car.y.toFixed(6)),
      heading: Number(car.heading.toFixed(6)),
      speed: Number(car.speed.toFixed(6)),
      raceDistance: Number(car.raceDistance.toFixed(6)),
      progress: Number(car.progress.toFixed(6)),
      lap: car.lap,
      tireEnergy: Number(car.tireEnergy.toFixed(6)),
      pitIntent: car.pitIntent,
      pitStopStatus: car.pitStop?.status ?? null,
      drsActive: car.drsActive,
      drsEligible: car.drsEligible,
    })),
    events: snapshot.events.map((event) => ({
      type: event.type,
      driverId: event.driverId ?? null,
      penaltyType: event.penaltyType ?? null,
    })),
  };
}

function trackSignature(track) {
  return track.centerlineControls.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|');
}

function placeCarAtDistance(sim, id, distance, speedKph = 80, offset = 0) {
  const track = sim.snapshot().track;
  const point = pointAt(track, distance);
  const positioned = offsetTrackPoint(point, offset);
  sim.setCarState(id, {
    x: positioned.x,
    y: positioned.y,
    heading: point.heading,
    speed: kphToSimSpeed(speedKph),
    raceDistance: distance,
    progress: point.distance,
  });
}

function requestPitForRouteTest(sim, id) {
  sim.setPitIntent(id, 2);
}

function findMainTrackPointAwayFromPitLane(track, preferredDistance) {
  for (let scan = 0; scan < track.length; scan += 240) {
    const distance = (preferredDistance + scan) % track.length;
    const point = pointAt(track, distance);
    const probeOffsets = [
      0,
      track.width / 2 + 84,
      track.width / 2 + 120,
      track.width / 2 - VEHICLE_LIMITS.carWidth / 2 + 2,
    ];
    const overlapsPitLane = probeOffsets.some((offset) => (
      nearestTrackState(track, offsetTrackPoint(point, offset), point.distance).inPitLane
    ));
    if (!overlapsPitLane) return point;
  }

  throw new Error('Could not find a main-track point away from pit-lane geometry');
}

function moveCarBodyToDistance(sim, id, distance, offset = 0) {
  const track = sim.snapshot().track;
  const car = sim.cars.find((item) => item.id === id);
  const point = pointAt(track, distance);
  const positioned = offsetTrackPoint(point, offset);
  Object.assign(car, {
    x: positioned.x,
    y: positioned.y,
    heading: point.heading,
  });
}

function polygonsOverlap(a, b) {
  const axes = [a, b].flatMap((corners) => [
    normalize({ x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y }),
    normalize({ x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y }),
  ]);

  return axes.every((axis) => {
    const first = project(a, axis);
    const second = project(b, axis);
    return Math.min(first.max, second.max) - Math.max(first.min, second.min) > 0;
  });
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function project(points, axis) {
  const values = points.map((point) => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function angleDelta(first, second) {
  return Math.atan2(Math.sin(first - second), Math.cos(first - second));
}

function pitLaneLateralOffset(pitLane, point) {
  return (point.x - pitLane.mainLane.start.x) * pitLane.serviceNormal.x +
    (point.y - pitLane.mainLane.start.y) * pitLane.serviceNormal.y;
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

describe('vehicle physics race simulation', () => {
  test('isolated-training participants remain physics cars but do not collide with each other', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers: drivers.slice(0, 2),
      totalLaps: 2,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      participantInteractions: {
        drivers: {
          budget: { profile: 'isolated-training' },
          noir: { profile: 'isolated-training' },
        },
      },
    });
    const trackPoint = pointAt(sim.track, metersToSimUnits(600));
    const firstPosition = offsetTrackPoint(trackPoint, -2);
    const secondPosition = offsetTrackPoint(trackPoint, 2);
    sim.setCarState('budget', {
      x: firstPosition.x,
      y: firstPosition.y,
      previousX: firstPosition.x,
      previousY: firstPosition.y,
      heading: trackPoint.heading,
      previousHeading: trackPoint.heading,
      progress: trackPoint.distance,
      raceDistance: trackPoint.distance,
      speed: kphToSimSpeed(80),
    });
    sim.setCarState('noir', {
      x: secondPosition.x,
      y: secondPosition.y,
      previousX: secondPosition.x,
      previousY: secondPosition.y,
      heading: trackPoint.heading,
      previousHeading: trackPoint.heading,
      progress: trackPoint.distance,
      raceDistance: trackPoint.distance,
      speed: kphToSimSpeed(80),
    });
    sim.setCarControls('budget', { steering: 0, throttle: 1, brake: 0 });
    sim.setCarControls('noir', { steering: 0, throttle: 1, brake: 0 });

    sim.step(FIXED_STEP);
    const snapshot = sim.snapshot();

    expect(snapshot.events.some((event) => event.type === 'contact')).toBe(false);
    expect(snapshot.cars.map((car) => car.id).sort()).toEqual(['budget', 'noir']);
    expect(snapshot.cars.find((car) => car.id === 'budget')).toEqual(expect.objectContaining({
      positionSource: 'integrated-vehicle',
      interaction: expect.objectContaining({
        profile: 'isolated-training',
        collidable: false,
        affectsRaceOrder: true,
      }),
    }));
    expect(snapshot.cars.find((car) => car.id === 'noir')).toEqual(expect.objectContaining({
      positionSource: 'integrated-vehicle',
      interaction: expect.objectContaining({ collidable: false }),
    }));
    expect(snapshot.cars.every((car) => Number.isFinite(car.rank))).toBe(true);
  });

  test('participants can opt out of race order without leaving snapshot.cars', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers: drivers.slice(0, 2),
      totalLaps: 1,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      participantInteractions: {
        drivers: {
          noir: { profile: 'time-trial-overlay' },
        },
      },
    });

    sim.setCarState('noir', { raceDistance: sim.finishDistance + 100, progress: 100 });
    sim.setCarState('budget', { raceDistance: sim.finishDistance + 50, progress: 50 });

    const snapshot = sim.snapshot();
    expect(snapshot.cars.map((car) => car.id).sort()).toEqual(['budget', 'noir']);
    expect(snapshot.cars.find((car) => car.id === 'noir')).toEqual(expect.objectContaining({
      interaction: expect.objectContaining({ affectsRaceOrder: false }),
      rank: null,
      classifiedRank: null,
    }));
    expect(snapshot.raceControl.classification.map((entry) => entry.id)).toEqual(['budget']);
  });

  test('replay ghosts interpolate independently from physics cars', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers: drivers.slice(0, 1),
      totalLaps: 1,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
      replayGhosts: [
        {
          id: 'best-lap',
          label: 'Best Lap',
          color: '#00ff84',
          opacity: 0.35,
          visible: true,
          trajectory: [
            { timeSeconds: 0, x: 100, y: 200, headingRadians: 0, speedKph: 100, progressMeters: 0 },
            { timeSeconds: 1, x: 200, y: 300, headingRadians: Math.PI / 2, speedKph: 150, progressMeters: 50 },
          ],
        },
      ],
    });

    for (let index = 0; index < 30; index += 1) sim.step(FIXED_STEP);
    const snapshot = sim.snapshot();

    expect(snapshot.cars.map((car) => car.id)).not.toContain('best-lap');
    expect(snapshot.replayGhosts).toHaveLength(1);
    expect(snapshot.replayGhosts[0]).toEqual(expect.objectContaining({
      id: 'best-lap',
      label: 'Best Lap',
      color: '#00ff84',
      opacity: 0.35,
      visible: true,
      x: expect.closeTo(150, 4),
      y: expect.closeTo(250, 4),
      heading: expect.closeTo(Math.PI / 4, 4),
      speedKph: expect.closeTo(125, 4),
      progressMeters: expect.closeTo(25, 4),
    }));
    expect(snapshot.events.some((event) => event.carId === 'best-lap' || event.otherCarId === 'best-lap')).toBe(false);
  });

  test('full public snapshots keep the representative race, car, timing, pit, and steward contract', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers,
      totalLaps: 4,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
    });
    run(sim, 1);

    const snapshot = sim.snapshot();
    const car = snapshot.cars[0];

    expect(snapshot).toMatchObject({
      time: expect.any(Number),
      world: expect.any(Object),
      track: expect.any(Object),
      totalLaps: 4,
      raceControl: {
        mode: 'green',
        redFlag: false,
        pitLaneOpen: true,
        pitLaneStatus: expect.any(Object),
        finished: false,
        finishedAt: null,
        winner: null,
        classification: [],
        start: expect.any(Object),
      },
      pitLaneStatus: {
        open: true,
        color: 'green',
        reason: 'open',
      },
      safetyCar: expect.any(Object),
      rules: expect.any(Object),
      events: expect.any(Array),
      penalties: expect.any(Array),
      cars: expect.any(Array),
    });
    expect(car).toEqual(expect.objectContaining({
      id: expect.any(String),
      code: expect.any(String),
      timingCode: expect.any(String),
      driverNumber: expect.any(Number),
      team: null,
      setup: expect.objectContaining({
        vehicleId: null,
        vehicleName: null,
        maxSpeedKph: expect.any(Number),
        powerUnitKn: expect.any(Number),
        brakeSystemKn: expect.any(Number),
        massKg: expect.any(Number),
      }),
      rank: expect.any(Number),
      status: expect.any(String),
      raceStatus: expect.any(String),
      previousX: expect.any(Number),
      previousY: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
      previousHeading: expect.any(Number),
      heading: expect.any(Number),
      speed: expect.any(Number),
      speedKph: expect.any(Number),
      lapTelemetry: expect.objectContaining({
        currentLap: expect.any(Number),
        currentSector: expect.any(Number),
        currentSectors: expect.any(Array),
        liveSectors: expect.any(Array),
        sectorPerformance: expect.objectContaining({
          current: expect.any(Array),
          best: expect.any(Array),
          last: expect.any(Array),
        }),
      }),
      gapAheadSeconds: expect.any(Number),
      intervalAheadSeconds: expect.any(Number),
      leaderGapSeconds: expect.any(Number),
      drsEligible: expect.any(Boolean),
      drsActive: expect.any(Boolean),
      wheels: expect.any(Array),
      pitIntent: expect.any(Number),
      pitStop: expect.objectContaining({
        status: expect.any(String),
        targetTire: expect.any(String),
        stopsCompleted: expect.any(Number),
      }),
      positionSource: 'integrated-vehicle',
    }));
    expect(car.wheels).toHaveLength(4);
  });

  test('render snapshots keep render-critical state without serializing full car payloads', () => {
    const sim = createRaceSimulation({
      drivers,
      track: TRACK,
      rules: { standingStart: false },
    });
    sim.step(1 / 60);

    const full = sim.snapshot();
    const render = sim.snapshotRender();

    expect(render).toMatchObject({
      time: full.time,
      totalLaps: full.totalLaps,
      track: full.track,
      pitLaneStatus: full.pitLaneStatus,
      raceControl: {
        mode: full.raceControl.mode,
        pitLaneOpen: full.raceControl.pitLaneOpen,
      },
    });
    expect(render.cars).toHaveLength(full.cars.length);
    expect(render.cars[0]).toEqual(expect.objectContaining({
      id: full.cars[0].id,
      x: full.cars[0].x,
      y: full.cars[0].y,
      previousX: full.cars[0].previousX,
      previousY: full.cars[0].previousY,
      heading: full.cars[0].heading,
      previousHeading: full.cars[0].previousHeading,
      color: full.cars[0].color,
      drsActive: full.cars[0].drsActive,
    }));
    expect(render.cars[0]).not.toHaveProperty('setup');
    expect(render.cars[0]).not.toHaveProperty('wheels');
    expect(render).not.toHaveProperty('penalties');
  });

  test('observation snapshots keep the training-facing shape without full public-only fields', () => {
    const sim = createRaceSimulation({
      seed: 72,
      drivers,
      totalLaps: 4,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
    });
    run(sim, 1);

    const observation = sim.snapshotObservation();
    const car = observation.cars[0];

    expect(observation).toMatchObject({
      time: expect.any(Number),
      world: expect.any(Object),
      track: expect.any(Object),
      totalLaps: 4,
      raceControl: {
        mode: 'green',
        redFlag: false,
        pitLaneOpen: true,
        pitLaneStatus: expect.any(Object),
        finished: false,
      },
      pitLaneStatus: expect.any(Object),
      safetyCar: expect.any(Object),
      events: expect.any(Array),
      cars: expect.any(Array),
    });
    expect(observation).not.toHaveProperty('rules');
    expect(observation).not.toHaveProperty('penalties');
    expect(car).toEqual(expect.objectContaining({
      id: expect.any(String),
      rank: expect.any(Number),
      previousX: expect.any(Number),
      previousY: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
      previousHeading: expect.any(Number),
      heading: expect.any(Number),
      steeringAngle: expect.any(Number),
      yawRate: expect.any(Number),
      speed: expect.any(Number),
      speedKph: expect.any(Number),
      throttle: expect.any(Number),
      brake: expect.any(Number),
      progress: expect.any(Number),
      raceDistance: expect.any(Number),
      lap: expect.any(Number),
      lapTelemetry: expect.any(Object),
      trackState: expect.any(Object),
      wheels: expect.any(Array),
      tireEnergy: expect.any(Number),
      pitIntent: expect.any(Number),
      pitStop: expect.any(Object),
    }));
    expect(car).not.toHaveProperty('setup');
    expect(car).not.toHaveProperty('penaltySeconds');
  });

  test('same seed, track, drivers, and rules produce deterministic fixed-step signatures', () => {
    const options = {
      seed: 1971,
      drivers,
      totalLaps: 5,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
    };
    const first = createRaceSimulation(options);
    const second = createRaceSimulation(options);

    for (let index = 0; index < 240; index += 1) {
      first.step(1 / 60);
      second.step(1 / 60);
    }

    expect(simulationSignature(first)).toEqual(simulationSignature(second));
  });

  slowTest('preserves deterministic integrated race behavior across cleanup modules', () => {
    const options = {
      seed: 110,
      trackSeed: 20260510,
      drivers: PROJECT_DRIVERS.slice(0, 8),
      totalLaps: 3,
      rules: {
        standingStart: true,
        modules: {
          pitStops: { enabled: true, defaultStopSeconds: 0.1, variability: { enabled: false } },
          penalties: {
            enabled: true,
            collision: { enabled: true, strictness: 1 },
            trackLimits: { enabled: true, strictness: 1 },
            pitLaneSpeeding: { enabled: true, strictness: 1 },
            tireRequirement: { enabled: true, strictness: 1 },
          },
        },
      },
    };
    const first = createRaceSimulation(options);
    const second = createRaceSimulation(options);

    first.setPitIntent(PROJECT_DRIVERS[0].id, 2, 'H');
    second.setPitIntent(PROJECT_DRIVERS[0].id, 2, 'H');

    for (let index = 0; index < 900; index += 1) {
      first.step(FIXED_STEP);
      second.step(FIXED_STEP);
    }

    const signature = (sim) => {
      const snapshot = sim.snapshot();
      return {
        mode: snapshot.raceControl.mode,
        startReleased: snapshot.raceControl.start.released,
        pitLaneOpen: snapshot.raceControl.pitLaneOpen,
        firstPenalty: snapshot.penalties[0]?.type ?? null,
        firstCars: snapshot.cars.slice(0, 5).map((car) => ({
          id: car.id,
          rank: car.rank,
          lap: car.lap,
          raceDistance: Number(car.raceDistance.toFixed(3)),
          tire: car.tire,
          pitStatus: car.pitStop?.status ?? null,
          pitIntent: car.pitIntent,
          penaltySeconds: car.penaltySeconds,
          drsActive: car.drsActive,
          drsEligible: car.drsEligible,
        })),
        eventTypes: sim.consumeStepEvents().map((event) => event.type),
      };
    };

    expect(signature(first)).toEqual(signature(second));
  }, HEAVY_INTEGRATION_TEST_TIMEOUT_MS);

  test('DRS threshold remains strict at one second at the detection point', () => {
    const sim = createRaceSimulation({
      seed: 32,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      track: TRACK,
      rules: { standingStart: false, ruleset: 'fia2025' },
    });
    const track = sim.snapshot().track;
    const zone = track.drsZones[0];
    const leader = sim.cars.find((car) => car.id === 'budget');
    const chasing = sim.cars.find((car) => car.id === 'noir');

    placeCarAtDistance(sim, 'budget', zone.start + 120, 180);
    placeCarAtDistance(sim, 'noir', zone.start + 5, 180);
    sim.time = 10;
    chasing.previousProgress = zone.start - 5;
    chasing.progress = zone.start + 5;
    chasing.drsDetection = {};
    chasing.drsZoneId = null;
    chasing.drsZoneEnabled = false;
    leader.drsDetection = {
      [zone.id]: { passage: 1, time: sim.time - 0.95 },
    };
    sim.updateDrsLatch(chasing, leader, true);
    expect(sim.snapshot().cars.find((car) => car.id === 'noir')).toMatchObject({
      drsEligible: true,
    });

    chasing.previousProgress = zone.start - 5;
    chasing.progress = zone.start + 5;
    chasing.drsDetection = {};
    chasing.drsZoneId = null;
    chasing.drsZoneEnabled = false;
    leader.drsDetection = {
      [zone.id]: { passage: 1, time: sim.time - 1.05 },
    };
    sim.updateDrsLatch(chasing, leader, true);
    expect(sim.snapshot().cars.find((car) => car.id === 'noir')).toMatchObject({
      drsEligible: false,
    });
  });


  test('normalizes modular race rulesets with custom penalty strictness and pit speed limits', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: {
        ruleset: 'fia2025',
        standingStart: false,
        modules: {
          pitStops: {
            pitLaneSpeedLimitKph: 60,
          },
          penalties: {
            trackLimits: { strictness: 1.4 },
            collision: { strictness: 0.35 },
            pitLaneSpeeding: {
              strictness: -0.2,
              speedLimitKph: 60,
            },
          },
        },
      },
    });

    const rules = sim.snapshot().rules;

    expect(rules.ruleset).toBe('fia2025');
    expect(rules.standingStart).toBe(false);
    expect(rules.modules.pitStops).toMatchObject({
      enabled: true,
      pitLaneSpeedLimitKph: 60,
      maxConcurrentPitLaneCars: 3,
      minimumPitLaneGapMeters: 20,
      tirePitRequestThresholdPercent: 50,
      tirePitCommitThresholdPercent: 30,
    });
    expect(rules.modules.tireStrategy).toMatchObject({
      enabled: true,
      mandatoryDistinctDryCompounds: 2,
    });
    expect(rules.modules.penalties.trackLimits.strictness).toBe(1);
    expect(rules.modules.penalties.collision.strictness).toBe(0.35);
    expect(rules.modules.penalties.pitLaneSpeeding.strictness).toBe(0);
    expect(rules.modules.penalties.pitLaneSpeeding.speedLimitKph).toBe(60);
  });

  test('keeps custom rulesets isolated from later simulator instances', () => {
    const custom = createRaceSimulation({
      seed: 72,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: {
        ruleset: 'custom',
        modules: {
          pitStops: { enabled: false },
          tireStrategy: { enabled: false },
          penalties: {
            enabled: true,
            trackLimits: { strictness: 0.2 },
          },
        },
      },
    });
    const preset = createRaceSimulation({
      seed: 72,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: { ruleset: 'fia2025' },
    });

    expect(custom.snapshot().rules.modules.pitStops.enabled).toBe(false);
    expect(custom.snapshot().rules.modules.tireStrategy.enabled).toBe(false);
    expect(custom.snapshot().rules.modules.penalties.trackLimits.strictness).toBe(0.2);
    expect(preset.snapshot().rules.modules.pitStops.enabled).toBe(true);
    expect(preset.snapshot().rules.modules.tireStrategy.enabled).toBe(true);
    expect(preset.snapshot().rules.modules.penalties.trackLimits.strictness).toBeGreaterThan(0.2);
  });

  test('uses pit stop speed limit for pit-lane speeding unless the subsection overrides it', () => {
    const inherited = createRaceSimulation({
      seed: 73,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: {
        ruleset: 'fia2025',
        modules: {
          pitStops: { pitLaneSpeedLimitKph: 60 },
        },
      },
    });
    const overridden = createRaceSimulation({
      seed: 73,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: {
        ruleset: 'fia2025',
        modules: {
          pitStops: { pitLaneSpeedLimitKph: 60 },
          penalties: {
            pitLaneSpeeding: { speedLimitKph: 80 },
          },
        },
      },
    });

    expect(inherited.snapshot().rules.modules.penalties.pitLaneSpeeding.speedLimitKph).toBe(60);
    expect(overridden.snapshot().rules.modules.penalties.pitLaneSpeeding.speedLimitKph).toBe(80);
  });

  test('records pit-lane speeding penalties only on limited pit-lane parts', () => {
    const sim = createRaceSimulation({
      seed: 73,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: {
        ruleset: 'fia2025',
        standingStart: false,
        modules: {
          penalties: {
            pitLaneSpeeding: {
              strictness: 1,
              speedLimitKph: 80,
              marginKph: 0,
              consequences: [{ type: 'time', seconds: 5 }],
            },
          },
        },
      },
    });
    const car = sim.cars[0];
    const pitLane = sim.track.pitLane;
    const lanePoint = pitLane.mainLane.points[1];

    Object.assign(car, {
      x: lanePoint.x,
      y: lanePoint.y,
      previousX: lanePoint.x,
      previousY: lanePoint.y,
      heading: pitLane.mainLane.heading,
      previousHeading: pitLane.mainLane.heading,
      speed: kphToSimSpeed(112),
      progress: pitLane.entry.distanceFromStart,
      raceDistance: pitLane.entry.distanceFromStart,
    });

    sim.recalculateRaceState({ updateDrs: false });
    sim.reviewPitLaneSpeeding();
    sim.reviewPitLaneSpeeding();

    expect(sim.snapshot().events).toContainEqual(expect.objectContaining({
      type: 'penalty',
      penaltyType: 'pit-lane-speeding',
      driverId: car.id,
      penaltySeconds: 5,
    }));
    expect(sim.snapshot().penalties.filter((penalty) => penalty.type === 'pit-lane-speeding')).toHaveLength(1);
    expect(sim.snapshot().penalties[0]).toMatchObject({
      type: 'pit-lane-speeding',
      speedLimitKph: 80,
      consequences: [{ type: 'time', seconds: 5 }],
    });
  });

  test('does not enforce the pit speed limiter on entry or exit connector roads', () => {
    const sim = createRaceSimulation({
      seed: 73,
      drivers: drivers.slice(0, 1),
      totalLaps: 2,
      rules: {
        ruleset: 'fia2025',
        standingStart: false,
        modules: {
          penalties: {
            pitLaneSpeeding: {
              strictness: 1,
              speedLimitKph: 80,
              marginKph: 0,
              consequences: [{ type: 'time', seconds: 5 }],
            },
          },
        },
      },
    });
    const car = sim.cars[0];
    const entryPoint = sim.track.pitLane.entry.roadCenterline[Math.floor(sim.track.pitLane.entry.roadCenterline.length / 2)];

    Object.assign(car, {
      x: entryPoint.x,
      y: entryPoint.y,
      previousX: entryPoint.x,
      previousY: entryPoint.y,
      heading: entryPoint.heading,
      previousHeading: entryPoint.heading,
      speed: kphToSimSpeed(112),
      progress: sim.track.pitLane.entry.distanceFromStart,
      raceDistance: sim.track.pitLane.entry.distanceFromStart,
    });

    sim.recalculateRaceState({ updateDrs: false });
    expect(car.trackState.pitLanePart).toBe('entry');

    sim.reviewPitLaneSpeeding();

    expect(sim.snapshot().penalties.filter((penalty) => penalty.type === 'pit-lane-speeding')).toHaveLength(0);
  });

  test('assigns paired pit boxes to team colors in the track snapshot', () => {
    const sim = createRaceSimulation({
      seed: 77,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[2],
          team: { id: 'green-team', name: 'Green Team', color: '#06d6a0' },
        },
        {
          ...drivers[3],
          team: { id: 'green-team', name: 'Green Team', color: '#06d6a0' },
        },
      ],
      totalLaps: 3,
      rules: {
        modules: {
          pitStops: { enabled: true },
        },
      },
    });
    const pitLane = sim.snapshot().track.pitLane;

    expect(pitLane.teams.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: 'red-team',
        name: 'Red Team',
        color: '#d90429',
        boxIds: ['team-1-box-1', 'team-1-box-2'],
        serviceAreaId: 'team-1-service',
      }),
      expect.objectContaining({
        id: 'green-team',
        name: 'Green Team',
        color: '#06d6a0',
        boxIds: ['team-2-box-1', 'team-2-box-2'],
        serviceAreaId: 'team-2-service',
      }),
    ]);
    expect(pitLane.boxes.slice(0, 4)).toEqual([
      expect.objectContaining({ teamId: 'red-team', teamColor: '#d90429', teamBoxIndex: 0 }),
      expect.objectContaining({ teamId: 'red-team', teamColor: '#d90429', teamBoxIndex: 1 }),
      expect.objectContaining({ teamId: 'green-team', teamColor: '#06d6a0', teamBoxIndex: 0 }),
      expect.objectContaining({ teamId: 'green-team', teamColor: '#06d6a0', teamBoxIndex: 1 }),
    ]);
    expect(pitLane.serviceAreas.slice(0, 2)).toEqual([
      expect.objectContaining({ id: 'team-1-service', teamId: 'red-team', teamColor: '#d90429' }),
      expect.objectContaining({ id: 'team-2-service', teamId: 'green-team', teamColor: '#06d6a0' }),
    ]);
  });

  test('stages every team car in the queue spot before releasing it into the shared service area', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
      ],
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 60,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const first = sim.cars.find((entry) => entry.id === 'budget');
    const second = sim.cars.find((entry) => entry.id === 'noir');
    const serviceArea = sim.getPitStopBox(first.pitStop);

    expect(first.pitStop.boxId).toBe(second.pitStop.boxId);
    expect(first.pitStop.garageBoxId).not.toBe(second.pitStop.garageBoxId);
    expect(serviceArea).toEqual(expect.objectContaining({
      id: 'team-1-service',
      queuePoint: expect.any(Object),
    }));

    sim.beginPitService(first, serviceArea);
    const secondCallPoint = pointAt(sim.track, second.pitStop.plannedRaceDistance + 2);
    sim.setCarState('noir', {
      x: secondCallPoint.x,
      y: secondCallPoint.y,
      heading: secondCallPoint.heading,
      speed: kphToSimSpeed(84),
      progress: secondCallPoint.distance,
      raceDistance: second.pitStop.plannedRaceDistance + 2,
    });
    sim.startPitStop(second);

    expect(second.pitStop.status).toBe('entering');
    expect(second.pitStop.queueingForService).toBe(true);
    expect(second.pitStop.route.points.at(-1)).toEqual(expect.objectContaining({
      x: serviceArea.queuePoint.x,
      y: serviceArea.queuePoint.y,
    }));

    const firstCallPoint = pointAt(sim.track, first.pitStop.plannedRaceDistance + 2);
    sim.setCarState('budget', {
      x: firstCallPoint.x,
      y: firstCallPoint.y,
      heading: firstCallPoint.heading,
      speed: kphToSimSpeed(84),
      progress: firstCallPoint.distance,
      raceDistance: first.pitStop.plannedRaceDistance + 2,
    });
    first.pitStop.status = 'pending';
    first.pitStop.phase = null;
    first.pitStop.route = null;
    first.pitStop.queueingForService = false;
    sim.startPitStop(first);

    expect(first.pitStop.queueingForService).toBe(true);
    expect(first.pitStop.route.points.at(-1)).toEqual(expect.objectContaining({
      x: serviceArea.queuePoint.x,
      y: serviceArea.queuePoint.y,
    }));

    sim.beginPitQueue(second, serviceArea);
    expect(second.pitStop.status).toBe('queued');
    expect(pointDistance(second, serviceArea.queuePoint)).toBeLessThan(20);

    sim.beginPitService(first, serviceArea);
    sim.completePitService(first);
    sim.step(1 / 30);

    expect(second.pitStop.status).toBe('queued');

    first.x = serviceArea.center.x + 500;
    first.y = serviceArea.center.y + 500;
    sim.step(1 / 30);

    expect(second.pitStop.status).toBe('entering');
    expect(second.pitStop.phase).toBe('queue-release');
    expect(second.pitStop.route.points.at(-1)).toEqual(expect.objectContaining({
      x: serviceArea.center.x,
      y: serviceArea.center.y,
    }));
  }, HEAVY_INTEGRATION_TEST_TIMEOUT_MS);

  test('participants that do not block the pit lane are ignored by service occupancy checks', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
      ],
      totalLaps: 4,
      participantInteractions: {
        drivers: {
          budget: { profile: 'isolated-training' },
        },
      },
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 60,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const first = sim.cars.find((entry) => entry.id === 'budget');
    const second = sim.cars.find((entry) => entry.id === 'noir');
    const serviceArea = sim.getPitStopBox(first.pitStop);

    sim.beginPitService(first, serviceArea);

    expect(sim.isPitServiceBusy(second, serviceArea)).toBe(false);
    expect(sim.isPitServiceAreaOccupied(first, serviceArea)).toBe(false);
  });

  test('moves from pit waiting spot into the active service spot without a large snap', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
      ],
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 60,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const first = sim.cars.find((entry) => entry.id === 'budget');
    const second = sim.cars.find((entry) => entry.id === 'noir');
    const serviceArea = sim.getPitStopBox(first.pitStop);

    sim.beginPitService(first, serviceArea);
    sim.beginPitQueue(second, serviceArea);
    first.pitStop.status = 'completed';
    first.x = serviceArea.center.x + 500;
    first.y = serviceArea.center.y + 500;
    sim.step(1 / 30);

    expect(second.pitStop.phase).toBe('queue-release');

    let largestStep = 0;
    for (let index = 0; index < 240 && second.pitStop.status !== 'servicing'; index += 1) {
      const before = { x: second.x, y: second.y };
      sim.step(1 / 30);
      largestStep = Math.max(largestStep, pointDistance(before, second));
    }

    expect(second.pitStop.status).toBe('servicing');
    expect(largestStep).toBeLessThan(metersToSimUnits(5));
    expect(pointDistance(second, serviceArea.center)).toBeLessThan(2);
  });

  test('keeps pit-controlled cars pinned when resolving overlap during pit exit', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'green-team', name: 'Green Team', color: '#06d6a0' },
        },
      ],
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 60,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const exiting = sim.cars.find((entry) => entry.id === 'budget');
    const blocker = sim.cars.find((entry) => entry.id === 'noir');
    const serviceArea = sim.getPitStopBox(exiting.pitStop);

    sim.beginPitService(exiting, serviceArea);
    sim.completePitService(exiting);
    sim.applyPitRoutePosition(exiting, 1 / 10);
    const pitPose = {
      x: exiting.x,
      y: exiting.y,
      heading: exiting.heading,
    };

    sim.setCarState('noir', {
      x: pitPose.x,
      y: pitPose.y,
      heading: pitPose.heading,
      speed: kphToSimSpeed(80),
      raceDistance: exiting.raceDistance,
      progress: exiting.progress,
    });
    const blockerBefore = {
      x: blocker.x,
      y: blocker.y,
    };

    sim.resolveCollisions();

    expect(exiting.pitStop.status).toBe('exiting');
    expect(exiting.x).toBeCloseTo(pitPose.x, 6);
    expect(exiting.y).toBeCloseTo(pitPose.y, 6);
    expect(exiting.heading).toBeCloseTo(pitPose.heading, 6);
    expect(pointDistance(blocker, blockerBefore)).toBeGreaterThan(0);
    expect(pointDistance(blocker, pitPose)).toBeGreaterThan(pointDistance(blockerBefore, pitPose));
  });

  test('reaches the pit waiting spot without snapping from the entry route', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
      ],
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 60,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const first = sim.cars.find((entry) => entry.id === 'budget');
    const second = sim.cars.find((entry) => entry.id === 'noir');
    const serviceArea = sim.getPitStopBox(first.pitStop);

    sim.beginPitService(first, serviceArea);
    const secondCallPoint = pointAt(sim.track, second.pitStop.plannedRaceDistance + 2);
    sim.setCarState('noir', {
      x: secondCallPoint.x,
      y: secondCallPoint.y,
      heading: secondCallPoint.heading,
      speed: kphToSimSpeed(84),
      progress: secondCallPoint.distance,
      raceDistance: second.pitStop.plannedRaceDistance + 2,
    });
    sim.startPitStop(second);

    let largestStep = 0;
    for (let index = 0; index < 900 && second.pitStop.status !== 'queued'; index += 1) {
      const before = { x: second.x, y: second.y };
      sim.step(1 / 15);
      largestStep = Math.max(largestStep, pointDistance(before, second));
    }

    expect(second.pitStop.status).toBe('queued');
    expect(largestStep).toBeLessThan(metersToSimUnits(5));
    expect(pointDistance(second, serviceArea.queuePoint)).toBeLessThan(3);
  });

  test('does not crawl into the pit waiting spot while the route still has room to brake', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
      ],
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 60,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const first = sim.cars.find((entry) => entry.id === 'budget');
    const second = sim.cars.find((entry) => entry.id === 'noir');
    const serviceArea = sim.getPitStopBox(first.pitStop);

    sim.beginPitService(first, serviceArea);
    const secondCallPoint = pointAt(sim.track, second.pitStop.plannedRaceDistance + 2);
    sim.setCarState('noir', {
      x: secondCallPoint.x,
      y: secondCallPoint.y,
      heading: secondCallPoint.heading,
      speed: kphToSimSpeed(84),
      progress: secondCallPoint.distance,
      raceDistance: second.pitStop.plannedRaceDistance + 2,
    });
    sim.startPitStop(second);

    let minimumApproachSpeedKph = Infinity;
    for (let index = 0; index < 2400 && second.pitStop.status === 'entering'; index += 1) {
      sim.step(1 / 60);
      const routeRemaining = second.pitStop.route
        ? second.pitStop.route.length - second.pitStop.routeProgress
        : 0;
      if (routeRemaining > metersToSimUnits(6)) {
        minimumApproachSpeedKph = Math.min(minimumApproachSpeedKph, simSpeedToKph(second.speed));
      }
    }

    expect(second.pitStop.status).toBe('queued');
    expect(minimumApproachSpeedKph).toBeGreaterThan(35);
  });

  test('passes through the waiting spot without stopping when the active pit area is free', () => {
    const sim = createRaceSimulation({
      seed: 78,
      trackSeed: 20260430,
      drivers: [
        {
          ...drivers[0],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
        {
          ...drivers[1],
          team: { id: 'red-team', name: 'Red Team', color: '#d90429' },
        },
      ],
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
            defaultStopSeconds: 4,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const serviceArea = sim.getPitStopBox(car.pitStop);
    const callPoint = pointAt(sim.track, car.pitStop.plannedRaceDistance + 2);

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(84),
      progress: callPoint.distance,
      raceDistance: car.pitStop.plannedRaceDistance + 2,
    });
    sim.startPitStop(car);

    expect(car.pitStop.queueingForService).toBe(true);
    expect(car.pitStop.route.points.some((point) => (
      pointDistance(point, serviceArea.queuePoint) < 0.001
    ))).toBe(true);
    expect(car.pitStop.route.points.at(-1)).toEqual(expect.objectContaining({
      x: serviceArea.queuePoint.x,
      y: serviceArea.queuePoint.y,
    }));

    let sawQueued = false;
    for (let index = 0; index < 900 && car.pitStop.status !== 'servicing'; index += 1) {
      sim.step(1 / 15);
      if (car.pitStop.status === 'queued') sawQueued = true;
    }

    expect(sawQueued).toBe(false);
    expect(car.pitStop.status).toBe('servicing');
    expect(pointDistance(car, serviceArea.center)).toBeLessThan(3);
  });

  test('records steward penalties against the trailing car for meaningful rear contact', () => {
    const sim = createRaceSimulation({
      seed: 8,
      drivers: drivers.slice(0, 3),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            collision: { strictness: 1, timePenaltySeconds: 5 },
          },
        },
      },
    });
    placeCarAtDistance(sim, 'budget', 1000, 58);
    placeCarAtDistance(sim, 'noir', 1035, 30);

    sim.step(1 / 60);
    const snapshot = sim.snapshot();

    expect(snapshot.events).toContainEqual(expect.objectContaining({ type: 'contact' }));
    expect(snapshot.events).toContainEqual(expect.objectContaining({
      type: 'penalty',
      penaltyType: 'collision',
      penaltySeconds: 5,
      strictness: 1,
    }));
    expect(snapshot.penalties).toContainEqual(expect.objectContaining({
      type: 'collision',
      driverId: 'budget',
      otherCarId: 'noir',
      aheadDriverId: 'noir',
      atFaultDriverId: 'budget',
      penaltySeconds: 5,
      consequences: [{ type: 'time', seconds: 5 }],
    }));
    expect(snapshot.penalties.some((penalty) => penalty.driverId === 'noir')).toBe(false);
  });

  test('assigns rear-contact fault by physical order for lapped traffic', () => {
    const sim = createRaceSimulation({
      seed: 8,
      drivers: drivers.slice(0, 3),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            collision: { strictness: 1, timePenaltySeconds: 5 },
          },
        },
      },
    });
    const distance = 1000;
    placeCarAtDistance(sim, 'budget', distance, 58);
    placeCarAtDistance(sim, 'noir', distance + 35, 30);
    const leader = sim.cars.find((car) => car.id === 'budget');
    leader.raceDistance += sim.track.length;

    sim.step(1 / 60);
    const snapshot = sim.snapshot();

    expect(snapshot.penalties).toContainEqual(expect.objectContaining({
      type: 'collision',
      driverId: 'budget',
      otherCarId: 'noir',
      aheadDriverId: 'noir',
      atFaultDriverId: 'budget',
      penaltySeconds: 5,
    }));
    expect(snapshot.penalties.some((penalty) => penalty.driverId === 'noir')).toBe(false);
  });

  test('records collision penalties against both cars when rear-contact responsibility is unclear', () => {
    const sim = createRaceSimulation({
      seed: 8,
      drivers: drivers.slice(0, 3),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            collision: { strictness: 1, timePenaltySeconds: 5 },
          },
        },
      },
    });
    placeCarAtDistance(sim, 'budget', 1000, 58);
    placeCarAtDistance(sim, 'noir', 1000 + VEHICLE_LIMITS.carLength * 0.08, 30);

    sim.step(1 / 60);
    const snapshot = sim.snapshot();
    const collisionPenalties = snapshot.penalties.filter((penalty) => penalty.type === 'collision');

    expect(snapshot.events).toContainEqual(expect.objectContaining({ type: 'contact' }));
    expect(collisionPenalties).toHaveLength(2);
    expect(collisionPenalties.map((penalty) => penalty.driverId).sort()).toEqual(['budget', 'noir']);
    expect(collisionPenalties).toEqual(expect.arrayContaining([
      expect.objectContaining({
        driverId: 'budget',
        otherCarId: 'noir',
        aheadDriverId: null,
        atFaultDriverId: 'budget',
        sharedFault: true,
        penaltySeconds: 5,
      }),
      expect.objectContaining({
        driverId: 'noir',
        otherCarId: 'budget',
        aheadDriverId: null,
        atFaultDriverId: 'noir',
        sharedFault: true,
        penaltySeconds: 5,
      }),
    ]));
  });

  test('does not apply collision penalties for light low-speed contact', () => {
    const sim = createRaceSimulation({
      seed: 8,
      drivers: drivers.slice(0, 3),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            collision: { strictness: 1, timePenaltySeconds: 5 },
          },
        },
      },
    });
    placeCarAtDistance(sim, 'budget', 1000, 31);
    placeCarAtDistance(sim, 'noir', 1035, 30);

    sim.step(1 / 60);
    const snapshot = sim.snapshot();

    expect(snapshot.events).toContainEqual(expect.objectContaining({ type: 'contact' }));
    expect(snapshot.events.some((event) => event.type === 'penalty')).toBe(false);
    expect(snapshot.penalties).toEqual([]);
  });

  test('does not apply steward penalties when a subsection strictness is zero', () => {
    const sim = createRaceSimulation({
      seed: 8,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            collision: { strictness: 0, timePenaltySeconds: 5 },
          },
        },
      },
    });
    sim.setCarState('budget', { x: 520, y: 360, heading: 0, speed: kphToSimSpeed(65) });
    sim.setCarState('noir', { x: 535, y: 360, heading: 0, speed: kphToSimSpeed(130) });

    sim.step(1 / 60);
    const snapshot = sim.snapshot();

    expect(snapshot.events).toContainEqual(expect.objectContaining({ type: 'contact' }));
    expect(snapshot.events.some((event) => event.type === 'penalty')).toBe(false);
    expect(snapshot.penalties).toEqual([]);
  });

  test('records track-limit penalties through steward strictness margins', () => {
    const sim = createRaceSimulation({
      seed: 41,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 0,
              timePenaltySeconds: 5,
            },
          },
        },
      },
    });
    const track = sim.snapshot().track;
    const point = findMainTrackPointAwayFromPitLane(track, 1350);
    const gravelPoint = offsetTrackPoint(point, track.width / 2 + 84);

    sim.setCarState('budget', {
      x: gravelPoint.x,
      y: gravelPoint.y,
      heading: point.heading,
      speed: 40,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);

    expect(sim.snapshot().penalties).toContainEqual(expect.objectContaining({
      type: 'track-limits',
      driverId: 'budget',
      penaltySeconds: 5,
      strictness: 1,
      consequences: [{ type: 'time', seconds: 5 }],
    }));
  });

  test('does not record track-limit warnings while the outside wheels are only touching or inside the white line', () => {
    const sim = createRaceSimulation({
      seed: 42,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 3,
              timePenaltySeconds: 5,
            },
          },
        },
      },
    });
    const track = sim.snapshot().track;
    const point = findMainTrackPointAwayFromPitLane(track, 1350);
    const touchingWhiteLine = offsetTrackPoint(
      point,
      track.width / 2 - VEHICLE_LIMITS.carWidth / 2 - 1,
    );

    sim.setCarState('budget', {
      x: touchingWhiteLine.x,
      y: touchingWhiteLine.y,
      heading: point.heading,
      speed: 40,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);

    expect(sim.snapshot().events.some((event) => event.type === 'track-limits')).toBe(false);
    expect(sim.snapshot().penalties).toEqual([]);
  });

  test('does not record track-limit warnings while only the outside wheels cross the white line', () => {
    const sim = createRaceSimulation({
      seed: 42,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 3,
              timePenaltySeconds: 5,
            },
          },
        },
      },
    });
    const track = sim.snapshot().track;
    const point = findMainTrackPointAwayFromPitLane(track, 1350);
    const outsideWheelsOnly = offsetTrackPoint(
      point,
      track.width / 2 - VEHICLE_LIMITS.carWidth / 2 + 1,
    );

    sim.setCarState('budget', {
      x: outsideWheelsOnly.x,
      y: outsideWheelsOnly.y,
      heading: point.heading,
      speed: 40,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);

    expect(sim.snapshot().events.some((event) => event.type === 'track-limits')).toBe(false);
    expect(sim.snapshot().penalties).toEqual([]);
  });

  test('records track-limit warnings once the whole car crosses the white line', () => {
    const sim = createRaceSimulation({
      seed: 42,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 3,
              timePenaltySeconds: 5,
            },
          },
        },
      },
    });
    const track = sim.snapshot().track;
    const point = findMainTrackPointAwayFromPitLane(track, 1350);
    const wholeCarOutside = offsetTrackPoint(
      point,
      track.width / 2 + VEHICLE_LIMITS.carWidth / 2 + metersToSimUnits(0.5),
    );

    sim.setCarState('budget', {
      x: wholeCarOutside.x,
      y: wholeCarOutside.y,
      heading: point.heading,
      speed: 40,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);

    expect(sim.snapshot().events).toContainEqual(expect.objectContaining({
      type: 'track-limits',
      decision: 'warning',
      carId: 'budget',
      violationCount: 1,
      warningsBeforePenalty: 3,
    }));
    expect(sim.snapshot().penalties).toEqual([]);
  });

  test('built-in AI recovers from kerb exits without panic braking', () => {
    const sim = createRaceSimulation({
      seed: 42,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const point = pointAt(track, 1520);
    const kerbPoint = offsetTrackPoint(point, track.width / 2 + track.kerbWidth * 0.15);

    sim.setCarState('budget', {
      x: kerbPoint.x,
      y: kerbPoint.y,
      heading: point.heading + 0.12,
      speed: kphToSimSpeed(250),
      progress: point.distance,
      raceDistance: point.distance,
    });

    const car = sim.cars.find((entry) => entry.id === 'budget');
    const controls = decideDriverControls({
      car,
      orderIndex: 0,
      race: sim.driverRaceContext(),
    });

    expect(car.trackState.surface).toBe('kerb');
    expect(controls.brake).toBeLessThan(0.55);
    expect(Math.abs(controls.steering)).toBeLessThan(VEHICLE_LIMITS.maxSteer);
  });

  slowTest('built-in AI keeps cars inside track limits on a strict generated circuit', () => {
    const sim = createRaceSimulation({
      seed: 7,
      trackSeed: 20260430,
      drivers: PROJECT_DRIVERS.slice(0, 10),
      totalLaps: 4,
      rules: {
        ruleset: 'grandPrix2025',
        standingStart: false,
        modules: {
          pitStops: { enabled: false },
          tireStrategy: { enabled: false },
          penalties: {
            collision: { strictness: 0 },
            tireRequirement: { strictness: 0 },
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 3,
              timePenaltySeconds: 5,
            },
          },
        },
      },
    });

    for (let index = 0; index < 1800; index += 1) {
      sim.step(1 / 30);
    }

    expect(sim.snapshot().penalties.filter((penalty) => penalty.type === 'track-limits')).toEqual([]);
  });

  test('adds multiple time penalties for a driver into snapshot totals', () => {
    const sim = createRaceSimulation({
      seed: 43,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          penalties: {
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 0,
              timePenaltySeconds: 5,
            },
          },
        },
      },
    });
    const track = sim.snapshot().track;
    const point = findMainTrackPointAwayFromPitLane(track, 1350);
    const outside = offsetTrackPoint(
      point,
      track.width / 2 + VEHICLE_LIMITS.carWidth / 2 + metersToSimUnits(0.5),
    );
    const inside = offsetTrackPoint(point, 0);

    sim.setCarState('budget', {
      x: outside.x,
      y: outside.y,
      heading: point.heading,
      speed: 0,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);
    sim.setCarState('budget', {
      x: inside.x,
      y: inside.y,
      heading: point.heading,
      speed: 0,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);
    sim.setCarState('budget', {
      x: outside.x,
      y: outside.y,
      heading: point.heading,
      speed: 0,
      progress: point.distance,
      raceDistance: point.distance,
    });
    sim.step(1 / 60);

    const snapshot = sim.snapshot();
    expect(snapshot.penalties.filter((penalty) => penalty.driverId === 'budget')).toHaveLength(2);
    expect(snapshot.cars.find((car) => car.id === 'budget')?.penaltySeconds).toBe(10);
  });

  test('does not count legal pit-lane road as a track-limits violation', () => {
    const sim = createRaceSimulation({
      seed: 93,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: true },
          penalties: {
            enabled: true,
            trackLimits: {
              strictness: 1,
              warningsBeforePenalty: 0,
            },
          },
        },
      },
    });
    const pitLane = sim.snapshot().track.pitLane;
    const box = pitLane.boxes[0];

    sim.setCarState('budget', {
      x: box.center.x,
      y: box.center.y,
      heading: pitLane.mainLane.heading,
      speed: 0,
      progress: pitLane.entry.trackDistance,
      raceDistance: sim.track.length + pitLane.entry.distanceFromStart,
    });
    sim.step(1 / 60);

    const snapshot = sim.snapshot();
    expect(snapshot.cars.find((car) => car.id === 'budget')).toMatchObject({
      surface: 'pit-box',
    });
    expect(snapshot.events.some((event) => event.type === 'track-limits')).toBe(false);
    expect(snapshot.penalties.filter((penalty) => penalty.type === 'track-limits')).toEqual([]);
  });

  test('sums ten separate time penalties and applies them to final classification', () => {
    const sim = createRaceSimulation({
      seed: 44,
      drivers: drivers.slice(0, 2),
      totalLaps: 1,
      rules: { standingStart: false },
    });
    const finishDistance = sim.snapshot().track.length;

    for (let index = 0; index < 10; index += 1) {
      sim.recordPenalty({
        type: 'manual-time',
        driverId: 'budget',
        strictness: 1,
        consequences: [{ type: 'time', seconds: 5 }],
        reason: `Manual time penalty ${index + 1}`,
      });
    }

    placeCarAtDistance(sim, 'budget', finishDistance + 4, 70);
    sim.step(3);
    placeCarAtDistance(sim, 'noir', finishDistance + 4, 70);
    const completed = sim.snapshot();

    expect(completed.cars.find((car) => car.id === 'budget')?.penaltySeconds).toBe(50);
    expect(completed.raceControl.classification.map((entry) => entry.id)).toEqual(['noir', 'budget']);
    expect(completed.raceControl.classification[1]).toMatchObject({
      id: 'budget',
      penaltySeconds: 50,
      adjustedFinishTime: expect.any(Number),
    });
  });

  test('keeps served drive-through penalties out of final time totals', () => {
    const sim = createRaceSimulation({
      seed: 45,
      drivers: drivers.slice(0, 2),
      totalLaps: 1,
      rules: { standingStart: false },
    });
    const entry = sim.recordPenalty({
      type: 'manual-drive-through',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'driveThrough', conversionSeconds: 20 }],
      reason: 'Drive-through penalty',
    });

    expect(entry).toMatchObject({
      status: 'issued',
      serviceType: 'driveThrough',
      penaltySeconds: 0,
      pendingPenaltySeconds: 20,
    });
    expect(sim.servePenalty(entry.id)).toMatchObject({ status: 'served', penaltySeconds: 0 });

    const finishDistance = sim.snapshot().track.length;
    placeCarAtDistance(sim, 'budget', finishDistance + 4, 70);
    sim.step(3);
    placeCarAtDistance(sim, 'noir', finishDistance + 4, 70);
    const completed = sim.snapshot();

    expect(completed.cars.find((car) => car.id === 'budget')?.penaltySeconds).toBe(0);
    expect(completed.raceControl.classification.map((item) => item.id)).toEqual(['budget', 'noir']);
  });

  test('converts unserved drive-through and stop-go penalties at final classification', () => {
    const sim = createRaceSimulation({
      seed: 46,
      drivers: drivers.slice(0, 2),
      totalLaps: 1,
      rules: { standingStart: false },
    });
    const driveThrough = sim.recordPenalty({
      type: 'manual-drive-through',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'driveThrough', conversionSeconds: 20 }],
      reason: 'Drive-through penalty',
    });
    const stopGo = sim.recordPenalty({
      type: 'manual-stop-go',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'stopGo', seconds: 10, conversionSeconds: 30 }],
      reason: 'Stop-go penalty',
    });

    const finishDistance = sim.snapshot().track.length;
    placeCarAtDistance(sim, 'budget', finishDistance + 4, 70);
    sim.step(3);
    placeCarAtDistance(sim, 'noir', finishDistance + 4, 70);
    const completed = sim.snapshot();

    expect(completed.penalties.find((penalty) => penalty.id === driveThrough.id)).toMatchObject({
      status: 'applied',
      unserved: true,
      penaltySeconds: 20,
    });
    expect(completed.penalties.find((penalty) => penalty.id === stopGo.id)).toMatchObject({
      status: 'applied',
      unserved: true,
      penaltySeconds: 30,
    });
    expect(completed.cars.find((car) => car.id === 'budget')?.penaltySeconds).toBe(50);
    expect(completed.raceControl.classification.map((entry) => entry.id)).toEqual(['noir', 'budget']);
  });

  test('serves time penalties before tire service when a car pits', () => {
    const sim = createRaceSimulation({
      seed: 112,
      track: TRACK,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            defaultStopSeconds: 0.5,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const originalTire = car.tire;
    const box = sim.getPitStopBox(car.pitStop);
    const penalty = sim.recordPenalty({
      type: 'manual-time',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'time', seconds: 2 }],
      reason: 'Pit-served time penalty',
    });

    sim.beginPitService(car, box);

    expect(car.pitStop).toMatchObject({
      status: 'servicing',
      phase: 'penalty',
      penaltyServiceTotal: 2,
      penaltyServiceRemaining: 2,
      servingPenaltyIds: [penalty.id],
    });
    expect(car.tire).toBe(originalTire);

    run(sim, 1);
    expect(car.pitStop.phase).toBe('penalty');
    expect(car.pitStop.penaltyServiceRemaining).toBeCloseTo(1, 1);
    expect(sim.snapshot().cars.find((entry) => entry.id === 'budget').pitStop)
      .toMatchObject({
        phase: 'penalty',
        penaltyServiceRemainingSeconds: expect.any(Number),
        servingPenaltyIds: [penalty.id],
      });

    run(sim, 1.1);
    expect(sim.snapshot().penalties.find((entry) => entry.id === penalty.id)).toMatchObject({
      status: 'served',
      penaltySeconds: 0,
    });
    expect(car.pitStop).toMatchObject({
      phase: 'service',
      penaltyServiceRemaining: 0,
    });
    expect(car.pitStop.serviceRemaining).toBeGreaterThan(0);
    expect(car.pitStop.serviceRemaining).toBeLessThanOrEqual(0.5);
    expect(car.tire).toBe(originalTire);

    run(sim, 0.6);
    expect(car.pitStop.status).toBe('exiting');
    expect(car.tire).not.toBe(originalTire);
  });

  test('sums multiple pit-served penalties before normal service starts', () => {
    const sim = createRaceSimulation({
      seed: 113,
      track: TRACK,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const box = sim.getPitStopBox(car.pitStop);
    const timePenalty = sim.recordPenalty({
      type: 'manual-time',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'time', seconds: 1 }],
    });
    const stopGoPenalty = sim.recordPenalty({
      type: 'manual-stop-go',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'stopGo', seconds: 3, conversionSeconds: 30 }],
    });

    sim.beginPitService(car, box);

    expect(car.pitStop).toMatchObject({
      phase: 'penalty',
      penaltyServiceTotal: 4,
      penaltyServiceRemaining: 4,
      servingPenaltyIds: [timePenalty.id, stopGoPenalty.id],
    });

    run(sim, 4.1);

    const served = sim.snapshot().penalties.filter((penalty) => (
      penalty.id === timePenalty.id || penalty.id === stopGoPenalty.id
    ));
    expect(served.every((penalty) => penalty.status === 'served')).toBe(true);
    expect(served.reduce((total, penalty) => total + penalty.penaltySeconds, 0)).toBe(0);
    expect(car.pitStop.phase).toBe('service');
  });

  test('applies final position drops and disqualification consequences', () => {
    const sim = createRaceSimulation({
      seed: 47,
      drivers: drivers.slice(0, 3),
      totalLaps: 1,
      rules: { standingStart: false },
    });
    sim.recordPenalty({
      type: 'manual-position-drop',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'positionDrop', positions: 1 }],
      reason: 'Position drop penalty',
    });
    sim.recordPenalty({
      type: 'manual-disqualification',
      driverId: 'noir',
      strictness: 1,
      consequences: [{ type: 'disqualification' }],
      reason: 'Disqualified',
    });

    const finishDistance = sim.snapshot().track.length;
    placeCarAtDistance(sim, 'budget', finishDistance + 4, 70);
    sim.step(1);
    placeCarAtDistance(sim, 'noir', finishDistance + 4, 70);
    sim.step(1);
    placeCarAtDistance(sim, 'vinyl', finishDistance + 4, 70);
    const completed = sim.snapshot();

    expect(completed.raceControl.classification.map((entry) => entry.id)).toEqual(['vinyl', 'budget', 'noir']);
    expect(completed.raceControl.classification.find((entry) => entry.id === 'budget')).toMatchObject({
      positionDrop: 1,
      disqualified: false,
    });
    expect(completed.raceControl.classification.find((entry) => entry.id === 'noir')).toMatchObject({
      disqualified: true,
    });
  });

  test('applies pre-start grid-drop penalties to grid positions', () => {
    const sim = createRaceSimulation({
      seed: 48,
      drivers: drivers.slice(0, 3),
      totalLaps: 1,
      rules: { standingStart: true },
    });

    const entry = sim.recordPenalty({
      type: 'manual-grid-drop',
      driverId: 'budget',
      strictness: 1,
      consequences: [{ type: 'gridDrop', positions: 2 }],
      reason: 'Grid drop penalty',
    });

    const orderedGrid = [...sim.cars].sort((left, right) => right.gridDistance - left.gridDistance);
    expect(entry).toMatchObject({ status: 'applied', gridDrop: 2 });
    expect(orderedGrid.map((car) => car.id)).toEqual(['noir', 'vinyl', 'budget']);
    expect(sim.cars.find((car) => car.id === 'budget')?.gridLocked).toBe(true);
  });

  test('uses staggered grid slots for both standing and already-released starts', () => {
    for (const standingStart of [true, false]) {
      const sim = createRaceSimulation({
        seed: 48,
        drivers,
        totalLaps: 1,
        rules: { standingStart },
      });

      const orderedGrid = [...sim.cars].sort((left, right) => right.gridDistance - left.gridDistance);
      const offsets = orderedGrid.map((car) => Math.round(simUnitsToMeters(car.gridOffset) * 10) / 10);
      const spacingMeters = orderedGrid.slice(1).map((car, index) => (
        Math.round(simUnitsToMeters(orderedGrid[index].gridDistance - car.gridDistance) * 10) / 10
      ));

      expect(offsets).toEqual([-3.2, 3.2, -3.2, 3.2]);
      expect(spacingMeters).toEqual(standingStart ? [8, 8, 8] : [35, 35, 35]);

      for (const car of orderedGrid) {
        const gridPoint = pointAt(sim.track, car.gridDistance);
        const position = offsetTrackPoint(gridPoint, car.gridOffset);
        expect(pointDistance(car, position)).toBeLessThan(0.001);
      }
    }
  });

  test('manual car repositioning resets the desired lane to the new track offset', () => {
    const sim = createRaceSimulation({
      seed: 48,
      drivers: drivers.slice(0, 1),
      totalLaps: 1,
      rules: { standingStart: false },
    });
    const point = pointAt(sim.track, metersToSimUnits(120));
    const centered = offsetTrackPoint(point, 0);

    expect(Math.abs(sim.cars[0].desiredOffset)).toBeGreaterThan(0);
    sim.setCarState('budget', {
      x: centered.x,
      y: centered.y,
      heading: point.heading,
      raceDistance: point.distance,
      progress: point.distance,
    });

    expect(sim.cars[0].desiredOffset).toBeCloseTo(0, 5);
  });

  test('records tire requirement penalties once when a car finishes without enough dry compounds', () => {
    const sim = createRaceSimulation({
      seed: 74,
      drivers: drivers.slice(0, 1),
      totalLaps: 1,
      rules: {
        standingStart: false,
        modules: {
          tireStrategy: {
            enabled: true,
            mandatoryDistinctDryCompounds: 2,
          },
          penalties: {
            tireRequirement: {
              strictness: 1,
              consequences: [{ type: 'time', seconds: 10 }],
            },
          },
        },
      },
    });
    const finishDistance = sim.snapshot().track.length;

    placeCarAtDistance(sim, 'budget', finishDistance + 4, 70);
    placeCarAtDistance(sim, 'budget', finishDistance + 24, 70);
    const penalties = sim.snapshot().penalties.filter((penalty) => penalty.type === 'tire-requirement');

    expect(penalties).toHaveLength(1);
    expect(penalties[0]).toMatchObject({
      driverId: 'budget',
      penaltySeconds: 10,
      requiredDistinctCompounds: 2,
      usedDistinctCompounds: 1,
      consequences: [{ type: 'time', seconds: 10 }],
    });
  });

  test('applies time consequences to final classification', () => {
    const sim = createRaceSimulation({
      seed: 76,
      drivers: drivers.slice(0, 2),
      totalLaps: 1,
      rules: {
        standingStart: false,
        modules: {
          tireStrategy: {
            enabled: true,
            mandatoryDistinctDryCompounds: 2,
          },
          penalties: {
            tireRequirement: {
              strictness: 1,
              consequences: [{ type: 'time', seconds: 10 }],
            },
          },
        },
      },
    });
    const finishDistance = sim.snapshot().track.length;
    sim.setCarState('noir', { usedTireCompounds: ['soft', 'medium'] });

    placeCarAtDistance(sim, 'budget', finishDistance + 4, 70);
    sim.step(3);
    placeCarAtDistance(sim, 'noir', finishDistance + 4, 70);
    const completed = sim.snapshot();

    expect(completed.raceControl.finished).toBe(true);
    expect(completed.raceControl.classification.map((entry) => entry.id)).toEqual(['noir', 'budget']);
    expect(completed.raceControl.winner.id).toBe('noir');
    expect(completed.raceControl.classification[1]).toMatchObject({
      id: 'budget',
      penaltySeconds: 10,
      adjustedFinishTime: expect.any(Number),
    });
  });

  test('allows lenient tire requirement strictness to tolerate one missing compound', () => {
    const sim = createRaceSimulation({
      seed: 75,
      drivers: drivers.slice(0, 1),
      totalLaps: 1,
      rules: {
        standingStart: false,
        modules: {
          tireStrategy: {
            enabled: true,
            mandatoryDistinctDryCompounds: 2,
          },
          penalties: {
            tireRequirement: {
              strictness: 0.4,
              consequences: [{ type: 'time', seconds: 10 }],
            },
          },
        },
      },
    });

    placeCarAtDistance(sim, 'budget', sim.snapshot().track.length + 4, 70);

    expect(sim.snapshot().penalties.some((penalty) => penalty.type === 'tire-requirement')).toBe(false);
  });

  test('generates a non-self-intersecting circuit centerline', () => {
    const track = buildTrackModel(TRACK);
    const points = track.samples.filter((_, index) => index % 6 === 0);
    const intersections = [];

    for (let first = 0; first < points.length - 1; first += 1) {
      for (let second = first + 2; second < points.length - 1; second += 1) {
        const sharesLoopClosure = first === 0 && second >= points.length - 3;
        if (sharesLoopClosure) continue;
        if (Math.abs(points[second].distance - points[first].distance) < metersToSimUnits(80)) continue;
        if (segmentsIntersect(points[first], points[first + 1], points[second], points[second + 1])) {
          intersections.push([first, second]);
        }
      }
    }

    expect(intersections).toEqual([]);
  });

  test('turns by steering angle and turn radius instead of lateral snapping', () => {
    const car = {
      x: 0,
      y: 0,
      heading: 0,
      steeringAngle: 0,
      speed: 48,
      mass: 798,
      powerNewtons: 15000,
      brakeNewtons: 36000,
      dragCoefficient: 0.72,
      downforceCoefficient: 3.2,
      tireGrip: 2.1,
      trackState: { onTrack: true },
      drsActive: false,
    };

    integrateVehiclePhysics(car, { steering: 0.38, throttle: 0.2, brake: 0 }, 0.5);

    expect(car.x).toBeGreaterThan(10);
    expect(car.y).toBeGreaterThan(0);
    expect(car.heading).toBeGreaterThan(0);
    expect(car.turnRadius).toBeGreaterThan(20);
    expect(car.steeringAngle).toBeLessThanOrEqual(0.38);
  });

  test('advances deterministically for the same seed and driver grid', () => {
    const first = createRaceSimulation({ seed: 71, drivers, totalLaps: 4 });
    const second = createRaceSimulation({ seed: 71, drivers, totalLaps: 4 });

    run(first, 12);
    run(second, 12);

    const signature = (snapshot) => snapshot.cars.map((car) => ({
      id: car.id,
      x: Number(car.x.toFixed(2)),
      y: Number(car.y.toFixed(2)),
      heading: Number(car.heading.toFixed(3)),
      speed: Number(car.speed.toFixed(3)),
      steeringAngle: Number(car.steeringAngle.toFixed(3)),
      raceDistance: Number(car.raceDistance.toFixed(2)),
      tireEnergy: Number(car.tireEnergy.toFixed(2)),
      positionSource: car.positionSource,
    }));

    expect(first.snapshot().cars).toHaveLength(drivers.length);
    expect(signature(first.snapshot())).toEqual(signature(second.snapshot()));
  });

  test('normalizes invalid lap counts to a one-lap race instead of producing impossible snapshots', () => {
    const invalidValues = [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 'abc'];

    invalidValues.forEach((totalLaps) => {
      const sim = createRaceSimulation({
        seed: 71,
        drivers: drivers.slice(0, 2),
        totalLaps,
        rules: { standingStart: false },
      });
      const snapshot = sim.snapshot();

      expect(snapshot.totalLaps).toBe(1);
      expect(snapshot.cars.every((car) => car.lap === 1)).toBe(true);
      expect(sim.finishDistance).toBe(snapshot.track.length);
    });
  });

  test('keeps racing until every car completes the configured distance, then queues under safety car', () => {
    const sim = createRaceSimulation({
      seed: 44,
      drivers: drivers.slice(0, 3),
      totalLaps: 2,
      rules: { standingStart: false },
    });
    const finishDistance = sim.snapshot().track.length * 2;

    placeCarAtDistance(sim, 'noir', finishDistance - 140, 70);
    placeCarAtDistance(sim, 'vinyl', finishDistance - 320, 68);
    placeCarAtDistance(sim, 'budget', finishDistance + 12, 72);

    const leaderFinished = sim.snapshot();

    expect(leaderFinished.raceControl.mode).toBe('green');
    expect(leaderFinished.raceControl.finished).toBe(false);
    expect(leaderFinished.raceControl.winner.id).toBe('budget');
    expect(leaderFinished.raceControl.classification).toEqual([]);
    expect(leaderFinished.cars[0]).toMatchObject({
      id: 'budget',
      finished: true,
      classifiedRank: 1,
      raceStatus: 'waved-flag',
      wavedFlag: true,
    });
    expect(leaderFinished.events).toContainEqual(expect.objectContaining({
      type: 'car-finish',
      winnerId: 'budget',
    }));

    placeCarAtDistance(sim, 'noir', finishDistance + 80, 70);
    const secondCarFinished = sim.snapshot();
    expect(secondCarFinished.raceControl.finished).toBe(false);
    expect(secondCarFinished.cars.slice(0, 2).map((car) => car.id)).toEqual(['budget', 'noir']);
    expect(secondCarFinished.cars[0]).toMatchObject({
      id: 'budget',
      rank: 1,
      classifiedRank: 1,
      raceStatus: 'waved-flag',
      wavedFlag: true,
    });
    expect(secondCarFinished.cars[1]).toMatchObject({
      id: 'noir',
      rank: 2,
      classifiedRank: 2,
      raceStatus: 'waved-flag',
      wavedFlag: true,
    });
    placeCarAtDistance(sim, 'vinyl', finishDistance + 2, 68);

    const completed = sim.snapshot();

    expect(completed.raceControl.mode).toBe('safety-car');
    expect(completed.raceControl.finished).toBe(true);
    expect(completed.safetyCar.deployed).toBe(true);
    expect(completed.raceControl.winner.id).toBe('budget');
    expect(completed.raceControl.classification.map((entry) => entry.id)).toEqual(['budget', 'noir', 'vinyl']);
    expect(completed.cars.every((car) => car.finished)).toBe(true);
    expect(completed.events).toContainEqual(expect.objectContaining({
      type: 'race-finish',
      winnerId: 'budget',
    }));

    const positionBeforeSafetyQueue = {
      x: completed.cars[0].x,
      y: completed.cars[0].y,
    };
    sim.step(1 / 60);
    const afterSafetyQueueStep = sim.snapshot().cars[0];

    expect(Math.hypot(
      afterSafetyQueueStep.x - positionBeforeSafetyQueue.x,
      afterSafetyQueueStep.y - positionBeforeSafetyQueue.y,
    )).toBeGreaterThan(0.1);
  });

  test('holds cars in staggered grid boxes until the start lights go out', () => {
    const sim = createRaceSimulation({
      seed: 17,
      drivers,
      totalLaps: 4,
      rules: {
        startLightInterval: 0.1,
        startLightsOutHold: 0.1,
      },
    });
    const initial = sim.snapshot();

    expect(initial.raceControl.mode).toBe('pre-start');
    expect(initial.raceControl.start.lightsLit).toBe(0);
    expect(initial.cars.every((car) => car.speed === 0)).toBe(true);
    expect(initial.cars.map((car) => Math.sign(car.signedOffset))).toEqual([-1, 1, -1, 1]);
    expect(initial.cars.map((car) => Math.round(car.raceDistance))).toEqual([-72, -168, -264, -360]);

    run(sim, 0.35);
    const staged = sim.snapshot();
    expect(staged.raceControl.mode).toBe('pre-start');
    expect(staged.raceControl.start.lightsLit).toBeGreaterThan(0);
    expect(staged.cars.map((car) => Number(car.raceDistance.toFixed(2))))
      .toEqual(initial.cars.map((car) => Number(car.raceDistance.toFixed(2))));

    run(sim, 1.1);
    const launched = sim.snapshot();
    expect(launched.raceControl.mode).toBe('green');
    expect(launched.raceControl.start.lightsLit).toBe(0);
    expect(launched.cars.some((car) => car.speed > 0)).toBe(true);
    expect(launched.cars[0].raceDistance).toBeGreaterThan(initial.cars[0].raceDistance);
  });

  slowTest('race simulations build deterministic but seed-distinct generated tracks', () => {
    const first = createRaceSimulation({ seed: 71, trackSeed: 10101, drivers, totalLaps: 4 });
    const repeated = createRaceSimulation({ seed: 71, trackSeed: 10101, drivers, totalLaps: 4 });
    const differentTrack = createRaceSimulation({ seed: 71, trackSeed: 20, drivers, totalLaps: 4 });

    expect(trackSignature(first.snapshot().track)).toBe(trackSignature(repeated.snapshot().track));
    expect(trackSignature(first.snapshot().track)).not.toBe(trackSignature(differentTrack.snapshot().track));
    expect(first.snapshot().track.drsZones).toHaveLength(3);
  }, HEAVY_INTEGRATION_TEST_TIMEOUT_MS);

  test('generated track simulations advance deterministically for the same seeds', () => {
    const generatedDrivers = drivers.slice(0, 2);
    const options = {
      seed: 71,
      trackSeed: 10101,
      drivers: generatedDrivers,
      totalLaps: 2,
      rules: { standingStart: false },
    };
    const first = createRaceSimulation(options);
    const repeated = createRaceSimulation(options);

    run(first, 2);
    run(repeated, 2);

    const compactState = (snapshot) => snapshot.cars.map((car) => ({
      id: car.id,
      x: Number(car.x.toFixed(2)),
      y: Number(car.y.toFixed(2)),
      raceDistance: Number(car.raceDistance.toFixed(2)),
      surface: car.surface,
    }));

    expect(compactState(first.snapshot())).toEqual(compactState(repeated.snapshot()));
    expect(first.snapshot().cars.every((car) => car.surface === 'track')).toBe(true);
  }, HEAVY_INTEGRATION_TEST_TIMEOUT_MS);

  test('automatically routes a scheduled car through pit entry, service box, and pit exit', () => {
    const sim = createRaceSimulation({
      seed: 97,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: {
            enabled: true,
            compounds: ['S', 'M', 'H'],
          },
        },
      },
    });
    const pitLane = sim.snapshot().track.pitLane;
    const triggerDistance = sim.track.length + pitLane.entry.distanceFromStart - 20;
    const entryPoint = pointAt(sim.track, triggerDistance);

    sim.setCarState('budget', {
      x: entryPoint.x,
      y: entryPoint.y,
      heading: entryPoint.heading,
      speed: 90,
      progress: entryPoint.distance,
      raceDistance: triggerDistance,
    });
    requestPitForRouteTest(sim, 'budget');

    const seenEvents = new Set();
    const budgetStatus = () => sim.snapshot().cars.find((entry) => entry.id === 'budget')?.pitStop?.status;
    for (let index = 0; index < 1500 && budgetStatus() !== 'completed'; index += 1) {
      sim.step(1 / 15);
      sim.snapshot().events
        .filter((event) => event.carId === 'budget')
        .forEach((event) => seenEvents.add(event.type));
    }

    const snapshot = sim.snapshot();
    const car = snapshot.cars.find((entry) => entry.id === 'budget');

    expect(car.pitStop).toMatchObject({
      status: 'completed',
      boxIndex: 0,
      stopsCompleted: 1,
    });
    expect(car.surface).toBe('track');
    expect(car.usedTireCompounds).toEqual(expect.arrayContaining(['S', 'M']));
    expect([...seenEvents]).toEqual([
      'pit-entry',
      'pit-stop-start',
      'pit-stop-complete',
      'pit-exit',
    ]);
  });

  test('pit intent can choose the target tire compound for the next stop', () => {
    const sim = createRaceSimulation({
      seed: 97,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: {
            enabled: true,
            compounds: ['S', 'M', 'H'],
          },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const callPoint = pointAt(sim.track, car.pitStop.plannedRaceDistance + 2);

    expect(car.tire).toBe('M');
    expect(sim.setPitIntent('budget', 2, 'H')).toBe(true);
    expect(sim.getPitTargetCompound('budget')).toBe('H');
    expect(car.pitStop.targetTire).toBe('H');

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(84),
      progress: callPoint.distance,
      raceDistance: car.pitStop.plannedRaceDistance + 2,
    });

    for (let index = 0; index < 1500 && car.pitStop.status !== 'completed'; index += 1) {
      sim.step(1 / 15);
    }

    expect(car.pitStop.status).toBe('completed');
    expect(car.tire).toBe('H');
    expect(car.usedTireCompounds).toEqual(expect.arrayContaining(['M', 'H']));
  });

  test('pit service variability can use team pit crew stats or a perfect training override', () => {
    const slowTeamDrivers = drivers.slice(0, 2).map((driver, index) => ({
      ...driver,
      team: {
        id: 'slow-crew',
        name: 'Slow Crew',
        color: '#ff3860',
        pitCrew: { speed: 0, consistency: 1, reliability: 1 },
      },
      tire: index === 0 ? 'M' : 'H',
    }));
    const makeSim = (perfect) => createRaceSimulation({
      seed: 97,
      trackSeed: 20260430,
      drivers: slowTeamDrivers,
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            defaultStopSeconds: 2.8,
            variability: {
              enabled: true,
              perfect,
            },
          },
          tireStrategy: { enabled: true },
        },
      },
    });

    const variableSim = makeSim(false);
    const variableCar = variableSim.cars.find((entry) => entry.id === 'budget');
    variableSim.beginTireService(variableCar);
    expect(variableCar.pitStop.serviceRemaining).toBeGreaterThan(2.8);
    expect(variableCar.pitStop.serviceProfile).toMatchObject({
      baseSeconds: 2.8,
      perfect: false,
      teamId: 'slow-crew',
    });

    const perfectSim = makeSim(true);
    const perfectCar = perfectSim.cars.find((entry) => entry.id === 'budget');
    perfectSim.beginTireService(perfectCar);
    expect(perfectCar.pitStop.serviceRemaining).toBeCloseTo(2.8);
    expect(perfectCar.pitStop.serviceProfile).toMatchObject({
      baseSeconds: 2.8,
      perfect: true,
      teamId: 'slow-crew',
    });
  });

  test('worn-tyre committed pit calls still drive into the assigned box and exit', () => {
    const sim = createRaceSimulation({
      seed: 116,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 80,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const box = sim.getPitStopBox(car.pitStop);
    const callDistance = car.pitStop.plannedRaceDistance + 2;
    const callPoint = pointAt(sim.track, callDistance);

    car.tireEnergy = 24;
    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(185),
      progress: callPoint.distance,
      raceDistance: callDistance,
    });
    expect(sim.setPitIntent('budget', 2)).toBe(true);

    let seenService = false;
    for (let index = 0; index < 1900 && car.pitStop.status !== 'completed'; index += 1) {
      sim.step(1 / 15);
      if (car.pitStop.status === 'servicing' && car.pitStop.phase === 'service') {
        seenService = true;
        expect(Math.hypot(car.x - box.center.x, car.y - box.center.y)).toBeLessThan(8);
      }
    }

    expect(seenService).toBe(true);
    expect(car.pitStop.status).toBe('completed');
    expect(car.trackState.surface).toBe('track');
  });

  test('pit entry route starts as a forward driving line instead of a sideways snap', () => {
    const sim = createRaceSimulation({
      seed: 97,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const callDistance = car.pitStop.plannedRaceDistance + 2;
    const callPoint = pointAt(sim.track, callDistance);

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(84),
      progress: callPoint.distance,
      raceDistance: callDistance,
    });
    requestPitForRouteTest(sim, 'budget');
    sim.step(1 / 60);

    const firstSegment = car.pitStop.route.segments[0];
    expect(car.pitStop.status).toBe('entering');
    expect(Math.abs(angleDelta(firstSegment.heading, callPoint.heading))).toBeLessThan(0.45);
  });

  test('pit entry route uses the main fast lane before peeling into the working lane', () => {
    const sim = createRaceSimulation({
      seed: 105,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 3),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'vinyl');
    const box = sim.getPitStopBox(car.pitStop);
    const callDistance = car.pitStop.plannedRaceDistance + 2;
    const callPoint = pointAt(sim.track, callDistance);

    sim.setCarState('vinyl', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(84),
      progress: callPoint.distance,
      raceDistance: callDistance,
    });
    requestPitForRouteTest(sim, 'vinyl');
    sim.step(1 / 60);

    const laneTravelPoints = car.pitStop.route.points.filter((point) => {
      const along = (point.x - sim.track.pitLane.mainLane.start.x) * Math.cos(sim.track.pitLane.mainLane.heading) +
        (point.y - sim.track.pitLane.mainLane.start.y) * Math.sin(sim.track.pitLane.mainLane.heading);
      const lateral = Math.abs(pitLaneLateralOffset(sim.track.pitLane, point));
      return along > 20 &&
        along < box.queueDistanceAlongLane - 25 &&
        lateral < sim.track.pitLane.width * 1.2;
    });
    const largestFastLaneLateral = Math.max(...laneTravelPoints.map((point) => (
      Math.abs(pitLaneLateralOffset(sim.track.pitLane, point))
    )));
    const finalLateral = pitLaneLateralOffset(sim.track.pitLane, car.pitStop.route.points.at(-1));

    expect(laneTravelPoints.length).toBeGreaterThan(0);
    expect(largestFastLaneLateral).toBeLessThan(sim.track.pitLane.width * 0.12);
    expect(finalLateral).toBeGreaterThan(sim.track.pitLane.workingLane.offset - 2);
  });

  test('does not apply the pit limiter on the pit-entry connector road before the main lane', () => {
    const sim = createRaceSimulation({
      seed: 102,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 60,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const callDistance = car.pitStop.plannedRaceDistance + 2;
    const callPoint = pointAt(sim.track, callDistance);

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(130),
      progress: callPoint.distance,
      raceDistance: callDistance,
    });
    requestPitForRouteTest(sim, 'budget');
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('entering');
    expect(car.brake).toBeLessThan(0.05);
  });

  test('arrives at the pit limiter line near the configured speed limit', () => {
    const sim = createRaceSimulation({
      seed: 106,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 60,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const callDistance = car.pitStop.plannedRaceDistance + 2;
    const callPoint = pointAt(sim.track, callDistance);

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(190),
      progress: callPoint.distance,
      raceDistance: callDistance,
    });
    requestPitForRouteTest(sim, 'budget');
    sim.step(1 / 60);
    const limiterStart = car.pitStop.route.segments.find((segment) => segment.limiterActive)?.startDistance ?? Infinity;
    for (let index = 0; index < 1800 && car.pitStop.routeProgress < limiterStart + 2; index += 1) {
      sim.step(1 / 60);
    }

    expect(car.pitStop.routeProgress).toBeGreaterThanOrEqual(limiterStart);
    expect(simSpeedToKph(car.speed)).toBeLessThanOrEqual(66);
  });

  test('applies the pit limiter on the main pit lane', () => {
    const sim = createRaceSimulation({
      seed: 103,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 60,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const pitLane = sim.track.pitLane;
    const callPoint = pointAt(sim.track, car.pitStop.plannedRaceDistance + 2);

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(90),
      progress: callPoint.distance,
      raceDistance: car.pitStop.plannedRaceDistance + 2,
    });
    requestPitForRouteTest(sim, 'budget');
    sim.step(1 / 60);
    sim.setCarState('budget', {
      x: pitLane.mainLane.start.x,
      y: pitLane.mainLane.start.y,
      heading: pitLane.mainLane.heading,
      speed: kphToSimSpeed(130),
      progress: pitLane.entry.trackDistance,
      raceDistance: car.pitStop.entryRaceDistance,
    });
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('entering');
    expect(car.brake).toBeGreaterThan(0.2);
  });

  test('releases the pit limiter on the pit-exit connector road after the main lane', () => {
    const sim = createRaceSimulation({
      seed: 104,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 60,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const pitLane = sim.track.pitLane;
    const exitPoint = pitLane.exit.roadCenterline[1] ?? pitLane.exit.roadCenterline[0];

    sim.completePitService(car);
    sim.setCarState('budget', {
      x: exitPoint.x,
      y: exitPoint.y,
      heading: exitPoint.heading ?? pitLane.exit.trackPoint.heading,
      speed: kphToSimSpeed(130),
      progress: pitLane.exit.trackDistance,
      raceDistance: car.pitStop.routeEndRaceDistance - 80,
    });
    car.pitStop.status = 'exiting';
    car.pitStop.phase = 'exit';
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('exiting');
    expect(car.brake).toBeLessThan(0.05);
  });

  test('automatic pit plans form bounded pit trains instead of one isolated stop per lap', () => {
    const sim = createRaceSimulation({
      seed: 99,
      drivers,
      totalLaps: 8,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 3,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const plannedEntryCounts = sim.cars.reduce((counts, car) => {
      const key = Math.round(car.pitStop?.entryRaceDistance ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map());

    expect([...plannedEntryCounts.values()].some((count) => count > 1)).toBe(true);
    expect(Math.max(...plannedEntryCounts.values())).toBeLessThanOrEqual(3);
  });

  test('allows a second pit train car to enter when the active car is far enough ahead', () => {
    const sim = createRaceSimulation({
      seed: 100,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 3),
      totalLaps: 6,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 2,
            minimumPitLaneGapMeters: 8,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 4,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const lead = sim.cars.find((entry) => entry.id === 'budget');
    const follower = sim.cars.find((entry) => entry.id === 'vinyl');

    expect(Math.round(lead.pitStop.entryRaceDistance)).toBe(Math.round(follower.pitStop.entryRaceDistance));

    const leadPoint = pointAt(sim.track, lead.pitStop.plannedRaceDistance + 2);
    sim.setCarState('budget', {
      x: leadPoint.x,
      y: leadPoint.y,
      heading: leadPoint.heading,
      speed: kphToSimSpeed(84),
      progress: leadPoint.distance,
      raceDistance: lead.pitStop.plannedRaceDistance + 2,
    });
    requestPitForRouteTest(sim, 'budget');
    for (let index = 0; index < 120 && lead.pitStop.status !== 'servicing'; index += 1) {
      sim.step(1 / 60);
    }
    expect(['entering', 'servicing']).toContain(lead.pitStop.status);

    const followerPoint = pointAt(sim.track, follower.pitStop.plannedRaceDistance + 2);
    sim.setCarState('vinyl', {
      x: followerPoint.x,
      y: followerPoint.y,
      heading: followerPoint.heading,
      speed: kphToSimSpeed(84),
      progress: followerPoint.distance,
      raceDistance: follower.pitStop.plannedRaceDistance + 2,
    });
    requestPitForRouteTest(sim, 'vinyl');
    sim.step(1 / 60);

    expect(follower.pitStop.status).toBe('entering');
  });

  test('keeps an opportunistic pit train car on track when the pit lane gap is too small', () => {
    const sim = createRaceSimulation({
      seed: 101,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 3),
      totalLaps: 6,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 2,
            minimumPitLaneGapMeters: 80,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 4,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const lead = sim.cars.find((entry) => entry.id === 'budget');
    const follower = sim.cars.find((entry) => entry.id === 'vinyl');
    const leadPoint = pointAt(sim.track, lead.pitStop.plannedRaceDistance + 2);
    const followerPoint = pointAt(sim.track, follower.pitStop.plannedRaceDistance + 2);

    sim.setCarState('budget', {
      x: leadPoint.x,
      y: leadPoint.y,
      heading: leadPoint.heading,
      speed: kphToSimSpeed(84),
      progress: leadPoint.distance,
      raceDistance: lead.pitStop.plannedRaceDistance + 2,
    });
    requestPitForRouteTest(sim, 'budget');
    sim.step(1 / 60);
    sim.setCarState('vinyl', {
      x: followerPoint.x,
      y: followerPoint.y,
      heading: followerPoint.heading,
      speed: kphToSimSpeed(84),
      progress: followerPoint.distance,
      raceDistance: follower.pitStop.plannedRaceDistance + 2,
    });
    expect(sim.setPitIntent('vinyl', 1)).toBe(true);
    sim.step(1 / 60);

    expect(lead.pitStop.status).toBe('entering');
    expect(follower.pitStop.status).toBe('pending');
    expect(sim.getPitIntent('vinyl')).toBe(1);
  });

  test('lets hosts request and read the next automatic pit entry intent', () => {
    const sim = createRaceSimulation({
      seed: 107,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const previousEntry = car.pitStop.entryRaceDistance;
    placeCarAtDistance(sim, 'budget', sim.track.length * 2 + 900, 84);

    expect(sim.setPitIntent('budget', 1)).toBe(true);
    expect(sim.getPitIntent('budget')).toBe(1);
    expect(car.pitStop.entryRaceDistance).toBeGreaterThan(car.raceDistance);
    expect(car.pitStop.entryRaceDistance).not.toBe(previousEntry);
    expect(sim.snapshot().cars.find((entry) => entry.id === 'budget').pitStop.intent).toBe(1);
  });

  test('default pit strategy requests stops from tyre condition thresholds', () => {
    const sim = createRaceSimulation({
      seed: 114,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: true },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    expect(sim.getPitIntent('budget')).toBe(0);

    car.tireEnergy = 49;
    sim.step(1 / 60);
    expect(sim.getPitIntent('budget')).toBe(1);

    car.tireEnergy = 29;
    sim.step(1 / 60);
    expect(sim.getPitIntent('budget')).toBe(2);
  });

  test('can disable tire-threshold pit automation for externally controlled cars', () => {
    const sim = createRaceSimulation({
      seed: 116,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: { enabled: true },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    expect(sim.setAutomaticPitIntentEnabled('budget', false)).toBe(true);
    car.tireEnergy = 1;
    sim.step(1 / 60);
    expect(sim.getPitIntent('budget')).toBe(0);

    expect(sim.setPitIntent('budget', 2)).toBe(true);
    expect(sim.getPitIntent('budget')).toBe(2);
  });

  test('custom pit strategy thresholds change automatic pit intent calls', () => {
    const sim = createRaceSimulation({
      seed: 115,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            tirePitRequestThresholdPercent: 65,
            tirePitCommitThresholdPercent: 45,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    car.tireEnergy = 60;
    sim.step(1 / 60);
    expect(sim.getPitIntent('budget')).toBe(1);

    car.tireEnergy = 44;
    sim.step(1 / 60);
    expect(sim.getPitIntent('budget')).toBe(2);
  });

  test('keeps opportunistic pit intent active after a blocked entry window', () => {
    const sim = createRaceSimulation({
      seed: 108,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 1,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const blocker = sim.cars.find((entry) => entry.id === 'noir');
    blocker.pitStop.status = 'entering';
    blocker.pitStop.route = { points: [], segments: [], length: 0 };

    expect(sim.setPitIntent('budget', 1)).toBe(true);
    placeCarAtDistance(sim, 'budget', car.pitStop.entryRaceDistance + metersToSimUnits(120), 84);
    const blockedEntry = car.pitStop.entryRaceDistance;
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('pending');
    expect(sim.getPitIntent('budget')).toBe(1);
    expect(Math.round(car.pitStop.entryRaceDistance)).toBe(Math.round(blockedEntry + sim.track.length));
  });

  test('committed pit intent enters even when capacity checks would block opportunistic entry', () => {
    const sim = createRaceSimulation({
      seed: 109,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 5,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            maxConcurrentPitLaneCars: 1,
            pitLaneSpeedLimitKph: 160,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const blocker = sim.cars.find((entry) => entry.id === 'noir');
    blocker.pitStop.status = 'entering';
    blocker.pitStop.route = { points: [], segments: [], length: 0 };

    expect(sim.setPitIntent('budget', 2)).toBe(true);
    placeCarAtDistance(sim, 'budget', car.pitStop.plannedRaceDistance + 2, 84);
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('entering');
    expect(sim.getPitIntent('budget')).toBe(2);
  });

  test('locks pit intent while the automatic pit sequence is active and clears it after exit', () => {
    const sim = createRaceSimulation({
      seed: 110,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    expect(sim.setPitIntent('budget', 2)).toBe(true);
    placeCarAtDistance(sim, 'budget', car.pitStop.plannedRaceDistance + 2, 84);
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('entering');
    expect(sim.setPitIntent('budget', 0)).toBe(false);

    for (let index = 0; index < 1500 && car.pitStop.status !== 'completed'; index += 1) {
      sim.step(1 / 15);
    }

    expect(car.pitStop.status).toBe('completed');
    expect(sim.getPitIntent('budget')).toBe(0);
  });

  test('rearmer allows another pit stop after a completed stop', () => {
    const sim = createRaceSimulation({
      seed: 117,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 8,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    expect(sim.setPitIntent('budget', 2)).toBe(true);
    placeCarAtDistance(sim, 'budget', car.pitStop.plannedRaceDistance + 2, 84);
    for (let index = 0; index < 1500 && car.pitStop.status !== 'completed'; index += 1) {
      sim.step(1 / 15);
    }
    expect(car.pitStop.status).toBe('completed');
    expect(car.pitStop.stopsCompleted).toBe(1);

    car.tireEnergy = 24;
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('pending');
    expect(sim.getPitIntent('budget')).toBe(2);
    expect(car.pitStop.entryRaceDistance).toBeGreaterThan(car.raceDistance);

    placeCarAtDistance(sim, 'budget', car.pitStop.plannedRaceDistance + 2, 84);
    sim.step(1 / 60);
    expect(car.pitStop.status).toBe('entering');
  });

  test('allows committed pit intent under safety car race mode', () => {
    const sim = createRaceSimulation({
      seed: 111,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    sim.setSafetyCar(true);
    expect(sim.snapshot().raceControl.mode).toBe('safety-car');
    expect(sim.setPitIntent('budget', 2)).toBe(true);
    placeCarAtDistance(sim, 'budget', car.pitStop.plannedRaceDistance + 2, 84);
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('entering');
  });

  test('closed pit lane keeps pending pit calls on track until race control opens it', () => {
    const sim = createRaceSimulation({
      seed: 112,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');

    sim.setPitLaneOpen(false);
    expect(sim.snapshot().raceControl.pitLaneOpen).toBe(false);
    expect(sim.snapshot().pitLaneStatus).toMatchObject({ open: false, color: 'red' });
    expect(sim.setPitIntent('budget', 2, 'H')).toBe(true);
    placeCarAtDistance(sim, 'budget', car.pitStop.plannedRaceDistance + 2, 84);
    sim.step(1 / 60);

    expect(car.pitStop.status).toBe('pending');
    expect(sim.getPitIntent('budget')).toBe(2);
    expect(car.trackState.inPitLane).toBeFalsy();

    sim.setPitLaneOpen(true);
    sim.step(1 / 60);
    expect(sim.snapshot().pitLaneStatus).toMatchObject({ open: true, color: 'green' });
    expect(car.pitStop.status).toBe('entering');
  });

  test('red flag freezes race movement until it is cleared', () => {
    const sim = createRaceSimulation({
      seed: 113,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: { standingStart: false },
    });
    placeCarAtDistance(sim, 'budget', 1200, 120);
    const before = sim.snapshot().cars.find((entry) => entry.id === 'budget');

    sim.setRedFlag(true);
    sim.step(1);
    const redFlagSnapshot = sim.snapshot();
    const held = redFlagSnapshot.cars.find((entry) => entry.id === 'budget');

    expect(redFlagSnapshot.raceControl).toMatchObject({
      mode: 'red-flag',
      redFlag: true,
    });
    expect(held.raceDistance).toBeCloseTo(before.raceDistance);
    expect(held.speedKph).toBe(0);

    sim.setRedFlag(false);
    run(sim, 1);
    const released = sim.snapshot().cars.find((entry) => entry.id === 'budget');
    expect(sim.snapshot().raceControl.redFlag).toBe(false);
    expect(released.raceDistance).toBeGreaterThan(held.raceDistance);
  });

  test('pit entry is driven through steering instead of kinematic heading snapping', () => {
    const sim = createRaceSimulation({
      seed: 98,
      trackSeed: 20260430,
      drivers: drivers.slice(0, 2),
      totalLaps: 4,
      rules: {
        standingStart: false,
        modules: {
          pitStops: {
            enabled: true,
            pitLaneSpeedLimitKph: 160,
            defaultStopSeconds: 0.25,
          },
          tireStrategy: { enabled: true },
        },
      },
    });
    const car = sim.cars.find((entry) => entry.id === 'budget');
    const callDistance = car.pitStop.plannedRaceDistance + 2;
    const callPoint = pointAt(sim.track, callDistance);

    sim.setCarState('budget', {
      x: callPoint.x,
      y: callPoint.y,
      heading: callPoint.heading,
      speed: kphToSimSpeed(84),
      progress: callPoint.distance,
      raceDistance: callDistance,
    });
    requestPitForRouteTest(sim, 'budget');

    let maxSteer = 0;
    let maxYaw = 0;
    let minimumForwardRatio = 1;
    for (let index = 0; index < 80 && car.pitStop.status === 'pending'; index += 1) {
      sim.step(1 / 60);
    }
    for (let index = 0; index < 120 && car.pitStop.status === 'entering'; index += 1) {
      const before = { x: car.x, y: car.y, heading: car.heading };
      sim.step(1 / 60);
      const dx = car.x - before.x;
      const dy = car.y - before.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.001) {
        const forward = Math.cos(before.heading) * dx + Math.sin(before.heading) * dy;
        minimumForwardRatio = Math.min(minimumForwardRatio, forward / distance);
      }
      maxSteer = Math.max(maxSteer, Math.abs(car.steeringAngle ?? 0));
      maxYaw = Math.max(maxYaw, Math.abs(car.yawRate ?? 0));
    }

    expect(maxSteer).toBeGreaterThan(0.004);
    expect(maxYaw).toBeGreaterThan(0.001);
    expect(minimumForwardRatio).toBeGreaterThan(0.25);
  });

  test('publishes automatic track sectors and per-car lap telemetry', () => {
    const sim = createRaceSimulation({
      seed: 60,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const sectorLength = track.length / 3;

    expect(track.sectors).toHaveLength(3);
    expect(track.sectors.map((sector) => sector.label)).toEqual(['S1', 'S2', 'S3']);
    expect(track.sectors[0]).toMatchObject({ index: 1, id: 's1', start: 0, startRatio: 0 });
    expect(track.sectors[2].end).toBeCloseTo(track.length, 5);

    placeCarAtDistance(sim, 'budget', sectorLength - 35, 100);
    expect(sim.snapshot().cars[0].lapTelemetry).toMatchObject({
      currentLap: 1,
      currentSector: 1,
      completedLaps: 0,
    });

    run(sim, 0.7);
    const sectorSnapshot = sim.snapshot().cars[0].lapTelemetry;

    expect(sectorSnapshot.currentSector).toBe(2);
    expect(sectorSnapshot.currentSectors[0]).toBeGreaterThan(0);
    expect(sectorSnapshot.bestSectors[0]).toBe(sectorSnapshot.currentSectors[0]);
    expect(sectorSnapshot.currentSectorProgress).toBeGreaterThanOrEqual(0);
    expect(sectorSnapshot.currentSectorProgress).toBeLessThanOrEqual(1);

    placeCarAtDistance(sim, 'budget', track.length - 35, 100);
    run(sim, 0.7);
    const lapSnapshot = sim.snapshot().cars[0].lapTelemetry;

    expect(lapSnapshot.currentLap).toBe(2);
    expect(lapSnapshot.currentSector).toBe(1);
    expect(lapSnapshot.completedLaps).toBe(1);
    expect(lapSnapshot.lastLapTime).toBeGreaterThan(0);
    expect(lapSnapshot.bestLapTime).toBe(lapSnapshot.lastLapTime);
    expect(lapSnapshot.lastSectors[2]).toBeGreaterThan(0);
    expect(lapSnapshot.bestSectors[2]).toBe(lapSnapshot.lastSectors[2]);
  });

  test('keeps sector crossing telemetry accurate after stationary updates', () => {
    const sim = createRaceSimulation({
      seed: 62,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const sectorLength = track.length / 3;
    const car = sim.cars.find((item) => item.id === 'budget');

    placeCarAtDistance(sim, 'budget', sectorLength - 30, 0);

    sim.time = 5;
    sim.recalculateRaceState({ updateDrs: false });
    expect(car.lapTelemetry.lastUpdatedAt).toBeCloseTo(5, 5);

    moveCarBodyToDistance(sim, 'budget', sectorLength + 30);
    sim.time = 5.2;
    sim.recalculateRaceState({ updateDrs: false });

    expect(car.lapTelemetry.currentSector).toBe(2);
    expect(car.lapTelemetry.currentSectors[0]).toBeCloseTo(5.085, 2);
  });

  test('publishes live in-progress sector times and sector progress', () => {
    const sim = createRaceSimulation({
      seed: 63,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const sectorLength = track.length / 3;

    placeCarAtDistance(sim, 'budget', sectorLength - 60, 110);
    run(sim, 1.3);
    const telemetry = sim.snapshot().cars[0].lapTelemetry;

    expect(telemetry.currentSector).toBe(2);
    expect(telemetry.currentSectors[0]).toBeGreaterThan(0);
    expect(telemetry.currentSectors[1]).toBeNull();
    expect(telemetry.sectorProgress[0]).toBe(1);
    expect(telemetry.sectorProgress[1]).toBeGreaterThan(0);
    expect(telemetry.sectorProgress[1]).toBeLessThan(1);
    expect(telemetry.sectorProgress[2]).toBe(0);
    expect(telemetry.liveSectors[0]).toBe(telemetry.currentSectors[0]);
    expect(telemetry.liveSectors[1]).toBeCloseTo(telemetry.currentSectorElapsed, 5);
    expect(telemetry.liveSectors[2]).toBeNull();
  });

  test('does not mark earlier sectors complete when their split times are missing', () => {
    const sim = createRaceSimulation({
      seed: 64,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const sectorLength = track.length / 3;

    placeCarAtDistance(sim, 'budget', sectorLength * 2.75, 0);
    const telemetry = sim.snapshot().cars[0].lapTelemetry;

    expect(telemetry.currentSector).toBe(3);
    expect(telemetry.currentSectors).toEqual([null, null, null]);
    expect(telemetry.sectorProgress[0]).toBe(0);
    expect(telemetry.sectorProgress[1]).toBe(0);
    expect(telemetry.sectorProgress[2]).toBeGreaterThan(0.7);
    expect(telemetry.liveSectors[0]).toBeNull();
    expect(telemetry.liveSectors[1]).toBeNull();
    expect(telemetry.liveSectors[2]).toBe(0);
  });

  test('clears stale future sector telemetry for every active sector', () => {
    const sim = createRaceSimulation({
      seed: 65,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const car = sim.cars.find((item) => item.id === 'budget');
    const sectorLength = track.length / 3;
    const staleValues = [11.1, 22.2, 33.3];

    for (let activeIndex = 0; activeIndex < 3; activeIndex += 1) {
      const distance = track.length + sectorLength * (activeIndex + 0.25);
      placeCarAtDistance(sim, 'budget', distance, 0);
      Object.assign(car.lapTelemetry, {
        currentLapStartedAt: sim.time - 4,
        currentSectorStartedAt: sim.time - 4,
        currentSectors: [...staleValues],
        liveSectors: [...staleValues],
        sectorProgress: [1, 1, 1],
      });

      sim.recalculateRaceState({ updateDrs: false });
      const telemetry = sim.snapshot().cars[0].lapTelemetry;

      expect(telemetry.currentSector).toBe(activeIndex + 1);
      telemetry.currentSectors.forEach((value, index) => {
        if (index < activeIndex) expect(value).toBe(staleValues[index]);
        else expect(value).toBeNull();
      });
      telemetry.liveSectors.forEach((value, index) => {
        if (index < activeIndex) expect(value).toBe(staleValues[index]);
        else if (index === activeIndex) expect(value).toBeCloseTo(4, 5);
        else expect(value).toBeNull();
      });
      telemetry.sectorProgress.forEach((value, index) => {
        if (index < activeIndex) expect(value).toBe(1);
        else if (index === activeIndex) expect(value).toBeGreaterThan(0);
        else expect(value).toBe(0);
      });
    }
  });

  test('classifies sector times as overall best, personal best, or slower', () => {
    const sim = createRaceSimulation({
      seed: 61,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const first = sim.cars.find((car) => car.id === 'budget');
    const second = sim.cars.find((car) => car.id === 'noir');
    const track = sim.snapshot().track;
    const sectorLength = track.length / 3;
    [first, second].forEach((car, index) => {
      const raceDistance = sectorLength + metersToSimUnits(12 + index * 140);
      const point = pointAt(track, raceDistance);
      const positioned = offsetTrackPoint(point, 0);
      Object.assign(car, {
        x: positioned.x,
        y: positioned.y,
        heading: point.heading,
        progress: point.distance,
        raceDistance,
      });
    });

    first.lapTelemetry.currentSectors = [31, null, null];
    first.lapTelemetry.lastSectors = [31, null, null];
    first.lapTelemetry.bestSectors = [29, null, null];
    second.lapTelemetry.currentSectors = [28, null, null];
    second.lapTelemetry.lastSectors = [30, null, null];
    second.lapTelemetry.bestSectors = [28, null, null];

    sim.recalculateRaceState({ updateDrs: false });
    const snapshot = sim.snapshot();
    const budget = snapshot.cars.find((car) => car.id === 'budget');
    const noir = snapshot.cars.find((car) => car.id === 'noir');

    expect(budget.lapTelemetry.sectorPerformance.current[0]).toBe('slower');
    expect(budget.lapTelemetry.sectorPerformance.best[0]).toBe('personal-best');
    expect(noir.lapTelemetry.sectorPerformance.current[0]).toBe('overall-best');
    expect(noir.lapTelemetry.sectorPerformance.best[0]).toBe('overall-best');
  });

  test('raises live aggression as race position gets worse', () => {
    const personalityDrivers = [
      { id: 'front', code: 'FRO', name: 'Front Runner', color: '#ff3860', pace: 1, racecraft: 0.78, personality: { aggression: 0.34 } },
      { id: 'middle', code: 'MID', name: 'Mid Pack', color: '#ff9f1c', pace: 1, racecraft: 0.78, personality: { aggression: 0.34 } },
      { id: 'back', code: 'BAK', name: 'Back Marker', color: '#06d6a0', pace: 1, racecraft: 0.78, personality: { aggression: 0.34 } },
    ];
    const sim = createRaceSimulation({ seed: 91, drivers: personalityDrivers, totalLaps: 3 });

    placeCarAtDistance(sim, 'front', 1100, 82);
    placeCarAtDistance(sim, 'middle', 1000, 82);
    placeCarAtDistance(sim, 'back', 900, 82);

    const [front, middle, back] = sim.snapshot().cars;

    expect(front.id).toBe('front');
    expect(middle.id).toBe('middle');
    expect(back.id).toBe('back');
    expect(front.personality.baseAggression).toBeCloseTo(0.34);
    expect(Number.isFinite(front.aggression)).toBe(true);
    expect(middle.aggression).toBeGreaterThan(front.aggression);
    expect(back.aggression).toBeGreaterThan(middle.aggression);
    expect(back.aggression).toBeGreaterThan(back.personality.baseAggression + 0.2);
  });

  test('aggressive trailing drivers commit harder to passing lanes', () => {
    const sim = createRaceSimulation({
      seed: 92,
      drivers: [
        { id: 'leader', code: 'LED', name: 'Leader', color: '#ff3860', pace: 1, racecraft: 0.78 },
        { id: 'chaser', code: 'CHS', name: 'Chaser', color: '#118ab2', pace: 1, racecraft: 0.78 },
      ],
      totalLaps: 3,
    });

    placeCarAtDistance(sim, 'leader', 1100, 80, 0);
    placeCarAtDistance(sim, 'chaser', 980, 84, 0);

    const chaser = sim.cars.find((car) => car.id === 'chaser');
    chaser.desiredOffset = 0;
    chaser.aggression = 0.2;
    const cautiousPlan = planRacingLine(chaser, 1, sim.driverRaceContext());

    chaser.desiredOffset = 0;
    chaser.aggression = 0.92;
    const aggressivePlan = planRacingLine(chaser, 1, sim.driverRaceContext());

    expect(Math.abs(aggressivePlan.offset)).toBeGreaterThan(Math.abs(cautiousPlan.offset));
    expect(Math.abs(aggressivePlan.offset)).toBeGreaterThan(1.3);
  });

  test('resolves oriented car collisions so bodies cannot phase through each other', () => {
    const sim = createRaceSimulation({ seed: 8, drivers: drivers.slice(0, 2), totalLaps: 3 });
    sim.setCarState('budget', { x: 520, y: 360, heading: 0, speed: kphToSimSpeed(65) });
    sim.setCarState('noir', { x: 535, y: 360, heading: 0, speed: kphToSimSpeed(130) });

    sim.step(1 / 60);

    const snapshot = sim.snapshot();
    const first = snapshot.cars.find((car) => car.id === 'budget');
    const second = snapshot.cars.find((car) => car.id === 'noir');

    expect(polygonsOverlap(getCarCorners(first), getCarCorners(second))).toBe(false);
    expect(snapshot.events.some((event) => event.type === 'contact')).toBe(true);
  });

  test('keeps previous render poses aligned with collision separation', () => {
    const sim = createRaceSimulation({ seed: 8, drivers: drivers.slice(0, 2), totalLaps: 3 });
    sim.setCarState('budget', { x: 520, y: 360, heading: 0, speed: kphToSimSpeed(65) });
    sim.setCarState('noir', { x: 535, y: 360, heading: 0, speed: kphToSimSpeed(130) });

    sim.step(1 / 60);

    const snapshot = sim.snapshot();
    const first = snapshot.cars.find((car) => car.id === 'budget');
    const second = snapshot.cars.find((car) => car.id === 'noir');
    const firstPreviousPose = {
      ...first,
      x: first.previousX,
      y: first.previousY,
      heading: first.previousHeading,
    };
    const secondPreviousPose = {
      ...second,
      x: second.previousX,
      y: second.previousY,
      heading: second.previousHeading,
    };

    expect(polygonsOverlap(getCarCorners(first), getCarCorners(second))).toBe(false);
    expect(polygonsOverlap(getCarCorners(firstPreviousPose), getCarCorners(secondPreviousPose))).toBe(false);
  });

  test('resolves nose-to-tail contact across the full rendered car length', () => {
    const sim = createRaceSimulation({ seed: 8, drivers: drivers.slice(0, 2), totalLaps: 3 });
    const trackPoint = pointAt(sim.snapshot().track, 960);
    sim.setCarState('budget', { x: trackPoint.x, y: trackPoint.y, heading: trackPoint.heading, speed: 26 });
    sim.setCarState('noir', {
      x: trackPoint.x + Math.cos(trackPoint.heading) * 44,
      y: trackPoint.y + Math.sin(trackPoint.heading) * 44,
      heading: trackPoint.heading,
      speed: 22,
    });

    sim.step(1 / 60);

    const snapshot = sim.snapshot();
    const first = snapshot.cars.find((car) => car.id === 'budget');
    const second = snapshot.cars.find((car) => car.id === 'noir');

    expect(polygonsOverlap(getCarCorners(first), getCarCorners(second))).toBe(false);
    expect(snapshot.events.some((event) => event.type === 'contact')).toBe(true);
  });

  test('does not invent nose-to-tail contact before vehicle geometry overlaps', () => {
    const sim = createRaceSimulation({
      seed: 11,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const trackPoint = pointAt(sim.snapshot().track, 1320);
    const gap = VEHICLE_LIMITS.carLength * 0.93;
    const noirPoint = pointAt(sim.snapshot().track, 1320 + gap);
    sim.setCarState('budget', {
      x: trackPoint.x,
      y: trackPoint.y,
      heading: trackPoint.heading,
      speed: 48,
      progress: trackPoint.distance,
      raceDistance: trackPoint.distance,
    });
    sim.setCarState('noir', {
      x: noirPoint.x,
      y: noirPoint.y,
      heading: noirPoint.heading,
      speed: 42,
      progress: noirPoint.distance,
      raceDistance: noirPoint.distance,
    });

    sim.step(1 / 60);

    const snapshot = sim.snapshot();
    const first = snapshot.cars.find((car) => car.id === 'budget');
    const second = snapshot.cars.find((car) => car.id === 'noir');
    const physicalGap = Math.hypot(second.x - first.x, second.y - first.y);

    expect(second.raceDistance - first.raceDistance).toBeGreaterThan(VEHICLE_LIMITS.carLength * 0.86);
    expect(physicalGap).toBeLessThan(VEHICLE_LIMITS.carLength * 1.08);
    expect(polygonsOverlap(getCarCorners(first), getCarCorners(second))).toBe(false);
    expect(snapshot.events.some((event) => event.type === 'contact')).toBe(false);
  });

  test('DRS creates a measurable straight-line speed advantage', () => {
    const baseCar = {
      x: 0,
      y: 0,
      heading: 0,
      steeringAngle: 0,
      speed: kphToSimSpeed(155),
      mass: 798,
      powerNewtons: 43000,
      brakeNewtons: 59000,
      dragCoefficient: 0.33,
      downforceCoefficient: 6.1,
      tireGrip: 2.4,
      trackState: { surface: 'track' },
      tireEnergy: 100,
    };
    const normal = { ...baseCar, drsActive: false };
    const drs = { ...baseCar, drsActive: true };

    for (let elapsed = 0; elapsed < 2; elapsed += 1 / 60) {
      integrateVehiclePhysics(normal, { steering: 0, throttle: 1, brake: 0 }, 1 / 60);
      integrateVehiclePhysics(drs, { steering: 0, throttle: 1, brake: 0 }, 1 / 60);
    }

    expect(simSpeedToKph(drs.speed)).toBeGreaterThan(simSpeedToKph(normal.speed) + 4);
  });

  test('straight-line acceleration follows a power-limited curve instead of jumping to top speed', () => {
    const car = {
      x: 0,
      y: 0,
      heading: 0,
      steeringAngle: 0,
      speed: 0,
      mass: 798,
      powerNewtons: 43000,
      brakeNewtons: 59000,
      dragCoefficient: 0.33,
      downforceCoefficient: 6.1,
      tireGrip: 2.4,
      trackState: { surface: 'track' },
      tireEnergy: 100,
      drsActive: false,
    };

    expect(simSpeedToKph(VEHICLE_LIMITS.maxSpeed)).toBeGreaterThan(325);
    expect(simSpeedToKph(VEHICLE_LIMITS.maxSpeed)).toBeLessThan(335);

    integrateVehiclePhysics(car, { steering: 0, throttle: 1, brake: 0 }, 1);
    const oneSecondSpeed = car.speed;

    for (let elapsed = 0; elapsed < 1; elapsed += 1 / 60) {
      integrateVehiclePhysics(car, { steering: 0, throttle: 1, brake: 0 }, 1 / 60);
    }
    const twoSecondSpeed = car.speed;

    for (let elapsed = 0; elapsed < 6; elapsed += 1 / 60) {
      integrateVehiclePhysics(car, { steering: 0, throttle: 1, brake: 0 }, 1 / 60);
    }
    const eightSecondSpeed = car.speed;

    for (let elapsed = 0; elapsed < 8; elapsed += 1 / 60) {
      integrateVehiclePhysics(car, { steering: 0, throttle: 1, brake: 0 }, 1 / 60);
    }
    const sixteenSecondSpeed = car.speed;

    expect(simSpeedToKph(oneSecondSpeed)).toBeLessThan(80);
    expect(simSpeedToKph(twoSecondSpeed)).toBeLessThan(145);
    expect(simSpeedToKph(eightSecondSpeed)).toBeGreaterThan(280);
    expect(simSpeedToKph(eightSecondSpeed)).toBeLessThan(325);
    expect(simSpeedToKph(sixteenSecondSpeed)).toBeGreaterThan(325);
    expect(sixteenSecondSpeed).toBeLessThanOrEqual(VEHICLE_LIMITS.maxSpeed);
    expect(eightSecondSpeed - twoSecondSpeed).toBeGreaterThan(sixteenSecondSpeed - eightSecondSpeed);
  });

  test('tyre energy can degrade to one percent instead of clamping early', () => {
    const car = {
      x: 0,
      y: 0,
      heading: 0,
      steeringAngle: 0.48,
      speed: kphToSimSpeed(142),
      mass: 798,
      powerNewtons: 43000,
      brakeNewtons: 59000,
      dragCoefficient: 0.33,
      downforceCoefficient: 6.1,
      tireGrip: 2.4,
      tireCare: 0.6,
      trackState: { surface: 'track' },
      tireEnergy: 4,
      drsActive: false,
    };

    for (let elapsed = 0; elapsed < 80; elapsed += 1 / 60) {
      integrateVehiclePhysics(car, { steering: 0.48, throttle: 1, brake: 0.2 }, 1 / 60);
    }

    expect(car.tireEnergy).toBeCloseTo(1, 1);
    expect(car.tireEnergy).toBeGreaterThanOrEqual(1);
  });

  test('tyre performance follows a nonlinear degradation curve with real grip impact', () => {
    expect(tirePerformanceFactor(100)).toBeCloseTo(1);
    expect(tirePerformanceFactor(50)).toBeLessThan(0.9);
    expect(tirePerformanceFactor(50)).toBeGreaterThan(0.72);
    expect(tirePerformanceFactor(30)).toBeLessThan(tirePerformanceFactor(50));
    expect(tirePerformanceFactor(30)).toBeGreaterThan(0.62);
    expect(tirePerformanceFactor(1)).toBeLessThan(0.55);

    const makeCar = (tireEnergy) => ({
      x: 0,
      y: 0,
      heading: 0,
      steeringAngle: 0,
      speed: kphToSimSpeed(118),
      mass: 798,
      powerNewtons: 43000,
      brakeNewtons: 59000,
      dragCoefficient: 0.33,
      downforceCoefficient: 6.1,
      tireGrip: 2.4,
      tireCare: 1,
      trackState: { surface: 'track' },
      tireEnergy,
      drsActive: false,
    });
    const fresh = makeCar(100);
    const worn = makeCar(20);

    integrateVehiclePhysics(fresh, { steering: 0.5, throttle: 1, brake: 0 }, 1 / 60);
    integrateVehiclePhysics(worn, { steering: 0.5, throttle: 1, brake: 0 }, 1 / 60);

    expect(Math.abs(worn.yawRate)).toBeLessThan(Math.abs(fresh.yawRate) * 0.7);
    expect(worn.speed).toBeLessThan(fresh.speed);
  });

  test('uses vehicle constructor arguments as the car physics setup', () => {
    const sim = createRaceSimulation({
      seed: 44,
      drivers: [{
        id: 'custom',
        code: 'CUS',
        name: 'Custom Pair',
        color: '#ffffff',
        pace: 1,
        racecraft: 0.78,
        vehicle: {
          id: 'custom-vehicle',
          name: 'Custom Vehicle',
          mass: 790,
          powerNewtons: 45200,
          brakeNewtons: 61300,
          dragCoefficient: 0.305,
          downforceCoefficient: 6.32,
          tireGrip: 2.48,
        },
      }],
      totalLaps: 3,
      rules: { standingStart: false },
    });

    const setup = sim.snapshot().cars[0].setup;

    expect(setup.massKg).toBe(790);
    expect(setup.powerUnitKn).toBeCloseTo(45.2);
    expect(setup.brakeSystemKn).toBeCloseTo(61.3);
    expect(setup.dragCoefficient).toBeCloseTo(0.305);
    expect(setup.downforceCoefficient).toBeCloseTo(6.32);
    expect(setup.tireGrip).toBeCloseTo(2.48);
  });

  test('maximum braking cannot make a car stop instantly from racing speed', () => {
    const car = {
      x: 0,
      y: 0,
      heading: 0,
      steeringAngle: 0,
      speed: VEHICLE_LIMITS.maxSpeed,
      mass: 798,
      powerNewtons: 43000,
      brakeNewtons: 59000,
      dragCoefficient: 0.33,
      downforceCoefficient: 6.1,
      tireGrip: 2.4,
      trackState: { surface: 'track' },
      tireEnergy: 100,
      drsActive: false,
    };

    integrateVehiclePhysics(car, { steering: 0, throttle: 0, brake: 1 }, 0.5);
    expect(car.speed).toBeGreaterThan(VEHICLE_LIMITS.maxSpeed * 0.72);

    integrateVehiclePhysics(car, { steering: 0, throttle: 0, brake: 1 }, 0.5);
    expect(car.speed).toBeGreaterThan(VEHICLE_LIMITS.maxSpeed * 0.45);
  });

  test('DRS latches at the detection point until the zone ends', () => {
    const sim = createRaceSimulation({ seed: 31, drivers: drivers.slice(0, 2), totalLaps: 3 });
    const track = sim.snapshot().track;
    const zone = track.drsZones[0];
    const leaderPoint = pointAt(track, zone.start + metersToSimUnits(70));
    const chasingPoint = pointAt(track, zone.start - metersToSimUnits(5));

    sim.setCarState('budget', {
      x: leaderPoint.x,
      y: leaderPoint.y,
      heading: leaderPoint.heading,
      speed: kphToSimSpeed(70),
      raceDistance: zone.start + metersToSimUnits(70),
      progress: leaderPoint.distance,
    });
    sim.setCarState('noir', {
      x: chasingPoint.x,
      y: chasingPoint.y,
      heading: chasingPoint.heading,
      speed: kphToSimSpeed(82),
      raceDistance: zone.start - metersToSimUnits(5),
      progress: chasingPoint.distance,
    });
    sim.cars.find((car) => car.id === 'budget').drsDetection = {
      [zone.id]: { passage: 1, time: sim.time },
    };

    run(sim, 0.16);
    let snapshot = sim.snapshot();
    let chasing = snapshot.cars.find((car) => car.id === 'noir');

    expect(chasing.drsActive).toBe(true);
    expect(chasing.drsZoneId).toBe(zone.id);

    const farLeaderPoint = pointAt(track, chasing.progress + metersToSimUnits(250));
    sim.setCarState('budget', {
      x: farLeaderPoint.x,
      y: farLeaderPoint.y,
      heading: farLeaderPoint.heading,
      speed: kphToSimSpeed(90),
      raceDistance: chasing.raceDistance + metersToSimUnits(250),
      progress: farLeaderPoint.distance,
    });
    sim.step(1 / 60);
    snapshot = sim.snapshot();
    chasing = snapshot.cars.find((car) => car.id === 'noir');

    expect(chasing.gapAheadSeconds).toBeGreaterThan(1);
    expect(chasing.drsActive).toBe(true);

    const afterZonePoint = pointAt(track, zone.end + metersToSimUnits(20));
    sim.setCarState('noir', {
      x: afterZonePoint.x,
      y: afterZonePoint.y,
      heading: afterZonePoint.heading,
      speed: kphToSimSpeed(90),
      raceDistance: zone.end + metersToSimUnits(20),
      progress: afterZonePoint.distance,
    });
    sim.step(1 / 60);
    chasing = sim.snapshot().cars.find((car) => car.id === 'noir');

    expect(chasing.drsActive).toBe(false);
    expect(chasing.drsZoneId).toBe(null);
  });

  test('DRS detection can use physically-ahead lapped traffic', () => {
    const sim = createRaceSimulation({ seed: 31, drivers: drivers.slice(0, 2), totalLaps: 3 });
    const track = sim.snapshot().track;
    const zone = track.drsZones[0];
    const lappedPoint = pointAt(track, zone.start + metersToSimUnits(45));
    const leaderPoint = pointAt(track, zone.start - metersToSimUnits(5));

    sim.setCarState('noir', {
      x: lappedPoint.x,
      y: lappedPoint.y,
      heading: lappedPoint.heading,
      speed: kphToSimSpeed(70),
      raceDistance: zone.start + metersToSimUnits(45),
      progress: lappedPoint.distance,
    });
    sim.setCarState('budget', {
      x: leaderPoint.x,
      y: leaderPoint.y,
      heading: leaderPoint.heading,
      speed: kphToSimSpeed(82),
      raceDistance: zone.start - metersToSimUnits(5) + track.length,
      progress: leaderPoint.distance,
    });
    sim.cars.find((car) => car.id === 'noir').drsDetection = {
      [zone.id]: { passage: 1, time: sim.time },
    };

    run(sim, 0.16);
    const snapshot = sim.snapshot();
    const leader = snapshot.cars.find((car) => car.id === 'budget');

    expect(leader.rank).toBe(1);
    expect(leader.drsActive).toBe(true);
    expect(leader.drsZoneId).toBe(zone.id);
  });

  test('estimates the gap to the car ahead from crossed track time, not the trailing car speed', () => {
    const sim = createRaceSimulation({
      seed: 57,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const leader = sim.cars.find((car) => car.id === 'budget');
    const chaser = sim.cars.find((car) => car.id === 'noir');
    const lineNumber = 8;
    const lineDistance = sim.track.timingLines.spacing * lineNumber;
    const leaderDistance = lineDistance + 60;
    const chaserDistance = lineDistance + 10;
    const leaderPoint = pointAt(sim.track, leaderDistance);
    const chaserPoint = pointAt(sim.track, chaserDistance);

    sim.time = 12;
    Object.assign(leader, {
      x: leaderPoint.x,
      y: leaderPoint.y,
      heading: leaderPoint.heading,
      speed: 60,
      progress: leaderPoint.distance,
      raceDistance: leaderDistance,
      previousRaceDistanceForTiming: leaderDistance,
      timingLineLastUpdatedAt: 12,
      timingLineCrossings: { [lineNumber]: 11 },
      timingHistory: [
        { time: 11, raceDistance: chaserDistance },
        { time: 12, raceDistance: leaderDistance },
      ],
    });
    Object.assign(chaser, {
      x: chaserPoint.x,
      y: chaserPoint.y,
      heading: chaserPoint.heading,
      speed: 120,
      progress: chaserPoint.distance,
      raceDistance: chaserDistance,
      previousRaceDistanceForTiming: chaserDistance,
      timingLineLastUpdatedAt: 12,
      timingLineCrossings: { [lineNumber]: 12 },
      timingHistory: [
        { time: 12, raceDistance: chaserDistance },
      ],
    });

    sim.recalculateRaceState({ updateDrs: false });
    const snapshot = sim.snapshot();
    const noir = snapshot.cars.find((car) => car.id === 'noir');
    const trailingSpeedEstimate = noir.gapAhead / Math.max(noir.speed, 1);

    expect(trailingSpeedEstimate).toBeLessThan(0.55);
    expect(noir.gapAheadSeconds).toBeCloseTo(1, 1);
  });

  test('publishes separate interval and leader gap timing values', () => {
    const sim = createRaceSimulation({
      seed: 58,
      drivers: drivers.slice(0, 3),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const [leader, second, third] = sim.cars;
    const lineNumber = 8;
    const lineDistance = sim.track.timingLines.spacing * lineNumber;

    [
      [leader, lineDistance + 120, 10],
      [second, lineDistance + 60, 11],
      [third, lineDistance + 10, 12],
    ].forEach(([car, raceDistance, crossingTime]) => {
      const trackPoint = pointAt(sim.track, raceDistance);
      Object.assign(car, {
        x: trackPoint.x,
        y: trackPoint.y,
        heading: trackPoint.heading,
        speed: 60,
        progress: trackPoint.distance,
        raceDistance,
        previousRaceDistanceForTiming: raceDistance,
        timingLineLastUpdatedAt: 12,
        timingLineCrossings: { [lineNumber]: crossingTime },
        timingHistory: [
          { time: crossingTime, raceDistance: lineDistance },
          { time: 12, raceDistance },
        ],
      });
    });
    sim.time = 12;

    sim.recalculateRaceState({ updateDrs: false });
    const snapshot = sim.snapshot();
    const secondCar = snapshot.cars[1];
    const thirdCar = snapshot.cars[2];

    expect(secondCar.intervalAheadSeconds).toBeCloseTo(1, 1);
    expect(secondCar.leaderGapSeconds).toBeCloseTo(1, 1);
    expect(thirdCar.intervalAheadSeconds).toBeCloseTo(1, 1);
    expect(thirdCar.leaderGapSeconds).toBeCloseTo(2, 1);
  });

  test('publishes lap-count gaps instead of second gaps for lapped cars', () => {
    const sim = createRaceSimulation({
      seed: 60,
      drivers: drivers.slice(0, 3),
      totalLaps: 5,
      rules: { standingStart: false },
    });
    const [leader, lapped, doubleLapped] = sim.cars;

    [
      [leader, sim.track.length * 3 + 1200],
      [lapped, sim.track.length * 2 + 1170],
      [doubleLapped, sim.track.length + 1150],
    ].forEach(([car, raceDistance]) => {
      const trackPoint = pointAt(sim.track, raceDistance);
      Object.assign(car, {
        x: trackPoint.x,
        y: trackPoint.y,
        heading: trackPoint.heading,
        speed: 60,
        progress: trackPoint.distance,
        raceDistance,
        timingHistory: [
          { time: 8, raceDistance: raceDistance - 240 },
          { time: 10, raceDistance: raceDistance - 120 },
          { time: 12, raceDistance },
        ],
      });
    });
    sim.time = 12;

    sim.recalculateRaceState({ updateDrs: false });
    const snapshot = sim.snapshot();

    expect(snapshot.cars.map((car) => car.id)).toEqual(['budget', 'noir', 'vinyl']);
    expect(snapshot.cars[1].intervalAheadLaps).toBe(1);
    expect(snapshot.cars[1].leaderGapLaps).toBe(1);
    expect(snapshot.cars[1].intervalAheadSeconds).toBe(Infinity);
    expect(snapshot.cars[1].leaderGapSeconds).toBe(Infinity);
    expect(snapshot.cars[2].intervalAheadLaps).toBe(1);
    expect(snapshot.cars[2].leaderGapLaps).toBe(2);
    expect(snapshot.cars[2].intervalAheadSeconds).toBe(Infinity);
    expect(snapshot.cars[2].leaderGapSeconds).toBe(Infinity);
  });

  test('converts simulator units to real-world distance and speed for public snapshots', () => {
    expect(SIM_UNITS_PER_METER).toBeCloseTo((VEHICLE_LIMITS.maxSpeed * 3.6) / TARGET_F1_TOP_SPEED_KPH, 5);
    expect(REAL_F1_CAR_LENGTH_METERS).toBeCloseTo(5.63, 2);
    expect(REAL_F1_CAR_WIDTH_METERS).toBeCloseTo(1.9, 2);
    expect(VISUAL_CAR_LENGTH_METERS).toBeCloseTo(REAL_F1_CAR_LENGTH_METERS, 5);
    expect(VISUAL_CAR_WIDTH_METERS).toBeCloseTo(REAL_F1_CAR_WIDTH_METERS, 5);
    expect(simSpeedToKph(VEHICLE_LIMITS.maxSpeed)).toBeCloseTo(TARGET_F1_TOP_SPEED_KPH, 5);

    const sim = createRaceSimulation({
      seed: 59,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    sim.setCarState('budget', { speed: VEHICLE_LIMITS.maxSpeed });
    const car = sim.snapshot().cars[0];

    expect(car.speedKph).toBeCloseTo(simSpeedToKph(VEHICLE_LIMITS.maxSpeed), 5);
    expect(car.setup.maxSpeedKph).toBeCloseTo(simSpeedToKph(VEHICLE_LIMITS.maxSpeed), 5);
    expect(car.distanceMeters).toBeCloseTo(simUnitsToMeters(car.raceDistance), 5);
  });

  test('creates hidden timing lines at F1-style mini-sector spacing', () => {
    const sim = createRaceSimulation({
      seed: 61,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });

    expect(sim.track.timingLines).toEqual(expect.objectContaining({
      spacing: expect.any(Number),
      spacingMeters: expect.any(Number),
      count: expect.any(Number),
      lines: expect.any(Array),
    }));
    expect(sim.track.timingLines.spacingMeters).toBeGreaterThanOrEqual(150);
    expect(sim.track.timingLines.spacingMeters).toBeLessThanOrEqual(200);
    expect(sim.track.timingLines.lines).toHaveLength(sim.track.timingLines.count);
    expect(sim.track.timingLines.lines[0]).toEqual(expect.objectContaining({
      index: 0,
      distance: 0,
      distanceMeters: 0,
    }));
  });

  test('calculates race gaps from fixed timing-line crossing times', () => {
    const sim = createRaceSimulation({
      seed: 62,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const [leader, chaser] = sim.cars;
    const lineNumber = 8;
    const lineDistance = sim.track.timingLines.spacing * lineNumber;

    [
      [leader, lineDistance + 90, 10],
      [chaser, lineDistance + 30, 12.4],
    ].forEach(([car, raceDistance, crossingTime]) => {
      const trackPoint = pointAt(sim.track, raceDistance);
      Object.assign(car, {
        x: trackPoint.x,
        y: trackPoint.y,
        heading: trackPoint.heading,
        speed: 160,
        progress: trackPoint.distance,
        raceDistance,
        previousRaceDistanceForTiming: raceDistance,
        timingLineLastUpdatedAt: 13,
        timingLineCrossings: { [lineNumber]: crossingTime },
        timingHistory: [
          { time: 12.9, raceDistance: lineDistance + 30 },
          { time: 13, raceDistance },
        ],
      });
    });
    sim.time = 13;

    sim.recalculateRaceState({ updateDrs: false });
    const noir = sim.snapshot().cars.find((car) => car.id === 'noir');

    expect(noir.gapAheadSeconds).toBeCloseTo(2.4, 5);
    expect(noir.leaderGapSeconds).toBeCloseTo(2.4, 5);
  });

  test('DRS cannot be gained after missing the detection point inside a zone', () => {
    const sim = createRaceSimulation({
      seed: 32,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const zone = track.drsZones[0];
    const leaderPoint = pointAt(track, zone.start + 96);
    const chasingPoint = pointAt(track, zone.start + 42);

    sim.setCarState('budget', {
      x: leaderPoint.x,
      y: leaderPoint.y,
      heading: leaderPoint.heading,
      speed: 72,
      raceDistance: zone.start + 96,
      progress: leaderPoint.distance,
    });
    sim.setCarState('noir', {
      x: chasingPoint.x,
      y: chasingPoint.y,
      heading: chasingPoint.heading,
      speed: 84,
      raceDistance: zone.start + 42,
      progress: chasingPoint.distance,
    });

    run(sim, 0.5);

    const chasing = sim.snapshot().cars.find((car) => car.id === 'noir');
    expect(chasing.gapAheadSeconds).toBeLessThan(1);
    expect(chasing.drsActive).toBe(false);
    expect(chasing.drsZoneId).toBe(null);
  });

  test('gravel recovery slows the car without stopping it into a pivot', () => {
    const sim = createRaceSimulation({
      seed: 41,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const point = findMainTrackPointAwayFromPitLane(track, 1350);
    const gravelPoint = offsetTrackPoint(point, track.width / 2 + 82);

    sim.setCarState('budget', {
      x: gravelPoint.x,
      y: gravelPoint.y,
      heading: point.heading + 1.25,
      speed: 44,
      progress: point.distance,
      raceDistance: point.distance,
    });

    run(sim, 2.2);

    const car = sim.snapshot().cars.find((item) => item.id === 'budget');
    expect(car.surface === 'track' || car.surface === 'gravel').toBe(true);
    expect(car.speed).toBeGreaterThan(14);
    expect(car.raceDistance).toBeGreaterThan(point.distance + 39);
  });

  test('kerb riding does not trigger gravel-style stopping behavior', () => {
    const sim = createRaceSimulation({
      seed: 42,
      drivers: drivers.slice(0, 1),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const point = pointAt(track, 1520);
    const kerbPoint = offsetTrackPoint(point, track.width / 2 - 2);

    sim.setCarState('budget', {
      x: kerbPoint.x,
      y: kerbPoint.y,
      heading: point.heading + 0.16,
      speed: 72,
      progress: point.distance,
      raceDistance: point.distance,
    });

    run(sim, 1.2);

    const car = sim.snapshot().cars.find((item) => item.id === 'budget');
    expect(['track', 'kerb']).toContain(car.surface);
    expect(car.speed).toBeGreaterThan(54);
    expect(car.raceDistance).toBeGreaterThan(point.distance + 70);
  });

  test('safety car neutralizes racing, disables DRS, and reduces speed through vehicle controls', () => {
    const sim = createRaceSimulation({ seed: 21, drivers, totalLaps: 5 });
    run(sim, 5);
    const beforeOrder = sim.snapshot().cars.map((car) => car.id);

    sim.setSafetyCar(true);
    run(sim, 8);
    const snapshot = sim.snapshot();

    expect(snapshot.raceControl.mode).toBe('safety-car');
    expect(snapshot.safetyCar.deployed).toBe(true);
    expect(snapshot.cars.map((car) => car.id)).toEqual(beforeOrder);
    expect(snapshot.cars.every((car) => car.drsActive === false)).toBe(true);
    expect(snapshot.cars.every((car) => car.canAttack === false)).toBe(true);
    expect(snapshot.cars[0].speed).toBeLessThanOrEqual(snapshot.rules.safetyCarSpeed + 12);
  });

  slowTest('safety car forms a single-file queue in the frozen race order', () => {
    const sim = createRaceSimulation({ seed: 1971, drivers: PROJECT_DRIVERS, totalLaps: 8 });
    run(sim, 8);
    const frozenOrder = sim.snapshot().cars.map((car) => car.id);

    sim.setSafetyCar(true);
    run(sim, 60);
    const snapshot = sim.snapshot();
    const queueGaps = snapshot.cars.slice(1).map((car, index) => snapshot.cars[index].raceDistance - car.raceDistance);

    expect(snapshot.cars.map((car) => car.id)).toEqual(frozenOrder);
    expect(snapshot.cars.every((car) => car.drsActive === false)).toBe(true);
    expect(Math.max(...snapshot.cars.map((car) => Math.abs(car.signedOffset)))).toBeLessThan(snapshot.track.width / 2);
    expect(snapshot.safetyCar.progress - snapshot.cars[0].raceDistance).toBeGreaterThan(metersToSimUnits(42));
    expect(snapshot.safetyCar.progress - snapshot.cars[0].raceDistance).toBeLessThan(metersToSimUnits(75));
    expect(Math.min(...queueGaps)).toBeGreaterThan(metersToSimUnits(10));
    expect(Math.max(...queueGaps)).toBeLessThan(metersToSimUnits(56));
    expect(Math.max(...snapshot.cars.map((car) => car.speedKph))).toBeLessThan(255);
  });

  test('gravel slows an off-track car while controls rejoin the racing surface', () => {
    const sim = createRaceSimulation({
      seed: 9,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const trackPoint = findMainTrackPointAwayFromPitLane(track, 720);
    const gravelPoint = offsetTrackPoint(trackPoint, track.width / 2 + 120);

    sim.setCarState('budget', {
      x: gravelPoint.x,
      y: gravelPoint.y,
      heading: trackPoint.heading + 0.7,
      speed: kphToSimSpeed(78),
    });

    const before = sim.snapshot().cars.find((car) => car.id === 'budget');
    run(sim, 2);
    const slowed = sim.snapshot().cars.find((car) => car.id === 'budget');
    run(sim, 12);
    const after = sim.snapshot().cars.find((car) => car.id === 'budget');

    expect(before.surface).toBe('gravel');
    expect(slowed.surface).toBe('gravel');
    expect(slowed.speedKph).toBeLessThan(before.speedKph * 0.62);
    expect(slowed.speedKph).toBeGreaterThan(before.speedKph * 0.32);
    expect(['track', 'pit-exit']).toContain(after.surface);
    expect(after.speedKph).toBeGreaterThan(slowed.speedKph);
    expect(Math.abs(after.signedOffset)).toBeLessThan(TRACK.width / 2);
  });

  test('simulator barrier contact destroys the car and removes it from race order', () => {
    const sim = createRaceSimulation({
      seed: 9,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      physicsMode: 'simulator',
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const trackPoint = findMainTrackPointAwayFromPitLane(track, 720);
    const barrierLimit = track.width / 2 + (track.kerbWidth ?? 0) + track.gravelWidth + track.runoffWidth;
    const barrierPoint = offsetTrackPoint(trackPoint, barrierLimit + metersToSimUnits(6));

    sim.setCarState('budget', {
      x: barrierPoint.x,
      y: barrierPoint.y,
      heading: trackPoint.heading + Math.PI / 2,
      speed: kphToSimSpeed(180),
      progress: trackPoint.distance,
      raceDistance: trackPoint.distance,
    });
    sim.setCarControls('budget', { steering: 0, throttle: 0, brake: 0 });

    const before = sim.snapshot().cars.find((car) => car.id === 'budget');
    sim.step(1 / 60);
    const after = sim.snapshot().cars.find((car) => car.id === 'budget');

    expect(before.surface).toBe('barrier');
    expect(before.crossTrackError).toBeGreaterThan(barrierLimit);
    expect(after.destroyed).toBe(true);
    expect(after.destroyReason).toBe('barrier');
    expect(after.status).toBe('destroyed');
    expect(after.speedKph).toBe(0);
    expect(sim.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'car-destroyed', carId: 'budget', reason: 'barrier' }),
    ]));
    expect(sim.orderedCars().map((car) => car.id)).not.toContain('budget');
  });

  test('simulator barrier contact uses the rendered wall inner face', () => {
    const sim = createRaceSimulation({
      seed: 9,
      drivers: drivers.slice(0, 2),
      totalLaps: 3,
      physicsMode: 'simulator',
      rules: { standingStart: false },
    });
    const track = sim.snapshot().track;
    const trackPoint = findMainTrackPointAwayFromPitLane(track, 720);
    const barrierCenterOffset = track.width / 2 + (track.kerbWidth ?? 0) + track.gravelWidth + track.runoffWidth;
    const visualOutwardReach = metersToSimUnits(VISUAL_CAR_LENGTH_METERS / 2);
    const visualContactOffset = barrierCenterOffset - track.barrierWidth / 2 - visualOutwardReach + metersToSimUnits(0.05);
    const visualContactPoint = offsetTrackPoint(trackPoint, visualContactOffset);

    sim.setCarState('budget', {
      x: visualContactPoint.x,
      y: visualContactPoint.y,
      heading: trackPoint.heading + Math.PI / 2,
      speed: kphToSimSpeed(20),
      progress: trackPoint.distance,
      raceDistance: trackPoint.distance,
    });
    sim.setCarControls('budget', { steering: 0, throttle: 0, brake: 0 });

    const before = sim.snapshot().cars.find((car) => car.id === 'budget');
    sim.step(1 / 60);
    const after = sim.snapshot().cars.find((car) => car.id === 'budget');

    expect(before.surface).not.toBe('barrier');
    expect(after.destroyed).toBe(true);
    expect(after.destroyReason).toBe('barrier');
  });

  test('publishes finite race timing and tyre state for the browser UI', () => {
    const sim = createRaceSimulation({ seed: 31, drivers, totalLaps: 5 });

    expect(sim.snapshot().cars.map((car) => car.id)).toEqual(drivers.map((driver) => driver.id));

    run(sim, 3);
    const snapshot = sim.snapshot();

    snapshot.cars.forEach((car) => {
      expect(Number.isFinite(car.x)).toBe(true);
      expect(Number.isFinite(car.y)).toBe(true);
      expect(Number.isFinite(car.heading)).toBe(true);
      expect(Number.isFinite(car.raceDistance)).toBe(true);
      expect(Number.isFinite(car.tireEnergy)).toBe(true);
      expect(Number.isFinite(car.setup.maxSpeedKph)).toBe(true);
      expect(Number.isFinite(car.setup.powerUnitKn)).toBe(true);
      expect(Number.isFinite(car.setup.brakeSystemKn)).toBe(true);
      expect(Number.isFinite(car.setup.dragCoefficient)).toBe(true);
      expect(Number.isFinite(car.setup.downforceCoefficient)).toBe(true);
      expect(Number.isFinite(car.setup.tireGrip)).toBe(true);
      expect(Number.isFinite(car.setup.massKg)).toBe(true);
      expect(Number.isFinite(car.aggression)).toBe(true);
      expect(Number.isFinite(car.personality.baseAggression)).toBe(true);
      expect(Number.isFinite(car.personality.riskTolerance)).toBe(true);
      expect(car.setup.maxSpeedKph).toBeGreaterThan(300);
      expect(car.setup.maxSpeedKph).toBeLessThan(360);
      expect(car.setup.powerUnitKn).toBeGreaterThan(37);
      expect(car.setup.brakeSystemKn).toBeGreaterThan(55);
      expect(car.tireEnergy).toBeGreaterThan(0);
    });
    snapshot.cars.slice(1).forEach((car) => {
      expect(Number.isFinite(car.gapAheadSeconds)).toBe(true);
      expect(car.gapAheadSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  test('keeps a crowded field racing instead of collapsing into a stationary pile-up', () => {
    const sim = createRaceSimulation({ seed: 1971, drivers: PROJECT_DRIVERS, totalLaps: 6 });

    const contactCount = run(sim, 12);
    const snapshot = sim.snapshot();
    const averageSpeedKph = snapshot.cars.reduce((total, car) => total + car.speedKph, 0) / snapshot.cars.length;
    const laneBuckets = new Set(snapshot.cars.map((car) => Math.round(car.signedOffset / 18))).size;

    expect(snapshot.cars.every((car) => car.positionSource === 'integrated-vehicle')).toBe(true);
    expect(averageSpeedKph).toBeGreaterThan(140);
    expect(Math.min(...snapshot.cars.map((car) => car.speedKph))).toBeGreaterThan(80);
    expect(Math.max(...snapshot.cars.map((car) => car.speedKph))).toBeLessThan(340);
    expect(laneBuckets).toBeGreaterThanOrEqual(2);
    expect(Math.max(...snapshot.cars.map((car) => car.crossTrackError))).toBeLessThan(snapshot.track.width / 2);
    expect(Math.max(...snapshot.cars.slice(1).map((car) => car.gapAheadSeconds))).toBeLessThan(8);
    expect(contactCount).toBeLessThan(12);
  });
});
