import { describe, expect, test, vi } from 'vitest';
import * as advancedModel from '../simulation/vehicle/advancedVehicleModel.js';
import { advancedNormalLoads, advancedTireForce, advancedContactCapacity, advancedLateralSlipAngle } from '../simulation/vehicle/advancedTireForces.js';
import { ADVANCED_VEHICLE_MODEL as MODEL, ADVANCED_WHEELS, advancedWheelSurface, advancedDragFactor } from '../simulation/vehicle/advancedVehicleModel.js';
import { createAdvancedRacingEnvelopeScratch, writeAdvancedRacingWheelEnvelope, estimateAdvancedRacingLateralCapacity, estimateAdvancedRacingBrakeForce, estimateAdvancedRacingLongitudinalLimits } from '../simulation/driver/advancedRacingEnvelope.js';
import { tirePerformanceFactor } from '../simulation/vehicle/vehiclePhysics.js';

function car({ drsActive = false, tireEnergy = 100, surfaces = ['track', 'track', 'track', 'track'] } = {}) {
  return {
    mass: 798, powerNewtons: 43000, brakeNewtons: 59000, dragCoefficient: 0.33,
    downforceCoefficient: 6.1, tireGrip: 2.4, tireEnergy, drsActive,
    longitudinalAcceleration: 0, trackState: { surface: 'track' },
    wheelStates: ADVANCED_WHEELS.map((wheel, index) => ({ id: wheel.id, surface: surfaces[index] })),
  };
}

// Independently solve the capacity bound using production force outputs,
// instead of the new exported capacity function or fixed-point algorithm.
function referenceWheels(car, speed, tireFactor, ax, ay) {
  const loads = advancedNormalLoads(car, speed, ax, ay);
  const capacities = ADVANCED_WHEELS.map((wheel, index) => advancedTireForce({
    normalLoad: loads[index], nominalLoad: car.mass * MODEL.gravity / 4,
    grip: car.tireGrip, tireFactor, surface: advancedWheelSurface(car, wheel.id),
    longitudinalDemand: 0, forwardVelocity: speed, lateralVelocity: 0,
  }).capacity);
  return { loads, capacities };
}

function bisectionFeasible(predicate, initialLow = 0) {
  let low = initialLow;
  let high = 200000;
  for (let iteration = 0; iteration < 70; iteration += 1) {
    const middle = (low + high) / 2;
    if (predicate(middle)) low = middle;
    else high = middle;
  }
  return low;
}

function referenceLateral(car, speed, tireFactor, direction) {
  return bisectionFeasible((force) => {
    const { capacities } = referenceWheels(car, speed, tireFactor, 0, direction * force / car.mass);
    return force / 2 <= Math.min(capacities[0] + capacities[1], capacities[2] + capacities[3]);
  }) / car.mass;
}

function referenceLongitudinal(car, speed, tireFactor, ay, braking, initialLow = 0) {
  return bisectionFeasible((force) => {
    let resistance = advancedDragFactor(car) * speed ** 2;
    let state;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      state = referenceWheels(car, speed, tireFactor, ((braking ? -force : force) - resistance) / car.mass, ay);
      resistance = advancedDragFactor(car) * speed ** 2 + state.loads.reduce((sum, load, index) => sum + load * advancedWheelSurface(car, ADVANCED_WHEELS[index].id).rolling, 0);
    }
    const front = state.capacities[0] + state.capacities[1];
    const rear = state.capacities[2] + state.capacities[3];
    const lateralAxle = Math.abs(ay) * car.mass / 2;
    if (lateralAxle > Math.min(front, rear)) return false;
    return state.capacities.every((capacity, index) => {
      const wheel = ADVANCED_WHEELS[index];
      const lateral = lateralAxle * capacity / (wheel.front ? front : rear);
      const longitudinal = force * (braking ? (wheel.front ? MODEL.frontBrakeFraction : 1 - MODEL.frontBrakeFraction) / 2 : wheel.front ? 0 : 0.5);
      return longitudinal ** 2 + lateral ** 2 <= capacity ** 2;
    });
  }, initialLow);
}

const surfaceCases = [
  ['track', 'track', 'track', 'track'],
  ['kerb', 'track', 'kerb', 'track'],
  ['gravel', 'track', 'track', 'track'],
  ['grass', 'grass', 'grass', 'grass'],
];

