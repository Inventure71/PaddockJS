import { describe, expect, test } from 'vitest';
import { ADVANCED_WHEELS, ADVANCED_VEHICLE_MODEL } from '../simulation/vehicle/advancedVehicleModel.js';
import { createVehicleGeometry } from '../simulation/vehicle/vehicleGeometry.js';
import { advancedNormalLoads, advancedTireForce } from '../simulation/vehicle/advancedTireForces.js';

const car = { mass: 798, downforceCoefficient: 6.1, drsActive: false };
const forceInput = {
  normalLoad: 3000, nominalLoad: 2000, grip: 2.35, tireFactor: 1,
  surface: { grip: 1 }, longitudinalDemand: 0, forwardVelocity: 40, lateralVelocity: 2,
};

describe('advanced tire and load model', () => {
  test('applies forces at the same wheel centers used by geometry and surface observations', () => {
    for (const heading of [0, 0.7, -1.9]) {
      const pose = { x: 100, y: -70, heading };
      const geometry = createVehicleGeometry(pose);
      for (const wheel of ADVANCED_WHEELS) {
        const patch = geometry.wheels.find((candidate) => candidate.id === wheel.id);
        expect(patch.center.x).toBeCloseTo(pose.x + 12 * (Math.cos(heading) * wheel.x - Math.sin(heading) * wheel.y), 8);
        expect(patch.center.y).toBeCloseTo(pose.y + 12 * (Math.sin(heading) * wheel.x + Math.cos(heading) * wheel.y), 8);
      }
    }
    expect(ADVANCED_VEHICLE_MODEL.frontWeightFraction).toBe(0.5);
  });
  test('conserves vertical load through braking, cornering and wheel unloading', () => {
    for (const acceleration of [-40, 0, 20]) {
      for (const lateral of [-60, 0, 60]) {
        const loads = advancedNormalLoads(car, 70, acceleration, lateral);
        expect(loads.every((load) => load >= 0)).toBe(true);
        expect(loads.reduce((sum, load) => sum + load, 0)).toBeCloseTo(car.mass * 9.80665 + 6.1 * 0.5 * 70 ** 2, 8);
      }
    }
    const braking = advancedNormalLoads(car, 0, -10, 0);
    const steady = advancedNormalLoads(car, 0, 0, 0);
    const corner = advancedNormalLoads(car, 0, 0, 10);
    expect(braking[0] + braking[1]).toBeGreaterThan(steady[0] + steady[1]);
    expect(corner[0]).toBeGreaterThan(corner[1]);
    expect(corner[2]).toBeGreaterThan(corner[3]);
  });

  test('combined drive, braking and cornering never exceed contact adhesion', () => {
    for (const longitudinalDemand of [-30000, -3000, 0, 3000, 30000]) {
      for (const lateralVelocity of [-20, -1, 0, 1, 20]) {
        const force = advancedTireForce({ ...forceInput, longitudinalDemand, lateralVelocity });
        expect(Math.hypot(force.longitudinal, force.lateral)).toBeLessThanOrEqual(force.capacity + 1e-8);
        expect(force.lateral * lateralVelocity).toBeLessThanOrEqual(0);
      }
    }
  });

  test('rear drive demand leaves less force available for cornering', () => {
    const coast = advancedTireForce(forceInput);
    const drive = advancedTireForce({ ...forceInput, longitudinalDemand: coast.capacity * 0.9 });
    expect(Math.abs(drive.lateral)).toBeLessThan(Math.abs(coast.lateral));
    expect(drive.longitudinal).toBeCloseTo(coast.capacity * 0.9, 8);
  });

  test('load sensitivity makes total axle grip fall when load becomes uneven', () => {
    const capacity = (normalLoad) => advancedTireForce({ ...forceInput, normalLoad }).capacity;
    expect(capacity(5000) + capacity(1000)).toBeLessThan(capacity(3000) * 2);
  });

  test('a locked braking contact opposes actual slip velocity', () => {
    const result = advancedTireForce({ ...forceInput, longitudinalDemand: -30000, lateralVelocity: 10 });
    expect(result.longitudinal).toBeLessThan(0);
    expect(result.lateral).toBeLessThan(0);
    expect(result.lateral / result.longitudinal).toBeCloseTo(10 / 40, 8);
  });
});
