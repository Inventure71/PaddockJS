import { afterEach, describe, expect, test, vi } from 'vitest';
import { installRaceOverlayClearanceSupport } from '../app/raceOverlayClearanceSupport.js';

// Model browser mutation delivery, including notifications for same-value
// style assignments. Geometry follows the panel's applied clearance rather
// than freezing its pre-layout position.
function createObservedPanel() {
  const observers = new Set();
  const frames = new Map();
  let frameId = 0;
  let writes = 0;
  let narrow = true;
  const styles = new Map();
  const classes = new Set(['sim-canvas-panel--with-timing-tower', 'sim-canvas-panel--responsive-narrow']);
  const notify = () => observers.forEach((observer) => observer.callback());
  const appliedClearance = () => classes.has('sim-canvas-panel--needs-banner-clearance')
    ? Number.parseFloat(styles.get('--race-overlay-banner-clearance') ?? 0) : 0;
  const rect = (top, bottom, left = 24, right = 324) => ({ top, bottom, left, right, width: right - left, height: bottom - top });
  const row = { hidden: false, classList: { contains: () => false }, getBoundingClientRect: () => rect(561, 605) };
  const tower = { getBoundingClientRect: () => rect(12, 668 + appliedClearance(), 12, 312), querySelectorAll: () => [row] };
  const banner = { hidden: false, classList: { contains: () => false }, getBoundingClientRect: () => rect(560 + appliedClearance(), 668 + appliedClearance(), 24, 336) };
  const toggle = {};
  const panel = {
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, needed) {
        if (needed) classes.add(name);
        else classes.delete(name);
        writes += 1;
        notify();
      },
    },
    style: {
      getPropertyValue: (name) => styles.get(name) ?? '',
      setProperty(name, value) { styles.set(name, value); writes += 1; notify(); },
      removeProperty(name) { styles.delete(name); writes += 1; notify(); },
    },
    matches: () => true,
    querySelector: (selector) => ({ '[data-timing-tower]': tower, '[data-race-data-panel]': banner, '[data-timing-panel-toggle]': toggle })[selector],
    querySelectorAll: () => [],
    getBoundingClientRect: () => rect(0, 680 + appliedClearance(), 0, 360),
  };
  vi.stubGlobal('requestAnimationFrame', (callback) => { const id = ++frameId; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', undefined);
  vi.stubGlobal('MutationObserver', class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  });
  vi.stubGlobal('getComputedStyle', (element) => ({
    display: element === toggle && !narrow ? 'none' : 'block',
    visibility: 'visible',
    left: '12px',
    getPropertyValue: (name) => element.style?.getPropertyValue(name) ?? '',
  }));
  return {
    panel, banner, styles, classes, notify,
    setNarrow: (value) => { narrow = value; notify(); },
    get writes() { return writes; },
    get pendingFrames() { return frames.size; },
    drain() {
      let ticks = 0;
      while (frames.size && ticks < 8) {
        const [id, callback] = frames.entries().next().value;
        frames.delete(id);
        callback();
        ticks += 1;
      }
      return ticks;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('overlay mutation convergence', () => {
  test('stable overlap settles without redundant writes and responds to banner visibility', () => {
    const fixture = createObservedPanel();
    const cleanup = installRaceOverlayClearanceSupport(fixture.panel);
    try {
      expect(fixture.styles.get('--race-overlay-banner-clearance')).toBe('132px');
      expect(fixture.writes).toBe(2);
      expect(fixture.drain()).toBe(1);
      expect(fixture.pendingFrames).toBe(0);
      expect(fixture.writes).toBe(2);
      fixture.notify();
      expect(fixture.drain()).toBe(1);
      expect(fixture.writes).toBe(2);

      fixture.banner.hidden = true;
      fixture.notify();
      expect(fixture.drain()).toBe(2);
      expect(fixture.pendingFrames).toBe(0);
      expect(fixture.styles.has('--race-overlay-banner-clearance')).toBe(false);
      expect(fixture.classes.has('sim-canvas-panel--needs-banner-clearance')).toBe(false);
      const clearedWrites = fixture.writes;
      fixture.notify();
      expect(fixture.drain()).toBe(1);
      expect(fixture.writes).toBe(clearedWrites);

      fixture.banner.hidden = false;
      fixture.notify();
      expect(fixture.drain()).toBe(2);
      expect(fixture.styles.get('--race-overlay-banner-clearance')).toBe('132px');
    } finally { cleanup(); }
  });

  test('leaving narrow reveal mode clears once and teardown cancels observed work', () => {
    const fixture = createObservedPanel();
    const cleanup = installRaceOverlayClearanceSupport(fixture.panel);
    fixture.drain();
    fixture.setNarrow(false);
    expect(fixture.drain()).toBe(2);
    expect(fixture.pendingFrames).toBe(0);
    expect(fixture.styles.has('--race-overlay-banner-clearance')).toBe(false);
    const writes = fixture.writes;
    fixture.notify();
    expect(fixture.pendingFrames).toBe(1);
    cleanup();
    expect(fixture.pendingFrames).toBe(0);
    fixture.notify();
    expect(fixture.pendingFrames).toBe(0);
    expect(fixture.writes).toBe(writes);
  });
});
