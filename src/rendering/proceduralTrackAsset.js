import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import { nearestTrackState, offsetTrackPoint, pointAt, WORLD } from '../simulation/trackModel.js';

const MATERIAL_TILE_SCALE = {
  asphalt: { x: 0.66, y: 0.66 },
};
const WORLD_BACKGROUND_PADDING_MULTIPLIER = 8;
const GRASS_COLOR = 0x2e7d32;
const GRAVEL_COLOR = 0xb49a68;
const ASPHALT_COLOR = 0x4a4d52;
const PIT_ASPHALT_COLOR = ASPHALT_COLOR;
const PIT_BOX_COLOR = 0x242831;
const PIT_LINE_COLOR = 0xf8fafc;
const PIT_SPEED_LINE_COLOR = 0xffd166;
const PIT_CONNECTOR_WIDTH = 72;
const PIT_EDGE_WIDTH = 4;
const EDGE_REVEAL_OFFSET = 5;
const EDGE_REVEAL_WIDTH = 16;
const OUTER_BOUNDARY_OFFSET = 23;
const OUTER_BOUNDARY_WIDTH = 16;
const KERB_OFFSET = 9;
const KERB_WIDTH = 29;
const FINISH_LINE_DEPTH = 58;
const FINISH_LINE_COLUMNS = 10;
const START_GRID_SLOT_COUNT = 20;
const START_GRID_SLOT_SPACING = 82;
const START_GRID_FIRST_DISTANCE = -42;
const START_GRID_LATERAL_OFFSET = 42;
const START_GRID_BOX_LENGTH = 58;
const START_GRID_BOX_WIDTH = 34;
const SEGMENTED_STROKE_STEP = 2;
const KERB_STEP = 4;
const KERB_CURVATURE_THRESHOLD = 0.00038;
const OFFSET_SEGMENT_SAMPLE_COUNT = 7;
const NON_LOCAL_SAMPLE_STEP = 8;
const OFFSET_GAP_SAMPLE_COUNT = 4;

function colorToNumber(color, fallback = PIT_LINE_COLOR) {
  if (typeof color === 'number' && Number.isFinite(color)) return color;
  if (typeof color !== 'string') return fallback;
  const normalized = color.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
  return Number.parseInt(normalized, 16);
}

function makeTrackPath(track, offset = 0) {
  const path = new Graphics();
  const samples = track.samples.slice(0, -1);
  const first = offset === 0 ? samples[0] : offsetTrackPoint(samples[0], offset);
  path.moveTo(first.x, first.y);

  samples.slice(1).forEach((sample) => {
    const point = offset === 0 ? sample : offsetTrackPoint(sample, offset);
    path.lineTo(point.x, point.y);
  });
  path.closePath();

  return path;
}

function textureOrWhite(texture) {
  return texture ?? Texture.WHITE;
}

function destroyDisplayChildren(container) {
  container.removeChildren().forEach((child) => {
    child.destroy?.({ children: true, texture: false, textureSource: false });
  });
}

function arcDistance(track, first, second) {
  const delta = Math.abs(first - second);
  return Math.min(delta, track.length - delta);
}

function offsetPointIsLocal(track, source, point, offset) {
  const state = nearestTrackState(track, point);
  const localTolerance = Math.max(220, Math.abs(offset) * 2.1);
  const minimumEdgeDistance = Math.min(track.width / 2 - 8, Math.abs(offset) * 0.72);

  return (
    arcDistance(track, state.distance, source.distance) <= localTolerance &&
    state.crossTrackError >= minimumEdgeDistance
  );
}

