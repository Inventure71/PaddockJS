import { describe, expect, test, vi } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { mergeRestartOptions } from '../config/restartOptions.js';
import { GridWalkController } from '../app/gridWalk/GridWalkController.js';
import { syncRuntimeTicker } from '../app/runtime/runtimeVisibility.js';
import { GridWalkSession } from '../app/gridWalk/gridWalkSession.js';
import { gridWalkCameraFrame, gridWalkOrientation, projectGridPoint, GridWalkCamera } from '../app/gridWalk/gridWalkCamera.js';
import { runFrameLoopTick } from '../app/runtime/frameLoop.js';
import { normalizeEntryPresentation } from '../data/entryPresentation.js';
import { GridWalkCrew } from '../app/gridWalk/gridWalkCrew.js';
import { Container } from 'pixi.js';
import { F1SimulatorApp } from '../app/F1SimulatorApp.js';

const drivers = Array.from({ length: 10 }, (_, index) => ({ id: `entry-${index}`, name: `Entry ${index}`, color: '#ff3344' }));
function race(rules = {}) {
  return createRaceSimulation({ drivers, seed: 71, trackSeed: 7110, warmup: false, rules });
}

describe('Grid Walk presentation lifecycle', () => {
  test('captures the actual staggered starting poses without mutating the race', () => {
    const sim = race();
    const before = JSON.stringify(sim.snapshot());
    const session = new GridWalkSession(sim, { initialView: 'grid-walk' });
    expect(JSON.stringify(sim.snapshot())).toBe(before);
    for (const car of session.snapshot.cars) {
      const actual = sim.cars.find((entry) => entry.id === car.id);
      expect([car.x, car.y, car.heading]).toEqual([actual.x, actual.y, actual.heading]);
    }
    expect(new Set(session.snapshot.cars.map((car) => car.gridOffset)).size).toBe(2);
  });

  test('crew clearing holds the race and returning restores display poses while progress and RNG stay intact', () => {
    const sim = race();
    const session = new GridWalkSession(sim, { initialView: 'grid-walk' });
    const initial = session.snapshot.cars.map((car) => [car.id, car.x, car.y]);
    session.setView('race', true);
    expect(session.clearing).toBe(true);
    for (let tick = 0; tick < 7; tick += 1) session.advance(100, true);
    expect(session.active).toBe(false);
    for (let tick = 0; tick < 600; tick += 1) sim.step(1 / 60);
    const progressed = JSON.stringify(sim.snapshot());
    session.setView('grid-walk', true);
    expect(session.snapshot.cars.map((car) => [car.id, car.x, car.y])).toEqual(initial);
    expect(JSON.stringify(sim.snapshot())).toBe(progressed);
    expect(session.setView('race', true)).toBe(true);
    expect(session.clearing).toBe(false);
    const reference = race();
    for (let tick = 0; tick < 601; tick += 1) reference.step(1 / 60);
    sim.step(1 / 60);
    expect(sim.snapshot()).toEqual(reference.snapshot());
  });

  test('cancels clearing on return; reduced or paused motion completes it without a timer', () => {
    const session = new GridWalkSession(race(), { initialView: 'grid-walk' });
    session.setView('race', true);
    session.advance(100, true);
    session.setView('grid-walk', true);
    expect(session.active).toBe(true);
    expect(session.clearing).toBe(false);
    expect(session.hasRaced).toBe(false);
    session.setView('race', true);
    session.advance(0, false);
    expect(session.active).toBe(false);
    expect(session.hasRaced).toBe(true);
  });

  test('frame loop does not step, emit race callbacks or consume the fractional step while browsing', () => {
    const app = { gridWalk: { tick: vi.fn(() => true) }, accumulator: 0.007, sim: { step: vi.fn() }, emitRaceEvents: vi.fn() };
    runFrameLoopTick(app);
    expect(app.sim.step).not.toHaveBeenCalled();
    expect(app.emitRaceEvents).not.toHaveBeenCalled();
    expect(app.accumulator).toBe(0.007);
  });

  test('stops animation on a live reduced-motion change even before its media callback arrives', () => {
    const sim = race();
    const before = JSON.stringify(sim.snapshot());
    const world = new Container();
    const controller = Object.create(GridWalkController.prototype);
    controller.session = new GridWalkSession(sim, { initialView: 'grid-walk' });
    controller.crew = new GridWalkCrew(world, controller.session.snapshot.cars);
    controller.lastTime = 0;
    controller.elapsed = 0;
    controller.media = { matches: true };
    const ticker = { started: true, stop() { this.started = false; } };
    controller.app = { gridWalk: controller, options: { gridWalk: { ambientMotion: true } }, app: { ticker },
      runtimeTickerRunning: true, runtimeViewportVisible: true, runtimeDocumentVisible: true,
      syncRuntimeTicker() { syncRuntimeTicker(this); } };
    const poses = controller.crew.walkers.map(({ person }) => [person.x, person.y]);
    expect(controller.tick(100)).toBe(true);
    expect(ticker.started).toBe(false);
    expect(controller.crew.walkers.map(({ person }) => [person.x, person.y])).toEqual(poses);
    expect(JSON.stringify(sim.snapshot())).toBe(before);
    controller.crew.destroy();
    world.destroy();
  });

  test('rolling-start staging is display-only and leaves green-flag state and moving poses intact', () => {
    const sim = race({ standingStart: false });
    const before = JSON.stringify(sim.snapshot());
    const session = new GridWalkSession(sim, { initialView: 'grid-walk' });
    expect(session.snapshot.cars.every((car) => car.speed === 0)).toBe(true);
    expect(sim.cars.every((car) => car.speed > 0)).toBe(true);
    expect(JSON.stringify(sim.snapshot())).toBe(before);
  });

  test('a host callback replacing the race cannot open an obsolete inspector', () => {
    const sim = race();
    const select = vi.fn();
    const app = {
      sim, driverById: new Map(drivers.map((driver) => [driver.id, driver])),
      gridWalk: { active: true, select }, isRaceDataBannerEnabled: () => false,
      updateDom() {}, emitHostCallback() { this.sim = race(); },
    };
    F1SimulatorApp.prototype.selectCar.call(app, drivers[0].id, { focus: true });
    expect(select).not.toHaveBeenCalled();
  });

  test('ambient activity reuses crew geometry and only updates transforms', () => {
    const world = new Container();
    const session = new GridWalkSession(race(), { initialView: 'grid-walk' });
    const crew = new GridWalkCrew(world, session.snapshot.cars);
    const people = crew.people.map(({ person }) => person);
    const contexts = people.map((person) => person.context);
    const instructions = contexts.map((context) => context.instructions.length);
    const before = people.map((person) => person.x);
    for (let frame = 0; frame < 120; frame += 1) crew.render({ active: true, motion: true, elapsed: frame * 16, clearing: false, clearProgress: 0 });
    expect(people.map((person) => person.x)).not.toEqual(before);
    expect(crew.people.map(({ person }) => person)).toEqual(people);
    expect(people.map((person) => person.context)).toEqual(contexts);
    expect(contexts.map((context) => context.instructions.length)).toEqual(instructions);
    crew.destroy();
    expect(world.children).toHaveLength(0);
    world.destroy();
  });
});

