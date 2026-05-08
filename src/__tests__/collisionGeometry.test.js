import { describe, expect, test } from 'vitest';
import {
  buildCollisionCandidatePairs,
  detectVehicleCollision,
} from '../simulation/collisionGeometry.js';
import { VEHICLE_GEOMETRY } from '../simulation/vehicleGeometry.js';

function car(overrides = {}) {
  return {
    x: 0,
    y: 0,
    previousX: overrides.x ?? 0,
    previousY: overrides.y ?? 0,
    heading: 0,
    previousHeading: overrides.heading ?? 0,
    speed: 0,
    ...overrides,
  };
}

describe('collision geometry', () => {
  test('detects body-body contact and ignores near misses', () => {
    const contact = detectVehicleCollision(car({ x: 0 }), car({ x: 22 }));
    expect(contact).not.toBeNull();
    expect(contact.depth).toBeGreaterThan(0);

    expect(detectVehicleCollision(car({ x: 0 }), car({ x: 0, y: 40 }))).toBeNull();
  });

  test('does not use wheels as car-vs-car collision shapes', () => {
    const wheelWheel = detectVehicleCollision(
      car({ x: 0, y: 0 }),
      car({ x: 0, y: VEHICLE_GEOMETRY.wheelLateralOffset * 2 + VEHICLE_GEOMETRY.wheelWidth * 0.58 }),
    );
    expect(wheelWheel).toBeNull();

    const wheelBody = detectVehicleCollision(
      car({ x: 0, y: 0 }),
      car({
        x: VEHICLE_GEOMETRY.wheelLongitudinalOffset + VEHICLE_GEOMETRY.wheelLength * 0.84,
        y: -VEHICLE_GEOMETRY.wheelLateralOffset,
        heading: Math.PI / 2,
      }),
    );
    expect(wheelBody).toBeNull();
  });

  test('does not count empty transparent sprite corners as contact', () => {
    const miss = detectVehicleCollision(
      car({ x: 0, y: 0 }),
      car({
        x: VEHICLE_GEOMETRY.visualLength * 0.9,
        y: VEHICLE_GEOMETRY.visualWidth * 0.78,
        heading: 0,
      }),
    );

    expect(miss).toBeNull();
  });

  test('detects high-speed crossing that tunnels between fixed-step endpoints', () => {
    const crossing = detectVehicleCollision(
      car({ previousX: -120, previousY: 0, x: 120, y: 0, heading: 0 }),
      car({ previousX: 0, previousY: 120, x: 0, y: -120, heading: Math.PI / 2 }),
    );

    expect(crossing).toMatchObject({
      contactType: expect.any(String),
    });
    expect(crossing.timeOfImpact).toBeGreaterThan(0);
    expect(crossing.timeOfImpact).toBeLessThan(1);
  });

  test('rejects swept broadphase overlap when shapes never intersect', () => {
    const miss = detectVehicleCollision(
      car({ previousX: -120, previousY: -55, x: 120, y: -55, heading: 0 }),
      car({ previousX: 0, previousY: 120, x: 0, y: 80, heading: Math.PI / 2 }),
    );

    expect(miss).toBeNull();
  });

  test('prunes collision pairs by track-distance windows before SAT checks', () => {
    const cars = [
      car({ id: 'a', x: 0, raceDistance: 10 }),
      car({ id: 'b', x: 24, raceDistance: 42 }),
      car({ id: 'far', x: 2000, raceDistance: 1500 }),
      car({ id: 'wrap', x: -24, raceDistance: 1950 }),
    ];

    const pairs = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90 });
    expect(pairs.map(([first, second]) => [first.id, second.id])).toEqual([
      ['a', 'b'],
      ['a', 'wrap'],
    ]);
  });
});
