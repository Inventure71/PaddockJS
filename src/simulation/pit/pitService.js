import { normalizePitCrewStats } from './pitState.js';
import {
  createRoute,
  distanceToNextLimiterSegment,
  nearestDistanceOnRoute,
  pitDriveLaneOffset,
  pitMainLanePointAt,
  routeLimiterActiveAt,
  routePoint,
  sampleRoute,
} from './pitRouting.js';
import {
  getPitServicePenaltySeconds,
  isPenaltyPitServiceable,
  servePitPenaltyRecord,
} from '../rules/penaltyLedger.js';
import { clamp, normalizeAngle } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits } from '../units.js';
import { VEHICLE_LIMITS } from '../vehiclePhysics.js';
import { applyWheelSurfaceState } from '../wheelSurface.js';

export { normalizePitCrewStats };

const PIT_ROUTE_FINISH_DISTANCE = metersToSimUnits(8.5);
const PIT_QUEUE_RELEASE_FINISH_DISTANCE = metersToSimUnits(4);
const PIT_QUEUE_CAPTURE_DISTANCE = metersToSimUnits(2.5);
const PIT_ENTRY_BOX_CAPTURE_DISTANCE = metersToSimUnits(20);
const PIT_BOX_STOP_SPEED = kphToSimSpeed(35);
const PIT_QUEUE_CAPTURE_SPEED = kphToSimSpeed(140);
const PIT_QUEUE_RELEASE_SPEED = kphToSimSpeed(30);
const PIT_EXIT_RELEASE_SPEED_KPH = 95;
const PIT_BOX_APPROACH_DISTANCE = metersToSimUnits(34);
const PIT_LIMITER_BRAKE_DISTANCE = metersToSimUnits(295);
const PIT_LIMITER_APPROACH_SPEED_SLOPE = 0.045;
const PIT_ENTRY_CONNECTOR_OVERSPEED_KPH = 75;

