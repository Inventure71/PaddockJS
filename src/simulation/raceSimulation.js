import {
  buildTrackModel,
  createProceduralTrack,
  nearestTrackState,
  offsetTrackPoint,
  pointAt,
  TRACK,
  WORLD,
} from './trackModel.js';
import { buildDriverPersonality, decideDriverControls } from './driverController.js';
import { buildCollisionCandidatePairs, detectVehicleCollision } from './collisionGeometry.js';
import { calculateCollisionPenalties } from './rules/collisionSteward.js';
import {
  applyUnservedServicePenalty,
  cancelPenaltyRecord,
  createPenaltyEvent,
  createPenaltyRecord,
  getPitServicePenaltySeconds,
  isPenaltyActive,
  isPenaltyPitServiceable,
  serializePenalty,
  servePitPenaltyRecord,
  servePenaltyRecord,
} from './rules/penaltyLedger.js';
import { calculateTireRequirementPenalty } from './rules/tireRequirementSteward.js';
import { calculateTrackLimitReview } from './rules/trackLimitsSteward.js';
import { DEFAULT_RULES, getPenaltyRule, normalizeRaceRules } from './rulesConfig.js';
import { clamp, createMulberry32, normalizeAngle, seededRange, wrapDistance } from './simMath.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToKph, simUnitsToMeters } from './units.js';
import { integrateVehiclePhysics, VEHICLE_LIMITS } from './vehiclePhysics.js';
import { applyWheelSurfaceState } from './wheelSurface.js';

const DEFAULT_TOTAL_LAPS = 10;
export const FIXED_STEP = 1 / 60;
const MIN_TOTAL_LAPS = 1;
const MAX_COLLISION_CORRECTION = 4.5;
const GRID_SLOT_SPACING = metersToSimUnits(8);
const ROLLING_START_SLOT_SPACING = metersToSimUnits(35);
const GRID_FIRST_SLOT_DISTANCE = metersToSimUnits(-6);
const ROLLING_START_FIRST_DISTANCE = metersToSimUnits(-30);
const GRID_LATERAL_OFFSET = metersToSimUnits(3.2);
const TIMING_HISTORY_WINDOW_SECONDS = 18;
const TIMING_HISTORY_MAX_SAMPLES = 720;
const TIMING_LINE_TARGET_SPACING_METERS = 175;
const TIMING_LINE_HISTORY_LAPS = 3;
const TELEMETRY_SECTOR_COUNT = 3;
const PIT_ENTRY_APPROACH_DISTANCE = metersToSimUnits(250);
const PIT_ROUTE_LOOKAHEAD_MIN = metersToSimUnits(35);
const PIT_ROUTE_LOOKAHEAD_MAX = metersToSimUnits(88);
const PIT_ROUTE_FINISH_DISTANCE = metersToSimUnits(8.5);
const PIT_QUEUE_RELEASE_FINISH_DISTANCE = metersToSimUnits(4);
const PIT_QUEUE_CAPTURE_DISTANCE = metersToSimUnits(2.5);
const PIT_ENTRY_BOX_CAPTURE_DISTANCE = metersToSimUnits(20);
const PIT_BOX_STOP_SPEED = kphToSimSpeed(35);
const PIT_QUEUE_CAPTURE_SPEED = kphToSimSpeed(140);
const PIT_QUEUE_RELEASE_SPEED = kphToSimSpeed(30);
const PIT_SERVICE_CLEAR_DISTANCE = VEHICLE_LIMITS.carLength * 0.9;
const PIT_EXIT_RELEASE_SPEED_KPH = 95;
const PIT_LIMITER_BRAKE_DISTANCE = metersToSimUnits(295);
const PIT_LIMITER_APPROACH_SPEED_SLOPE = 0.045;
const PIT_ENTRY_CONNECTOR_OVERSPEED_KPH = 75;
const PIT_DRIVE_LANE_OFFSET_RATIO = 0.28;
const PIT_BOX_APPROACH_DISTANCE = metersToSimUnits(34);
const PIT_SERVICE_QUEUE_FALLBACK_GAP = metersToSimUnits(48);
const PIT_INTENT_NONE = 0;
const PIT_INTENT_IF_FREE = 1;
const PIT_INTENT_COMMITTED = 2;

export { DEFAULT_RULES };

function getStartGridSlot(index, { standingStart = false } = {}) {
  const gridDistance = standingStart
    ? GRID_FIRST_SLOT_DISTANCE - index * GRID_SLOT_SPACING
    : ROLLING_START_FIRST_DISTANCE - index * ROLLING_START_SLOT_SPACING;
  const gridOffset = index % 2 === 0 ? -GRID_LATERAL_OFFSET : GRID_LATERAL_OFFSET;
  return { gridDistance, gridOffset };
}

function isPitPositionControlledCar(car) {
  const status = car?.pitStop?.status;
  return status === 'entering' || status === 'queued' || status === 'servicing' || status === 'exiting';
}

function wrapProgress(value, length) {
  return wrapDistance(value, length);
}

function distanceForward(from, to, length) {
  return wrapProgress(to - from, length);
}

function crossesDistance(previous, current, target, length) {
  const travelled = distanceForward(previous, current, length);
  if (travelled <= 0 || travelled > length / 2) return false;
  const targetOffset = distanceForward(previous, target, length);
  return targetOffset > 0 && targetOffset <= travelled + 0.001;
}

function isProgressInZone(track, progress, zone) {
  const wrapped = wrapProgress(progress, track.length);
  const start = wrapProgress(zone.start, track.length);
  const end = wrapProgress(zone.end, track.length);
  if (zone.end - zone.start >= track.length) return true;
  return end >= start
    ? wrapped >= start && wrapped <= end
    : wrapped >= start || wrapped <= end;
}

function createEmptySectorTimes() {
  return Array.from({ length: TELEMETRY_SECTOR_COUNT }, () => null);
}

function createEmptySectorPerformance() {
  return {
    current: createEmptySectorTimes(),
    last: createEmptySectorTimes(),
    best: createEmptySectorTimes(),
  };
}

function getSectorLength(track) {
  return track.length / TELEMETRY_SECTOR_COUNT;
}

function getLapTelemetryPosition(track, raceDistance, totalLaps = Infinity) {
  const positiveDistance = Math.max(0, raceDistance ?? 0);
  const lapIndex = Math.min(
    Math.floor(positiveDistance / track.length),
    Math.max(0, totalLaps - 1),
  );
  const lapProgress = positiveDistance >= track.length * totalLaps
    ? track.length
    : positiveDistance - lapIndex * track.length;
  const sectorLength = getSectorLength(track);
  const sectorIndex = Math.min(TELEMETRY_SECTOR_COUNT - 1, Math.floor(lapProgress / sectorLength));
  const sectorStart = sectorIndex * sectorLength;

  return {
    completedLaps: Math.floor(positiveDistance / track.length),
    currentLap: Math.max(1, lapIndex + 1),
    currentSector: sectorIndex + 1,
    currentSectorProgress: clamp((lapProgress - sectorStart) / sectorLength, 0, 1),
  };
}

function createSectorProgress(position, currentSectors = null) {
  const activeIndex = clamp((position.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);
  return createEmptySectorTimes().map((_, index) => {
    if (index < activeIndex && Number.isFinite(currentSectors?.[index])) return 1;
    if (index === activeIndex) return clamp(position.currentSectorProgress ?? 0, 0, 1);
    return 0;
  });
}

function createLapTelemetry(track, currentTime = 0, raceDistance = 0, totalLaps = Infinity) {
  const position = getLapTelemetryPosition(track, raceDistance, totalLaps);
  return {
    ...position,
    currentLapStartedAt: currentTime,
    currentSectorStartedAt: currentTime,
    lastUpdatedAt: currentTime,
    currentLapTime: 0,
    currentSectorElapsed: 0,
    currentSectors: createEmptySectorTimes(),
    sectorProgress: createSectorProgress(position),
    liveSectors: createEmptySectorTimes(),
    lastLapTime: null,
    bestLapTime: null,
    lastSectors: createEmptySectorTimes(),
    bestSectors: createEmptySectorTimes(),
    sectorPerformance: createEmptySectorPerformance(),
  };
}

function resetLapTelemetry(car, currentTime, track, totalLaps) {
  car.lapTelemetry = createLapTelemetry(track, currentTime, car.raceDistance, totalLaps);
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function serializeSectorTimes(values) {
  return createEmptySectorTimes().map((_, index) => finiteOrNull(values?.[index]));
}

function serializeLapTelemetry(telemetry) {
  return {
    currentLap: telemetry.currentLap,
    currentSector: telemetry.currentSector,
    currentLapTime: finiteOrNull(telemetry.currentLapTime),
    currentSectorElapsed: finiteOrNull(telemetry.currentSectorElapsed),
    currentSectorProgress: finiteOrNull(telemetry.currentSectorProgress),
    currentSectors: serializeSectorTimes(telemetry.currentSectors),
    sectorProgress: serializeSectorTimes(telemetry.sectorProgress),
    liveSectors: serializeSectorTimes(telemetry.liveSectors),
    lastLapTime: finiteOrNull(telemetry.lastLapTime),
    bestLapTime: finiteOrNull(telemetry.bestLapTime),
    lastSectors: serializeSectorTimes(telemetry.lastSectors),
    bestSectors: serializeSectorTimes(telemetry.bestSectors),
    sectorPerformance: {
      current: serializeSectorPerformance(telemetry.sectorPerformance?.current),
      last: serializeSectorPerformance(telemetry.sectorPerformance?.last),
      best: serializeSectorPerformance(telemetry.sectorPerformance?.best),
    },
    completedLaps: telemetry.completedLaps,
  };
}

function serializeSectorPerformance(values) {
  return createEmptySectorTimes().map((_, index) => values?.[index] ?? null);
}

function updateBestSector(telemetry, sectorIndex, sectorTime) {
  const previousBest = telemetry.bestSectors[sectorIndex];
  if (!Number.isFinite(previousBest) || sectorTime < previousBest) {
    telemetry.bestSectors[sectorIndex] = sectorTime;
  }
}

function clearFutureSectorTelemetry(telemetry) {
  const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);
  for (let index = activeIndex; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    telemetry.currentSectors[index] = null;
  }
}

function syncLiveSectorTelemetry(telemetry, track) {
  const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);

  telemetry.liveSectors = createEmptySectorTimes();
  telemetry.currentSectors.forEach((time, index) => {
    if (index >= activeIndex) return;
    if (!Number.isFinite(time)) return;
    telemetry.liveSectors[index] = time;
  });
  telemetry.liveSectors[activeIndex] = telemetry.currentSectorElapsed;
}

function syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps) {
  const position = getLapTelemetryPosition(track, currentRaceDistance, totalLaps);
  telemetry.currentLap = position.currentLap;
  telemetry.currentSector = position.currentSector;
  telemetry.currentSectorProgress = position.currentSectorProgress;
  clearFutureSectorTelemetry(telemetry);
  telemetry.sectorProgress = createSectorProgress(position, telemetry.currentSectors);
  telemetry.completedLaps = Math.max(telemetry.completedLaps, Math.min(position.completedLaps, totalLaps));
  telemetry.currentLapTime = Math.max(0, currentTime - telemetry.currentLapStartedAt);
  telemetry.currentSectorElapsed = Math.max(0, currentTime - telemetry.currentSectorStartedAt);
  syncLiveSectorTelemetry(telemetry, track);
}

function classifySectorPerformance(value, personalBest, overallBest) {
  if (!Number.isFinite(value)) return null;
  if (Number.isFinite(overallBest) && Math.abs(value - overallBest) <= 1e-6) return 'overall-best';
  if (Number.isFinite(personalBest) && Math.abs(value - personalBest) <= 1e-6) return 'personal-best';
  return 'slower';
}

function updateSectorPerformance(cars) {
  const overallBestSectors = createEmptySectorTimes();
  cars.forEach((car) => {
    car.lapTelemetry?.bestSectors?.forEach((time, index) => {
      if (!Number.isFinite(time)) return;
      const previousBest = overallBestSectors[index];
      if (!Number.isFinite(previousBest) || time < previousBest) overallBestSectors[index] = time;
    });
  });

  cars.forEach((car) => {
    if (!car.lapTelemetry) return;
    const telemetry = car.lapTelemetry;
    telemetry.sectorPerformance = {
      current: telemetry.currentSectors.map((time, index) => (
        classifySectorPerformance(time, telemetry.bestSectors[index], overallBestSectors[index])
      )),
      last: telemetry.lastSectors.map((time, index) => (
        classifySectorPerformance(time, telemetry.bestSectors[index], overallBestSectors[index])
      )),
      best: telemetry.bestSectors.map((time, index) => (
        classifySectorPerformance(time, telemetry.bestSectors[index], overallBestSectors[index])
      )),
    };
  });
}

function updateLapTelemetry(car, previousRaceDistance, currentTime, track, totalLaps) {
  if (!car.lapTelemetry) resetLapTelemetry(car, currentTime, track, totalLaps);

  const telemetry = car.lapTelemetry;
  const currentRaceDistance = car.raceDistance ?? 0;
  const previousDistance = Math.max(0, previousRaceDistance ?? currentRaceDistance);
  const currentDistance = Math.max(0, currentRaceDistance);
  const travelled = currentDistance - previousDistance;
  const previousUpdateTime = Number.isFinite(telemetry.lastUpdatedAt) ? telemetry.lastUpdatedAt : currentTime;
  const elapsedTime = Math.max(0, currentTime - previousUpdateTime);

  if (!Number.isFinite(previousDistance) || !Number.isFinite(currentDistance) || travelled < -1e-3 || travelled > track.length / 2) {
    resetLapTelemetry(car, currentTime, track, totalLaps);
    return;
  }

  const sectorLength = getSectorLength(track);
  if (travelled > 1e-6) {
    const firstBoundary = Math.floor(previousDistance / sectorLength) + 1;
    const lastBoundary = Math.floor(currentDistance / sectorLength);

    for (let boundary = firstBoundary; boundary <= lastBoundary; boundary += 1) {
      const boundaryDistance = boundary * sectorLength;
      if (boundaryDistance <= previousDistance + 1e-3 || boundaryDistance > currentDistance + 1e-3) continue;

      const boundaryRatio = clamp((boundaryDistance - previousDistance) / travelled, 0, 1);
      const crossingTime = previousUpdateTime + boundaryRatio * elapsedTime;
      const sectorIndex = (boundary - 1) % TELEMETRY_SECTOR_COUNT;
      const sectorTime = Math.max(0, crossingTime - telemetry.currentSectorStartedAt);

      telemetry.currentSectors[sectorIndex] = sectorTime;
      updateBestSector(telemetry, sectorIndex, sectorTime);

      if (sectorIndex === TELEMETRY_SECTOR_COUNT - 1) {
        const lapTime = Math.max(0, crossingTime - telemetry.currentLapStartedAt);
        telemetry.lastLapTime = lapTime;
        telemetry.bestLapTime = Number.isFinite(telemetry.bestLapTime)
          ? Math.min(telemetry.bestLapTime, lapTime)
          : lapTime;
        telemetry.lastSectors = serializeSectorTimes(telemetry.currentSectors);
        telemetry.currentSectors = createEmptySectorTimes();
        telemetry.currentLapStartedAt = crossingTime;
        telemetry.completedLaps = Math.max(telemetry.completedLaps + 1, Math.min(Math.floor(boundaryDistance / track.length), totalLaps));
      }

      telemetry.currentSectorStartedAt = crossingTime;
    }
  }

  syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps);
  telemetry.lastUpdatedAt = currentTime;
}

