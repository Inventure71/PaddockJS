import { afterEach, describe, expect, test, vi } from 'vitest';
import { bindCameraWheelControls, bindWorkbenchControls } from '../app/controls/workbenchBindings.js';
import { querySimulatorDom } from '../app/domBindings.js';
import { getOverviewFields, renderCarDriverOverview } from '../app/readouts/carOverviewRenderer.js';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';
import { HostLifecycleEmitter } from '../app/HostLifecycleEmitter.js';

class Node extends EventTarget {
  constructor() { super(); this.attributes = new Map(); this.dataset = {}; this.textContent = '--'; this.hidden = false;
    this.style = { setProperty: vi.fn() }; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  closest() { return this; }
}
afterEach(() => vi.unstubAllGlobals());
function bindings(extra = {}) { return { safetyButtons: [], cameraButtons: [], overviewModeButtons: [], timingGapModeButtons: [], ...extra }; }
function commands(extra = {}) { return { updateSimulationSpeedControls() {}, ...extra }; }

describe('Workbench actions shared by composed surfaces', () => {
  test('timing buttons activate from native click, including keyboard-generated clicks, once per action', () => {
    vi.stubGlobal('Element', Node);
    const list = new Node();
    const selectCar = vi.fn();
    bindWorkbenchControls(bindings({ timingLists: [list] }), commands({ selectCar }));
    list.dataset.driverId = 'alpha';
    list.dispatchEvent(new Event('pointerdown'));
    expect(selectCar).not.toHaveBeenCalled();
    list.dispatchEvent(new Event('click')); // Native keyboard activation produces the same click.
    expect(selectCar).toHaveBeenCalledExactlyOnceWith('alpha');
  });

  test('each restart and zoom control invokes the same command and disposes with its owner', () => {
    const restart = [new Node(), new Node()], zoomIn = [new Node(), new Node()], zoomOut = [new Node(), new Node()];
    const restartAction = vi.fn(), zoomAction = vi.fn();
    const abort = new AbortController();
    bindWorkbenchControls(bindings({ restartButtons: restart, zoomInButtons: zoomIn, zoomOutButtons: zoomOut }),
      commands({ restart: restartAction, adjustCameraZoom: zoomAction }), abort.signal);
    for (const node of [...restart, ...zoomIn, ...zoomOut]) node.dispatchEvent(new Event('click'));
    expect(restartAction).toHaveBeenCalledTimes(2);
    expect(zoomAction.mock.calls).toEqual([[1], [1], [-1], [-1]]);
    abort.abort();
    restart[0].dispatchEvent(new Event('click'));
    expect(restartAction).toHaveBeenCalledTimes(2);
  });

  test('wheel zoom ignores horizontal-only, no-op and invalid events', () => {
    const host = new Node(), zoom = vi.fn(() => true);
    bindCameraWheelControls(host, zoom);
    for (const [x, y] of [[90, 0], [0, 0], [0, NaN], [20, -4], [20, 4]]) {
      const event = new Event('wheel', { cancelable: true });
      Object.assign(event, { deltaX: x, deltaY: y });
      host.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(Number.isFinite(y) && y !== 0);
    }
    expect(zoom.mock.calls).toEqual([[1], [-1]]);
  });

  test('wheel releases page scrolling when zoom cannot change and disposes with its owner', () => {
    const host = new Node(), zoom = vi.fn(() => false), abort = new AbortController();
    bindCameraWheelControls(host, zoom, { signal: abort.signal });
    const wheel = () => Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 120 });
    expect(host.dispatchEvent(wheel())).toBe(true);
    zoom.mockReturnValue(true);
    expect(host.dispatchEvent(wheel())).toBe(false);
    const owned = wheel(); owned.preventDefault();
    host.dispatchEvent(owned);
    host.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 120 }));
    expect(zoom).toHaveBeenCalledTimes(2);
    abort.abort();
    expect(host.dispatchEvent(wheel())).toBe(true);
    expect(zoom).toHaveBeenCalledTimes(2);
  });

  test('Open project uses the same callback isolation and onError contract as selection', () => {
    const open = new Node();
    const driver = { id: 'alpha' }, failure = new Error('Host navigation failed');
    const options = { onDriverOpen() { throw failure; }, onError: vi.fn() };
    const app = { abortController: new AbortController(), driverById: new Map([['alpha', driver]]),
      selectedId: 'alpha', readouts: { raceDataOpens: [open] }, ...bindings(), options,
      updateSimulationSpeedControls() {}, bindCameraWheelControls() {},
      emitHostCallback: F1SimulatorApp.prototype.emitHostCallback,
      hostLifecycle: new HostLifecycleEmitter(() => options) };
    F1SimulatorApp.prototype.bindControls.call(app);
    open.dispatchEvent(new Event('click'));
    expect(options.onError).toHaveBeenCalledWith(failure, { callback: 'onDriverOpen' });
  });
});

