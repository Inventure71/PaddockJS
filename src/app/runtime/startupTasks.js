import { assertRuntimeStartupActive } from './pixiStartupLifecycle.js';

// A browser task boundary allows input and rendering; a microtask does not.
export function createStartupCheckpoint(app, {
  budgetMs = 8,
  now = () => performance.now(),
  yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  let startedAt = now();
  return (force = false) => {
    assertRuntimeStartupActive(app);
    if (!force && now() - startedAt < budgetMs) return null;
    return Promise.resolve(yieldTask()).then(() => {
      assertRuntimeStartupActive(app);
      startedAt = now();
    });
  };
}
