export function observeRuntimeVisibility(app) {
  if (!app.canvasHost) return;

  const syncViewportVisibility = () => {
    app.runtimeViewportVisible = isRuntimeViewportVisible(app.canvasHost);
    app.syncRuntimeTicker();
  };
  const scheduleViewportVisibilitySync = () => {
    if (app.runtimeVisibilitySyncFrame) return;
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      syncViewportVisibility();
      return;
    }
    app.runtimeVisibilitySyncFrame = globalThis.requestAnimationFrame(() => {
      app.runtimeVisibilitySyncFrame = null;
      syncViewportVisibility();
    });
  };

  if (typeof IntersectionObserver === 'function') {
    app.visibilityObserver?.disconnect?.();
    app.visibilityObserver = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === app.canvasHost) ?? entries[0];
      app.runtimeViewportVisible = Boolean(
        entry?.isIntersecting ||
        entry?.intersectionRatio > 0 ||
        isRuntimeViewportVisible(app.canvasHost),
      );
      app.syncRuntimeTicker();
    }, {
      root: null,
      rootMargin: '240px 0px',
      threshold: 0,
    });
    app.visibilityObserver.observe(app.canvasHost);
  }

  if (typeof document !== 'undefined') {
    app.visibilityChangeHandler = () => {
      app.runtimeDocumentVisible = document.visibilityState !== 'hidden';
      app.syncRuntimeTicker();
    };
    document.addEventListener('visibilitychange', app.visibilityChangeHandler, {
      signal: app.abortController.signal,
    });
  }

  syncViewportVisibility();
  globalThis.addEventListener?.('scroll', scheduleViewportVisibilitySync, {
    passive: true,
    signal: app.abortController.signal,
  });
  globalThis.addEventListener?.('resize', scheduleViewportVisibilitySync, {
    passive: true,
    signal: app.abortController.signal,
  });
  globalThis.addEventListener?.('focus', syncViewportVisibility, {
    signal: app.abortController.signal,
  });
  globalThis.addEventListener?.('pageshow', syncViewportVisibility, {
    signal: app.abortController.signal,
  });
  app.syncRuntimeTicker();
}

export function syncRuntimeTicker(app) {
  if (app.expertMode) return;
  const ticker = app.app?.ticker;
  if (!ticker) return;

  const shouldRun = app.runtimeViewportVisible && app.runtimeDocumentVisible;
  const tickerRunning = typeof ticker.started === 'boolean'
    ? ticker.started
    : app.runtimeTickerRunning;
  if (shouldRun === app.runtimeTickerRunning && shouldRun === tickerRunning) return;

  app.runtimeTickerRunning = shouldRun;
  if (shouldRun) {
    app.resetFrameClock();
    ticker.start?.();
  } else {
    ticker.stop?.();
  }
}

function isRuntimeViewportVisible(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return true;

  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  const left = Number(rect.left);
  const right = Number(rect.right);
  const width = Number(rect.width ?? right - left);
  const height = Number(rect.height ?? bottom - top);
  if (![top, bottom, left, right, width, height].every(Number.isFinite)) return true;
  if (width <= 0 || height <= 0) return false;

  const viewportHeight = globalThis.innerHeight || globalThis.document?.documentElement?.clientHeight || 0;
  const viewportWidth = globalThis.innerWidth || globalThis.document?.documentElement?.clientWidth || 0;
  const margin = 240;
  return bottom >= -margin &&
    top <= viewportHeight + margin &&
    right >= -margin &&
    left <= viewportWidth + margin;
}
