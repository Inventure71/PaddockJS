import { clamp, normalizeAngle } from '../simMath.js';
import { metersToSimUnits } from '../units.js';
import { nearestTrackState, offsetTrackPoint, pointAt } from '../trackModel.js';

const PIT_ENTRY_APPROACH_DISTANCE = metersToSimUnits(250);

function clonePointLike(point) {
  if (!point) return point;
  return { ...point };
}

function clonePointArray(points) {
  return Array.isArray(points) ? points.map(clonePointLike) : points;
}

export function clonePitLaneModel(pitLane) {
  if (!pitLane) return pitLane;
  return {
    ...pitLane,
    entry: pitLane.entry ? {
      ...pitLane.entry,
      trackPoint: clonePointLike(pitLane.entry.trackPoint),
      edgePoint: clonePointLike(pitLane.entry.edgePoint),
      trackConnectPoint: clonePointLike(pitLane.entry.trackConnectPoint),
      lanePoint: clonePointLike(pitLane.entry.lanePoint),
      roadCenterline: clonePointArray(pitLane.entry.roadCenterline),
      connector: clonePointArray(pitLane.entry.connector),
    } : pitLane.entry,
    exit: pitLane.exit ? {
      ...pitLane.exit,
      trackPoint: clonePointLike(pitLane.exit.trackPoint),
      edgePoint: clonePointLike(pitLane.exit.edgePoint),
      trackConnectPoint: clonePointLike(pitLane.exit.trackConnectPoint),
      lanePoint: clonePointLike(pitLane.exit.lanePoint),
      roadCenterline: clonePointArray(pitLane.exit.roadCenterline),
      connector: clonePointArray(pitLane.exit.connector),
    } : pitLane.exit,
    mainLane: pitLane.mainLane ? {
      ...pitLane.mainLane,
      start: clonePointLike(pitLane.mainLane.start),
      end: clonePointLike(pitLane.mainLane.end),
      points: clonePointArray(pitLane.mainLane.points),
    } : pitLane.mainLane,
    workingLane: pitLane.workingLane ? {
      ...pitLane.workingLane,
      start: clonePointLike(pitLane.workingLane.start),
      end: clonePointLike(pitLane.workingLane.end),
      points: clonePointArray(pitLane.workingLane.points),
    } : pitLane.workingLane,
    fastLane: pitLane.fastLane ? { ...pitLane.fastLane } : pitLane.fastLane,
    serviceNormal: clonePointLike(pitLane.serviceNormal),
    boxes: Array.isArray(pitLane.boxes)
      ? pitLane.boxes.map((box) => ({
        ...box,
        laneTarget: clonePointLike(box.laneTarget),
        center: clonePointLike(box.center),
        corners: clonePointArray(box.corners),
      }))
      : pitLane.boxes,
    serviceAreas: Array.isArray(pitLane.serviceAreas)
      ? pitLane.serviceAreas.map((area) => ({
        ...area,
        laneTarget: clonePointLike(area.laneTarget),
        center: clonePointLike(area.center),
        queuePoint: clonePointLike(area.queuePoint),
        corners: clonePointArray(area.corners),
        queueCorners: clonePointArray(area.queueCorners),
        garageBoxIds: [...(area.garageBoxIds ?? [])],
        pitCrew: area.pitCrew ? { ...area.pitCrew } : area.pitCrew,
      }))
      : pitLane.serviceAreas,
    teams: Array.isArray(pitLane.teams)
      ? pitLane.teams.map((team) => ({ ...team, boxIds: [...(team.boxIds ?? [])], pitCrew: team.pitCrew ? { ...team.pitCrew } : team.pitCrew }))
      : pitLane.teams,
  };
}

export function routePoint(point, heading = point?.heading, options = {}) {
  if (!point) return null;
  return {
    x: point.x,
    y: point.y,
    heading,
    limiterActive: Boolean(options.limiterActive ?? point.limiterActive),
  };
}

