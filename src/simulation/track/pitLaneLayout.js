import { clamp } from '../simMath.js';
import { metersToSimUnits } from '../units.js';
import { WORLD, PIT_BOX_COUNT, PIT_BOX_DEPTH, PIT_BOX_LENGTH, PIT_BOX_PAIR_GAP, PIT_BOX_TO_LANE_GAP, PIT_ENTRY_SEARCH_AFTER, PIT_ENTRY_SEARCH_BEFORE, PIT_EXIT_SEARCH_AFTER, PIT_EXIT_SEARCH_BEFORE, PIT_LANE_EDGE_GAP, PIT_LANE_ENTRY_BUFFER, PIT_LANE_EXIT_BUFFER, PIT_LANE_FINISH_RATIO, PIT_LANE_OFFSET_SEARCH_STEP, PIT_LANE_WIDTH, PIT_SERVICE_AREA_DEPTH, PIT_SERVICE_AREA_LENGTH, PIT_SERVICE_QUEUE_GAP, PIT_TEAM_COUNT, PIT_TEAM_GAP, PIT_BOXES_PER_TEAM, PIT_WORKING_LANE_GAP, PIT_WORKING_LANE_WIDTH, PIT_ACCESS_MAX_LENGTH, PIT_ACCESS_MIN_LENGTH, PIT_ACCESS_TANGENT_RATIO, PIT_TRACK_CLEARANCE_MARGIN } from './trackConstants.js';
import { clonePoint, distance, headingVector, interpolatePitPoint, normalizeVector, pointWorldClearance, projectPitPoint, createPointBounds } from './trackMath.js';
import { findPitAccessConnection, createPitAccessRoadCenterline } from './pitLaneAccess.js';
import { nearestTrackState, pointAt } from './spatialQueries.js';

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

