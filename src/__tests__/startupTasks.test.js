import { describe, expect, test, vi } from 'vitest';
import { createStartupCheckpoint } from '../app/runtime/startupTasks.js';
import { RuntimeStartupCancelledError } from '../app/runtime/pixiStartupLifecycle.js';

describe('browser startup task checkpoints', () => {
  test('forced checkpoints cross a real timer task instead of only yielding microtasks', async () => {
    const order = [];
    const checkpoint = createStartupCheckpoint({ destroyed: false });
    setTimeout(() => order.push('other browser task'), 0);
    const pending = checkpoint(true).then(() => order.push('startup resumed'));

    await Promise.resolve();
    expect(order).toEqual([]);
    await pending;
    expect(order).toEqual(['other browser task', 'startup resumed']);
  });

  test('yields at the budget and resets the budget when the task resumes', async () => {
    let now = 0;
    let resume;
    const yieldTask = vi.fn(() => new Promise((resolve) => { resume = resolve; }));
    const checkpoint = createStartupCheckpoint({ destroyed: false }, { now: () => now, yieldTask });

    now = 7.99;
    expect(checkpoint()).toBeNull();
    expect(yieldTask).not.toHaveBeenCalled();
    now = 8;
    const pending = checkpoint();
    expect(yieldTask).toHaveBeenCalledTimes(1);
    now = 100;
    resume();
    await pending;

    now = 107;
    expect(checkpoint()).toBeNull();
    now = 108;
    const next = checkpoint();
    expect(yieldTask).toHaveBeenCalledTimes(2);
    resume();
    await next;
  });

  test('an explicit budget and forced yield govern short startup phases', async () => {
    let now = 0;
    const yieldTask = vi.fn(() => Promise.resolve());
    const checkpoint = createStartupCheckpoint({ destroyed: false }, { budgetMs: 3, now: () => now, yieldTask });
    now = 2;
    expect(checkpoint()).toBeNull();
    await checkpoint(true);
    expect(yieldTask).toHaveBeenCalledTimes(1);
    now = 5;
    await checkpoint();
    expect(yieldTask).toHaveBeenCalledTimes(2);
  });

  test('cancellation rejects before scheduling work even when the budget remains', () => {
    const app = { destroyed: false };
    const yieldTask = vi.fn();
    const checkpoint = createStartupCheckpoint(app, { now: () => 0, yieldTask });
    app.destroyed = true;
    expect(() => checkpoint()).toThrow(RuntimeStartupCancelledError);
    expect(() => checkpoint(true)).toThrow(RuntimeStartupCancelledError);
    expect(yieldTask).not.toHaveBeenCalled();
  });

  test('cancellation during the task boundary prevents startup from resuming', async () => {
    const app = { destroyed: false };
    const checkpoint = createStartupCheckpoint(app);
    const resumed = vi.fn();
    const pending = checkpoint(true).then(resumed);
    app.destroyed = true;
    await expect(pending).rejects.toBeInstanceOf(RuntimeStartupCancelledError);
    expect(resumed).not.toHaveBeenCalled();
  });
});
