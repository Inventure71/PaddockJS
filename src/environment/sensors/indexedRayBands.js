import { queryTrackSegmentsAlongRay } from '../../simulation/track/trackQueryIndex.js';
import { metersToSimUnits } from '../../simulation/units.js';

const RAY_BOUND_QUERY_MARGIN_METERS = 18;

export function findIndexedRayBoundaryHit(track, origin, vector, lengthMeters, offsets) {
  const maxDistance = metersToSimUnits(lengthMeters);
  const maxOffset = Math.max(0, ...offsets.map((offset) => Math.abs(offset)).filter(Number.isFinite));
  const margin = maxOffset + metersToSimUnits(RAY_BOUND_QUERY_MARGIN_METERS);
  const segments = queryTrackSegmentsAlongRay(track, origin, vector, maxDistance, margin);
  if (!segments) return { available: false, distance: null };

  let bestDistance = Infinity;
  for (const segment of segments) {
    for (const offset of offsets) {
      const start = offsetSegmentStart(segment, offset);
      const finish = offsetSegmentEnd(segment, offset);
      const distance = raySegmentIntersectionDistance(origin, vector, start, finish, maxDistance);
      if (distance != null && distance < bestDistance) bestDistance = distance;
    }
  }

  return {
    available: true,
    distance: Number.isFinite(bestDistance) ? bestDistance : null,
  };
}

function offsetSegmentStart(segment, offset) {
  return {
    x: segment.startX + segment.normalX * offset,
    y: segment.startY + segment.normalY * offset,
  };
}

function offsetSegmentEnd(segment, offset) {
  return {
    x: segment.endX + segment.endNormalX * offset,
    y: segment.endY + segment.endNormalY * offset,
  };
}

function raySegmentIntersectionDistance(origin, ray, start, end, maxDistance) {
  const sx = end.x - start.x;
  const sy = end.y - start.y;
  const denominator = cross(ray.x, ray.y, sx, sy);
  if (Math.abs(denominator) < 1e-9) return null;

  const ox = start.x - origin.x;
  const oy = start.y - origin.y;
  const rayDistance = cross(ox, oy, sx, sy) / denominator;
  const segmentAmount = cross(ox, oy, ray.x, ray.y) / denominator;

  if (rayDistance < 0 || rayDistance > maxDistance) return null;
  if (segmentAmount < -1e-6 || segmentAmount > 1 + 1e-6) return null;
  return rayDistance;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}
