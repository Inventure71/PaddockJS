import { describe, expect, test } from 'vitest';
import { integrateVehiclePhysics } from '../simulation/vehiclePhysics.js';

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
});
