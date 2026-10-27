import { describe, expect, test, vi } from 'vitest';
import { createPolicyRunnerSession, createPolicyRunnerPlayback } from '../../local-preview/src/policyRunner/session.js';
import { createLiveNodeConnection } from '../../local-preview/src/policyRunner/liveConnection.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const resource = () => ({ simulator: { destroy: vi.fn() }, loop: { stop: vi.fn() } });

describe('Policy Runner session ownership', () => {
  test('serializes replacements, aborts old work and disposes a stale mount before mounting its successor', async () => {
    const session = createPolicyRunnerSession(), pending = deferred(), started = deferred();
    const old = resource(), next = resource(), events = [];
    const first = session.replace(({ signal }) => { signal.addEventListener('abort', () => events.push('aborted')); events.push('first'); started.resolve(); return pending.promise; });
    await started.promise;
    const second = session.replace(() => { events.push('second'); expect(old.simulator.destroy).toHaveBeenCalledOnce(); return next; });
    expect(events).toEqual(['first', 'aborted']);
    pending.resolve(old);
    expect(await first).toBe(null);
    expect(await second).toBe(next);
    expect(events).toEqual(['first', 'aborted', 'second']);
    session.destroy();
    expect(next.loop.stop).toHaveBeenCalledOnce();
    expect(next.simulator.destroy).toHaveBeenCalledOnce();
  });

  test('disposal invalidates pending mount and later actions; failed mounts do not poison the queue', async () => {
    const session = createPolicyRunnerSession();
    await expect(session.replace(() => { throw new Error('startup failed'); })).rejects.toThrow('startup failed');
    const pending = deferred(), late = resource();
    const mount = session.replace(() => pending.promise);
    await Promise.resolve(); await Promise.resolve();
    const isCurrent = session.capture();
    session.destroy();
    pending.resolve(late);
    expect(await mount).toBe(null);
    expect(isCurrent()).toBe(false);
    expect(late.simulator.destroy).toHaveBeenCalledOnce();
    const allocate = vi.fn();
    await session.replace(allocate);
    expect(allocate).not.toHaveBeenCalled();
  });

  test('actions wait for the current allocation and are never delivered after its failure', async () => {
    const session = createPolicyRunnerSession(), mounting = deferred(), started = deferred();
    const current = resource(), action = vi.fn(() => 'stepped');
    const mount = session.replace(async () => { started.resolve(); return mounting.promise; });
    await started.promise;
    const step = session.run(action);
    await Promise.resolve();
    expect(action).not.toHaveBeenCalled();
    mounting.resolve(current);
    await mount;
    expect(await step).toBe('stepped');
    expect(action).toHaveBeenCalledOnce();
    const failure = new Error('mount failed');
    const failed = session.replace(() => { throw failure; });
    const unsafeAction = vi.fn();
    const blocked = session.run(unsafeAction);
    await expect(failed).rejects.toBe(failure);
    await expect(blocked).rejects.toBe(failure);
    expect(unsafeAction).not.toHaveBeenCalled();
    session.destroy();
  });

  test('an old awaited playback step cannot create a second RAF chain after restart', async () => {
    const frames = [], pending = deferred(), running = [];
    const playback = createPolicyRunnerPlayback({ step: vi.fn(() => pending.promise), onRunning: (value) => running.push(value), onError: vi.fn(),
      requestFrame: (callback) => { frames.push(callback); return frames.length; }, cancelFrame: vi.fn() });
    playback.start();
    const oldTick = frames.shift()();
    playback.stop(); playback.start();
    pending.resolve(true); await oldTick;
    expect(frames).toHaveLength(1);
    expect(running.at(-1)).toBe(true);
    playback.stop();
  });

  test('a rejected step stops playback, resets running state and reports the actual error', async () => {
    let tick;
    const error = new Error('Decision failed'), onRunning = vi.fn(), onError = vi.fn();
    const playback = createPolicyRunnerPlayback({ step: async () => { throw error; }, onRunning, onError,
      requestFrame: (callback) => { tick = callback; return 1; }, cancelFrame: vi.fn() });
    playback.start(); await tick();
    expect(onRunning).toHaveBeenLastCalledWith(false);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});

class Socket extends EventTarget {
  close = vi.fn();
  emit(name, payload) { const event = new Event(name); if (payload) event.data = JSON.stringify(payload); this.dispatchEvent(event); }
}
function liveOptions(extra = {}) {
  let handler;
  const expert = { attachExternalRenderer: vi.fn((source) => { handler = source.subscribe(vi.fn()); }), detachExternalRenderer: vi.fn(() => handler?.()) };
  return { expert, options: { getExpert: () => expert, onStatus: vi.fn(), onChange: vi.fn(), ...extra } };
}

describe('Policy Runner live connection ownership', () => {
  test('an old socket close or packet cannot disconnect or overwrite the replacement connection', () => {
    const sockets = [new Socket(), new Socket()], received = vi.fn();
    const { expert, options } = liveOptions({ createSocket: vi.fn().mockReturnValueOnce(sockets[0]).mockReturnValueOnce(sockets[1]), onFrame: received });
    const live = createLiveNodeConnection(options);
    live.connect('ws://example/old'); sockets[0].emit('open');
    live.connect('ws://example/new'); sockets[1].emit('open');
    const calls = expert.detachExternalRenderer.mock.calls.length;
    sockets[0].emit('close'); sockets[0].emit('message', { snapshot: {}, meta: { step: 999 } });
    expect(live.active).toBe(true);
    expect(expert.detachExternalRenderer).toHaveBeenCalledTimes(calls);
    expect(options.onStatus).toHaveBeenLastCalledWith({ connected: true, detail: 'connected', error: null });
    sockets[1].emit('message', { snapshot: {}, meta: { step: 4 } });
    expect(options.onStatus).toHaveBeenLastCalledWith({ connected: true, detail: 'step 4', error: null });
    live.disconnect();
    expect(sockets[1].close).toHaveBeenCalledOnce();
  });

  test('disconnect aborts in-flight polling and ignores its late successful response', async () => {
    const pending = deferred(), fetchPacket = vi.fn(() => pending.promise), setTimer = vi.fn(), onFrame = vi.fn();
    const { options } = liveOptions({ fetchPacket, setTimer, onFrame });
    const live = createLiveNodeConnection(options);
    live.connect('https://example/frames');
    const signal = fetchPacket.mock.calls[0][1].signal;
    live.disconnect();
    expect(signal.aborted).toBe(true);
    const before = onFrame.mock.calls.length;
    pending.resolve({ ok: true, json: async () => ({ snapshot: {}, meta: { step: 99 } }) });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(onFrame).toHaveBeenCalledTimes(before);
    expect(options.onStatus).toHaveBeenLastCalledWith({ connected: false, detail: null, error: null });
    expect(setTimer).not.toHaveBeenCalled();
  });

  test('failed attachment releases the transport and preserves its failure status', () => {
    const { expert, options } = liveOptions();
    expert.attachExternalRenderer.mockImplementation(() => { throw new Error('attach failed'); });
    const live = createLiveNodeConnection(options);
    live.connect('http://example/frames');
    expect(live.active).toBe(false);
    expect(options.onStatus).toHaveBeenLastCalledWith({ connected: false, detail: 'attach failed', error: 'attach failed' });
  });
});
