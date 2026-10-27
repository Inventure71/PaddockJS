import { describe, expect, test } from 'vitest';
import { Container } from 'pixi.js';
import { GridWalkCrew } from '../app/gridWalk/gridWalkCrew.js';

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