export function offsetPitLanePoint(pitLane, point, lateralOffset) {
  return {
    ...point,
    x: point.x + pitLane.serviceNormal.x * lateralOffset,
    y: point.y + pitLane.serviceNormal.y * lateralOffset,
    heading: pitLane.mainLane.heading,
  };
}

export function pitMainLanePointAt(pitLane, distanceAlongLane, lateralOffset = 0) {
  const amount = pitLane.mainLane.length > 0
    ? clamp(distanceAlongLane / pitLane.mainLane.length, 0, 1)
    : 0;
  const point = {
    x: pitLane.mainLane.start.x + (pitLane.mainLane.end.x - pitLane.mainLane.start.x) * amount,
    y: pitLane.mainLane.start.y + (pitLane.mainLane.end.y - pitLane.mainLane.start.y) * amount,
    heading: pitLane.mainLane.heading,
  };
  return offsetPitLanePoint(pitLane, point, lateralOffset);
}

export function pitDriveLaneOffset(pitLane) {
  return pitLane.fastLane?.offset ?? 0;
}

function sameRoutePoint(first, second) {
  return first && second && Math.hypot(first.x - second.x, first.y - second.y) < 0.001;
}

export function shiftPreviousRenderPose(car, dx, dy, dheading = 0) {
  car.previousX = Number.isFinite(car.previousX) ? car.previousX + dx : car.x + dx;
  car.previousY = Number.isFinite(car.previousY) ? car.previousY + dy : car.y + dy;
  car.previousHeading = normalizeAngle(
    (Number.isFinite(car.previousHeading) ? car.previousHeading : car.heading) + dheading,
  );
}

export function pointDistance(first, second) {
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function createRoute(points) {
  const routePoints = points
    .filter(Boolean)
    .map((point) => routePoint(point))
    .filter(Boolean)
    .reduce((deduped, point) => {
      if (!sameRoutePoint(deduped.at(-1), point)) {
        deduped.push(point);
      } else if (point.limiterActive) {
        deduped.at(-1).limiterActive = true;
      }
      return deduped;
    }, []);
  const segments = [];
  let totalLength = 0;

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = routePoints[index];
    const end = routePoints[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= 0.001) continue;
    const heading = Math.atan2(end.y - start.y, end.x - start.x);
    segments.push({
      start,
      end,
      length,
      heading,
      startDistance: totalLength,
      endDistance: totalLength + length,
      limiterActive: Boolean(start.limiterActive && end.limiterActive),
    });
    totalLength += length;
  }

  let nextLimiterStartDistance = Infinity;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.limiterActive) nextLimiterStartDistance = segment.startDistance;
    segment.nextLimiterStartDistance = nextLimiterStartDistance;
  }

  return {
    points: routePoints,
    segments,
    length: totalLength,
    segmentCursor: 0,
  };
}

function findRouteSegment(route, distanceAlong, endPadding = 0) {
  if (!route?.segments?.length) return null;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segments = route.segments;
  let index = clamp(Math.floor(route.segmentCursor ?? 0), 0, segments.length - 1);
  let segment = segments[index];

  if (
    clampedDistance >= segment.startDistance - 0.001 &&
    clampedDistance <= segment.endDistance - endPadding
  ) {
    return segment;
  }

  if (clampedDistance > segment.endDistance - endPadding) {
    while (index < segments.length - 1 && clampedDistance > segments[index].endDistance - endPadding) {
      index += 1;
    }
  } else {
    while (index > 0 && clampedDistance < segments[index].startDistance - 0.001) {
      index -= 1;
    }
  }

  segment = segments[index];
  if (
    clampedDistance < segment.startDistance - 0.001 ||
    clampedDistance > segment.endDistance - endPadding
  ) {
    segment = segments.find((candidate) => (
      clampedDistance >= candidate.startDistance - 0.001 &&
      clampedDistance <= candidate.endDistance - endPadding
    )) ?? segments.at(-1);
    index = segments.indexOf(segment);
  }

  route.segmentCursor = Math.max(0, index);
  return segment;
}

