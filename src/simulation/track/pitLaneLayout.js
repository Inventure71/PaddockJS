import { clamp } from '../simMath.js';
import { metersToSimUnits } from '../units.js';
import { WORLD, PIT_BOX_COUNT, PIT_BOX_DEPTH, PIT_BOX_TO_LANE_GAP, PIT_ENTRY_SEARCH_AFTER, PIT_ENTRY_SEARCH_BEFORE, PIT_EXIT_SEARCH_AFTER, PIT_EXIT_SEARCH_BEFORE, PIT_LANE_EDGE_GAP, PIT_LANE_ENTRY_BUFFER, PIT_LANE_EXIT_BUFFER, PIT_LANE_FINISH_RATIO, PIT_LANE_OFFSET_SEARCH_STEP, PIT_LANE_WIDTH, PIT_SERVICE_AREA_DEPTH, PIT_TEAM_COUNT, PIT_BOXES_PER_TEAM, PIT_WORKING_LANE_GAP, PIT_WORKING_LANE_WIDTH, PIT_ACCESS_MAX_LENGTH, PIT_ACCESS_MIN_LENGTH, PIT_ACCESS_TANGENT_RATIO, PIT_TRACK_CLEARANCE_MARGIN } from './trackConstants.js';
import { clonePoint, distance, headingVector, interpolatePitPoint, nearestPointOnPolyline, normalizeVector, pointWorldClearance, projectPitPoint, createPointBounds } from './trackMath.js';
import { findPitAccessConnection, createPitAccessRoadCenterline } from './pitLaneAccess.js';
import { pointAt } from './spatialQueries.js';
import { createPitBoxes, getPitBoxRunLength } from './pitServiceLayout.js';

export { getPitBoxRunLength, createPitBoxCorners, createPitRectangleCorners, createPitBoxes } from './pitServiceLayout.js';

export function createStartStraightBasis(track) {
  const finish = pointAt(track, 0);
  return {
    finish,
    forward: {
      x: Math.cos(finish.heading),
      y: Math.sin(finish.heading),
    },
    normal: {
      x: finish.normalX,
      y: finish.normalY,
    },
  };
}


export function createPitLaneLayout() {
  const runLength = getPitBoxRunLength();
  const length = runLength + PIT_LANE_ENTRY_BUFFER + PIT_LANE_EXIT_BUFFER;
  return {
    runLength,
    length,
    entryDistance: -length * PIT_LANE_FINISH_RATIO,
    exitDistance: length * (1 - PIT_LANE_FINISH_RATIO),
    entryBuffer: PIT_LANE_ENTRY_BUFFER,
    exitBuffer: PIT_LANE_EXIT_BUFFER,
  };
}

export function createPitLaneEndpoints(track, side, laneOffset, layout = createPitLaneLayout()) {
  const basis = createStartStraightBasis(track);
  return {
    ...basis,
    start: projectPitPoint(basis.finish, basis.forward, basis.normal, layout.entryDistance, side * laneOffset),
    end: projectPitPoint(basis.finish, basis.forward, basis.normal, layout.exitDistance, side * laneOffset),
  };
}

export function scorePitLanePlacement(track, side, laneOffset, layout) {
  const placement = createPitLaneEndpoints(track, side, laneOffset, layout);
  const entryLanePoint = placement.start;
  const exitLanePoint = placement.end;
  const worldCenter = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const laneMidpoint = {
    x: (entryLanePoint.x + exitLanePoint.x) / 2,
    y: (entryLanePoint.y + exitLanePoint.y) / 2,
  };
  const outwardDistance = distance(laneMidpoint, worldCenter) - distance(placement.finish, worldCenter);
  const laneVector = normalizeVector({
    x: exitLanePoint.x - entryLanePoint.x,
    y: exitLanePoint.y - entryLanePoint.y,
  });
  const serviceNormal = normalizeVector({
    x: placement.normal.x * side,
    y: placement.normal.y * side,
  });
  const workingLaneOffset = PIT_LANE_WIDTH / 2 + PIT_WORKING_LANE_GAP + PIT_WORKING_LANE_WIDTH / 2;
  const boxLateral = workingLaneOffset + PIT_WORKING_LANE_WIDTH / 2 + PIT_BOX_TO_LANE_GAP + PIT_BOX_DEPTH / 2;
  let minimumClearance = Infinity;
  let minimumTrackClearance = Infinity;

  for (let index = 0; index <= 48; index += 1) {
    const amount = index / 48;
    const lanePoint = interpolatePitPoint(entryLanePoint, laneVector, laneVector.length * amount);
    const boxPoint = {
      x: lanePoint.x + serviceNormal.x * boxLateral,
      y: lanePoint.y + serviceNormal.y * boxLateral,
    };
    minimumClearance = Math.min(minimumClearance, pointWorldClearance(lanePoint), pointWorldClearance(boxPoint));
    minimumTrackClearance = Math.min(
      minimumTrackClearance,
      nearestMainTrackProjection(track, lanePoint).crossTrackError -
        (track.width / 2 + (track.kerbWidth ?? 0) + PIT_TRACK_CLEARANCE_MARGIN),
    );
  }

  return {
    side,
    laneOffset,
    worldClearance: minimumClearance,
    trackClearance: minimumTrackClearance,
    outwardDistance,
    score: minimumTrackClearance * 5 + minimumClearance + outwardDistance * 3,
  };
}

