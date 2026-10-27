import { createGridWalkMarkup } from '../../ui/gridWalkTemplate.js';
import { GridWalkSession } from './gridWalkSession.js';
import { gridWalkCameraFrame, gridWalkOrientation, projectGridPoint } from './gridWalkCamera.js';
import { GridWalkCrew } from './gridWalkCrew.js';
import { GridWalkNavigation } from './gridWalkNavigation.js';
import { queryRaceDataPanelBindings } from '../domBindings.js';
import { renderRaceData } from '../banners/raceDataBannerController.js';

export class GridWalkController {
  constructor(app) {
    this.app = app;
    this.session = new GridWalkSession(app.sim, app.options.gridWalk);
    this.abort = new AbortController();
    this.elapsed = 0;
    this.lastTime = performance.now();
    this.inspectedId = null;
    this.bannerOpen = true;
    this.coveredTowers = new Map();
    this.panel = app.canvasHost.closest('.sim-canvas-panel');
    const wrapper = app.canvasHost.ownerDocument.createElement('div');
    wrapper.innerHTML = createGridWalkMarkup(app.drivers, this.session.snapshot.cars);
    this.element = wrapper.firstElementChild;
    this.labels = [...this.element.querySelectorAll('[data-grid-entry]')];
    this.bannerReadouts = queryRaceDataPanelBindings(this.element);
    this.projectBanner = this.bannerReadouts.raceDataPanel;
    this.projectBanner.setAttribute('data-grid-project-banner', '');
    this.heading = this.bannerReadouts.raceDataTitle;
    this.heading.setAttribute('data-grid-heading', '');
    this.heading.setAttribute('tabindex', '-1');
    this.jump = this.element.querySelector('[data-grid-jump]');
    this.status = this.element.querySelector('[data-grid-status]');
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
      else if (target.hasAttribute('data-race-data-dismiss')) this.closeProjectBanner();
      else if (target.hasAttribute('data-grid-next')) this.move(1);
      else if (target.hasAttribute('data-grid-previous')) this.move(-1);
    }, options);
    this.jump.addEventListener('change', () => app.selectCar(this.jump.value, { focus: true }), options);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.projectBanner.hidden) {
        event.preventDefault();
        this.closeProjectBanner();
      }
    }, options);
    this.navigation = new GridWalkNavigation(this, this.abort.signal);
    this.crew = new GridWalkCrew(app.worldLayer, this.session.snapshot.cars);
    this.panel.appendChild(this.element);
  }

  get active() { return this.session.active; }
  get motion() { return this.app.options.gridWalk.ambientMotion && !this.media?.matches; }
  get needsAnimation() { return this.active && this.motion; }

  setView(view) {
    if (!this.session.setView(view, this.motion)) return false;
    this.navigation.cancel();
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
    this.navigation.center = null;
    this.bannerOpen = true;
    this.sync();
    if (focus) this.heading.focus({ preventScroll: true });
  }

  closeProjectBanner() {
    this.navigation.center = null;
    this.bannerOpen = false;
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
    this.navigation.sync();
    this.panel.dataset.gridWalkActive = String(this.active);
    this.element.dataset.view = session.view;
    this.element.querySelectorAll('[data-grid-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.gridView === session.view));
    });
    this.element.querySelectorAll('[data-grid-navigation]').forEach((node) => { node.hidden = !this.active || session.clearing; });
    this.element.querySelector('[data-grid-labels]').hidden = !this.active || session.clearing;
    this.projectBanner.hidden = !this.bannerOpen || !this.active || session.clearing;
    if (this.inspectedId !== app.selectedId) {
      this.inspectedId = app.selectedId;
      renderRaceData({ car: session.snapshot.cars.find((car) => car.id === app.selectedId),
        drivers: app.drivers, readouts: this.bannerReadouts, options: app.options,
        presentation: app.driverById.get(app.selectedId).presentation });
    }
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
      if (this.element.contains(node)) continue;
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
    this.element.dataset.controlsStacked = String(width < 600);
    this.projectBanner.classList.toggle('race-data-panel--standalone', width < 600);
    const bannerSize = this.projectBanner.hidden ? 0 : this.projectBanner.getBoundingClientRect().height + 16;
    const frame = gridWalkCameraFrame({ cars: this.session.snapshot.cars, selectedId: app.selectedId,
      width, height, orientation, bannerSize, center: this.navigation.center });
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
      (this.labels.find((label) => label.dataset.gridEntry === app.selectedId && !label.hidden) ?? this.jump).focus({ preventScroll: true });
    }
  }

  render() {
    const { app, session } = this;
    const screen = app.app?.renderer?.screen;
    if (!screen || screen.width !== Math.max(1, Math.round(app.canvasHost.clientWidth)) ||
      screen.height !== Math.max(1, Math.round(app.canvasHost.clientHeight))) app.resizeRendererToCanvasHost();
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
    // matches updates synchronously; a busy browser can defer the media event.
    // Stop at this frame as well, instead of animating until that event arrives.
    if (!this.motion) this.app.syncRuntimeTicker();
    this.crew.render({ active: true, motion: this.motion, elapsed: this.elapsed,
      clearing: this.session.clearing, clearProgress: Math.min(1, this.session.clearElapsed / 650) });
    return true;
  }

  destroy() {
    this.navigation.destroy();
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
