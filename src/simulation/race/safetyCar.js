import { pointAt } from '../trackModel.js';
import { kphToSimSpeed } from '../units.js';

export function setSafetyCarState(sim, deployed) {
  const next = Boolean(deployed);
  if (sim.raceControl.finished) return;
  if (next && sim.raceControl.mode === 'pre-start') return;
  if (sim.raceControl.redFlag) return;
  if (next === sim.safetyCar.deployed) return;
  const ordered = sim.orderedCars();
  sim.safetyCar.deployed = next;
  sim.raceControl.mode = next ? 'safety-car' : 'green';
  sim.raceControl.frozenOrder = next ? ordered.map((car) => car.id) : null;
  if (next) {
    const leader = ordered[0];
    const safetyCarProgress = (leader?.raceDistance ?? 0) + sim.rules.safetyCarLeadDistance;
    if (sim.safetyCar.progress < safetyCarProgress) {
      moveSafetyCarTo(sim, safetyCarProgress);
    }
    sim.cars.forEach((car) => {
      car.desiredOffset = 0;
      car.drsActive = false;
      car.drsEligible = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
    });
  }
  sim.events.unshift({ type: next ? 'safety-car' : 'green-flag', at: sim.time });
}

export function updateSafetyCarState(sim, dt) {
  if (!sim.safetyCar.deployed) return;
  const leader = sim.orderedCars()[0];
  const targetProgress = (leader?.raceDistance ?? 0) + sim.rules.safetyCarLeadDistance;
  const progress = sim.safetyCar.progress < targetProgress
    ? Math.min(sim.safetyCar.progress + sim.safetyCar.speed * dt, targetProgress)
    : targetProgress;
  moveSafetyCarTo(sim, progress);
}

export function moveSafetyCarTo(sim, progress) {
  const point = pointAt(sim.track, progress);
  sim.safetyCar.previousX = sim.safetyCar.x;
  sim.safetyCar.previousY = sim.safetyCar.y;
  sim.safetyCar.previousHeading = sim.safetyCar.heading;
  sim.safetyCar.progress = progress;
  sim.safetyCar.x = point.x;
  sim.safetyCar.y = point.y;
  sim.safetyCar.heading = point.heading;
}

export function setRedFlagState(sim, deployed) {
  const next = Boolean(deployed);
  if (sim.raceControl.finished) return;
  if (next && sim.raceControl.mode === 'pre-start') return;
  if (next === Boolean(sim.raceControl.redFlag)) return;
  sim.raceControl.redFlag = next;
  if (next) {
    sim.safetyCar.deployed = false;
    sim.raceControl.mode = 'red-flag';
    sim.raceControl.frozenOrder = sim.orderedCars().map((car) => car.id);
    sim.cars.forEach((car) => {
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      car.drsActive = false;
      car.drsEligible = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
    });
  } else {
    sim.raceControl.mode = sim.safetyCar.deployed ? 'safety-car' : 'green';
    sim.raceControl.frozenOrder = sim.safetyCar.deployed
      ? sim.orderedCars().map((car) => car.id)
      : null;
    sim.cars.forEach((car) => {
      if (!car.finished) {
        car.speed = Math.max(car.speed, kphToSimSpeed(60));
        car.brake = 0;
        car.throttle = Math.max(car.throttle ?? 0, 0.35);
      }
    });
  }
  sim.events.unshift({ type: next ? 'red-flag' : 'green-flag', at: sim.time });
}

