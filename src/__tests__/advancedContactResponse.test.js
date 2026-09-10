import { describe, expect, test, vi } from 'vitest';
import { applyAdvancedContactResponse } from '../simulation/vehicle/advancedContactResponse.js';
import { applyContactVelocityResponse, resolveCollisionsForSimulation } from '../simulation/vehicle/contactResolution.js';
import { ADVANCED_VEHICLE_MODEL } from '../simulation/vehicle/advancedVehicleModel.js';
import { SIM_UNITS_PER_METER } from '../simulation/units.js';

const scale = SIM_UNITS_PER_METER;
const inertiaPerMass = ADVANCED_VEHICLE_MODEL.yawInertiaPerMass;

function car({ id = 'first', x = 0, y = 0, vx = 0, vy = 0, mass = 798, heading = 0, yawRate = 0 } = {}) {
  return { id, x: x * scale, y: y * scale, velocityX: vx * scale, velocityY: vy * scale,
    speed: Math.hypot(vx, vy) * scale, heading, yawRate, mass, contactCooldown: 0, progress: 0 };
}

function invariants(cars) {
  return cars.reduce((sum, value) => {
    const vx = value.velocityX / scale;
    const vy = value.velocityY / scale;
    sum.px += value.mass * vx;
    sum.py += value.mass * vy;
    sum.angular += value.mass * (value.x / scale * vy - value.y / scale * vx + inertiaPerMass * value.yawRate);
    sum.energy += 0.5 * value.mass * (vx * vx + vy * vy + inertiaPerMass * value.yawRate ** 2);
    return sum;
  }, { px: 0, py: 0, angular: 0, energy: 0 });
}

function expectSynchronized(value) {
  expect(value.speed).toBeCloseTo(Math.hypot(value.velocityX, value.velocityY), 10);
}

