import { describe, expect, test, vi } from 'vitest';
import { createExpertFrameScheduler } from '../../demo/src/runtime/expertFrameScheduler.js';

function display() {
  let timestamp = 0;
  let nextHandle = 0;
  const pending = new Map();
  const cancelFrame = vi.fn((handle) => pending.delete(handle));
  const scheduler = createExpertFrameScheduler({
    requestFrame(callback) {
      const handle = ++nextHandle;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame,
    now: () => timestamp,
  });
  return {
    scheduler,
    pending,
    cancelFrame,
    frame(at, { omitTimestamp = false } = {}) {
      timestamp = at;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(omitTimestamp ? undefined : timestamp));
    },
  };
}

describe('expert lab wall-time pacing', () => {
  test.each([60, 120, 144, 165])('advances at 60 Hz on a %s Hz display', (refreshRate) => {
    const screen = display();
    let steps = 0;
    const step = () => {
      steps += 1;
      screen.scheduler(step);
    };
    screen.scheduler(step);
    for (let frame = 0; frame < refreshRate * 2; frame += 1) {
      const before = steps;
      screen.frame(frame * 1000 / refreshRate);
      expect(steps - before).toBeLessThanOrEqual(1);
      expect(screen.pending.size).toBe(1);
    }
    expect(steps).toBe(120);
  });

  test('drops elapsed time after a long stall without a catch-up burst', () => {
    const screen = display();
    let steps = 0;
    const step = () => {
      steps += 1;
      screen.scheduler(step);
    };
    screen.scheduler(step);
    screen.frame(0);
    screen.frame(10000);
    expect(steps).toBe(2);
    screen.frame(10001);
    screen.frame(10008);
    expect(steps).toBe(2);
    screen.frame(10000 + 1000 / 60);
    expect(steps).toBe(3);
  });

  test('cancels the currently pending display frame and rejects a late callback', () => {
    const screen = display();
    screen.scheduler(() => {});
    screen.frame(0);
    const callback = vi.fn();
    const handle = screen.scheduler(callback);
    screen.frame(4);
    const [pendingHandle, lateCallback] = [...screen.pending.entries()][0];

    handle.cancel();
    handle.cancel();
    lateCallback(100);

    expect(screen.cancelFrame).toHaveBeenCalledExactlyOnceWith(pendingHandle);
    expect(screen.pending.size).toBe(0);
    expect(callback).not.toHaveBeenCalled();
    screen.scheduler(callback);
    screen.frame(5);
    expect(callback).toHaveBeenCalledOnce();
  });

  test('cancelling a completed callback cannot reset the cadence of its successor', () => {
    const screen = display();
    const callback = vi.fn();
    const completed = screen.scheduler(callback);
    screen.frame(0);
    screen.scheduler(callback);
    completed.cancel();
    screen.frame(8);
    expect(callback).toHaveBeenCalledOnce();
    expect(screen.cancelFrame).not.toHaveBeenCalled();
    screen.frame(17);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  test('uses the injected clock when a frame provider omits timestamps', () => {
    const screen = display();
    const callback = vi.fn();
    screen.scheduler(callback);
    screen.frame(0, { omitTimestamp: true });
    screen.scheduler(callback);
    screen.frame(8, { omitTimestamp: true });
    expect(callback).toHaveBeenCalledOnce();
    screen.frame(17, { omitTimestamp: true });
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
