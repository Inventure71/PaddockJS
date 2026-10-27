import { createGridWalkInspectionMarkup, createGridWalkMarkup } from '../../ui/gridWalkTemplate.js';
import { GridWalkSession } from './gridWalkSession.js';
import { gridWalkCameraFrame, gridWalkOrientation, projectGridPoint } from './gridWalkCamera.js';
import { GridWalkCrew } from './gridWalkCrew.js';

export class GridWalkController {
  constructor(app) {
    this.app = app;
    this.session = new GridWalkSession(app.sim, app.options.gridWalk);
    this.abort = new AbortController();
    this.motionPaused = !app.options.gridWalk.ambientMotion;
    this.elapsed = 0;
    this.lastTime = performance.now();
    this.inspectedId = null;
    this.inspectionOpen = false;
    this.coveredTowers = new Map();
    this.panel = app.canvasHost.closest('.sim-canvas-panel');
    const wrapper = app.canvasHost.ownerDocument.createElement('div');
    wrapper.innerHTML = createGridWalkMarkup(app.drivers, this.session.snapshot.cars);
    this.element = wrapper.firstElementChild;
    this.labels = [...this.element.querySelectorAll('[data-grid-entry]')];
    this.inspector = this.element.querySelector('[data-grid-inspector]');
    this.detail = this.element.querySelector('[data-grid-detail]');
    this.jump = this.element.querySelector('[data-grid-jump]');
    this.status = this.element.querySelector('[data-grid-status]');
    this.motionButton = this.element.querySelector('[data-grid-motion]');
    this.media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const options = { signal: this.abort.signal };
    this.media?.addEventListener('change', () => {
      this.session.advance(0, this.motion);
      this.sync();
    }, options);
    this.element.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.gridView) this.setView(target.dataset.gridView);
      else if (target.dataset.gridEntry) app.selectCar(target.dataset.gridEntry, { focus: true });
      else if (target.hasAttribute('data-grid-close')) this.closeInspection();
      else if (target.hasAttribute('data-grid-motion')) {
        this.motionPaused = !this.motionPaused;
        this.session.advance(0, this.motion);
        this.sync();
      } else if (target.hasAttribute('data-grid-next')) this.move(1);
      else if (target.hasAttribute('data-grid-previous')) this.move(-1);
    }, options);
    this.jump.addEventListener('change', () => app.selectCar(this.jump.value, { focus: true }), options);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.inspector.hidden) {
        event.preventDefault();
        this.closeInspection();
      }
    }, options);
    this.crew = new GridWalkCrew(app.worldLayer, this.session.snapshot.cars);
    this.panel.appendChild(this.element);
  }

  get active() { return this.session.active; }
  get motion() { return !this.motionPaused && !this.media?.matches; }
  get needsAnimation() { return this.active && this.motion; }

  setView(view) {
    if (!this.session.setView(view, this.motion)) return false;
    // Preserve the fixed-step remainder; only discard time spent browsing.
    this.app.lastTime = this.lastTime = performance.now();
    if (view === 'race' && this.element.contains(this.element.ownerDocument.activeElement)) {
      this.element.querySelector('[data-grid-view="race"]').focus({ preventScroll: true });
    }
    this.sync();
    return true;
  }

  select(id, { focus = false } = {}) {
    if (!this.active || this.session.clearing || !this.app.driverById.has(id)) return;
    if (this.inspectedId !== id) {
      this.inspectedId = id;
      this.detail.innerHTML = createGridWalkInspectionMarkup(this.app.driverById.get(id).presentation);
    }
    this.inspectionOpen = true;
    this.sync();
    if (focus) this.detail.querySelector('[data-grid-heading]').focus({ preventScroll: true });
  }

  closeInspection() {
    this.inspectionOpen = false;
    this.sync();
    this.labels.find((label) => label.dataset.gridEntry === this.app.selectedId)?.focus({ preventScroll: true });
  }

  move(direction) {
    const cars = this.session.snapshot.cars;
    const index = cars.findIndex((car) => car.id === this.app.selectedId);
    const next = (index + direction + cars.length) % cars.length;
    this.app.selectCar(cars[next].id, { focus: true });
  }

  sync({ updateTicker = true } = {}) {
    const { app, session } = this;
    this.panel.dataset.gridWalkActive = String(this.active);
    this.element.dataset.view = session.view;
    this.element.querySelectorAll('[data-grid-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.gridView === session.view));
    });
    this.motionButton.hidden = !this.active;
    this.motionButton.disabled = Boolean(this.media?.matches);
    this.motionButton.textContent = this.media?.matches ? 'Reduced motion' : this.motionPaused ? 'Resume motion' : 'Pause motion';
    this.motionButton.setAttribute('aria-pressed', String(!this.motion));
    this.element.querySelector('[data-grid-navigation]').hidden = !this.active || session.clearing;
    this.element.querySelector('[data-grid-labels]').hidden = !this.active || session.clearing;
    this.inspector.hidden = !this.inspectionOpen || !this.active || session.clearing;
    for (const layer of [app.trailLayer, app.sensorLayer, app.pitLaneStatusLayer]) {
      if (layer) layer.visible = !this.active;
    }
    this.syncCoveredTowers();
    if (!this.active) app.syncTimingPanelDisclosureState();
    this.jump.value = app.selectedId;
    const status = session.clearing ? 'Crew clearing the grid' : session.view === 'grid-walk'
      ? session.hasRaced ? 'Race paused · original starting grid' : 'Explore the starting grid'
      : session.hasRaced ? 'Race in progress' : '';
    if (this.status.textContent !== status) this.status.textContent = status;
    if (this.active) this.render();
    else {
      this.crew.container.visible = false;
      app.syncRendererToCurrentLayout({ render: true });
    }
    if (updateTicker) app.syncRuntimeTicker();
  }

  syncCoveredTowers() {
    const canvas = this.app.canvasHost.getBoundingClientRect();
    for (const tower of this.app.root.querySelectorAll('[data-timing-tower]')) {
      const rect = tower.getBoundingClientRect();
      const covered = this.active && rect.width > 0 && rect.height > 0 &&
        rect.right > canvas.left && rect.left < canvas.right && rect.bottom > canvas.top && rect.top < canvas.bottom;
      if (covered && !this.coveredTowers.has(tower)) {
        this.coveredTowers.set(tower, tower.hasAttribute('inert'));
        tower.classList.add('is-grid-walk-covered');
        tower.setAttribute('inert', '');
      } else if (!covered && this.coveredTowers.has(tower)) {
        tower.classList.remove('is-grid-walk-covered');
        if (!this.coveredTowers.get(tower)) tower.removeAttribute('inert');
        this.coveredTowers.delete(tower);
      }
      if (covered && !tower.hasAttribute('inert')) tower.setAttribute('inert', '');
    }
  }

  positionRaceToolbar() {
    const toolbar = this.element.querySelector('.grid-walk__toolbar');
    if (this.active) {
      if (toolbar.style.left) toolbar.style.removeProperty('left');
      if (toolbar.style.top) toolbar.style.removeProperty('top');
      return;
    }
    const canvas = this.app.canvasHost.getBoundingClientRect();
    const width = this.element.querySelector('.grid-walk__modes').offsetWidth;
    const tower = [...this.app.root.querySelectorAll('[data-timing-tower]')]
      .map((node) => node.getBoundingClientRect())
      .find((rect) => rect.width > 0 && rect.right > canvas.left && rect.left < canvas.right && rect.bottom > canvas.top && rect.top < canvas.bottom);
    let left = 12;
    let top = 12;
    if (tower?.width > 0 && tower.right - canvas.left + width + 24 < canvas.width) {
      left = tower.right - canvas.left + 12;
    }
    for (const node of this.panel.querySelectorAll('.camera-controls, .timing-panel-toggle, .fps-counter')) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.right > canvas.left + left && rect.left < canvas.left + left + width &&
        rect.bottom > canvas.top + top && rect.top < canvas.top + top + 44) {
        top = rect.bottom - canvas.top + 8;
      }
    }
    if (toolbar.style.left !== `${left}px`) toolbar.style.left = `${left}px`;
    if (toolbar.style.top !== `${top}px`) toolbar.style.top = `${top}px`;
  }

  applyCamera() {
    const { app } = this;
    this.syncCoveredTowers();
    this.positionRaceToolbar();
    const width = app.canvasHost.clientWidth;
    const height = app.canvasHost.clientHeight;
    if (!(width > 0 && height > 0)) return;
    const orientation = gridWalkOrientation(width, height, this.orientation);
    if (this.orientation !== orientation) {
      this.orientation = orientation;
      this.element.dataset.orientation = orientation;
    }
    const inspectorRect = this.inspector.hidden ? null : this.inspector.getBoundingClientRect();
    const inspectorSize = inspectorRect ? (orientation === 'horizontal' ? inspectorRect.width + 16 : inspectorRect.height + 12) : 0;
    const frame = gridWalkCameraFrame({ cars: this.session.snapshot.cars, selectedId: app.selectedId,
      width, height, orientation, inspectorSize });
    app.worldLayer.rotation = frame.rotation;
    app.worldLayer.scale.set(frame.scale);
    app.worldLayer.position.set(frame.x, frame.y);
    this.frame = frame;
    const focusedLabel = this.labels.find((label) => label === this.element.ownerDocument.activeElement);
    for (const label of this.labels) {
      const id = label.dataset.gridEntry;
      label.hidden = !frame.visibleIds.includes(id);
      label.setAttribute('aria-pressed', String(id === app.selectedId));
      if (label.hidden) continue;
      const car = this.session.snapshot.cars.find((entry) => entry.id === id);
      const point = projectGridPoint(frame, car);
      const side = Number(label.dataset.gridSide) ? 1 : -1;
      const labelWidth = label.offsetWidth;
      const labelHeight = label.offsetHeight;
      const leftInset = orientation === 'horizontal' ? labelWidth / 2 : side < 0 ? labelWidth : 0;
      const rightInset = labelWidth - leftInset;
      const x = Math.max(frame.area.left + leftInset, Math.min(frame.area.right - rightInset,
        point.x + (orientation === 'vertical' ? side * 29 : 0)));
      const y = Math.max(frame.area.top + labelHeight / 2, Math.min(frame.area.bottom - labelHeight / 2,
        point.y + (orientation === 'horizontal' ? side * 55 : 0)));
      const transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      if (label.style.transform !== transform) label.style.transform = transform;
    }
    if (focusedLabel?.hidden) {
      this.labels.find((label) => label.dataset.gridEntry === app.selectedId)?.focus({ preventScroll: true });
    }
  }

  render() {
    const { app, session } = this;
    app.resizeRendererToCanvasHost();
    this.applyCamera();
    app.renderCars(session.snapshot);
    this.crew.render({ active: this.active, motion: this.motion, elapsed: this.elapsed,
      clearing: session.clearing, clearProgress: Math.min(1, session.clearElapsed / 650) });
    app.app?.render?.();
  }

  tick(now) {
    if (!this.active) return false;
    const elapsed = Math.max(0, Math.min(now - this.lastTime, 100));
    this.lastTime = now;
    this.elapsed += elapsed;
    const wasClearing = this.session.clearing;
    this.session.advance(elapsed, this.motion);
    if (wasClearing && !this.session.clearing) this.sync();
    if (!this.active) return false;
    this.crew.render({ active: true, motion: this.motion, elapsed: this.elapsed,
      clearing: this.session.clearing, clearProgress: Math.min(1, this.session.clearElapsed / 650) });
    return true;
  }

  destroy() {
    this.abort.abort();
    try { this.crew.destroy(); } finally {
      this.element.remove();
      delete this.panel.dataset.gridWalkActive;
      for (const layer of [this.app.trailLayer, this.app.sensorLayer, this.app.pitLaneStatusLayer]) {
        if (layer) layer.visible = true;
      }
      for (const [tower, wasInert] of this.coveredTowers) {
        tower.classList.remove('is-grid-walk-covered');
        if (!wasInert) tower.removeAttribute('inert');
      }
      this.coveredTowers.clear();
    }
  }
}
