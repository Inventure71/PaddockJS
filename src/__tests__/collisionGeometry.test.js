import { describe, expect, test } from 'vitest';
import {
  buildCollisionCandidatePairs,
  collisionCandidatePairFirstIndex,
  collisionCandidatePairSecondIndex,
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
    const contact = detectVehicleCollision(
      car({ x: 0 }),
      car({ x: VEHICLE_GEOMETRY.bodyLength * 0.8 }),
    );
    expect(contact).not.toBeNull();
    expect(contact.depth).toBeGreaterThan(0);

    expect(detectVehicleCollision(
      car({ x: 0 }),
      car({ x: 0, y: VEHICLE_GEOMETRY.bodyWidth * 1.5 }),
    )).toBeNull();
  });

  test('does not use wheels as car-vs-car collision shapes', () => {
    const wheelWheel = detectVehicleCollision(
      car({ x: 0, y: 0 }),
      car({ x: 0, y: VEHICLE_GEOMETRY.bodyWidth + VEHICLE_GEOMETRY.wheelWidth * 0.25 }),
    );
    expect(wheelWheel).toBeNull();
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

  test('keeps circular-track broadphase local for a large field', () => {
    const cars = Array.from({ length: 80 }, (_, index) => car({
      id: `car-${index}`,
      raceDistance: index * 50,
    }));

    const pairs = buildCollisionCandidatePairs(cars, { trackLength: 4000, distanceWindow: 55 });
    const ids = pairs.map(([first, second]) => [first.id, second.id]);

    expect(pairs.length).toBeLessThan(170);
    expect(ids).toContainEqual(['car-0', 'car-1']);
    expect(ids).toContainEqual(['car-0', 'car-79']);
    expect(ids).not.toContainEqual(['car-0', 'car-40']);
  });

  test('can reuse broadphase scratch storage without changing public default freshness', () => {
    const cars = [
      car({ id: 'a', raceDistance: 10 }),
      car({ id: 'b', raceDistance: 42 }),
      car({ id: 'wrap', raceDistance: 1950 }),
    ];
    const scratch = {};

    const first = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });
    const firstPair = first[0];
    const second = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });
    const publicFresh = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90 });

    expect(second).toBe(first);
    expect(second[0]).toBe(firstPair);
    expect(second.map(([left, right]) => [left.id, right.id])).toEqual([
      ['a', 'b'],
      ['a', 'wrap'],
    ]);
    expect(publicFresh).not.toBe(second);
    expect(publicFresh[0]).not.toBe(second[0]);
  });

  test('uses scratch-owned pair marks instead of broadphase string-key sets', () => {
    const cars = [
      car({ id: 'a', raceDistance: 10 }),
      car({ id: 'b', raceDistance: 42 }),
      car({ id: 'wrap', raceDistance: 1950 }),
    ];
    const scratch = {};

    buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });
    const firstPairMarks = scratch.candidatePairMarks;
    buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });

    expect(firstPairMarks).toBeInstanceOf(Uint32Array);
    expect(scratch.candidatePairMarks).toBe(firstPairMarks);
    expect(scratch.candidateKeys).toBeUndefined();
  });

  test('stores candidate source indexes as hidden metadata for collision hot paths', () => {
    const cars = [
      car({ id: 'a', raceDistance: 10 }),
      car({ id: 'b', raceDistance: 42 }),
      car({ id: 'wrap', raceDistance: 1950 }),
    ];
    const scratch = {};

    const first = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });
    const pair = first[0];
    const second = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });

    expect(pair).toBe(second[0]);
    expect(collisionCandidatePairFirstIndex(pair)).toBe(0);
    expect(collisionCandidatePairSecondIndex(pair)).toBe(1);
    expect(Object.keys(pair)).toEqual(['0', '1']);
  });

  test('keeps collision broadphase indexing on scratch arrays instead of Map and Set bookkeeping', () => {
    const cars = [
      car({ id: 'a', raceDistance: 10 }),
      car({ id: 'b', raceDistance: 42 }),
      car({ id: 'missing-a', raceDistance: Number.NaN }),
      car({ id: 'missing-b', progress: Number.NaN, raceDistance: Number.NaN }),
    ];
    const scratch = {};

    const first = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });
    const firstDistanceEntryPool = scratch.distanceEntryPool;
    const firstMissingFlags = scratch.missingDistanceFlags;
    const firstMissingIndexes = scratch.missingDistanceIndexes;
    const second = buildCollisionCandidatePairs(cars, { trackLength: 2000, distanceWindow: 90, scratch });

    expect(second).toBe(first);
    expect(second.map(([left, right]) => [left.id, right.id])).toEqual([
      ['a', 'b'],
      ['a', 'missing-a'],
      ['a', 'missing-b'],
      ['b', 'missing-a'],
      ['b', 'missing-b'],
      ['missing-a', 'missing-b'],
    ]);
    expect(scratch.carOrder).toBeUndefined();
    expect(scratch.missingDistance).toBeUndefined();
    expect(scratch.distanceEntryPool).toBe(firstDistanceEntryPool);
    expect(scratch.missingDistanceFlags).toBe(firstMissingFlags);
    expect(scratch.missingDistanceIndexes).toBe(firstMissingIndexes);
  });

  test('can reuse swept collision scratch shapes without changing default behavior', () => {
    const first = car({ previousX: -120, previousY: 0, x: 120, y: 0, heading: 0 });
    const second = car({ previousX: 0, previousY: 120, x: 0, y: -120, heading: Math.PI / 2 });
    const scratch = {};

    const firstContact = detectVehicleCollision(first, second, { scratch });
    const firstSweepShapes = scratch.sweepShapes;
    const firstVehicleCollisionResult = scratch.vehicleCollisionResult;
    const firstVehicleCollisionAxis = scratch.vehicleCollisionResult?.axis;
    const firstShapeCollisionResult = scratch.shapeCollisionResult;
    const firstShapeCollisionAxis = scratch.shapeCollisionResult?.axis;
    const secondContact = detectVehicleCollision(first, second, { scratch });
    const publicFresh = detectVehicleCollision(first, second);

    expect(firstContact).toMatchObject({
      contactType: expect.any(String),
    });
    expect(secondContact).toBe(firstContact);
    expect(secondContact).toEqual(firstContact);
    expect(publicFresh).toEqual(firstContact);
    expect(publicFresh).not.toBe(firstContact);
    expect(publicFresh.axis).not.toBe(firstContact.axis);
    expect(scratch.sweepShapes).toBe(firstSweepShapes);
    expect(scratch.vehicleCollisionResult).toBe(firstVehicleCollisionResult);
    expect(scratch.vehicleCollisionResult?.axis).toBe(firstVehicleCollisionAxis);
    expect(scratch.shapeCollisionResult).toBe(firstShapeCollisionResult);
    expect(scratch.shapeCollisionResult?.axis).toBe(firstShapeCollisionAxis);
    expect(scratch.sweepShapes?.first).toBeDefined();
    expect(scratch.sweepShapes?.second).toBeDefined();
    expect(scratch.sweepShapes?.first?.corners).toHaveLength(4);
    expect(scratch.sweepShapes?.second?.corners).toHaveLength(4);
  });

  test('can reuse SAT projection scratch without changing default behavior', () => {
    const first = car({ previousX: -120, previousY: 0, x: 120, y: 0, heading: 0 });
    const second = car({ previousX: 0, previousY: 120, x: 0, y: -120, heading: Math.PI / 2 });
    const scratch = {};

    const firstContact = detectVehicleCollision(first, second, { scratch });
    const firstProjectionScratch = scratch.projectionScratch;
    const secondContact = detectVehicleCollision(first, second, { scratch });
    const publicFresh = detectVehicleCollision(first, second);

    expect(firstContact).toMatchObject({
      contactType: expect.any(String),
    });
    expect(secondContact).toEqual(firstContact);
    expect(publicFresh).toEqual(firstContact);
    expect(scratch.projectionScratch).toBe(firstProjectionScratch);
    expect(scratch.projectionScratch?.first).toEqual({
      min: expect.any(Number),
      max: expect.any(Number),
    });
    expect(scratch.projectionScratch?.second).toEqual({
      min: expect.any(Number),
      max: expect.any(Number),
    });
  });

  test('can reuse direct shape collision result containers without changing public freshness', () => {
    const first = car({ x: 0 });
    const second = car({ x: VEHICLE_GEOMETRY.bodyLength * 0.8 });
    const scratch = {};
    const firstShape = detectVehicleCollision(first, second, { scratch });
    const firstResult = scratch.vehicleCollisionResult;
    const firstAxis = scratch.vehicleCollisionResult?.axis;
    const secondShape = detectVehicleCollision(first, second, { scratch });
    const publicFresh = detectVehicleCollision(first, second);

    expect(firstShape).toMatchObject({
      contactType: 'body-body',
      swept: false,
      timeOfImpact: 1,
    });
    expect(secondShape).toBe(firstShape);
    expect(scratch.vehicleCollisionResult).toBe(firstResult);
    expect(scratch.vehicleCollisionResult?.axis).toBe(firstAxis);
    expect(publicFresh).toEqual(firstShape);
    expect(publicFresh).not.toBe(firstShape);
    expect(publicFresh.axis).not.toBe(firstAxis);
  });
});
