import { createGridWalkMarkup } from '../../ui/gridWalkTemplate.js';
import { GridWalkSession } from './gridWalkSession.js';
import { GridWalkCamera, gridWalkOrientation } from './gridWalkCamera.js';
import { GridWalkCrew } from './gridWalkCrew.js';
import { GridWalkNavigation } from './gridWalkNavigation.js';
import { GridWalkControls } from './gridWalkControls.js';
import { GridWalkLabels } from './gridWalkLabels.js';
import { GridWalkProjectBanner } from './gridWalkProjectBanner.js';
import { GridWalkLayout } from './gridWalkLayout.js';
import { SimulatorViewControls } from '../controls/SimulatorViewControls.js';

// Coordinates lifecycle and scene presentation. Each UI/input component owns
// its own actions and geometry; none owns or steps the simulation.
export class GridWalkController {
  constructor(app) {
    this.app = app;
    this.session = new GridWalkSession(app.sim, app.options.gridWalk);
    this.abort = new AbortController();
    this.elapsed = 0;
    this.lastTime = performance.now();
    this.panel = app.canvasHost.closest('.sim-canvas-panel');
    const wrapper = app.canvasHost.ownerDocument.createElement('div');
    const cars = this.session.snapshot.cars;
    wrapper.innerHTML = createGridWalkMarkup(app.drivers, cars, app.options.ui);
    this.element = wrapper.firstElementChild;
    const select = (id) => app.selectCar(id, { focus: true });
    const { signal } = this.abort;
    this.viewControls = new SimulatorViewControls(app.root, (view) => this.setView(view), signal);
    this.controls = new GridWalkControls(this.element, {
      onSelect: select, onMove: (direction) => this.move(direction),
    }, signal);
    this.labels = new GridWalkLabels(this.element, cars, select, signal);
    this.labelGroup = this.element.querySelector('[data-grid-labels]');
    this.sceneLabels = app.canvasHost.ownerDocument.createElement('div');
    this.sceneLabels.className = 'grid-walk';
    this.sceneLabels.appendChild(this.labelGroup);
    app.sceneScroll.surface.viewport.appendChild(this.sceneLabels);
    this.banner = new GridWalkProjectBanner(this.element, () => this.closeProjectBanner(), signal, this.panel);
    this.camera = new GridWalkCamera(cars);
    this.layout = new GridWalkLayout({ element: this.element, panel: this.panel, canvasHost: app.canvasHost, root: app.root });
    this.navigation = new GridWalkNavigation({ host: app.canvasHost, surface: this.panel,
      isEnabled: () => this.active && !this.session.clearing,
      getOrientation: () => this.orientation,
      onPan: (delta) => {
        if (!this.camera.pan(delta)) return false;
        this.render();
        return true;
      },
      onHome: () => { this.camera.focus(app.selectedId); this.render(); }, onSelect: select,
    }, signal);
    this.media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.media?.addEventListener('change', () => {
      this.session.advance(0, this.motion);
      this.sync();
    }, { signal });
    this.crew = new GridWalkCrew(app.worldLayer, cars);
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
    const focused = this.element.ownerDocument.activeElement;
    if (view === 'race' && (this.element.contains(focused) || this.sceneLabels.contains(focused)) && !this.viewControls.focusRace()) {
      this.app.canvasHost.querySelector('canvas').focus({ preventScroll: true });
    }
    this.sync();
    return true;
  }

  select(id, { focus = false } = {}) {
    if (!this.active || this.session.clearing || !this.app.driverById.has(id)) return;
    // A visible car stays where it was clicked. The selector can bring an
    // offscreen entry into view without resetting the camera on every click.
    if (!this.labels.isVisible(id)) this.camera.focus(id);
    this.banner.open = true;
    this.sync();
    if (focus) {
      if (!this.banner.element.hidden) this.banner.focus();
      else this.labels.focus(id, this.controls.jump);
    }
  }

  closeProjectBanner() {
    this.banner.open = false;
    this.sync();
    this.labels.focus(this.app.selectedId, this.controls.jump);
  }

  move(direction) {
    const cars = this.session.snapshot.cars;
    const index = cars.findIndex((car) => car.id === this.app.selectedId);
    this.app.selectCar(cars[(index + direction + cars.length) % cars.length].id, { focus: true });
  }

  sync({ updateTicker = true } = {}) {
    const { app, session } = this;
    this.navigation.sync();
    this.panel.dataset.gridWalkActive = String(this.active);
    this.element.dataset.view = session.view;
    this.controls.update(session, app.selectedId);
    this.viewControls.update(session.view, app.options.ui.viewControls);
    this.labelGroup.hidden = !this.active || session.clearing;
    this.banner.update({ active: this.active, clearing: session.clearing,
      enabled: app.isRaceDataBannerEnabled('project'), car: session.snapshot.cars.find((car) => car.id === app.selectedId),
      drivers: app.drivers, options: app.options, presentation: app.driverById.get(app.selectedId).presentation });
    for (const layer of [app.trailLayer, app.sensorLayer, app.pitLaneStatusLayer]) if (layer) layer.visible = !this.active;
    this.syncLayout();
    if (!this.active) app.syncTimingPanelDisclosureState();
    if (this.active) this.render();
    else {
      this.crew.container.visible = false;
      app.sceneScroll.sync();
      app.syncRendererToCurrentLayout({ render: true });
    }
    if (updateTicker) app.syncRuntimeTicker();
  }

  syncLayout() { this.layout.update(this.active); }

  applyCamera() {
    const { app } = this;
    this.syncLayout();
    const width = app.canvasHost.clientWidth;
    const height = app.canvasHost.clientHeight;
    if (!(width > 0 && height > 0)) return;
    const orientation = gridWalkOrientation(width, height, this.orientation);
    if (this.orientation && orientation !== this.orientation) this.navigation.cancel();
    this.orientation = orientation;
    this.element.dataset.orientation = this.orientation;
    this.element.dataset.compactControls = String(width < 600 && height < 420);
    const area = this.layout.measure(this.banner.measure(width, height));
    this.element.dataset.compactLabels = String(area.bottom - area.top < 164);
    this.sceneLabels.dataset.compactLabels = this.element.dataset.compactLabels;
    this.frame = this.camera.update({ selectedId: app.selectedId, width, height, orientation: this.orientation, area });
    this.crew.updateCamera(this.frame, width, height);
    app.worldLayer.rotation = this.frame.rotation;
    app.worldLayer.scale.set(this.frame.scale);
    app.worldLayer.position.set(this.frame.x, this.frame.y);
    this.labels.update(this.frame, app.selectedId, this.controls.jump);
    app.sceneScroll.sync();
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
    // A busy browser can defer the media callback; stop on this frame too.
    if (!this.motion) this.app.syncRuntimeTicker();
    this.crew.render({ active: true, motion: this.motion, elapsed: this.elapsed,
      clearing: this.session.clearing, clearProgress: Math.min(1, this.session.clearElapsed / 650) });
    return true;
  }

  destroy() {
    this.navigation.destroy();
    this.viewControls.destroy();
    this.abort.abort();
    try { this.crew.destroy(); } finally {
      this.layout.destroy();
      this.element.remove();
      this.sceneLabels.remove();
      delete this.panel.dataset.gridWalkActive;
      for (const layer of [this.app.trailLayer, this.app.sensorLayer, this.app.pitLaneStatusLayer]) if (layer) layer.visible = true;
    }
  }
}
