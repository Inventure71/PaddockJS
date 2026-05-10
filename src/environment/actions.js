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
