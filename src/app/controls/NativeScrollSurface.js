// Native overflow owns wheel gestures and boundary handoff. Never register a
// canceling wheel listener: macOS Gecko can otherwise stall its shared APZ queue
// before an event reaches JavaScript (Mozilla bug 2072785).
export class NativeScrollSurface {
  constructor(host, onScroll, signal) {
    const parentSignal = signal;
    this.abort = new AbortController();
    signal = this.abort.signal;
    this.host = host;
    this.onScroll = onScroll;
    this.properties = new Map(['overflow', 'scrollbar-width', 'scroll-behavior', 'overflow-anchor'].map((name) =>
      [name, [host.style.getPropertyValue(name), host.style.getPropertyPriority(name)]]));
    this.content = host.ownerDocument.createElement('div');
    this.viewport = host.ownerDocument.createElement('div');
    this.content.dataset.nativeScrollContent = '';
    this.viewport.dataset.nativeScrollViewport = '';
    Object.assign(this.content.style, { position: 'relative' });
    Object.assign(this.viewport.style, { position: 'sticky', top: '0px', left: '0px', overflow: 'clip' });
    this.viewport.append(...host.childNodes);
    this.content.append(this.viewport);
    host.append(this.content);
    host.style.setProperty('scrollbar-width', 'none');
    host.style.setProperty('scroll-behavior', 'auto');
    host.style.setProperty('overflow-anchor', 'none');
    this.x = this.y = 0;
    host.addEventListener('scroll', () => {
      // A growing viewport can clamp an old scroll extent before its resize
      // observer runs. That layout displacement is not user camera input.
      if (host.clientWidth !== this.width || host.clientHeight !== this.height) return;
      const x = host.scrollLeft, y = host.scrollTop;
      const dx = x - this.x, dy = y - this.y;
      this.x = x;
      this.y = y;
      if (this.enabled && !this.touching && !this.modifiersHeld && (dx || dy)) onScroll({ x, y, dx, dy });
    }, { signal, passive: true });
    // Race touch swipes belong to the page; Grid Walk owns touch dragging via
    // pointer capture. Neither should turn native scroll distance into zoom.
    host.addEventListener('touchstart', () => {
      this.touching = true;
      this.updateOverflow();
    }, { signal, passive: true });
    for (const name of ['touchend', 'touchcancel']) host.addEventListener(name, (event) => {
      if (event.touches.length) return;
      this.touching = false;
      this.updateOverflow();
    }, { signal, passive: true });
    const document = host.ownerDocument;
    for (const name of ['keydown', 'keyup']) document.addEventListener(name, (event) => {
      this.modifiersHeld = event.ctrlKey || event.metaKey;
      this.updateOverflow();
    }, { signal, passive: true });
    const releaseInput = () => {
      this.modifiersHeld = this.touching = false;
      this.updateOverflow();
    };
    document.defaultView?.addEventListener('blur', releaseInput, { signal, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') releaseInput();
    }, { signal, passive: true });
    parentSignal?.addEventListener('abort', () => this.destroy(), { once: true, signal });
    if (parentSignal?.aborted) this.destroy();
  }

  sync({ enabled = true, x = 0, y = 0, maxX = 0, maxY = 0 } = {}) {
    this.enabled = enabled;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.width = width;
    this.height = height;
    // Integer extents let a camera boundary reach the native boundary exactly.
    // A fractional extent can consume the first outward wheel on Chromium.
    if (maxX > 0 && Math.abs(x - maxX) < 0.5) x = Math.ceil(maxX);
    if (maxY > 0 && Math.abs(y - maxY) < 0.5) y = Math.ceil(maxY);
    this.content.style.width = `${width + (enabled ? Math.ceil(maxX) : 0)}px`;
    this.content.style.height = `${height + (enabled ? Math.ceil(maxY) : 0)}px`;
    this.viewport.style.width = `${width}px`;
    this.viewport.style.height = `${height}px`;
    this.updateOverflow();
    if (Math.abs(this.host.scrollLeft - x) > 0.5) this.host.scrollLeft = x;
    if (Math.abs(this.host.scrollTop - y) > 0.5) this.host.scrollTop = y;
    // Read browser-clamped/rounded coordinates. Queued scroll events from our
    // own selection, resizing or mode sync must never feed back into commands.
    this.x = this.host.scrollLeft;
    this.y = this.host.scrollTop;
  }

  updateOverflow() {
    this.host.style.setProperty('overflow', this.enabled && !this.touching && !this.modifiersHeld ? 'auto' : 'hidden');
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.content.replaceWith(...this.viewport.childNodes);
    for (const [name, [value, priority]] of this.properties) {
      if (value) this.host.style.setProperty(name, value, priority);
      else this.host.style.removeProperty(name);
    }
    this.host.scrollLeft = this.host.scrollTop = 0;
  }
}