export function sampleRoute(route, distanceAlong) {
  if (!route?.segments?.length) return route?.points?.[0] ?? null;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = findRouteSegment(route, clampedDistance) ?? route.segments.at(-1);
  const amount = clamp((clampedDistance - segment.startDistance) / segment.length, 0, 1);

  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * amount,
    y: segment.start.y + (segment.end.y - segment.start.y) * amount,
    heading: segment.heading,
    limiterActive: segment.limiterActive,
  };
}

export function routeLimiterActiveAt(route, distanceAlong) {
  if (!route?.segments?.length) return false;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = findRouteSegment(route, clampedDistance, 0.001) ?? route.segments.at(-1);
  return Boolean(segment?.limiterActive);
}

export function distanceToNextLimiterSegment(route, distanceAlong) {
  if (!route?.segments?.length) return Infinity;
  const clampedDistance = clamp(distanceAlong, 0, route.length);
  const segment = findRouteSegment(route, clampedDistance, 0.001);
  if (!segment) return Infinity;
  if (segment.limiterActive && segment.endDistance > clampedDistance + 0.001) return 0;
  return Math.max(0, segment.nextLimiterStartDistance - clampedDistance);
}

function easeInOut(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function projectPositionToSegment(position, segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((position.x - segment.start.x) * dx + (position.y - segment.start.y) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = segment.start.x + dx * amount;
  const y = segment.start.y + dy * amount;
  const distanceSquared = (position.x - x) ** 2 + (position.y - y) ** 2;

  return {
    distanceAlong: segment.startDistance + segment.length * amount,
    distanceSquared,
  };
}

export function nearestDistanceOnRoute(route, position, previousDistance = 0) {
  if (!route?.segments?.length) return 0;
  let best = null;
  const backtrackAllowance = metersToSimUnits(90);

  route.segments.forEach((segment) => {
    if (segment.endDistance < previousDistance - backtrackAllowance) return;
    const projected = projectPositionToSegment(position, segment);
    if (!best || projected.distanceSquared < best.distanceSquared) best = projected;
  });

  return clamp(best?.distanceAlong ?? previousDistance, 0, route.length);
}

export function createPitApproachPoints(track, car, pitLane, entryRaceDistance) {
  const currentDistance = car.raceDistance ?? entryRaceDistance - PIT_ENTRY_APPROACH_DISTANCE;
  const remaining = Math.max(0, entryRaceDistance - currentDistance);
  const currentState = nearestTrackState(track, car, car.progress);
  const startOffset = currentState.inPitLane ? 0 : currentState.signedOffset ?? 0;
  const entryConnectState = nearestTrackState(track, pitLane.entry.trackConnectPoint, pitLane.entry.trackDistance);
  const targetOffset = entryConnectState.signedOffset ?? 0;
  const points = [routePoint(car, car.heading)];
  const straightDistance = remaining > metersToSimUnits(14)
    ? Math.min(remaining * 0.22, metersToSimUnits(42))
    : 0;
  if (straightDistance > metersToSimUnits(1)) {
    points.push(routePoint({
      x: car.x + Math.cos(car.heading) * straightDistance,
      y: car.y + Math.sin(car.heading) * straightDistance,
    }, car.heading));
  }

  const transitionDistance = Math.max(0, remaining - straightDistance);
  const steps = Math.max(4, Math.ceil(Math.max(transitionDistance, PIT_ENTRY_APPROACH_DISTANCE * 0.45) / metersToSimUnits(74)));
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    const distance = currentDistance + straightDistance + transitionDistance * amount;
    const trackPoint = pointAt(track, distance);
    const lateralAmount = easeInOut(amount);
    const offset = startOffset + (targetOffset - startOffset) * lateralAmount;
    const point = offsetTrackPoint(trackPoint, offset);
    points.push(routePoint(point, trackPoint.heading));
  }

  points.push(routePoint(pitLane.entry.trackConnectPoint, pitLane.entry.trackPoint?.heading));
  return points;
}

