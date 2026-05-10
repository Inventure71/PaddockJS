import { normalizeAngle } from '../simMath.js';
import { GENERATED_TRACK_MAX_LENGTH, GENERATED_TRACK_MIN_LENGTH, MAX_LOCAL_TURN_RADIANS, MAX_SAMPLE_HEADING_DELTA_RADIANS, MIN_NON_ADJACENT_ARC_DISTANCE, MIN_TRACK_CLEARANCE_MULTIPLIER, MIN_TRACK_SHAPE_VARIATION, TRACK_BOUNDARY_PADDING, WORLD } from './trackConstants.js';
import { distance, segmentsIntersect } from './trackMath.js';

export function hasSelfIntersections(samples) {
  const points = samples.slice(0, -1).filter((_, index) => index % 12 === 0);
  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      const sharesLoopClosure = first === 0 && second >= points.length - 3;
      if (sharesLoopClosure) continue;
      if (segmentsIntersect(points[first], points[first + 1], points[second], points[second + 1])) return true;
    }
  }
  return false;
}

export function samplesStayInsideWorld(samples) {
  return samples.every((sample) => (
    sample.x >= TRACK_BOUNDARY_PADDING &&
    sample.x <= WORLD.width - TRACK_BOUNDARY_PADDING &&
    sample.y >= TRACK_BOUNDARY_PADDING &&
    sample.y <= WORLD.height - TRACK_BOUNDARY_PADDING
  ));
}

export function hasEnoughTrackClearance(samples, totalLength, minimumClearance) {
  const points = samples.slice(0, -1).filter((_, index) => index % 24 === 0);
  const minimumClearanceSquared = minimumClearance * minimumClearance;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const arcDistance = Math.abs(points[second].distance - points[first].distance);
      const loopDistance = Math.min(arcDistance, totalLength - arcDistance);
      if (loopDistance < MIN_NON_ADJACENT_ARC_DISTANCE) continue;
      const dx = points[first].x - points[second].x;
      const dy = points[first].y - points[second].y;
      if (dx * dx + dy * dy < minimumClearanceSquared) return false;
    }
  }
  return true;
}

export function hasReasonableTurnSharpness(samples) {
  const usableSamples = samples.slice(0, -1);
  const windows = [30, 36];
  const step = 6;

  for (let index = 0; index < usableSamples.length; index += 1) {
    const current = usableSamples[index];
    const next = usableSamples[(index + 1) % usableSamples.length];
    if (Math.abs(normalizeAngle(next.heading - current.heading)) > MAX_SAMPLE_HEADING_DELTA_RADIANS) {
      return false;
    }
  }

  for (let index = 0; index < usableSamples.length; index += step) {
    for (const window of windows) {
      let accumulatedTurn = 0;
      for (let offset = 0; offset < window; offset += step) {
        const current = usableSamples[(index + offset) % usableSamples.length];
        const next = usableSamples[(index + offset + step) % usableSamples.length];
        accumulatedTurn += Math.abs(normalizeAngle(next.heading - current.heading));
      }
      if (accumulatedTurn > MAX_LOCAL_TURN_RADIANS) return false;
    }
  }

  return true;
}

export function hasEnoughShapeVariation(controls) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const radii = controls.map((point) => distance(point, center));
  const mean = radii.reduce((total, radius) => total + radius, 0) / Math.max(1, radii.length);
  if (mean <= 0) return false;
  const variance = radii.reduce((total, radius) => total + (radius - mean) ** 2, 0) / Math.max(1, radii.length);
  return Math.sqrt(variance) / mean > MIN_TRACK_SHAPE_VARIATION;
}

export function isValidProceduralTrackModel(model) {
  return (
    model.length >= GENERATED_TRACK_MIN_LENGTH &&
    model.length <= GENERATED_TRACK_MAX_LENGTH &&
    hasEnoughShapeVariation(model.centerlineControls) &&
    samplesStayInsideWorld(model.samples) &&
    hasEnoughTrackClearance(model.samples, model.length, model.width * MIN_TRACK_CLEARANCE_MULTIPLIER) &&
    hasReasonableTurnSharpness(model.samples) &&
    !hasSelfIntersections(model.samples)
  );
}
