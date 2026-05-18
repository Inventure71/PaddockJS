import { describe, expect, test } from 'vitest';
import { integrateVehiclePhysics, VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';
import { kphToSimSpeed, simSpeedToKph } from '../simulation/units.js';

function baseCar(overrides = {}) {
  return {
    x: 0,
    y: 0,
    heading: 0,
    steeringAngle: 0,
    speed: 72,
    mass: 798,
    powerNewtons: 43000,
    brakeNewtons: 59000,
    dragCoefficient: 0.33,
    downforceCoefficient: 6.1,
    tireGrip: 2.4,
    tireEnergy: 100,
    tireCare: 1,
    trackState: { surface: 'gravel' },
    ...overrides,
  };
}

function wheels(leftSurface, rightSurface) {
  return [
    { id: 'front-left', surface: leftSurface },
    { id: 'rear-left', surface: leftSurface },
    { id: 'front-right', surface: rightSurface },
    { id: 'rear-right', surface: rightSurface },
  ];
}

describe('vehicle physics', () => {
  test('pulls the car toward the slower left-side wheels', () => {
    const balanced = baseCar({ wheelStates: wheels('track', 'track'), trackState: { surface: 'track' } });
    const leftGravel = baseCar({ wheelStates: wheels('gravel', 'track') });

    integrateVehiclePhysics(balanced, { steering: 0, throttle: 0.65, brake: 0 }, 1 / 60);
    integrateVehiclePhysics(leftGravel, { steering: 0, throttle: 0.65, brake: 0 }, 1 / 60);

    expect(leftGravel.heading).toBeLessThan(balanced.heading);
    expect(leftGravel.wheelDragYawRate).toBeLessThan(0);
  });

  test('pulls the car toward the slower right-side wheels', () => {
    const balanced = baseCar({ wheelStates: wheels('track', 'track'), trackState: { surface: 'track' } });
    const rightGravel = baseCar({ wheelStates: wheels('track', 'gravel') });

    integrateVehiclePhysics(balanced, { steering: 0, throttle: 0.65, brake: 0 }, 1 / 60);
    integrateVehiclePhysics(rightGravel, { steering: 0, throttle: 0.65, brake: 0 }, 1 / 60);

    expect(rightGravel.heading).toBeGreaterThan(balanced.heading);
    expect(rightGravel.wheelDragYawRate).toBeGreaterThan(0);
  });

  test('does not add wheel drag yaw when both sides have matching surfaces', () => {
    const gravel = baseCar({ wheelStates: wheels('gravel', 'gravel') });

    integrateVehiclePhysics(gravel, { steering: 0, throttle: 0.65, brake: 0 }, 1 / 60);

    expect(gravel.wheelDragYawRate).toBe(0);
    expect(gravel.heading).toBe(0);
  });

  test('can freeze tire energy when tire degradation is disabled', () => {
    const car = baseCar({ trackState: { surface: 'track' }, tireEnergy: 72 });

    integrateVehiclePhysics(car, { steering: 0.35, throttle: 1, brake: 0 }, 1 / 60, {
      tireDegradationEnabled: false,
    });

    expect(car.tireEnergy).toBe(72);
  });

  test('simulator mode stores world velocity and derives speed from it', () => {
    const car = baseCar({
      speed: kphToSimSpeed(180),
      trackState: { surface: 'track' },
      wheelStates: wheels('track', 'track'),
    });

    integrateVehiclePhysics(car, { steering: 0.22, throttle: 0.6, brake: 0 }, 1 / 60, {
      physicsMode: 'simulator',
    });

    expect(car.velocityX).toEqual(expect.any(Number));
    expect(car.velocityY).toEqual(expect.any(Number));
    expect(Math.hypot(car.velocityX, car.velocityY)).toBeCloseTo(car.speed, 6);
  });

  test('simulator countersteer reduces established body slip instead of flipping synthetic slide direction', () => {
    const car = baseCar({
      speed: kphToSimSpeed(210),
      trackState: { surface: 'track' },
      wheelStates: wheels('track', 'track'),
    });

    for (let index = 0; index < 90; index += 1) {
      integrateVehiclePhysics(car, { steering: VEHICLE_LIMITS.maxSteer, throttle: 0.5, brake: 0 }, 1 / 60, {
        physicsMode: 'simulator',
      });
    }
    const slipBeforeCountersteer = Math.abs(car.slipAngleRadians);

    for (let index = 0; index < 60; index += 1) {
      integrateVehiclePhysics(car, { steering: -VEHICLE_LIMITS.maxSteer * 0.42, throttle: 0.12, brake: 0 }, 1 / 60, {
        physicsMode: 'simulator',
      });
    }

    expect(slipBeforeCountersteer).toBeGreaterThan(0.02);
    expect(Math.abs(car.slipAngleRadians)).toBeLessThan(slipBeforeCountersteer);
  });

  test('simulator mode treats one gravel-side wheel as partial surface loss, not all-wheel gravel', () => {
    const balanced = baseCar({
      speed: kphToSimSpeed(150),
      trackState: { surface: 'track' },
      wheelStates: wheels('track', 'track'),
    });
    const oneSideGravel = baseCar({
      speed: kphToSimSpeed(150),
      trackState: { surface: 'gravel' },
      wheelStates: wheels('gravel', 'track'),
    });
    const allGravel = baseCar({
      speed: kphToSimSpeed(150),
      trackState: { surface: 'gravel' },
      wheelStates: wheels('gravel', 'gravel'),
    });

    for (let index = 0; index < 60; index += 1) {
      integrateVehiclePhysics(balanced, { steering: 0.18, throttle: 0.5, brake: 0 }, 1 / 60, {
        physicsMode: 'simulator',
      });
      integrateVehiclePhysics(oneSideGravel, { steering: 0.18, throttle: 0.5, brake: 0 }, 1 / 60, {
        physicsMode: 'simulator',
      });
      integrateVehiclePhysics(allGravel, { steering: 0.18, throttle: 0.5, brake: 0 }, 1 / 60, {
        physicsMode: 'simulator',
      });
    }

    expect(simSpeedToKph(oneSideGravel.speed)).toBeLessThan(simSpeedToKph(balanced.speed));
    expect(simSpeedToKph(oneSideGravel.speed)).toBeGreaterThan(simSpeedToKph(allGravel.speed));
    expect(Math.abs(oneSideGravel.wheelDragYawRate)).toBeGreaterThan(0);
  });
});
