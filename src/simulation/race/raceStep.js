import { decideDriverControls } from '../driverController.js';
import { clamp } from '../simMath.js';
import { updateReplayGhosts } from '../replay/replayGhosts.js';
import { integrateVehiclePhysics } from '../vehicle/vehiclePhysics.js';
import { applyRedFlagHoldForSimulation } from './redFlag.js';

export function runRaceStep(simulation, dt) {
  const delta = clamp(dt, 0, 1 / 20);
  if (!Number.isFinite(delta) || delta <= 0) return;

  simulation.time += delta;
  simulation.events = [];
  updateReplayGhosts(simulation.replayGhosts, simulation.time);
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
  const orderedIds = new Set(orderedCars.map((car) => car.id));
  const driveCars = [
    ...orderedCars,
    ...simulation.cars.filter((car) => !orderedIds.has(car.id)),
  ];
  driveCars.forEach((car) => {
    if (car.destroyed) {
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      car.canAttack = false;
      return;
    }
    const orderIndex = orderedCars.findIndex((orderedCar) => orderedCar.id === car.id);
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    car.previousProgress = car.progress;
    if (simulation.advancePitStopCar(car, delta)) return;
    const controls = decideDriverControls({
      car,
      orderIndex: orderIndex < 0 ? Math.max(0, car.index ?? 0) : orderIndex,
      race: raceContext,
    });
    car.appliedControls = {
      steering: controls.steering ?? 0,
      throttle: controls.throttle ?? 0,
      brake: controls.brake ?? 0,
    };
    integrateVehiclePhysics(car, controls, delta, {
      physicsMode: simulation.physicsMode,
      tireDegradationEnabled: simulation.rules.modules?.tireDegradation?.enabled !== false,
    });
    simulation.applyRunoffResponse(car);
    car.contactCooldown = Math.max(0, car.contactCooldown - delta);
  });

  simulation.resolveCollisions();
  simulation.recalculateRaceState();
  simulation.reviewTrackLimits();
  simulation.reviewPitLaneSpeeding();
}
