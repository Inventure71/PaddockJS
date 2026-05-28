export function createRafScheduler(sync) {
  let frame = null;

  const run = () => {
    frame = null;
    sync();
  };

  return {
    runNow: sync,
    queue() {
      if (frame !== null) return;
      if (typeof requestAnimationFrame !== 'function') {
        sync();
        return;
      }
      frame = requestAnimationFrame(run);
    },
    cancel() {
      if (frame === null) return;
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      frame = null;
    },
  };
}
