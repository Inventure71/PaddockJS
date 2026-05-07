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
import { calculateCollisionPenalties } from './rules/collisionSteward.js';
import {
  applyUnservedServicePenalty,
  cancelPenaltyRecord,
  createPenaltyEvent,
  createPenaltyRecord,
  isPenaltyActive,
  serializePenalty,
  servePenaltyRecord,
} from './rules/penaltyLedger.js';
import { calculateTireRequirementPenalty } from './rules/tireRequirementSteward.js';
import { calculateTrackLimitReview } from './rules/trackLimitsSteward.js';
import { DEFAULT_RULES, getPenaltyRule, normalizeRaceRules } from './rulesConfig.js';
import { clamp, createMulberry32, normalizeAngle, seededRange, wrapDistance } from './simMath.js';
import { kphToSimSpeed, simSpeedToKph, simUnitsToMeters } from './units.js';
import { getCarCorners, integrateVehiclePhysics, VEHICLE_LIMITS } from './vehiclePhysics.js';

const DEFAULT_TOTAL_LAPS = 10;
export const FIXED_STEP = 1 / 60;
const MIN_TOTAL_LAPS = 1;
const MAX_COLLISION_CORRECTION = 4.5;
const GRID_SLOT_SPACING = 82;
const GRID_FIRST_SLOT_DISTANCE = -42;
const GRID_LATERAL_OFFSET = 42;
const TIMING_HISTORY_WINDOW_SECONDS = 18;
const TIMING_HISTORY_MAX_SAMPLES = 720;
const TELEMETRY_SECTOR_COUNT = 3;
const PIT_ENTRY_APPROACH_DISTANCE = 520;
const PIT_ROUTE_LOOKAHEAD_MIN = 74;
const PIT_ROUTE_LOOKAHEAD_MAX = 185;
const PIT_ROUTE_FINISH_DISTANCE = 18;
const PIT_BOX_STOP_SPEED = 14;
const PIT_EXIT_RELEASE_SPEED_KPH = 95;
const PIT_LIMITER_BRAKE_DISTANCE = 620;
const PIT_LIMITER_APPROACH_SPEED_SLOPE = 0.045;
const PIT_DRIVE_LANE_OFFSET_RATIO = 0.28;
const PIT_BOX_APPROACH_DISTANCE = 72;

export { DEFAULT_RULES };

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

function syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps) {
  const position = getLapTelemetryPosition(track, currentRaceDistance, totalLaps);
  telemetry.currentLap = position.currentLap;
  telemetry.currentSector = position.currentSector;
  telemetry.currentSectorProgress = position.currentSectorProgress;
  telemetry.completedLaps = Math.max(telemetry.completedLaps, Math.min(position.completedLaps, totalLaps));
  telemetry.currentLapTime = Math.max(0, currentTime - telemetry.currentLapStartedAt);
  telemetry.currentSectorElapsed = Math.max(0, currentTime - telemetry.currentSectorStartedAt);
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
  const gridDistance = GRID_FIRST_SLOT_DISTANCE - index * GRID_SLOT_SPACING;
  const start = pointAt(track, gridDistance);
  const offset = index % 2 === 0 ? -GRID_LATERAL_OFFSET : GRID_LATERAL_OFFSET;
  const position = offsetTrackPoint(start, offset);
  const pace = clamp(driver.pace ?? seededRange(random, 0.95, 1.05), 0.88, 1.12);
  const racecraft = clamp(driver.racecraft ?? seededRange(random, 0.65, 0.92), 0.45, 1);
  const personality = buildDriverPersonality(driver, index, racecraft, random);
  const launchSpeed = Math.max(70, 84 - index * 0.55 + pace * 4);
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
    gridOffset: offset,
    desiredOffset: offset,
    progress: start.distance,
    raceDistance: gridDistance,
    lap: 1,
    rank: index + 1,
    gapAhead: Infinity,
    gapAheadSeconds: Infinity,
    leaderGapSeconds: 0,
    intervalAheadSeconds: Infinity,
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
  };
}

