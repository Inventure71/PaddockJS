import { normalizeAngle } from '../simMath.js';

export function freezeVehicleMotion(car, {
  brake = 1,
  clearManualControls = false,
  physicsMode = 'arcade',
  stabilityState = car.stabilityState ?? 'stable',
} = {}) {
  car.speed = 0;
  if (physicsMode === 'advanced') {
    car.velocityX = 0;
    car.velocityY = 0;
  } else {
    car.velocityX = null;
    car.velocityY = null;
  }
  car.throttle = 0;
  car.brake = brake;
  car.appliedControls = { steering: 0, throttle: 0, brake };
  if (clearManualControls) car.manualControls = null;
  car.steeringAngle = 0;
  car.yawRate = 0;
  car.turnRadius = Infinity;
  car.longitudinalAcceleration = 0;
  car.lateralAcceleration = 0;
  car.longitudinalG = 0;
  car.lateralG = 0;
  car.gripUsage = 0;
  car.slipAngleRadians = 0;
  car.tractionLimited = false;
  car.stabilityState = stabilityState;
}

export function syncVehicleVelocityToHeading(car) {
  const speed = Number.isFinite(car.speed) ? car.speed : 0;
  const heading = Number.isFinite(car.heading) ? car.heading : 0;
  car.velocityX = Math.cos(heading) * speed;
  car.velocityY = Math.sin(heading) * speed;
}

export function shiftPreviousRenderPose(car, dx, dy, dheading = 0) {
  car.previousX = Number.isFinite(car.previousX) ? car.previousX + dx : car.x + dx;
  car.previousY = Number.isFinite(car.previousY) ? car.previousY + dy : car.y + dy;
  car.previousHeading = normalizeAngle(
    (Number.isFinite(car.previousHeading) ? car.previousHeading : car.heading) + dheading,
  );
}
