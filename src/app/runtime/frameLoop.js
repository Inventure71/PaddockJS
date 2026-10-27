import { interpolateRenderSnapshotInto } from '../../rendering/renderSnapshot.js';
import { FIXED_STEP } from '../../simulation/raceSimulation.js';
import { clamp } from '../../simulation/simMath.js';
import {
  domUpdateIntervalForSpeed,
  maxSimulationStepsForFrame,
  MAX_FRAME_CATCHUP_COUNT,
  TARGET_FRAME_MS,
} from './runtimeTiming.js';

export function runFrameLoopTick(app) {
  if (app.destroyed || app.expertMode) return;
  const simulation = app.sim;
  const now = performance.now();
  if (app.gridWalk?.tick(now)) {
    app.lastTime = now;
    return;
  }
  // Pixi owns draw pacing. A second frame gate can draw stale poses, and
  // rounding wall time to whole frames destroys the interpolation remainder.
  const elapsedMs = clamp(now - app.lastTime, 0, TARGET_FRAME_MS * MAX_FRAME_CATCHUP_COUNT);
  const elapsedFrameCount = elapsedMs / TARGET_FRAME_MS;
  const frameSeconds = elapsedMs / 1000;
  app.lastTime = now;
  app.sampleFps(now);
  app.accumulator += frameSeconds * app.simulationSpeed;

  let simulationSteps = 0;
  const stepEvents = [];
  const maxSimulationSteps = maxSimulationStepsForFrame(app.simulationSpeed, elapsedFrameCount);
  while (app.accumulator >= FIXED_STEP - 1e-10 && simulationSteps < maxSimulationSteps) {
    app.sim.step(FIXED_STEP);
    if (Array.isArray(app.sim.events) && app.sim.events.length > 0) {
      stepEvents.push(...app.sim.events);
    }
    app.accumulator = Math.max(0, app.accumulator - FIXED_STEP);
    simulationSteps += 1;
  }

  if (app.accumulator >= FIXED_STEP) {
    app.accumulator %= FIXED_STEP;
  }

  const shouldUpdateDom = now - app.lastDomUpdateTime >= domUpdateIntervalForSpeed(app.simulationSpeed);
  const fullSnapshot = stepEvents.length > 0 || shouldUpdateDom ? app.sim.snapshot() : null;
  if (stepEvents.length > 0) app.emitRaceEvents(stepEvents, fullSnapshot);
  // Host lifecycle callbacks may synchronously unmount or restart the race.
  // Do not render a disposed scene or deliver the old snapshot to its successor.
  if (app.destroyed || app.sim !== simulation) return;
  if (fullSnapshot) app.emitSnapshotLifecycle(fullSnapshot);
  if (app.destroyed || app.sim !== simulation) return;
  const renderSource = fullSnapshot ??
    app.sim.snapshotRenderInto?.(app.renderSourceSnapshotBuffer ?? {}) ??
    app.sim.snapshotRender?.() ??
    app.sim.snapshot();
  if (!fullSnapshot && app.sim.snapshotRenderInto) app.renderSourceSnapshotBuffer = renderSource;
  const renderSnapshot = interpolateRenderSnapshotInto(
    app.renderSnapshotBuffer ?? {},
    renderSource,
    clamp(app.accumulator / FIXED_STEP, 0, 1),
  );
  app.renderSnapshotBuffer = renderSnapshot;
  app.applyCamera(renderSnapshot, { elapsedMs });
  app.renderDrsTrails(renderSnapshot);
  app.renderPitLaneStatus(renderSnapshot);
  app.renderCars(renderSnapshot);
  if (shouldUpdateDom) {
    app.updateDom(fullSnapshot, { emitLifecycle: false });
    app.lastDomUpdateTime = now;
  }
}
