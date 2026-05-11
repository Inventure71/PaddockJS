import { simSpeedToMetersPerSecond } from '../../simulation/units.js';

export function buildBodySenses(car) {
  return {
    id: car.id,
    speedKph: car.speedKph,
    speedMetersPerSecond: simSpeedToMetersPerSecond(car.speed ?? 0),
    headingRadians: car.heading,
    yawRateRadiansPerSecond: car.yawRate ?? 0,
    steeringAngleRadians: car.steeringAngle ?? 0,
    throttle: car.throttle ?? 0,
    brake: car.brake ?? 0,
    lateralG: car.lateralG ?? 0,
    longitudinalG: car.longitudinalG ?? 0,
    gripUsage: car.gripUsage ?? 0,
    slipAngleRadians: car.slipAngleRadians ?? 0,
    tractionLimited: Boolean(car.tractionLimited),
    stabilityState: car.stabilityState ?? 'stable',
    destroyed: Boolean(car.destroyed),
    destroyReason: car.destroyReason ?? null,
  };
}
