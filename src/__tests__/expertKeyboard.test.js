import { describe, expect, it, vi } from 'vitest';
import { createExpertKeyboardController } from '../../demo/src/runtime/expertKeyboard.js';

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, fields = {}) {
      const event = { preventDefault: vi.fn(), ...fields };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
    listenerCount() { return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0); },
  };
}

function fixture() {
  const windowTarget = Object.assign(eventTarget(), { innerWidth: 1200, innerHeight: 900 });
  const documentTarget = Object.assign(eventTarget(), { hidden: false, visibilityState: 'visible', hasFocus: () => true });
  const bounds = { width: 800, height: 500, top: 100, bottom: 600, left: 100, right: 900 };
  const root = Object.assign(eventTarget(), {
    getBoundingClientRect: () => bounds,
    focus: vi.fn(() => { documentTarget.activeElement = root; }),
    contains: (element) => element?.parent === root,
  });
  const workspace = { hidden: false };
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  windowTarget.IntersectionObserver = class { constructor() { return observer; } };
  documentTarget.activeElement = root;
  const onInputChange = vi.fn();
  const controller = createExpertKeyboardController({ root, workspace, windowTarget, documentTarget, onInputChange });
  const key = (type, code, fields = {}) => windowTarget.emit(type, { code, target: root, ...fields });
  const decide = (elapsedSeconds, { speedKph = 0, actionRepeat = 2, ...body } = {}) => controller.decideBatch({
    controlledDrivers: ['player'],
    info: { elapsedSeconds },
    observation: { player: { object: { self: { speedKph, ...body } } } },
    actionRepeat,
  }).player;
  return { root, workspace, bounds, windowTarget, documentTarget, controller, onInputChange, observer, key, decide };
}