describe('Grid Walk camera contract', () => {
  test('uses actual aspect ratio with hysteresis around square dimensions', () => {
    expect(gridWalkOrientation(1100, 620)).toBe('horizontal');
    expect(gridWalkOrientation(390, 760)).toBe('vertical');
    expect(gridWalkOrientation(639, 640, 'horizontal')).toBe('horizontal');
    expect(gridWalkOrientation(641, 640, 'vertical')).toBe('vertical');
    expect(gridWalkOrientation(580, 640, 'horizontal')).toBe('vertical');
    expect(gridWalkOrientation(700, 640, 'vertical')).toBe('horizontal');
  });

  test('one-dimensional panning moves the world along the screen axis while fixing its cross-axis', () => {
    const { cars } = new GridWalkSession(race(), { initialView: 'grid-walk' }).snapshot;
    const original = JSON.stringify(cars);
    for (const [width, height] of [[1120, 620], [390, 760]]) {
      const orientation = gridWalkOrientation(width, height);
      const camera = new GridWalkCamera(cars);
      const input = { selectedId: cars[4].id, width, height, orientation, bannerSize: 130 };
      const initial = camera.update(input);
      const before = projectGridPoint(initial, cars[4]);
      expect(camera.pan(40)).toBe(true);
      const moved = camera.update(input);
      const after = projectGridPoint(moved, cars[4]);
      expect(after[orientation === 'horizontal' ? 'x' : 'y'] - before[orientation === 'horizontal' ? 'x' : 'y']).toBeCloseTo(40);
      expect(after[orientation === 'horizontal' ? 'y' : 'x']).toBeCloseTo(before[orientation === 'horizontal' ? 'y' : 'x']);
      expect(camera.pan(0)).toBe(false);
      const heading = cars[0].heading;
      const across = (frame) => -frame.center.x * Math.sin(heading) + frame.center.y * Math.cos(heading);
      expect(across(moved)).toBeCloseTo(across(initial));
      for (const delta of [100000, -200000]) {
        camera.pan(delta);
        const bounded = camera.update(input);
        expect(bounded.position).toBeGreaterThanOrEqual(initial.minPosition);
        expect(bounded.position).toBeLessThanOrEqual(initial.maxPosition);
        expect([initial.minPosition, initial.maxPosition]).toContain(bounded.position);
        expect(across(bounded)).toBeCloseTo(across(initial));
      }
    }
    expect(JSON.stringify(cars)).toBe(original);
  });

  test('selection preserves manual framing and visible entries until explicitly focused', () => {
    const { cars } = new GridWalkSession(race(), { initialView: 'grid-walk' }).snapshot;
    const camera = new GridWalkCamera(cars);
    const input = { selectedId: cars[4].id, width: 1120, height: 620, orientation: 'horizontal', bannerSize: 130 };
    camera.update(input);
    camera.pan(65);
    const before = camera.update(input);
    expect(camera.update({ ...input, selectedId: cars[8].id })).toEqual(before);
    expect(gridWalkCameraFrame({ ...input, cars, position: before.position, selectedId: cars[0].id })).toEqual(before);
    camera.focus(cars[8].id);
    const focused = camera.update({ ...input, selectedId: cars[8].id });
    expect(focused.position).not.toBe(before.position);
    expect(focused.visibleIds).toContain(cars[8].id);
    camera.focus('missing-entry');
    expect(camera.update({ ...input, selectedId: cars[8].id })).toEqual(focused);
  });

  test('resizing and rotating preserve the camera world position without changing grid poses', () => {
    const { cars } = new GridWalkSession(race(), { initialView: 'grid-walk' }).snapshot;
    const original = JSON.stringify(cars);
    const camera = new GridWalkCamera(cars);
    camera.focus(cars[4].id);
    camera.update({ selectedId: cars[4].id, width: 1120, height: 620, orientation: 'horizontal' });
    camera.pan(50);
    const before = camera.update({ selectedId: cars[4].id, width: 1120, height: 620, orientation: 'horizontal' });
    for (const [width, height] of [[390, 760], [640, 640], [720, 460], [1120, 620]]) {
      const resized = camera.update({ selectedId: cars[7].id, width, height, orientation: gridWalkOrientation(width, height), bannerSize: 130 });
      expect(resized.position).toBeCloseTo(before.position);
      expect(resized.center.x).toBeCloseTo(before.center.x);
      expect(resized.center.y).toBeCloseTo(before.center.y);
    }
    expect(JSON.stringify(cars)).toBe(original);
  });

  test('wide/tall/live resize rotates the same grid and keeps every selected entry inside the available scene', () => {
    const sim = race();
    const { cars } = new GridWalkSession(sim, { initialView: 'grid-walk' }).snapshot;
    const before = JSON.stringify(cars);
    for (const [width, height] of [[1120, 620], [390, 760], [640, 640], [720, 460], [390, 760]]) {
      const orientation = gridWalkOrientation(width, height);
      const camera = new GridWalkCamera(cars);
      for (const car of cars) {
        camera.focus(car.id);
        const frame = camera.update({ selectedId: car.id, width, height, orientation, bannerSize: 130 });
        const point = projectGridPoint(frame, car);
        expect(point.x).toBeGreaterThan(16);
        expect(point.x).toBeLessThan(width - 16);
        expect(point.y).toBeGreaterThan(74);
        expect(point.y).toBeLessThan(height - 68);
        expect(frame.visibleIds).toContain(car.id);
      }
    }
    expect(JSON.stringify(cars)).toBe(before);
  });
});

