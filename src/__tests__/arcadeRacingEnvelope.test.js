import { describe, expect, test } from 'vitest';
import { arcadePreviewSpeed } from '../simulation/driver/arcadeRacePace.js';
import { arcadeBrakingDeceleration, arcadeLongitudinalLimits, arcadeRacingSpeedControls } from '../simulation/driver/arcadeRacingEnvelope.js';
import { racingDriverProfile } from '../simulation/driver/racingDriverProfile.js';
import { arcadeSurfaceGrip, arcadeTrackCornerSpeedLimit, integrateVehiclePhysics, tirePerformanceFactor, VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

function car({ speed = 30, surface = 'track', ...overrides } = {}) {
  return {
    x: 0, y: 0, heading: 0, steeringAngle: 0, yawRate: 0, progress: 0, raceDistance: 0,
    speed: metersToSimUnits(speed), mass: 798, powerNewtons: 43000, brakeNewtons: 59000,
    dragCoefficient: 0.33, downforceCoefficient: 6.1, tireGrip: 2.4,
    tireEnergy: 100, tireCare: 1, pace: 1.08, racecraft: 0.94, consistency: 0.91,
    aggression: 0.5, personality: { riskTolerance: 0.5 },
    trackState: { surface }, ...overrides,
  };
}

function curvedTrack(curvePerMeter, cornerStartsAt = 0) {
  return {
    length: metersToSimUnits(1000),
    samples: Array.from({ length: 501 }, (_, index) => ({
      distance: metersToSimUnits(index * 2),
      heading: Math.max(0, index * 2 - cornerStartsAt) * curvePerMeter,
      curvature: index * 2 >= cornerStartsAt ? curvePerMeter / metersToSimUnits(1) : 0,
    })),
  };
}

function advance(vehicle, target, profile) {
  const pedals = arcadeRacingSpeedControls(vehicle, target, profile);
  expect(pedals.throttle).toBeGreaterThanOrEqual(0);
  expect(pedals.throttle).toBeLessThanOrEqual(1);
  expect(pedals.brake).toBeGreaterThanOrEqual(0);
  expect(pedals.brake).toBeLessThanOrEqual(1);
  expect(pedals.throttle * pedals.brake).toBe(0);
  integrateVehiclePhysics(vehicle, { steering: 0, ...pedals }, 1 / 60, { physicsMode: 'arcade', tireDegradationEnabled: false });
}

describe('arcade policy envelopes against delivered model forces', () => {
  test.each([
    { speed: 20, surface: 'track', tireEnergy: 100, drsActive: false },
    { speed: 80, surface: 'track', tireEnergy: 18, drsActive: true },
    { speed: 40, surface: 'kerb', tireEnergy: 18, drsActive: false },
    { speed: 40, surface: 'pit-lane', tireEnergy: 100, drsActive: true },
    { speed: 20, surface: 'gravel', tireEnergy: 18, drsActive: false },
    { speed: 20, surface: 'grass', tireEnergy: 100, drsActive: true },
  ])('predicts actual full-pedal force on $surface at $speed m/s, tire $tireEnergy and DRS $drsActive', (inputs) => {
    const vehicle = car(inputs);
    const before = structuredClone(vehicle);
    const limits = arcadeLongitudinalLimits(vehicle);
    expect(vehicle).toEqual(before);
    const dt = 1e-4;
    const acceleration = structuredClone(vehicle);
    integrateVehiclePhysics(acceleration, { throttle: 1, brake: 0, steering: 0 }, dt, { tireDegradationEnabled: false });
    expect(acceleration.longitudinalAcceleration).toBeCloseTo(limits.driveAcceleration - limits.resistanceDeceleration, 12);
    expect(simUnitsToMeters(acceleration.speed - vehicle.speed) / dt).toBeCloseTo(acceleration.longitudinalAcceleration, 8);
    const braking = structuredClone(vehicle);
    integrateVehiclePhysics(braking, { throttle: 0, brake: 1, steering: 0 }, dt, { tireDegradationEnabled: false });
    expect(-braking.longitudinalAcceleration).toBeCloseTo(limits.brakeDeceleration + limits.resistanceDeceleration, 12);
    expect(arcadeBrakingDeceleration(vehicle, inputs.speed, { longitudinalShare: 1 })).toBeCloseTo(-braking.longitudinalAcceleration, 12);

    const profile = { longitudinalShare: 0.9 };
    for (const target of [0, 1000]) {
      const controls = arcadeRacingSpeedControls(vehicle, target, profile);
      expect(controls.throttle * controls.brake).toBe(0);
      const actual = structuredClone(vehicle);
      integrateVehiclePhysics(actual, { steering: 0, ...controls }, dt, { tireDegradationEnabled: false });
      if (target > 0) expect(actual.longitudinalAcceleration + limits.resistanceDeceleration).toBeCloseTo(limits.driveAcceleration * 0.9, 10);
      else expect(-actual.longitudinalAcceleration - limits.resistanceDeceleration).toBeCloseTo(limits.brakeDeceleration * 0.9, 10);
    }
  });

  test.each([false, true])('holds attainable cruise without alternating pedals with DRS %s', (drsActive) => {
    const vehicle = car({ speed: 10, drsActive });
    for (let frame = 0; frame < 15 * 60; frame += 1) advance(vehicle, 60);
    expect(simUnitsToMeters(vehicle.speed)).toBeCloseTo(60, 6);
    expect(vehicle.brake).toBe(0);
    expect(vehicle.throttle).toBeGreaterThan(0);
    expect(vehicle.tireEnergy).toBe(100);
  });

  test('zero-speed requests stop and remain stopped even with rolling resistance', () => {
    const vehicle = car({ speed: 20, surface: 'gravel' });
    for (let frame = 0; frame < 10 * 60; frame += 1) advance(vehicle, 0);
    expect(vehicle.speed).toBe(0);
    const stoppedX = vehicle.x;
    for (let frame = 0; frame < 2 * 60; frame += 1) advance(vehicle, 0);
    expect(vehicle.x).toBe(stoppedX);
    expect(vehicle.throttle).toBe(0);
    expect(vehicle.brake).toBe(0);
  });

  test('prediction reflects engine taper, tire/surface brake caps, vehicle equipment and DRS', () => {
    const reference = car({ speed: 40 });
    const base = arcadeLongitudinalLimits(reference);
    expect(arcadeLongitudinalLimits(car({ speed: 40, powerNewtons: 1000 })).driveAcceleration).toBeLessThan(base.driveAcceleration);
    expect(arcadeLongitudinalLimits(car({ speed: 40, brakeNewtons: 1000 })).brakeDeceleration).toBeLessThan(base.brakeDeceleration);
    expect(arcadeLongitudinalLimits(car({ speed: 40, tireEnergy: 18 })).brakeDeceleration).toBeLessThan(base.brakeDeceleration);
    expect(arcadeLongitudinalLimits(car({ speed: 40, surface: 'gravel' })).brakeDeceleration).toBeLessThan(base.brakeDeceleration);
    const drs = arcadeLongitudinalLimits(car({ speed: 40, drsActive: true }));
    expect(drs.driveAcceleration).toBeGreaterThan(base.driveAcceleration);
    expect(drs.resistanceDeceleration).toBeLessThan(base.resistanceDeceleration);
    expect(arcadeLongitudinalLimits(reference, 1000).speed).toBe(simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
  });
});

describe('arcade braking and corner preview use actual vehicle capacity', () => {
  test.each([
    { surface: 'track', tireEnergy: 100 },
    { surface: 'track', tireEnergy: 18 },
    { surface: 'gravel', tireEnergy: 100 },
  ])('constant corner pace stays below actual yaw capacity on $surface with tire $tireEnergy', (inputs) => {
    const vehicle = car({ speed: 0, ...inputs });
    const profile = { ...racingDriverProfile(vehicle), speedJudgementScale: 1 };
    const curve = 1 / 80;
    const speed = arcadePreviewSpeed(vehicle, curvedTrack(curve), metersToSimUnits(120), vehicle.aggression, profile) / 3.6;
    const expected = arcadeTrackCornerSpeedLimit(vehicle, curve, profile.lateralShare * arcadeSurfaceGrip(vehicle));
    expect(speed).toBeCloseTo(expected, 9);
    expect(speed).toBeLessThanOrEqual(simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
    vehicle.speed = metersToSimUnits(speed);
    const steering = Math.atan(simUnitsToMeters(VEHICLE_LIMITS.wheelbase) * curve / tirePerformanceFactor(vehicle.tireEnergy));
    vehicle.steeringAngle = steering;
    integrateVehiclePhysics(vehicle, { steering, ...arcadeRacingSpeedControls(vehicle, speed, profile) }, 1 / 60, { tireDegradationEnabled: false });
    expect(vehicle.tractionLimited).toBe(false);
    expect(vehicle.yawRate / simUnitsToMeters(vehicle.speed)).toBeCloseTo(curve, 8);
    expect(vehicle.gripUsage).toBeLessThanOrEqual(profile.lateralShare + 1e-10);
  });

  test('same-car skill, anticipation and surface/tire changes alter preview without a heuristic speed floor', () => {
    const vehicle = car({ speed: 0 });
    const curveTrack = curvedTrack(1 / 50);
    const high = { ...racingDriverProfile(vehicle), speedJudgementScale: 1 };
    const low = { ...racingDriverProfile({ ...vehicle, pace: 0.92, racecraft: 0.62, consistency: 0.59 }), speedJudgementScale: 1 };
    const preview = (carInput, profile) => arcadePreviewSpeed(carInput, curveTrack, metersToSimUnits(120), carInput.aggression, profile);
    const fastest = preview(vehicle, high);
    expect(preview(vehicle, low)).toBeLessThan(fastest);
    expect(preview({ ...vehicle, tireEnergy: 18 }, high)).toBeLessThan(fastest);
    expect(preview({ ...vehicle, trackState: { surface: 'gravel' } }, high)).toBeLessThan(fastest);
    expect(preview({ ...vehicle, tireEnergy: 18 }, high)).toBeLessThan(96);

    const approach = curvedTrack(1 / 50, 120);
    vehicle.speed = metersToSimUnits(70);
    const anticipatory = arcadePreviewSpeed(vehicle, approach, metersToSimUnits(180), vehicle.aggression, { ...high, anticipationSeconds: 0.3 });
    const later = arcadePreviewSpeed(vehicle, approach, metersToSimUnits(180), vehicle.aggression, { ...high, anticipationSeconds: 0.1 });
    expect(anticipatory).toBeLessThan(later);
    const weakBrakes = arcadePreviewSpeed({ ...vehicle, brakeNewtons: 1000 }, approach, metersToSimUnits(180), vehicle.aggression, high);
    expect(weakBrakes).toBeLessThan(later);
  });
});
