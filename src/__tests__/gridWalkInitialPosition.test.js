import { describe, expect, test } from 'vitest';
import { GridWalkCamera, projectGridPoint } from '../app/gridWalk/gridWalkCamera.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { mergeRestartOptions } from '../config/restartOptions.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { GridWalkSession } from '../app/gridWalk/gridWalkSession.js';

const heading = 0.65;
const point = (along, across = 0) => ({
  x: 240 + along * Math.cos(heading) - across * Math.sin(heading),
  y: -170 + along * Math.sin(heading) + across * Math.cos(heading),
});
const cars = Array.from({ length: 10 }, (_, index) => ({
  id: `entry-${index}`, heading, ...point(-80 - index * 100, index % 2 ? 20 : -20),
}));
const startLine = point(20);
const views = [
  { orientation: 'horizontal', width: 1120, height: 620, area: { left: 40, top: 110, right: 1080, bottom: 520 } },
  { orientation: 'vertical', width: 390, height: 760, area: { left: 20, top: 90, right: 370, bottom: 700 } },
];

describe('Grid Walk initial position', () => {
  test('defaults to the selected entry centered on the grid axis', () => {
    for (const view of views) {
      const camera = new GridWalkCamera(cars);
      const frame = camera.update({ ...view, selectedId: cars[4].id });
      const selected = projectGridPoint(frame, cars[4]);
      const axis = view.orientation === 'horizontal' ? 'x' : 'y';
      const center = axis === 'x' ? (view.area.left + view.area.right) / 2 : (view.area.top + view.area.bottom) / 2;
      expect(selected[axis]).toBeCloseTo(center);
    }
  });

  test.each(views)('aligns the actual start line at the safe $orientation edge', (view) => {
    const before = JSON.stringify(cars);
    const camera = new GridWalkCamera(cars, { initialPosition: 'start-line', startLine });
    const frame = camera.update({ ...view, selectedId: cars[4].id });
    const projected = projectGridPoint(frame, startLine);
    if (view.orientation === 'horizontal') expect(projected.x).toBeCloseTo(view.area.right - 24);
    else expect(projected.y).toBeCloseTo(view.area.top + 24);
    expect(frame.position).toBeGreaterThanOrEqual(frame.minPosition);
    expect(frame.position).toBeLessThanOrEqual(frame.maxPosition);
    expect(JSON.stringify(cars)).toBe(before);
  });

  test.each([7110, 1971, 42])('aligns the seeded track line without changing race state (seed %i)', (trackSeed) => {
    const drivers = cars.map(({ id }) => ({ id, name: id }));
    const sim = createRaceSimulation({ drivers, seed: 71, trackSeed, warmup: false });
    const before = JSON.stringify(sim.snapshot());
    const grid = new GridWalkSession(sim, { initialView: 'grid-walk' }).snapshot.cars;
    const actualStart = pointAt(sim.track, 0);
    for (const view of views) {
      const camera = new GridWalkCamera(grid, { initialPosition: 'start-line', startLine: actualStart });
      const frame = camera.update({ ...view, selectedId: grid[0].id });
      const projected = projectGridPoint(frame, actualStart);
      if (view.orientation === 'horizontal') expect(projected.x).toBeCloseTo(view.area.right - 24);
      else expect(projected.y).toBeCloseTo(view.area.top + 24);
    }
    expect(JSON.stringify(sim.snapshot())).toBe(before);
  });

  test('refreshes untouched initial framing after placeholder measurements and rotation', () => {
    const camera = new GridWalkCamera(cars, { initialPosition: 'start-line', startLine });
    camera.update({ selectedId: cars[0].id, width: 1, height: 1, orientation: 'horizontal' });
    for (const view of views) {
      const frame = camera.update({ ...view, selectedId: cars[4].id });
      const fresh = new GridWalkCamera(cars, { initialPosition: 'start-line', startLine })
        .update({ ...view, selectedId: cars[4].id });
      expect(frame).toEqual(fresh);
      const projected = projectGridPoint(frame, startLine);
      if (view.orientation === 'horizontal') expect(projected.x).toBeCloseTo(view.area.right - 24);
      else expect(projected.y).toBeCloseTo(view.area.top + 24);
    }
  });

  test.each(['pan', 'focus'])('preserves world position after user %s across selection and resize', (interaction) => {
    const camera = new GridWalkCamera(cars, { initialPosition: 'start-line', startLine });
    camera.update({ ...views[0], selectedId: cars[0].id });
    if (interaction === 'pan') expect(camera.pan(50)).toBe(true);
    else camera.focus(cars[7].id);
    const before = camera.update({ ...views[0], selectedId: cars[0].id });
    for (const view of views) {
      const frame = camera.update({ ...view, selectedId: cars[9].id });
      expect(frame.position).toBeCloseTo(before.position);
      expect(frame.center).toEqual(before.center);
    }
  });

  test.each([1, 2])('aligns a %i-car roster while keeping pan bounded and retaining resized position', (count) => {
    for (const view of views) {
      const camera = new GridWalkCamera(cars.slice(0, count), { initialPosition: 'start-line', startLine });
      const frame = camera.update({ ...view, selectedId: cars[0].id });
      const projected = projectGridPoint(frame, startLine);
      if (view.orientation === 'horizontal') expect(projected.x).toBeCloseTo(view.area.right - 24);
      else expect(projected.y).toBeCloseTo(view.area.top + 24);
      for (const delta of [100000, -200000]) {
        camera.pan(delta);
        const bounded = camera.update({ ...view, selectedId: cars[0].id });
        expect([bounded.minPosition, bounded.maxPosition]).toContain(bounded.position);
        const resized = camera.update({ ...views[1], selectedId: cars[0].id });
        expect(resized.position).toBeCloseTo(bounded.position);
      }
    }
  });

  test('normalizes initial position and preserves or replaces it on restart', () => {
    const drivers = cars.map(({ id }) => ({ id, name: id }));
    const initial = resolveF1SimulatorOptions({ drivers });
    expect(initial.gridWalk.initialPosition).toBe('selected');
    expect(resolveF1SimulatorOptions({ drivers, gridWalk: { initialPosition: 'unknown' } }).gridWalk.initialPosition).toBe('selected');
    const start = resolveF1SimulatorOptions(mergeRestartOptions(initial, { gridWalk: { enabled: true, initialPosition: 'start-line' } }));
    expect(start.gridWalk.initialPosition).toBe('start-line');
    const retained = resolveF1SimulatorOptions(mergeRestartOptions(start, { gridWalk: { ambientMotion: false } }));
    expect(retained.gridWalk).toMatchObject({ enabled: true, initialPosition: 'start-line', ambientMotion: false });
    const reset = resolveF1SimulatorOptions(mergeRestartOptions(retained, { gridWalk: { initialPosition: 'selected' } }));
    expect(reset.gridWalk.initialPosition).toBe('selected');
  });
});
