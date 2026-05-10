import { createRenderSnapshot } from '../../rendering/renderSnapshot.js';
import { FIXED_STEP } from '../../simulation/raceSimulation.js';
import { clamp } from '../../simulation/simMath.js';
import {
  domUpdateIntervalForSpeed,
  FRAME_PACING_EPSILON_MS,
  maxSimulationStepsForFrame,
  MAX_FRAME_CATCHUP_COUNT,
  TARGET_FRAME_MS,
} from './runtimeTiming.js';

export function runFrameLoopTick(app) {
  if (app.expertMode) return;
  const now = performance.now();
  if (now < app.nextGameFrameTime - FRAME_PACING_EPSILON_MS) return;

  const elapsedFrameCount = clamp(
    Math.floor((now - app.nextGameFrameTime + FRAME_PACING_EPSILON_MS) / TARGET_FRAME_MS) + 1,
    1,
    MAX_FRAME_CATCHUP_COUNT,
  );
  const frameSeconds = (TARGET_FRAME_MS * elapsedFrameCount) / 1000;
  app.nextGameFrameTime += TARGET_FRAME_MS * elapsedFrameCount;
  if (now - app.nextGameFrameTime > TARGET_FRAME_MS * MAX_FRAME_CATCHUP_COUNT) {
    app.nextGameFrameTime = now + TARGET_FRAME_MS;
  }
  app.lastTime = now;
  app.sampleFps(now);
  app.accumulator += frameSeconds * app.simulationSpeed;

  let simulationSteps = 0;
  const stepEvents = [];
  const maxSimulationSteps = maxSimulationStepsForFrame(app.simulationSpeed, elapsedFrameCount);
  while (app.accumulator >= FIXED_STEP && simulationSteps < maxSimulationSteps) {
    app.sim.step(FIXED_STEP);
    if (Array.isArray(app.sim.events) && app.sim.events.length > 0) {
      stepEvents.push(...app.sim.events);
    }
    app.accumulator -= FIXED_STEP;
    simulationSteps += 1;
  }

  if (app.accumulator >= FIXED_STEP) {
    app.accumulator %= FIXED_STEP;
    app.nextGameFrameTime = now + TARGET_FRAME_MS;
  }

  const shouldUpdateDom = now - app.lastDomUpdateTime >= domUpdateIntervalForSpeed(app.simulationSpeed);
  const fullSnapshot = stepEvents.length > 0 || shouldUpdateDom ? app.sim.snapshot() : null;
  if (stepEvents.length > 0) app.emitRaceEvents(stepEvents, fullSnapshot);
  const renderSource = fullSnapshot ?? app.sim.snapshotRender?.() ?? app.sim.snapshot();
  const renderSnapshot = createRenderSnapshot(renderSource, clamp(app.accumulator / FIXED_STEP, 0, 1));
  app.applyCamera(renderSnapshot);
  app.renderDrsTrails(renderSnapshot);
  app.renderPitLaneStatus(renderSnapshot);
  app.renderCars(renderSnapshot);
  if (shouldUpdateDom) {
    app.updateDom(fullSnapshot, { emitLifecycle: false });
    app.lastDomUpdateTime = now;
  }
}