function createCar(driver, index, random, track, { standingStart = false } = {}) {
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
    lapTelemetry: createLapTelemetry(track, 0, gridDistance),
    drsDetection: {},
    canAttack: true,
    trackState: start,
    contactCooldown: 0,
    tireEnergy: 100,
    usedTireCompounds: [driver.tire ?? ['M', 'H', 'S'][index % 3]],
    automaticPitIntentEnabled: true,
  };
}

function normalizeTotalLaps(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MIN_TOTAL_LAPS;
  return Math.max(MIN_TOTAL_LAPS, Math.floor(numeric));
}

function forwardVector(car) {
  return { x: Math.cos(car.heading), y: Math.sin(car.heading) };
}

function velocityVector(car) {
  const forward = forwardVector(car);
  return { x: forward.x * car.speed, y: forward.y * car.speed };
}

function createCollisionStewardContext(first, second, collision) {
  const distanceDelta = (second.raceDistance ?? 0) - (first.raceDistance ?? 0);
  const sideBySideTolerance = VEHICLE_LIMITS.carLength * 0.18;
  if (Math.abs(distanceDelta) <= sideBySideTolerance) {
    const firstVelocity = velocityVector(first);
    const secondVelocity = velocityVector(second);
    const relativeVelocity = {
      x: firstVelocity.x - secondVelocity.x,
      y: firstVelocity.y - secondVelocity.y,
    };
    return {
      ...collision,
      impactSpeed: Math.hypot(relativeVelocity.x, relativeVelocity.y),
      aheadDriverId: null,
      atFaultDriverId: null,
      sharedFault: true,
      sharedFaultDriverIds: [first.id, second.id],
    };
  }

  const firstBehind = distanceDelta > 0;
  const behind = firstBehind ? first : second;
  const ahead = firstBehind ? second : first;
  const directionBehindToAhead = normalizeVector({
    x: ahead.x - behind.x,
    y: ahead.y - behind.y,
  });
  const behindVelocity = velocityVector(behind);
  const aheadVelocity = velocityVector(ahead);
  const relativeVelocity = {
    x: behindVelocity.x - aheadVelocity.x,
    y: behindVelocity.y - aheadVelocity.y,
  };

  return {
    ...collision,
    impactSpeed: Math.max(0, dot(relativeVelocity, directionBehindToAhead)),
    aheadDriverId: ahead.id,
    atFaultDriverId: behind.id,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function progressDelta(a, b, trackLength) {
  let delta = a - b;
  if (delta < -trackLength / 2) delta += trackLength;
  if (delta > trackLength / 2) delta -= trackLength;
  return delta;
}

function trimTimingHistory(history, currentTime) {
  const cutoff = currentTime - TIMING_HISTORY_WINDOW_SECONDS;
  while (history.length > 2 && (history[0].time < cutoff || history.length > TIMING_HISTORY_MAX_SAMPLES)) {
    history.shift();
  }
}

function resetTimingHistory(car, currentTime) {
  car.timingHistory = [{ time: currentTime, raceDistance: car.raceDistance }];
}

function recordTimingSample(car, currentTime) {
  if (!Number.isFinite(car.raceDistance)) return;
  if (!Array.isArray(car.timingHistory)) {
    resetTimingHistory(car, currentTime);
    return;
  }

  const previous = car.timingHistory[car.timingHistory.length - 1];
  if (
    previous &&
    Math.abs(previous.time - currentTime) <= 1e-6 &&
    Math.abs(previous.raceDistance - car.raceDistance) <= 1e-3
  ) {
    return;
  }

  car.timingHistory.push({ time: currentTime, raceDistance: car.raceDistance });
  trimTimingHistory(car.timingHistory, currentTime);
}

function interpolateTimeAtDistance(history, targetDistance) {
  if (!Array.isArray(history) || history.length < 2) return null;

  for (let index = history.length - 1; index > 0; index -= 1) {
    const current = history[index];
    const previous = history[index - 1];
    if (targetDistance < previous.raceDistance || targetDistance > current.raceDistance) continue;

    const coveredDistance = current.raceDistance - previous.raceDistance;
    if (coveredDistance <= 1e-6) return current.time;
    const ratio = (targetDistance - previous.raceDistance) / coveredDistance;
    return previous.time + (current.time - previous.time) * ratio;
  }

  return null;
}

function estimateGapAheadSeconds(ahead, car, currentTime, track) {
  if (!ahead) return Infinity;

  const timingLineGap = estimateTimingLineGapSeconds(ahead, car, currentTime, track);
  if (Number.isFinite(timingLineGap)) return timingLineGap;

  const crossingTime = interpolateTimeAtDistance(ahead.timingHistory, car.raceDistance);
  if (Number.isFinite(crossingTime)) {
    return Math.max(0, currentTime - crossingTime);
  }

  const speedReference = Math.max((ahead.speed + car.speed) * 0.5, 1);
  return Math.max(0, (ahead.raceDistance - car.raceDistance) / speedReference);
}

function wholeLapGap(aheadDistance, carDistance, trackLength) {
  if (!Number.isFinite(aheadDistance) || !Number.isFinite(carDistance)) return 0;
  if (!Number.isFinite(trackLength) || trackLength <= 0) return 0;
  return Math.max(0, Math.floor((aheadDistance - carDistance + 1e-6) / trackLength));
}

function createTimingLines(track) {
  const targetSpacing = metersToSimUnits(TIMING_LINE_TARGET_SPACING_METERS);
  const count = Math.max(1, Math.round(track.length / targetSpacing));
  const spacing = track.length / count;

  return {
    spacing,
    spacingMeters: simUnitsToMeters(spacing),
    count,
    lines: Array.from({ length: count }, (_, index) => {
      const distance = index * spacing;
      const point = pointAt(track, distance);
      return {
        index,
        distance,
        distanceMeters: simUnitsToMeters(distance),
        x: point.x,
        y: point.y,
        heading: point.heading,
      };
    }),
  };
}

function getTimingLineNumber(track, raceDistance) {
  const spacing = track.timingLines?.spacing;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(raceDistance)) return null;
  return Math.floor(Math.max(0, raceDistance) / spacing);
}

function resetTimingLineCrossings(car, currentTime) {
  car.timingLineCrossings = Object.create(null);
  car.timingLineLastUpdatedAt = currentTime;
  car.previousRaceDistanceForTiming = car.raceDistance;
}

function recordTimingLineCrossings(car, previousRaceDistance, currentTime, track) {
  const spacing = track.timingLines?.spacing;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(car.raceDistance)) return;
  if (!car.timingLineCrossings || typeof car.timingLineCrossings !== 'object') {
    resetTimingLineCrossings(car, currentTime);
    return;
  }

  const previousDistance = Number.isFinite(previousRaceDistance) ? previousRaceDistance : car.raceDistance;
  const currentDistance = car.raceDistance;
  const travelled = currentDistance - previousDistance;
  const previousTime = Number.isFinite(car.timingLineLastUpdatedAt) ? car.timingLineLastUpdatedAt : currentTime;
  const elapsed = Math.max(0, currentTime - previousTime);

  if (travelled > 1e-6 && travelled < track.length / 2) {
    const firstLine = Math.floor(Math.max(0, previousDistance) / spacing) + 1;
    const lastLine = Math.floor(Math.max(0, currentDistance) / spacing);

    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const lineDistance = lineNumber * spacing;
      if (lineDistance <= previousDistance + 1e-6 || lineDistance > currentDistance + 1e-6) continue;
      const ratio = clamp((lineDistance - previousDistance) / travelled, 0, 1);
      car.timingLineCrossings[lineNumber] = previousTime + ratio * elapsed;
    }
  }

  car.timingLineLastUpdatedAt = currentTime;
  const latestLine = getTimingLineNumber(track, currentDistance);
  if (latestLine != null) {
    const cutoff = latestLine - (track.timingLines.count * TIMING_LINE_HISTORY_LAPS);
    Object.keys(car.timingLineCrossings).forEach((key) => {
      if (Number(key) < cutoff) delete car.timingLineCrossings[key];
    });
  }
}

function getTimingLineCrossingTime(car, lineNumber) {
  const value = car?.timingLineCrossings?.[lineNumber];
  return Number.isFinite(value) ? value : null;
}

function estimateTimingLineGapSeconds(ahead, car, currentTime, track) {
  if (!ahead || !car) return Infinity;
  const currentLine = getTimingLineNumber(track, Math.min(ahead.raceDistance ?? 0, car.raceDistance ?? 0));
  if (currentLine == null) return null;
  const oldestLine = Math.max(0, currentLine - (track.timingLines?.count ?? 0));

  for (let lineNumber = currentLine; lineNumber >= oldestLine; lineNumber -= 1) {
    const aheadTime = getTimingLineCrossingTime(ahead, lineNumber);
    const carTime = getTimingLineCrossingTime(car, lineNumber);
    if (Number.isFinite(aheadTime) && Number.isFinite(carTime)) {
      return Math.max(0, carTime - aheadTime);
    }
  }

  return null;
}

function recordDrsDetection(car, zoneId, currentTime) {
  const previous = car.drsDetection?.[zoneId] ?? { passage: 0, time: -Infinity };
  const next = { passage: previous.passage + 1, time: currentTime };
  car.drsDetection = {
    ...(car.drsDetection ?? {}),
    [zoneId]: next,
  };
  return next;
}

function clonePointLike(point) {
  if (!point) return point;
  return { ...point };
}

function clonePointArray(points) {
  return Array.isArray(points) ? points.map(clonePointLike) : points;
}

function clonePitLaneModel(pitLane) {
  if (!pitLane) return pitLane;
  return {
    ...pitLane,
    entry: pitLane.entry ? {
      ...pitLane.entry,
      trackPoint: clonePointLike(pitLane.entry.trackPoint),
      edgePoint: clonePointLike(pitLane.entry.edgePoint),
      trackConnectPoint: clonePointLike(pitLane.entry.trackConnectPoint),
      lanePoint: clonePointLike(pitLane.entry.lanePoint),
      roadCenterline: clonePointArray(pitLane.entry.roadCenterline),
      connector: clonePointArray(pitLane.entry.connector),
    } : pitLane.entry,
    exit: pitLane.exit ? {
      ...pitLane.exit,
      trackPoint: clonePointLike(pitLane.exit.trackPoint),
      edgePoint: clonePointLike(pitLane.exit.edgePoint),
      trackConnectPoint: clonePointLike(pitLane.exit.trackConnectPoint),
      lanePoint: clonePointLike(pitLane.exit.lanePoint),
      roadCenterline: clonePointArray(pitLane.exit.roadCenterline),
      connector: clonePointArray(pitLane.exit.connector),
    } : pitLane.exit,
    mainLane: pitLane.mainLane ? {
      ...pitLane.mainLane,
      start: clonePointLike(pitLane.mainLane.start),
      end: clonePointLike(pitLane.mainLane.end),
      points: clonePointArray(pitLane.mainLane.points),
    } : pitLane.mainLane,
    workingLane: pitLane.workingLane ? {
      ...pitLane.workingLane,
      start: clonePointLike(pitLane.workingLane.start),
      end: clonePointLike(pitLane.workingLane.end),
      points: clonePointArray(pitLane.workingLane.points),
    } : pitLane.workingLane,
    fastLane: pitLane.fastLane ? { ...pitLane.fastLane } : pitLane.fastLane,
    serviceNormal: clonePointLike(pitLane.serviceNormal),
    boxes: Array.isArray(pitLane.boxes)
      ? pitLane.boxes.map((box) => ({
        ...box,
        laneTarget: clonePointLike(box.laneTarget),
        center: clonePointLike(box.center),
        corners: clonePointArray(box.corners),
      }))
      : pitLane.boxes,
    serviceAreas: Array.isArray(pitLane.serviceAreas)
      ? pitLane.serviceAreas.map((area) => ({
        ...area,
        laneTarget: clonePointLike(area.laneTarget),
        center: clonePointLike(area.center),
        queuePoint: clonePointLike(area.queuePoint),
        corners: clonePointArray(area.corners),
        queueCorners: clonePointArray(area.queueCorners),
        garageBoxIds: [...(area.garageBoxIds ?? [])],
        pitCrew: area.pitCrew ? { ...area.pitCrew } : area.pitCrew,
      }))
      : pitLane.serviceAreas,
    teams: Array.isArray(pitLane.teams)
      ? pitLane.teams.map((team) => ({ ...team, boxIds: [...(team.boxIds ?? [])], pitCrew: team.pitCrew ? { ...team.pitCrew } : team.pitCrew }))
      : pitLane.teams,
  };
}

function routePoint(point, heading = point?.heading, options = {}) {
  if (!point) return null;
  return {
    x: point.x,
    y: point.y,
    heading,
    limiterActive: Boolean(options.limiterActive ?? point.limiterActive),
  };
}

function offsetPitLanePoint(pitLane, point, lateralOffset) {
  return {
    ...point,
    x: point.x + pitLane.serviceNormal.x * lateralOffset,
    y: point.y + pitLane.serviceNormal.y * lateralOffset,
    heading: pitLane.mainLane.heading,
  };
}

function pitMainLanePointAt(pitLane, distanceAlongLane, lateralOffset = 0) {
  const amount = pitLane.mainLane.length > 0
    ? clamp(distanceAlongLane / pitLane.mainLane.length, 0, 1)
    : 0;
  const point = {
    x: pitLane.mainLane.start.x + (pitLane.mainLane.end.x - pitLane.mainLane.start.x) * amount,
    y: pitLane.mainLane.start.y + (pitLane.mainLane.end.y - pitLane.mainLane.start.y) * amount,
    heading: pitLane.mainLane.heading,
  };
  return offsetPitLanePoint(pitLane, point, lateralOffset);
}

function pitDriveLaneOffset(pitLane) {
  return pitLane.fastLane?.offset ?? 0;
}

