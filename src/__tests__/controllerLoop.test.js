import { describe, expect, test, vi } from 'vitest';
import { createPaddockDriverControllerLoop } from '../environment/controllerLoop.js';

const DRIVER_ID = 'driver';

function createRuntime() {
  return {
    reset: vi.fn((options = {}) => ({
      done: false,
      observation: { [DRIVER_ID]: { driverId: DRIVER_ID, vector: [0] } },
      metrics: {},
      events: [],
      info: { step: 0, controlledDrivers: [DRIVER_ID], resetId: options.resetId ?? null },
    })),
    step: vi.fn(() => ({
      done: false,
      observation: { [DRIVER_ID]: { driverId: DRIVER_ID, vector: [1] } },
      metrics: {},
      events: [],
      info: { step: 1, controlledDrivers: [DRIVER_ID] },
    })),
    getActionSpec: vi.fn(() => ({ controlledDrivers: [DRIVER_ID] })),
    getObservationSpec: vi.fn(() => ({ version: 1 })),
    getObservation: vi.fn(() => ({ [DRIVER_ID]: { driverId: DRIVER_ID, vector: [0] } })),
  };
}

function createDeferredDecision() {
  let resolveDecision;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const decision = new Promise((resolve) => {
    resolveDecision = resolve;
  });
  const decideBatch = vi.fn(() => {
    markStarted();
    return decision;
  });
  return { decideBatch, resolveDecision, started };
}

function actions() {
  return { [DRIVER_ID]: { steering: 0, throttle: 1, brake: 0 } };
}

describe('driver controller loop cancellation', () => {
  test('stop invalidates an in-flight scheduled decision before it can step the runtime', async () => {
    const scheduled = [];
    const runtime = createRuntime();
    const deferred = createDeferredDecision();
    const loop = createPaddockDriverControllerLoop({
      runtime,
      controller: { decideBatch: deferred.decideBatch },
      actionRepeat: 1,
      scheduler(callback) {
        scheduled.push(callback);
        return { cancel: vi.fn() };
      },
    });

    await loop.reset();
    loop.start();
    const tick = scheduled.shift()();
    await deferred.started;

    loop.stop();
    deferred.resolveDecision(actions());
    await tick;

    expect(runtime.step).not.toHaveBeenCalled();
    expect(loop.stats).toMatchObject({ running: false, policyStep: 0, actions: null });
    expect(scheduled).toHaveLength(0);
  });

  test('reset invalidates an in-flight manual decision without disabling later manual frames', async () => {
    const runtime = createRuntime();
    const deferred = createDeferredDecision();
    const loop = createPaddockDriverControllerLoop({
      runtime,
      controller: { decideBatch: deferred.decideBatch },
      actionRepeat: 1,
    });

    await loop.reset({ resetId: 'initial' });
    const staleFrame = loop.stepFrame();
    await deferred.started;
    const reset = loop.reset({ resetId: 'replacement' });
    deferred.resolveDecision(actions());
    await Promise.all([staleFrame, reset]);

    expect(runtime.step).not.toHaveBeenCalled();
    expect(loop.result.info.resetId).toBe('replacement');
    expect(loop.stats).toMatchObject({ policyStep: 0, runtimeStep: 0, actions: null });

    const currentActions = actions();
    deferred.decideBatch.mockReturnValueOnce(currentActions);
    await loop.stepFrame();
    expect(runtime.step).toHaveBeenCalledWith(currentActions);
  });
});
