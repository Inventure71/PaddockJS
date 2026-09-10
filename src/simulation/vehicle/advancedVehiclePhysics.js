import { clamp, normalizeAngle } from '../simMath.js';
import { SIM_UNITS_PER_METER, TOP_SPEED_SIM_UNITS_PER_SECOND } from '../units.js';
import { ADVANCED_VEHICLE_MODEL as MODEL, ADVANCED_WHEELS, advancedWheelSurface, advancedDriveForce, advancedDragFactor } from './advancedVehicleModel.js';
import { advancedNormalLoads, advancedTireForce } from './advancedTireForces.js';

export function integrateAdvancedVehiclePhysics(car, controls, dt, { tireFactor, tireDegradationEnabled, maxSteer, steerRate }) {
  if (!(dt > 0) || !Number.isFinite(dt)) return car;
  if (!Number.isFinite(car.velocityX) || !Number.isFinite(car.velocityY)) {
    car.velocityX = Math.cos(car.heading) * car.speed;
    car.velocityY = Math.sin(car.heading) * car.speed;
  }
  const throttle = clamp(controls.throttle ?? 0, 0, 1);
  const brake = clamp(controls.brake ?? 0, 0, 1);
  const steeringTarget = clamp(controls.steering ?? 0, -maxSteer, maxSteer);
  const steps = Math.ceil(dt / MODEL.maxIntegrationStep);
  const h = dt / steps;
  const initialVelocityX = car.velocityX / SIM_UNITS_PER_METER;
  const initialVelocityY = car.velocityY / SIM_UNITS_PER_METER;
  const initialHeading = car.heading;
  let frontUsage = 0;
  let rearUsage = 0;
  let resistanceYawAcceleration = 0;
  for (let step = 0; step < steps; step += 1) {
    car.steeringAngle += clamp(steeringTarget - car.steeringAngle, -steerRate * h, steerRate * h);
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const vx = car.velocityX / SIM_UNITS_PER_METER;
    const vy = car.velocityY / SIM_UNITS_PER_METER;
    const u = vx * cos + vy * sin;
    const v = -vx * sin + vy * cos;
    const speed = Math.hypot(vx, vy);
    const yaw = car.yawRate ?? 0;
    const loads = advancedNormalLoads(car, speed, car.longitudinalAcceleration ?? 0, car.lateralAcceleration ?? 0);
    // The existing newton-valued power rating defines launch force. Above the
    // crossover speed, the envelope is constant power instead of constant force.
    const drive = throttle * advancedDriveForce(car, u);
    let fx = 0;
    let fy = 0;
    let moment = 0;
    let resistanceMoment = 0;
    frontUsage = 0;
    rearUsage = 0;
    for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
      const wheel = ADVANCED_WHEELS[index];
      const { x, y } = wheel;
      const steer = wheel.front ? car.steeringAngle : 0;
      const cs = Math.cos(steer);
      const sn = Math.sin(steer);
      const wheelU = (u - yaw * y) * cs + (v + yaw * x) * sn;
      const wheelV = -(u - yaw * y) * sn + (v + yaw * x) * cs;
      const surface = advancedWheelSurface(car, wheel.id);
      const engine = wheel.front ? 0 : drive / 2;
      const brakeDemand = brake * car.brakeNewtons * (wheel.front ? MODEL.frontBrakeFraction : 1 - MODEL.frontBrakeFraction) / 2;
      // Brake/static resistance cannot manufacture a reverse launch at rest.
      const brakingDirection = Math.sign(wheelU || engine);
      const longitudinalLever = x * sn - y * cs;
      const inverseContactMass = 1 / car.mass + longitudinalLever ** 2 / (car.mass * MODEL.yawInertiaPerMass);
      // Four simultaneous contacts share the stopping impulse. Include yaw
      // inertia and share the budget between braking and rolling resistance;
      // independently spending it twice would create motion near rest.
      const stoppingBudget = Math.abs(wheelU) / (4 * h * inverseContactMass);
      const braking = brakingDirection * Math.min(brakeDemand, stoppingBudget + engine);
      const remainingBudget = Math.max(0, stoppingBudget - Math.max(0, (braking - engine) * Math.sign(wheelU)));
      const rolling = Math.sign(wheelU) * Math.min(surface.rolling * loads[index], remainingBudget);
      const nominalLoad = car.mass * MODEL.gravity * (wheel.front ? MODEL.frontWeightFraction : 1 - MODEL.frontWeightFraction) / 2;
      const tire = advancedTireForce({
        normalLoad: loads[index], nominalLoad, grip: car.tireGrip, tireFactor, surface,
        longitudinalDemand: engine - braking, forwardVelocity: wheelU, lateralVelocity: wheelV,
      });
      const wheelFx = tire.longitudinal - rolling;
      const bodyFx = wheelFx * cs - tire.lateral * sn;
      const bodyFy = wheelFx * sn + tire.lateral * cs;
      fx += bodyFx;
      fy += bodyFy;
      moment += x * bodyFy - y * bodyFx;
      resistanceMoment += x * (-rolling * sn) - y * (-rolling * cs);
      if (wheel.front) frontUsage = Math.max(frontUsage, tire.usage);
      else rearUsage = Math.max(rearUsage, tire.usage);
    }
    const dragFactor = advancedDragFactor(car);
    fx -= dragFactor * speed * u;
    fy -= dragFactor * speed * v;
    car.longitudinalAcceleration = fx / car.mass;
    car.lateralAcceleration = fy / car.mass;
    const ax = (fx * cos - fy * sin) / car.mass;
    const ay = (fx * sin + fy * cos) / car.mass;
    car.velocityX += ax * h * SIM_UNITS_PER_METER;
    car.velocityY += ay * h * SIM_UNITS_PER_METER;
    car.yawRate = yaw + moment / (car.mass * MODEL.yawInertiaPerMass) * h;
    resistanceYawAcceleration = resistanceMoment / (car.mass * MODEL.yawInertiaPerMass);
    car.heading = normalizeAngle(car.heading + car.yawRate * h);
    car.speed = Math.hypot(car.velocityX, car.velocityY);
    // Retain the package's supported top-speed envelope, including externally
    // placed cars. Engine/drag balance determines normal acceleration below it.
    if (car.speed > TOP_SPEED_SIM_UNITS_PER_SECOND) {
      const scale = TOP_SPEED_SIM_UNITS_PER_SECOND / car.speed;
      car.velocityX *= scale;
      car.velocityY *= scale;
      car.speed = TOP_SPEED_SIM_UNITS_PER_SECOND;
    }
    car.x += car.velocityX * h;
    car.y += car.velocityY * h;
  }
  const ax = (car.velocityX / SIM_UNITS_PER_METER - initialVelocityX) / dt;
  const ay = (car.velocityY / SIM_UNITS_PER_METER - initialVelocityY) / dt;
  car.longitudinalAcceleration = ax * Math.cos(initialHeading) + ay * Math.sin(initialHeading);
  car.lateralAcceleration = -ax * Math.sin(initialHeading) + ay * Math.cos(initialHeading);
  car.longitudinalG = car.longitudinalAcceleration / MODEL.gravity;
  car.lateralG = car.lateralAcceleration / MODEL.gravity;
  car.gripUsage = Math.max(frontUsage, rearUsage);
  car.slipAngleRadians = car.speed > 0.01 ? normalizeAngle(Math.atan2(car.velocityY, car.velocityX) - car.heading) : 0;
  car.tractionLimited = car.gripUsage > 1;
  car.stabilityState = Math.abs(car.slipAngleRadians) > 0.35 ? 'spin-risk'
    : rearUsage > 1 && rearUsage > frontUsage * 1.15 ? 'oversteer'
      : frontUsage > 1 ? 'understeer' : 'stable';
  car.wheelDragYawRate = resistanceYawAcceleration * dt;
  car.steerSaturation = 1 / Math.max(1, frontUsage);
  car.turnRadius = Math.abs(car.yawRate) < 0.001 ? Infinity : car.speed / Math.abs(car.yawRate);
  car.throttle = throttle;
  car.brake = brake;
  if (tireDegradationEnabled !== false) {
    const care = clamp(Number(car.tireCare) || 1, 0.45, 1.8);
    const wear = (0.035 + Math.abs(car.lateralG) * 0.11 + brake * 0.07 + throttle * 0.025 + Math.max(0, car.gripUsage - 1) * 0.03) / care;
    car.tireEnergy = clamp((car.tireEnergy ?? 100) - wear * dt, 1, 100);
  }
  return car;
}