function sameRoutePoint(first, second) {
  return first && second && Math.hypot(first.x - second.x, first.y - second.y) < 0.001;
}

function shiftPreviousRenderPose(car, dx, dy, dheading = 0) {
  car.previousX = Number.isFinite(car.previousX) ? car.previousX + dx : car.x + dx;
  car.previousY = Number.isFinite(car.previousY) ? car.previousY + dy : car.y + dy;
  car.previousHeading = normalizeAngle(
    (Number.isFinite(car.previousHeading) ? car.previousHeading : car.heading) + dheading,
  );
}

function pointDistance(first, second) {
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function createRoute(points) {
  const routePoints = points
    .filter(Boolean)
    .map((point) => routePoint(point))
    .filter(Boolean)
    .reduce((deduped, point) => {
      if (!sameRoutePoint(deduped.at(-1), point)) {
        deduped.push(point);
      } else if (point.limiterActive) {
        deduped.at(-1).limiterActive = true;
      }
      return deduped;
    }, []);
  const segments = [];
  let totalLength = 0;

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = routePoints[index];
    const end = routePoints[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= 0.001) continue;
    const heading = Math.atan2(end.y - start.y, end.x - start.x);
    segments.push({
      start,
      end,
      length,
      heading,
      startDistance: totalLength,
      endDistance: totalLength + length,
      limiterActive: Boolean(start.limiterActive && end.limiterActive),
    });
    totalLength += length;
  }

  let nextLimiterStartDistance = Infinity;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.limiterActive) nextLimiterStartDistance = segment.startDistance;
    segment.nextLimiterStartDistance = nextLimiterStartDistance;
  }

  return {
    points: routePoints,
    segments,
    length: totalLength,
    segmentCursor: 0,
  };
}

function findRouteSegment(route, distanceAlong, endPadding = 0) {
  if (!route?.segments?.length) return null;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segments = route.segments;
  let index = clamp(Math.floor(route.segmentCursor ?? 0), 0, segments.length - 1);
  let segment = segments[index];

  if (
    clampedDistance >= segment.startDistance - 0.001 &&
    clampedDistance <= segment.endDistance - endPadding
  ) {
    return segment;
  }

  if (clampedDistance > segment.endDistance - endPadding) {
    while (index < segments.length - 1 && clampedDistance > segments[index].endDistance - endPadding) {
      index += 1;
    }
  } else {
    while (index > 0 && clampedDistance < segments[index].startDistance - 0.001) {
      index -= 1;
    }
  }

  segment = segments[index];
  if (
    clampedDistance < segment.startDistance - 0.001 ||
    clampedDistance > segment.endDistance - endPadding
  ) {
    segment = segments.find((candidate) => (
      clampedDistance >= candidate.startDistance - 0.001 &&
      clampedDistance <= candidate.endDistance - endPadding
    )) ?? segments.at(-1);
    index = segments.indexOf(segment);
  }

  route.segmentCursor = Math.max(0, index);
  return segment;
}

function sampleRoute(route, distanceAlong) {
  if (!route?.segments?.length) return route?.points?.[0] ?? null;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = findRouteSegment(route, clampedDistance) ?? route.segments.at(-1);
  const amount = clamp((clampedDistance - segment.startDistance) / segment.length, 0, 1);

  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * amount,
    y: segment.start.y + (segment.end.y - segment.start.y) * amount,
    heading: segment.heading,
    limiterActive: segment.limiterActive,
  };
}

function routeLimiterActiveAt(route, distanceAlong) {
  if (!route?.segments?.length) return false;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = findRouteSegment(route, clampedDistance, 0.001) ?? route.segments.at(-1);
  return Boolean(segment?.limiterActive);
}

function distanceToNextLimiterSegment(route, distanceAlong) {
  if (!route?.segments?.length) return Infinity;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = findRouteSegment(route, clampedDistance, 0.001);
  if (!segment) return Infinity;
  if (segment.limiterActive && segment.endDistance > clampedDistance + 0.001) return 0;
  return Math.max(0, segment.nextLimiterStartDistance - clampedDistance);
}

function easeInOut(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function projectPositionToSegment(position, segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((position.x - segment.start.x) * dx + (position.y - segment.start.y) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = segment.start.x + dx * amount;
  const y = segment.start.y + dy * amount;
  const distanceSquared = (position.x - x) ** 2 + (position.y - y) ** 2;

  return {
    distanceAlong: segment.startDistance + segment.length * amount,
    distanceSquared,
  };
}

function nearestDistanceOnRoute(route, position, previousDistance = 0) {
  if (!route?.segments?.length) return 0;
  let best = null;
  const backtrackAllowance = metersToSimUnits(90);

  route.segments.forEach((segment) => {
    if (segment.endDistance < previousDistance - backtrackAllowance) return;
    const projected = projectPositionToSegment(position, segment);
    if (!best || projected.distanceSquared < best.distanceSquared) best = projected;
  });

  return clamp(best?.distanceAlong ?? previousDistance, 0, route.length);
}

function createPitApproachPoints(track, car, pitLane, entryRaceDistance) {
  const currentDistance = car.raceDistance ?? entryRaceDistance - PIT_ENTRY_APPROACH_DISTANCE;
  const remaining = Math.max(0, entryRaceDistance - currentDistance);
  const currentState = nearestTrackState(track, car, car.progress);
  const startOffset = currentState.inPitLane ? 0 : currentState.signedOffset ?? 0;
  const entryConnectState = nearestTrackState(track, pitLane.entry.trackConnectPoint, pitLane.entry.trackDistance);
  const targetOffset = entryConnectState.signedOffset ?? 0;
  const points = [routePoint(car, car.heading)];
  const straightDistance = remaining > metersToSimUnits(14)
    ? Math.min(remaining * 0.22, metersToSimUnits(42))
    : 0;
  if (straightDistance > metersToSimUnits(1)) {
    points.push(routePoint({
      x: car.x + Math.cos(car.heading) * straightDistance,
      y: car.y + Math.sin(car.heading) * straightDistance,
    }, car.heading));
  }

  const transitionDistance = Math.max(0, remaining - straightDistance);
  const steps = Math.max(4, Math.ceil(Math.max(transitionDistance, PIT_ENTRY_APPROACH_DISTANCE * 0.45) / metersToSimUnits(74)));
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    const distance = currentDistance + straightDistance + transitionDistance * amount;
    const trackPoint = pointAt(track, distance);
    const lateralAmount = easeInOut(amount);
    const offset = startOffset + (targetOffset - startOffset) * lateralAmount;
    const point = offsetTrackPoint(trackPoint, offset);
    points.push(routePoint(point, trackPoint.heading));
  }

  points.push(routePoint(pitLane.entry.trackConnectPoint, pitLane.entry.trackPoint?.heading));
  return points;
}

function firstDifferentCompound(currentTire, compounds) {
  const available = Array.isArray(compounds) && compounds.length ? compounds : ['S', 'M', 'H'];
  return available.find((compound) => compound !== currentTire) ?? currentTire;
}

function normalizePitCompound(value, compounds) {
  if (value == null || value === '') return null;
  const available = Array.isArray(compounds) && compounds.length ? compounds : ['S', 'M', 'H'];
  return available.includes(value) ? value : null;
}

function normalizePitIntent(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < PIT_INTENT_NONE || number > PIT_INTENT_COMMITTED) return null;
  return number;
}

function normalizePitCrewStats(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rating = (entry) => {
    const numeric = Number(entry);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0.5;
  };
  return {
    speed: rating(source.speed ?? source.pace),
    consistency: rating(source.consistency),
    reliability: rating(source.reliability),
  };
}

function pitLaneStatusSnapshot(raceControl, pitLane, pitStops) {
  const enabled = Boolean(pitLane?.enabled && pitStops?.enabled);
  const redFlag = Boolean(raceControl.redFlag);
  const open = enabled && Boolean(raceControl.pitLaneOpen) && !redFlag;
  return {
    enabled,
    open,
    reason: !enabled ? 'unavailable' : redFlag ? 'red-flag' : open ? 'open' : 'closed',
    color: open ? 'green' : redFlag ? 'yellow' : 'red',
    light: open ? '#22c55e' : redFlag ? '#facc15' : '#ef4444',
  };
}

function serializePitStop(pitStop) {
  if (!pitStop) return null;
  return {
    status: pitStop.status,
    intent: normalizePitIntent(pitStop.intent) ?? PIT_INTENT_NONE,
    phase: pitStop.phase ?? null,
    boxIndex: pitStop.boxIndex,
    boxId: pitStop.boxId,
    garageBoxIndex: pitStop.garageBoxIndex ?? null,
    garageBoxId: pitStop.garageBoxId ?? null,
    teamId: pitStop.teamId ?? null,
    teamColor: pitStop.teamColor ?? null,
    stopsCompleted: pitStop.stopsCompleted ?? 0,
    queueingForService: Boolean(pitStop.queueingForService),
    plannedRaceDistance: finiteOrNull(pitStop.plannedRaceDistance),
    entryRaceDistance: finiteOrNull(pitStop.entryRaceDistance),
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    penaltyServiceRemainingSeconds: finiteOrNull(pitStop.penaltyServiceRemaining),
    penaltyServiceTotalSeconds: finiteOrNull(pitStop.penaltyServiceTotal),
    servingPenaltyIds: [...(pitStop.servingPenaltyIds ?? [])],
    targetTire: pitStop.targetTire ?? null,
    serviceProfile: pitStop.serviceProfile ? { ...pitStop.serviceProfile } : null,
  };
}

function serializeWheels(wheels = []) {
  return wheels.map((wheel) => ({
    id: wheel.id,
    x: wheel.x,
    y: wheel.y,
    signedOffset: wheel.signedOffset,
    crossTrackError: wheel.crossTrackError,
    surface: wheel.surface,
    onTrack: Boolean(wheel.onTrack),
    inPitLane: Boolean(wheel.inPitLane),
    fullyOutsideWhiteLine: Boolean(wheel.fullyOutsideWhiteLine),
  }));
}

function serializeCar(car, rank, penaltySeconds = 0) {
  const finishTime = car.finishTime ?? null;
  const raceStatus = car.finished ? 'waved-flag' : 'racing';
  return {
    id: car.id,
    code: car.code,
    timingCode: car.timingCode,
    driverNumber: car.driverNumber,
    icon: car.icon,
    raceName: car.raceName,
    name: car.name,
    color: car.color,
    team: car.team ? { ...car.team } : null,
    tire: car.tire,
    personality: { ...car.personality },
    aggression: car.aggression,
    aggressionPercent: Math.round((car.aggression ?? 0) * 100),
    setup: {
      vehicleId: car.vehicleId,
      vehicleName: car.vehicleName,
      vehicleRatings: car.vehicleRatings ? { ...car.vehicleRatings } : null,
      maxSpeedKph: simSpeedToKph(VEHICLE_LIMITS.maxSpeed),
      powerUnitKn: car.powerNewtons / 1000,
      brakeSystemKn: car.brakeNewtons / 1000,
      dragCoefficient: car.dragCoefficient,
      downforceCoefficient: car.downforceCoefficient,
      tireGrip: car.tireGrip,
      tireCare: car.tireCare,
      massKg: car.mass,
      pace: car.pace,
      racecraft: car.racecraft,
    },
    rank,
    classifiedRank: car.classifiedRank ?? rank,
    finishRank: car.finishRank ?? null,
    status: raceStatus,
    raceStatus,
    wavedFlag: Boolean(car.finished),
    finished: Boolean(car.finished),
    finishTime,
    penaltySeconds,
    adjustedFinishTime: finishTime == null ? null : finishTime + penaltySeconds,
    previousX: car.previousX ?? car.x,
    previousY: car.previousY ?? car.y,
    x: car.x,
    y: car.y,
    previousHeading: car.previousHeading ?? car.heading,
    heading: car.heading,
    steeringAngle: car.steeringAngle,
    yawRate: car.yawRate,
    turnRadius: car.turnRadius,
    speed: car.speed,
    speedKph: simSpeedToKph(car.speed),
    throttle: car.throttle,
    brake: car.brake,
    lateralAcceleration: car.lateralAcceleration,
    progress: car.progress,
    raceDistance: car.raceDistance,
    distanceMeters: simUnitsToMeters(car.raceDistance),
    lap: car.lap,
    lapTelemetry: serializeLapTelemetry(car.lapTelemetry ?? createLapTelemetry({ length: 1 }, 0, 0)),
    gapAhead: car.gapAhead,
    gapAheadMeters: Number.isFinite(car.gapAhead) ? simUnitsToMeters(car.gapAhead) : Infinity,
    gapAheadSeconds: car.gapAheadSeconds,
    intervalAheadSeconds: car.intervalAheadSeconds,
    leaderGapSeconds: car.leaderGapSeconds,
    gapAheadLaps: car.gapAheadLaps ?? 0,
    intervalAheadLaps: car.intervalAheadLaps ?? car.gapAheadLaps ?? 0,
    leaderGapLaps: car.leaderGapLaps ?? 0,
    drsEligible: car.drsEligible,
    drsActive: car.drsActive,
    drsZoneId: car.drsZoneId,
    drsZoneEnabled: car.drsZoneEnabled,
    canAttack: car.canAttack,
    signedOffset: car.trackState?.signedOffset ?? 0,
    crossTrackError: car.trackState?.crossTrackError ?? 0,
    surface: car.trackState?.surface ?? 'track',
    wheels: serializeWheels(car.wheelStates),
    inPitLane: Boolean(car.trackState?.inPitLane),
    pitLanePart: car.trackState?.pitLanePart ?? null,
    pitBoxId: car.trackState?.pitBoxId ?? null,
    pitLaneCrossTrackError: car.trackState?.pitLaneCrossTrackError ?? null,
    contactCooldown: car.contactCooldown,
    tireEnergy: car.tireEnergy,
    usedTireCompounds: [...(car.usedTireCompounds ?? [])],
    pitIntent: normalizePitIntent(car.pitStop?.intent) ?? PIT_INTENT_NONE,
    pitStop: serializePitStop(car.pitStop),
    positionSource: 'integrated-vehicle',
  };
}

function serializeRenderPitStop(pitStop) {
  if (!pitStop) return null;
  return {
    phase: pitStop.phase ?? null,
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    penaltyServiceRemainingSeconds: finiteOrNull(pitStop.penaltyServiceRemaining),
  };
}

function serializeRenderCar(car) {
  return {
    id: car.id,
    color: car.color,
    previousX: car.previousX ?? car.x,
    previousY: car.previousY ?? car.y,
    x: car.x,
    y: car.y,
    previousHeading: car.previousHeading ?? car.heading,
    heading: car.heading,
    drsActive: Boolean(car.drsActive),
    pitStop: serializeRenderPitStop(car.pitStop),
  };
}