function offsetPointOverlapsNonLocalRoad(track, source, point, offset) {
  const localTolerance = Math.max(220, Math.abs(offset) * 2.1);
  const roadBand = track.width / 2 + (track.kerbWidth ?? 0) + 8;
  const roadBandSquared = (roadBand + 42) ** 2;

  for (let index = 0; index < track.samples.length - 1; index += NON_LOCAL_SAMPLE_STEP) {
    const sample = track.samples[index];
    if (arcDistance(track, sample.distance, source.distance) <= localTolerance) continue;

    const dx = point.x - sample.x;
    const dy = point.y - sample.y;
    if (dx * dx + dy * dy > roadBandSquared) continue;

    const signedOffset = dx * sample.normalX + dy * sample.normalY;
    if (Math.abs(signedOffset) <= roadBand) return true;
  }

  return false;
}

function interpolatedSegmentPoint(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function drawPolyline(graphics, points, {
  width,
  color,
  alpha = 1,
  cap = 'round',
  join = 'round',
}) {
  if (!Array.isArray(points) || points.length < 2) return;
  graphics.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => {
    graphics.lineTo(point.x, point.y);
  });
  graphics.stroke({
    width,
    color,
    alpha,
    cap,
    join,
  });
}

function offsetVectorPoint(point, vector, amount) {
  return {
    x: point.x + vector.x * amount,
    y: point.y + vector.y * amount,
  };
}

