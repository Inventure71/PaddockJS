export function applyRedFlagHoldForSimulation(sim) {
  sim.cars.forEach((car) => {
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    car.speed = 0;
    car.throttle = 0;
    car.brake = 1;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.canAttack = false;
  });
}