function overview() {
  const nodes = Object.fromEntries(['title', 'code', 'icon', 'image', 'number', 'core-stat'].map((key) => [`[data-car-overview-${key}]`, new Node()]));
  nodes['.car-overview-diagram'] = new Node();
  const fields = Array.from({ length: 7 }, () => {
    const field = new Node();
    field.label = new Node(); field.value = new Node();
    field.querySelector = (selector) => selector === '[data-overview-field-label]' ? field.label : field.value;
    return field;
  });
  const panel = new Node();
  panel.querySelector = (selector) => nodes[selector] ?? null;
  panel.querySelectorAll = () => fields;
  return { panel, fields, nodes };
}

test('two overview components independently render fields, identity and mode changes', () => {
  const surfaces = [overview(), overview()];
  const root = {
    querySelectorAll: (selector) => selector === '[data-paddock-component="car-driver-overview"]' ? surfaces.map((surface) => surface.panel)
      : selector === '[data-overview-field]' ? surfaces.flatMap((surface) => surface.fields) : [],
    querySelector: (selector) => selector === '[data-paddock-component="car-driver-overview"]' ? surfaces[0].panel : surfaces[0].nodes[selector] ?? null,
  };
  const readouts = querySimulatorDom(root).readouts;
  const input = { readouts, car: { id: 'alpha', code: 'ALP', color: '#123456', driverNumber: 71 },
    driverById: new Map([['alpha', { driverImage: '/portrait.png', vehicle: { name: 'Alpha Car' } }]]),
    assets: { carOverview: '/car.png' }, overviewMode: 'vehicle' };
  renderCarDriverOverview(input);
  for (const surface of surfaces) {
    expect(surface.fields[0].label.textContent).toBe('Power');
    expect(surface.fields.slice(0, 6).every((field) => !field.hidden)).toBe(true);
    expect(surface.nodes['[data-car-overview-code]'].textContent).toBe('Alpha Car');
    expect(surface.nodes['[data-car-overview-image]'].src).toBe('/car.png');
  }
  renderCarDriverOverview({ ...input, overviewMode: 'driver' });
  for (const surface of surfaces) {
    expect(surface.fields[0].label.textContent).toBe('Pace');
    expect(surface.nodes['[data-car-overview-title]'].textContent).toBe('Driver overview');
    expect(surface.nodes['[data-car-overview-image]'].src).toBe('/portrait.png');
  }
});

test.each([
  [{ Role: 'Engineer' }, [{ label: 'Home', value: 'Madrid' }]],
  [[{ label: 'Role', value: 'Engineer' }], { Home: 'Madrid' }],
])('driver overview accepts both documented custom-field forms at each source', (customFields, constructorFields) => {
  const fields = getOverviewFields({ customFields, constructorArgs: { driver: { customFields: constructorFields } } }, 'driver');
  expect(fields.slice(-2)).toEqual([{ label: 'Home', value: 'Madrid' }, { label: 'Role', value: 'Engineer' }]);
});