function drawMainPitLaneOffsetLine(graphics, pitLane, offset, {
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

function drawPitRoad(graphics, points, {
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

function drawPitRunoff(graphics, points, roadWidth) {
  drawPolyline(graphics, points, {
    width: roadWidth + 92,
    color: GRAVEL_COLOR,
    alpha: 1,
    cap: 'butt',
  });
}

function getPitLaneRoadCenterlines(pitLane) {
  return {
    entryRoad: pitLane.entry.roadCenterline ?? [pitLane.entry.edgePoint, pitLane.mainLane.start],
    exitRoad: pitLane.exit.roadCenterline ?? [pitLane.mainLane.end, pitLane.exit.edgePoint],
  };
}

function drawCurvedPitRoadEdges(graphics, points, roadWidth) {
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

function getPitRoadEdgePoints(track, points) {
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

function createTeamPitGroupCorners(boxes) {
  const ordered = [...boxes].sort((left, right) => left.index - right.index);
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) return [];

  return [
    first.corners[0],
    last.corners[1],
    last.corners[2],
    first.corners[3],
  ];
}

export function offsetSegmentIsSafe(track, current, next, start, end, offset) {
  const centerDistance = Math.hypot(next.x - current.x, next.y - current.y);
  const edgeDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const maxEdgeDistance = Math.max(centerDistance * 2.6, track.width * 0.58);
  if (edgeDistance > maxEdgeDistance || Math.abs(offset) > track.width + track.gravelWidth + track.runoffWidth) {
    return false;
  }

  const forwardDistance = ((next.distance - current.distance + track.length) % track.length) || centerDistance;

  for (let sample = 0; sample <= OFFSET_SEGMENT_SAMPLE_COUNT; sample += 1) {
    const amount = sample / OFFSET_SEGMENT_SAMPLE_COUNT;
    const source = {
      distance: (current.distance + forwardDistance * amount) % track.length,
    };
    const point = interpolatedSegmentPoint(start, end, amount);
    if (!offsetPointIsLocal(track, source, point, offset)) return false;
    if (offsetPointOverlapsNonLocalRoad(track, source, point, offset)) return false;
  }

  return true;
}

export function offsetGapBridgeIsSafe(track, start, end, width) {
  const bridgeDistance = pointDistance(start, end);
  const maximumBridgeDistance = Math.max(track.width * 0.08, width * 3.4);
  if (bridgeDistance > maximumBridgeDistance) return false;

  const minimumEdgeDistance = track.width / 2 - Math.max(width * 2.5, 10);
  for (let sample = 1; sample < OFFSET_GAP_SAMPLE_COUNT; sample += 1) {
    const amount = sample / OFFSET_GAP_SAMPLE_COUNT;
    const point = interpolatedSegmentPoint(start, end, amount);
    const state = nearestTrackState(track, point);
    if (state.crossTrackError < minimumEdgeDistance) return false;
  }

  return true;
}

export function getOffsetStrokeSegments(track, {
  side,
  offset,
  step = SEGMENTED_STROKE_STEP,
}) {
  const samples = track.samples.slice(0, -1);
  const signedOffset = side * offset;

  return samples.map((current, index) => {
    if (index % step !== 0) return null;

    const next = samples[(index + step) % samples.length];
    const start = offsetTrackPoint(current, signedOffset);
    const end = offsetTrackPoint(next, signedOffset);

    return {
      current,
      next,
      start,
      end,
      safe: offsetSegmentIsSafe(track, current, next, start, end, signedOffset),
    };
  }).filter(Boolean);
}

export function getOffsetGapBridges(track, segments, width) {
  if (segments.length < 2) return [];

  return segments.flatMap((segment, index) => {
    if (!segment.safe) return [];

    const previousIndex = (index - 1 + segments.length) % segments.length;
    if (segments[previousIndex].safe) return [];

    let previousSafe = null;
    for (let lookup = 2; lookup <= segments.length; lookup += 1) {
      const candidate = segments[(index - lookup + segments.length) % segments.length];
      if (!candidate.safe) continue;
      previousSafe = candidate;
      break;
    }

    if (!previousSafe || previousSafe === segment) return [];
    if (!offsetGapBridgeIsSafe(track, previousSafe.end, segment.start, width)) return [];

    return [{
      start: previousSafe.end,
      end: segment.start,
    }];
  });
}

function drawOffsetSegment(graphics, start, end, {
  width,
  color,
  alpha,
  cap,
}) {
  graphics.moveTo(start.x, start.y);
  graphics.lineTo(end.x, end.y);
  graphics.stroke({
    width,
    color,
    alpha,
    join: 'round',
    cap,
  });
}

function drawContinuousOffsetStroke(graphics, track, {
  side,
  offset,
  width,
  color,
  alpha = 1,
  step = SEGMENTED_STROKE_STEP,
}) {
  const samples = track.samples.slice(0, -1).filter((_, index) => index % step === 0);
  if (samples.length < 2) return;

  const first = offsetTrackPoint(samples[0], side * offset);
  graphics.moveTo(first.x, first.y);
  samples.slice(1).forEach((sample) => {
    const point = offsetTrackPoint(sample, side * offset);
    graphics.lineTo(point.x, point.y);
  });
  graphics.closePath();
  graphics.stroke({
    width,
    color,
    alpha,
    join: 'round',
    cap: 'round',
  });
}

function drawSegmentedOffsetStroke(graphics, track, {
  side,
  offset,
  width,
  color,
  alpha = 1,
  step = SEGMENTED_STROKE_STEP,
  cap = 'round',
}) {
  const segments = getOffsetStrokeSegments(track, { side, offset, step });

  segments.forEach((segment) => {
    if (!segment.safe) return;
    drawOffsetSegment(graphics, segment.start, segment.end, {
      width,
      color,
      alpha,
      cap,
    });
  });

  getOffsetGapBridges(track, segments, width).forEach((bridge) => {
    drawOffsetSegment(graphics, bridge.start, bridge.end, {
      width,
      color,
      alpha,
      cap: 'round',
    });
  });
}

export class ProceduralTrackAsset {
  constructor({ textures = {}, world = WORLD } = {}) {
    this.textures = textures;
    this.world = world;
    this.container = new Container();
  }

  render(track) {
    destroyDisplayChildren(this.container);
    this.addGrass();
    this.addGravelRunoff(track);
    this.addBoundaryUnderlay(track);
    this.addPitLaneRunoff(track);
    this.addPitLane(track);
    this.addAsphalt(track);
    this.addKerbs(track);
    this.addBorders(track);
    this.addStartingGrid(track);
    this.addFinishLine(track);
  }

  addGrass() {
    const grass = new Graphics();
    const padding = Math.max(this.world.width, this.world.height) * WORLD_BACKGROUND_PADDING_MULTIPLIER;
    const bounds = {
      x: -padding,
      y: -padding,
      width: this.world.width + padding * 2,
      height: this.world.height + padding * 2,
    };
    grass.label = 'world-grass';
    grass.worldGrassBounds = bounds;
    grass.rect(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    ).fill(GRASS_COLOR);
    this.container.addChild(grass);
  }

  addGravelRunoff(track) {
    const gravel = new Graphics();
    const innerOffset = track.width / 2 + 8;
    const outerOffset = track.width / 2 + track.gravelWidth;
    const centerOffset = (innerOffset + outerOffset) / 2;
    const width = outerOffset - innerOffset;

    [-1, 1].forEach((side) => {
      drawContinuousOffsetStroke(gravel, track, {
        side,
        offset: centerOffset,
        width,
        color: GRAVEL_COLOR,
        step: 4,
      });
    });
    this.container.addChild(gravel);
  }

  addBoundaryUnderlay(track) {
    const boundary = new Graphics();
    [-1, 1].forEach((side) => {
      drawContinuousOffsetStroke(boundary, track, {
        side,
        offset: track.width / 2 + OUTER_BOUNDARY_OFFSET,
        width: OUTER_BOUNDARY_WIDTH,
        color: 0x090a0d,
        alpha: 0.64,
        step: 2,
      });
    });

    this.drawKerbStripes(boundary, track, { clipUnsafeSegments: false });

    [-1, 1].forEach((side) => {
      drawContinuousOffsetStroke(boundary, track, {
        side,
        offset: track.width / 2 + EDGE_REVEAL_OFFSET,
        width: EDGE_REVEAL_WIDTH,
        color: 0xf8fafc,
        alpha: 0.94,
        step: 2,
      });
    });

    this.container.addChild(boundary);
  }

  drawKerbStripes(kerbs, track, { clipUnsafeSegments }) {
    const samples = track.samples.slice(0, -1);

    for (let index = 0; index < samples.length; index += KERB_STEP) {
      const sample = samples[index];
      const next = samples[(index + KERB_STEP) % samples.length];
      const curvature = Math.max(sample.curvature, next.curvature);
      if (curvature < KERB_CURVATURE_THRESHOLD) continue;

      const color = Math.floor(index / KERB_STEP) % 2 === 0 ? 0xe10600 : 0xf8fafc;
      [-1, 1].forEach((side) => {
        const offset = side * (track.width / 2 + KERB_OFFSET);
        const start = offsetTrackPoint(sample, offset);
        const end = offsetTrackPoint(next, offset);
        if (clipUnsafeSegments && !offsetSegmentIsSafe(track, sample, next, start, end, offset)) return;
        kerbs.moveTo(start.x, start.y);
        kerbs.lineTo(end.x, end.y);
        kerbs.stroke({
          width: KERB_WIDTH,
          color,
          alpha: 1,
          join: 'round',
          cap: 'butt',
        });
      });
    }
  }

  addMaskedMaterial({ track, texture, strokeWidth, alpha, tileScale }) {
    const sprite = new TilingSprite({
      texture: textureOrWhite(texture),
      width: this.world.width,
      height: this.world.height,
      tileScale,
    });
    sprite.alpha = alpha;

    const mask = makeTrackPath(track);
    mask.stroke({
      width: strokeWidth,
      color: 0xffffff,
      alpha: 1,
      join: 'round',
      cap: 'butt',
    });
    mask.renderable = false;
    sprite.mask = mask;
    this.container.addChild(sprite, mask);
  }

  addAsphalt(track) {
    const asphaltBase = makeTrackPath(track);
    asphaltBase.label = 'track-asphalt';
    asphaltBase.stroke({
      width: track.width,
      color: ASPHALT_COLOR,
      alpha: 1,
      join: 'round',
      cap: 'butt',
    });
    this.container.addChild(asphaltBase);

    this.addMaskedMaterial({
      track,
      texture: this.textures.asphalt,
      strokeWidth: track.width,
      alpha: 0.18,
      tileScale: MATERIAL_TILE_SCALE.asphalt,
    });

  }

  addPitLaneRunoff(track) {
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

    this.container.addChild(pitRunoff);
  }

  addPitLane(track) {
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

    this.container.addChild(pit);
  }

  addBorders(track) {
    const borders = new Graphics();
    borders.label = 'track-borders';

    [-1, 1].forEach((side) => {
      drawSegmentedOffsetStroke(borders, track, {
        side,
        offset: track.width / 2,
        width: 5,
        color: 0xf8fafc,
        alpha: 0.86,
        step: 4,
      });

      drawSegmentedOffsetStroke(borders, track, {
        side,
        offset: track.width / 2 + 15,
        width: 7,
        color: 0x090a0d,
        alpha: 0.56,
        step: 4,
      });
    });

    this.container.addChild(borders);
  }

  addKerbs(track) {
    const kerbs = new Graphics();
    kerbs.label = 'track-kerbs';
    this.drawKerbStripes(kerbs, track, { clipUnsafeSegments: true });
    this.container.addChild(kerbs);
  }

  addStartingGrid(track) {
    const grid = new Graphics();

    for (let index = 0; index < START_GRID_SLOT_COUNT; index += 1) {
      const base = pointAt(track, START_GRID_FIRST_DISTANCE - index * START_GRID_SLOT_SPACING);
      const lateralOffset = index % 2 === 0 ? -START_GRID_LATERAL_OFFSET : START_GRID_LATERAL_OFFSET;
      const center = offsetTrackPoint(base, lateralOffset);
      const forwardX = Math.cos(base.heading);
      const forwardY = Math.sin(base.heading);
      const normalX = base.normalX;
      const normalY = base.normalY;
      const halfLength = START_GRID_BOX_LENGTH / 2;
      const halfWidth = START_GRID_BOX_WIDTH / 2;
      const corners = [
        {
          x: center.x + forwardX * halfLength + normalX * halfWidth,
          y: center.y + forwardY * halfLength + normalY * halfWidth,
        },
        {
          x: center.x + forwardX * halfLength - normalX * halfWidth,
          y: center.y + forwardY * halfLength - normalY * halfWidth,
        },
        {
          x: center.x - forwardX * halfLength - normalX * halfWidth,
          y: center.y - forwardY * halfLength - normalY * halfWidth,
        },
        {
          x: center.x - forwardX * halfLength + normalX * halfWidth,
          y: center.y - forwardY * halfLength + normalY * halfWidth,
        },
      ];

      grid.poly(corners.flatMap((corner) => [corner.x, corner.y])).stroke({
        width: 3,
        color: 0xf8fafc,
        alpha: 0.8,
        join: 'round',
      });
    }

    this.container.addChild(grid);
  }

  addFinishLine(track) {
    const finishLine = new Graphics();
    const halfDepth = FINISH_LINE_DEPTH / 2;
    this.addFinishLineHalf(finishLine, track, -halfDepth, 0, 0);
    this.addFinishLineHalf(finishLine, track, 0, halfDepth, 1);
    this.container.addChild(finishLine);
  }

  addFinishLineHalf(graphics, track, startDistance, endDistance, rowOffset) {
    const start = pointAt(track, startDistance);
    const end = pointAt(track, endDistance);
    const roadPadding = 10;
    const width = track.width - roadPadding * 2;
    const leftEdge = -width / 2;
    const cellWidth = width / FINISH_LINE_COLUMNS;

    for (let column = 0; column < FINISH_LINE_COLUMNS; column += 1) {
      const innerOffset = leftEdge + column * cellWidth;
      const outerOffset = innerOffset + cellWidth;
      const color = (column + rowOffset) % 2 === 0 ? 0xf8fafc : 0x0b0d12;
      const a = offsetTrackPoint(start, innerOffset);
      const b = offsetTrackPoint(start, outerOffset);
      const c = offsetTrackPoint(end, outerOffset);
      const d = offsetTrackPoint(end, innerOffset);

      graphics.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(color);
    }
  }

}
