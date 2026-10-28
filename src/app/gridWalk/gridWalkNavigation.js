// Every input becomes a displacement on the camera's one permitted screen axis.
export class GridWalkNavigation {
  constructor({ host, surface = host, isEnabled, getOrientation, onPan, onHome, onSelect }, signal) {
    this.host = host;
    this.surface = surface;
    this.isEnabled = isEnabled;
    this.getOrientation = getOrientation;
    this.onPan = onPan;
    this.canvas = host.querySelector('canvas');
    this.originalAttributes = new Map(['tabindex', 'aria-label'].map((name) => [name, this.canvas.getAttribute(name)]));
    const options = { signal, capture: true };
    const isSceneTarget = (event) => event.target === host || host.contains?.(event.target) ||
      Boolean(event.target.closest?.('[data-grid-entry]'));
    surface.addEventListener('pointerdown', (event) => {
      if (!this.enabled || !isSceneTarget(event) || event.button !== 0 || this.gesture) return;
      this.suppressClick = false;
      this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
        entry: event.target.closest?.('[data-grid-entry]')?.dataset.gridEntry ?? null };
      surface.setPointerCapture(event.pointerId);
    }, options);
    surface.addEventListener('pointermove', (event) => {
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      // Native pointerup/cancel can be missed when a drag leaves the window.
      if (!this.enabled || event.buttons === 0) { this.cancel(); return; }
      const delta = this.horizontal ? event.clientX - gesture.x : event.clientY - gesture.y;
      if (!gesture.moved && Math.abs(delta) < 6) return;
      if (!delta) return;
      gesture.moved = true;
      host.dataset.gridDragging = 'true';
      this.onPan(delta);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    }, options);
    surface.addEventListener('pointerup', (event) => {
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      this.cancel();
      this.suppressClick = true;
      if (!gesture.moved && gesture.entry && this.enabled) onSelect(gesture.entry);
    }, options);
    surface.addEventListener('click', (event) => {
      if (!this.suppressClick) return;
      this.suppressClick = false;
      if (!this.enabled || !event.detail || (!isSceneTarget(event) && event.target !== surface)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, options);
    for (const name of ['pointercancel', 'lostpointercapture']) surface.addEventListener(name, () => this.cancel(), options);
    const document = host.ownerDocument;
    document?.defaultView?.addEventListener('blur', () => this.cancel(), { signal });
    document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.cancel();
    }, { signal });
    surface.addEventListener('wheel', (event) => {
      if (!this.enabled || !isSceneTarget(event) || !event.cancelable || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (this.horizontal ? host.clientWidth : host.clientHeight) : 1;
      // A wheel travels front to back in both compositions. A trackpad's
      // horizontal gesture is accepted only by a horizontal camera.
      const delta = this.horizontal ? Math.abs(event.deltaX) > Math.abs(event.deltaY) ? -event.deltaX : event.deltaY : -event.deltaY;
      if (!Number.isFinite(delta) || !delta || !this.onPan(delta * unit)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { ...options, passive: false });
    surface.addEventListener('keydown', (event) => {
      if (!this.enabled || !isSceneTarget(event) || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const keys = this.horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      if (event.key !== 'Home' && !keys.includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Home') onHome();
      else this.onPan(event.key === keys[0] ? 80 : -80);
    }, options);
  }

  get enabled() { return this.isEnabled(); }
  get horizontal() { return this.getOrientation() === 'horizontal'; }

  selectOnRelease(id, event) {
    event?.preventDefault?.();
    if (this.gesture) this.gesture.entry = id;
  }

  sync() {
    for (const [name, original] of this.originalAttributes) {
      const value = this.enabled ? name === 'tabindex' ? '0' : 'Starting grid. Drag, scroll or use arrow keys along the grid. Home returns to the selected entry.' : original;
      if (value == null) this.canvas.removeAttribute(name);
      else this.canvas.setAttribute(name, value);
    }
  }

  destroy() {
    this.cancel();
    for (const [name, original] of this.originalAttributes) {
      if (original == null) this.canvas.removeAttribute(name);
      else this.canvas.setAttribute(name, original);
    }
  }

  cancel() {
    const id = this.gesture?.id;
    this.gesture = null;
    delete this.host.dataset.gridDragging;
    if (id != null && this.surface.hasPointerCapture(id)) this.surface.releasePointerCapture(id);
  }
}
