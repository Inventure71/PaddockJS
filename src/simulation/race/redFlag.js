import { clearCurrentDrsState } from '../timing/drsState.js';
import { freezeVehicleMotion } from '../vehicle/vehicleKinematics.js';

export function applyRedFlagHoldForSimulation(sim) {
  sim.cars.forEach((car) => {
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    freezeVehicleMotion(car, { physicsMode: sim.physicsMode });
    clearCurrentDrsState(car);
    car.canAttack = false;
  });
}