describe('advanced demo keyboard input', () => {
  it('ramps steering and each pedal over simulated time, then releases smoothly', () => {
    const input = fixture();
    expect(input.key('keydown', 'ArrowRight').preventDefault).toHaveBeenCalledOnce();
    input.key('keydown', 'KeyW');
    input.key('keydown', 'KeyS');
    const initial = input.decide(0);
    expect(initial.steering).toBeGreaterThan(0);
    expect(initial.steering).toBeLessThan(0.1);
    expect(initial.throttle).toBeGreaterThan(0);
    expect(initial.throttle).toBeLessThan(0.1);
    expect(initial.brake).toBeGreaterThan(initial.throttle);
    expect(initial.brake).toBeLessThan(0.2);
    const held = input.decide(1 / 30);
    expect(held.steering).toBeGreaterThan(initial.steering);
    expect(held.throttle).toBeGreaterThan(initial.throttle);
    expect(held.brake).toBeGreaterThan(initial.brake);
    expect(input.decide(1 / 30)).toEqual(held);
    input.key('keyup', 'ArrowRight');
    input.key('keyup', 'KeyW');
    input.key('keyup', 'KeyS');
    const released = input.decide(2 / 30);
    expect(released.steering).toBeLessThan(held.steering);
    expect(released.throttle).toBeLessThan(held.throttle);
    expect(released.brake).toBeLessThan(held.brake);
    expect(input.decide(3 / 30)).toMatchObject({ steering: 0, throttle: 0, brake: 0 });
  });

  it('uses observation speed to reduce human wheel lock at speed', () => {
    function heldSteering(speedKph) {
      const input = fixture();
      input.key('keydown', 'KeyD');
      let action;
      for (let step = 0; step < 60; step += 1) action = input.decide(step / 30, { speedKph });
      return action.steering;
    }
    expect(heldSteering(0)).toBeGreaterThan(0.5);
    expect(heldSteering(200)).toBeGreaterThan(0);
    expect(heldSteering(200)).toBeLessThan(0.1);
    expect(heldSteering(100)).toBeGreaterThan(heldSteering(200));
  });

  it('conditions equal simulated durations equally across actionRepeat values', () => {
    function drive(actionRepeat) {
      const input = fixture();
      input.key('keydown', 'KeyA');
      input.key('keydown', 'KeyW');
      let action;
      for (let step = 0; step < 12 / actionRepeat; step += 1) {
        action = input.decide(step * actionRepeat / 60, { actionRepeat });
      }
      return action;
    }
    const once = drive(1);
    const twice = drive(2);
    expect(twice.steering).toBeCloseTo(once.steering, 12);
    expect(twice.throttle).toBeCloseTo(once.throttle, 12);
    expect(twice.brake).toBe(once.brake);
  });

  it.each([0, 80, 150, 250])('keeps a short tap progressive at %s km/h and centers on release', (speedKph) => {
    const input = fixture();
    input.key('keydown', 'ArrowRight');
    let tap;
    for (let step = 0; step < 3; step += 1) tap = input.decide(step / 30, { speedKph });
    let held;
    for (let step = 3; step < 60; step += 1) held = input.decide(step / 30, { speedKph });
    expect(tap.steering).toBeGreaterThan(0);
    expect(tap.steering).toBeLessThan(held.steering * 0.15);
    input.key('keyup', 'ArrowRight');
    let released;
    for (let step = 60; step < 80; step += 1) released = input.decide(step / 30, { speedKph });
    expect(released.steering).toBe(0);
  });

  it('crosses center before building opposite lock and cancels conflicting directions', () => {
    const input = fixture();
    input.key('keydown', 'ArrowRight');
    for (let step = 0; step < 9; step += 1) input.decide(step / 30, { speedKph: 150 });
    input.key('keyup', 'ArrowRight');
    input.key('keydown', 'ArrowLeft');
    let action;
    for (let step = 9; step < 19; step += 1) action = input.decide(step / 30, { speedKph: 150 });
    expect(action.steering).toBeLessThan(0);
    input.key('keydown', 'ArrowRight');
    for (let step = 19; step < 29; step += 1) action = input.decide(step / 30, { speedKph: 150 });
    expect(action.steering).toBe(0);
  });

  it('relieves observed tire overload, recovers progressively and releases without latched throttle', () => {
    const input = fixture();
    input.key('keydown', 'ArrowUp');
    let action;
    for (let step = 0; step < 30; step += 1) action = input.decide(step / 30);
    expect(action.throttle).toBe(1);
    const overloaded = input.decide(1, { throttle: 1, gripUsage: 2 });
    expect(overloaded.throttle).toBeGreaterThan(0);
    expect(overloaded.throttle).toBeLessThan(0.5);
    expect(input.decide(1, { throttle: 1, gripUsage: 2 })).toEqual(overloaded);
    const recovering = input.decide(31 / 30, { throttle: overloaded.throttle, gripUsage: 0.5 });
    expect(recovering.throttle).toBeGreaterThan(overloaded.throttle);
    expect(recovering.throttle).toBeLessThan(0.6);
    input.windowTarget.emit('blur');
    expect(input.decide(32 / 30, { throttle: recovering.throttle, gripUsage: 2 }).throttle).toBe(0);
  });

  it('keeps a direction held until both physical aliases are released', () => {
    const input = fixture();
    input.key('keydown', 'KeyA');
    input.key('keydown', 'ArrowLeft');
    const first = input.decide(0);
    input.key('keyup', 'KeyA');
    expect(input.decide(1 / 30).steering).toBeLessThan(first.steering);
    input.key('keyup', 'ArrowLeft', { target: { isContentEditable: true } });
    expect(input.decide(2 / 30).steering).toBeCloseTo(0, 12);
  });

  it('toggles pit intent once per physical press and resets it on blur', () => {
    const input = fixture();
    input.key('keydown', 'KeyP');
    input.key('keydown', 'KeyP', { repeat: true });
    expect(input.decide(0).pitIntent).toBe(2);
    input.key('keyup', 'KeyP');
    input.key('keydown', 'KeyP');
    expect(input.decide(1 / 30).pitIntent).toBe(0);
    input.key('keyup', 'KeyP');
    input.key('keydown', 'KeyP');
    input.key('keydown', 'KeyW');
    input.windowTarget.emit('blur');
    expect(input.decide(2 / 30)).toMatchObject({ steering: 0, throttle: 0, brake: 0, pitIntent: 0 });
    expect(input.onInputChange).toHaveBeenLastCalledWith({ pressed: new Set(), pitRequested: false });
  });

  it.each(['input', 'textarea', 'select', 'button', 'a[href]', '[contenteditable]'])('leaves %s interaction alone', (selector) => {
    const input = fixture();
    const target = { closest: (query) => query.includes(selector === '[contenteditable]' ? '[contenteditable]' : selector) ? target : null };
    const event = input.key('keydown', 'ArrowDown', { target });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(input.decide(0).brake).toBe(0);
    input.root.emit('pointerdown', { target });
    expect(input.root.focus).not.toHaveBeenCalled();
  });

  it.each(['unfocused', 'outside viewport', 'workspace hidden', 'document hidden'])('clears latched input and does not capture while %s', (state) => {
    const input = fixture();
    input.key('keydown', 'KeyW');
    input.key('keydown', 'KeyP');
    input.decide(0);
    if (state === 'unfocused') {
      input.documentTarget.activeElement = {};
      input.root.emit('focusout', { relatedTarget: input.documentTarget.activeElement });
    } else if (state === 'outside viewport') {
      input.bounds.top = 1000;
      input.bounds.bottom = 1500;
      input.windowTarget.emit('scroll');
    } else if (state === 'workspace hidden') {
      input.workspace.hidden = true;
    } else {
      input.documentTarget.hidden = true;
      input.documentTarget.emit('visibilitychange');
    }
    expect(input.key('keydown', 'KeyW').preventDefault).not.toHaveBeenCalled();
    expect(input.decide(1 / 30)).toMatchObject({ throttle: 0, pitIntent: 0 });
    input.documentTarget.activeElement = input.root;
    input.bounds.top = 100;
    input.bounds.bottom = 600;
    input.workspace.hidden = false;
    input.documentTarget.hidden = false;
    input.windowTarget.emit('scroll');
    expect(input.decide(2 / 30)).toMatchObject({ throttle: 0, pitIntent: 0 });
  });

  it('focuses the race on pointer input and clears state when focus moves to an editable descendant', () => {
    const input = fixture();
    input.documentTarget.activeElement = {};
    input.root.emit('pointerdown', { target: input.root });
    expect(input.root.focus).toHaveBeenCalledWith({ preventScroll: true });
    input.key('keydown', 'KeyW');
    input.key('keydown', 'KeyP');
    const editor = { parent: input.root, isContentEditable: true };
    input.documentTarget.activeElement = editor;
    input.root.emit('focusout', { relatedTarget: editor });
    expect(input.decide(0)).toMatchObject({ throttle: 0, pitIntent: 0 });
  });

  it('does not capture composition and removes listeners and held state on disposal', () => {
    const input = fixture();
    expect(input.key('keydown', 'KeyW', { isComposing: true }).preventDefault).not.toHaveBeenCalled();
    expect(input.decide(0).throttle).toBe(0);
    input.key('keydown', 'KeyW');
    input.key('keydown', 'KeyP');
    input.controller.destroy();
    input.controller.destroy();
    expect(input.observer.disconnect).toHaveBeenCalledOnce();
    expect(input.windowTarget.listenerCount() + input.documentTarget.listenerCount() + input.root.listenerCount()).toBe(0);
    expect(input.key('keydown', 'KeyW').preventDefault).not.toHaveBeenCalled();
    expect(input.decide(1 / 30)).toMatchObject({ throttle: 0, steering: 0, brake: 0, pitIntent: 0 });
  });
});
