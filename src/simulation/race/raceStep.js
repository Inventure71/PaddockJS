import { decideDriverControls } from '../driver/driverController.js';
import { clamp } from '../simMath.js';
import { updateReplayGhosts } from '../replay/replayGhosts.js';
import { integrateVehiclePhysics, isSimulatorPhysicsMode } from '../vehicle/vehiclePhysics.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { applyRedFlagHoldForSimulation } from './redFlag.js';
import { freezeRetiredCar, updateStalledDnfForSimulation } from './stalledDnf.js';

function measureRuntimePhase(simulation, name, run) {
  const profiler = simulation.runtimeProfiler;
  return typeof profiler?.measure === 'function'
    ? profiler.measure(name, run)
    : run();
}

export function runRaceStep(simulation, dt) {
  const delta = clamp(dt, 0, 1 / 20);
  if (!Number.isFinite(delta) || delta <= 0) return;

  simulation.time += delta;
  simulation.events = [];
  updateReplayGhosts(simulation.replayGhosts, simulation.time);
  simulation.updateStartSequence();

  if (simulation.raceControl.mode === 'pre-start' && simulation.cars.every((car) => car.gridLocked)) {
    simulation.holdGridCars();
    measureRuntimePhase(simulation, 'broadRaceCommit', () => simulation.recalculateRaceState({ updateDrs: false }));
    return;
  }

  if (simulation.raceControl.redFlag) {
    applyRedFlagHoldForSimulation(simulation);
    measureRuntimePhase(simulation, 'broadRaceCommit', () => simulation.recalculateRaceState({ updateDrs: false }));
    return;
  }

  simulation.updateSafetyCar(delta);

  const orderedCars = simulation.orderedCars();
  const raceContext = simulation.driverRaceContext(orderedCars);
  for (let index = 0; index < simulation.cars.length; index += 1) {
    simulation.cars[index]._driveOrderIndex = -1;
  }
  for (let index = 0; index < orderedCars.length; index += 1) {
    orderedCars[index]._driveOrderIndex = index;
  }
  let driveCars = orderedCars;
  if (orderedCars.length !== simulation.cars.length) {
    driveCars = simulation._driveCarsScratch ??= [];
    driveCars.length = 0;
    driveCars.push(...orderedCars);
    for (let index = 0; index < simulation.cars.length; index += 1) {
      const car = simulation.cars[index];
      if (car._driveOrderIndex === -1) driveCars.push(car);
    }
  }
  driveCars.forEach((car) => {
    if (car.destroyed || car.outOfRace) {
      freezeRetiredCar(car, { physicsMode: simulation.physicsMode });
      return;
    }
    const orderIndex = car._driveOrderIndex >= 0 ? car._driveOrderIndex : undefined;
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
    if (isSimulatorPhysicsMode(simulation.physicsMode)) {
      measureRuntimePhase(simulation, 'prePhysicsWheelSurface', () => {
        applyWheelSurfaceState(car, simulation.track);
      });
    }
    measureRuntimePhase(simulation, 'physicsIntegration', () => {
      integrateVehiclePhysics(car, controls, delta, {
        physicsMode: simulation.physicsMode,
        tireDegradationEnabled: simulation.rules.modules?.tireDegradation?.enabled !== false,
      });
    });
    measureRuntimePhase(simulation, 'runoffResponse', () => {
      simulation.applyRunoffResponse(car);
    });
    car.contactCooldown = Math.max(0, car.contactCooldown - delta);
  });

  measureRuntimePhase(simulation, 'collisions', () => simulation.resolveCollisions());
  measureRuntimePhase(simulation, 'localSurfaceRefresh', () => simulation.refreshLocalRaceState());
  updateStalledDnfForSimulation(simulation, delta);
  measureRuntimePhase(simulation, 'broadRaceCommit', () => simulation.recalculateRaceState({ refreshSurfaces: false }));
  simulation.reviewTrackLimits();
  simulation.reviewPitLaneSpeeding();
}
