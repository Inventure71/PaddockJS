import { clamp } from '../../simulation/simMath.js';

export const TARGET_RENDER_FPS = 60;
export const TARGET_FRAME_MS = 1000 / TARGET_RENDER_FPS;
export const FRAME_PACING_EPSILON_MS = 0.75;
export const MAX_FRAME_CATCHUP_COUNT = 4;
export const BASE_MAX_SIMULATION_STEPS_PER_RENDER = 5;
export const HARD_MAX_SIMULATION_STEPS_PER_RENDER = 60;
export const DOM_UPDATE_INTERVAL_MS = 100;
export const TIMING_UPDATE_INTERVAL_MS = 250;

export function maxSimulationStepsForFrame(simulationSpeed, elapsedFrameCount) {
  const speed = Math.max(1, Number(simulationSpeed) || 1);
  const frameCount = Math.max(1, Number(elapsedFrameCount) || 1);
  return clamp(
    Math.ceil(speed * frameCount) + 1,
    BASE_MAX_SIMULATION_STEPS_PER_RENDER,
    HARD_MAX_SIMULATION_STEPS_PER_RENDER,
  );
}

export function domUpdateIntervalForSpeed(simulationSpeed) {
  const speed = Math.max(1, Number(simulationSpeed) || 1);
  if (speed >= 10) return 250;
  if (speed >= 5) return 180;
  return DOM_UPDATE_INTERVAL_MS;
}

export function timingUpdateIntervalForSpeed(simulationSpeed) {
  const speed = Math.max(1, Number(simulationSpeed) || 1);
  if (speed >= 10) return 600;
  if (speed >= 5) return 400;
  return TIMING_UPDATE_INTERVAL_MS;
}
