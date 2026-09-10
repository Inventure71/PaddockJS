import { describe, expect, test } from 'vitest';
import { createDemoOptions } from '../../demo/src/data/demoOptions.js';
import { createExpertKeyboardController } from '../../demo/src/runtime/expertKeyboard.js';
import { normalizeSimulatorDrivers } from '../data/index.js';
import { normalizeAction } from '../environment/actions.js';
import { buildBodySenses } from '../environment/sensors/bodySenses.js';
import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { kphToSimSpeed, simSpeedToKph } from '../simulation/units.js';
import { integrateVehiclePhysics } from '../simulation/vehicle/vehiclePhysics.js';

function createDrivingFixture(speedKph, driverId = 'budget') {
  const options = createDemoOptions({ seed: 171, trackSeed: 7301, physicsMode: 'advanced' });
  const sim = createRaceSimulation({
    ...options,
    drivers: normalizeSimulatorDrivers(options.drivers, { entries: options.entries }),
  });
  const car = sim.cars.find((entry) => entry.id === driverId);
  Object.assign(car, {
    x: 0, y: 0, heading: 0, yawRate: 0, steeringAngle: 0,
    speed: kphToSimSpeed(speedKph), velocityX: kphToSimSpeed(speedKph), velocityY: 0,
    longitudinalAcceleration: 0, lateralAcceleration: 0, slipAngleRadians: 0,
    throttle: 0, brake: 0, gripUsage: 0,
  });
  // Continuous asphalt isolates keyboard response from barriers, contacts and AI.
  // The car still uses the lab's real entry ratings and unmodified tire forces.
  car.trackState = { ...car.trackState, surface: 'track' };
  car.wheelStates.forEach((wheel) => { wheel.surface = 'track'; });

  const handlers = new Map();
  const root = {
    contains: () => false,
    getBoundingClientRect: () => ({ width: 800, height: 500, top: 0, left: 0, bottom: 500, right: 800 }),
    addEventListener() {}, removeEventListener() {},
  };
  const windowTarget = {
    innerWidth: 1200, innerHeight: 900,
    addEventListener: (name, listener) => handlers.set(name, listener),
    removeEventListener: (name) => handlers.delete(name),
  };
  const documentTarget = {
    activeElement: root, hidden: false, visibilityState: 'visible', hasFocus: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const keyboard = createExpertKeyboardController({ root, workspace: { hidden: false }, windowTarget, documentTarget });
  const history = [];
  let frame = 0;
  let controls;

  return {
    car, history,
    key(type, code) { handlers.get(type)({ code, target: root, preventDefault() {} }); },
    drive(seconds) {
      for (let index = 0; index < Math.round(seconds / FIXED_STEP); index += 1) {
        if (frame % 2 === 0) {
          const snapshot = sim.snapshotObservation().cars.find((entry) => entry.id === car.id);
          const action = keyboard.decideBatch({
            controlledDrivers: [car.id], actionRepeat: 2,
            info: { elapsedSeconds: frame * FIXED_STEP },
            observation: { [car.id]: { object: { self: buildBodySenses(snapshot) } } },
          })[car.id];
          controls = normalizeAction(action, car.id);
        }
        car.appliedControls = controls;
        integrateVehiclePhysics(car, controls, FIXED_STEP, { physicsMode: 'advanced', tireDegradationEnabled: false });
        history.push({
          speedKph: simSpeedToKph(car.speed), heading: car.heading, yaw: car.yawRate,
          steering: car.steeringAngle, slip: car.slipAngleRadians,
          lateralG: car.lateralG, grip: car.gripUsage, throttle: car.throttle,
        });
        frame += 1;
      }
    },
    destroy: keyboard.destroy,
  };
}

function peak(history, field) {
  return Math.max(...history.map((sample) => Math.abs(sample[field])));
}

describe('human keyboard control through advanced tire physics', () => {
  test.each([80, 150, 250])('a short left/right tap at %s km/h produces a small turn without overloading the tires', (speedKph) => {
    const outcomes = [];
    for (const [key, sign] of [['ArrowLeft', -1], ['ArrowRight', 1]]) {
      const input = createDrivingFixture(speedKph);
      try {
        input.key('keydown', key);
        input.drive(0.3);
        input.key('keyup', key);
        input.drive(0.7);
        expect(input.car.heading * sign).toBeGreaterThan(0.005);
        expect(Math.abs(input.car.heading)).toBeLessThan(0.08);
        expect(peak(input.history, 'lateralG')).toBeLessThan(0.7);
        expect(peak(input.history, 'grip')).toBeLessThan(1);
        expect(peak(input.history, 'slip')).toBeLessThan(0.05);
        expect(input.car.steeringAngle).toBeCloseTo(0, 10);
        outcomes.push(input.car.heading);
      } finally { input.destroy(); }
    }
    expect(outcomes[0]).toBeCloseTo(-outcomes[1], 10);
  });

  test.each([30, 60, 100, 160, 220])('holding accelerator and steering at %s km/h preserves directional stability', (speedKph) => {
    const input = createDrivingFixture(speedKph);
    try {
      input.key('keydown', 'ArrowUp');
      input.key('keydown', 'ArrowRight');
      input.drive(2);
      expect(simSpeedToKph(input.car.speed)).toBeGreaterThan(speedKph);
      input.key('keyup', 'ArrowRight');
      input.drive(0.7);
      expect(peak(input.history, 'slip')).toBeLessThan(0.15);
      expect(input.car.steeringAngle).toBeCloseTo(0, 10);
      expect(input.history.every((sample) => Object.values(sample).every(Number.isFinite))).toBe(true);
    } finally { input.destroy(); }
  });

  test.each([['vinyl', 60], ['core', 100]])('combined input remains controllable with the %s entry ratings', (driverId, speedKph) => {
    const input = createDrivingFixture(speedKph, driverId);
    try {
      input.key('keydown', 'ArrowUp');
      input.key('keydown', 'ArrowLeft');
      input.drive(2);
      input.key('keyup', 'ArrowLeft');
      input.drive(0.7);
      expect(peak(input.history, 'slip')).toBeLessThan(0.15);
      expect(simSpeedToKph(input.car.speed)).toBeGreaterThan(speedKph);
    } finally { input.destroy(); }
  });

  test.each([60, 100])('releasing a steering tap while keeping accelerator held at %s km/h does not spin on exit', (speedKph) => {
    const input = createDrivingFixture(speedKph);
    try {
      input.key('keydown', 'ArrowUp');
      input.key('keydown', 'ArrowRight');
      input.drive(0.3);
      input.key('keyup', 'ArrowRight');
      input.drive(0.7);
      expect(peak(input.history, 'slip')).toBeLessThan(0.1);
      expect(input.car.steeringAngle).toBeCloseTo(0, 10);
      expect(simSpeedToKph(input.car.speed)).toBeGreaterThan(speedKph);
    } finally { input.destroy(); }
  });

  test('countersteering reverses yaw and the same timed key sequence is deterministic', () => {
    function run() {
      const input = createDrivingFixture(100);
      try {
        input.key('keydown', 'ArrowRight');
        input.drive(0.3);
        expect(input.car.yawRate).toBeGreaterThan(0);
        input.key('keyup', 'ArrowRight');
        input.key('keydown', 'ArrowLeft');
        input.drive(0.5);
        expect(input.car.yawRate).toBeLessThan(0);
        input.key('keyup', 'ArrowLeft');
        input.drive(0.7);
        expect(input.car.steeringAngle).toBeCloseTo(0, 10);
        expect(peak(input.history, 'slip')).toBeLessThan(0.1);
        return input.history;
      } finally { input.destroy(); }
    }
    expect(run()).toEqual(run());
  });
});
