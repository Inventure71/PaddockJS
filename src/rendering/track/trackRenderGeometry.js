import { Graphics, Texture } from 'pixi.js';
import { offsetTrackPoint } from '../../simulation/trackModel.js';
import { PIT_LINE_COLOR } from './trackRenderConstants.js';

export function colorToNumber(color, fallback = PIT_LINE_COLOR) {
  if (typeof color === 'number' && Number.isFinite(color)) return color;
  if (typeof color !== 'string') return fallback;
  const normalized = color.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
  return Number.parseInt(normalized, 16);
}

export function makeTrackPath(track, offset = 0) {
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

export function textureOrWhite(texture) {
  return texture ?? Texture.WHITE;
}

export function destroyDisplayChildren(container) {
  container.removeChildren().forEach((child) => {
    child.destroy?.({ children: true, texture: false, textureSource: false });
  });
}

export function arcDistance(track, first, second) {
  const delta = Math.abs(first - second);
  return Math.min(delta, track.length - delta);
}

export function interpolatedSegmentPoint(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

export function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function drawPolyline(graphics, points, {
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

export function offsetVectorPoint(point, vector, amount) {
  return {
    x: point.x + vector.x * amount,
    y: point.y + vector.y * amount,
  };
}

export function createTeamPitGroupCorners(boxes) {
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
