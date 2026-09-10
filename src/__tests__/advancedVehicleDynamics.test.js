import { describe, expect, test } from 'vitest';
import { integrateVehiclePhysics, VEHICLE_LIMITS } from '../simulation/vehicle/vehiclePhysics.js';
import {
  REAL_F1_WHEELBASE_METERS,
  kphToSimSpeed,
  metersToSimUnits,
  simUnitsToMeters,
} from '../simulation/units.js';

const GRAVITY = 9.80665;
const ADVANCED_OPTIONS = { physicsMode: 'advanced', tireDegradationEnabled: false };
const NEUTRAL = { steering: 0, throttle: 0, brake: 0 };

function createCar(overrides = {}) {
  const car = {
    x: 0,
    y: 0,
    heading: 0,
    steeringAngle: 0,
    yawRate: 0,
    speed: 0,
    mass: 798,
    powerNewtons: 43000,
    brakeNewtons: 59000,
    dragCoefficient: 0.33,
    downforceCoefficient: 6.1,
    tireGrip: 2.4,
    tireEnergy: 100,
    tireCare: 1,
    trackState: { surface: 'track' },
    wheelStates: ['front-left', 'front-right', 'rear-left', 'rear-right'].map((id) => ({ id, surface: 'track' })),
    ...overrides,
  };
  car.velocityX = overrides.velocityX ?? Math.cos(car.heading) * car.speed;
  car.velocityY = overrides.velocityY ?? Math.sin(car.heading) * car.speed;
  car.speed = Math.hypot(car.velocityX, car.velocityY);
  return car;
}

function step(car, controls = NEUTRAL, dt = 1 / 60) {
  integrateVehiclePhysics(car, controls, dt, ADVANCED_OPTIONS);
}

function kineticEnergy(car) {
  const speed = simUnitsToMeters(Math.hypot(car.velocityX, car.velocityY));
  // Baseline planar inertia in kg m²; account for energy exchanged with yaw.
  const yawInertia = car.mass * 1.65;
  return 0.5 * car.mass * speed * speed + 0.5 * yawInertia * car.yawRate * car.yawRate;
}

function stateSignature(car) {
  return [
    car.x, car.y, car.heading, car.velocityX, car.velocityY, car.speed,
    car.steeringAngle, car.yawRate, car.lateralAcceleration, car.longitudinalAcceleration,
    car.lateralG, car.longitudinalG, car.gripUsage, car.slipAngleRadians, car.tireEnergy,
  ];
}

