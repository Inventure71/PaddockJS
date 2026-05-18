import { markCarDnf } from './retirements.js';
import { simSpeedToKph } from '../units.js';

const LEGAL_STALL_SURFACES = new Set(['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box']);

export function updateStalledDnfForSimulation(sim, dt) {
  const config = sim.rules.modules?.stalledDnf;
  if (!config?.enabled) {
    sim.cars.forEach(resetStallTimer);
    return false;
  }
  if (sim.raceControl.mode === 'pre-start' || sim.raceControl.redFlag || sim.raceControl.finished) {
    sim.cars.forEach(resetStallTimer);
    return false;
  }

  let retired = false;
  sim.cars.forEach((car) => {
    if (!isEligibleForStalledDnf(sim, car, config)) {
      resetStallTimer(car);
      return;
    }
    car.stalledOffTrackSeconds = (car.stalledOffTrackSeconds ?? 0) + dt;
    if (car.stalledOffTrackSeconds + Number.EPSILON < config.maxStoppedSeconds) return;
    retireStalledCar(sim, car);
    retired = true;
  });
  return retired;
}

function isEligibleForStalledDnf(sim, car, config) {
  if (!car || car.finished || car.destroyed || car.outOfRace) return false;
  if (sim.isCarInActivePitStop(car)) return false;
  if (car.trackState?.inPitLane) return false;
  if (simSpeedToKph(car.speed ?? 0) > config.speedThresholdKph) return false;
  return isOffTrackForStalledDnf(car);
}

function isOffTrackForStalledDnf(car) {
  const wheels = Array.isArray(car.wheelStates) ? car.wheelStates : [];
  if (wheels.length) {
    return wheels.some((wheel) => !wheel.onTrack && !LEGAL_STALL_SURFACES.has(wheel.surface));
  }
  return !LEGAL_STALL_SURFACES.has(car.trackState?.surface ?? 'track');
}

function retireStalledCar(sim, car) {
  if (car.finished || car.destroyed || car.outOfRace) return;
  car.outOfRace = true;
  markCarDnf(sim, car, { reason: 'stalled-off-track' });
  freezeRetiredCar(car);
  sim.events.unshift({
    type: 'car-dnf',
    at: sim.time,
    carId: car.id,
    driverId: car.id,
    reason: 'stalled-off-track',
  });
}

export function freezeRetiredCar(car) {
  car.speed = 0;
  car.velocityX = 0;
  car.velocityY = 0;
  car.throttle = 0;
  car.brake = 1;
  car.appliedControls = { steering: 0, throttle: 0, brake: 1 };
  car.manualControls = null;
  car.canAttack = false;
  car.drsActive = false;
  car.drsEligible = false;
  car.drsZoneId = null;
  car.drsZoneEnabled = false;
  car.steeringAngle = 0;
  car.yawRate = 0;
  car.longitudinalAcceleration = 0;
  car.lateralAcceleration = 0;
  car.longitudinalG = 0;
  car.lateralG = 0;
  car.tractionLimited = false;
  car.stabilityState = 'destroyed';
}

function resetStallTimer(car) {
  if (car) car.stalledOffTrackSeconds = 0;
}
