import { clamp, normalizeAngle } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits } from '../units.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import {
  distanceToNextLimiterSegment,
  nearestDistanceOnRoute,
  routeLimiterActiveAt,
  sampleRoute,
} from './pitRouting.js';
import { completePitPenaltyService } from './pitPenaltyService.js';
import { completePitService } from './pitTireService.js';
import { getPitBoxRaceDistance, getPitStopBox } from './pitOccupancy.js';
import {
  PIT_BOX_STOP_SPEED,
  PIT_ENTRY_BOX_CAPTURE_DISTANCE,
  PIT_ENTRY_CONNECTOR_OVERSPEED_KPH,
  PIT_LIMITER_APPROACH_SPEED_SLOPE,
  PIT_LIMITER_BRAKE_DISTANCE,
  PIT_QUEUE_CAPTURE_DISTANCE,
  PIT_QUEUE_CAPTURE_SPEED,
  PIT_QUEUE_RELEASE_FINISH_DISTANCE,
  PIT_QUEUE_RELEASE_SPEED,
  PIT_ROUTE_FINISH_DISTANCE,
  pointDistance,
} from './pitServiceConstants.js';

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
  stop.routeProgress = clamp(nearestDistanceOnRoute(route, car, stop.routeProgress ?? 0), 0, route.length);
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
