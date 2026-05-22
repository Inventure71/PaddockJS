import { describe, expect, test } from 'vitest';
import {
  PLAYABLE_DRIVING_KEYS,
  createPlayableFrameScheduler,
  createPlayableKeyboardController,
  createPlayableKeyboardState,
  playableActionFromKeys,
} from '../../local-preview/src/playableKeyboardController.js';

function keyEvent(key, target = null) {
  return {
    key,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

describe('playable keyboard controller', () => {
  test('maps arrow and WASD keys to normalized driving actions', () => {
    expect(playableActionFromKeys(new Set(['arrowleft', 'w']))).toEqual({
      steering: -1,
      throttle: 1,
      brake: 0,
    });
    expect(playableActionFromKeys(new Set(['d', 'arrowdown']))).toEqual({
      steering: 1,
      throttle: 0,
      brake: 1,
    });
  });

  test('returns neutral controls for no input and conflicting steering', () => {
    expect(playableActionFromKeys(new Set())).toEqual({
      steering: 0,
      throttle: 0,
      brake: 0,
    });
    expect(playableActionFromKeys(new Set(['a', 'd']))).toEqual({
      steering: 0,
      throttle: 0,
      brake: 0,
    });
  });

  test('keeps throttle and brake independent when both are pressed', () => {
    expect(playableActionFromKeys(new Set(['w', 's']))).toEqual({
      steering: 0,
      throttle: 1,
      brake: 1,
    });
  });

  test('tracks pit request, commit, clear, and compound keyboard commands', () => {
    const state = createPlayableKeyboardState();
    const request = keyEvent('p');
    const commit = keyEvent('o');
    const clear = keyEvent('x');
    const soft = keyEvent('1');

    state.handleKeyDown(request);
    expect(request.defaultPrevented).toBe(true);
    expect(state.action()).toMatchObject({ pitIntent: 1 });

    state.handleKeyDown(commit);
    expect(commit.defaultPrevented).toBe(true);
    expect(state.action()).toMatchObject({ pitIntent: 2 });

    state.handleKeyDown(soft);
    expect(soft.defaultPrevented).toBe(true);
    expect(state.action()).toMatchObject({ pitIntent: 2, pitCompound: 'S' });

    state.handleKeyDown(clear);
    expect(clear.defaultPrevented).toBe(true);
    expect(state.action()).toMatchObject({ pitIntent: 0 });
    expect(Object.hasOwn(state.action(), 'pitCompound')).toBe(false);
  });

  test('tracks keydown and keyup while preventing page scroll for driving keys', () => {
    const state = createPlayableKeyboardState();
    const down = keyEvent('ArrowUp');
    const up = keyEvent('ArrowUp');

    state.handleKeyDown(down);
    expect(down.defaultPrevented).toBe(true);
    expect(state.keys()).toEqual(new Set(['arrowup']));

    state.handleKeyUp(up);
    expect(up.defaultPrevented).toBe(true);
    expect(state.keys()).toEqual(new Set());
  });

  test('ignores handled keys from editable controls', () => {
    const state = createPlayableKeyboardState();
    const input = { closest: (selector) => selector === 'input, textarea, select, button, [contenteditable="true"]' };
    const event = keyEvent('ArrowUp', input);

    state.handleKeyDown(event);

    expect(event.defaultPrevented).toBe(false);
    expect(state.keys()).toEqual(new Set());
  });

  test('controller returns actions for the configured controlled driver', async () => {
    const keyboard = createPlayableKeyboardState();
    keyboard.handleKeyDown(keyEvent('ArrowRight'));
    keyboard.setPitIntent(2);
    keyboard.setPitCompound('M');
    const controller = createPlayableKeyboardController({ keyboard });

    const actions = await controller.decideBatch({
      controlledDrivers: ['budget'],
    });

    expect(controller.id).toBe('keyboard-player');
    expect(actions.budget.steering).toBeGreaterThan(0);
    expect(actions.budget.steering).toBeLessThan(0.08);
    expect(actions.budget.throttle).toBe(0);
    expect(actions.budget.brake).toBe(0);
    expect(actions.budget.pitIntent).toBe(2);
    expect(actions.budget.pitCompound).toBe('M');
    expect(PLAYABLE_DRIVING_KEYS.has(' ')).toBe(true);
  });

  test('controller reset clears pending pit input state', async () => {
    const keyboard = createPlayableKeyboardState();
    keyboard.setPitIntent(2);
    keyboard.setPitCompound('H');
    const controller = createPlayableKeyboardController({ keyboard });

    controller.reset();
    const actions = await controller.decideBatch({ controlledDrivers: ['budget'] });

    expect(actions.budget.pitIntent).toBe(0);
    expect(Object.hasOwn(actions.budget, 'pitCompound')).toBe(false);
  });

  test('controller ramps digital steering instead of requesting full lock instantly', async () => {
    const keyboard = createPlayableKeyboardState();
    keyboard.handleKeyDown(keyEvent('ArrowRight'));
    const controller = createPlayableKeyboardController({ keyboard });

    const first = await controller.decideBatch({
      controlledDrivers: ['budget'],
      info: { elapsedSeconds: 0 },
    });

    expect(first.budget.steering).toBeGreaterThan(0);
    expect(first.budget.steering).toBeLessThan(0.08);

    let latest = first;
    for (let frame = 1; frame <= 60; frame += 1) {
      latest = await controller.decideBatch({
        controlledDrivers: ['budget'],
        info: { elapsedSeconds: frame / 60 },
      });
    }

    expect(latest.budget.steering).toBeCloseTo(0.72, 2);
  });

  test('playable frame scheduler caps controller callbacks to the configured frame interval', () => {
    let nowMs = 0;
    const queuedFrames = [];
    const scheduler = createPlayableFrameScheduler({
      frameMs: 1000 / 60,
      now: () => nowMs,
      requestFrame(callback) {
        queuedFrames.push(callback);
        return queuedFrames.length;
      },
      cancelFrame() {},
    });
    const firedAt = [];
    const scheduleStep = () => scheduler(() => {
      firedAt.push(nowMs);
    });
    const runFrame = (timeMs) => {
      nowMs = timeMs;
      const callback = queuedFrames.shift();
      expect(callback).toBeTruthy();
      callback();
    };

    scheduleStep();
    runFrame(0);
    scheduleStep();
    runFrame(8);
    runFrame(17);

    expect(firedAt).toEqual([0, 17]);
  });
});