describe('advanced rigid-body contacts', () => {
  test.each([0, 0.2, 1])('centered unequal-mass impact obeys restitution %s and momentum', (restitution) => {
    const first = car({ mass: 800, vx: 10, vy: 2 });
    const second = car({ id: 'second', x: 4.5, mass: 1200, vx: -5, vy: 2 });
    const before = invariants([first, second]);

    applyAdvancedContactResponse(first, second, { x: 1, y: 0 }, { restitution });

    const impulse = (1 + restitution) * 15 / (1 / 800 + 1 / 1200);
    expect(first.velocityX / scale).toBeCloseTo(10 - impulse / 800, 10);
    expect(second.velocityX / scale).toBeCloseTo(-5 + impulse / 1200, 10);
    expect(second.velocityX / scale - first.velocityX / scale).toBeCloseTo(15 * restitution, 10);
    expect(first.velocityY / scale).toBe(2);
    expect(second.velocityY / scale).toBe(2);
    expect(first.yawRate).toBe(0);
    expect(second.yawRate).toBe(0);
    const after = invariants([first, second]);
    expect(after.px).toBeCloseTo(before.px, 8);
    expect(after.py).toBeCloseTo(before.py, 8);
    expect(after.angular).toBeCloseTo(before.angular, 8);
    expect(after.energy).toBeLessThanOrEqual(before.energy + 1e-8);
    if (restitution === 1) expect(after.energy).toBeCloseTo(before.energy, 8);
    expectSynchronized(first);
    expectSynchronized(second);
  });

  test.each([0, 0.3, 1])('offset impact uses yaw inertia and preserves angular momentum at restitution %s', (restitution) => {
    const first = car({ mass: 800, vx: 4, vy: 6, yawRate: 0.2 });
    const second = car({ id: 'second', x: 1, y: 1, mass: 900, vx: 4, vy: -2, yawRate: -0.1 });
    const before = invariants([first, second]);
    const firstHeading = first.heading;
    const secondHeading = second.heading;

    const impulse = applyAdvancedContactResponse(first, second, { x: 0, y: 1 }, { restitution });

    expect(impulse).toBeGreaterThan(0);
    expect(first.yawRate).toBeCloseTo(0.2 - impulse * 0.5 / (800 * inertiaPerMass), 10);
    expect(second.yawRate).toBeCloseTo(-0.1 - impulse * 0.5 / (900 * inertiaPerMass), 10);
    expect(first.heading).toBe(firstHeading);
    expect(second.heading).toBe(secondHeading);
    const after = invariants([first, second]);
    expect(after.px).toBeCloseTo(before.px, 8);
    expect(after.py).toBeCloseTo(before.py, 8);
    expect(after.angular).toBeCloseTo(before.angular, 8);
    expect(after.energy).toBeLessThanOrEqual(before.energy + 1e-8);
    if (restitution === 1) expect(after.energy).toBeCloseTo(before.energy, 8);
    expectSynchronized(first);
    expectSynchronized(second);
  });

  test('mirroring an oblique contact reverses lateral velocity and yaw only', () => {
    const first = car({ x: -1, y: 0.1, vx: 8, vy: 5, heading: 0.25, yawRate: 0.3 });
    const second = car({ id: 'second', x: 1, y: 0.7, vx: -1, vy: -3, heading: -0.15, yawRate: -0.4 });
    const mirror = (value) => ({ ...value, y: -value.y, heading: -value.heading, velocityY: -value.velocityY, yawRate: -value.yawRate });
    const mirroredFirst = mirror(first);
    const mirroredSecond = mirror(second);
    applyAdvancedContactResponse(first, second, { x: 0.2, y: 0.98 }, { restitution: 0.2 });
    applyAdvancedContactResponse(mirroredFirst, mirroredSecond, { x: 0.2, y: -0.98 }, { restitution: 0.2 });
    for (const [actual, reflected] of [[first, mirroredFirst], [second, mirroredSecond]]) {
      expect(reflected.velocityX).toBeCloseTo(actual.velocityX, 10);
      expect(reflected.velocityY).toBeCloseTo(-actual.velocityY, 10);
      expect(reflected.yawRate).toBeCloseTo(-actual.yawRate, 10);
    }
  });

  test('oblique contacts conserve total momentum and cannot add passive energy across poses and masses', () => {
    for (let sample = 0; sample < 64; sample += 1) {
      const angle = sample * 0.31;
      const first = car({ x: -1, y: 0.1, vx: 5 + Math.cos(angle) * 8, vy: Math.sin(angle) * 6,
        mass: 700 + sample * 3, heading: angle, yawRate: Math.sin(angle * 2) });
      const second = car({ id: 'second', x: 1, y: 0.7, vx: -3, vy: -2,
        mass: 950 - sample * 2, heading: -angle * 0.7, yawRate: Math.cos(angle * 3) });
      const before = invariants([first, second]);
      applyAdvancedContactResponse(first, second, { x: Math.cos(angle), y: Math.sin(angle) }, { restitution: sample / 63 });
      const after = invariants([first, second]);
      expect(after.px).toBeCloseTo(before.px, 7);
      expect(after.py).toBeCloseTo(before.py, 7);
      expect(after.angular).toBeCloseTo(before.angular, 7);
      expect(after.energy).toBeLessThanOrEqual(before.energy + 1e-8);
      expectSynchronized(first);
      expectSynchronized(second);
    }
  });

  test('reversing body order and contact normal gives identical results', () => {
    const first = car({ vx: 10, vy: 3, heading: 0.2 });
    const second = car({ id: 'second', x: 2, y: 0.5, vx: -3, mass: 950 });
    const reversedFirst = { ...first };
    const reversedSecond = { ...second };
    applyAdvancedContactResponse(first, second, { x: 1, y: 0 }, { restitution: 0.2 });
    applyAdvancedContactResponse(reversedSecond, reversedFirst, { x: -1, y: 0 }, { restitution: 0.2 });
    expect(reversedFirst).toEqual(first);
    expect(reversedSecond).toEqual(second);
  });

  test('separating bodies retain motion while stale scalar speed is synchronized', () => {
    const first = car({ vx: -2, vy: 3 });
    const second = car({ id: 'second', x: 4.5, vx: 2, vy: -3 });
    first.speed = 0;
    const originalVelocities = [first.velocityX, first.velocityY, second.velocityX, second.velocityY];
    expect(applyAdvancedContactResponse(first, second, { x: 1, y: 0 })).toBe(0);
    expect([first.velocityX, first.velocityY, second.velocityX, second.velocityY]).toEqual(originalVelocities);
    expectSynchronized(first);
    expectSynchronized(second);
  });

  test.each(['first', 'second'])('a %s fixed pit body retains prescribed state and absorbs the mobile impulse', (fixedSide) => {
    const mobile = car({ vx: 10, vy: 2 });
    const fixed = car({ id: 'pit', x: 4.5 });
    const originalFixed = { ...fixed };
    const first = fixedSide === 'first' ? fixed : mobile;
    const second = fixedSide === 'first' ? mobile : fixed;
    applyContactVelocityResponse({ physicsMode: 'advanced', rules: { collisionRestitution: 0.2 } }, first, second,
      { x: fixedSide === 'first' ? -1 : 1, y: 0 }, { firstFixed: fixedSide === 'first', secondFixed: fixedSide === 'second' });
    expect(fixed).toEqual(originalFixed);
    expect(mobile.velocityX / scale).toBeCloseTo(-2, 10);
    expect(mobile.velocityY / scale).toBe(2);
    expect(mobile.yawRate).toBe(0);
    expectSynchronized(mobile);
  });

  test('two pit-controlled cars are left to pit routing without contact events', () => {
    const first = car({ vx: 2 });
    const second = car({ id: 'second', x: 1 });
    first.pitStop = { status: 'entering' };
    second.pitStop = { status: 'queued' };
    const initialFirst = { ...first };
    const initialSecond = { ...second };
    const sim = { cars: [first, second], physicsMode: 'advanced', track: { length: 10000 },
      rules: { collisionRestitution: 0.2 }, time: 12, events: [], reviewCollision: vi.fn() };
    resolveCollisionsForSimulation(sim);
    expect(first).toMatchObject(initialFirst);
    expect(second).toMatchObject(initialSecond);
    expect(sim.events).toEqual([]);
    expect(sim.reviewCollision).not.toHaveBeenCalled();
  });

  test('resolver preserves fixed pit pose and contact reporting while applying torque without heading nudges', () => {
    const first = car({ vy: 5 });
    const fixed = car({ id: 'pit', x: 1, y: 1 });
    fixed.pitStop = { status: 'servicing' };
    first.previousX = first.x;
    first.previousY = first.y;
    first.previousHeading = first.heading;
    const originalFixed = { ...fixed };
    const sim = { cars: [first, fixed], physicsMode: 'advanced', track: { length: 10000 },
      rules: { collisionRestitution: 0.2 }, time: 12, events: [], reviewCollision: vi.fn() };

    resolveCollisionsForSimulation(sim);

    expect(fixed).toMatchObject({ ...originalFixed, contactCooldown: 1 });
    expect(first.heading).toBe(0);
    expect(first.previousHeading).toBe(0);
    expect(first.previousY).toBe(first.y);
    expect(first.yawRate).toBeLessThan(0);
    expect(first.speed).toBeLessThan(5 * scale);
    expectSynchronized(first);
    expect(sim.reviewCollision).toHaveBeenCalledTimes(1);
    expect(sim.events).toEqual([expect.objectContaining({ type: 'contact', at: 12,
      carId: 'first', otherCarId: 'pit', firstShapeId: 'body', secondShapeId: 'body' })]);
  });

  test('arcade vector response keeps its existing equal impulse and damping', () => {
    const first = car({ vx: 10, mass: 800 });
    const second = car({ id: 'second', x: 4.5, vx: -5, mass: 1200 });
    applyContactVelocityResponse({ physicsMode: 'arcade', rules: { collisionRestitution: 0.18 } }, first, second, { x: 1, y: 0 });
    expect(first.velocityX).toBe((10 * scale - 16) * 0.997);
    expect(second.velocityX).toBe((-5 * scale + 16) * 0.997);
    expect(first.yawRate).toBe(0);
    expect(second.yawRate).toBe(0);
  });
});
