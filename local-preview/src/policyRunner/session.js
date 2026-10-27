// Serial replacement owns the root until async startup settles. Each request
// invalidates earlier work immediately; stale resources are disposed on arrival.
export function createPolicyRunnerSession() {
  let generation = 0, actionGeneration = 0, disposed = false, resource = null;
  let pending = Promise.resolve();
  let abort = new AbortController();
  function invalidate() { generation += 1; abort.abort(); abort = new AbortController(); }
  function release(value) { try { value?.loop?.stop(); } finally { value?.simulator?.destroy(); } }
  return {
    replace(allocate) {
      if (disposed) return Promise.resolve(null);
      invalidate();
      const token = generation, signal = abort.signal;
      pending = pending.catch(() => {}).then(async () => {
        if (disposed || token !== generation) return null;
        release(resource); resource = null;
        const next = await allocate({ signal, isCurrent: () => !disposed && token === generation });
        if (disposed || token !== generation) { release(next); return null; }
        resource = next;
        return next;
      });
      return pending;
    },
    run(action) {
      const token = generation, actionToken = actionGeneration;
      pending = pending.catch((error) => { if (!resource) throw error; }).then(() => {
        if (disposed || token !== generation || actionToken !== actionGeneration) return null;
        if (!resource) throw new Error('Policy Runner has no active configuration.');
        return action();
      });
      return pending;
    },
    cancelActions() { actionGeneration += 1; },
    captureAction() {
      const token = generation, actionToken = actionGeneration;
      return () => !disposed && token === generation && actionToken === actionGeneration;
    },
    capture() { const token = generation; return () => !disposed && token === generation; },
    get signal() { return abort.signal; },
    destroy() { if (disposed) return; disposed = true; invalidate(); release(resource); resource = null; },
  };
}

// Own one RAF chain, including async work. Stop/restart cannot let an earlier
// awaited decision schedule another chain or restore stale running state.
export function createPolicyRunnerPlayback({ step, onRunning, onError,
  requestFrame = (callback) => requestAnimationFrame(callback), cancelFrame = (id) => cancelAnimationFrame(id) }) {
  let generation = 0, frame = null, running = false;
  function stop() {
    generation += 1; running = false;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    onRunning(false);
  }
  return {
    stop,
    start() {
      stop(); running = true; onRunning(true);
      const token = generation;
      const tick = async () => {
        frame = null;
        if (!running || token !== generation) return;
        try {
          if (await step() === false && token === generation) { stop(); return; }
        } catch (error) { if (token === generation) { stop(); onError(error); } return; }
        if (running && token === generation) frame = requestFrame(tick);
      };
      frame = requestFrame(tick);
    },
  };
}
