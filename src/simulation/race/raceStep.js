import { decideDriverControls } from '../driverController.js';
import { clamp } from '../simMath.js';
import { integrateVehiclePhysics } from '../vehicle/vehiclePhysics.js';
import { applyRedFlagHoldForSimulation } from './redFlag.js';

export function runRaceStep(simulation, dt) {
  const delta = clamp(dt, 0, 1 / 20);
  if (!Number.isFinite(delta) || delta <= 0) return;

  simulation.time += delta;
  simulation.events = [];
  simulation.updateStartSequence();
  simulation.recalculateRaceState({ updateDrs: false });

  if (simulation.raceControl.mode === 'pre-start' && simulation.cars.every((car) => car.gridLocked)) {
    simulation.holdGridCars();
    simulation.recalculateRaceState({ updateDrs: false });
    return;
  }

  if (simulation.raceControl.redFlag) {
    applyRedFlagHoldForSimulation(simulation);
    simulation.recalculateRaceState({ updateDrs: false });
    return;
  }

  simulation.updateSafetyCar(delta);

  const orderedCars = simulation.orderedCars();
  const raceContext = simulation.driverRaceContext(orderedCars);
  orderedCars.forEach((car, index) => {
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    car.previousProgress = car.progress;
    if (simulation.advancePitStopCar(car, delta)) return;
    const controls = decideDriverControls({
      car,
      orderIndex: index,
      race: raceContext,
    });
    integrateVehiclePhysics(car, controls, delta);
    simulation.applyRunoffResponse(car);
    car.contactCooldown = Math.max(0, car.contactCooldown - delta);
  });

  simulation.resolveCollisions();
  simulation.recalculateRaceState();
  simulation.reviewTrackLimits();
  simulation.reviewPitLaneSpeeding();
}
