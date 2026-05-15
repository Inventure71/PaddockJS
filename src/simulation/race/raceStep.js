import { decideDriverControls } from '../driverController.js';
import { clamp } from '../simMath.js';
import { updateReplayGhosts } from '../replay/replayGhosts.js';
import { integrateVehiclePhysics } from '../vehicle/vehiclePhysics.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { applyRedFlagHoldForSimulation } from './redFlag.js';

export function runRaceStep(simulation, dt) {
  const delta = clamp(dt, 0, 1 / 20);
  if (!Number.isFinite(delta) || delta <= 0) return;

  simulation.time += delta;
  simulation.events = [];
  updateReplayGhosts(simulation.replayGhosts, simulation.time);
  simulation.updateStartSequence();
  const orderedCars = simulation.recalculateRaceState({ updateDrs: false }) ?? simulation.orderedCars();

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

  const raceContext = simulation.driverRaceContext(orderedCars);
  const orderedIndexById = new Map(orderedCars.map((car, index) => [car.id, index]));
  const driveCars = orderedCars.length === simulation.cars.length
    ? orderedCars
    : [
      ...orderedCars,
      ...simulation.cars.filter((car) => !orderedIndexById.has(car.id)),
    ];
  driveCars.forEach((car) => {
    if (car.destroyed) {
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      car.canAttack = false;
      return;
    }
    const orderIndex = orderedIndexById.get(car.id);
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    car.previousProgress = car.progress;
    if (simulation.advancePitStopCar(car, delta)) return;
    const controls = decideDriverControls({
      car,
      orderIndex: orderIndex ?? Math.max(0, car.index ?? 0),
      race: raceContext,
    });
    car.appliedControls = {
      steering: controls.steering ?? 0,
      throttle: controls.throttle ?? 0,
      brake: controls.brake ?? 0,
    };
    if (simulation.physicsMode === 'simulator') {
      applyWheelSurfaceState(car, simulation.track);
    }
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