function nearestMainTrackProjection(track, position) {
  return nearestPointOnPolyline(track.samples, position) ?? { crossTrackError: Infinity };
}

export function choosePitLanePlacement(track, baseLaneOffset, layout) {
  const candidates = [];
  for (let offsetStep = 0; offsetStep <= 9; offsetStep += 1) {
    const laneOffset = baseLaneOffset + offsetStep * PIT_LANE_OFFSET_SEARCH_STEP;
    candidates.push(scorePitLanePlacement(track, -1, laneOffset, layout));
    candidates.push(scorePitLanePlacement(track, 1, laneOffset, layout));
  }

  const valid = candidates
    .filter((candidate) => candidate.worldClearance > 0 && candidate.trackClearance > 0)
    .sort((left, right) => (
      Number(right.outwardDistance > 0) - Number(left.outwardDistance > 0) ||
      right.trackClearance - left.trackClearance ||
      right.worldClearance - left.worldClearance ||
      left.laneOffset - right.laneOffset
    ));
  if (valid.length) return valid[0];

  return candidates.sort((left, right) => right.score - left.score)[0];
}




export function createPitLaneBounds(pitLane) {
  const points = [
    ...(pitLane.entry?.roadCenterline ?? []),
    ...(pitLane.exit?.roadCenterline ?? []),
    ...(pitLane.mainLane?.points ?? []),
    ...(pitLane.workingLane?.points ?? []),
    ...(pitLane.boxes ?? []).flatMap((box) => box.corners ?? []),
    ...(pitLane.serviceAreas ?? []).flatMap((area) => [
      ...(area.corners ?? []),
      ...(area.queueCorners ?? []),
    ]),
  ];
  const padding = Math.max(
    pitLane.width ?? 0,
    pitLane.workingLane?.width ?? 0,
    PIT_BOX_DEPTH,
    PIT_SERVICE_AREA_DEPTH,
  ) / 2 + metersToSimUnits(3);
  return createPointBounds(points, padding);
}

export function createPitBoxBounds(pitLane) {
  const points = [
    ...(pitLane.boxes ?? []).flatMap((box) => box.corners ?? []),
    ...(pitLane.serviceAreas ?? []).flatMap((area) => [
      ...(area.corners ?? []),
      ...(area.queueCorners ?? []),
    ]),
  ];
  if (!points.length) return null;
  const padding = Math.max(PIT_BOX_DEPTH, PIT_SERVICE_AREA_DEPTH) / 2 + metersToSimUnits(3);
  return createPointBounds(points, padding);
}

export function createPitConnectorBounds(pitLane) {
  const connectorPadding = metersToSimUnits(18);
  return {
    entry: createPointBounds(pitLane.entry?.connector ?? [], connectorPadding),
    exit: createPointBounds(pitLane.exit?.connector ?? [], connectorPadding),
  };
}

