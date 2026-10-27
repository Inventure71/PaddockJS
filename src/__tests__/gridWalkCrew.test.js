import { describe, expect, test } from 'vitest';
import { Container } from 'pixi.js';
import { GridWalkCrew } from '../app/gridWalk/gridWalkCrew.js';
import { gridWalkCameraFrame, projectGridPoint } from '../app/gridWalk/gridWalkCamera.js';

const cars = Array.from({ length: 10 }, (_, index) => ({
  id: `entry-${index}`, x: -index * 96, y: index % 2 ? 38.4 : -38.4,
  heading: 0, gridOffset: index % 2 ? 38.4 : -38.4,
}));
const render = (crew, elapsed, options = {}) => crew.render({ active: true, motion: true, elapsed,
  clearing: false, clearProgress: 0, ...options });
const poses = (crew) => crew.walkers.map(({ person, feet, arms }) => [person.x, person.y,
  person.rotation, ...feet.map((foot) => foot.x), ...arms.map((arm) => arm.x)]);

describe('Grid Walk walking visitors', () => {
  test('walks the same grid from front to rear, with varied speeds in clear side lanes', () => {
    const world = new Container();
    const before = JSON.stringify(cars);
    const crew = new GridWalkCrew(world, cars);
    const starts = crew.walkers.map(({ person }) => person.x);
    render(crew, 1000);
    for (const [index, walker] of crew.walkers.entries()) {
      expect(Math.abs(walker.person.y)).toBeGreaterThanOrEqual(77);
      expect(Math.abs(walker.person.y)).toBeLessThanOrEqual(83);
      // Periodic arrivals wrap beyond the first/last car, on this same path.
      const traveled = (starts[index] - walker.person.x + walker.route.length) % walker.route.length;
      expect(traveled).toBeCloseTo(walker.speed);
      expect(Math.cos(walker.person.rotation)).toBeCloseTo(-1);
      for (const car of cars) expect(Math.hypot(car.x - walker.person.x, car.y - walker.person.y)).toBeGreaterThan(38);
    }
    expect(new Set(crew.walkers.map(({ speed }) => speed)).size).toBeGreaterThan(1);
    expect(JSON.stringify(cars)).toBe(before);
    crew.destroy();
    world.destroy();
  });

  test('recycles entirely outside the full canvas at both extreme pans after wide, tall and constrained resizes', () => {
    for (const heading of [0, 1.2]) {
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const grid = cars.map((car) => ({ ...car, heading,
        x: car.x * cos - car.y * sin, y: car.x * sin + car.y * cos }));
      const world = new Container();
      const crew = new GridWalkCrew(world, grid);
      for (const [width, height, orientation] of [[1000, 400, 'horizontal'], [360, 800, 'vertical'],
        [400, 360, 'horizontal'], [360, 400, 'vertical'], [1800, 300, 'horizontal']]) {
        const frame = gridWalkCameraFrame({ cars: grid, width, height, orientation,
          selectedId: grid[4].id });
        const before = poses(crew);
        crew.updateCamera(frame, width, height);
        render(crew, 0, { motion: false });
        poses(crew).forEach((pose, index) => pose.forEach((value, coordinate) =>
          expect(value).toBeCloseTo(before[index][coordinate], 8)));
        for (const position of [frame.minPosition, frame.maxPosition]) {
          const extreme = gridWalkCameraFrame({ cars: grid, width, height, orientation, position });
          for (const walker of crew.walkers) {
            const route = walker.route;
            const first = route.segments[0];
            const last = route.segments.at(-1);
            const endpoints = [{ x: first.x, y: first.y },
              { x: last.x + last.dx * (last.end - last.start),
                y: last.y + last.dy * (last.end - last.start) }];
            for (const endpoint of endpoints) {
              const screen = projectGridPoint(extreme, endpoint);
              const radius = 14 * extreme.scale;
              expect(screen.x + radius < 0 || screen.x - radius > width ||
                screen.y + radius < 0 || screen.y - radius > height).toBe(true);
            }
          }
        }
        // The actual wrap, including all people geometry, is outside either view.
        for (const walker of crew.walkers) walker.distance = walker.route.length - 0.01;
        render(crew, 1000);
        for (const walker of crew.walkers) {
          const screen = projectGridPoint(frame, walker.person);
          expect(screen.x < 0 || screen.x > width || screen.y < 0 || screen.y > height).toBe(true);
        }
        // Reset only test time between independently framed wrap checks.
        crew.lastElapsed = 0;
      }
      crew.destroy();
      world.destroy();
    }
  });

  test('retains route and graphics identities when camera bounds are already covered', () => {
    const world = new Container();
    const crew = new GridWalkCrew(world, cars);
    const frame = gridWalkCameraFrame({ cars, width: 1000, height: 450, orientation: 'horizontal' });
    crew.updateCamera(frame, 1000, 450);
    const routes = crew.walkers.map(({ route }) => route.segments);
    const people = crew.walkers.map(({ person }) => person);
    for (let index = 0; index < 100; index += 1) {
      crew.updateCamera(frame, 1000, 450);
      render(crew, index * 16);
    }
    expect(crew.walkers.map(({ route }) => route.segments)).toEqual(routes);
    crew.walkers.forEach(({ route }, index) => expect(route.segments).toBe(routes[index]));
    expect(crew.walkers.map(({ person }) => person)).toEqual(people);
    crew.destroy();
    world.destroy();
  });

  test('gives teams stable varied sizes, working positions, poses and activity', () => {
    const world = new Container();
    const crew = new GridWalkCrew(world, cars);
    const duplicate = new GridWalkCrew(world, cars);
    const counts = crew.container.children.slice(0, cars.length).map((team) => team.children.length - 1);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...counts)).toBeLessThanOrEqual(5);
    expect(new Set(counts).size).toBeGreaterThan(2);
    const mechanicPoses = (crowd) => crowd.people.map(({ person }) => [person.x, person.y, person.rotation]);
    expect(mechanicPoses(crew)).toEqual(mechanicPoses(duplicate));
    expect(new Set(crew.people.map(({ amplitude }) => amplitude)).size).toBeGreaterThan(2);
    expect(new Set(crew.people.map(({ cadence }) => cadence)).size).toBe(crew.people.length);
    const original = mechanicPoses(crew);
    render(crew, 1000);
    expect(mechanicPoses(crew)).not.toEqual(original);
    const paused = mechanicPoses(crew);
    render(crew, 2000, { motion: false });
    expect(mechanicPoses(crew)).toEqual(paused);
    crew.destroy();
    duplicate.destroy();
    world.destroy();
  });

  test('freezes both walking and stride under reduced motion or inactivity without time catch-up', () => {
    const world = new Container();
    const crew = new GridWalkCrew(world, cars);
    render(crew, 1000);
    const moving = poses(crew);
    render(crew, 2000, { motion: false });
    expect(poses(crew)).toEqual(moving);
    render(crew, 3000, { active: false });
    expect(crew.container.visible).toBe(false);
    expect(poses(crew)).toEqual(moving);
    render(crew, 3000);
    expect(crew.container.visible).toBe(true);
    expect(poses(crew)).toEqual(moving);
    render(crew, 3100);
    expect(poses(crew)).not.toEqual(moving);
    crew.destroy();
    world.destroy();
  });

  test('reuses all people and drawing instructions, then clears visitors with the mechanics', () => {
    const world = new Container();
    const crew = new GridWalkCrew(world, cars);
    const children = [...crew.container.children];
    const drawings = crew.walkers.flatMap(({ person }) => person.children);
    const contexts = drawings.map((drawing) => drawing.context);
    const instructions = contexts.map((context) => [...context.instructions]);
    for (let frame = 1; frame <= 100; frame += 1) render(crew, frame * 16);
    expect(crew.container.children).toEqual(children);
    expect(drawings.map((drawing) => drawing.context)).toEqual(contexts);
    expect(contexts.map((context) => context.instructions)).toEqual(instructions);
    render(crew, 1600, { clearing: true, clearProgress: 0.5, motion: false });
    expect(crew.container.alpha).toBe(0.5);
    expect(crew.walkers.every(({ person }) => Math.abs(person.y) > 127)).toBe(true);
    render(crew, 1600, { clearing: true, clearProgress: 1, motion: false });
    expect(crew.container.alpha).toBe(0);
    render(crew, 1600, { active: false });
    expect(crew.container.visible).toBe(false);
    crew.destroy();
    expect(world.children).toHaveLength(0);
    expect(drawings.every((drawing) => drawing.destroyed)).toBe(true);
    world.destroy();
  });

  test('keeps people on the same world paths when the starting grid is rotated', () => {
    const world = new Container();
    const angle = 1.2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = cars.map((car) => ({ ...car,
      x: car.x * cos - car.y * sin, y: car.x * sin + car.y * cos, heading: angle }));
    const crew = new GridWalkCrew(world, cars);
    const rotatedCrew = new GridWalkCrew(world, rotated);
    render(crew, 12000);
    render(rotatedCrew, 12000);
    for (const [index, { person }] of crew.walkers.entries()) {
      const turned = rotatedCrew.walkers[index].person;
      expect(turned.x).toBeCloseTo(person.x * cos - person.y * sin);
      expect(turned.y).toBeCloseTo(person.x * sin + person.y * cos);
      expect(Math.cos(turned.rotation)).toBeCloseTo(Math.cos(person.rotation + angle));
      expect(Math.sin(turned.rotation)).toBeCloseTo(Math.sin(person.rotation + angle));
    }
    crew.destroy();
    rotatedCrew.destroy();
    world.destroy();
  });

  test('keeps cosmetic variation stable and handles a single entry', () => {
    const world = new Container();
    const crew = new GridWalkCrew(world, cars.slice(0, 1));
    const duplicate = new GridWalkCrew(world, cars.slice(0, 1));
    expect(poses(crew)).toEqual(poses(duplicate));
    render(crew, 1000000);
    expect(poses(crew).flat().every(Number.isFinite)).toBe(true);
    crew.destroy();
    duplicate.destroy();
    world.destroy();
  });
});