describe('advanced racing physical envelope', () => {
  test('resolves each wheel surface once per invocation while refreshing changed setup and wheel state', () => {
    const vehicle = car({ surfaces: ['gravel', 'track', 'kerb', 'track'] });
    const scratch = createAdvancedRacingEnvelopeScratch();
    const surfaces = vi.spyOn(advancedModel, 'advancedWheelSurface');
    try {
      estimateAdvancedRacingLongitudinalLimits(vehicle, 60, 1, 15, scratch);
      expect(surfaces).toHaveBeenCalledTimes(4);
      vehicle.wheelStates[0].surface = 'track';
      vehicle.wheelStates[2].surface = 'grass';
      Object.assign(vehicle, { mass: 790, tireGrip: 2.3, dragCoefficient: 0.31, downforceCoefficient: 6.35, drsActive: true });
      surfaces.mockClear();
      const reused = estimateAdvancedRacingLongitudinalLimits(vehicle, 40, 0.7, -8, scratch);
      expect(surfaces).toHaveBeenCalledTimes(4);
      const fresh = estimateAdvancedRacingLongitudinalLimits(vehicle, 40, 0.7, -8, createAdvancedRacingEnvelopeScratch());
      expect(reused).toEqual(fresh);
      surfaces.mockClear();
      estimateAdvancedRacingLateralCapacity(vehicle, 70, 0.7, scratch, { turnDirection: -1 });
      expect(surfaces).toHaveBeenCalledTimes(4);
      surfaces.mockClear();
      estimateAdvancedRacingBrakeForce(vehicle, 30, 0.7, 8, scratch);
      expect(surfaces).toHaveBeenCalledTimes(4);
    } finally {
      surfaces.mockRestore();
    }
  });

  test.each([0, 0.015880982276889395])('transient championship noir state finds a feasible nonzero brake window with previous pedal %s', (brake) => {
    const vehicle = {
      ...car(), mass: 797.2, tireGrip: 2.4184, tireEnergy: 96.65067534133203,
      downforceCoefficient: 6.260999999999999, dragCoefficient: 0.3251,
      brakeNewtons: 59840, brake, longitudinalAcceleration: -5.022912236505583,
    };
    const speed = 44.173079592366804;
    const ay = 27.034291210723513;
    const tireFactor = tirePerformanceFactor(vehicle.tireEnergy);
    // Independent force scan established 950 N is feasible even though
    // zero braking is not: a brake request transfers load to the front axle.
    const expected = referenceLongitudinal(vehicle, speed, tireFactor, ay, true, 950);
    const limits = estimateAdvancedRacingBrakeForce(vehicle, speed, tireFactor, ay, createAdvancedRacingEnvelopeScratch());
    expect(limits.brakeForce).toBeGreaterThan(950);
    expect(limits.brakeForce).toBeGreaterThan(expected * 0.999);
    expect(limits.brakeForce).toBeLessThanOrEqual(expected);
  });

  test('brake-only preview matches the complete solver without constructing drive outputs', () => {
    const vehicle = car({ surfaces: ['kerb', 'track', 'gravel', 'track'], drsActive: true, tireEnergy: 18 });
    const tireFactor = tirePerformanceFactor(vehicle.tireEnergy);
    const scratch = createAdvancedRacingEnvelopeScratch();
    const brake = estimateAdvancedRacingBrakeForce(vehicle, 60, tireFactor, -5, scratch);
    const full = estimateAdvancedRacingLongitudinalLimits(vehicle, 60, tireFactor, -5, createAdvancedRacingEnvelopeScratch());
    expect(brake).toBe(scratch);
    expect(brake.brakeForce).toBe(full.brakeForce);
    expect(brake.brakeResistanceForce).toBe(full.brakeResistanceForce);
    expect(brake.brakeRemaining).toEqual(full.brakeRemaining);
    expect(Object.hasOwn(brake, 'driveForce')).toBe(false);
    expect(Object.hasOwn(brake, 'driveResistanceForce')).toBe(false);
    expect(brake.driveRemaining).toEqual([0, 0, 0, 0]);
  });

  test.each(surfaceCases.map((surfaces) => [surfaces]))('bounded estimates remain feasible on %j', (surfaces) => {
    for (const speed of [0, 5, 20, 60, 80]) for (const drsActive of [false, true]) for (const tireEnergy of [100, 18]) {
      const vehicle = car({ surfaces, drsActive, tireEnergy });
      const tireFactor = tirePerformanceFactor(tireEnergy);
      const scratch = createAdvancedRacingEnvelopeScratch();
      for (const direction of [-1, 1]) {
        const expectedLateral = referenceLateral(vehicle, speed, tireFactor, direction);
        const actualLateral = estimateAdvancedRacingLateralCapacity(vehicle, speed, tireFactor, scratch, { turnDirection: direction });
        expect(actualLateral).toBeGreaterThan(expectedLateral * 0.95);
        expect(actualLateral).toBeLessThanOrEqual(expectedLateral);
        for (const lateralShare of [0, 0.5, 0.8, 0.9, 0.95, 0.99]) {
          const ay = direction * actualLateral * lateralShare;
          const limits = estimateAdvancedRacingLongitudinalLimits(vehicle, speed, tireFactor, ay, scratch);
          const brakeReference = referenceLongitudinal(vehicle, speed, tireFactor, ay, true);
          const driveReference = referenceLongitudinal(vehicle, speed, tireFactor, ay, false);
          expect(limits.brakeForce).toBeGreaterThanOrEqual(brakeReference * 0.97);
          expect(limits.brakeForce).toBeLessThanOrEqual(brakeReference);
          expect(limits.driveForce).toBeGreaterThanOrEqual(driveReference * 0.97);
          expect(limits.driveForce).toBeLessThanOrEqual(driveReference);
          ADVANCED_WHEELS.forEach((wheel, index) => {
            const brake = limits.brakeForce * (wheel.front ? MODEL.frontBrakeFraction : 1 - MODEL.frontBrakeFraction) / 2;
            expect(brake).toBeLessThanOrEqual(limits.brakeRemaining[index]);
            if (!wheel.front) expect(limits.driveForce / 2).toBeLessThanOrEqual(limits.driveRemaining[index]);
          });
        }
      }
    }
  });

  test('one-wheel runoff changes the direction-specific bound and stale state never survives scratch reuse', () => {
    const vehicle = car({ surfaces: ['gravel', 'track', 'track', 'track'] });
    const scratch = createAdvancedRacingEnvelopeScratch();
    const arrays = Object.fromEntries(Object.entries(scratch));
    const left = estimateAdvancedRacingLateralCapacity(vehicle, 60, 1, scratch, { turnDirection: -1 });
    const right = estimateAdvancedRacingLateralCapacity(vehicle, 60, 1, scratch, { turnDirection: 1 });
    expect(left).not.toBe(right);
    vehicle.wheelStates[0].surface = 'track';
    vehicle.drsActive = true;
    vehicle.tireEnergy = 18;
    const tireFactor = tirePerformanceFactor(vehicle.tireEnergy);
    const reused = estimateAdvancedRacingLongitudinalLimits(vehicle, 40, tireFactor, 5, scratch);
    const fresh = estimateAdvancedRacingLongitudinalLimits(vehicle, 40, tireFactor, 5, createAdvancedRacingEnvelopeScratch());
    expect(reused).toBe(scratch);
    expect(reused).toEqual(fresh);
    for (const [key, array] of Object.entries(arrays)) expect(scratch[key]).toBe(array);
  });

  test('impossible lateral demand yields no purported remaining longitudinal budget', () => {
    const vehicle = car();
    const limits = estimateAdvancedRacingLongitudinalLimits(vehicle, 20, 1, 200, createAdvancedRacingEnvelopeScratch());
    expect(limits.brakeForce).toBe(0);
    expect(limits.driveForce).toBe(0);
    expect(limits.lateralFeasible).toBe(false);
  });

  test('capacity alias reproduces existing force capacity and wheel envelope copies exact dynamic loads', () => {
    const vehicle = car({ surfaces: ['kerb', 'track', 'gravel', 'track'] });
    const expected = referenceWheels(vehicle, 60, 0.8, -10, 12);
    const state = writeAdvancedRacingWheelEnvelope(vehicle, 60, 0.8, createAdvancedRacingEnvelopeScratch(), { longitudinalAcceleration: -10, lateralAcceleration: 12 });
    expect(state.loads).toEqual(expected.loads);
    expect(state.capacities).toEqual(expected.capacities);
    expect(state.lateralForces[0] + state.lateralForces[1]).toBeCloseTo(vehicle.mass * 12 / 2, 9);
    expect(state.lateralForces[2] + state.lateralForces[3]).toBeCloseTo(vehicle.mass * 12 / 2, 9);
  });
});

