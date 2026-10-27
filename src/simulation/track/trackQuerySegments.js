import { clamp } from '../simMath.js';

export function createCenterlineSegments(samples, segmentCount) {
  const startX = new Float64Array(segmentCount);
  const startY = new Float64Array(segmentCount);
  const endX = new Float64Array(segmentCount);
  const endY = new Float64Array(segmentCount);
  const deltaX = new Float64Array(segmentCount);
  const deltaY = new Float64Array(segmentCount);
  const lengthSquared = new Float64Array(segmentCount);
  const startDistance = new Float64Array(segmentCount);
  const endDistance = new Float64Array(segmentCount);
  const distanceSpan = new Float64Array(segmentCount);
  const heading = new Float64Array(segmentCount);
  const normalX = new Float64Array(segmentCount);
  const normalY = new Float64Array(segmentCount);
  const endNormalX = new Float64Array(segmentCount);
  const endNormalY = new Float64Array(segmentCount);
  const curvature = new Float64Array(segmentCount);
  const minX = new Float64Array(segmentCount);
  const maxX = new Float64Array(segmentCount);
  const minY = new Float64Array(segmentCount);
  const maxY = new Float64Array(segmentCount);

  for (let id = 0; id < segmentCount; id += 1) {
    const start = samples[id];
    const end = samples[id + 1];
    startX[id] = start.x;
    startY[id] = start.y;
    endX[id] = end.x;
    endY[id] = end.y;
    deltaX[id] = end.x - start.x;
    deltaY[id] = end.y - start.y;
    lengthSquared[id] = deltaX[id] * deltaX[id] + deltaY[id] * deltaY[id];
    startDistance[id] = start.distance;
    endDistance[id] = end.distance;
    distanceSpan[id] = end.distance - start.distance;
    heading[id] = start.heading;
    normalX[id] = start.normalX;
    normalY[id] = start.normalY;
    endNormalX[id] = end.normalX;
    endNormalY[id] = end.normalY;
    curvature[id] = start.curvature ?? 0;
    minX[id] = Math.min(start.x, end.x);
    maxX[id] = Math.max(start.x, end.x);
    minY[id] = Math.min(start.y, end.y);
    maxY[id] = Math.max(start.y, end.y);
  }

  return {
    segmentCount,
    startX,
    startY,
    endX,
    endY,
    deltaX,
    deltaY,
    lengthSquared,
    startDistance,
    endDistance,
    distanceSpan,
    heading,
    normalX,
    normalY,
    endNormalX,
    endNormalY,
    curvature,
    minX,
    maxX,
    minY,
    maxY,
  };
}

export function createPrecomputedSegmentNeighborhoods(segmentCount, radii) {
  if (!segmentCount || !radii?.size) return new Map();
  const neighborhoodsByRadius = new Map();
  for (const radius of radii) {
    const width = radius * 2 + 1;
    const neighborhoods = new Array(segmentCount);
    for (let centerSegmentId = 0; centerSegmentId < segmentCount; centerSegmentId += 1) {
      const segmentIds = new Int32Array(width);
      for (let index = 0; index < width; index += 1) {
        segmentIds[index] = ((centerSegmentId + (index - radius)) % segmentCount + segmentCount) % segmentCount;
      }
      neighborhoods[centerSegmentId] = segmentIds;
    }
    neighborhoodsByRadius.set(radius, neighborhoods);
  }
  return neighborhoodsByRadius;
}

export function getPrecomputedSegmentNeighborhood(centerline, centerSegmentId, radius) {
  const neighborhoods = centerline?.precomputedNeighborhoodsByRadius?.get(radius);
  return neighborhoods?.[centerSegmentId] ?? null;
}

export function writeProjectionCandidate(target, {
  segmentId,
  x,
  y,
  distance,
  heading,
  normalX,
  normalY,
  curvature,
  signedOffset,
  distanceSquared,
}) {
  target.segmentId = segmentId;
  target.x = x;
  target.y = y;
  target.distance = distance;
  target.heading = heading;
  target.normalX = normalX;
  target.normalY = normalY;
  target.curvature = curvature;
  target.signedOffset = signedOffset;
  target.crossTrackError = Math.abs(signedOffset);
  target.distanceSquared = distanceSquared;
  return target;
}

export function projectIndexedSegment(centerline, segmentId, position) {
  if (centerline?.stats) centerline.stats.candidateProjectionObjectAllocations += 1;
  const ax = centerline.startX[segmentId];
  const ay = centerline.startY[segmentId];
  const dx = centerline.deltaX[segmentId];
  const dy = centerline.deltaY[segmentId];
  const amount = centerline.lengthSquared[segmentId] > 0
    ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / centerline.lengthSquared[segmentId], 0, 1)
    : 0;
  const x = ax + dx * amount;
  const y = ay + dy * amount;
  const distance = centerline.startDistance[segmentId] +
    centerline.distanceSpan[segmentId] * amount;
  const heading = centerline.heading[segmentId];
  const normalX = centerline.normalX[segmentId];
  const normalY = centerline.normalY[segmentId];
  const px = position.x - x;
  const py = position.y - y;
  const signedOffset = px * normalX + py * normalY;

  return {
    segmentId,
    x,
    y,
    distance,
    heading,
    normalX,
    normalY,
    curvature: centerline.curvature[segmentId],
    signedOffset,
    crossTrackError: Math.abs(signedOffset),
    distanceSquared: px * px + py * py,
  };
}

export function segmentFromIndex(centerline, segmentId) {
  if (centerline?.stats) centerline.stats.raySegmentObjectAllocations += 1;
  return {
    segmentId,
    startX: centerline.startX[segmentId],
    startY: centerline.startY[segmentId],
    endX: centerline.endX[segmentId],
    endY: centerline.endY[segmentId],
    startDistance: centerline.startDistance[segmentId],
    endDistance: centerline.endDistance[segmentId],
    normalX: centerline.normalX[segmentId],
    normalY: centerline.normalY[segmentId],
    endNormalX: centerline.endNormalX[segmentId],
    endNormalY: centerline.endNormalY[segmentId],
  };
}
