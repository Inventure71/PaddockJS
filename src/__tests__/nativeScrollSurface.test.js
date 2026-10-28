import { describe, expect, test } from 'vitest';
import { NativeScrollSurface } from '../app/controls/NativeScrollSurface.js';
import { SceneScrollController } from '../app/controls/SceneScrollController.js';
import { GridWalkCamera } from '../app/gridWalk/gridWalkCamera.js';
import { CAMERA_MAX_ZOOM, CAMERA_MIN_ZOOM, CAMERA_ZOOM_STEP } from '../app/camera/cameraConstants.js';

// These tests cover ownership, feedback and camera state. Native overflow,
// gesture handoff and fixed canvas geometry are exercised in browser smoke.
class Node extends EventTarget {
  constructor() {
    super();
    this.childNodes = [];
    this.dataset = {};
    const styles = new Map();
    this.style = { getPropertyValue: (name) => styles.get(name)?.[0] ?? '',
      getPropertyPriority: (name) => styles.get(name)?.[1] ?? '',
      setProperty: (name, value, priority = '') => styles.set(name, [value, priority]),
      removeProperty: (name) => styles.delete(name) };
    this.ownerDocument = new EventTarget();
    this.ownerDocument.createElement = () => new Node();
    this.ownerDocument.defaultView = new EventTarget();
    this.clientWidth = 640;
    this.clientHeight = 480;
    this.scrollLeft = this.scrollTop = 0;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    const index = parent.childNodes.indexOf(this);
    this.parentNode = null;
    parent.childNodes.splice(index, 1, ...nodes);
    for (const node of nodes) node.parentNode = parent;
    this.childNodes = [];
  }
}

describe('browser-owned scroll surface', () => {
  test('resize clamping never becomes camera input and fractional endpoints reach native limits', () => {
    const host = new Node(), calls = [];
    const surface = new NativeScrollSurface(host, (delta) => calls.push(delta));
    surface.sync({ x: 442, y: 44, maxX: 486.5, maxY: 486.5 });
    host.clientWidth = 1118;
    host.scrollLeft = 0; // Browser clamps the old content before ResizeObserver.
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toEqual([]);
    surface.sync({ x: 1451, y: 145, maxX: 1596.47, maxY: 1596.47 });
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toEqual([]);
    surface.sync({ y: 1596.47, maxY: 1596.47 });
    expect(host.scrollTop).toBe(1597);
    expect(surface.content.style.height).toBe(`${host.clientHeight + 1597}px`);
    surface.destroy();
    host.scrollTop = 20;
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toEqual([]);
  });

  test('browser modifiers release native input and interrupted input recovers on blur or hiding', () => {
    const host = new Node(), surface = new NativeScrollSurface(host, () => {});
    surface.sync({ maxY: 1000, y: 500 });
    host.ownerDocument.dispatchEvent(Object.assign(new Event('keydown'), { metaKey: true }));
    expect(host.style.getPropertyValue('overflow')).toBe('hidden');
    host.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
    expect(host.style.getPropertyValue('overflow')).toBe('auto');
    host.dispatchEvent(new Event('touchstart'));
    host.ownerDocument.visibilityState = 'hidden';
    host.ownerDocument.dispatchEvent(new Event('visibilitychange'));
    expect(host.style.getPropertyValue('overflow')).toBe('auto');
    surface.destroy();
  });

  test('native displacement commands once; selection/layout sync never feeds back, and abort restores the host', () => {
    const host = new Node(), canvas = new Node(), abort = new AbortController(), calls = [];
    host.style.setProperty('overflow', 'clip', 'important');
    host.append(canvas);
    const surface = new NativeScrollSurface(host, (delta) => calls.push(delta), abort.signal);
    surface.sync({ maxY: 1000, y: 400 });
    expect(surface.viewport.childNodes).toEqual([canvas]);
    expect(surface.viewport.style.height).toBe('480px');
    expect(surface.content.style.height).toBe('1480px');
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toEqual([]);
    host.scrollTop += 75;
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toEqual([{ x: 0, y: 475, dx: 0, dy: 75 }]);
    surface.sync({ enabled: false });
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toHaveLength(1);
    abort.abort();
    expect(host.childNodes).toEqual([canvas]);
    expect(host.style.getPropertyValue('overflow')).toBe('clip');
    expect(host.style.getPropertyPriority('overflow')).toBe('important');
    expect(host.style.getPropertyValue('scrollbar-width')).toBe('');
    expect(host.scrollTop).toBe(0);
    host.scrollTop = 80;
    host.dispatchEvent(new Event('scroll'));
    expect(calls).toHaveLength(1);
  });

  test('touch input releases the scroll surface and restores it after the final touch', () => {
    const host = new Node(), abort = new AbortController();
    const surface = new NativeScrollSurface(host, () => { throw new Error('Touch must not zoom'); }, abort.signal);
    surface.sync({ maxY: 1000, y: 500 });
    host.dispatchEvent(new Event('touchstart'));
    expect(host.style.getPropertyValue('overflow')).toBe('hidden');
    host.scrollTop += 20;
    host.dispatchEvent(new Event('scroll'));
    host.dispatchEvent(Object.assign(new Event('touchend'), { touches: [{}] }));
    expect(host.style.getPropertyValue('overflow')).toBe('hidden');
    host.dispatchEvent(Object.assign(new Event('touchcancel'), { touches: [] }));
    expect(host.style.getPropertyValue('overflow')).toBe('auto');
    abort.abort();
  });
});

