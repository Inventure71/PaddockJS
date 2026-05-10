export function observeRuntimeVisibility(app) {
  if (!app.canvasHost) return;

  if (typeof IntersectionObserver === 'function') {
    app.visibilityObserver?.disconnect?.();
    app.visibilityObserver = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === app.canvasHost) ?? entries[0];
      app.runtimeViewportVisible = Boolean(entry?.isIntersecting || entry?.intersectionRatio > 0);
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

  app.syncRuntimeTicker();
}

export function syncRuntimeTicker(app) {
  if (app.expertMode) return;
  if (!app.app?.ticker) return;

  const shouldRun = app.runtimeViewportVisible && app.runtimeDocumentVisible;
  if (shouldRun === app.runtimeTickerRunning) return;

  app.runtimeTickerRunning = shouldRun;
  if (shouldRun) {
    app.resetFrameClock();
    app.app.ticker.start?.();
  } else {
    app.app.ticker.stop?.();
  }
}
