import { buildDriverPersonality } from '../driverController.js';
import { clamp, normalizeAngle, seededRange } from '../simMath.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits } from '../units.js';
import { VEHICLE_LIMITS } from './vehiclePhysics.js';
import { applyWheelSurfaceState } from './wheelSurface.js';
import { nearestTrackStateForCar } from '../track/trackStatePolicy.js';
import { clearCarDnf } from '../race/retirements.js';

const GRID_SLOT_SPACING = metersToSimUnits(8);
const ROLLING_START_SLOT_SPACING = metersToSimUnits(35);
const GRID_FIRST_SLOT_DISTANCE = metersToSimUnits(-6);
const ROLLING_START_FIRST_DISTANCE = metersToSimUnits(-30);
const GRID_LATERAL_OFFSET = metersToSimUnits(3.2);

export function getStartGridSlot(index, { standingStart = false } = {}) {
  const gridDistance = standingStart
    ? GRID_FIRST_SLOT_DISTANCE - index * GRID_SLOT_SPACING
    : ROLLING_START_FIRST_DISTANCE - index * ROLLING_START_SLOT_SPACING;
  const gridOffset = index % 2 === 0 ? -GRID_LATERAL_OFFSET : GRID_LATERAL_OFFSET;
  return { gridDistance, gridOffset };
}

export function createCar(driver, index, random, track, { standingStart = false, createLapTelemetry } = {}) {
  const { gridDistance, gridOffset } = getStartGridSlot(index, { standingStart });
  const start = pointAt(track, gridDistance);
  const position = offsetTrackPoint(start, gridOffset);
  const pace = clamp(driver.pace ?? seededRange(random, 0.95, 1.05), 0.88, 1.12);
  const racecraft = clamp(driver.racecraft ?? seededRange(random, 0.65, 0.92), 0.45, 1);
  const personality = buildDriverPersonality(driver, index, racecraft, random);
  const launchSpeed = kphToSimSpeed(Math.max(70, 84 - index * 0.55 + pace * 4));
  const vehicle = driver.vehicle ?? {};

  return {
    id: driver.id ?? `car-${index + 1}`,
    code: driver.code ?? `C${index + 1}`,
    timingCode: driver.timingCode ?? driver.code ?? `C${index + 1}`,
    driverNumber: driver.driverNumber ?? index + 1,
    icon: driver.icon ?? String(index + 1).padStart(2, '0'),
    raceName: driver.raceName ?? driver.code ?? `CAR${index + 1}`,
    name: driver.name ?? `Car ${index + 1}`,
    color: driver.color ?? '#e10600',
    team: driver.team ? { ...driver.team } : null,
    tire: driver.tire ?? ['M', 'H', 'S'][index % 3],
    index,
    x: position.x,
    y: position.y,
    previousX: position.x,
    previousY: position.y,
    heading: start.heading,
    previousHeading: start.heading,
    steeringAngle: 0,
    yawRate: 0,
    turnRadius: Infinity,
    speed: standingStart ? 0 : launchSpeed,
    longitudinalAcceleration: 0,
    lateralAcceleration: 0,
    lateralG: 0,
    longitudinalG: 0,
    gripUsage: 0,
    slipAngleRadians: 0,
    tractionLimited: false,
    stabilityState: 'stable',
    throttle: 0,
    brake: 0,
    vehicleId: vehicle.id ?? null,
    vehicleName: vehicle.name ?? null,
    vehicleRatings: vehicle.ratings ? { ...vehicle.ratings } : null,
    mass: vehicle.mass ?? 798 + seededRange(random, -5, 5),
    powerNewtons: vehicle.powerNewtons ?? 43000 * pace,
    brakeNewtons: vehicle.brakeNewtons ?? 59000,
    dragCoefficient: vehicle.dragCoefficient ?? 0.33 + seededRange(random, -0.026, 0.026),
    downforceCoefficient: vehicle.downforceCoefficient ?? 6.1 + seededRange(random, -0.18, 0.18),
    tireGrip: vehicle.tireGrip ?? 2.22 + racecraft * 0.28 + seededRange(random, -0.03, 0.03),
    tireCare: vehicle.tireCare ?? 1,
    pace,
    racecraft,
    personality,
    aggression: personality.baseAggression,
    gridLocked: standingStart,
    gridDistance,
    gridOffset,
    desiredOffset: gridOffset,
    progress: start.distance,
    raceDistance: gridDistance,
    lap: 1,
    rank: index + 1,
    gapAhead: Infinity,
    gapAheadSeconds: Infinity,
    leaderGapSeconds: 0,
    intervalAheadSeconds: Infinity,
    gapAheadLaps: 0,
    intervalAheadLaps: 0,
    leaderGapLaps: 0,
    drsEligible: false,
    drsActive: false,
    drsZoneId: null,
    drsZoneEnabled: false,
    timingHistory: [],
    lapTelemetry: createLapTelemetry?.(track, 0, gridDistance) ?? null,
    drsDetection: {},
    canAttack: true,
    trackState: start,
    contactCooldown: 0,
    tireEnergy: 100,
    usedTireCompounds: [driver.tire ?? ['M', 'H', 'S'][index % 3]],
    automaticPitIntentEnabled: true,
  };
}

