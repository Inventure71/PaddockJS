import { nearestTrackState } from '../trackModel.js';
import { clamp, normalizeAngle } from '../simMath.js';
import { VEHICLE_LIMITS } from '../vehiclePhysics.js';
import { applyWheelSurfaceState } from '../wheelSurface.js';

export function applyRunoffResponseForSimulation(sim, car) {
  const state = nearestTrackState(sim.track, car, car.progress);
  if (state.inPitLane) {
    applyWheelSurfaceState(car, sim.track, { centerState: state });
    return;
  }
  const signedLimit = sim.track.width / 2 + sim.track.gravelWidth + sim.track.runoffWidth;
  const overshoot = Math.abs(state.signedOffset) - signedLimit;
  if (overshoot <= 0) {
    applyWheelSurfaceState(car, sim.track, { centerState: state });
    return;
  }

  const side = Math.sign(state.signedOffset) || 1;
  car.x -= state.normalX * side * overshoot;
  car.y -= state.normalY * side * overshoot;
  car.speed = clamp(car.speed * clamp(1 - overshoot * 0.012, 0.22, 0.86), 0, VEHICLE_LIMITS.maxSpeed);
  car.heading = normalizeAngle(car.heading - side * clamp(overshoot * 0.0028, 0.018, 0.08));
  applyWheelSurfaceState(car, sim.track);
}
