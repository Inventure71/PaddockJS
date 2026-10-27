import { afterEach, expect, test, vi } from 'vitest';
import { createPaddockDriverControllerLoop } from '../environment/controllerLoop.js';
import { createPolicyServerController } from '../../site/src/showcase/policyRunner/controllers.js';
import { createPolicyRunnerSession } from '../../site/src/showcase/policyRunner/session.js';
import { stepPolicyRunner } from '../../site/src/showcase/policyRunner/stepResult.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const ok = (body = {}) => ({ ok: true, json: async () => ({ ok: true, ...body }) });

test('Stop aborts a stalled policy request, permits queued same-session Reset, and does not count a cancelled frame', async () => {
  let requested;
  const pendingRequest = new Promise((resolve) => { requested = resolve; });
  let stalled = true, requestSignal;
  const fetchPacket = vi.fn((url, options) => {
    if (url.endsWith('/policy/decide-batch') && stalled) {
      requestSignal = options.signal;
      requested();
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return Promise.resolve(ok({ actions: { alpha: { steering: 0, throttle: 0.2, brake: 0 } } }));
  });
  vi.stubGlobal('fetch', fetchPacket);
  let runtimeStep = 0;
  const result = () => ({ info: { step: runtimeStep, controlledDrivers: ['alpha'] }, observation: { alpha: { vector: [1] } } });
  const runtime = { getActionSpec: () => ({ controlledDrivers: ['alpha'] }), getObservationSpec: () => ({}),
    reset: vi.fn(() => { runtimeStep = 0; return result(); }), step: vi.fn(() => { runtimeStep += 1; return result(); }) };
  const session = createPolicyRunnerSession();
  let loop, controller, added, removed;
  await session.replace(async () => {
    added = vi.spyOn(session.signal, 'addEventListener');
    removed = vi.spyOn(session.signal, 'removeEventListener');
    controller = createPolicyServerController({ signal: session.signal });
    loop = createPaddockDriverControllerLoop({ runtime, controller });
    await loop.reset();
    return { loop, simulator: { destroy: vi.fn() } };
  });
  let visualFrame = 0;
  const train = vi.fn();
  const stepping = session.run(async () => {
    const next = await stepPolicyRunner(loop, 'stepFrame', session.captureAction());
    if (next) { visualFrame += 1; train(next); }
    return next;
  });
  await pendingRequest;
  session.cancelActions(); loop.stop();
  const resetting = session.run(() => loop.reset());
  expect(await stepping).toBe(null);
  expect((await resetting).info.step).toBe(0);
  expect(requestSignal.aborted).toBe(true);
  expect(session.signal.aborted).toBe(false);
  expect(visualFrame).toBe(0);
  expect(train).not.toHaveBeenCalled();
  expect(runtime.step).not.toHaveBeenCalled();
  expect(controller.debugState.consecutiveErrors).toBe(0);
  stalled = false;
  const next = await session.run(() => stepPolicyRunner(loop, 'stepFrame', session.captureAction()));
  expect(next.info.step).toBe(1);
  const subsequentSignal = fetchPacket.mock.calls.at(-1)[1].signal;
  expect(subsequentSignal).not.toBe(requestSignal);
  expect(subsequentSignal.aborted).toBe(false);
  expect(added.mock.calls.length).toBeGreaterThan(0);
  expect(removed.mock.calls.length).toBe(added.mock.calls.length);
  session.destroy();
});

test('a mount-lifetime abort also cancels a request with an otherwise current decision signal', async () => {
  const mount = new AbortController(), decision = new AbortController();
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  vi.stubGlobal('fetch', vi.fn((url, { signal }) => {
    if (url.endsWith('/policy/reset')) return Promise.resolve(ok());
    requested();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }));
  const controller = createPolicyServerController({ signal: mount.signal });
  const pending = controller.decideBatch({ controlledDrivers: ['alpha'], signal: decision.signal });
  await started;
  mount.abort(new Error('Mount disposed'));
  await expect(pending).rejects.toThrow('Mount disposed');
  expect(decision.signal.aborted).toBe(false);
});
