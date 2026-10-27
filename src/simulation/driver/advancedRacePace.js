import { clamp, normalizeAngle } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters, TOP_SPEED_SIM_UNITS_PER_SECOND } from '../units.js';
import { pointAtInto } from '../track/trackModel.js';
import { tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { advancedDriveForce } from '../vehicle/advancedVehicleModel.js';
import { createAdvancedRacingEnvelopeScratch, estimateAdvancedRacingLateralCapacity,
  estimateAdvancedRacingLongitudinalLimits, estimateAdvancedRacingBrakeForce } from './advancedRacingEnvelope.js';
import { racingDriverProfile } from './racingDriverProfile.js';
import { advancedRacingPreviewReserveMeters } from './advancedRacingTiming.js';
import { followingSpeedLimit } from './trafficScan.js';

const MAX_SPEED = simUnitsToMeters(TOP_SPEED_SIM_UNITS_PER_SECOND);
const SAMPLE_SPACING = 12; // meters
const PREVIEW_POINT_SCRATCH = { x: 0, y: 0, heading: 0, normalX: 0, normalY: 0, curvature: 0, distance: 0 };
const CAPACITY_SCRATCH = createAdvancedRacingEnvelopeScratch();
const LONGITUDINAL_SCRATCH = createAdvancedRacingEnvelopeScratch();

export function advancedCornerSpeed(car, curvature, tireFactor, profile = racingDriverProfile(car)) {
  return cornerSpeedWithEndpoints(car, curvature, tireFactor, profile);
}

function endpointCapacity(car, speed, tireFactor, direction, endpoints) {
  if (!endpoints || (speed !== MAX_SPEED && speed !== 0)) {
    return estimateAdvancedRacingLateralCapacity(car, speed, tireFactor, CAPACITY_SCRATCH, { turnDirection: direction });
  }
  const key = `${direction}:${speed === MAX_SPEED ? 'maximum' : 'zero'}`;
  return endpoints[key] ??= estimateAdvancedRacingLateralCapacity(car, speed, tireFactor, CAPACITY_SCRATCH, { turnDirection: direction });
}

function cornerSpeedWithEndpoints(car, curvature, tireFactor, profile, endpoints = null) {
  const curve = Math.abs(curvature);
  if (curve < 1e-6) return MAX_SPEED;
  const direction = Math.sign(curvature);
  let high = MAX_SPEED ** 2;
  let highValue = profile.lateralShare * endpointCapacity(car, MAX_SPEED, tireFactor, direction, endpoints) - curve * high;
  if (highValue >= 0) return MAX_SPEED;
  let low = 0;
  let lowValue = profile.lateralShare * endpointCapacity(car, 0, tireFactor, direction, endpoints);
  let speed = 0;
  // Keep an explicit feasible/infeasible bracket: mixed surfaces and load
  // transfer must not inherit the old static-capacity concavity assumption.
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const next = low + (high - low) * lowValue / (lowValue - highValue);
    const nextSpeed = Math.sqrt(next);
    const value = profile.lateralShare * endpointCapacity(car, nextSpeed, tireFactor, direction, endpoints) - curve * next;
    if (value < 0) { high = next; highValue = value; }
    else {
      const difference = nextSpeed - speed;
      low = next; lowValue = value; speed = nextSpeed;
      if (difference < 0.01) return speed;
    }
  }
  return speed;
}

export function advancedRaceTargetSpeed(car, track, pathCurvature, profile = racingDriverProfile(car)) {
  const speed = simUnitsToMeters(car.speed);
  const tireFactor = tirePerformanceFactor(car.tireEnergy ?? 100);
  const horizon = Math.max(80, speed * 3);
  const anticipationDistance = advancedRacingPreviewReserveMeters(speed, profile, SAMPLE_SPACING);
  let targetSpeed = MAX_SPEED;
  // Endpoints depend on the car's current tires, surfaces and aero, but not
  // preview curvature. Reuse them only during this synchronous decision.
  const endpoints = Object.create(null);
  const farDistance = Math.ceil(horizon / SAMPLE_SPACING) * SAMPLE_SPACING;
  let futureHeading = pointAtInto(track, car.progress + metersToSimUnits(farDistance + SAMPLE_SPACING), PREVIEW_POINT_SCRATCH).heading;
  // Work backward from future corners. Reserve lateral grip when estimating
  // braking; the lower future speed also gives a conservative aero estimate.
  // Anticipation and judgement precision depend on the existing driver skills.
  for (let distance = farDistance; distance >= 0; distance -= SAMPLE_SPACING) {
    const sample = pointAtInto(track, car.progress + metersToSimUnits(distance), PREVIEW_POINT_SCRATCH);
    // Track samples store curvature magnitude; recover turn direction from
    // consecutive tangents for asymmetric wheel-surface/load estimates.
    const turnDirection = Math.sign(normalizeAngle(futureHeading - sample.heading)) || Math.sign(pathCurvature) || 1;
    const curve = sample.curvature * metersToSimUnits(1) * turnDirection;
    futureHeading = sample.heading;
    const corner = cornerSpeedWithEndpoints(car, curve, tireFactor, profile, endpoints);
    const futureSpeed = Math.min(targetSpeed, corner);
    const limits = estimateAdvancedRacingBrakeForce(car, futureSpeed, tireFactor, futureSpeed ** 2 * curve, LONGITUDINAL_SCRATCH);
    const deceleration = (limits.brakeForce * profile.longitudinalShare + limits.brakeResistanceForce) / car.mass;
    // Inspect every nearby bend, including those inside the reaction window.
    // Only distance beyond pursuit/response/driver anticipation can be spent
    // braking. Shifting the sample origin would silently skip nearby corners.
    const usableDistance = Math.max(0, distance + SAMPLE_SPACING - anticipationDistance) -
      Math.max(0, distance - anticipationDistance);
    targetSpeed = Math.min(corner, Math.sqrt(futureSpeed ** 2 + 2 * deceleration * usableDistance));
  }
  // Passing and path correction may demand a tighter turn than the centerline.
  return Math.min(MAX_SPEED, Math.min(targetSpeed, cornerSpeedWithEndpoints(car, pathCurvature, tireFactor, profile, endpoints)) * profile.speedJudgementScale);
}

export function advancedRacingSpeedControls(car, targetSpeed, profile = racingDriverProfile(car)) {
  const speed = simUnitsToMeters(car.speed);
  const actualLateral = car.lateralAcceleration ?? speed * (car.yawRate ?? 0);
  const limits = estimateAdvancedRacingLongitudinalLimits(car, speed, tirePerformanceFactor(car.tireEnergy ?? 100), actualLateral, LONGITUDINAL_SCRATCH);
  const resistance = targetSpeed > 0 ? limits.resistanceForce : 0;
  // Request net acceleration, then add the force needed merely to hold speed.
  // Both pedals share one signed demand so a slowdown cannot request throttle
  // and braking together. Tire/engine limits remain those of the actual car.
  const responseSeconds = 0.05 + 0.045 * (1 - profile.ability);
  const requestedForce = car.mass * (targetSpeed - speed) / responseSeconds + resistance;
  return {
    throttle: clamp(requestedForce / advancedDriveForce(car, speed), 0,
      Math.min(1, limits.driveForce * profile.longitudinalShare / advancedDriveForce(car, speed))),
    brake: clamp(-requestedForce / car.brakeNewtons, 0,
      Math.min(1, limits.brakeForce * profile.longitudinalShare / car.brakeNewtons)),
  };
}

export function advancedFollowingSpeed(car, cars, trackLength) {
  return followingSpeedLimit(car, cars, trackLength);
}
