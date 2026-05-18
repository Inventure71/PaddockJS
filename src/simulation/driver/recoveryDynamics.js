import { normalizeAngle } from '../simMath.js';
import { simUnitsToMeters } from '../units.js';

export function analyzeTrackEdgeMotion(car, race) {
  const state = car.trackState ?? {};
  const signedOffset = Number(state.signedOffset ?? 0);
  const side = Math.sign(signedOffset);
  const heading = Number(car.heading ?? 0);
  const normalX = Number(state.normalX ?? 0);
  const normalY = Number(state.normalY ?? 0);
  const velocity = resolveVelocity(car);
  const signedLateralVelocity = velocity.x * normalX + velocity.y * normalY;
  const outwardVelocity = side === 0 ? 0 : signedLateralVelocity * side;
  const headingDelta = normalizeAngle(heading - Number(state.heading ?? heading));
  const trackLimit = race?.track?.width != null ? race.track.width / 2 : 0;

  return {
    side,
    signedOffset,
    headingDelta,
    headingOutward: side !== 0 && Math.sign(headingDelta) === side,
    outwardSpeedMps: simUnitsToMeters(Math.max(0, outwardVelocity)),
    inwardSpeedMps: simUnitsToMeters(Math.max(0, -outwardVelocity)),
    distanceFromRoadMeters: simUnitsToMeters(Math.max(0, Number(state.crossTrackError ?? 0) - trackLimit)),
  };
}

function resolveVelocity(car) {
  if (Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)) {
    return { x: car.velocityX, y: car.velocityY };
  }
  const heading = Number(car.heading ?? 0);
  const speed = Number(car.speed ?? 0);
  return {
    x: Math.cos(heading) * speed,
    y: Math.sin(heading) * speed,
  };
}
