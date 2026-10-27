import { PIT_BOX_COUNT, PIT_BOX_DEPTH, PIT_BOX_LENGTH, PIT_BOX_PAIR_GAP, PIT_BOX_TO_LANE_GAP, PIT_LANE_WIDTH, PIT_SERVICE_AREA_DEPTH, PIT_SERVICE_AREA_LENGTH, PIT_SERVICE_QUEUE_GAP, PIT_TEAM_COUNT, PIT_TEAM_GAP, PIT_BOXES_PER_TEAM, PIT_WORKING_LANE_GAP, PIT_WORKING_LANE_WIDTH } from './trackConstants.js';
import { interpolatePitPoint, projectPitPoint } from './trackMath.js';

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

export function createPitBoxCorners(center, forward, serviceNormal) {
  return createPitRectangleCorners(center, forward, serviceNormal, PIT_BOX_LENGTH, PIT_BOX_DEPTH);
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
