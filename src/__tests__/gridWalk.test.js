import { describe, expect, test, vi } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { resolveF1SimulatorOptions } from '../config/defaultOptions.js';
import { mergeRestartOptions } from '../config/restartOptions.js';
import { GridWalkSession } from '../app/gridWalk/gridWalkSession.js';
import { gridWalkCameraFrame, gridWalkOrientation, projectGridPoint } from '../app/gridWalk/gridWalkCamera.js';
import { runFrameLoopTick } from '../app/runtime/frameLoop.js';
import { normalizeEntryPresentation } from '../data/entryPresentation.js';
import { createGridWalkInspectionMarkup } from '../ui/gridWalkTemplate.js';
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

  test('wide/tall/live resize rotates the same grid and keeps every selected entry inside the available scene', () => {
    const sim = race();
    const { cars } = new GridWalkSession(sim, { initialView: 'grid-walk' }).snapshot;
    const before = JSON.stringify(cars);
    for (const [width, height] of [[1120, 620], [390, 760], [640, 640], [720, 460], [390, 760]]) {
      const orientation = gridWalkOrientation(width, height);
      for (const car of cars) {
        const frame = gridWalkCameraFrame({ cars, selectedId: car.id, width, height, orientation, inspectorSize: orientation === 'horizontal' ? 290 : 240 });
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

  test('content is escaped and navigation/image protocols are normalized before rendering', () => {
    const entry = normalizeEntryPresentation({ name: '<img onerror=alert(1)>', raceData: ['<script>'], link: 'javascript:alert(1)' }, {
      image: { src: 'javascript:alert(1)' }, details: ['<b>detail</b>'], technologies: ['<script>'],
    });
    const markup = createGridWalkInspectionMarkup(entry);
    expect(entry.href).toBe('');
    expect(entry.image).toBe(null);
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;b&gt;detail&lt;/b&gt;');
    expect(markup).not.toContain('<a ');
  });
});
