import { freezeVehicleMotion } from '../vehicle/vehicleKinematics.js';

export function applyRedFlagHoldForSimulation(sim) {
  sim.cars.forEach((car) => {
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    freezeVehicleMotion(car, { physicsMode: sim.physicsMode });
    car.drsActive = false;
    car.drsEligible = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.canAttack = false;
  });
}
