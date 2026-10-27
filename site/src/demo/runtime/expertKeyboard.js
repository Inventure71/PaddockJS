const CONTROL_KEYS = new Map([
  ['ArrowLeft', 'left'], ['KeyA', 'left'],
  ['ArrowRight', 'right'], ['KeyD', 'right'],
  ['ArrowUp', 'up'], ['KeyW', 'up'],
  ['ArrowDown', 'down'], ['KeyS', 'down'],
  ['KeyP', 'pit'],
]);
const EDITABLE_SELECTOR = 'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';

export function createExpertKeyboardController({
  root,
  workspace,
  onInputChange = () => {},
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
}) {
  const pressedCodes = new Set();
  const listeners = [];
  let attached = true;
  let inViewport = false;
  let pitRequested = false;
  let elapsedSeconds = null;
  let steering = 0;
  let throttle = 0;
  let brake = 0;

  function pressedControls() {
    return new Set([...pressedCodes].map((code) => CONTROL_KEYS.get(code)));
  }

  function publishInput() {
    onInputChange({ pressed: pressedControls(), pitRequested });
  }

  function clear() {
    const changed = pressedCodes.size > 0 || pitRequested;
    pressedCodes.clear();
    pitRequested = false;
    elapsedSeconds = null;
    steering = 0;
    throttle = 0;
    brake = 0;
    if (changed) publishInput();
  }

  function canDrive() {
    const active = documentTarget?.activeElement;
    return attached && inViewport && !workspace.hidden &&
      !documentTarget?.hidden && documentTarget?.visibilityState !== 'hidden' &&
      documentTarget?.hasFocus?.() !== false &&
      (active === root || root.contains?.(active)) && !isEditable(active);
  }

  function refreshVisibility() {
    const bounds = root.getBoundingClientRect?.();
    inViewport = Boolean(bounds && bounds.width > 0 && bounds.height > 0 &&
      bounds.bottom > 0 && bounds.right > 0 &&
      bounds.top < windowTarget.innerHeight && bounds.left < windowTarget.innerWidth);
    if (!canDrive()) clear();
  }

  function onKeyDown(event) {
    const control = CONTROL_KEYS.get(event.code);
    if (!control || event.isComposing || isEditable(event.target)) return;
    refreshVisibility();
    if (!canDrive()) return;
    event.preventDefault();
    const alreadyPressed = pressedCodes.has(event.code);
    pressedCodes.add(event.code);
    if (control === 'pit' && !event.repeat && !alreadyPressed) pitRequested = !pitRequested;
    publishInput();
  }

  function onKeyUp(event) {
    if (!pressedCodes.delete(event.code)) return;
    if (canDrive() && !isEditable(event.target)) event.preventDefault();
    publishInput();
  }

  function onPointerDown(event) {
    if (isEditable(event.target)) return;
    root.focus({ preventScroll: true });
    refreshVisibility();
  }

  function onFocusOut(event) {
    if (event.relatedTarget !== root && !root.contains?.(event.relatedTarget)) clear();
    else if (isEditable(event.relatedTarget)) clear();
  }

  function listen(target, type, listener, options) {
    target?.addEventListener?.(type, listener, options);
    listeners.push(() => target?.removeEventListener?.(type, listener, options));
  }

  listen(windowTarget, 'keydown', onKeyDown);
  listen(windowTarget, 'keyup', onKeyUp);
  listen(windowTarget, 'blur', clear);
  listen(windowTarget, 'focus', refreshVisibility);
  listen(windowTarget, 'scroll', refreshVisibility, true);
  listen(windowTarget, 'resize', refreshVisibility);
  listen(documentTarget, 'visibilitychange', refreshVisibility);
  listen(root, 'pointerdown', onPointerDown);
  listen(root, 'focusout', onFocusOut);
  const observer = typeof windowTarget?.IntersectionObserver === 'function'
    ? new windowTarget.IntersectionObserver(refreshVisibility)
    : null;
  observer?.observe(root);
  refreshVisibility();

  return {
    reset: clear,
    get pitRequested() { return pitRequested; },
    decideBatch(context = {}) {
      if (!canDrive()) clear();
      const controls = pressedControls();
      const dt = decisionDelta(context, elapsedSeconds);
      elapsedSeconds = finiteNumber(context.info?.elapsedSeconds);
      const driverIds = context.controlledDrivers ?? [];
      const self = context.observation?.[driverIds[0]]?.object?.self;
      const speedKph = Math.max(0, finiteNumber(self?.speedKph) ?? 0);
      // Ramp key travel before scaling wheel lock so a short tap remains a small
      // input at speed. Ramping the scaled angle reached full lock almost at once.
      const steeringLimit = 0.8 / (1 + (speedKph / 50) ** 2);
      const targetSteering = (controls.has('right') ? 1 : 0) - (controls.has('left') ? 1 : 0);
      const returning = Math.abs(targetSteering) < Math.abs(steering) || targetSteering * steering < 0;
      steering = approach(steering, targetSteering, (returning ? 1.8 : 0.9) * dt);
      throttle = approach(throttle, controls.has('up') ? 1 : 0, (controls.has('up') ? 2 : 4) * dt);
      // A digital accelerator cannot meter tire load like an analog pedal.
      // Relieve observed overload, leaving a grip margin for lateral force;
      // this changes only the human's throttle command, never the tire forces.
      const gripUsage = finiteNumber(self?.gripUsage);
      const appliedThrottle = finiteNumber(self?.throttle);
      if (gripUsage > 0.9 && appliedThrottle != null) {
        throttle = Math.min(throttle, appliedThrottle * 0.85 / gripUsage);
      }
      brake = approach(brake, controls.has('down') ? 1 : 0, (controls.has('down') ? 5 : 6) * dt);
      return Object.fromEntries(driverIds.map((driverId) => [driverId, {
        steering: steering * steeringLimit, throttle, brake,
        pitIntent: pitRequested ? 2 : 0,
        pitCompound: 'M',
      }]));
    },
    destroy() {
      if (!attached) return;
      attached = false;
      observer?.disconnect();
      listeners.forEach((remove) => remove());
      clear();
    },
  };
}

function isEditable(target) {
  return Boolean(target?.isContentEditable || target?.closest?.(EDITABLE_SELECTOR));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decisionDelta(context, previousElapsed) {
  const elapsed = finiteNumber(context.info?.elapsedSeconds);
  const delta = elapsed != null && previousElapsed != null
    ? Math.max(0, elapsed - previousElapsed)
    : Math.max(1, finiteNumber(context.actionRepeat) ?? 1) / 60;
  return Math.min(delta, 0.1);
}

function approach(value, target, maxDelta) {
  return value + Math.max(-maxDelta, Math.min(maxDelta, target - value));
}
