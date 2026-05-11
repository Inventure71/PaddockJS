import { Graphics, TilingSprite } from 'pixi.js';
import { offsetTrackPoint } from '../../simulation/trackModel.js';
import { ASPHALT_COLOR, BARRIER_WALL_WIDTH, EDGE_REVEAL_OFFSET, EDGE_REVEAL_WIDTH, GRASS_COLOR, GRAVEL_COLOR, KERB_CURVATURE_THRESHOLD, KERB_OFFSET, KERB_STEP, KERB_WIDTH, MATERIAL_TILE_SCALE, OUTER_BOUNDARY_OFFSET, OUTER_BOUNDARY_WIDTH, RUNOFF_GRASS_COLOR, SEGMENTED_STROKE_STEP, WORLD_BACKGROUND_PADDING_MULTIPLIER } from './trackRenderConstants.js';
import { makeTrackPath, textureOrWhite } from './trackRenderGeometry.js';
import { getOffsetGapBridges, getOffsetStrokeSegments, offsetSegmentIsSafe } from './offsetStrokeSafety.js';

export function drawOffsetSegment(graphics, start, end, {
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

export function drawContinuousOffsetStroke(graphics, track, {
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

export function drawSegmentedOffsetStroke(graphics, track, {
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

export function addGrass(asset) {
    const grass = new Graphics();
    const padding = Math.max(asset.world.width, asset.world.height) * WORLD_BACKGROUND_PADDING_MULTIPLIER;
    const bounds = {
      x: -padding,
      y: -padding,
      width: asset.world.width + padding * 2,
      height: asset.world.height + padding * 2,
    };
    grass.label = 'world-grass';
    grass.worldGrassBounds = bounds;
    grass.rect(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    ).fill(GRASS_COLOR);
    asset.container.addChild(grass);
  
}

export function addGravelRunoff(asset, track) {
    const bands = getTrackMaterialBands(track);
    const gravel = new Graphics();
    gravel.label = 'track-gravel';
    const gravelCenterOffset = (bands.gravel.inner + bands.gravel.outer) / 2;
    const gravelWidth = bands.gravel.outer - bands.gravel.inner;

    [-1, 1].forEach((side) => {
      drawContinuousOffsetStroke(gravel, track, {
        side,
        offset: gravelCenterOffset,
        width: gravelWidth,
        color: GRAVEL_COLOR,
        step: 4,
      });
    });
    asset.container.addChild(gravel);

    const runoff = new Graphics();
    runoff.label = 'track-runoff';
    const runoffCenterOffset = (bands.runoff.inner + bands.runoff.outer) / 2;
    const runoffWidth = bands.runoff.outer - bands.runoff.inner;
    [-1, 1].forEach((side) => {
      drawContinuousOffsetStroke(runoff, track, {
        side,
        offset: runoffCenterOffset,
        width: runoffWidth,
        color: RUNOFF_GRASS_COLOR,
        alpha: 0.82,
        step: 4,
      });
    });
    asset.container.addChild(runoff);
  
}

export function addBoundaryUnderlay(asset, track) {
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

    drawKerbStripes(asset, boundary, track, { clipUnsafeSegments: false });

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

    asset.container.addChild(boundary);
  
}

export function addBarriers(asset, track) {
    const barriers = new Graphics();
    barriers.label = 'track-barriers';
    const bands = getTrackMaterialBands(track);
    const wallWidth = bands.barrier.width;
    const offset = bands.barrier.center;
    [-1, 1].forEach((side) => {
      drawContinuousOffsetStroke(barriers, track, {
        side,
        offset,
        width: wallWidth,
        color: 0x171717,
        alpha: 0.94,
        step: 3,
      });
      drawContinuousOffsetStroke(barriers, track, {
        side,
        offset: offset - wallWidth * 0.7,
        width: wallWidth * 0.35,
        color: 0xf8fafc,
        alpha: 0.42,
        step: 3,
      });
    });
    asset.container.addChild(barriers);

}

export function getTrackMaterialBands(track) {
    const roadEdge = track.width / 2;
    const kerbOuter = roadEdge + (track.kerbWidth ?? 0);
    const gravelOuter = kerbOuter + track.gravelWidth;
    const runoffOuter = gravelOuter + track.runoffWidth;
    const barrierWidth = track.barrierWidth ?? BARRIER_WALL_WIDTH;
    return {
      road: { inner: -roadEdge, outer: roadEdge },
      kerb: { inner: roadEdge, outer: kerbOuter },
      gravel: { inner: kerbOuter, outer: gravelOuter },
      runoff: { inner: gravelOuter, outer: runoffOuter },
      barrier: {
        inner: runoffOuter - barrierWidth / 2,
        center: runoffOuter,
        outer: runoffOuter + barrierWidth / 2,
        width: barrierWidth,
      },
    };
}

export function drawKerbStripes(asset, kerbs, track, { clipUnsafeSegments }) {
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

export function addMaskedMaterial(asset, { track, texture, strokeWidth, alpha, tileScale }) {
    const sprite = new TilingSprite({
      texture: textureOrWhite(texture),
      width: asset.world.width,
      height: asset.world.height,
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
    asset.container.addChild(sprite, mask);
  
}

export function addAsphalt(asset, track) {
    const asphaltBase = makeTrackPath(track);
    asphaltBase.label = 'track-asphalt';
    asphaltBase.stroke({
      width: track.width,
      color: ASPHALT_COLOR,
      alpha: 1,
      join: 'round',
      cap: 'butt',
    });
    asset.container.addChild(asphaltBase);

    addMaskedMaterial(asset, {
      track,
      texture: asset.textures.asphalt,
      strokeWidth: track.width,
      alpha: 0.18,
      tileScale: MATERIAL_TILE_SCALE.asphalt,
    });

  
}

export function addBorders(asset, track) {
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

    asset.container.addChild(borders);
  
}

export function addKerbs(asset, track) {
    const kerbs = new Graphics();
    kerbs.label = 'track-kerbs';
    drawKerbStripes(asset, kerbs, track, { clipUnsafeSegments: true });
    asset.container.addChild(kerbs);
  
}
