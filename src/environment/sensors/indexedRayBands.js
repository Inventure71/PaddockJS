import { queryTrackSegmentIdsAlongRay } from '../../simulation/track/trackQueryIndex.js';
import { metersToSimUnits } from '../../simulation/units.js';

const RAY_BOUND_QUERY_MARGIN_METERS = 18;

export function findIndexedRayBoundaryHit(track, origin, vector, lengthMeters, offsets, target = null) {
  const boundaries = findIndexedRayBoundaryDistances(track, origin, vector, lengthMeters, offsets, target);
  if (!boundaries.available) return { available: false, distance: null };
  return {
    available: true,
    distance: minFiniteArray(boundaries.distances),
  };
}

export function findIndexedRayBoundaryDistances(track, origin, vector, lengthMeters, offsets, target = null) {
  const result = target ?? {};
  const finiteOffsets = target?.finiteOffsets ?? [];
  const distances = target?.distances ?? [];
  const segmentIds = target?.segmentIds ?? [];
  if (target) {
    target.finiteOffsets = finiteOffsets;
    target.distances = distances;
    target.segmentIds = segmentIds;
  }
  finiteOffsets.length = 0;
  distances.length = 0;
  segmentIds.length = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index];
    if (Number.isFinite(offset)) finiteOffsets.push(offset);
  }
  if (finiteOffsets.length === 0) {
    result.available = true;
    result.distances = distances;
    result.segmentIds = segmentIds;
    return result;
  }
  const maxDistance = metersToSimUnits(lengthMeters);
  let maxOffset = 0;
  for (let index = 0; index < finiteOffsets.length; index += 1) {
    maxOffset = Math.max(maxOffset, Math.abs(finiteOffsets[index]));
  }
  const margin = maxOffset + metersToSimUnits(RAY_BOUND_QUERY_MARGIN_METERS);
  const segmentIdsAlongRay = queryTrackSegmentIdsAlongRay(track, origin, vector, maxDistance, margin);
  if (!segmentIdsAlongRay) {
    result.available = false;
    result.distances = distances;
    result.segmentIds = segmentIds;
    return result;
  }
  const centerline = track.queryIndex.centerline;
  distances.length = finiteOffsets.length;
  segmentIds.length = finiteOffsets.length;
  for (let index = 0; index < finiteOffsets.length; index += 1) {
    distances[index] = Infinity;
    segmentIds[index] = null;
  }

  for (let segmentIndex = 0; segmentIndex < segmentIdsAlongRay.length; segmentIndex += 1) {
    const segmentId = segmentIdsAlongRay[segmentIndex];
    for (let offsetIndex = 0; offsetIndex < finiteOffsets.length; offsetIndex += 1) {
      const offset = finiteOffsets[offsetIndex];
      const distance = rayOffsetSegmentIntersectionDistance(origin, vector, centerline, segmentId, offset, maxDistance);
      if (distance != null && distance < distances[offsetIndex]) {
        distances[offsetIndex] = distance;
        segmentIds[offsetIndex] = segmentId;
      }
    }
  }

  for (let index = 0; index < distances.length; index += 1) {
    if (!Number.isFinite(distances[index])) {
      distances[index] = null;
      segmentIds[index] = null;
    }
  }
  result.available = true;
  result.distances = distances;
  result.segmentIds = segmentIds;
  return result;
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
  const scratch = prepareTrackBandBoundaryScratch(cache);
  const offsets = scratch?.offsets ?? [
    trackHalfWidth,
    -trackHalfWidth,
    kerbOuterWidth,
    -kerbOuterWidth,
  ];
  if (scratch) {
    offsets[0] = trackHalfWidth;
    offsets[1] = -trackHalfWidth;
    offsets[2] = kerbOuterWidth;
    offsets[3] = -kerbOuterWidth;
    offsets.length = 4;
  }
  const boundaries = findIndexedRayBoundaryDistances(
    track,
    origin,
    vector,
    lengthMeters,
    offsets,
    scratch?.boundaryDistances,
  );
  const result = scratch?.result ?? {};
  result.available = boundaries.available;
  result.trackEdgeDistance = minFinite(boundaries.distances[0], boundaries.distances[1]);
  result.trackEdgeSegmentId = nearestSegmentId(
    boundaries.distances[0],
    boundaries.segmentIds[0],
    boundaries.distances[1],
    boundaries.segmentIds[1],
  );
  result.kerbOuterDistance = minFinite(boundaries.distances[2], boundaries.distances[3]);
  result.kerbOuterSegmentId = nearestSegmentId(
    boundaries.distances[2],
    boundaries.segmentIds[2],
    boundaries.distances[3],
    boundaries.segmentIds[3],
  );
  if (cache) cache.trackBandBoundaries = result;
  return result;
}

function prepareTrackBandBoundaryScratch(cache) {
  if (!cache) return null;
  const scratch = cache.trackBandBoundaryScratch ?? {
    offsets: [],
    boundaryDistances: {},
    result: {},
  };
  cache.trackBandBoundaryScratch = scratch;
  return scratch;
}

function rayOffsetSegmentIntersectionDistance(origin, ray, centerline, segmentId, offset, maxDistance) {
  const startX = centerline.startX[segmentId] + centerline.normalX[segmentId] * offset;
  const startY = centerline.startY[segmentId] + centerline.normalY[segmentId] * offset;
  const endX = centerline.endX[segmentId] + centerline.endNormalX[segmentId] * offset;
  const endY = centerline.endY[segmentId] + centerline.endNormalY[segmentId] * offset;
  const sx = endX - startX;
  const sy = endY - startY;
  const denominator = cross(ray.x, ray.y, sx, sy);
  if (Math.abs(denominator) < 1e-9) return null;

  const ox = startX - origin.x;
  const oy = startY - origin.y;
  const rayDistance = cross(ox, oy, sx, sy) / denominator;
  const segmentAmount = cross(ox, oy, ray.x, ray.y) / denominator;

  if (rayDistance < 0 || rayDistance > maxDistance) return null;
  if (segmentAmount < -1e-6 || segmentAmount > 1 + 1e-6) return null;
  return rayDistance;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function minFinite(first, second) {
  if (!Number.isFinite(first)) return Number.isFinite(second) ? second : null;
  if (!Number.isFinite(second)) return first;
  return first <= second ? first : second;
}

function minFiniteArray(values) {
  let minimum = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value < minimum) minimum = value;
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function nearestSegmentId(firstDistance, firstSegmentId, secondDistance, secondSegmentId) {
  if (!Number.isFinite(firstDistance)) return Number.isInteger(secondSegmentId) ? secondSegmentId : null;
  if (!Number.isFinite(secondDistance)) return Number.isInteger(firstSegmentId) ? firstSegmentId : null;
  return firstDistance <= secondDistance
    ? (Number.isInteger(firstSegmentId) ? firstSegmentId : null)
    : (Number.isInteger(secondSegmentId) ? secondSegmentId : null);
}
