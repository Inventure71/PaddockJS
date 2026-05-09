import { describe, expect, test } from 'vitest';
import {
  REAL_F1_CAR_LENGTH_METERS,
  REAL_F1_CAR_WIDTH_METERS,
  metersToSimUnits,
  simUnitsToMeters,
} from '../simulation/units.js';
import {
  VEHICLE_GEOMETRY,
  createVehicleGeometry,
  createVehicleGeometryState,
  createVehicleShapeAabb,
  getVehicleGeometryState,
} from '../simulation/vehicleGeometry.js';

function closePoint(actual, expected, precision = 5) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
}

describe('vehicle geometry', () => {
  test('places body and four wheel contact patches from the car heading', () => {
    const geometry = createVehicleGeometry({ x: 100, y: 50, heading: 0 });

    expect(VEHICLE_GEOMETRY.visualLength).toBeCloseTo(metersToSimUnits(REAL_F1_CAR_LENGTH_METERS), 5);
    expect(VEHICLE_GEOMETRY.visualWidth).toBeCloseTo(metersToSimUnits(REAL_F1_CAR_WIDTH_METERS), 5);
    expect(simUnitsToMeters(VEHICLE_GEOMETRY.visualLength)).toBeCloseTo(REAL_F1_CAR_LENGTH_METERS, 5);
    expect(simUnitsToMeters(VEHICLE_GEOMETRY.visualWidth)).toBeCloseTo(REAL_F1_CAR_WIDTH_METERS, 5);
    expect(VEHICLE_GEOMETRY.bodyLength).toBeLessThan(VEHICLE_GEOMETRY.visualLength);
    expect(VEHICLE_GEOMETRY.bodyWidth).toBeLessThan(VEHICLE_GEOMETRY.visualWidth);
    expect(geometry.body.id).toBe('body');
    expect(geometry.wheels.map((wheel) => wheel.id)).toEqual([
      'front-left',
      'front-right',
      'rear-left',
      'rear-right',
    ]);
    closePoint(geometry.body.center, { x: 100, y: 50 });
    closePoint(geometry.wheels[0].center, {
      x: 100 + VEHICLE_GEOMETRY.wheelLongitudinalOffset,
      y: 50 - VEHICLE_GEOMETRY.wheelLateralOffset,
    });
    closePoint(geometry.wheels[1].center, {
      x: 100 + VEHICLE_GEOMETRY.wheelLongitudinalOffset,
      y: 50 + VEHICLE_GEOMETRY.wheelLateralOffset,
    });
  });

  test('rotates body and wheels through cardinal and diagonal headings', () => {
    const north = createVehicleGeometry({ x: 100, y: 50, heading: Math.PI / 2 });
    closePoint(north.wheels[0].center, {
      x: 100 + VEHICLE_GEOMETRY.wheelLateralOffset,
      y: 50 + VEHICLE_GEOMETRY.wheelLongitudinalOffset,
    });

    const west = createVehicleGeometry({ x: 100, y: 50, heading: Math.PI });
    closePoint(west.wheels[2].center, {
      x: 100 + VEHICLE_GEOMETRY.wheelLongitudinalOffset,
      y: 50 + VEHICLE_GEOMETRY.wheelLateralOffset,
    });

    const diagonal = createVehicleGeometry({ x: 0, y: 0, heading: Math.PI / 4 });
    expect(diagonal.body.corners).toHaveLength(4);
    expect(diagonal.wheels.every((wheel) => wheel.corners.length === 4)).toBe(true);
    const aabb = createVehicleShapeAabb(diagonal.body);
    expect(aabb.maxX).toBeGreaterThan(aabb.minX);
    expect(aabb.maxY).toBeGreaterThan(aabb.minY);
  });

  test('can build previous geometry for swept collision checks', () => {
    const current = createVehicleGeometry({
      x: 80,
      y: 20,
      previousX: 10,
      previousY: -5,
      heading: 0.5,
      previousHeading: -0.25,
    });
    const previous = createVehicleGeometry({
      x: 80,
      y: 20,
      previousX: 10,
      previousY: -5,
      heading: 0.5,
      previousHeading: -0.25,
    }, { previous: true });

    closePoint(current.body.center, { x: 80, y: 20 });
    closePoint(previous.body.center, { x: 10, y: -5 });
    expect(current.body.heading).toBeCloseTo(0.5);
    expect(previous.body.heading).toBeCloseTo(-0.25);
  });

  test('caches current, previous, body AABB, and swept body AABB until pose changes', () => {
    const car = {
      x: 80,
      y: 20,
      previousX: 10,
      previousY: -5,
      heading: 0.5,
      previousHeading: -0.25,
    };

    const state = getVehicleGeometryState(car);
    expect(state).toBe(getVehicleGeometryState(car));
    expect(state.body).toBe(state.current.body);
    expect(state.wheels).toBe(state.current.wheels);
    expect(state.bodyAabb.minX).toBeLessThan(state.bodyAabb.maxX);
    expect(state.sweptBodyAabb.minX).toBeLessThanOrEqual(state.previousBodyAabb.minX);
    expect(state.sweptBodyAabb.maxX).toBeGreaterThanOrEqual(state.bodyAabb.maxX);

    car.x += 4;
    const moved = getVehicleGeometryState(car);
    expect(moved).not.toBe(state);
    expect(createVehicleGeometryState(car).signature).toBe(moved.signature);
  });
});