describe('advanced vehicle physical invariants', () => {
  test.each([0, 1])('a resting vehicle stays still with brake %s', (brake) => {
    const car = createCar({ x: 120, y: -48, heading: 0.7 });
    for (let index = 0; index < 300; index += 1) step(car, { ...NEUTRAL, brake });

    expect(car.speed).toBeLessThan(metersToSimUnits(0.01));
    expect(simUnitsToMeters(Math.hypot(car.x - 120, car.y + 48))).toBeLessThan(0.01);
    expect(car.heading).toBeCloseTo(0.7, 8);
    expect(car.yawRate).toBeCloseTo(0, 8);
    expect(stateSignature(car).every(Number.isFinite)).toBe(true);
  });

  test('steering at rest moves the actuator without rotating the body', () => {
    const car = createCar();
    for (let index = 0; index < 60; index += 1) step(car, { ...NEUTRAL, steering: VEHICLE_LIMITS.maxSteer });

    expect(car.steeringAngle).toBeGreaterThan(0);
    expect(car.heading).toBeCloseTo(0, 8);
    expect(car.yawRate).toBeCloseTo(0, 8);
    expect(car.speed).toBeLessThan(metersToSimUnits(0.01));
  });

  test('braking through zero speed does not launch the vehicle backward', () => {
    const car = createCar({ speed: kphToSimSpeed(12) });
    let minimumForwardSpeed = Infinity;
    for (let index = 0; index < 300; index += 1) {
      step(car, { ...NEUTRAL, brake: 1 });
      minimumForwardSpeed = Math.min(minimumForwardSpeed, simUnitsToMeters(car.velocityX));
    }

    expect(minimumForwardSpeed).toBeGreaterThanOrEqual(-0.01);
    expect(simUnitsToMeters(car.speed)).toBeLessThan(0.01);
    expect(car.x).toBeGreaterThan(0);
    expect(car.y).toBeCloseTo(0, 8);
  });

  test.each(['track', 'gravel'])('braking near rest on %s dissipates translation and yaw without jitter', (surface) => {
    const steering = VEHICLE_LIMITS.maxSteer;
    const car = createCar({
      velocityX: metersToSimUnits(0.001),
      velocityY: metersToSimUnits(0.001),
      yawRate: 0.001,
      steeringAngle: steering,
      trackState: { surface },
      wheelStates: ['front-left', 'front-right', 'rear-left', 'rear-right'].map((id) => ({ id, surface })),
    });
    let previousEnergy = kineticEnergy(car);
    for (let index = 0; index < 2400; index += 1) {
      step(car, { ...NEUTRAL, steering, brake: 1 }, 1 / 240);
      const currentEnergy = kineticEnergy(car);
      expect(currentEnergy).toBeLessThanOrEqual(previousEnergy + 1e-12);
      previousEnergy = currentEnergy;
    }
    expect(simUnitsToMeters(car.speed)).toBeLessThan(1e-6);
    expect(Math.abs(car.yawRate)).toBeLessThan(1e-6);
    expect(simUnitsToMeters(Math.hypot(car.x, car.y))).toBeLessThan(0.0001);
  });

  test.each([0, 100])('default car full brakes dominate full throttle from %s km/h', (speedKph) => {
    const car = createCar({ speed: kphToSimSpeed(speedKph) });
    let previousSpeed = car.speed;
    for (let index = 0; index < 600; index += 1) {
      step(car, { ...NEUTRAL, throttle: 1, brake: 1 });
      expect(car.speed).toBeLessThanOrEqual(previousSpeed + 1e-9);
      expect(simUnitsToMeters(car.velocityX)).toBeGreaterThanOrEqual(-1e-6);
      previousSpeed = car.speed;
    }
    expect(simUnitsToMeters(car.speed)).toBeLessThan(0.001);
    if (speedKph === 0) expect(simUnitsToMeters(Math.hypot(car.x, car.y))).toBeLessThan(1e-6);
  });

  test.each([
    { name: 'forward', velocityX: metersToSimUnits(30), velocityY: 0, yawRate: 0, steering: 0 },
    { name: 'reverse', velocityX: metersToSimUnits(-10), velocityY: 0, yawRate: 0.1, steering: 0.2 },
    { name: 'sideways', velocityX: 0, velocityY: metersToSimUnits(5), yawRate: 0.2, steering: 0 },
  ])('passive $name motion dissipates total kinetic energy', ({ velocityX, velocityY, yawRate, steering }) => {
    const car = createCar({ velocityX, velocityY, yawRate, steeringAngle: steering });
    const initialEnergy = kineticEnergy(car);
    let previousEnergy = initialEnergy;
    for (let index = 0; index < 480; index += 1) {
      step(car, { ...NEUTRAL, steering }, 1 / 240);
      const currentEnergy = kineticEnergy(car);
      expect(currentEnergy).toBeLessThanOrEqual(previousEnergy + Math.max(1e-6, initialEnergy * 1e-8));
      expect(stateSignature(car).every(Number.isFinite)).toBe(true);
      previousEnergy = currentEnergy;
    }
    expect(previousEnergy).toBeLessThan(initialEnergy);
  });

  test('left and right steering have mirrored physical responses', () => {
    const right = createCar({ speed: kphToSimSpeed(90) });
    const left = createCar({ speed: kphToSimSpeed(90) });
    for (let index = 0; index < 180; index += 1) {
      const steering = index < 90 ? 0.035 : -0.02;
      step(right, { steering, throttle: 0.15, brake: 0 });
      step(left, { steering: -steering, throttle: 0.15, brake: 0 });
      expect(left.x).toBeCloseTo(right.x, 7);
      expect(left.y).toBeCloseTo(-right.y, 7);
      expect(left.velocityX).toBeCloseTo(right.velocityX, 7);
      expect(left.velocityY).toBeCloseTo(-right.velocityY, 7);
      expect(left.heading).toBeCloseTo(-right.heading, 7);
      expect(left.yawRate).toBeCloseTo(-right.yawRate, 7);
      expect(left.speed).toBeCloseTo(right.speed, 7);
    }
  });

  test('world velocity, scalar speed and SI acceleration telemetry describe the same motion', () => {
    const car = createCar({ heading: 0.7, speed: kphToSimSpeed(80), steeringAngle: 0.025 });
    const before = { velocityX: car.velocityX, velocityY: car.velocityY };
    const dt = 1 / 240;
    step(car, { steering: 0.025, throttle: 0.35, brake: 0 }, dt);
    const accelerationX = simUnitsToMeters(car.velocityX - before.velocityX) / dt;
    const accelerationY = simUnitsToMeters(car.velocityY - before.velocityY) / dt;

    expect(car.speed).toBeCloseTo(Math.hypot(car.velocityX, car.velocityY), 8);
    expect(Math.hypot(car.longitudinalAcceleration, car.lateralAcceleration))
      .toBeCloseTo(Math.hypot(accelerationX, accelerationY), 5);
    expect(car.lateralG).toBeCloseTo(car.lateralAcceleration / GRAVITY, 8);
    expect(car.longitudinalG).toBeCloseTo(car.longitudinalAcceleration / GRAVITY, 8);
    expect(car.tireEnergy).toBe(100);
  });

  test('a benign steering maneuver converges across 60 Hz and 120 Hz calls', () => {
    const run = (hz) => {
      const car = createCar({ speed: kphToSimSpeed(72) });
      for (let index = 0; index < hz * 4; index += 1) {
        step(car, { steering: 0.025, throttle: 0.12, brake: 0 }, 1 / hz);
      }
      return car;
    };
    const first = run(60);
    const refined = run(120);

    expect(simUnitsToMeters(Math.hypot(first.x - refined.x, first.y - refined.y))).toBeLessThan(0.5);
    expect(Math.abs(first.heading - refined.heading)).toBeLessThan(0.02);
    expect(Math.abs(first.speed - refined.speed)).toBeLessThan(Math.max(metersToSimUnits(0.01), refined.speed * 0.02));
    expect(Math.abs(first.yawRate - refined.yawRate)).toBeLessThan(Math.max(0.005, Math.abs(refined.yawRate) * 0.02));
  });

  test('low-speed steady turning approaches wheelbase steering geometry', () => {
    const steering = 0.1;
    const car = createCar({ speed: metersToSimUnits(5), steeringAngle: steering });
    for (let index = 0; index < 120; index += 1) step(car, { ...NEUTRAL, steering });

    const forwardSpeed = simUnitsToMeters(car.velocityX * Math.cos(car.heading) + car.velocityY * Math.sin(car.heading));
    const kinematicYawRate = forwardSpeed * Math.tan(steering) / REAL_F1_WHEELBASE_METERS;
    expect(forwardSpeed).toBeGreaterThan(1);
    expect(car.yawRate).toBeGreaterThan(0);
    expect(Math.abs(car.yawRate - kinematicYawRate)).toBeLessThan(Math.abs(kinematicYawRate) * 0.2);
  });

  test('identical initial conditions and input sequences replay exactly', () => {
    const first = createCar({ speed: kphToSimSpeed(110) });
    const second = createCar({ speed: kphToSimSpeed(110) });
    for (let index = 0; index < 240; index += 1) {
      const controls = { steering: Math.sin(index / 40) * 0.04, throttle: index < 120 ? 0.25 : 0, brake: index >= 180 ? 0.15 : 0 };
      step(first, controls);
      step(second, controls);
      expect(stateSignature(first)).toEqual(stateSignature(second));
    }
  });

  test('baseline Formula-style setup stays within the measured acceleration envelope', () => {
    const car = createCar();
    let to100 = null;
    let to200 = null;
    for (let frame = 1; frame <= 600; frame += 1) {
      step(car, { steering: 0, throttle: 1, brake: 0 });
      if (to100 == null && car.speed >= kphToSimSpeed(100)) to100 = frame / 60;
      if (car.speed >= kphToSimSpeed(200)) { to200 = frame / 60; break; }
    }
    // Engineering calibration envelopes, not a claim of a particular real car.
    expect(to100).toBeGreaterThan(2.2);
    expect(to100).toBeLessThan(3.5);
    expect(to200).toBeGreaterThan(4);
    expect(to200).toBeLessThan(7);
  });

  test('aerodynamic load gives stronger high-speed braking with finite stopping distance', () => {
    const runs = [100, 300].map((speedKph) => {
      const car = createCar({ speed: kphToSimSpeed(speedKph) });
      let peakG = 0;
      for (let frame = 0; frame < 600 && car.speed > kphToSimSpeed(1); frame += 1) {
        step(car, { steering: 0, throttle: 0, brake: 1 });
        peakG = Math.max(peakG, -car.longitudinalG);
      }
      expect(car.speed).toBeLessThan(kphToSimSpeed(1));
      return { peakG, distance: simUnitsToMeters(car.x) };
    });
    expect(runs[0].distance).toBeGreaterThan(15);
    expect(runs[0].distance).toBeLessThan(30);
    expect(runs[1].distance).toBeGreaterThan(75);
    expect(runs[1].distance).toBeLessThan(130);
    expect(runs[1].peakG).toBeGreaterThan(runs[0].peakG * 2);
    expect(runs[1].peakG).toBeLessThan(7.5);
  });

});
