import { describe, expect, test } from 'vitest';
import { advancedRacingPathCurvature, advancedRacingSteeringToPoint } from '../simulation/driver/advancedRacingSteering.js';
import { advancedCornerSpeed, advancedRacingSpeedControls } from '../simulation/driver/advancedRacePace.js';
import { racingDriverProfile } from '../simulation/driver/racingDriverProfile.js';
import { createAdvancedRacingEnvelopeScratch, estimateAdvancedRacingLongitudinalLimits } from '../simulation/driver/advancedRacingEnvelope.js';
import { ADVANCED_VEHICLE_MODEL as MODEL, ADVANCED_WHEELS } from '../simulation/vehicle/advancedVehicleModel.js';
import { integrateVehiclePhysics, tirePerformanceFactor, VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

const RADIUS_METERS = 100;
const DT = 1 / 60;

function vehicle(direction = 1, speed = 30, surfaces = ['track', 'track', 'track', 'track']) {
  return {
    x: metersToSimUnits(RADIUS_METERS), y: 0, heading: direction * Math.PI / 2,
    velocityX: 0, velocityY: metersToSimUnits(direction * speed), speed: metersToSimUnits(speed),
    steeringAngle: 0, yawRate: 0, longitudinalAcceleration: 0, lateralAcceleration: 0,
    mass: 798, powerNewtons: 43000, brakeNewtons: 59000, dragCoefficient: 0.33,
    downforceCoefficient: 6.1, tireGrip: 2.4, tireEnergy: 100, tireCare: 1,
    pace: 1.08, racecraft: 0.94, consistency: 0.91, aggression: 0.5,
    personality: { riskTolerance: 0.5 }, index: 0, driverNumber: 1, raceDistance: 0,
    trackState: { surface: 'track', onTrack: true },
    wheelStates: ADVANCED_WHEELS.map((wheel, index) => ({ id: wheel.id, surface: surfaces[index] })),
  };
}

function circleTarget(car, direction) {
  const angle = Math.atan2(car.y, car.x);
  const lookahead = Math.min(35, 12 + simUnitsToMeters(car.speed) * 0.35);
  const targetAngle = angle + direction * lookahead / RADIUS_METERS;
  return { x: metersToSimUnits(RADIUS_METERS * Math.cos(targetAngle)), y: metersToSimUnits(RADIUS_METERS * Math.sin(targetAngle)) };
}

function stepCircle(car, direction, targetSpeed, geometryOnly = false) {
  const profile = racingDriverProfile(car);
  const target = circleTarget(car, direction);
  const pedals = advancedRacingSpeedControls(car, targetSpeed, profile);
  const steering = geometryOnly
    ? Math.atan(MODEL.wheelbase * advancedRacingPathCurvature(car, target))
    : advancedRacingSteeringToPoint(car, target, profile, pedals).steering;
  integrateVehiclePhysics(car, { steering, ...pedals }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
}

function circleRun(direction, speedFraction, geometryOnly = false) {
  const car = vehicle(direction);
  const profile = racingDriverProfile(car);
  const physicalCorner = advancedCornerSpeed(car, direction / RADIUS_METERS, 1, { ...profile, lateralShare: 1 });
  const targetSpeed = physicalCorner * speedFraction;
  car.speed = metersToSimUnits(targetSpeed);
  car.velocityY = metersToSimUnits(direction * targetSpeed);
  const samples = [];
  for (let frame = 0; frame < 16 / DT; frame += 1) {
    stepCircle(car, direction, targetSpeed, geometryOnly);
    if (frame >= 6 / DT) samples.push({
      error: Math.abs(simUnitsToMeters(Math.hypot(car.x, car.y)) - RADIUS_METERS),
      lateral: direction * car.lateralAcceleration,
      requestedLateral: simUnitsToMeters(car.speed) ** 2 / RADIUS_METERS,
      speed: simUnitsToMeters(car.speed), yaw: direction * car.yawRate,
    });
  }
  return {
    car, targetSpeed,
    error: Math.sqrt(samples.reduce((sum, sample) => sum + sample.error ** 2, 0) / samples.length),
    maximumError: Math.max(...samples.map((sample) => sample.error)),
    lateralRatio: samples.reduce((sum, sample) => sum + sample.lateral / sample.requestedLateral, 0) / samples.length,
    speedRatio: samples.reduce((sum, sample) => sum + sample.speed / targetSpeed, 0) / samples.length,
    yaw: samples.reduce((sum, sample) => sum + sample.yaw, 0) / samples.length,
  };
}

describe('advanced racing steering against the actual vehicle integrator', () => {
  test.each([-1, 1].flatMap((direction) => [0.7, 0.93].map((speedFraction) => ({ direction, speedFraction }))))(
    'tracks signed circle at $speedFraction of physical corner speed, direction $direction', ({ direction, speedFraction }) => {
      const current = circleRun(direction, speedFraction);
      const geometric = circleRun(direction, speedFraction, true);
      expect(current.yaw).toBeGreaterThan(0);
      expect(current.speedRatio).toBeGreaterThan(0.95);
      expect(current.speedRatio).toBeLessThan(1.05);
      expect(current.lateralRatio).toBeGreaterThan(0.9);
      expect(current.lateralRatio).toBeLessThan(1.1);
      expect(current.maximumError).toBeLessThan(simUnitsToMeters(VEHICLE_LIMITS.carWidth) / 2);
      expect(current.error).toBeLessThan(geometric.error);
      expect(current.lateralRatio).toBeGreaterThan(geometric.lateralRatio);
    },
  );

  test.each([-1, 1].flatMap((direction) => [0.7, 0.93].map((speedFraction) => ({ direction, speedFraction }))))(
    'equal initial motion delivers stronger signed turn response than geometric steering at $speedFraction, direction $direction', ({ direction, speedFraction }) => {
      const current = vehicle(direction);
      const profile = racingDriverProfile(current);
      const physicalCorner = advancedCornerSpeed(current, direction / RADIUS_METERS, 1, { ...profile, lateralShare: 1 });
      const speed = physicalCorner * speedFraction;
      current.speed = metersToSimUnits(speed);
      current.velocityY = metersToSimUnits(direction * speed);
      const target = circleTarget(current, direction);
      const geometric = structuredClone(current);
      const curvature = advancedRacingPathCurvature(current, target);
      const geometrySteering = Math.atan(MODEL.wheelbase * curvature);
      const forceSteering = advancedRacingSteeringToPoint(current, target, profile, { brake: 0 }).steering;
      // Start with each requested actuator position so this comparison measures
      // tire-force response rather than spending different time moving the wheel.
      current.steeringAngle = forceSteering;
      geometric.steeringAngle = geometrySteering;
      integrateVehiclePhysics(current, { steering: forceSteering, throttle: 0, brake: 0 }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
      integrateVehiclePhysics(geometric, { steering: geometrySteering, throttle: 0, brake: 0 }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
      expect(direction * current.lateralAcceleration).toBeGreaterThan(direction * geometric.lateralAcceleration);
      expect(Math.abs(current.yawRate - speed * curvature)).toBeLessThan(Math.abs(geometric.yawRate - speed * curvature));
    },
  );

  test.each([-1, 1])('current trail-brake command predicts delivered turning better than the previous pedal, direction %s', (direction) => {
    const settled = circleRun(direction, 0.7).car;
    const speed = simUnitsToMeters(settled.speed);
    const profile = racingDriverProfile(settled);
    const target = circleTarget(settled, direction);
    const curvature = advancedRacingPathCurvature(settled, target);
    const limits = estimateAdvancedRacingLongitudinalLimits(settled, speed, tirePerformanceFactor(100), settled.lateralAcceleration, createAdvancedRacingEnvelopeScratch());
    const brake = limits.brakeForce * profile.longitudinalShare * 0.5 / settled.brakeNewtons;
    const oldSteering = advancedRacingSteeringToPoint(settled, target, profile, { brake: 0 }).steering;
    const currentSteering = advancedRacingSteeringToPoint(settled, target, profile, { brake }).steering;
    const previousPedal = structuredClone(settled);
    const currentPedal = structuredClone(settled);
    previousPedal.steeringAngle = oldSteering;
    currentPedal.steeringAngle = currentSteering;
    integrateVehiclePhysics(previousPedal, { steering: oldSteering, throttle: 0, brake }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
    integrateVehiclePhysics(currentPedal, { steering: currentSteering, throttle: 0, brake }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
    const desired = speed ** 2 * curvature;
    expect(brake).toBeGreaterThan(0);
    expect(Math.abs(currentPedal.lateralAcceleration - desired)).toBeLessThan(Math.abs(previousPedal.lateralAcceleration - desired));
    expect(direction * currentPedal.yawRate).toBeGreaterThan(0);
  });

  test('stationary and crawling requests remain finite and never write pose or control state', () => {
    for (const speed of [0, 0.5, 1.999, 2.001]) {
      const car = vehicle(1, speed);
      const before = structuredClone(car);
      const result = advancedRacingSteeringToPoint(car, { x: car.x + metersToSimUnits(1), y: car.y + metersToSimUnits(1) });
      expect(Object.values(result).every(Number.isFinite)).toBe(true);
      expect(car).toEqual(before);
      integrateVehiclePhysics(car, { steering: result.steering, throttle: 0, brake: 1 }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
      expect(Number.isFinite(car.heading)).toBe(true);
      expect(Math.abs(car.steeringAngle)).toBeLessThanOrEqual(VEHICLE_LIMITS.maxSteer);
    }
  });

  test.each([-1, 1])('split-grip force requests remain bounded and pure, direction %s', (direction) => {
    const car = vehicle(direction, 40, ['gravel', 'track', 'kerb', 'track']);
    const before = structuredClone(car);
    const target = circleTarget(car, direction);
    const result = advancedRacingSteeringToPoint(car, target, racingDriverProfile(car), { brake: 0.4 });
    expect(car).toEqual(before);
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
    expect(Math.abs(result.steering)).toBeLessThanOrEqual(VEHICLE_LIMITS.maxSteer);
    for (let frame = 0; frame < 30; frame += 1) {
      const next = advancedRacingSteeringToPoint(car, circleTarget(car, direction), racingDriverProfile(car), { brake: 0.4 });
      integrateVehiclePhysics(car, { steering: next.steering, throttle: 0, brake: 0.4 }, DT, { physicsMode: 'advanced', tireDegradationEnabled: false });
      expect([car.x, car.y, car.heading, car.speed, car.yawRate, car.lateralAcceleration].every(Number.isFinite)).toBe(true);
      expect(Math.abs(car.steeringAngle)).toBeLessThanOrEqual(VEHICLE_LIMITS.maxSteer);
    }
  });
});