describe('Grid Walk public inputs', () => {
  test('is opt-in, merges restart options and rejects externally driven expert lifecycle', () => {
    expect(resolveF1SimulatorOptions({ drivers }).gridWalk.enabled).toBe(false);
    const options = resolveF1SimulatorOptions({ drivers, gridWalk: { enabled: true } });
    expect(options.gridWalk.initialView).toBe('grid-walk');
    expect(mergeRestartOptions(options, { gridWalk: { ambientMotion: false } }).gridWalk).toEqual({ enabled: true, initialView: 'grid-walk', ambientMotion: false });
    expect(() => resolveF1SimulatorOptions({ drivers, gridWalk: { enabled: true }, expert: { enabled: true } })).toThrow('expert');
  });

  test('entry metadata overrides driver presentation and legacy fields remain useful', () => {
    const options = resolveF1SimulatorOptions({
      drivers: [{ ...drivers[0], link: '/legacy', raceData: ['Legacy summary', 'Legacy detail'], presentation: { summary: 'Driver summary' } }],
      entries: [{ driverId: drivers[0].id, presentation: { name: 'Complete project name', summary: 'Entry summary', technologies: ['JS'], href: '/project' } }],
    });
    expect(options.drivers[0].presentation).toMatchObject({ name: 'Complete project name', summary: 'Entry summary', details: ['Legacy detail'], technologies: ['JS'], href: '/project' });
  });

  test('normalizes navigation/image protocols and preserves host text as data', () => {
    const entry = normalizeEntryPresentation({ name: '<img onerror=alert(1)>', raceData: ['<script>'], link: 'javascript:alert(1)' }, {
      image: { src: 'javascript:alert(1)' }, details: ['<b>detail</b>'], technologies: ['<script>'],
    });
    expect(entry.href).toBe('');
    expect(entry.image).toBe(null);
    expect(entry.name).toBe('<img onerror=alert(1)>');
    expect(entry.details).toEqual(['<b>detail</b>']);
  });
});