function normalizeTotalLaps(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MIN_TOTAL_LAPS;
  return Math.max(MIN_TOTAL_LAPS, Math.floor(numeric));
}

function projectOntoAxis(points, axis) {
  let min = Infinity;
  let max = -Infinity;
  points.forEach((point) => {
    const projection = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  });
  return { min, max };
}

function overlapOnAxis(a, b, axis) {
  const first = projectOntoAxis(a, axis);
  const second = projectOntoAxis(b, axis);
  return Math.min(first.max, second.max) - Math.max(first.min, second.min);
}

function detectObbCollision(a, b) {
  const aCorners = getCarCorners(a);
  const bCorners = getCarCorners(b);
  const axes = [
    normalizeVector({ x: aCorners[1].x - aCorners[0].x, y: aCorners[1].y - aCorners[0].y }),
    normalizeVector({ x: aCorners[3].x - aCorners[0].x, y: aCorners[3].y - aCorners[0].y }),
    normalizeVector({ x: bCorners[1].x - bCorners[0].x, y: bCorners[1].y - bCorners[0].y }),
    normalizeVector({ x: bCorners[3].x - bCorners[0].x, y: bCorners[3].y - bCorners[0].y }),
  ];

  let minimumOverlap = Infinity;
  let minimumAxis = null;

  for (const axis of axes) {
    const overlap = overlapOnAxis(aCorners, bCorners, axis);
    if (overlap <= 0) return null;
    if (overlap < minimumOverlap) {
      minimumOverlap = overlap;
      minimumAxis = axis;
    }
  }

  const direction = { x: b.x - a.x, y: b.y - a.y };
  if (direction.x * minimumAxis.x + direction.y * minimumAxis.y < 0) {
    minimumAxis = { x: -minimumAxis.x, y: -minimumAxis.y };
  }

  return { axis: minimumAxis, depth: minimumOverlap };
}