function pointDistance(first, second) {
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function getPitStopBox(sim, stop) {
  return sim.track.pitLane?.serviceAreas?.find((box) => box.id === stop?.boxId) ??
    sim.track.pitLane?.boxes?.find((box) => box.id === stop?.boxId) ??
    null;
}

export function isPitServiceAreaOccupied(sim, candidate, box, clearDistance) {
  const status = candidate?.pitStop?.status;
  const phase = candidate?.pitStop?.phase;
  if (!status || !box) return false;
  if (status === 'servicing') return true;
  if (status === 'entering' && phase === 'queue-release') return true;
  if (status === 'exiting') return pointDistance(candidate, box.center) < clearDistance;
  return false;
}

export function isPitServiceBusy(sim, car, box, clearDistance) {
  return sim.cars.some((candidate) => (
    candidate !== car &&
    candidate.pitStop?.boxId === box?.id &&
    isPitServiceAreaOccupied(sim, candidate, box, clearDistance)
  ));
}

export function isPitServiceQueueOccupied(sim, car, box) {
  return sim.cars.some((candidate) => (
    candidate !== car &&
    candidate.pitStop?.boxId === box?.id &&
    (
      candidate.pitStop?.status === 'queued' ||
      Boolean(candidate.pitStop?.queueingForService)
    )
  ));
}

export function getPitBoxRaceDistance(sim, stop, box) {
  const pitLane = sim.track.pitLane;
  const amount = pitLane?.mainLane?.length > 0 ? box.distanceAlongLane / pitLane.mainLane.length : 0;
  return stop.lapBase + pitLane.entry.distanceFromStart +
    (pitLane.exit.distanceFromStart - pitLane.entry.distanceFromStart) * amount;
}

export function beginPitQueue(sim, car, box) {
  const stop = car.pitStop;
  if (!stop || !box?.queuePoint) return false;
  stop.status = 'queued';
  stop.phase = 'queue';
  stop.route = null;
  stop.routeProgress = 0;
  stop.queueingForService = false;
  car.x = box.queuePoint.x;
  car.y = box.queuePoint.y;
  car.heading = sim.track.pitLane.mainLane.heading;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = getPitBoxRaceDistance(sim, stop, {
    ...box,
    distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
  });
  return true;
}

export function releasePitQueue(sim, car, box, { fromCurrent = false } = {}) {
  const stop = car.pitStop;
  if (!stop || !box?.center) return false;
  const route = createRoute([
    ...(fromCurrent ? [routePoint(car, car.heading, { limiterActive: true })] : []),
    routePoint(box.queuePoint, sim.track.pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(box.center, sim.track.pitLane.mainLane.heading, { limiterActive: true }),
  ]);
  stop.status = 'entering';
  stop.phase = 'queue-release';
  stop.queueingForService = false;
  stop.route = route;
  stop.routeProgress = 0;
  stop.routeStartRaceDistance = fromCurrent
    ? car.raceDistance ?? getPitBoxRaceDistance(sim, stop, {
        ...box,
        distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
      })
    : getPitBoxRaceDistance(sim, stop, {
        ...box,
        distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
      });
  stop.routeEndRaceDistance = getPitBoxRaceDistance(sim, stop, box);
  return true;
}

export function beginPitService(sim, car, box) {
  const stop = car.pitStop;
  stop.status = 'servicing';
  stop.route = null;
  stop.routeProgress = 0;
  car.x = box.center.x;
  car.y = box.center.y;
  car.heading = sim.track.pitLane.mainLane.heading;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  car.steeringAngle = 0;
  car.yawRate = 0;
  car.turnRadius = Infinity;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = getPitBoxRaceDistance(sim, stop, box);

  if (beginPitPenaltyService(sim, car)) return;
  beginTireService(sim, car);
}

export function beginPitPenaltyService(sim, car) {
  const stop = car.pitStop;
  const penalties = getPitServicePenalties(sim, car.id);
  if (!stop || !penalties.length) return false;

  const totalSeconds = penalties.reduce((total, penalty) => (
    total + getPitServicePenaltySeconds(penalty)
  ), 0);
  stop.servingPenaltyIds = penalties.map((penalty) => penalty.id);
  stop.penaltyServiceTotal = totalSeconds;
  stop.penaltyServiceRemaining = totalSeconds;

  if (totalSeconds <= 0) {
    completePitPenaltyService(sim, car);
    return true;
  }

  stop.phase = 'penalty';
  stop.serviceRemaining = totalSeconds;
  sim.events.unshift({
    type: 'pit-penalty-service-start',
    at: sim.time,
    carId: car.id,
    penaltyIds: [...stop.servingPenaltyIds],
    penaltyServiceSeconds: totalSeconds,
  });
  return true;
}

export function calculatePitServiceProfile(sim, car) {
  const pitStops = sim.rules.modules?.pitStops ?? {};
  const variability = pitStops.variability ?? {};
  const baseSeconds = Math.max(0, Number(pitStops.defaultStopSeconds) || 2.8);
  const box = getPitStopBox(sim, car?.pitStop);
  const team = sim.track.pitLane?.teams?.find((entry) => entry.id === car?.pitStop?.teamId);
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
  profile.consistencyDeltaSeconds = (sim.random() - 0.5) * (1 - pitCrew.consistency) * jitterImpact;
  const effectiveIssueChance = issueChance * (1 - pitCrew.reliability);
  if (sim.random() < effectiveIssueChance) {
    profile.issueDelaySeconds = 0.35 + sim.random() * issueMaxDelay * (1 - pitCrew.reliability);
    profile.issue = 'slow-stop';
  }
  profile.seconds = Math.max(
    Math.min(1.6, baseSeconds),
    baseSeconds + profile.speedDeltaSeconds + profile.consistencyDeltaSeconds + profile.issueDelaySeconds,
  );
  return profile;
}

export function beginTireService(sim, car) {
  const stop = car.pitStop;
  if (!stop) return;
  const serviceProfile = calculatePitServiceProfile(sim, car);
  stop.phase = 'service';
  stop.penaltyServiceRemaining = 0;
  stop.serviceProfile = serviceProfile;
  stop.serviceRemaining = serviceProfile.seconds;
  sim.events.unshift({
    type: 'pit-stop-start',
    at: sim.time,
    carId: car.id,
    boxId: stop.boxId,
    teamId: stop.teamId ?? null,
    targetTire: stop.targetTire,
    serviceSeconds: serviceProfile.seconds,
    serviceIssue: serviceProfile.issue,
  });
}

export function completePitPenaltyService(sim, car) {
  const stop = car.pitStop;
  if (!stop) return;
  const servedIds = [...(stop.servingPenaltyIds ?? [])];
  servedIds.forEach((penaltyId) => {
    const penalty = sim.penalties.find((entry) => entry.id === penaltyId);
    const beforeStatus = penalty?.status;
    const result = servePitPenaltyRecord(penalty, sim.time);
    if (result && beforeStatus !== result.status) {
      sim.events.unshift({
        type: 'penalty-served',
        at: sim.time,
        penaltyId: result.id,
        driverId: result.driverId,
        serviceType: result.serviceType,
        serviceContext: 'pit-stop',
      });
    }
  });
  stop.penaltyServiceRemaining = 0;
  stop.serviceRemaining = 0;
  sim.events.unshift({
    type: 'pit-penalty-service-complete',
    at: sim.time,
    carId: car.id,
    penaltyIds: servedIds,
  });
  beginTireService(sim, car);
}

export function getPitServicePenalties(sim, driverId) {
  return sim.penalties.filter((penalty) => (
    penalty.driverId === driverId && isPenaltyPitServiceable(penalty)
  ));
}

export function completePitService(sim, car) {
  const stop = car.pitStop;
  const box = getPitStopBox(sim, stop);
  const pitLane = sim.track.pitLane;
  if (!stop || !box || !pitLane?.enabled) return;

  car.tire = stop.targetTire ?? car.tire;
  car.tireEnergy = 100;
  if (car.tire && !car.usedTireCompounds.includes(car.tire)) car.usedTireCompounds.push(car.tire);
  sim.events.unshift({
    type: 'pit-stop-complete',
    at: sim.time,
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
  stop.routeStartRaceDistance = getPitBoxRaceDistance(sim, stop, box);
  stop.routeEndRaceDistance = stop.lapBase + pitLane.exit.distanceFromStart;
}

export function finishPitExit(sim, car) {
  const stop = car.pitStop;
  if (!stop) return;
  stop.status = 'completed';
  stop.phase = null;
  stop.route = null;
  stop.routeProgress = 0;
  stop.serviceRemaining = 0;
  stop.queueingForService = false;
  stop.stopsCompleted = (stop.stopsCompleted ?? 0) + 1;
  stop.intent = 0;
  car.speed = Math.max(car.speed, kphToSimSpeed(PIT_EXIT_RELEASE_SPEED_KPH));
  car.throttle = 0.55;
  car.brake = 0;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = Math.max(car.raceDistance ?? 0, stop.routeEndRaceDistance ?? car.raceDistance ?? 0);
  sim.events.unshift({
    type: 'pit-exit',
    at: sim.time,
    carId: car.id,
    boxId: stop.boxId,
    teamId: stop.teamId ?? null,
  });
}

export function applyPitRoutePosition(sim, car, delta) {
  const stop = car.pitStop;
  if (!stop?.route) return false;
  const speedLimit = kphToSimSpeed(sim.rules.modules?.pitStops?.pitLaneSpeedLimitKph ?? 80);
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
    car.heading = point.heading ?? sim.track.pitLane.mainLane.heading;
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
    applyWheelSurfaceState(car, sim.track);
    car.progress = car.trackState.distance;
    car.lap = sim.computeLap(car.raceDistance);
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
  applyWheelSurfaceState(car, sim.track);
  stop.routeProgress = nextProgress;
  const routeAmount = route.length > 0 ? stop.routeProgress / route.length : 1;
  car.raceDistance = stop.routeStartRaceDistance +
    (stop.routeEndRaceDistance - stop.routeStartRaceDistance) * routeAmount;
  car.progress = car.trackState.distance;
  car.lap = sim.computeLap(car.raceDistance);
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

export function advancePitService(sim, car, delta) {
  const stop = car.pitStop;
  const box = getPitStopBox(sim, stop);
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
  car.heading = sim.track.pitLane.mainLane.heading;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = getPitBoxRaceDistance(sim, stop, box);
  if (stop.phase === 'penalty' && stop.penaltyServiceRemaining <= 0) {
    completePitPenaltyService(sim, car);
  } else if (stop.serviceRemaining <= 0) {
    completePitService(sim, car);
  }
  return true;
}
