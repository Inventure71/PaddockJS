const EDITABLE_TARGET_SELECTOR = 'input, textarea, select, button, [contenteditable="true"]';
const ZERO_ACTION = Object.freeze({ steering: 0, throttle: 0, brake: 0 });
const DEFAULT_KEYBOARD_STEERING = Object.freeze({
  max: 0.72,
  risePerSecond: 1.35,
  returnPerSecond: 2.6,
  frameSeconds: 1 / 60,
});
export const PLAYABLE_TARGET_FRAME_MS = 1000 / 60;
const FRAME_PACING_EPSILON_MS = 0.75;

export const PLAYABLE_DRIVING_KEYS = new Set([
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'a',
  'd',
  'w',
  's',
  ' ',
]);

export function playableActionFromKeys(keys = new Set()) {
  const left = keys.has('arrowleft') || keys.has('a');
  const right = keys.has('arrowright') || keys.has('d');
  const throttle = keys.has('arrowup') || keys.has('w');
  const brake = keys.has('arrowdown') || keys.has('s') || keys.has(' ');

  return {
    steering: left === right ? 0 : left ? -1 : 1,
    throttle: throttle ? 1 : 0,
    brake: brake ? 1 : 0,
  };
}

export function createPlayableKeyboardState() {
  const pressedKeys = new Set();

  function handleKeyDown(event) {
    return updateKeyState(event, true);
  }

  function handleKeyUp(event) {
    return updateKeyState(event, false);
  }

  function updateKeyState(event, pressed) {
    const key = normalizePlayableKey(event?.key);
    if (!PLAYABLE_DRIVING_KEYS.has(key)) return false;
    if (isEditableEventTarget(event?.target)) return false;
    event?.preventDefault?.();
    if (pressed) {
      pressedKeys.add(key);
    } else {
      pressedKeys.delete(key);
    }
    return true;
  }

  function clear() {
    pressedKeys.clear();
  }

  function attach({
    keyboardTarget = globalThis.window,
    lifecycleTarget = globalThis.window,
    documentTarget = globalThis.document,
  } = {}) {
    keyboardTarget?.addEventListener?.('keydown', handleKeyDown, { passive: false });
    keyboardTarget?.addEventListener?.('keyup', handleKeyUp, { passive: false });
    lifecycleTarget?.addEventListener?.('blur', clear);
    documentTarget?.addEventListener?.('visibilitychange', clear);
    return () => {
      keyboardTarget?.removeEventListener?.('keydown', handleKeyDown);
      keyboardTarget?.removeEventListener?.('keyup', handleKeyUp);
      lifecycleTarget?.removeEventListener?.('blur', clear);
      documentTarget?.removeEventListener?.('visibilitychange', clear);
      clear();
    };
  }

  return {
    handleKeyDown,
    handleKeyUp,
    clear,
    attach,
    keys() {
      return new Set(pressedKeys);
    },
    action() {
      return playableActionFromKeys(pressedKeys);
    },
  };
}

export function createPlayableKeyboardController({
  keyboard = createPlayableKeyboardState(),
  steering = DEFAULT_KEYBOARD_STEERING,
} = {}) {
  const steeringConfig = {
    ...DEFAULT_KEYBOARD_STEERING,
    ...(steering ?? {}),
  };
  let currentSteering = 0;
  let lastElapsedSeconds = null;

  function currentAction() {
    const rawAction = keyboard.action() ?? ZERO_ACTION;
    return {
      ...rawAction,
      steering: currentSteering,
    };
  }

  return {
    id: 'keyboard-player',
    label: 'Keyboard player',
    get debugState() {
      return {
        pressedKeys: [...keyboard.keys()],
        rawAction: keyboard.action(),
        action: currentAction(),
      };
    },
    reset() {
      keyboard.clear();
      currentSteering = 0;
      lastElapsedSeconds = null;
    },
    async decideBatch(context = {}) {
      const rawAction = keyboard.action() ?? ZERO_ACTION;
      currentSteering = advanceKeyboardSteering(
        currentSteering,
        rawAction.steering * steeringConfig.max,
        keyboardSteeringDeltaSeconds(context, lastElapsedSeconds, steeringConfig.frameSeconds),
        steeringConfig,
      );
      lastElapsedSeconds = finiteNumber(context.info?.elapsedSeconds, lastElapsedSeconds);
      const action = {
        ...rawAction,
        steering: currentSteering,
      };
      return Object.fromEntries((context.controlledDrivers ?? []).map((driverId) => [
        driverId,
        action,
      ]));
    },
  };
}

export function createPlayableFrameScheduler({
  frameMs = PLAYABLE_TARGET_FRAME_MS,
  now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()),
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
} = {}) {
  const targetFrameMs = Math.max(1, Number(frameMs) || PLAYABLE_TARGET_FRAME_MS);
  const scheduleFrame = typeof requestFrame === 'function'
    ? requestFrame
    : (callback) => setTimeout(callback, targetFrameMs);
  const cancelScheduledFrame = typeof cancelFrame === 'function'
    ? cancelFrame
    : (handle) => clearTimeout(handle);
  let lastFrameAt = null;

  return function schedulePlayableFrame(callback) {
    let cancelled = false;
    let frameHandle = null;
    const tick = () => {
      if (cancelled) return;
      const currentTime = Number(now());
      const elapsed = lastFrameAt == null ? Infinity : currentTime - lastFrameAt;
      if (elapsed + FRAME_PACING_EPSILON_MS >= targetFrameMs) {
        lastFrameAt = Number.isFinite(currentTime) ? currentTime : 0;
        callback();
        return;
      }
      frameHandle = scheduleFrame(tick);
    };

    frameHandle = scheduleFrame(tick);
    return {
      cancel() {
        cancelled = true;
        if (frameHandle != null) cancelScheduledFrame(frameHandle);
      },
    };
  };
}

function normalizePlayableKey(key) {
  if (key === 'Spacebar' || key === 'Space') return ' ';
  return String(key ?? '').toLowerCase();
}

function isEditableEventTarget(target) {
  return Boolean(target?.closest?.(EDITABLE_TARGET_SELECTOR));
}

function advanceKeyboardSteering(current, target, dt, config) {
  const rate = target === 0 || (current !== 0 && Math.sign(target) !== Math.sign(current))
    ? config.returnPerSecond
    : config.risePerSecond;
  const maxDelta = Math.max(0, rate * dt);
  return clamp(current + clamp(target - current, -maxDelta, maxDelta), -config.max, config.max);
}

function keyboardSteeringDeltaSeconds(context, lastElapsedSeconds, fallback) {
  const elapsedSeconds = finiteNumber(context.info?.elapsedSeconds, null);
  if (elapsedSeconds == null || lastElapsedSeconds == null || elapsedSeconds <= lastElapsedSeconds) return fallback;
  return clamp(elapsedSeconds - lastElapsedSeconds, 1 / 240, 1 / 15);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
