import { Graphics } from 'pixi.js';
import { nearestTrackState } from '../../simulation/trackModel.js';
import { ASPHALT_COLOR, GRAVEL_COLOR, PIT_ASPHALT_COLOR, PIT_BOX_COLOR, PIT_CONNECTOR_WIDTH, PIT_LINE_COLOR, PIT_SPEED_LINE_COLOR } from './trackRenderConstants.js';
import { colorToNumber, createTeamPitGroupCorners, drawPolyline, offsetVectorPoint } from './trackRenderGeometry.js';

export function drawMainPitLaneOffsetLine(graphics, pitLane, offset, {
  width,
  color,
  alpha = 1,
}) {
  const start = offsetVectorPoint(pitLane.mainLane.start, pitLane.serviceNormal, offset);
  const end = offsetVectorPoint(pitLane.mainLane.end, pitLane.serviceNormal, offset);
  drawPolyline(graphics, [start, end], {
    width,
    color,
    alpha,
    cap: 'butt',
  });
}

export function drawPitRoad(graphics, points, {
  roadWidth,
  asphaltColor = ASPHALT_COLOR,
  edgeAlpha = 0.54,
  cap = 'butt',
}) {
  drawPolyline(graphics, points, {
    width: roadWidth + 8,
    color: 0x080a0f,
    alpha: edgeAlpha,
    cap,
  });
  drawPolyline(graphics, points, {
    width: roadWidth,
    color: asphaltColor,
    alpha: 1,
    cap,
  });
}

export function drawPitRunoff(graphics, points, roadWidth) {
  drawPolyline(graphics, points, {
    width: roadWidth + 92,
    color: GRAVEL_COLOR,
    alpha: 1,
    cap: 'butt',
  });
}

export function getPitLaneRoadCenterlines(pitLane) {
  return {
    entryRoad: pitLane.entry.roadCenterline ?? [pitLane.entry.edgePoint, pitLane.mainLane.start],
    exitRoad: pitLane.exit.roadCenterline ?? [pitLane.mainLane.end, pitLane.exit.edgePoint],
  };
}

export function drawCurvedPitRoadEdges(graphics, points, roadWidth) {
  if (!Array.isArray(points) || points.length < 2) return;
  [-1, 1].forEach((side) => {
    const edgePoints = points.map((point, index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: point.x + (-dy / len) * side * roadWidth / 2,
        y: point.y + (dx / len) * side * roadWidth / 2,
      };
    });
    drawPolyline(graphics, edgePoints, {
      width: 2,
      color: PIT_LINE_COLOR,
      alpha: 0.7,
      cap: 'butt',
    });
  });
}

export function getPitRoadEdgePoints(track, points) {
  if (!Array.isArray(points) || points.length < 2) return points;
  const trackEdge = track.width / 2;
  const firstVisible = points.findIndex((point) => nearestTrackState(track, point).crossTrackError >= trackEdge - 4);
  const lastVisibleReverse = [...points]
    .reverse()
    .findIndex((point) => nearestTrackState(track, point).crossTrackError >= trackEdge - 4);

  if (firstVisible < 0 || lastVisibleReverse < 0) return points;
  const lastVisible = points.length - 1 - lastVisibleReverse;
  return points.slice(firstVisible, lastVisible + 1);
}

export function addPitLaneRunoff(asset, track) {
    if (!track.pitLane?.enabled) return;
    const pitLane = track.pitLane;
    const pitRunoff = new Graphics();
    pitRunoff.label = 'pit-lane-runoff';

    // Only the main pit lane gets a gravel shoulder; connectors run through the track's
    // own gravel/runoff zone so they do not need a separate runoff stroke (which would
    // bleed an undesirable gravel band into the track asphalt at the entry/exit endpoints).
    const workingLaneExtent = pitLane.workingLane
      ? pitLane.workingLane.offset + pitLane.workingLane.width / 2
      : pitLane.width / 2;
    drawPitRunoff(pitRunoff, pitLane.mainLane.points, Math.max(pitLane.width, workingLaneExtent * 2));

    asset.container.addChild(pitRunoff);
  
}