test('native scrolling shares the existing grid camera, preserves positions across resize/modes, and restores bounded race zoom', () => {
  const host = new Node(), abort = new AbortController();
  const camera = new GridWalkCamera([{ id: 'a', x: 100, y: -30, heading: 0 }, { id: 'b', x: 500, y: 30, heading: 0 }]);
  const grid = { active: true, session: { clearing: false }, camera, orientation: 'horizontal' };
  const app = { canvasHost: host, gridWalk: grid, camera: { zoom: 18 },
    adjustCameraZoom(steps) {
      this.camera.zoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, this.camera.zoom + steps * CAMERA_ZOOM_STEP));
      scene.sync();
    } };
  const scene = new SceneScrollController(app, abort.signal);
  grid.render = () => {
    grid.frame = camera.update({ selectedId: 'b', width: host.clientWidth, height: host.clientHeight, orientation: grid.orientation });
    scene.sync();
  };
  grid.render();
  const initial = camera.position;
  host.scrollTop += 40;
  host.dispatchEvent(new Event('scroll'));
  expect(camera.position).toBeLessThan(initial);
  const browsed = camera.position;
  grid.orientation = 'vertical';
  host.clientWidth = 340;
  host.clientHeight = 700;
  grid.render();
  host.dispatchEvent(new Event('scroll'));
  expect(camera.position).toBe(browsed);
  host.scrollTop += 30;
  host.dispatchEvent(new Event('scroll'));
  expect(camera.position).toBeLessThan(browsed);
  const vertical = camera.position;
  grid.active = false;
  scene.sync();
  host.dispatchEvent(new Event('scroll'));
  expect(app.camera.zoom).toBe(18);
  host.scrollTop += 100;
  host.dispatchEvent(new Event('scroll'));
  expect(app.camera.zoom).toBeCloseTo(16.6);
  expect(camera.position).toBe(vertical);
  grid.active = true;
  grid.render();
  host.dispatchEvent(new Event('scroll'));
  expect(camera.position).toBe(vertical);
  expect(app.camera.zoom).toBeCloseTo(16.6);
  grid.session.clearing = true;
  scene.sync();
  expect(host.style.getPropertyValue('overflow')).toBe('hidden');
  abort.abort();
});
