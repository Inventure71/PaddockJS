export const DEFAULT_DEBUG_JSON_INTERVAL_MS = 500;

export function createThrottledJsonReadout({
  intervalMs = DEFAULT_DEBUG_JSON_INTERVAL_MS,
  now = defaultNow,
  stringify = JSON.stringify,
} = {}) {
  let lastRenderAt = -Infinity;

  function due({ force = false } = {}) {
    return force || now() - lastRenderAt >= intervalMs;
  }

  function update(element, payload, { force = false, space = 2 } = {}) {
    if (!element) return false;
    const currentTime = now();
    if (!force && currentTime - lastRenderAt < intervalMs) return false;
    element.textContent = stringify(payload, null, space);
    lastRenderAt = currentTime;
    return true;
  }

  return { due, update };
}

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
