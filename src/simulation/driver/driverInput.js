import { clamp } from '../simMath.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

export function createDriverInput() {
  const state = {
    steering: 0,
    throttle: 0,
    brake: 0,
  };

  return {
    steer(amount) {
      state.steering = clamp(amount, -VEHICLE_LIMITS.maxSteer, VEHICLE_LIMITS.maxSteer);
      return this;
    },
    accelerate(amount) {
      state.throttle = clamp(amount, 0, 1);
      return this;
    },
    brake(amount) {
      state.brake = clamp(amount, 0, 1);
      return this;
    },
    controls() {
      return { ...state };
    },
  };
}
