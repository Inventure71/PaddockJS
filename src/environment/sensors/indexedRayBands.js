import { queryTrackSegmentsAlongRay } from '../../simulation/track/trackQueryIndex.js';
import { metersToSimUnits } from '../../simulation/units.js';

const RAY_BOUND_QUERY_MARGIN_METERS = 18;

export function findIndexedRayBoundaryHit(track, origin, vector, lengthMeters, offsets) {
  const boundaries = findIndexedRayBoundaryDistances(track, origin, vector, lengthMeters, offsets);
  if (!boundaries.available) return { available: false, distance: null };
  return {
    available: true,
    distance: minFinite(...boundaries.distances),
  };
}

export function findIndexedRayBoundaryDistances(track, origin, vector, lengthMeters, offsets) {
  const finiteOffsets = offsets.filter(Number.isFinite);
  if (finiteOffsets.length === 0) return { available: true, distances: [] };
  const maxDistance = metersToSimUnits(lengthMeters);
  const maxOffset = Math.max(0, ...finiteOffsets.map((offset) => Math.abs(offset)));
  const margin = maxOffset + metersToSimUnits(RAY_BOUND_QUERY_MARGIN_METERS);
  const segments = queryTrackSegmentsAlongRay(track, origin, vector, maxDistance, margin);
  if (!segments) return { available: false, distances: [] };
  const distances = finiteOffsets.map(() => Infinity);

  for (const segment of segments) {
    finiteOffsets.forEach((offset, offsetIndex) => {
      const start = offsetSegmentStart(segment, offset);
      const finish = offsetSegmentEnd(segment, offset);
      const distance = raySegmentIntersectionDistance(origin, vector, start, finish, maxDistance);
      if (distance != null && distance < distances[offsetIndex]) distances[offsetIndex] = distance;
    });
  }

  return {
    available: true,
    distances: distances.map((distance) => (Number.isFinite(distance) ? distance : null)),
  };
}

export function findIndexedTrackBandBoundaries(
  track,
  origin,
  vector,
  lengthMeters,
  trackHalfWidth,
  kerbOuterWidth,
  cache = null,
) {
  if (cache?.trackBandBoundaries) return cache.trackBandBoundaries;
  const boundaries = findIndexedRayBoundaryDistances(
    track,
    origin,
    vector,
    lengthMeters,
    [trackHalfWidth, -trackHalfWidth, kerbOuterWidth, -kerbOuterWidth],
  );
  const result = {
    available: boundaries.available,
    trackEdgeDistance: minFinite(boundaries.distances[0], boundaries.distances[1]),
    kerbOuterDistance: minFinite(boundaries.distances[2], boundaries.distances[3]),
  };
  if (cache) cache.trackBandBoundaries = result;
  return result;
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

function minFinite(...values) {
  const minimum = Math.min(...values.filter((value) => Number.isFinite(value)));
  return Number.isFinite(minimum) ? minimum : null;
}