function serializeObservationPitStop(pitStop) {
  if (!pitStop) return null;
  return {
    status: pitStop.status,
    intent: normalizePitIntent(pitStop.intent) ?? PIT_INTENT_NONE,
    phase: pitStop.phase ?? null,
    targetTire: pitStop.targetTire ?? null,
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    penaltyServiceRemainingSeconds: finiteOrNull(pitStop.penaltyServiceRemaining),
    stopsCompleted: pitStop.stopsCompleted ?? 0,
  };
}

function serializeObservationCar(car, rank) {
  return {
    id: car.id,
    rank,
    previousX: car.previousX ?? car.x,
    previousY: car.previousY ?? car.y,
    x: car.x,
    y: car.y,
    previousHeading: car.previousHeading ?? car.heading,
    heading: car.heading,
    steeringAngle: car.steeringAngle,
    yawRate: car.yawRate,
    speed: car.speed,
    speedKph: simSpeedToKph(car.speed),
    throttle: car.throttle,
    brake: car.brake,
    progress: car.progress,
    raceDistance: car.raceDistance,
    lap: car.lap,
    lapTelemetry: serializeLapTelemetry(car.lapTelemetry ?? createLapTelemetry({ length: 1 }, 0, 0)),
    signedOffset: car.trackState?.signedOffset ?? 0,
    crossTrackError: car.trackState?.crossTrackError ?? 0,
    surface: car.trackState?.surface ?? 'track',
    trackHeadingError: car.trackHeadingError,
    trackState: car.trackState ? {
      distance: car.trackState.distance,
      signedOffset: car.trackState.signedOffset,
      crossTrackError: car.trackState.crossTrackError,
      surface: car.trackState.surface,
      inPitLane: Boolean(car.trackState.inPitLane),
      pitLanePart: car.trackState.pitLanePart ?? null,
      pitBoxId: car.trackState.pitBoxId ?? null,
      curvature: car.trackState.curvature ?? 0,
    } : null,
    wheels: serializeWheels(car.wheelStates),
    inPitLane: Boolean(car.trackState?.inPitLane),
    pitLanePart: car.trackState?.pitLanePart ?? null,
    pitBoxId: car.trackState?.pitBoxId ?? null,
    tireEnergy: car.tireEnergy ?? null,
    pitIntent: normalizePitIntent(car.pitStop?.intent) ?? PIT_INTENT_NONE,
    pitStop: serializeObservationPitStop(car.pitStop),
  };
}

function isLegallyInsidePitLaneForTrackLimits(car) {
  if (!car.trackState?.inPitLane) return false;
  const wheels = car.wheelStates ?? [];
  return wheels.length > 0 && wheels.some((wheel) => wheel.inPitLane);
}

export class F1RaceSimulation {
  constructor({ seed = 1, drivers = [], totalLaps = DEFAULT_TOTAL_LAPS, rules = {}, track = null, trackSeed = null } = {}) {
    this.seed = seed;
    this.random = createMulberry32(seed);
    const trackDefinition = track ?? (trackSeed == null ? TRACK : createProceduralTrack(trackSeed));
    const builtTrack = buildTrackModel(trackDefinition);
    this.track = {
      ...builtTrack,
      pitLane: clonePitLaneModel(builtTrack.pitLane),
    };
    this.track.timingLines = createTimingLines(this.track);
    this.trackSeed = this.track.seed ?? trackSeed;
    this.rules = normalizeRaceRules(rules);
    this.startLightsOutAt = this.rules.startLightCount * this.rules.startLightInterval + this.rules.startLightsOutHold;
    this.totalLaps = normalizeTotalLaps(totalLaps);
    this.time = 0;
    this.events = [];
    this.penalties = [];
    this.nextPenaltyId = 1;
    this.stewardState = {
      trackLimits: Object.create(null),
      tireRequirement: Object.create(null),
    };
    this.raceControl = {
      mode: this.rules.standingStart === false ? 'green' : 'pre-start',
      frozenOrder: null,
      redFlag: false,
      pitLaneOpen: true,
      finished: false,
      finishedAt: null,
      winnerId: null,
      classification: [],
      finishOrder: [],
      start: {
        lightCount: this.rules.startLightCount,
        lightsLit: 0,
        lightsOutAt: this.startLightsOutAt,
        released: this.rules.standingStart === false,
        releasedAt: this.rules.standingStart === false ? 0 : null,
      },
    };
    const safetyCarStart = pointAt(this.track, this.rules.safetyCarLeadDistance);
    this.safetyCar = {
      deployed: false,
      progress: this.rules.safetyCarLeadDistance,
      speed: this.rules.safetyCarSpeed,
      previousX: safetyCarStart.x,
      previousY: safetyCarStart.y,
      previousHeading: safetyCarStart.heading,
      x: safetyCarStart.x,
      y: safetyCarStart.y,
      heading: safetyCarStart.heading,
    };
    this.cars = drivers.map((driver, index) => createCar(driver, index, this.random, this.track, {
      standingStart: this.raceControl.mode === 'pre-start',
    }));
    this.assignPitLaneTeams();
    this.initializePitStops();
    this.recalculateRaceState({ updateDrs: false });
    this.cars.forEach((car) => resetTimingHistory(car, this.time));
    this.cars.forEach((car) => resetTimingLineCrossings(car, this.time));
    this.cars.forEach((car) => resetLapTelemetry(car, this.time, this.track, this.totalLaps));
  }

  assignPitLaneTeams() {
    const pitLane = this.track.pitLane;
    if (!pitLane?.enabled || !Array.isArray(pitLane.boxes)) return;
    const boxesPerTeam = pitLane.boxesPerTeam ?? 2;
    const teamCount = pitLane.teamCount ?? Math.ceil(pitLane.boxes.length / boxesPerTeam);

    pitLane.teams = Array.from({ length: teamCount }, (_, teamIndex) => {
      const primary = this.cars[teamIndex * boxesPerTeam] ?? this.cars[teamIndex] ?? null;
      const secondary = this.cars[teamIndex * boxesPerTeam + 1] ?? null;
      const team = primary?.team ?? secondary?.team ?? null;
      const id = team?.id ?? `team-${teamIndex + 1}`;
      const name = team?.name ?? (primary ? `${primary.name} Team` : `Team ${teamIndex + 1}`);
      const color = team?.color ?? primary?.color ?? secondary?.color ?? '#f8fafc';
      const pitCrew = normalizePitCrewStats(
        team?.pitCrew ?? team?.pitCrewStats ?? primary?.team?.pitCrew ?? secondary?.team?.pitCrew,
      );
      const boxIds = pitLane.boxes
        .filter((box) => box.teamIndex === teamIndex)
        .map((box) => box.id);

      pitLane.boxes
        .filter((box) => box.teamIndex === teamIndex)
        .forEach((box) => {
          box.teamId = id;
          box.teamName = name;
          box.teamColor = color;
        });
      const serviceArea = pitLane.serviceAreas?.[teamIndex] ?? null;
      if (serviceArea) {
        serviceArea.teamId = id;
        serviceArea.teamName = name;
        serviceArea.teamColor = color;
        serviceArea.pitCrew = pitCrew;
      }

      return {
        id,
        name,
        color,
        index: teamIndex,
        boxIds,
        serviceAreaId: serviceArea?.id ?? null,
        pitCrew,
      };
    });
  }