describe('inverse production tire brush', () => {
  test('requested signs, load, combined braking, tire factor and surface roundtrip through actual tire force', () => {
    const nominalLoad = 798 * MODEL.gravity / 4;
    for (const normalLoad of [nominalLoad * 0.3, nominalLoad, nominalLoad * 3]) {
      for (const tireFactor of [1, 0.7]) for (const surface of [{ grip: 1 }, { grip: 0.38 }]) {
        const capacity = advancedContactCapacity(normalLoad, nominalLoad, 2.4, tireFactor, surface);
        for (const longitudinalShare of [0, 0.4, 0.85]) for (const lateralShare of [-0.99, -0.5, 0, 0.5, 0.99]) {
          const longitudinalForce = -capacity * longitudinalShare;
          const remaining = Math.sqrt(capacity ** 2 - longitudinalForce ** 2);
          const lateralForce = remaining * lateralShare;
          const correction = advancedLateralSlipAngle({ normalLoad, nominalLoad, longitudinalForce, lateralForce, capacity });
          const result = advancedTireForce({ normalLoad, nominalLoad, grip: 2.4, tireFactor, surface, longitudinalDemand: longitudinalForce, forwardVelocity: 50, lateralVelocity: -Math.tan(correction) * 50 });
          expect(result.longitudinal).toBe(longitudinalForce);
          expect(result.lateral).toBeCloseTo(lateralForce, 9);
          expect(Number.isFinite(correction)).toBe(true);
        }
      }
    }
  });

  test.each([{ normalLoad: 0, capacity: 10 }, { normalLoad: 10, capacity: 0 }, { normalLoad: 10, capacity: 10, longitudinalForce: 10 }])('zero load or remaining capacity is finite: %j', (state) => {
    expect(advancedLateralSlipAngle({ nominalLoad: 10, lateralForce: 10, ...state })).toBe(0);
  });
});
