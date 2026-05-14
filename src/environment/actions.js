import { clamp } from '../simulation/simMath.js';
import { VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';

export function resolveActionMap(actions = {}, controlledDrivers = [], { policy = 'strict' } = {}) {
  const errors = [];
  const controlsByDriver = {};
  const pitIntentByDriver = {};

  controlledDrivers.forEach((driverId) => {
    const action = actions?.[driverId];
    if (!action || typeof action !== 'object') {
      handleActionError(`Missing action for controlled driver: ${driverId}`, policy, errors);
      return;
    }
    const normalized = normalizeAction(action, driverId, policy, errors);
    if (normalized) controlsByDriver[driverId] = normalized;
    const pitIntent = normalizePitIntentAction(action, driverId, policy, errors);
    if (pitIntent != null) pitIntentByDriver[driverId] = pitIntent;
  });

  return { controlsByDriver, pitIntentByDriver, errors };
}

export function normalizeAction(action, driverId = 'unknown', policy = 'strict', errors = []) {
  const steering = requiredActionValue(action, 'steering', driverId, policy, errors);
  const throttle = requiredActionValue(action, 'throttle', driverId, policy, errors);
  const brake = requiredActionValue(action, 'brake', driverId, policy, errors);

  if (steering == null || throttle == null || brake == null) return null;

  return {
    steering: clamp(steering, -1, 1) * VEHICLE_LIMITS.maxSteer,
    throttle: clamp(throttle, 0, 1),
    brake: clamp(brake, 0, 1),
  };
}

function requiredActionValue(action, field, driverId, policy, errors) {
  if (!Object.hasOwn(action, field)) {
    handleActionError(`Missing ${field} action for controlled driver: ${driverId}`, policy, errors);
    return null;
  }
  return finiteActionValue(action[field], `Invalid ${field} action for controlled driver: ${driverId}`, policy, errors);
}

function finiteActionValue(value, message, policy, errors) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  handleActionError(message, policy, errors);
  return null;
}

function normalizePitIntentAction(action, driverId, policy, errors) {
  if (!Object.hasOwn(action, 'pitIntent')) return null;
  const number = Number(action.pitIntent);
  if (Number.isInteger(number) && number >= 0 && number <= 2) {
    const pitCompound = normalizePitCompoundAction(action, driverId, policy, errors);
    if (pitCompound === false) return null;
    return pitCompound == null ? number : { intent: number, targetCompound: pitCompound };
  }
  handleActionError(`Invalid pitIntent action for controlled driver: ${driverId}`, policy, errors);
  return null;
}

function normalizePitCompoundAction(action, driverId, policy, errors) {
  if (!Object.hasOwn(action, 'pitCompound') && !Object.hasOwn(action, 'pitTargetCompound')) return null;
  const value = action.pitCompound ?? action.pitTargetCompound;
  if (typeof value === 'string' && value.trim()) return value.trim();
  handleActionError(`Invalid pitCompound action for controlled driver: ${driverId}`, policy, errors);
  return false;
}

export function handleActionError(message, policy, errors) {
  if (policy === 'strict') throw new Error(message);
  errors.push(message);
}
