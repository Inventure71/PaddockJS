import { clamp } from '../simulation/simMath.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';

export function resolveActionMap(actions = {}, controlledDrivers = [], { policy = 'strict' } = {}) {
  const errors = [];
  const controlsByDriver = {};

  controlledDrivers.forEach((driverId) => {
    const action = actions?.[driverId];
    if (!action || typeof action !== 'object') {
      handleActionError(`Missing action for controlled driver: ${driverId}`, policy, errors);
      return;
    }
    const normalized = normalizeAction(action, driverId, policy, errors);
    if (normalized) controlsByDriver[driverId] = normalized;
  });

  return { controlsByDriver, errors };
}

export function normalizeAction(action, driverId = 'unknown', policy = 'strict', errors = []) {
  const steering = finiteActionValue(action.steering, `Invalid steering action for controlled driver: ${driverId}`, policy, errors);
  const throttle = finiteActionValue(action.throttle, `Invalid throttle action for controlled driver: ${driverId}`, policy, errors);
  const brake = finiteActionValue(action.brake, `Invalid brake action for controlled driver: ${driverId}`, policy, errors);

  if (steering == null || throttle == null || brake == null) return null;

  return {
    steering: clamp(steering, -1, 1) * VEHICLE_LIMITS.maxSteer,
    throttle: clamp(throttle, 0, 1),
    brake: clamp(brake, 0, 1),
  };
}

function finiteActionValue(value, message, policy, errors) {
  const number = Number(value ?? 0);
  if (Number.isFinite(number)) return number;
  handleActionError(message, policy, errors);
  return null;
}

function handleActionError(message, policy, errors) {
  if (policy === 'strict') throw new Error(message);
  errors.push(message);
}
