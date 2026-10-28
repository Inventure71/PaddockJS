import { describe, expect, test, vi } from 'vitest';
import { GridWalkNavigation } from '../app/gridWalk/gridWalkNavigation.js';

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
  const onHome = vi.fn();
  const abort = new AbortController();
  const input = new GridWalkNavigation({ host, isEnabled: () => true, getOrientation: () => 'horizontal', onPan, onSelect, onHome }, abort.signal);
  const pointer = (type, values = {}) => host.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 7, button: 0, buttons: 1, clientX: 0, clientY: 0, ...values,
  }));
  return { host, document, input, onPan, onSelect, onHome, abort, pointer };
}

describe('interrupted grid dragging', () => {
  test.each(['blur', 'hidden', 'released button'])('releases capture on %s and permits a fresh drag', (interruption) => {
    const { host, document, input, onPan, onSelect, onHome, abort, pointer } = dragNavigation();
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

describe('grid keyboard ownership', () => {
  test('arrows pan only along the camera axis and Home restores the selected entry', () => {
    const { host, input, onPan, onHome, abort } = dragNavigation();
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home']) {
      expect(host.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key }))).toBe(false);
    }
    expect(onPan.mock.calls).toEqual([[80], [-80]]);
    expect(onHome).toHaveBeenCalledOnce();
    for (const key of ['ArrowUp', 'ArrowDown']) {
      expect(host.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key }))).toBe(false);
    }
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      expect(host.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Home', [modifier]: true }))).toBe(true);
    }
    expect(onPan).toHaveBeenCalledTimes(2);
    expect(onHome).toHaveBeenCalledOnce();
    input.destroy();
    abort.abort();
  });
});
