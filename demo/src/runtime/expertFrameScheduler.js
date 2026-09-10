const FRAME_MS = 1000 / 60;
const CLOCK_EPSILON_MS = 1e-7;

export function createExpertFrameScheduler({
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
  now = () => globalThis.performance.now(),
} = {}) {
  let nextFrameAt = null;

  return function scheduleExpertFrame(callback) {
    let cancelled = false;
    let completed = false;
    let frameHandle = null;

    function tick(timestamp) {
      frameHandle = null;
      if (cancelled) return;
      const currentTime = Number.isFinite(timestamp) ? timestamp : now();
      nextFrameAt ??= currentTime;
      if (currentTime + CLOCK_EPSILON_MS < nextFrameAt) {
        frameHandle = requestFrame(tick);
        return;
      }

      // Carry the deadline across display frames so 144/165 Hz do not round
      // every simulation interval up to a whole number of display frames.
      nextFrameAt += FRAME_MS;
      // A delayed frame must not accumulate catch-up steps after a stall.
      if (nextFrameAt <= currentTime + CLOCK_EPSILON_MS) nextFrameAt = currentTime + FRAME_MS;
      completed = true;
      callback();
    }

    frameHandle = requestFrame(tick);
    return {
      cancel() {
        if (cancelled || completed) return;
        cancelled = true;
        if (frameHandle != null) cancelFrame(frameHandle);
        frameHandle = null;
        nextFrameAt = null;
      },
    };
  };
}
