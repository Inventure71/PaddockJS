#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Optional source root lets the same maneuvers characterize the preserved model.
const root = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const { integrateVehiclePhysics } = await import(pathToFileURL(resolve(root, 'src/simulation/vehicle/vehiclePhysics.js')));
const dt = 1 / 60;
const options = { physicsMode: 'advanced', tireDegradationEnabled: false };
function car(speedKph = 0, overrides = {}) {
  return {
    x: 0, y: 0, heading: 0, steeringAngle: 0, yawRate: 0, speed: speedKph / 3.6 * 12,
    mass: 798, powerNewtons: 43000, brakeNewtons: 59000, dragCoefficient: 0.33,
    downforceCoefficient: 6.1, tireGrip: 2.35, tireEnergy: 100, tireCare: 1,
    trackState: { surface: 'track' }, wheelStates: [], ...overrides,
  };
}
function step(vehicle, controls) { integrateVehiclePhysics(vehicle, controls, dt, options); }
const started = performance.now();
const acceleration = [];
for (const drsActive of [false, true]) {
  const vehicle = car(0, { drsActive });
  const crossings = {};
  for (let frame = 1; frame <= 60 / dt; frame += 1) {
    step(vehicle, { steering: 0, throttle: 1, brake: 0 });
    for (const speed of [100, 200, 300]) {
      if (crossings[speed] == null && vehicle.speed * 0.3 >= speed) crossings[speed] = frame * dt;
    }
  }
  acceleration.push({ drsActive, secondsToKph: crossings, speedAt60SecondsKph: vehicle.speed * 0.3 });
}
const braking = [];
for (const initialKph of [100, 200, 300]) {
  const vehicle = car(initialKph);
  let frames = 0;
  let peakG = 0;
  while (vehicle.speed * 0.3 > 1 && frames < 20 / dt) {
    step(vehicle, { steering: 0, throttle: 0, brake: 1 });
    frames += 1;
    peakG = Math.max(peakG, -vehicle.longitudinalG);
  }
  braking.push({ initialKph, finalKph: vehicle.speed * 0.3, seconds: frames * dt, meters: vehicle.x / 12, peakG });
}
const cornering = [];
for (const initialKph of [100, 200, 300]) {
  for (const steering of [0.02, 0.04, 0.08]) {
    const vehicle = car(initialKph);
    let peakLateralG = 0;
    for (let frame = 0; frame < 2 / dt; frame += 1) {
      step(vehicle, { steering, throttle: 0.2, brake: 0 });
      peakLateralG = Math.max(peakLateralG, Math.abs(vehicle.lateralG));
    }
    cornering.push({ initialKph, steeringRadians: steering, finalKph: vehicle.speed * 0.3, peakLateralG, finalSlipRadians: vehicle.slipAngleRadians, finalYawRadiansPerSecond: vehicle.yawRate });
  }
}
console.log(JSON.stringify({ sourceRoot: root, node: process.version, platform: process.platform, arch: process.arch, timestepSeconds: dt, tireDegradation: false, acceleration, braking, cornering, runtimeMilliseconds: performance.now() - started }, null, 2));
