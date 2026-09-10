import { clamp } from '../simMath.js';
import { WORLD, PIT_WORLD_PADDING } from './trackConstants.js';

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentBoxesOverlap(a, b, c, d) {
  return (
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  );
}

export function segmentsIntersect(a, b, c, d) {
  if (!segmentBoxesOverlap(a, b, c, d)) return false;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

export function distanceForwardAlongTrack(from, to, totalLength) {
  return to >= from ? to - from : totalLength - from + to;
}

export function smoothstep(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function blendPoint(original, target, amount) {
  return {
    ...original,
    x: original.x + (target.x - original.x) * amount,
    y: original.y + (target.y - original.y) * amount,
  };
}

export function clonePoint(point) {
  return {
    x: point.x,
    y: point.y,
    heading: point.heading,
    distance: point.distance,
  };
}

export function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    length,
  };
}

export function headingVector(heading) {
  return {
    x: Math.cos(heading),
    y: Math.sin(heading),
  };
}

export function dotVectors(first, second) {
  return first.x * second.x + first.y * second.y;
}

export function angleBetweenVectors(first, second) {
  const firstUnit = normalizeVector(first);
  const secondUnit = normalizeVector(second);
  return Math.acos(clamp(dotVectors(firstUnit, secondUnit), -1, 1));
}

export function signedLateralOffsetToPoint(trackPoint, point) {
  return (point.x - trackPoint.x) * trackPoint.normalX + (point.y - trackPoint.y) * trackPoint.normalY;
}

export function interpolatePitPoint(start, forward, distanceAlong) {
  return {
    x: start.x + forward.x * distanceAlong,
    y: start.y + forward.y * distanceAlong,
  };
}

export function projectPitPoint(startPoint, forward, normal, distanceAlong, lateralOffset) {
  return {
    x: startPoint.x + forward.x * distanceAlong + normal.x * lateralOffset,
    y: startPoint.y + forward.y * distanceAlong + normal.y * lateralOffset,
  };
}

export function pointWorldClearance(point) {
  return Math.min(
    point.x - PIT_WORLD_PADDING,
    WORLD.width - PIT_WORLD_PADDING - point.x,
    point.y - PIT_WORLD_PADDING,
    WORLD.height - PIT_WORLD_PADDING - point.y,
  );
}

export function sampleCubicBezier(p0, p1, p2, p3, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
  });
}

export function expandBounds(bounds, point) {
  if (!point) return bounds;
  return {
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

export function expandBoundsByPadding(bounds, padding = 0) {
  const resolvedPadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return {
    minX: bounds.minX - resolvedPadding,
    maxX: bounds.maxX + resolvedPadding,
    minY: bounds.minY - resolvedPadding,
    maxY: bounds.maxY + resolvedPadding,
  };
}

export function createPointBounds(points, padding = 0) {
  const bounds = points.filter(Boolean).reduce(
    (current, point) => expandBounds(current, point),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  if (!Number.isFinite(bounds.minX)) return null;
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minY: bounds.minY - padding,
    maxY: bounds.maxY + padding,
  };
}

export function pointInsideBounds(point, bounds) {
  if (!bounds) return true;
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

export function nearestPointOnPolyline(points, position, segmentIndices = null) {
  return nearestPointOnPolylineInto({}, points, position, { segmentIndices });
}

export function nearestPointOnPolylineInto(target, points, position, {
  segmentIndices = null,
  scratch = null,
  cumulativeDistances: precomputedCumulativeDistances = null,
} = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const output = target ?? {};
  const outputPoint = output.point ?? {};
  output.point = outputPoint;
  const restrictedSegments = Array.isArray(segmentIndices) && segmentIndices.length > 0;
  const cumulativeDistances = restrictedSegments
    ? (Array.isArray(precomputedCumulativeDistances) && precomputedCumulativeDistances.length >= points.length
      ? precomputedCumulativeDistances
      : writePolylineCumulativeDistances(scratch?.cumulativeDistances ?? new Array(points.length), points))
    : null;
  if (scratch && restrictedSegments && cumulativeDistances !== precomputedCumulativeDistances) {
    scratch.cumulativeDistances = cumulativeDistances;
  }

  let bestSegmentIndex = -1;
  let bestAmount = 0;
  let bestLength = 0;
  let bestHeading = 0;
  let bestNormalX = 0;
  let bestNormalY = 1;
  let bestSignedOffset = 0;
  let bestCrossTrackError = Infinity;
  let bestDistanceAlong = 0;
  let bestX = 0;
  let bestY = 0;
  let distanceBefore = 0;
  let totalLength = 0;

  const segmentCount = restrictedSegments ? segmentIndices.length : (points.length - 1);
  for (let segmentOffset = 0; segmentOffset < segmentCount; segmentOffset += 1) {
    const index = restrictedSegments ? segmentIndices[segmentOffset] : segmentOffset;
    if (!Number.isInteger(index) || index < 0 || index >= points.length - 1) continue;
    const current = points[index];
    const next = points[index + 1];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 0
      ? clamp(((position.x - current.x) * dx + (position.y - current.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const projectedX = current.x + dx * amount;
    const projectedY = current.y + dy * amount;
    const length = Math.sqrt(lengthSquared);
    const heading = Math.atan2(dy, dx);
    const normalX = length > 0 ? -dy / length : 0;
    const normalY = length > 0 ? dx / length : 1;
    const signedOffset = (position.x - projectedX) * normalX + (position.y - projectedY) * normalY;
    const crossTrackError = Math.abs(signedOffset);
    if (crossTrackError < bestCrossTrackError) {
      bestSegmentIndex = index;
      bestAmount = amount;
      bestLength = length;
      bestHeading = heading;
      bestNormalX = normalX;
      bestNormalY = normalY;
      bestSignedOffset = signedOffset;
      bestCrossTrackError = crossTrackError;
      bestDistanceAlong = (restrictedSegments ? cumulativeDistances[index] : distanceBefore) + length * amount;
      bestX = projectedX;
      bestY = projectedY;
    }
    if (!restrictedSegments) distanceBefore += length;
    totalLength += length;
  }

  if (bestSegmentIndex < 0) return null;
  outputPoint.x = bestX;
  outputPoint.y = bestY;
  output.amount = bestAmount;
  output.length = bestLength;
  output.heading = bestHeading;
  output.normalX = bestNormalX;
  output.normalY = bestNormalY;
  output.signedOffset = bestSignedOffset;
  output.crossTrackError = bestCrossTrackError;
  output.segmentIndex = bestSegmentIndex;
  output.distanceAlong = bestDistanceAlong;
  output.totalLength = restrictedSegments
    ? cumulativeDistances[cumulativeDistances.length - 1]
    : totalLength;
  return output;
}

function writePolylineCumulativeDistances(distances, points) {
  distances.length = points.length;
  distances[0] = 0;
  for (let index = 1; index < points.length; index += 1) {
    distances[index] = distances[index - 1] + distance(points[index - 1], points[index]);
  }
  return distances;
}

export function pointIsInsidePolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crossesY = (current.y > point.y) !== (previous.y > point.y);
    if (!crossesY) continue;
    const xAtY = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (point.x < xAtY) inside = !inside;
  }

  return inside;
}