export function addPitLane(asset, track) {
    if (!track.pitLane?.enabled) return;
    const pitLane = track.pitLane;
    const pit = new Graphics();
    pit.label = 'pit-lane';
    const { entryRoad, exitRoad } = getPitLaneRoadCenterlines(pitLane);

    drawPitRoad(pit, entryRoad, {
      roadWidth: PIT_CONNECTOR_WIDTH,
      asphaltColor: ASPHALT_COLOR,
      edgeAlpha: 0.18,
      cap: 'round',
    });
    drawPitRoad(pit, exitRoad, {
      roadWidth: PIT_CONNECTOR_WIDTH,
      asphaltColor: ASPHALT_COLOR,
      edgeAlpha: 0.18,
      cap: 'round',
    });
    drawPitRoad(pit, pitLane.mainLane.points, {
      roadWidth: pitLane.width,
      asphaltColor: PIT_ASPHALT_COLOR,
      edgeAlpha: 0.62,
    });
    if (pitLane.workingLane?.points?.length >= 2) {
      drawPitRoad(pit, pitLane.workingLane.points, {
        roadWidth: pitLane.workingLane.width,
        asphaltColor: PIT_ASPHALT_COLOR,
        edgeAlpha: 0.52,
      });
    }

    drawMainPitLaneOffsetLine(pit, pitLane, -pitLane.width / 2, {
      width: 3,
      color: PIT_SPEED_LINE_COLOR,
      alpha: 0.9,
    });
    drawMainPitLaneOffsetLine(pit, pitLane, pitLane.width / 2, {
      width: 3,
      color: PIT_LINE_COLOR,
      alpha: 0.84,
    });
    if (pitLane.workingLane) {
      drawMainPitLaneOffsetLine(pit, pitLane, pitLane.workingLane.offset - pitLane.workingLane.width / 2, {
        width: 2,
        color: PIT_LINE_COLOR,
        alpha: 0.48,
      });
      drawMainPitLaneOffsetLine(pit, pitLane, pitLane.workingLane.offset + pitLane.workingLane.width / 2, {
        width: 3,
        color: PIT_LINE_COLOR,
        alpha: 0.78,
      });
    }

    const heading = pitLane.mainLane.heading;
    const laneNormal = { x: -Math.sin(heading), y: Math.cos(heading) };
    [pitLane.mainLane.start, pitLane.mainLane.end].forEach((point) => {
      const a = offsetVectorPoint(point, laneNormal, -pitLane.width / 2);
      const b = offsetVectorPoint(point, laneNormal, pitLane.width / 2);
      drawPolyline(pit, [a, b], {
        width: 4,
        color: PIT_SPEED_LINE_COLOR,
        alpha: 0.95,
        cap: 'butt',
      });
    });

    [entryRoad, exitRoad].forEach((road) => {
      drawCurvedPitRoadEdges(pit, getPitRoadEdgePoints(track, road), PIT_CONNECTOR_WIDTH);
    });

    (pitLane.teams ?? []).forEach((team) => {
      const boxes = pitLane.boxes.filter((box) => team.boxIds?.includes(box.id));
      const corners = createTeamPitGroupCorners(boxes);
      if (corners.length < 4) return;
      const color = colorToNumber(team.color);
      pit.poly(corners.flatMap((corner) => [corner.x, corner.y])).fill({
        color,
        alpha: 0.24,
      });
      pit.poly(corners.flatMap((corner) => [corner.x, corner.y])).stroke({
        width: 3,
        color,
        alpha: 0.72,
        join: 'round',
      });
    });

    (pitLane.serviceAreas ?? []).forEach((serviceArea) => {
      const teamColor = colorToNumber(serviceArea.teamColor, PIT_SPEED_LINE_COLOR);
      if (serviceArea.queueCorners?.length >= 4) {
        pit.poly(serviceArea.queueCorners.flatMap((corner) => [corner.x, corner.y])).fill({
          color: teamColor,
          alpha: 0.13,
        });
        pit.poly(serviceArea.queueCorners.flatMap((corner) => [corner.x, corner.y])).stroke({
          width: 2,
          color: teamColor,
          alpha: 0.44,
          join: 'round',
        });
      }
      pit.poly(serviceArea.corners.flatMap((corner) => [corner.x, corner.y])).fill({
        color: teamColor,
        alpha: 0.2,
      });
      pit.poly(serviceArea.corners.flatMap((corner) => [corner.x, corner.y])).stroke({
        width: 3,
        color: teamColor,
        alpha: 0.92,
        join: 'round',
      });
    });

    pitLane.boxes.forEach((box) => {
      const teamColor = colorToNumber(box.teamColor, box.teamBoxIndex === 0 ? PIT_LINE_COLOR : PIT_SPEED_LINE_COLOR);
      pit.poly(box.corners.flatMap((corner) => [corner.x, corner.y])).fill({
        color: PIT_BOX_COLOR,
        alpha: 0.96,
      });
      pit.poly(box.corners.flatMap((corner) => [corner.x, corner.y])).stroke({
        width: 2,
        color: teamColor,
        alpha: 0.9,
        join: 'round',
      });
      drawPolyline(pit, [box.laneTarget, box.center], {
        width: 2,
        color: teamColor,
        alpha: 0.28,
        cap: 'butt',
      });
    });

    asset.container.addChild(pit);
  
}
