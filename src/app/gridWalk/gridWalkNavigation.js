import { panGridWalkCenter } from './gridWalkCamera.js';

// Grid Walk owns its camera gestures; race wheel zoom remains independent.
export class GridWalkNavigation {
  constructor(controller, signal) {
    this.controller = controller;
    this.host = controller.app.canvasHost;
    this.center = null;
    this.canvas = this.host.querySelector('canvas');
    this.originalAttributes = new Map(['tabindex', 'aria-label'].map((name) => [name, this.canvas.getAttribute(name)]));
    const options = { signal, capture: true };
    this.host.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.button !== 0 || this.gesture) return;
      this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, entry: null };
      this.host.setPointerCapture(event.pointerId);
    }, options);
    this.host.addEventListener('pointermove', (event) => {
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
      gesture.moved = true;
      this.host.dataset.gridDragging = 'true';
      this.pan(controller.orientation === 'horizontal' ? dx : 0, controller.orientation === 'vertical' ? dy : 0);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    }, options);
    this.host.addEventListener('pointerup', (event) => {
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      this.cancel();
      if (!gesture.moved && gesture.entry && this.enabled) controller.app.selectCar(gesture.entry, { focus: true });
    }, options);
    for (const name of ['pointercancel', 'lostpointercapture']) {
      this.host.addEventListener(name, () => this.cancel(), options);
    }
    this.host.addEventListener('wheel', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.host.clientHeight : 1;
      const x = event.deltaX * unit;
      const y = event.deltaY * unit;
      // A vertical wheel travels front to back in either camera orientation.
      if (controller.orientation === 'horizontal') this.pan(Math.abs(x) > Math.abs(y) ? -x : y, 0);
      else this.pan(-x, -y);
    }, { ...options, passive: false });
    this.host.addEventListener('keydown', (event) => {
      if (!this.enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') { this.center = null; controller.render(); }
      else this.pan(event.key === 'ArrowLeft' ? 80 : event.key === 'ArrowRight' ? -80 : 0,
        event.key === 'ArrowUp' ? 80 : event.key === 'ArrowDown' ? -80 : 0);
    }, options);
  }

  get enabled() { return this.controller.active && !this.controller.session.clearing; }

  pan(x, y) {
    if (!this.enabled || !this.controller.frame) return;
    this.center = panGridWalkCenter(this.controller.frame, x, y);
    this.controller.render();
    this.center = this.controller.frame.center;
  }

  selectOnRelease(id, event) {
    event?.preventDefault?.();
    if (this.gesture) this.gesture.entry = id;
  }

  sync() {
    for (const [name, original] of this.originalAttributes) {
      const value = this.enabled ? name === 'tabindex' ? '0' : 'Starting grid. Drag, scroll or use arrow keys to explore. Home returns to the selected entry.' : original;
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
    if (id != null && this.host.hasPointerCapture(id)) this.host.releasePointerCapture(id);
  }
}
