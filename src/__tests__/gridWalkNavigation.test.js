import { describe, expect, test, vi } from 'vitest';
import { GridWalkNavigation } from '../app/gridWalk/gridWalkNavigation.js';
import { bindCameraWheelControls } from '../app/controls/workbenchBindings.js';

function wheel(values = {}) {
  return Object.assign(new Event('wheel', { cancelable: true }), { deltaX: 0, deltaY: 100, deltaMode: 0, ...values });
}

function navigation({ moving = true, active = true } = {}) {
  const host = new EventTarget();
  host.querySelector = () => ({ getAttribute: () => null });
  const onPan = vi.fn(() => moving);
  const zoom = vi.fn();
  const abort = new AbortController();
  new GridWalkNavigation({ host, isEnabled: () => active, getOrientation: () => 'vertical', onPan }, abort.signal);
  bindCameraWheelControls(host, zoom, { signal: abort.signal }, () => !active);
  return { host, onPan, zoom, abort };
}

function dragNavigation() {
  const host = new EventTarget();
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  document.visibilityState = 'visible';
  host.ownerDocument = document;
  host.dataset = {};
  host.querySelector = () => ({ getAttribute: () => null, removeAttribute() {} });
  const captured = new Set();
  host.setPointerCapture = (id) => captured.add(id);
  host.hasPointerCapture = (id) => captured.has(id);
  host.releasePointerCapture = (id) => captured.delete(id);
  const onPan = vi.fn();
  const onSelect = vi.fn();
  const abort = new AbortController();
  const input = new GridWalkNavigation({ host, isEnabled: () => true, getOrientation: () => 'horizontal', onPan, onSelect }, abort.signal);
  const pointer = (type, values = {}) => host.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 7, button: 0, buttons: 1, clientX: 0, clientY: 0, ...values,
  }));
  return { host, document, input, onPan, onSelect, abort, pointer };
}

describe('interrupted grid dragging', () => {
  test.each(['blur', 'hidden', 'released button'])('releases capture on %s and permits a fresh drag', (interruption) => {
    const { host, document, input, onPan, onSelect, abort, pointer } = dragNavigation();
    pointer('pointerdown');
    pointer('pointermove', { clientX: 20 });
    expect(onPan).toHaveBeenCalledWith(20);
    expect(host.hasPointerCapture(7)).toBe(true);
    if (interruption === 'blur') document.defaultView.dispatchEvent(new Event('blur'));
    else if (interruption === 'hidden') {
      document.visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    } else pointer('pointermove', { clientX: 40, buttons: 0 });
    expect(host.hasPointerCapture(7)).toBe(false);
    expect(host.dataset.gridDragging).toBeUndefined();
    pointer('pointermove', { clientX: 80, buttons: 0 });
    pointer('pointerup', { clientX: 80, buttons: 0 });
    expect(onPan).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    document.visibilityState = 'visible';
    pointer('pointerdown');
    pointer('pointermove', { clientX: 30 });
    expect(onPan).toHaveBeenLastCalledWith(30);
    input.destroy();
    abort.abort();
    expect(host.hasPointerCapture(7)).toBe(false);
  });

  test('unrelated pointer movement and a visible-document event do not interrupt the active drag', () => {
    const { document, input, host, onPan, abort, pointer } = dragNavigation();
    pointer('pointerdown');
    pointer('pointermove', { pointerId: 8, buttons: 0, clientX: 50 });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(host.hasPointerCapture(7)).toBe(true);
    pointer('pointermove', { clientX: 40 });
    expect(onPan).toHaveBeenCalledWith(40);
    input.destroy();
    abort.abort();
  });
});

describe('simulator wheel ownership', () => {
  test.each([[true, 'ctrlKey'], [true, 'metaKey'], [false, 'ctrlKey'], [false, 'metaKey']])('preserves browser zoom (Grid Walk %s, %s)', (active, modifier) => {
    const { host, onPan, zoom, abort } = navigation({ active });
    const event = wheel({ [modifier]: true });
    expect(host.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(onPan).not.toHaveBeenCalled();
    expect(zoom).not.toHaveBeenCalled();
    abort.abort();
  });

  test('releases page scrolling at a grid boundary without falling through to Race zoom', () => {
    const { host, onPan, zoom, abort } = navigation({ moving: false });
    const pageWheel = vi.fn();
    host.addEventListener('wheel', pageWheel);
    expect(host.dispatchEvent(wheel())).toBe(true);
    expect(onPan).toHaveBeenCalledWith(-100);
    expect(zoom).not.toHaveBeenCalled();
    expect(pageWheel).toHaveBeenCalledTimes(1);
    abort.abort();
  });

  test.each([{ deltaY: 0 }, { deltaY: NaN }, { deltaX: 100, deltaY: 0 }])('does not cancel wheel without permitted motion: %j', (delta) => {
    const { host, onPan, zoom, abort } = navigation();
    expect(host.dispatchEvent(wheel(delta))).toBe(true);
    expect(onPan).not.toHaveBeenCalled();
    expect(zoom).not.toHaveBeenCalled();
    abort.abort();
  });

  test('a normal wheel belongs to Grid Walk without also zooming the race', () => {
    const { host, onPan, zoom, abort } = navigation();
    expect(host.dispatchEvent(wheel())).toBe(false);
    expect(onPan).toHaveBeenCalledWith(-100);
    expect(zoom).not.toHaveBeenCalled();
    abort.abort();
  });

  test('leaves committed browser scrolling, host-owned input and navigation shortcuts alone', () => {
    const { host, onPan, zoom, abort } = navigation();
    host.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }));
    const owned = wheel(); owned.preventDefault(); host.dispatchEvent(owned);
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      const shortcut = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Home', [modifier]: true });
      expect(host.dispatchEvent(shortcut)).toBe(true);
    }
    expect(onPan).not.toHaveBeenCalled();
    expect(zoom).not.toHaveBeenCalled();
    abort.abort();
    expect(host.dispatchEvent(wheel())).toBe(true);
    expect(onPan).not.toHaveBeenCalled();
  });
});
