export function syncPitCarKinematics(car, { physicsMode = 'arcade' } = {}) {
  const speed = Number.isFinite(car.speed) ? car.speed : 0;
  const heading = Number.isFinite(car.heading) ? car.heading : 0;
  if (physicsMode === 'advanced') {
    car.velocityX = Math.cos(heading) * speed;
    car.velocityY = Math.sin(heading) * speed;
  } else {
    car.velocityX = null;
    car.velocityY = null;
  }
  car.appliedControls = {
    steering: car.steeringAngle ?? 0,
    throttle: car.throttle ?? 0,
    brake: car.brake ?? 0,
  };
  car.lateralAcceleration = 0;
  car.longitudinalAcceleration = 0;
  car.lateralG = 0;
  car.longitudinalG = 0;
  car.gripUsage = 0;
  car.slipAngleRadians = 0;
  car.tractionLimited = false;
  car.stabilityState = 'stable';
}