export function clearCarDrsState(car) {
  car.drsZoneId = null;
  car.drsZoneEnabled = false;
  car.drsActive = false;
  car.drsEligible = false;
  car.drsDetection = {};
}

export function applyExternalCarState(car, partial, context) {
  const {
    cars,
    computeLap,
    nearestDistanceOnRoute,
    progressDelta,
    raceControl,
    releaseRaceStart,
    resetLapTelemetry,
    resetTimingHistory,
    resetTimingLineCrossings,
    time,
    totalLaps,
    track,
  } = context;
  const hasExplicitRaceDistance = partial.raceDistance != null;
  const nextPartial = { ...partial };
  if (raceControl.finished && (car.destroyed || car.outOfRace)) {
    if (partial.destroyed === false) nextPartial.destroyed = car.destroyed;
    if (partial.outOfRace === false) nextPartial.outOfRace = car.outOfRace;
  }
  Object.assign(car, nextPartial);
  if (
    !raceControl.finished &&
    nextPartial.destroyed === false &&
    nextPartial.outOfRace === false
  ) {
    clearCarDnf(car);
    car.destroyReason = null;
    car.destroyedAt = null;
    car.dnfReason = null;
    car.dnfAt = null;
  }
  if (
    nextPartial.x != null ||
    nextPartial.y != null ||
    nextPartial.progress != null ||
    nextPartial.raceDistance != null
  ) {
    car.gridLocked = false;
    if (raceControl.mode === 'pre-start' && cars.every((item) => !item.gridLocked)) {
      releaseRaceStart();
    }
  }
  car.speed = clamp(car.speed, 0, VEHICLE_LIMITS.maxSpeed);
  car.heading = normalizeAngle(car.heading);
  const centerState = nearestTrackStateForCar(track, car, car, car.progress ?? car.raceDistance);
  applyWheelSurfaceState(car, track, { centerState });
  if (
    nextPartial.desiredOffset == null &&
    (nextPartial.x != null || nextPartial.y != null || nextPartial.progress != null || nextPartial.raceDistance != null)
  ) {
    car.desiredOffset = centerState.signedOffset ?? 0;
  }
  if ((nextPartial.x != null || nextPartial.y != null) && car.pitStop?.route) {
    car.pitStop.routeProgress = nearestDistanceOnRoute(car.pitStop.route, car, car.pitStop.routeProgress ?? 0);
  }
  if (!hasExplicitRaceDistance) {
    const delta = progressDelta(car.trackState.distance, car.progress ?? car.trackState.distance, track.length);
    car.raceDistance = (car.raceDistance ?? car.trackState.distance) + delta;
  }
  car.progress = car.trackState.distance;
  car.lap = computeLap(car.raceDistance);
  clearCarDrsState(car);
  resetTimingHistory(car, time);
  resetTimingLineCrossings(car, time);
  resetLapTelemetry(car, time, track, totalLaps);
}