  initializePitStops() {
    const pitLane = this.track.pitLane;
    const pitStops = this.rules.modules?.pitStops;
    if (!pitStops?.enabled || !pitLane?.enabled || !Array.isArray(pitLane.boxes) || this.totalLaps < 2) return;
    const boxesPerTeam = pitLane.boxesPerTeam ?? 2;
    const maxConcurrentPitLaneCars = Math.max(1, Math.floor(pitStops.maxConcurrentPitLaneCars ?? 3));
    const pitWindowLapCount = Math.max(1, Math.min(
      this.totalLaps - 1,
      Math.ceil(this.cars.length / maxConcurrentPitLaneCars),
    ));

    this.cars.forEach((car, index) => {
      const stopLapBase = this.track.length * (1 + (index % pitWindowLapCount));
      const trainPosition = Math.floor(index / pitWindowLapCount);
      const teamIndex = Math.floor(index / boxesPerTeam);
      const teamBoxIndex = index % boxesPerTeam;
      const garageBoxIndex = Math.min(pitLane.boxes.length - 1, teamIndex * boxesPerTeam + teamBoxIndex);
      const garageBox = pitLane.boxes[garageBoxIndex] ?? pitLane.boxes[index % pitLane.boxes.length];
      const serviceArea = pitLane.serviceAreas?.[teamIndex] ??
        pitLane.serviceAreas?.[index % pitLane.serviceAreas.length] ??
        garageBox;
      car.pitStop = {
        status: 'pending',
        phase: null,
        boxIndex: serviceArea.index,
        boxId: serviceArea.id,
        garageBoxIndex,
        garageBoxId: garageBox.id,
        teamId: serviceArea.teamId ?? garageBox.teamId ?? null,
        teamColor: serviceArea.teamColor ?? garageBox.teamColor ?? null,
        stopsCompleted: 0,
        entryRaceDistance: stopLapBase + pitLane.entry.distanceFromStart,
        plannedRaceDistance: stopLapBase + pitLane.entry.distanceFromStart -
          PIT_ENTRY_APPROACH_DISTANCE,
        trainPosition,
        lapBase: stopLapBase,
        serviceRemaining: 0,
        penaltyServiceRemaining: 0,
        penaltyServiceTotal: 0,
        servingPenaltyIds: [],
        serviceProfile: null,
        queueingForService: false,
        route: null,
        routeProgress: 0,
        routeStartRaceDistance: null,
        routeEndRaceDistance: null,
        targetTire: firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds),
        intent: PIT_INTENT_NONE,
      };
    });
  }

  setSafetyCar(deployed) {
    const next = Boolean(deployed);
    if (this.raceControl.finished) return;
    if (next && this.raceControl.mode === 'pre-start') return;
    if (this.raceControl.redFlag) return;
    if (next === this.safetyCar.deployed) return;
    const ordered = this.orderedCars();
    this.safetyCar.deployed = next;
    this.raceControl.mode = next ? 'safety-car' : 'green';
    this.raceControl.frozenOrder = next ? ordered.map((car) => car.id) : null;
    if (next) {
      const leader = ordered[0];
      const safetyCarProgress = (leader?.raceDistance ?? 0) + this.rules.safetyCarLeadDistance;
      if (this.safetyCar.progress < safetyCarProgress) {
        this.moveSafetyCarTo(safetyCarProgress);
      }
      this.cars.forEach((car) => {
        car.desiredOffset = 0;
        car.drsActive = false;
        car.drsEligible = false;
        car.drsZoneId = null;
        car.drsZoneEnabled = false;
      });
    }
    this.events.unshift({ type: next ? 'safety-car' : 'green-flag', at: this.time });
  }

  setRedFlag(deployed) {
    const next = Boolean(deployed);
    if (this.raceControl.finished) return;
    if (next && this.raceControl.mode === 'pre-start') return;
    if (next === Boolean(this.raceControl.redFlag)) return;
    this.raceControl.redFlag = next;
    if (next) {
      this.safetyCar.deployed = false;
      this.raceControl.mode = 'red-flag';
      this.raceControl.frozenOrder = this.orderedCars().map((car) => car.id);
      this.cars.forEach((car) => {
        car.speed = 0;
        car.throttle = 0;
        car.brake = 1;
        car.drsActive = false;
        car.drsEligible = false;
        car.drsZoneId = null;
        car.drsZoneEnabled = false;
        car.canAttack = false;
      });
    } else {
      this.raceControl.mode = this.safetyCar.deployed ? 'safety-car' : 'green';
      this.raceControl.frozenOrder = this.safetyCar.deployed
        ? this.orderedCars().map((car) => car.id)
        : null;
      this.cars.forEach((car) => {
        if (!car.finished) {
          car.speed = Math.max(car.speed, kphToSimSpeed(60));
          car.brake = 0;
          car.throttle = Math.max(car.throttle ?? 0, 0.35);
        }
      });
    }
    this.events.unshift({ type: next ? 'red-flag' : 'green-flag', at: this.time });
  }

  setPitLaneOpen(open) {
    const next = Boolean(open);
    if (next === Boolean(this.raceControl.pitLaneOpen)) return;
    this.raceControl.pitLaneOpen = next;
    this.events.unshift({ type: next ? 'pit-lane-open' : 'pit-lane-closed', at: this.time });
  }

  setCarState(id, partial) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return;
    const hasExplicitRaceDistance = partial.raceDistance != null;
    Object.assign(car, partial);
    if (
      partial.x != null ||
      partial.y != null ||
      partial.progress != null ||
      partial.raceDistance != null
    ) {
      car.gridLocked = false;
      if (this.raceControl.mode === 'pre-start' && this.cars.every((item) => !item.gridLocked)) {
        this.releaseRaceStart();
      }
    }
    car.speed = clamp(car.speed, 0, VEHICLE_LIMITS.maxSpeed);
    car.heading = normalizeAngle(car.heading);
    const centerState = nearestTrackState(this.track, car, car.progress ?? car.raceDistance);
    applyWheelSurfaceState(car, this.track, { centerState });
    if (
      partial.desiredOffset == null &&
      (partial.x != null || partial.y != null || partial.progress != null || partial.raceDistance != null)
    ) {
      car.desiredOffset = centerState.signedOffset ?? 0;
    }
    if ((partial.x != null || partial.y != null) && car.pitStop?.route) {
      car.pitStop.routeProgress = nearestDistanceOnRoute(car.pitStop.route, car, car.pitStop.routeProgress ?? 0);
    }
    if (!hasExplicitRaceDistance) {
      const delta = progressDelta(car.trackState.distance, car.progress ?? car.trackState.distance, this.track.length);
      car.raceDistance = (car.raceDistance ?? car.trackState.distance) + delta;
    }
    car.progress = car.trackState.distance;
    car.lap = this.computeLap(car.raceDistance);
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsDetection = {};
    resetTimingHistory(car, this.time);
    resetTimingLineCrossings(car, this.time);
    resetLapTelemetry(car, this.time, this.track, this.totalLaps);
    this.recalculateRaceState({ updateDrs: false });
    this.evaluateRaceFinish();
  }

  setCarControls(id, controls) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return;
    car.manualControls = controls;
  }

  clearCarControls(id) {
    const car = this.cars.find((item) => item.id === id);
    if (car) car.manualControls = null;
  }

  setAutomaticPitIntentEnabled(id, enabled) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return false;
    car.automaticPitIntentEnabled = Boolean(enabled);
    return true;
  }

  getPitIntent(id) {
    const car = this.cars.find((item) => item.id === id);
    return normalizePitIntent(car?.pitStop?.intent) ?? PIT_INTENT_NONE;
  }

  getPitTargetCompound(id) {
    const car = this.cars.find((item) => item.id === id);
    return car?.pitStop?.targetTire ?? null;
  }

  setPitIntent(id, intent, targetCompound = undefined) {
    const request = intent && typeof intent === 'object'
      ? intent
      : { intent, targetCompound };
    const nextIntent = normalizePitIntent(request.intent ?? request.pitIntent);
    if (nextIntent == null) return false;
    const car = this.cars.find((item) => item.id === id);
    const stop = car?.pitStop;
    const pitStops = this.rules.modules?.pitStops;
    if (!car || !stop || !pitStops?.enabled || !this.track.pitLane?.enabled) return false;
    if (this.isCarInActivePitStop(car)) return false;

    const compoundRequest = request.targetCompound ??
      request.compound ??
      request.pitCompound ??
      request.pitTargetCompound ??
      request.targetTire;
    const hasCompoundRequest = compoundRequest != null && compoundRequest !== '';
    if (hasCompoundRequest) {
      const targetTire = normalizePitCompound(compoundRequest, this.rules.modules?.tireStrategy?.compounds);
      if (!targetTire) return false;
      stop.targetTire = targetTire;
    } else if (nextIntent !== PIT_INTENT_NONE && (!stop.targetTire || stop.status === 'completed')) {
      stop.targetTire = firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);
    } else if (nextIntent === PIT_INTENT_NONE) {
      stop.targetTire = firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);
    }

    stop.intent = nextIntent;
    if (stop.status === 'pending' && nextIntent !== PIT_INTENT_NONE) {
      this.schedulePitStopAtNextEntry(car, stop);
    } else if (stop.status === 'completed' && nextIntent !== PIT_INTENT_NONE) {
      this.rearmCompletedPitStop(car, stop);
    }
    return true;
  }

  isCarInActivePitStop(car) {
    return Boolean(car.pitStop && car.pitStop.status !== 'pending' && car.pitStop.status !== 'completed');
  }

  schedulePitStopAtNextEntry(car, stop) {
    const pitLane = this.track.pitLane;
    if (!stop || !pitLane?.entry || !Number.isFinite(this.track.length) || this.track.length <= 0) return false;
    const raceDistance = car.raceDistance ?? 0;
    const entryOffset = pitLane.entry.distanceFromStart ?? 0;
    let lapBase = Math.floor((raceDistance - entryOffset) / this.track.length) * this.track.length;
    let entryRaceDistance = lapBase + entryOffset;

    while (raceDistance > entryRaceDistance + metersToSimUnits(90)) {
      lapBase += this.track.length;
      entryRaceDistance = lapBase + entryOffset;
    }

    stop.lapBase = lapBase;
    stop.entryRaceDistance = entryRaceDistance;
    stop.plannedRaceDistance = entryRaceDistance - PIT_ENTRY_APPROACH_DISTANCE;
    return true;
  }

  rearmCompletedPitStop(car, stop) {
    if (!stop || stop.status !== 'completed') return false;
    stop.status = 'pending';
    stop.phase = null;
    stop.route = null;
    stop.routeProgress = 0;
    stop.routeStartRaceDistance = null;
    stop.routeEndRaceDistance = null;
    stop.serviceRemaining = 0;
    stop.penaltyServiceRemaining = 0;
    stop.penaltyServiceTotal = 0;
    stop.servingPenaltyIds = [];
    stop.queueingForService = false;
    stop.serviceProfile = null;
    stop.targetTire = stop.targetTire ?? firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);
    return this.schedulePitStopAtNextEntry(car, stop);
  }

  canStartPitStop(car) {
    const stop = car.pitStop;
    const pitStops = this.rules.modules?.pitStops;
    if (!stop || !pitStops?.enabled) return false;
    const active = this.cars.filter((candidate) => candidate !== car && this.isCarInActivePitStop(candidate));
    const maxConcurrentPitLaneCars = Math.max(1, Math.floor(pitStops.maxConcurrentPitLaneCars ?? 3));
    if (active.length >= maxConcurrentPitLaneCars) return false;

    if (!pitStops.doubleStacking && stop.teamId) {
      const box = this.getPitStopBox(stop);
      if (this.isPitServiceQueueOccupied(car, box)) return false;
    }

    const minimumGap = Math.max(0, pitStops.minimumPitLaneGap ?? 0);
    const candidateDistance = car.raceDistance ?? 0;
    return active.every((candidate) => {
      const gap = (candidate.raceDistance ?? 0) - candidateDistance;
      return gap < 0 || gap >= minimumGap;
    });
  }

  shouldStartPitStop(car) {
    const stop = car.pitStop;
    if (!stop || stop.status !== 'pending' || car.finished) return false;
    if (!pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops).open) return false;
    const intent = normalizePitIntent(stop.intent) ?? PIT_INTENT_NONE;
    if (intent === PIT_INTENT_NONE) return false;
    const raceDistance = car.raceDistance ?? 0;
    if (raceDistance > stop.entryRaceDistance + metersToSimUnits(90)) {
      this.schedulePitStopAtNextEntry(car, stop);
      return false;
    }
    return raceDistance >= stop.plannedRaceDistance &&
      (intent === PIT_INTENT_COMMITTED || this.canStartPitStop(car));
  }

  updateAutomaticPitIntent(car) {
    const stop = car.pitStop;
    const pitStops = this.rules.modules?.pitStops;
    if (!stop || !['pending', 'completed'].includes(stop.status) || !pitStops?.enabled || car.finished) return;
    if (car.automaticPitIntentEnabled === false) return;
    const tireEnergy = Number(car.tireEnergy ?? 100);
    const requestThreshold = Number(pitStops.tirePitRequestThresholdPercent ?? 50);
    const commitThreshold = Number(pitStops.tirePitCommitThresholdPercent ?? 30);
    if (!Number.isFinite(tireEnergy)) return;

    let nextIntent = PIT_INTENT_NONE;
    if (tireEnergy < commitThreshold) nextIntent = PIT_INTENT_COMMITTED;
    else if (tireEnergy < requestThreshold) nextIntent = PIT_INTENT_IF_FREE;
    if (nextIntent === PIT_INTENT_NONE || nextIntent <= (normalizePitIntent(stop.intent) ?? PIT_INTENT_NONE)) return;

    stop.intent = nextIntent;
    if (stop.status === 'completed') this.rearmCompletedPitStop(car, stop);
    else this.schedulePitStopAtNextEntry(car, stop);
  }

  getPitStopBox(stop) {
    return this.track.pitLane?.serviceAreas?.find((box) => box.id === stop?.boxId) ??
      this.track.pitLane?.boxes?.find((box) => box.id === stop?.boxId) ??
      null;
  }

  isPitServiceBusy(car, box) {
    return this.cars.some((candidate) => (
      candidate !== car &&
      candidate.pitStop?.boxId === box?.id &&
      this.isPitServiceAreaOccupied(candidate, box)
    ));
  }

  isPitServiceAreaOccupied(candidate, box) {
    const status = candidate?.pitStop?.status;
    const phase = candidate?.pitStop?.phase;
    if (!status || !box) return false;
    if (status === 'servicing') return true;
    if (status === 'entering' && phase === 'queue-release') return true;
    if (status === 'exiting') return pointDistance(candidate, box.center) < PIT_SERVICE_CLEAR_DISTANCE;
    return false;
  }

  isPitServiceQueueOccupied(car, box) {
    return this.cars.some((candidate) => (
      candidate !== car &&
      candidate.pitStop?.boxId === box?.id &&
      (
        candidate.pitStop?.status === 'queued' ||
        Boolean(candidate.pitStop?.queueingForService)
      )
    ));
  }

  getPitBoxRaceDistance(stop, box) {
    const pitLane = this.track.pitLane;
    const amount = pitLane?.mainLane?.length > 0 ? box.distanceAlongLane / pitLane.mainLane.length : 0;
    return stop.lapBase + pitLane.entry.distanceFromStart +
      (pitLane.exit.distanceFromStart - pitLane.entry.distanceFromStart) * amount;
  }

  startPitStop(car) {
    const stop = car.pitStop;
    const box = this.getPitStopBox(stop);
    const pitLane = this.track.pitLane;
    if (!stop || !box || !pitLane?.enabled) return false;

    car.gridLocked = false;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.canAttack = false;
    stop.targetTire = stop.targetTire ?? firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);

    const currentState = applyWheelSurfaceState(car, this.track).representativeState;
    this.events.unshift({
      type: 'pit-entry',
      at: this.time,
      carId: car.id,
      boxId: box.id,
      teamId: box.teamId ?? null,
    });

    if (currentState.surface === 'pit-box' && currentState.pitBoxId === box.id) {
      this.beginPitService(car, box);
      return true;
    }

    const hasServiceQueue = Boolean(box.queuePoint);
    const shouldStageForService = hasServiceQueue;
    const queueDistanceAlongLane = box.queueDistanceAlongLane ??
      Math.max(0, box.distanceAlongLane - PIT_SERVICE_QUEUE_FALLBACK_GAP);
    const stopDistanceAlongLane = shouldStageForService
      ? queueDistanceAlongLane
      : box.distanceAlongLane;
    const serviceTarget = shouldStageForService ? box.queuePoint : box.center;
    const driveLaneOffset = pitDriveLaneOffset(pitLane);
    const boxApproachDistance = Math.max(
      0,
      (hasServiceQueue ? queueDistanceAlongLane : stopDistanceAlongLane) - PIT_BOX_APPROACH_DISTANCE,
    );
    const route = createRoute([
      ...createPitApproachPoints(this.track, car, pitLane, stop.entryRaceDistance),
      ...(pitLane.entry.roadCenterline ?? []).map((point) => routePoint(point)),
      routePoint(pitMainLanePointAt(pitLane, 0, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(pitMainLanePointAt(pitLane, boxApproachDistance, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(serviceTarget, pitLane.mainLane.heading, { limiterActive: true }),
    ]);
    stop.status = 'entering';
    stop.phase = 'entry';
    stop.queueingForService = shouldStageForService;
    stop.route = route;
    stop.routeProgress = 0;
    stop.routeStartRaceDistance = car.raceDistance ?? stop.plannedRaceDistance;
    stop.routeEndRaceDistance = this.getPitBoxRaceDistance(stop, {
      ...box,
      distanceAlongLane: stopDistanceAlongLane,
    });
    return true;
  }

  beginPitQueue(car, box) {
    const stop = car.pitStop;
    if (!stop || !box?.queuePoint) return false;
    stop.status = 'queued';
    stop.phase = 'queue';
    stop.route = null;
    stop.routeProgress = 0;
    stop.queueingForService = false;
    car.x = box.queuePoint.x;
    car.y = box.queuePoint.y;
    car.heading = this.track.pitLane.mainLane.heading;
    car.speed = 0;
    car.throttle = 0;
    car.brake = 1;
    applyWheelSurfaceState(car, this.track);
    car.progress = car.trackState.distance;
    car.raceDistance = this.getPitBoxRaceDistance(stop, {
      ...box,
      distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
    });
    return true;
  }

  releasePitQueue(car, box, { fromCurrent = false } = {}) {
    const stop = car.pitStop;
    if (!stop || !box?.center) return false;
    const route = createRoute([
      ...(fromCurrent ? [routePoint(car, car.heading, { limiterActive: true })] : []),
      routePoint(box.queuePoint, this.track.pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(box.center, this.track.pitLane.mainLane.heading, { limiterActive: true }),
    ]);
    stop.status = 'entering';
    stop.phase = 'queue-release';
    stop.queueingForService = false;
    stop.route = route;
    stop.routeProgress = 0;
    stop.routeStartRaceDistance = fromCurrent
      ? car.raceDistance ?? this.getPitBoxRaceDistance(stop, {
          ...box,
          distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
        })
      : this.getPitBoxRaceDistance(stop, {
          ...box,
          distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
        });
    stop.routeEndRaceDistance = this.getPitBoxRaceDistance(stop, box);
    return true;
  }

  beginPitService(car, box) {
    const stop = car.pitStop;
    stop.status = 'servicing';
    stop.route = null;
    stop.routeProgress = 0;
    car.x = box.center.x;
    car.y = box.center.y;
    car.heading = this.track.pitLane.mainLane.heading;
    car.speed = 0;
    car.throttle = 0;
    car.brake = 1;
    car.steeringAngle = 0;
    car.yawRate = 0;
    car.turnRadius = Infinity;
    applyWheelSurfaceState(car, this.track);
    car.progress = car.trackState.distance;
    car.raceDistance = this.getPitBoxRaceDistance(stop, box);

    if (this.beginPitPenaltyService(car)) return;
    this.beginTireService(car);
  }

  beginPitPenaltyService(car) {
    const stop = car.pitStop;
    const penalties = this.getPitServicePenalties(car.id);
    if (!stop || !penalties.length) return false;

    const totalSeconds = penalties.reduce((total, penalty) => (
      total + getPitServicePenaltySeconds(penalty)
    ), 0);
    stop.servingPenaltyIds = penalties.map((penalty) => penalty.id);
    stop.penaltyServiceTotal = totalSeconds;
    stop.penaltyServiceRemaining = totalSeconds;

    if (totalSeconds <= 0) {
      this.completePitPenaltyService(car);
      return true;
    }

    stop.phase = 'penalty';
    stop.serviceRemaining = totalSeconds;
    this.events.unshift({
      type: 'pit-penalty-service-start',
      at: this.time,
      carId: car.id,
      penaltyIds: [...stop.servingPenaltyIds],
      penaltyServiceSeconds: totalSeconds,
    });
    return true;
  }

  calculatePitServiceProfile(car) {
    const pitStops = this.rules.modules?.pitStops ?? {};
    const variability = pitStops.variability ?? {};
    const baseSeconds = Math.max(0, Number(pitStops.defaultStopSeconds) || 2.8);
    const box = this.getPitStopBox(car?.pitStop);
    const team = this.track.pitLane?.teams?.find((entry) => entry.id === car?.pitStop?.teamId);
    const pitCrew = normalizePitCrewStats(
      box?.pitCrew ?? team?.pitCrew ?? car?.team?.pitCrew ?? car?.team?.pitCrewStats,
    );
    const profile = {
      baseSeconds,
      seconds: baseSeconds,
      perfect: Boolean(variability.perfect),
      variabilityEnabled: Boolean(variability.enabled),
      teamId: car?.pitStop?.teamId ?? box?.teamId ?? null,
      pitCrew,
      speedDeltaSeconds: 0,
      consistencyDeltaSeconds: 0,
      issueDelaySeconds: 0,
      issue: null,
    };

    if (!variability.enabled || variability.perfect) return profile;

    const speedImpact = Math.max(0, Number(variability.speedImpactSeconds) || 0);
    const jitterImpact = Math.max(0, Number(variability.consistencyJitterSeconds) || 0);
    const issueChance = clamp(Number(variability.issueChance) || 0, 0, 1);
    const issueMaxDelay = Math.max(0, Number(variability.issueMaxDelaySeconds) || 0);
    profile.speedDeltaSeconds = (0.5 - pitCrew.speed) * speedImpact;
    profile.consistencyDeltaSeconds = (this.random() - 0.5) * (1 - pitCrew.consistency) * jitterImpact;
    const effectiveIssueChance = issueChance * (1 - pitCrew.reliability);
    if (this.random() < effectiveIssueChance) {
      profile.issueDelaySeconds = 0.35 + this.random() * issueMaxDelay * (1 - pitCrew.reliability);
      profile.issue = 'slow-stop';
    }
    profile.seconds = Math.max(
      Math.min(1.6, baseSeconds),
      baseSeconds + profile.speedDeltaSeconds + profile.consistencyDeltaSeconds + profile.issueDelaySeconds,
    );
    return profile;
  }

  beginTireService(car) {
    const stop = car.pitStop;
    if (!stop) return;
    const serviceProfile = this.calculatePitServiceProfile(car);
    stop.phase = 'service';
    stop.penaltyServiceRemaining = 0;
    stop.serviceProfile = serviceProfile;
    stop.serviceRemaining = serviceProfile.seconds;
    this.events.unshift({
      type: 'pit-stop-start',
      at: this.time,
      carId: car.id,
      boxId: stop.boxId,
      teamId: stop.teamId ?? null,
      targetTire: stop.targetTire,
      serviceSeconds: serviceProfile.seconds,
      serviceIssue: serviceProfile.issue,
    });
  }

  completePitPenaltyService(car) {
    const stop = car.pitStop;
    if (!stop) return;
    const servedIds = [...(stop.servingPenaltyIds ?? [])];
    servedIds.forEach((penaltyId) => {
      const penalty = this.penalties.find((entry) => entry.id === penaltyId);
      const beforeStatus = penalty?.status;
      const result = servePitPenaltyRecord(penalty, this.time);
      if (result && beforeStatus !== result.status) {
        this.events.unshift({
          type: 'penalty-served',
          at: this.time,
          penaltyId: result.id,
          driverId: result.driverId,
          serviceType: result.serviceType,
          serviceContext: 'pit-stop',
        });
      }
    });
    stop.penaltyServiceRemaining = 0;
    stop.serviceRemaining = 0;
    this.events.unshift({
      type: 'pit-penalty-service-complete',
      at: this.time,
      carId: car.id,
      penaltyIds: servedIds,
    });
    this.beginTireService(car);
  }

  getPitServicePenalties(driverId) {
    return this.penalties.filter((penalty) => (
      penalty.driverId === driverId && isPenaltyPitServiceable(penalty)
    ));
  }

  completePitService(car) {
    const stop = car.pitStop;
    const box = this.getPitStopBox(stop);
    const pitLane = this.track.pitLane;
    if (!stop || !box || !pitLane?.enabled) return;

    car.tire = stop.targetTire ?? car.tire;
    car.tireEnergy = 100;
    if (car.tire && !car.usedTireCompounds.includes(car.tire)) car.usedTireCompounds.push(car.tire);
    this.events.unshift({
      type: 'pit-stop-complete',
      at: this.time,
      carId: car.id,
      boxId: box.id,
      teamId: box.teamId ?? null,
      tire: car.tire,
    });

    const driveLaneOffset = pitDriveLaneOffset(pitLane);
    const boxReleaseDistance = Math.min(pitLane.mainLane.length, box.distanceAlongLane + PIT_BOX_APPROACH_DISTANCE);
    const route = createRoute([
      routePoint(box.center, pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(box.laneTarget, pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(pitMainLanePointAt(pitLane, boxReleaseDistance, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(pitMainLanePointAt(pitLane, pitLane.mainLane.length, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
      ...(pitLane.exit.roadCenterline ?? []).map((point) => routePoint(point)),
    ]);
    stop.status = 'exiting';
    stop.phase = 'exit';
    stop.route = route;
    stop.routeProgress = 0;
    stop.routeStartRaceDistance = this.getPitBoxRaceDistance(stop, box);
    stop.routeEndRaceDistance = stop.lapBase + pitLane.exit.distanceFromStart;
  }

  finishPitExit(car) {
    const stop = car.pitStop;
    if (!stop) return;
    stop.status = 'completed';
    stop.phase = null;
    stop.route = null;
    stop.routeProgress = 0;
    stop.serviceRemaining = 0;
    stop.queueingForService = false;
    stop.stopsCompleted = (stop.stopsCompleted ?? 0) + 1;
    stop.intent = PIT_INTENT_NONE;
    car.speed = Math.max(car.speed, kphToSimSpeed(PIT_EXIT_RELEASE_SPEED_KPH));
    car.throttle = 0.55;
    car.brake = 0;
    applyWheelSurfaceState(car, this.track);
    car.progress = car.trackState.distance;
    car.raceDistance = Math.max(car.raceDistance ?? 0, stop.routeEndRaceDistance ?? car.raceDistance ?? 0);
    this.events.unshift({
      type: 'pit-exit',
      at: this.time,
      carId: car.id,
      boxId: stop.boxId,
      teamId: stop.teamId ?? null,
    });
  }

  applyPitRoutePosition(car, delta) {
    const stop = car.pitStop;
    if (!stop?.route) return false;
    const speedLimit = kphToSimSpeed(this.rules.modules?.pitStops?.pitLaneSpeedLimitKph ?? 80);
    const route = stop.route;
    if (stop.phase === 'queue-release') {
      const nextProgress = Math.min(route.length, (stop.routeProgress ?? 0) + PIT_QUEUE_RELEASE_SPEED * delta);
      const point = sampleRoute(route, nextProgress);
      if (!point) return false;
      const previousHeading = car.heading;
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.x = point.x;
      car.y = point.y;
      car.heading = point.heading ?? this.track.pitLane.mainLane.heading;
      car.speed = PIT_QUEUE_RELEASE_SPEED;
      car.throttle = 0.32;
      car.brake = 0;
      car.yawRate = normalizeAngle(car.heading - previousHeading) / Math.max(delta, 1e-6);
      car.steeringAngle = clamp(
        Math.atan((car.yawRate * VEHICLE_LIMITS.wheelbase) / Math.max(car.speed, 1)),
        -VEHICLE_LIMITS.maxSteer,
        VEHICLE_LIMITS.maxSteer,
      );
      car.turnRadius = Math.abs(car.yawRate) < 0.001 ? Infinity : car.speed / Math.abs(car.yawRate);
      stop.routeProgress = nextProgress;
      const routeAmount = route.length > 0 ? stop.routeProgress / route.length : 1;
      car.raceDistance = stop.routeStartRaceDistance +
        (stop.routeEndRaceDistance - stop.routeStartRaceDistance) * routeAmount;
      applyWheelSurfaceState(car, this.track);
      car.progress = car.trackState.distance;
      car.lap = this.computeLap(car.raceDistance);
      return route.length - stop.routeProgress <= PIT_QUEUE_RELEASE_FINISH_DISTANCE;
    }
    stop.routeProgress = clamp(stop.routeProgress ?? nearestDistanceOnRoute(route, car, 0), 0, route.length);
    const routeEnd = route.points.at(-1);
    const limiterActive = routeLimiterActiveAt(route, stop.routeProgress);
    let targetSpeed = limiterActive
      ? Math.min(speedLimit, VEHICLE_LIMITS.maxSpeed)
      : Math.min(kphToSimSpeed(150), VEHICLE_LIMITS.maxSpeed);
    if (!limiterActive && stop.status === 'entering') {
      targetSpeed = Math.min(targetSpeed, speedLimit + kphToSimSpeed(PIT_ENTRY_CONNECTOR_OVERSPEED_KPH));
      const distanceToLimiter = distanceToNextLimiterSegment(route, stop.routeProgress);
      if (distanceToLimiter < PIT_LIMITER_BRAKE_DISTANCE) {
        targetSpeed = Math.min(
          targetSpeed,
          speedLimit + Math.max(0, distanceToLimiter * PIT_LIMITER_APPROACH_SPEED_SLOPE),
        );
      }
    }
    if (stop.status === 'entering') {
      const remainingBefore = Math.max(0, route.length - stop.routeProgress);
      const captureDistance = stop.queueingForService ? PIT_QUEUE_CAPTURE_DISTANCE : PIT_ENTRY_BOX_CAPTURE_DISTANCE;
      const brakeZone = stop.queueingForService ? metersToSimUnits(25) : metersToSimUnits(80);
      if (remainingBefore < brakeZone) {
        const brakingSlope = stop.queueingForService ? kphToSimSpeed(62) / metersToSimUnits(100) : kphToSimSpeed(24) / metersToSimUnits(100);
        const captureSpeedFloor = stop.queueingForService ? kphToSimSpeed(42) : kphToSimSpeed(28);
        const approachSpeed = remainingBefore > captureDistance
          ? Math.max(captureSpeedFloor, remainingBefore * brakingSlope)
          : remainingBefore * brakingSlope;
        targetSpeed = Math.min(targetSpeed, clamp(approachSpeed, 0, speedLimit * 0.78));
      }
    }

    const nextProgress = Math.min(route.length, stop.routeProgress + Math.max(0, targetSpeed) * delta);
    const point = sampleRoute(route, nextProgress);
    if (!point) return false;
    const previousSpeed = car.speed;
    const previousHeading = car.heading;
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    car.x = point.x;
    car.y = point.y;
    car.heading = point.heading ?? car.heading;
    car.speed = targetSpeed;
    car.throttle = limiterActive ? 0.28 : 0.46;
    car.brake = targetSpeed < previousSpeed ? 0.4 : 0;
    car.yawRate = normalizeAngle(car.heading - previousHeading) / Math.max(delta, 1e-6);
    car.steeringAngle = clamp(
      Math.atan((car.yawRate * VEHICLE_LIMITS.wheelbase) / Math.max(car.speed, 1)),
      -VEHICLE_LIMITS.maxSteer,
      VEHICLE_LIMITS.maxSteer,
    );
    car.turnRadius = Math.abs(car.yawRate) < 0.001 ? Infinity : car.speed / Math.abs(car.yawRate);
    applyWheelSurfaceState(car, this.track);
    stop.routeProgress = nextProgress;
    const routeAmount = route.length > 0 ? stop.routeProgress / route.length : 1;
    car.raceDistance = stop.routeStartRaceDistance +
      (stop.routeEndRaceDistance - stop.routeStartRaceDistance) * routeAmount;
    car.progress = car.trackState.distance;
    car.lap = this.computeLap(car.raceDistance);
    const remainingAfter = Math.max(0, route.length - stop.routeProgress);
    if (stop.status === 'entering') {
      const captureDistance = stop.queueingForService ? PIT_QUEUE_CAPTURE_DISTANCE : PIT_ENTRY_BOX_CAPTURE_DISTANCE;
      const captureSpeed = stop.queueingForService ? PIT_QUEUE_CAPTURE_SPEED : PIT_BOX_STOP_SPEED;
      return remainingAfter <= captureDistance &&
        pointDistance(car, routeEnd) <= captureDistance &&
        car.speed <= captureSpeed;
    }
    return remainingAfter <= PIT_ROUTE_FINISH_DISTANCE;
  }

  advancePitStopCar(car, delta) {
    const pitStops = this.rules.modules?.pitStops;
    const stop = car.pitStop;
    if (!pitStops?.enabled || !stop) return false;
    if (stop.status === 'pending' || stop.status === 'completed') this.updateAutomaticPitIntent(car);
    if (stop.status === 'completed') return false;
    if (stop.status === 'pending' && !this.shouldStartPitStop(car)) return false;
    if (stop.status === 'pending') this.startPitStop(car);

    if (stop.status === 'entering') {
      const finishedRoute = this.applyPitRoutePosition(car, delta);
      const box = this.getPitStopBox(stop);
      if (finishedRoute && box) {
        if (stop.queueingForService) {
          if (!this.isPitServiceBusy(car, box) && !this.isPitServiceQueueOccupied(car, box)) {
            this.releasePitQueue(car, box, { fromCurrent: true });
          } else {
            this.beginPitQueue(car, box);
          }
        }
        else this.beginPitService(car, box);
      }
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
      return true;
    }

    if (stop.status === 'queued') {
      const box = this.getPitStopBox(stop);
      if (!box) return true;
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.x = box.queuePoint.x;
      car.y = box.queuePoint.y;
      car.heading = this.track.pitLane.mainLane.heading;
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      applyWheelSurfaceState(car, this.track);
      car.progress = car.trackState.distance;
      car.raceDistance = this.getPitBoxRaceDistance(stop, {
        ...box,
        distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
      });
      if (!this.isPitServiceBusy(car, box)) this.releasePitQueue(car, box);
      return true;
    }

    if (stop.status === 'servicing') {
      const box = this.getPitStopBox(stop);
      if (!box) return true;
      if (stop.phase === 'penalty') {
        stop.penaltyServiceRemaining = Math.max(0, (stop.penaltyServiceRemaining ?? 0) - delta);
        stop.serviceRemaining = stop.penaltyServiceRemaining;
      } else {
        stop.serviceRemaining = Math.max(0, (stop.serviceRemaining ?? 0) - delta);
      }
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.x = box.center.x;
      car.y = box.center.y;
      car.heading = this.track.pitLane.mainLane.heading;
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      applyWheelSurfaceState(car, this.track);
      car.progress = car.trackState.distance;
      car.raceDistance = this.getPitBoxRaceDistance(stop, box);
      if (stop.phase === 'penalty' && stop.penaltyServiceRemaining <= 0) {
        this.completePitPenaltyService(car);
      } else if (stop.serviceRemaining <= 0) {
        this.completePitService(car);
      }
      return true;
    }

    if (stop.status === 'exiting') {
      const finishedRoute = this.applyPitRoutePosition(car, delta);
      if (finishedRoute) this.finishPitExit(car);
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
      return true;
    }

    return false;
  }

  step(dt) {
    const delta = clamp(dt, 0, 1 / 20);
    if (!Number.isFinite(delta) || delta <= 0) return;

    this.time += delta;
    this.events = [];
    this.updateStartSequence();
    this.recalculateRaceState({ updateDrs: false });

    if (this.raceControl.mode === 'pre-start' && this.cars.every((car) => car.gridLocked)) {
      this.holdGridCars();
      this.recalculateRaceState({ updateDrs: false });
      return;
    }

    if (this.raceControl.redFlag) {
      this.cars.forEach((car) => {
        car.previousX = car.x;
        car.previousY = car.y;
        car.previousHeading = car.heading;
        car.speed = 0;
        car.throttle = 0;
        car.brake = 1;
        car.drsActive = false;
        car.drsEligible = false;
        car.drsZoneId = null;
        car.drsZoneEnabled = false;
        car.canAttack = false;
      });
      this.recalculateRaceState({ updateDrs: false });
      return;
    }

    this.updateSafetyCar(delta);

    const orderedCars = this.orderedCars();
    const raceContext = this.driverRaceContext(orderedCars);
    orderedCars.forEach((car, index) => {
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.previousProgress = car.progress;
      if (this.advancePitStopCar(car, delta)) return;
      const controls = decideDriverControls({
        car,
        orderIndex: index,
        race: raceContext,
      });
      integrateVehiclePhysics(car, controls, delta);
      this.applyRunoffResponse(car);
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
    });

    this.resolveCollisions();
    this.recalculateRaceState();
    this.reviewTrackLimits();
    this.evaluateRaceFinish();
  }

  recordPenalty(penalty) {
    const car = this.cars.find((item) => item.id === penalty.driverId);
    const entry = createPenaltyRecord({
      sequence: this.nextPenaltyId,
      time: this.time,
      lap: this.computeLap(car?.raceDistance ?? 0),
      penalty,
    });
    this.nextPenaltyId += 1;
    this.penalties.push(entry);
    if (entry.gridDrop > 0 && this.raceControl.mode === 'pre-start') {
      this.applyGridDrop(entry.driverId, entry.gridDrop);
    }
    this.events.unshift(createPenaltyEvent(entry));
    return entry;
  }

  servePenalty(penaltyId) {
    const penalty = this.penalties.find((entry) => entry.id === penaltyId);
    const result = servePenaltyRecord(penalty, this.time);
    if (result) {
      this.events.unshift({
        type: 'penalty-served',
        at: this.time,
        penaltyId: result.id,
        driverId: result.driverId,
        serviceType: result.serviceType,
      });
    }
    return result;
  }

  cancelPenalty(penaltyId) {
    const penalty = this.penalties.find((entry) => entry.id === penaltyId);
    const result = cancelPenaltyRecord(penalty, this.time);
    if (result) {
      this.events.unshift({
        type: 'penalty-cancelled',
        at: this.time,
        penaltyId: result.id,
        driverId: result.driverId,
      });
    }
    return result;
  }

  getDriverPenaltySeconds(driverId) {
    return this.penalties
      .filter((penalty) => penalty.driverId === driverId && isPenaltyActive(penalty))
      .reduce((total, penalty) => total + (Number(penalty.penaltySeconds) || 0), 0);
  }

  getDriverPositionDrop(driverId) {
    return this.penalties
      .filter((penalty) => penalty.driverId === driverId && isPenaltyActive(penalty))
      .reduce((total, penalty) => total + (Number(penalty.positionDrop) || 0), 0);
  }

  isDriverDisqualified(driverId) {
    return this.penalties.some((penalty) => (
      penalty.driverId === driverId && isPenaltyActive(penalty) && penalty.disqualified
    ));
  }

  applyGridDrop(driverId, positions) {
    const drop = Math.max(0, Math.floor(Number(positions) || 0));
    if (drop <= 0) return;

    const ordered = [...this.cars].sort((left, right) => {
      const delta = right.gridDistance - left.gridDistance;
      return delta === 0 ? left.index - right.index : delta;
    });
    const currentIndex = ordered.findIndex((car) => car.id === driverId);
    if (currentIndex < 0) return;
    const [car] = ordered.splice(currentIndex, 1);
    ordered.splice(Math.min(ordered.length, currentIndex + drop), 0, car);

    ordered.forEach((entry, index) => {
      const { gridDistance, gridOffset } = getStartGridSlot(index, { standingStart: true });
      const gridPoint = pointAt(this.track, gridDistance);
      const position = offsetTrackPoint(gridPoint, gridOffset);
      entry.gridDistance = gridDistance;
      entry.gridOffset = gridOffset;
      entry.rank = index + 1;
      if (entry.gridLocked) {
        entry.x = position.x;
        entry.y = position.y;
        entry.previousX = position.x;
        entry.previousY = position.y;
        entry.heading = gridPoint.heading;
        entry.previousHeading = gridPoint.heading;
        entry.progress = gridPoint.distance;
        entry.raceDistance = gridDistance;
        applyWheelSurfaceState(entry, this.track);
      }
    });
  }

  reviewCollision(first, second, collision) {
    const rule = getPenaltyRule(this.rules, 'collision');
    calculateCollisionPenalties({ first, second, collision, rule })
      .forEach((penalty) => this.recordPenalty(penalty));
  }

  reviewTireRequirement(car) {
    if (this.stewardState.tireRequirement[car.id]) return;
    const rule = getPenaltyRule(this.rules, 'tireRequirement');
    const penalty = calculateTireRequirementPenalty({
      car,
      tireStrategy: this.rules.modules?.tireStrategy,
      rule,
    });
    this.stewardState.tireRequirement[car.id] = true;
    if (penalty) this.recordPenalty(penalty);
  }

  reviewTrackLimits() {
    const rule = getPenaltyRule(this.rules, 'trackLimits');
    if (!rule) return;

    this.cars.forEach((car) => {
      const currentState = this.stewardState.trackLimits[car.id];
      if (isLegallyInsidePitLaneForTrackLimits(car) && !currentState?.active) {
        return;
      }
      const review = calculateTrackLimitReview({
        car,
        rule,
        track: this.track,
        stewardState: currentState,
      });
      this.stewardState.trackLimits[car.id] = review.nextState;
      if (review.event) this.events.unshift({ ...review.event, at: this.time });
      if (review.penalty) this.recordPenalty(review.penalty);
    });
  }

  snapshot() {
    const ordered = this.orderedCars();
    const pitLaneStatus = pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops);
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
        redFlag: Boolean(this.raceControl.redFlag),
        pitLaneOpen: pitLaneStatus.open,
        pitLaneStatus,
        finished: this.raceControl.finished,
        finishedAt: this.raceControl.finishedAt,
        winner: this.getRaceWinnerSnapshot(),
        classification: this.raceControl.classification.map((entry) => ({ ...entry })),
        start: {
          ...this.raceControl.start,
          visible: this.raceControl.mode === 'pre-start' ||
            (this.raceControl.start.releasedAt != null && this.time - this.raceControl.start.releasedAt < 1.45),
        },
      },
      pitLaneStatus,
      safetyCar: { ...this.safetyCar },
      rules: this.rules,
      events: [...this.events],
      penalties: this.penalties.map(serializePenalty),
      cars: ordered.map((car, index) => serializeCar(car, index + 1, this.getDriverPenaltySeconds(car.id))),
    };
  }

  snapshotRender() {
    const pitLaneStatus = pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops);
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
        redFlag: Boolean(this.raceControl.redFlag),
        pitLaneOpen: pitLaneStatus.open,
        pitLaneStatus,
        finished: this.raceControl.finished,
        start: {
          ...this.raceControl.start,
          visible: this.raceControl.mode === 'pre-start' ||
            (this.raceControl.start.releasedAt != null && this.time - this.raceControl.start.releasedAt < 1.45),
        },
      },
      pitLaneStatus,
      safetyCar: { ...this.safetyCar },
      cars: this.orderedCars().map(serializeRenderCar),
    };
  }

  snapshotObservation() {
    const pitLaneStatus = pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops);
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
        redFlag: Boolean(this.raceControl.redFlag),
        pitLaneOpen: pitLaneStatus.open,
        pitLaneStatus,
        finished: this.raceControl.finished,
      },
      pitLaneStatus,
      safetyCar: { ...this.safetyCar },
      events: [...this.events],
      cars: this.orderedCars().map((car, index) => serializeObservationCar(car, index + 1)),
    };
  }

  consumeStepEvents() {
    return [...this.events];
  }

  orderedCars() {
    const sortLive = (cars) => [...cars].sort((a, b) => {
      const delta = b.raceDistance - a.raceDistance;
      return delta === 0 ? a.index - b.index : delta;
    });
    const byId = new Map(this.cars.map((car) => [car.id, car]));

    if (this.raceControl.finished && this.raceControl.classification?.length) {
      const classified = this.raceControl.classification.map((entry) => byId.get(entry.id)).filter(Boolean);
      const classifiedIds = new Set(classified.map((car) => car.id));
      return [
        ...classified,
        ...sortLive(this.cars.filter((car) => !classifiedIds.has(car.id))),
      ];
    }

    if (this.raceControl.finishOrder?.length) {
      const finished = this.raceControl.finishOrder.map((id) => byId.get(id)).filter(Boolean);
      const finishedIds = new Set(finished.map((car) => car.id));
      const missedFinished = this.cars
        .filter((car) => car.finished && !finishedIds.has(car.id))
        .sort((a, b) => {
          const delta = (a.finishRank ?? Infinity) - (b.finishRank ?? Infinity);
          return delta === 0 ? a.index - b.index : delta;
        });
      const running = sortLive(this.cars.filter((car) => !finishedIds.has(car.id) && !car.finished));
      return [...finished, ...missedFinished, ...running];
    }

    if (this.safetyCar.deployed && this.raceControl.frozenOrder?.length) {
      return this.raceControl.frozenOrder.map((id) => byId.get(id)).filter(Boolean);
    }

    return sortLive(this.cars);
  }

  driverRaceContext(orderedCars = this.orderedCars()) {
    return {
      track: this.track,
      cars: this.cars,
      orderedCars,
      safetyCar: this.safetyCar,
      rules: this.rules,
    };
  }

  computeAggression(car, orderIndex = Math.max(0, (car.rank ?? 1) - 1)) {
    const personality = car.personality ?? { baseAggression: 0.5, riskTolerance: 0.5, patience: 0.5 };
    if (this.safetyCar.deployed || car.canAttack === false) {
      return clamp(personality.baseAggression * 0.62, 0.08, 0.62);
    }

    const fieldDepth = Math.max(1, this.cars.length - 1);
    const positionPressure = clamp(orderIndex / fieldDepth, 0, 1);
    const gapPressure = Number.isFinite(car.gapAhead) ? clamp((230 - car.gapAhead) / 230, 0, 1) : 0;
    const tireConfidence = clamp(((car.tireEnergy ?? 100) - 42) / 58, 0, 1);
    const patienceDamping = (1 - gapPressure) * personality.patience * 0.08;

    return clamp(
      personality.baseAggression
        + positionPressure * 0.26
        + gapPressure * (0.1 + personality.riskTolerance * 0.08)
        - (1 - tireConfidence) * 0.1
        - patienceDamping,
      0.08,
      1,
    );
  }

  updateStartSequence() {
    const start = this.raceControl.start;
    if (this.raceControl.mode !== 'pre-start' || !start || start.released) return;

    if (this.time >= start.lightsOutAt) {
      this.releaseRaceStart();
      this.events.unshift({ type: 'start-lights-out', at: this.time });
      return;
    }

    start.lightsLit = clamp(
      Math.floor((this.time + Number.EPSILON) / this.rules.startLightInterval),
      0,
      start.lightCount,
    );
  }

  releaseRaceStart() {
    const start = this.raceControl.start;
    this.raceControl.mode = 'green';
    start.lightsLit = 0;
    start.released = true;
    start.releasedAt = this.time;
    this.cars.forEach((car) => {
      const wasGridLocked = car.gridLocked;
      car.gridLocked = false;
      const state = nearestTrackState(this.track, car, car.gridDistance);
      car.progress = state.distance;
      applyWheelSurfaceState(car, this.track);
      if (wasGridLocked) car.raceDistance = car.gridDistance;
      if (wasGridLocked) car.desiredOffset = 0;
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
    });
  }

  holdGridCars() {
    this.cars.forEach((car) => {
      if (!car.gridLocked) return;
      const gridPoint = pointAt(this.track, car.gridDistance);
      const position = offsetTrackPoint(gridPoint, car.gridOffset);
      car.previousX = position.x;
      car.previousY = position.y;
      car.previousHeading = gridPoint.heading;
      car.x = position.x;
      car.y = position.y;
      car.heading = gridPoint.heading;
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      car.steeringAngle = 0;
      car.yawRate = 0;
      car.turnRadius = Infinity;
      car.progress = gridPoint.distance;
      car.raceDistance = car.gridDistance;
      applyWheelSurfaceState(car, this.track);
    });
  }

  updateSafetyCar(dt) {
    if (!this.safetyCar.deployed) return;
    const leader = this.orderedCars()[0];
    const targetProgress = (leader?.raceDistance ?? 0) + this.rules.safetyCarLeadDistance;
    const progress = this.safetyCar.progress < targetProgress
      ? Math.min(this.safetyCar.progress + this.safetyCar.speed * dt, targetProgress)
      : targetProgress;
    this.moveSafetyCarTo(progress);
  }

  moveSafetyCarTo(progress) {
    const point = pointAt(this.track, progress);
    this.safetyCar.previousX = this.safetyCar.x;
    this.safetyCar.previousY = this.safetyCar.y;
    this.safetyCar.previousHeading = this.safetyCar.heading;
    this.safetyCar.progress = progress;
    this.safetyCar.x = point.x;
    this.safetyCar.y = point.y;
    this.safetyCar.heading = point.heading;
  }

  applyRunoffResponse(car) {
    const state = nearestTrackState(this.track, car, car.progress);
    if (state.inPitLane) {
      applyWheelSurfaceState(car, this.track, { centerState: state });
      return;
    }
    const signedLimit = this.track.width / 2 + this.track.gravelWidth + this.track.runoffWidth;
    const overshoot = Math.abs(state.signedOffset) - signedLimit;
    if (overshoot <= 0) {
      applyWheelSurfaceState(car, this.track, { centerState: state });
      return;
    }

    const side = Math.sign(state.signedOffset) || 1;
    car.x -= state.normalX * side * overshoot;
    car.y -= state.normalY * side * overshoot;
    car.speed = clamp(car.speed * clamp(1 - overshoot * 0.012, 0.22, 0.86), 0, VEHICLE_LIMITS.maxSpeed);
    car.heading = normalizeAngle(car.heading - side * clamp(overshoot * 0.0028, 0.018, 0.08));
    applyWheelSurfaceState(car, this.track);
  }

  recalculateRaceState({ updateDrs = true } = {}) {
    this.cars.forEach((car) => {
      const previousRaceDistance = car.raceDistance;
      if (car.gridLocked) {
        const gridPoint = pointAt(this.track, car.gridDistance);
        applyWheelSurfaceState(car, this.track);
        car.progress = gridPoint.distance;
        car.raceDistance = car.gridDistance;
        car.lap = 1;
        resetLapTelemetry(car, this.time, this.track, this.totalLaps);
        return;
      }

      applyWheelSurfaceState(car, this.track);
      const previousProgress = car.progress ?? car.trackState.distance;
      const delta = progressDelta(car.trackState.distance, previousProgress, this.track.length);
      car.raceDistance = (car.raceDistance ?? previousProgress) + delta;
      car.progress = car.trackState.distance;
      car.lap = this.computeLap(car.raceDistance);
      updateLapTelemetry(car, previousRaceDistance, this.time, this.track, this.totalLaps);
    });

    updateSectorPerformance(this.cars);
    this.cars.forEach((car) => {
      recordTimingSample(car, this.time);
      recordTimingLineCrossings(car, car.previousRaceDistanceForTiming, this.time, this.track);
      car.previousRaceDistanceForTiming = car.raceDistance;
    });

    const ordered = this.orderedCars();
    const leader = ordered[0];
    ordered.forEach((car, index) => {
      const ahead = ordered[index - 1];
      const gap = ahead ? ahead.raceDistance - car.raceDistance : Infinity;
      const intervalAheadLaps = ahead ? wholeLapGap(ahead.raceDistance, car.raceDistance, this.track.length) : 0;
      const leaderGapLaps = leader ? wholeLapGap(leader.raceDistance, car.raceDistance, this.track.length) : 0;
      const activePitStop = this.isCarInActivePitStop(car);
      car.rank = index + 1;
      car.gapAhead = gap;
      car.gapAheadLaps = intervalAheadLaps;
      car.intervalAheadLaps = intervalAheadLaps;
      car.leaderGapLaps = leaderGapLaps;
      car.gapAheadSeconds = Number.isFinite(gap) && intervalAheadLaps === 0
        ? estimateGapAheadSeconds(ahead, car, this.time, this.track)
        : Infinity;
      car.intervalAheadSeconds = car.gapAheadSeconds;
      car.leaderGapSeconds = leaderGapLaps > 0
        ? Infinity
        : (leader && leader !== car ? estimateGapAheadSeconds(leader, car, this.time, this.track) : 0);
      car.canAttack = !this.safetyCar.deployed && !car.finished && !activePitStop;
      car.aggression = this.computeAggression(car, index);
      if (activePitStop) {
        car.drsEligible = false;
        car.drsActive = false;
        car.drsZoneId = null;
        car.drsZoneEnabled = false;
      } else if (updateDrs) this.updateDrsLatch(car, ahead, index);
    });
    this.evaluateRaceFinish();
  }

  evaluateRaceFinish() {
    if (this.raceControl.finished) return;
    if (this.raceControl.mode === 'pre-start') return;

    const ordered = this.orderedCars();
    const newlyFinished = ordered.filter((car) => !car.finished && car.raceDistance >= this.finishDistance);
    if (newlyFinished.length === 0) return;

    newlyFinished.forEach((car) => {
      car.finished = true;
      car.finishTime = this.time;
      car.finishRank = this.raceControl.finishOrder.length + 1;
      car.classifiedRank = car.finishRank;
      this.raceControl.finishOrder.push(car.id);
      if (!this.raceControl.winnerId) this.raceControl.winnerId = car.id;
      car.drsActive = false;
      car.drsEligible = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
      this.events.unshift({
        type: 'car-finish',
        at: this.time,
        carId: car.id,
        rank: car.finishRank,
        winnerId: this.raceControl.winnerId,
      });
      this.reviewTireRequirement(car);
    });

    if (!this.cars.every((car) => car.finished)) return;

    this.applyOutstandingServicePenalties();
    const classification = this.buildClassificationFromFinishOrder();
    this.raceControl.winnerId = classification[0]?.id ?? this.raceControl.winnerId;
    this.raceControl.mode = 'safety-car';
    this.raceControl.finished = true;
    this.raceControl.finishedAt = this.time;
    this.raceControl.classification = classification;
    this.raceControl.frozenOrder = classification.map((entry) => entry.id);
    this.safetyCar.deployed = true;
    const leader = this.cars.find((car) => car.id === this.raceControl.winnerId) ?? ordered[0];
    const safetyCarProgress = (leader?.raceDistance ?? 0) + this.rules.safetyCarLeadDistance;
    if (this.safetyCar.progress < safetyCarProgress) {
      this.moveSafetyCarTo(safetyCarProgress);
    }
    this.cars.forEach((car) => {
      const classified = classification.find((entry) => entry.id === car.id);
      car.classifiedRank = classified?.rank ?? car.rank;
      car.desiredOffset = 0;
      car.drsActive = false;
      car.drsEligible = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
    });
    this.events.unshift({
      type: 'race-finish',
      at: this.time,
      winnerId: this.raceControl.winnerId,
      classification: classification.map((entry) => ({ id: entry.id, rank: entry.rank })),
    });
  }

  applyOutstandingServicePenalties() {
    this.penalties.forEach((penalty) => {
      const beforeStatus = penalty.status;
      applyUnservedServicePenalty(penalty, this.time);
      if (beforeStatus !== penalty.status && penalty.unserved) {
        this.events.unshift({
          type: 'penalty-applied',
          at: this.time,
          penaltyId: penalty.id,
          driverId: penalty.driverId,
          serviceType: penalty.serviceType,
          penaltySeconds: penalty.penaltySeconds,
        });
      }
    });
  }

  buildClassificationFromFinishOrder() {
    const byId = new Map(this.cars.map((car) => [car.id, car]));
    const orderedByAdjustedTime = this.raceControl.finishOrder
      .map((id, finishOrderIndex) => ({ car: byId.get(id), finishOrderIndex }))
      .filter((entry) => Boolean(entry.car))
      .sort((left, right) => {
        const leftTime = (left.car.finishTime ?? Infinity) + this.getDriverPenaltySeconds(left.car.id);
        const rightTime = (right.car.finishTime ?? Infinity) + this.getDriverPenaltySeconds(right.car.id);
        return leftTime === rightTime ? left.finishOrderIndex - right.finishOrderIndex : leftTime - rightTime;
      })
      .map((entry) => entry.car);
    const ordered = this.applyClassificationConsequences(orderedByAdjustedTime);
    return this.buildClassification(ordered);
  }

  applyClassificationConsequences(ordered) {
    const classified = ordered.filter((car) => !this.isDriverDisqualified(car.id));
    ordered.forEach((car) => {
      if (this.isDriverDisqualified(car.id)) return;
      const drop = this.getDriverPositionDrop(car.id);
      if (drop <= 0) return;
      const currentIndex = classified.findIndex((entry) => entry.id === car.id);
      if (currentIndex < 0) return;
      const [entry] = classified.splice(currentIndex, 1);
      classified.splice(Math.min(classified.length, currentIndex + drop), 0, entry);
    });
    return [
      ...classified,
      ...ordered.filter((car) => this.isDriverDisqualified(car.id)),
    ];
  }

  buildClassification(ordered = this.orderedCars()) {
    const leaderDistance = ordered[0]?.raceDistance ?? 0;
    return ordered.map((car, index) => {
      const finishTime = car.finishTime ?? (car.raceDistance >= this.finishDistance ? this.time : null);
      const penaltySeconds = this.getDriverPenaltySeconds(car.id);
      const positionDrop = this.getDriverPositionDrop(car.id);
      const disqualified = this.isDriverDisqualified(car.id);
      return {
        id: car.id,
        code: car.code,
        timingCode: car.timingCode,
        name: car.name,
        rank: index + 1,
        raceDistance: car.raceDistance,
        distanceMeters: simUnitsToMeters(car.raceDistance),
        lap: this.computeLap(car.raceDistance),
        lapsCompleted: clamp(Math.floor(Math.max(0, car.raceDistance) / this.track.length), 0, this.totalLaps),
        gapMeters: simUnitsToMeters(Math.max(0, leaderDistance - car.raceDistance)),
        gapSeconds: index === 0 ? 0 : car.leaderGapSeconds,
        intervalSeconds: index === 0 ? 0 : car.intervalAheadSeconds,
        gapLaps: index === 0 ? 0 : car.leaderGapLaps,
        intervalLaps: index === 0 ? 0 : car.intervalAheadLaps,
        finished: car.raceDistance >= this.finishDistance,
        finishTime,
        penaltySeconds,
        adjustedFinishTime: finishTime == null ? null : finishTime + penaltySeconds,
        positionDrop,
        disqualified,
      };
    });
  }

  getRaceWinnerSnapshot() {
    if (!this.raceControl.winnerId) return null;
    const car = this.cars.find((item) => item.id === this.raceControl.winnerId);
    if (!car) return null;
    const rank = car.classifiedRank ?? car.rank ?? 1;
    return serializeCar(car, rank, this.getDriverPenaltySeconds(car.id));
  }

  updateDrsLatch(car, ahead, orderIndex) {
    if (this.safetyCar.deployed || car.finished) {
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      return;
    }

    const previousProgress = car.previousProgress ?? car.progress;
    const currentZone = car.drsZoneId
      ? this.track.drsZones.find((zone) => zone.id === car.drsZoneId)
      : null;

    if (currentZone && !isProgressInZone(this.track, car.progress, currentZone)) {
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
    }

    if (!car.drsZoneId) {
      const crossedZone = this.track.drsZones.find((zone) => (
        crossesDistance(previousProgress, car.progress, zone.start, this.track.length)
      ));
      if (crossedZone) {
        car.drsZoneId = crossedZone.id;
        const crossing = recordDrsDetection(car, crossedZone.id, this.time);
        const aheadCrossing = ahead?.drsDetection?.[crossedZone.id];
        car.drsZoneEnabled = Boolean(
          orderIndex > 0 &&
          aheadCrossing &&
          aheadCrossing.passage === crossing.passage &&
          crossing.time >= aheadCrossing.time &&
          crossing.time - aheadCrossing.time <= this.rules.drsDetectionSeconds + 1e-6
        );
      }
    }

    const activeZone = car.drsZoneId
      ? this.track.drsZones.find((zone) => zone.id === car.drsZoneId)
      : null;
    const inLatchedZone = activeZone ? isProgressInZone(this.track, car.progress, activeZone) : false;
    car.drsEligible = Boolean(car.drsZoneEnabled && inLatchedZone);
    car.drsActive = car.drsEligible;
  }

  resolveCollisions() {
    const reportedContacts = new Set();

    for (let pass = 0; pass < 3; pass += 1) {
      const candidates = buildCollisionCandidatePairs(this.cars, { trackLength: this.track.length });
      for (const [first, second] of candidates) {
        const collision = detectVehicleCollision(first, second);
        if (!collision) continue;
        const firstPitControlled = isPitPositionControlledCar(first);
        const secondPitControlled = isPitPositionControlledCar(second);
        if (firstPitControlled && secondPitControlled) continue;
        const stewardCollision = createCollisionStewardContext(first, second, collision);
        const oneCarFixed = firstPitControlled || secondPitControlled;

        const correction = Math.min(
          (oneCarFixed ? collision.depth : collision.depth / 2) + 0.65,
          MAX_COLLISION_CORRECTION,
        );
        const firstCorrectionX = firstPitControlled ? 0 : -collision.axis.x * correction;
        const firstCorrectionY = firstPitControlled ? 0 : -collision.axis.y * correction;
        const secondCorrectionX = secondPitControlled ? 0 : collision.axis.x * correction;
        const secondCorrectionY = secondPitControlled ? 0 : collision.axis.y * correction;
        if (!firstPitControlled) {
          first.x += firstCorrectionX;
          first.y += firstCorrectionY;
        }
        if (!secondPitControlled) {
          second.x += secondCorrectionX;
          second.y += secondCorrectionY;
        }

        if (oneCarFixed) {
          if (!firstPitControlled) first.speed = clamp(first.speed * 0.985, 0, VEHICLE_LIMITS.maxSpeed);
          if (!secondPitControlled) second.speed = clamp(second.speed * 0.985, 0, VEHICLE_LIMITS.maxSpeed);
        } else {
          this.applyContactVelocityResponse(first, second, collision.axis);
        }

        const yawNudge = clamp(collision.depth * 0.0025, 0.008, 0.035);
        const freshContact = first.contactCooldown <= 0 && second.contactCooldown <= 0;
        const firstHeadingCorrection = firstPitControlled ? 0 : -collision.axis.y * yawNudge;
        const secondHeadingCorrection = secondPitControlled ? 0 : collision.axis.y * yawNudge;
        if (!firstPitControlled) {
          first.heading = normalizeAngle(first.heading + firstHeadingCorrection);
          shiftPreviousRenderPose(first, firstCorrectionX, firstCorrectionY, firstHeadingCorrection);
        }
        if (!secondPitControlled) {
          second.heading = normalizeAngle(second.heading + secondHeadingCorrection);
          shiftPreviousRenderPose(second, secondCorrectionX, secondCorrectionY, secondHeadingCorrection);
        }
        first.contactCooldown = 1;
        second.contactCooldown = 1;

        const contactKey = `${first.id}:${second.id}`;
        if (freshContact && pass === 0 && !reportedContacts.has(contactKey)) {
          reportedContacts.add(contactKey);
          this.events.unshift({
            type: 'contact',
            at: this.time,
            carId: first.id,
            otherCarId: second.id,
            firstShapeId: collision.firstShapeId,
            secondShapeId: collision.secondShapeId,
            contactType: collision.contactType,
            depth: collision.depth,
            timeOfImpact: collision.timeOfImpact,
          });
          this.reviewCollision(first, second, stewardCollision);
        }
      }
    }
  }

  applyContactVelocityResponse(first, second, axis) {
    const firstForward = forwardVector(first);
    const secondForward = forwardVector(second);
    const firstNormal = dot(firstForward, axis);
    const secondNormal = dot(secondForward, axis);
    const relativeNormalVelocity = second.speed * secondNormal - first.speed * firstNormal;

    if (relativeNormalVelocity < 0) {
      const impulse = clamp(-relativeNormalVelocity * (0.34 + this.rules.collisionRestitution), 0, 16);
      if (firstNormal > 0) first.speed = clamp(first.speed - impulse * firstNormal, 0, VEHICLE_LIMITS.maxSpeed);
      if (secondNormal < 0) second.speed = clamp(second.speed + impulse * secondNormal, 0, VEHICLE_LIMITS.maxSpeed);
    }

    first.speed = clamp(first.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
    second.speed = clamp(second.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
  }

  computeLap(raceDistance) {
    return clamp(Math.floor(Math.max(0, raceDistance) / this.track.length) + 1, 1, this.totalLaps);
  }

  get finishDistance() {
    return this.track.length * this.totalLaps;
  }
}

export function createRaceSimulation(options = {}) {
  return new F1RaceSimulation(options);
}
