export function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function cancelScheduled(handle) {
  if (handle == null) return;
  if (typeof handle.cancel === 'function') {
    handle.cancel();
    return;
  }
  if (typeof handle === 'number') {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    if (typeof clearTimeout === 'function') clearTimeout(handle);
  }
}

export function defaultScheduler() {
  if (typeof requestAnimationFrame === 'function') {
    return (callback) => {
      const id = requestAnimationFrame(callback);
      return { cancel: () => cancelAnimationFrame(id) };
    };
  }
  return (callback) => {
    const id = setTimeout(callback, 0);
    return { cancel: () => clearTimeout(id) };
  };
}
