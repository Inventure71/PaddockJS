import { describe, expect, test, vi } from 'vitest';
import { SimulatorViewControls } from '../app/controls/SimulatorViewControls.js';
import { GridWalkSession } from '../app/gridWalk/gridWalkSession.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

// EventTarget exercises the actual event listeners and AbortSignal lifecycle;
// the small surface supplies only the DOM properties used by this controller.
function controlSurface() {
  const surface = { hidden: false };
  const makeButton = (view) => {
    const button = new EventTarget();
    button.dataset = view ? { gridView: view } : {};
    button.hidden = !view;
    button.disabled = true;
    button.attributes = new Map([['aria-pressed', String(view === 'grid-walk')]]);
    button.getAttribute = (key) => button.attributes.get(key);
    button.setAttribute = (key, value) => button.attributes.set(key, value);
    button.checkVisibility = () => !surface.hidden && !button.hidden;
    button.focus = vi.fn();
    button.click = () => { if (!button.disabled) button.dispatchEvent(new Event('click')); };
    return button;
  };
  const grid = makeButton('grid-walk');
  const race = makeButton('race');
  const toggle = makeButton();
  surface.querySelectorAll = (selector) => selector === '[data-grid-view]' ? [grid, race] : [toggle];
  return { surface, grid, race, toggle };
}

function controls(onView = vi.fn(), count = 1) {
  const surfaces = Array.from({ length: count }, controlSurface);
  const abort = new AbortController();
  const root = { querySelectorAll: () => surfaces.map(({ surface }) => surface) };
  const controller = new SimulatorViewControls(root, onView, abort.signal);
  return { controller, surfaces, abort, onView };
}

describe('simulator view controls', () => {
  test('shares the current view across switch and toggle surfaces without recreating controls', () => {
    const { controller, surfaces, onView, abort } = controls(undefined, 2);
    controller.update('grid-walk', 'toggle');
    for (const { grid, race, toggle } of surfaces) {
      expect(grid.hidden).toBe(true);
      expect(race.hidden).toBe(true);
      expect(toggle.hidden).toBe(false);
      expect(toggle.textContent).toBe('Start race');
      expect(toggle.dataset.gridAction).toBe('start');
      toggle.click();
    }
    expect(onView.mock.calls).toEqual([['race'], ['race']]);
    controller.update('race', 'toggle');
    expect(surfaces[0].toggle.textContent).toBe('Stop race');
    expect(surfaces[0].toggle.dataset.gridAction).toBe('stop');
    surfaces[1].toggle.click();
    expect(onView).toHaveBeenLastCalledWith('grid-walk');
    controller.update('race', 'switch');
    expect(surfaces[0].toggle.hidden).toBe(true);
    expect(surfaces[0].grid.hidden).toBe(false);
    expect(surfaces[0].race.getAttribute('aria-pressed')).toBe('true');
    surfaces[0].grid.click();
    expect(onView).toHaveBeenLastCalledWith('grid-walk');
    abort.abort();
  });

  test('focuses a visible action and disables obsolete controls on cleanup', () => {
    const { controller, surfaces: [{ surface, race, toggle }], onView, abort } = controls();
    controller.update('race', 'toggle');
    expect(controller.focusRace()).toBe(true);
    expect(toggle.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(race.focus).not.toHaveBeenCalled();
    controller.update('race', 'switch');
    expect(controller.focusRace()).toBe(true);
    expect(race.focus).toHaveBeenCalledOnce();
    controller.destroy();
    expect(surface.hidden).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(controller.focusRace()).toBe(false);
    toggle.click();
    race.click();
    expect(onView).not.toHaveBeenCalled();
    abort.abort();
    // Even a stale programmatic event cannot reach the discarded session.
    toggle.dispatchEvent(new Event('click'));
    expect(onView).not.toHaveBeenCalled();
  });

  test('start/stop actions preserve race progress and resume the exact deterministic state', () => {
    const options = { drivers: [{ id: 'alpha', name: 'Alpha', color: '#ff3344' }], seed: 71, trackSeed: 7110, warmup: false };
    const simulation = createRaceSimulation(options);
    const reference = createRaceSimulation(options);
    const session = new GridWalkSession(simulation, { initialView: 'grid-walk' });
    const displayPoses = structuredClone(session.snapshot.cars);
    const state = controls((view) => {
      session.setView(view, false);
      state.controller.update(session.view, 'toggle');
    });
    state.controller.update(session.view, 'toggle');
    const { toggle } = state.surfaces[0];
    toggle.click();
    expect(session.active).toBe(false);
    for (let index = 0; index < 120; index += 1) {
      simulation.step(1 / 60);
      reference.step(1 / 60);
    }
    const saved = structuredClone(simulation.snapshot());
    toggle.click();
    expect(session.active).toBe(true);
    expect(simulation.snapshot()).toEqual(saved);
    expect(session.snapshot.cars).toEqual(displayPoses);
    expect(toggle.textContent).toBe('Start race');
    toggle.click();
    expect(session.active).toBe(false);
    expect(simulation.snapshot()).toEqual(saved);
    simulation.step(1 / 60);
    reference.step(1 / 60);
    expect(simulation.snapshot()).toEqual(reference.snapshot());
    state.controller.destroy();
    state.abort.abort();
  });
});