function detectLongitudinalCollision(a, b) {
  const longitudinalGap = b.raceDistance - a.raceDistance;
  const headingDelta = Math.abs(normalizeAngle(a.heading - b.heading));
  const blendedHeading = a.heading + normalizeAngle(b.heading - a.heading) * 0.5;
  let axis = normalizeVector({ x: Math.cos(blendedHeading), y: Math.sin(blendedHeading) });
  const direction = { x: b.x - a.x, y: b.y - a.y };
  const physicalLongitudinalGap = dot(direction, axis);
  if (physicalLongitudinalGap < 0) axis = { x: -axis.x, y: -axis.y };

  const physicalLongitudinalSeparation = Math.abs(physicalLongitudinalGap);
  const lateralGap = Math.abs(direction.x * -axis.y + direction.y * axis.x);
  const requiredGap = VEHICLE_LIMITS.carLength * 0.96;

  if (Math.abs(longitudinalGap) > VEHICLE_LIMITS.carLength * 1.45) return null;
  if (physicalLongitudinalSeparation >= requiredGap) return null;
  if (lateralGap > VEHICLE_LIMITS.carWidth * 0.82) return null;
  if (headingDelta > 0.58) return null;

  return {
    axis,
    depth: requiredGap - physicalLongitudinalSeparation,
    longitudinal: true,
  };
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

function estimateGapAheadSeconds(ahead, car, currentTime) {
  if (!ahead) return Infinity;

  const crossingTime = interpolateTimeAtDistance(ahead.timingHistory, car.raceDistance);
  if (Number.isFinite(crossingTime)) {
    return Math.max(0, currentTime - crossingTime);
  }

  const speedReference = Math.max((ahead.speed + car.speed) * 0.5, 1);
  return Math.max(0, (ahead.raceDistance - car.raceDistance) / speedReference);
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
    serviceNormal: clonePointLike(pitLane.serviceNormal),
    boxes: Array.isArray(pitLane.boxes)
      ? pitLane.boxes.map((box) => ({
        ...box,
        laneTarget: clonePointLike(box.laneTarget),
        center: clonePointLike(box.center),
        corners: clonePointArray(box.corners),
      }))
      : pitLane.boxes,
    teams: Array.isArray(pitLane.teams)
      ? pitLane.teams.map((team) => ({ ...team, boxIds: [...(team.boxIds ?? [])] }))
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
  return -(pitLane.width ?? 0) * PIT_DRIVE_LANE_OFFSET_RATIO;
}

function sameRoutePoint(first, second) {
  return first && second && Math.hypot(first.x - second.x, first.y - second.y) < 0.001;
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

  return {
    points: routePoints,
    segments,
    length: totalLength,
  };
}

function sampleRoute(route, distanceAlong) {
  if (!route?.segments?.length) return route?.points?.[0] ?? null;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = route.segments.find((candidate) => clampedDistance <= candidate.endDistance) ?? route.segments.at(-1);
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
  const segment = route.segments.find((candidate) => clampedDistance < candidate.endDistance - 0.001) ??
    route.segments.at(-1);
  return Boolean(segment?.limiterActive);
}

function distanceToNextLimiterSegment(route, distanceAlong) {
  if (!route?.segments?.length) return Infinity;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = route.segments.find((candidate) => (
    candidate.limiterActive && candidate.endDistance > clampedDistance + 0.001
  ));
  if (!segment) return Infinity;
  return Math.max(0, segment.startDistance - clampedDistance);
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
  const backtrackAllowance = 90;

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
  const steps = Math.max(4, Math.ceil(Math.max(remaining, PIT_ENTRY_APPROACH_DISTANCE * 0.45) / 74));
  const points = [routePoint(car, car.heading)];

  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    const distance = currentDistance + remaining * amount;
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

function serializePitStop(pitStop) {
  if (!pitStop) return null;
  return {
    status: pitStop.status,
    phase: pitStop.phase ?? null,
    boxIndex: pitStop.boxIndex,
    boxId: pitStop.boxId,
    teamId: pitStop.teamId ?? null,
    teamColor: pitStop.teamColor ?? null,
    stopsCompleted: pitStop.stopsCompleted ?? 0,
    plannedRaceDistance: finiteOrNull(pitStop.plannedRaceDistance),
    entryRaceDistance: finiteOrNull(pitStop.entryRaceDistance),
    serviceRemainingSeconds: finiteOrNull(pitStop.serviceRemaining),
    targetTire: pitStop.targetTire ?? null,
  };
}

function serializeCar(car, rank, penaltySeconds = 0) {
  const finishTime = car.finishTime ?? null;
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
    drsEligible: car.drsEligible,
    drsActive: car.drsActive,
    drsZoneId: car.drsZoneId,
    drsZoneEnabled: car.drsZoneEnabled,
    canAttack: car.canAttack,
    signedOffset: car.trackState?.signedOffset ?? 0,
    crossTrackError: car.trackState?.crossTrackError ?? 0,
    surface: car.trackState?.surface ?? 'track',
    inPitLane: Boolean(car.trackState?.inPitLane),
    pitLanePart: car.trackState?.pitLanePart ?? null,
    pitBoxId: car.trackState?.pitBoxId ?? null,
    pitLaneCrossTrackError: car.trackState?.pitLaneCrossTrackError ?? null,
    contactCooldown: car.contactCooldown,
    tireEnergy: car.tireEnergy,
    usedTireCompounds: [...(car.usedTireCompounds ?? [])],
    pitStop: serializePitStop(car.pitStop),
    positionSource: 'integrated-vehicle',
  };
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

      return {
        id,
        name,
        color,
        index: teamIndex,
        boxIds,
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
      const boxIndex = Math.min(pitLane.boxes.length - 1, teamIndex * boxesPerTeam + teamBoxIndex);
      const box = pitLane.boxes[boxIndex] ?? pitLane.boxes[index % pitLane.boxes.length];
      car.pitStop = {
        status: 'pending',
        phase: null,
        boxIndex: box.index,
        boxId: box.id,
        teamId: box.teamId ?? null,
        teamColor: box.teamColor ?? null,
        stopsCompleted: 0,
        entryRaceDistance: stopLapBase + pitLane.entry.distanceFromStart,
        plannedRaceDistance: stopLapBase + pitLane.entry.distanceFromStart -
          PIT_ENTRY_APPROACH_DISTANCE,
        trainPosition,
        lapBase: stopLapBase,
        serviceRemaining: 0,
        route: null,
        routeProgress: 0,
        routeStartRaceDistance: null,
        routeEndRaceDistance: null,
        targetTire: firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds),
      };
    });
  }

  setSafetyCar(deployed) {
    const next = Boolean(deployed);
    if (this.raceControl.finished) return;
    if (next && this.raceControl.mode === 'pre-start') return;
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

  setCarState(id, partial) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return;
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
    car.trackState = nearestTrackState(this.track, car);
    const delta = progressDelta(car.trackState.distance, car.progress ?? car.trackState.distance, this.track.length);
    car.raceDistance = (car.raceDistance ?? car.trackState.distance) + delta;
    car.progress = car.trackState.distance;
    car.lap = this.computeLap(car.raceDistance);
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsDetection = {};
    resetTimingHistory(car, this.time);
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

  isCarInActivePitStop(car) {
    return Boolean(car.pitStop && car.pitStop.status !== 'pending' && car.pitStop.status !== 'completed');
  }

  canStartPitStop(car) {
    const stop = car.pitStop;
    const pitStops = this.rules.modules?.pitStops;
    if (!stop || !pitStops?.enabled) return false;
    const active = this.cars.filter((candidate) => candidate !== car && this.isCarInActivePitStop(candidate));
    const maxConcurrentPitLaneCars = Math.max(1, Math.floor(pitStops.maxConcurrentPitLaneCars ?? 3));
    if (active.length >= maxConcurrentPitLaneCars) return false;

    if (!pitStops.doubleStacking && stop.teamId) {
      const sameTeamBusy = active.some((candidate) => (
        candidate.pitStop?.teamId === stop.teamId && candidate.pitStop?.status !== 'exiting'
      ));
      if (sameTeamBusy) return false;
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
    const raceDistance = car.raceDistance ?? 0;
    if (raceDistance > stop.entryRaceDistance + 90) {
      stop.lapBase += this.track.length;
      stop.entryRaceDistance = stop.lapBase + this.track.pitLane.entry.distanceFromStart;
      stop.plannedRaceDistance = stop.entryRaceDistance -
        PIT_ENTRY_APPROACH_DISTANCE;
      return false;
    }
    return raceDistance >= stop.plannedRaceDistance && this.canStartPitStop(car);
  }

  getPitStopBox(stop) {
    return this.track.pitLane?.boxes?.find((box) => box.id === stop?.boxId) ?? null;
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
    stop.targetTire = firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);

    const currentState = nearestTrackState(this.track, car, car.progress);
    car.trackState = currentState;
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

    const driveLaneOffset = pitDriveLaneOffset(pitLane);
    const boxApproachDistance = Math.max(0, box.distanceAlongLane - PIT_BOX_APPROACH_DISTANCE);
    const route = createRoute([
      ...createPitApproachPoints(this.track, car, pitLane, stop.entryRaceDistance),
      ...(pitLane.entry.roadCenterline ?? []).map((point) => routePoint(point)),
      routePoint(pitMainLanePointAt(pitLane, 0, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(pitMainLanePointAt(pitLane, boxApproachDistance, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(box.laneTarget, pitLane.mainLane.heading, { limiterActive: true }),
      routePoint(box.center, pitLane.mainLane.heading, { limiterActive: true }),
    ]);
    stop.status = 'entering';
    stop.phase = 'entry';
    stop.route = route;
    stop.routeProgress = 0;
    stop.routeStartRaceDistance = car.raceDistance ?? stop.plannedRaceDistance;
    stop.routeEndRaceDistance = this.getPitBoxRaceDistance(stop, box);
    return true;
  }

  beginPitService(car, box) {
    const stop = car.pitStop;
    stop.status = 'servicing';
    stop.phase = 'service';
    stop.route = null;
    stop.routeProgress = 0;
    stop.serviceRemaining = this.rules.modules?.pitStops?.defaultStopSeconds ?? 2.8;
    car.x = box.center.x;
    car.y = box.center.y;
    car.heading = this.track.pitLane.mainLane.heading;
    car.speed = 0;
    car.throttle = 0;
    car.brake = 1;
    car.steeringAngle = 0;
    car.yawRate = 0;
    car.turnRadius = Infinity;
    car.trackState = nearestTrackState(this.track, car, car.progress);
    car.progress = car.trackState.distance;
    car.raceDistance = this.getPitBoxRaceDistance(stop, box);
    this.events.unshift({
      type: 'pit-stop-start',
      at: this.time,
      carId: car.id,
      boxId: box.id,
      teamId: box.teamId ?? null,
      targetTire: stop.targetTire,
    });
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
    stop.stopsCompleted = (stop.stopsCompleted ?? 0) + 1;
    car.speed = Math.max(car.speed, kphToSimSpeed(PIT_EXIT_RELEASE_SPEED_KPH));
    car.throttle = 0.55;
    car.brake = 0;
    car.trackState = nearestTrackState(this.track, car, car.progress);
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
    const routeProgress = nearestDistanceOnRoute(route, car, stop.routeProgress ?? 0);
    stop.routeProgress = Math.max(stop.routeProgress ?? 0, routeProgress);
    const remainingBefore = Math.max(0, route.length - stop.routeProgress);
    const lookahead = clamp(car.speed * 0.78 + 62, PIT_ROUTE_LOOKAHEAD_MIN, PIT_ROUTE_LOOKAHEAD_MAX);
    const target = sampleRoute(route, Math.min(route.length, stop.routeProgress + lookahead));
    if (!target) return false;

    const targetHeading = Math.atan2(target.y - car.y, target.x - car.x);
    const headingError = normalizeAngle(targetHeading - car.heading);
    const steering = clamp(headingError * 1.28, -VEHICLE_LIMITS.maxSteer, VEHICLE_LIMITS.maxSteer);
    const limiterActive = routeLimiterActiveAt(route, stop.routeProgress);
    let targetSpeed = limiterActive ? Math.min(speedLimit, VEHICLE_LIMITS.maxSpeed) : VEHICLE_LIMITS.maxSpeed;
    if (!limiterActive && stop.status === 'entering') {
      const distanceToLimiter = distanceToNextLimiterSegment(route, stop.routeProgress);
      if (distanceToLimiter < PIT_LIMITER_BRAKE_DISTANCE) {
        targetSpeed = Math.min(
          targetSpeed,
          speedLimit + Math.max(0, distanceToLimiter * PIT_LIMITER_APPROACH_SPEED_SLOPE),
        );
      }
    }
    if (stop.status === 'entering') {
      const brakeZone = 240;
      if (remainingBefore < brakeZone) {
        targetSpeed = Math.min(targetSpeed, clamp(remainingBefore * 0.16, 0, speedLimit * 0.72));
      }
    }
    const speedError = targetSpeed - car.speed;
    const controls = {
      steering,
      throttle: speedError > 0 ? clamp(speedError / 34, 0, 0.72) : 0,
      brake: speedError < 0 ? clamp(-speedError / 28, 0, 1) : 0,
    };

    integrateVehiclePhysics(car, controls, delta);
    car.trackState = nearestTrackState(this.track, car, car.progress);
    const nextProgress = nearestDistanceOnRoute(route, car, stop.routeProgress);
    stop.routeProgress = Math.max(stop.routeProgress, nextProgress);
    const routeAmount = route.length > 0 ? stop.routeProgress / route.length : 1;
    car.raceDistance = stop.routeStartRaceDistance +
      (stop.routeEndRaceDistance - stop.routeStartRaceDistance) * routeAmount;
    car.progress = car.trackState.distance;
    car.lap = this.computeLap(car.raceDistance);
    const remainingAfter = Math.max(0, route.length - stop.routeProgress);
    if (stop.status === 'entering') {
      return remainingAfter <= PIT_ROUTE_FINISH_DISTANCE && car.speed <= PIT_BOX_STOP_SPEED;
    }
    return remainingAfter <= PIT_ROUTE_FINISH_DISTANCE;
  }

  advancePitStopCar(car, delta) {
    const pitStops = this.rules.modules?.pitStops;
    const stop = car.pitStop;
    if (!pitStops?.enabled || !stop || stop.status === 'completed') return false;
    if (stop.status === 'pending' && !this.shouldStartPitStop(car)) return false;
    if (stop.status === 'pending') this.startPitStop(car);

    if (stop.status === 'entering') {
      const finishedRoute = this.applyPitRoutePosition(car, delta);
      const box = this.getPitStopBox(stop);
      if (finishedRoute && box) this.beginPitService(car, box);
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
      return true;
    }

    if (stop.status === 'servicing') {
      const box = this.getPitStopBox(stop);
      if (!box) return true;
      stop.serviceRemaining = Math.max(0, (stop.serviceRemaining ?? 0) - delta);
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.x = box.center.x;
      car.y = box.center.y;
      car.heading = this.track.pitLane.mainLane.heading;
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      car.trackState = nearestTrackState(this.track, car, car.progress);
      car.progress = car.trackState.distance;
      car.raceDistance = this.getPitBoxRaceDistance(stop, box);
      if (stop.serviceRemaining <= 0) this.completePitService(car);
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
      const gridDistance = GRID_FIRST_SLOT_DISTANCE - index * GRID_SLOT_SPACING;
      const gridPoint = pointAt(this.track, gridDistance);
      const gridOffset = index % 2 === 0 ? -GRID_LATERAL_OFFSET : GRID_LATERAL_OFFSET;
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
        entry.trackState = nearestTrackState(this.track, entry, gridDistance);
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
      const review = calculateTrackLimitReview({
        car,
        rule,
        track: this.track,
        stewardState: this.stewardState.trackLimits[car.id],
      });
      this.stewardState.trackLimits[car.id] = review.nextState;
      if (review.event) this.events.unshift({ ...review.event, at: this.time });
      if (review.penalty) this.recordPenalty(review.penalty);
    });
  }

  snapshot() {
    const ordered = this.orderedCars();
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
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
      safetyCar: { ...this.safetyCar },
      rules: this.rules,
      events: [...this.events],
      penalties: this.penalties.map(serializePenalty),
      cars: ordered.map((car, index) => serializeCar(car, index + 1, this.getDriverPenaltySeconds(car.id))),
    };
  }

  orderedCars() {
    if (this.safetyCar.deployed && this.raceControl.frozenOrder?.length) {
      const byId = new Map(this.cars.map((car) => [car.id, car]));
      return this.raceControl.frozenOrder.map((id) => byId.get(id)).filter(Boolean);
    }

    return [...this.cars].sort((a, b) => {
      const delta = b.raceDistance - a.raceDistance;
      return delta === 0 ? a.index - b.index : delta;
    });
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
      car.trackState = state;
      car.progress = state.distance;
      if (wasGridLocked) car.raceDistance = car.gridDistance;
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
      car.trackState = nearestTrackState(this.track, car, car.gridDistance);
    });
  }

  updateSafetyCar(dt) {
    if (!this.safetyCar.deployed) return;
    const leader = this.orderedCars()[0];
    const targetProgress = (leader?.raceDistance ?? 0) + this.rules.safetyCarLeadDistance;
    const progress = Math.max(this.safetyCar.progress + this.safetyCar.speed * dt, targetProgress);
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
      car.trackState = state;
      return;
    }
    const signedLimit = this.track.width / 2 + this.track.gravelWidth + this.track.runoffWidth;
    const overshoot = Math.abs(state.signedOffset) - signedLimit;
    if (overshoot <= 0) {
      car.trackState = state;
      return;
    }

    const side = Math.sign(state.signedOffset) || 1;
    car.x -= state.normalX * side * overshoot;
    car.y -= state.normalY * side * overshoot;
    car.speed = clamp(car.speed * clamp(1 - overshoot * 0.012, 0.22, 0.86), 0, VEHICLE_LIMITS.maxSpeed);
    car.heading = normalizeAngle(car.heading - side * clamp(overshoot * 0.0028, 0.018, 0.08));
    car.trackState = nearestTrackState(this.track, car, state.distance);
  }

  recalculateRaceState({ updateDrs = true } = {}) {
    this.cars.forEach((car) => {
      const previousRaceDistance = car.raceDistance;
      if (car.gridLocked) {
        const gridPoint = pointAt(this.track, car.gridDistance);
        car.trackState = nearestTrackState(this.track, car, car.gridDistance);
        car.progress = gridPoint.distance;
        car.raceDistance = car.gridDistance;
        car.lap = 1;
        resetLapTelemetry(car, this.time, this.track, this.totalLaps);
        return;
      }

      car.trackState = nearestTrackState(this.track, car, car.progress);
      const previousProgress = car.progress ?? car.trackState.distance;
      const delta = progressDelta(car.trackState.distance, previousProgress, this.track.length);
      car.raceDistance = (car.raceDistance ?? previousProgress) + delta;
      car.progress = car.trackState.distance;
      car.lap = this.computeLap(car.raceDistance);
      updateLapTelemetry(car, previousRaceDistance, this.time, this.track, this.totalLaps);
    });

    updateSectorPerformance(this.cars);
    this.cars.forEach((car) => recordTimingSample(car, this.time));

    const ordered = this.orderedCars();
    ordered.forEach((car, index) => {
      const ahead = ordered[index - 1];
      const gap = ahead ? ahead.raceDistance - car.raceDistance : Infinity;
      const activePitStop = this.isCarInActivePitStop(car);
      car.rank = index + 1;
      car.gapAhead = gap;
      car.gapAheadSeconds = Number.isFinite(gap) ? estimateGapAheadSeconds(ahead, car, this.time) : Infinity;
      car.intervalAheadSeconds = car.gapAheadSeconds;
      car.leaderGapSeconds = ahead ? ahead.leaderGapSeconds + car.gapAheadSeconds : 0;
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
      car.classifiedRank = this.raceControl.finishOrder.length + 1;
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
        rank: car.classifiedRank,
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
      for (let i = 0; i < this.cars.length; i += 1) {
        for (let j = i + 1; j < this.cars.length; j += 1) {
          const first = this.cars[i];
          const second = this.cars[j];
          const collision = detectObbCollision(first, second) ?? detectLongitudinalCollision(first, second);
          if (!collision) continue;
          const stewardCollision = createCollisionStewardContext(first, second, collision);

          const correction = Math.min(
            collision.depth / 2 + (collision.longitudinal ? 0.35 : 0.65),
            MAX_COLLISION_CORRECTION,
          );
          first.x -= collision.axis.x * correction;
          first.y -= collision.axis.y * correction;
          second.x += collision.axis.x * correction;
          second.y += collision.axis.y * correction;

          this.applyContactVelocityResponse(first, second, collision.axis);

          const yawNudge = clamp(collision.depth * 0.0025, 0.008, 0.035);
          const freshContact = first.contactCooldown <= 0 && second.contactCooldown <= 0;
          first.heading = normalizeAngle(first.heading - collision.axis.y * yawNudge);
          second.heading = normalizeAngle(second.heading + collision.axis.y * yawNudge);
          first.contactCooldown = 1;
          second.contactCooldown = 1;

          const contactKey = `${first.id}:${second.id}`;
          if (freshContact && pass === 0 && !reportedContacts.has(contactKey)) {
            reportedContacts.add(contactKey);
            this.events.unshift({ type: 'contact', at: this.time, carId: first.id, otherCarId: second.id });
            this.reviewCollision(first, second, stewardCollision);
          }
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