export function createPitLaneModel(track) {
  const layout = createPitLaneLayout();
  const laneOffset = track.width / 2 + (track.kerbWidth ?? 0) + PIT_LANE_EDGE_GAP + PIT_LANE_WIDTH / 2;
  const placement = choosePitLanePlacement(track, laneOffset, layout);
  const side = placement.side;
  const placedLaneOffset = placement.laneOffset;
  const startStraight = createPitLaneEndpoints(track, side, placedLaneOffset, layout);
  const laneStart = startStraight.start;
  const laneEnd = startStraight.end;
  const laneVector = normalizeVector({
    x: laneEnd.x - laneStart.x,
    y: laneEnd.y - laneStart.y,
  });
  const lateralSpan = Math.max(0, placedLaneOffset - track.width / 2);
  const accessLength = clamp(lateralSpan * 0.9, PIT_ACCESS_MIN_LENGTH, PIT_ACCESS_MAX_LENGTH);
  const serviceNormal = normalizeVector({
    x: startStraight.normal.x * side,
    y: startStraight.normal.y * side,
  });
  const entryConnection = findPitAccessConnection(track, laneStart, laneVector, {
    direction: 'entry',
    startDistance: layout.entryDistance - PIT_ENTRY_SEARCH_BEFORE,
    endDistance: layout.entryDistance + PIT_ENTRY_SEARCH_AFTER,
    fallbackDistance: layout.entryDistance - accessLength,
  });
  const exitConnection = findPitAccessConnection(track, laneEnd, laneVector, {
    direction: 'exit',
    startDistance: layout.exitDistance - PIT_EXIT_SEARCH_BEFORE,
    endDistance: layout.exitDistance + PIT_EXIT_SEARCH_AFTER,
    fallbackDistance: layout.exitDistance + accessLength,
  });
  const entryTangentLength = clamp(
    entryConnection.pathLength * PIT_ACCESS_TANGENT_RATIO,
    PIT_LANE_WIDTH,
    PIT_ACCESS_MAX_LENGTH,
  );
  const exitTangentLength = clamp(
    exitConnection.pathLength * PIT_ACCESS_TANGENT_RATIO,
    PIT_LANE_WIDTH,
    PIT_ACCESS_MAX_LENGTH,
  );
  const entryMergePoint = interpolatePitPoint(laneStart, laneVector, Math.min(metersToSimUnits(86), laneVector.length * 0.16));
  const exitMergePoint = interpolatePitPoint(laneEnd, laneVector, -Math.min(metersToSimUnits(86), laneVector.length * 0.16));

  const entryRoadCenterline = createPitAccessRoadCenterline(
    entryConnection.trackConnectPoint,
    laneStart,
    headingVector(entryConnection.trackPoint.heading),
    laneVector,
    entryTangentLength,
  );
  const exitRoadCenterline = createPitAccessRoadCenterline(
    laneEnd,
    exitConnection.trackConnectPoint,
    laneVector,
    headingVector(exitConnection.trackPoint.heading),
    exitTangentLength,
  );
  const { boxes, serviceAreas, workingLaneOffset } = createPitBoxes({
    laneStart,
    laneForward: laneVector,
    laneLength: laneVector.length,
    serviceNormal,
  });
  const workingLaneStart = projectPitPoint(laneStart, laneVector, serviceNormal, 0, workingLaneOffset);
  const workingLaneEnd = projectPitPoint(laneStart, laneVector, serviceNormal, laneVector.length, workingLaneOffset);

  const pitLane = {
    enabled: true,
    side,
    width: PIT_LANE_WIDTH,
    offset: placedLaneOffset,
    layout,
    boxCount: PIT_BOX_COUNT,
    teamCount: PIT_TEAM_COUNT,
    boxesPerTeam: PIT_BOXES_PER_TEAM,
    entry: {
      trackDistance: entryConnection.trackDistance,
      distanceFromStart: entryConnection.distanceFromStart,
      trackPoint: clonePoint(entryConnection.trackPoint),
      edgePoint: entryConnection.edgePoint,
      trackConnectPoint: entryConnection.trackConnectPoint,
      lanePoint: laneStart,
      roadCenterline: entryRoadCenterline,
      connector: [clonePoint(entryConnection.trackPoint), ...entryRoadCenterline, entryMergePoint],
    },
    exit: {
      trackDistance: exitConnection.trackDistance,
      distanceFromStart: exitConnection.distanceFromStart,
      trackPoint: clonePoint(exitConnection.trackPoint),
      edgePoint: exitConnection.edgePoint,
      trackConnectPoint: exitConnection.trackConnectPoint,
      lanePoint: laneEnd,
      roadCenterline: exitRoadCenterline,
      connector: [exitMergePoint, ...exitRoadCenterline, clonePoint(exitConnection.trackPoint)],
    },
    mainLane: {
      start: laneStart,
      end: laneEnd,
      points: [laneStart, laneEnd],
      length: laneVector.length,
      heading: Math.atan2(laneVector.y, laneVector.x),
    },
    fastLane: {
      offset: 0,
      width: PIT_LANE_WIDTH,
    },
    workingLane: {
      start: workingLaneStart,
      end: workingLaneEnd,
      points: [workingLaneStart, workingLaneEnd],
      offset: workingLaneOffset,
      width: PIT_WORKING_LANE_WIDTH,
    },
    serviceNormal,
    boxes,
    serviceAreas,
  };
  return {
    ...pitLane,
    bounds: createPitLaneBounds(pitLane),
    boxBounds: createPitBoxBounds(pitLane),
    connectorBounds: createPitConnectorBounds(pitLane),
  };
}
