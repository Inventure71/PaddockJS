import { kphToSimSpeed, metersToSimUnits } from '../units.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

export const PIT_ROUTE_FINISH_DISTANCE = metersToSimUnits(8.5);
export const PIT_QUEUE_RELEASE_FINISH_DISTANCE = metersToSimUnits(4);
export const PIT_QUEUE_CAPTURE_DISTANCE = metersToSimUnits(2.5);
export const PIT_ENTRY_BOX_CAPTURE_DISTANCE = metersToSimUnits(20);
export const PIT_BOX_STOP_SPEED = kphToSimSpeed(35);
export const PIT_QUEUE_CAPTURE_SPEED = kphToSimSpeed(140);
export const PIT_QUEUE_RELEASE_SPEED = kphToSimSpeed(30);
export const PIT_EXIT_RELEASE_SPEED_KPH = 95;
export const PIT_BOX_APPROACH_DISTANCE = metersToSimUnits(34);
export const PIT_LIMITER_BRAKE_DISTANCE = metersToSimUnits(295);
export const PIT_LIMITER_APPROACH_SPEED_SLOPE = 0.045;
export const PIT_ENTRY_CONNECTOR_OVERSPEED_KPH = 75;
export const PIT_SERVICE_CLEAR_DISTANCE = VEHICLE_LIMITS.carLength * 0.9;

export function pointDistance(first, second) {
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y);
}