export function getPitBoxRunLength({
  teamCount = PIT_TEAM_COUNT,
  boxesPerTeam = PIT_BOXES_PER_TEAM,
  boxLength = PIT_BOX_LENGTH,
  pairGap = PIT_BOX_PAIR_GAP,
  teamGap = PIT_TEAM_GAP,
} = {}) {
  const boxCount = teamCount * boxesPerTeam;
  return (
    boxCount * boxLength +
    teamCount * Math.max(0, boxesPerTeam - 1) * pairGap +
    Math.max(0, teamCount - 1) * teamGap
  );
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
      nearestTrackState(track, lanePoint).crossTrackError -
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

export function createPitBoxCorners(center, forward, serviceNormal) {
  const halfLength = PIT_BOX_LENGTH / 2;
  const halfDepth = PIT_BOX_DEPTH / 2;
  return [
    {
      x: center.x + forward.x * halfLength + serviceNormal.x * halfDepth,
      y: center.y + forward.y * halfLength + serviceNormal.y * halfDepth,
    },
    {
      x: center.x - forward.x * halfLength + serviceNormal.x * halfDepth,
      y: center.y - forward.y * halfLength + serviceNormal.y * halfDepth,
    },
    {
      x: center.x - forward.x * halfLength - serviceNormal.x * halfDepth,
      y: center.y - forward.y * halfLength - serviceNormal.y * halfDepth,
    },
    {
      x: center.x + forward.x * halfLength - serviceNormal.x * halfDepth,
      y: center.y + forward.y * halfLength - serviceNormal.y * halfDepth,
    },
  ];
}

export function createPitRectangleCorners(center, forward, serviceNormal, length, depth) {
  const halfLength = length / 2;
  const halfDepth = depth / 2;
  return [
    {
      x: center.x + forward.x * halfLength + serviceNormal.x * halfDepth,
      y: center.y + forward.y * halfLength + serviceNormal.y * halfDepth,
    },
    {
      x: center.x - forward.x * halfLength + serviceNormal.x * halfDepth,
      y: center.y - forward.y * halfLength + serviceNormal.y * halfDepth,
    },
    {
      x: center.x - forward.x * halfLength - serviceNormal.x * halfDepth,
      y: center.y - forward.y * halfLength - serviceNormal.y * halfDepth,
    },
    {
      x: center.x + forward.x * halfLength - serviceNormal.x * halfDepth,
      y: center.y + forward.y * halfLength - serviceNormal.y * halfDepth,
    },
  ];
}

export function createPitBoxes({ laneStart, laneForward, laneLength, serviceNormal }) {
  const runLength = getPitBoxRunLength();
  let cursor = Math.max(PIT_SERVICE_QUEUE_GAP + PIT_BOX_LENGTH / 2, (laneLength - runLength) / 2);
  const workingLaneOffset = PIT_LANE_WIDTH / 2 + PIT_WORKING_LANE_GAP + PIT_WORKING_LANE_WIDTH / 2;
  const boxLateral = workingLaneOffset + PIT_WORKING_LANE_WIDTH / 2 + PIT_BOX_TO_LANE_GAP + PIT_BOX_DEPTH / 2;
  const boxes = [];
  const serviceAreas = [];

  for (let index = 0; index < PIT_BOX_COUNT; index += 1) {
    const distanceAlongLane = cursor + PIT_BOX_LENGTH / 2;
    const laneTarget = interpolatePitPoint(laneStart, laneForward, distanceAlongLane);
    const center = {
      x: laneTarget.x + serviceNormal.x * boxLateral,
      y: laneTarget.y + serviceNormal.y * boxLateral,
    };
    const teamIndex = Math.floor(index / PIT_BOXES_PER_TEAM);
    const teamBoxIndex = index % PIT_BOXES_PER_TEAM;

    boxes.push({
      id: `team-${teamIndex + 1}-box-${teamBoxIndex + 1}`,
      index,
      teamIndex,
      teamBoxIndex,
      distanceAlongLane,
      laneTarget,
      center,
      length: PIT_BOX_LENGTH,
      depth: PIT_BOX_DEPTH,
      corners: createPitBoxCorners(center, laneForward, serviceNormal),
    });

    if (teamBoxIndex === PIT_BOXES_PER_TEAM - 1) {
      const firstTeamBox = boxes[index - (PIT_BOXES_PER_TEAM - 1)];
      const serviceDistance = (firstTeamBox.distanceAlongLane + distanceAlongLane) / 2;
      const queueDistance = Math.max(PIT_SERVICE_QUEUE_GAP / 2, serviceDistance - PIT_SERVICE_QUEUE_GAP);
      const serviceCenter = projectPitPoint(
        laneStart,
        laneForward,
        serviceNormal,
        serviceDistance,
        workingLaneOffset,
      );
      const queuePoint = projectPitPoint(
        laneStart,
        laneForward,
        serviceNormal,
        queueDistance,
        workingLaneOffset,
      );

      serviceAreas.push({
        id: `team-${teamIndex + 1}-service`,
        index: teamIndex,
        teamIndex,
        distanceAlongLane: serviceDistance,
        queueDistanceAlongLane: queueDistance,
        laneTarget: serviceCenter,
        center: serviceCenter,
        queuePoint,
        length: PIT_SERVICE_AREA_LENGTH,
        depth: PIT_SERVICE_AREA_DEPTH,
        corners: createPitRectangleCorners(serviceCenter, laneForward, serviceNormal, PIT_SERVICE_AREA_LENGTH, PIT_SERVICE_AREA_DEPTH),
        queueCorners: createPitRectangleCorners(queuePoint, laneForward, serviceNormal, PIT_SERVICE_AREA_LENGTH * 0.72, PIT_SERVICE_AREA_DEPTH),
        garageBoxIds: boxes
          .slice(index - (PIT_BOXES_PER_TEAM - 1), index + 1)
          .map((box) => box.id),
      });
    }

    cursor += PIT_BOX_LENGTH;
    if (teamBoxIndex === 0) cursor += PIT_BOX_PAIR_GAP;
    else if (teamIndex < PIT_TEAM_COUNT - 1) cursor += PIT_TEAM_GAP;
  }

  return { boxes, serviceAreas, workingLaneOffset };
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
  };
}
