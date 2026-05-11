import { clamp, createMulberry32, seededRange } from '../simMath.js';
import { CENTERLINE_CONTROLS, TRACK_BOUNDARY_PADDING, WORLD, MIN_TRACK_SHAPE_VARIATION } from './trackConstants.js';
import { distance } from './trackMath.js';

const REGION_TRACK_TEMPLATES = [
  {
    columns: 8,
    rows: 6,
    cells: [
      [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
      [1, 2], [4, 2], [5, 2], [6, 2],
      [1, 3], [2, 3], [3, 3], [6, 3],
      [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4],
    ],
  },
  {
    columns: 8,
    rows: 6,
    cells: [
      [1, 1], [2, 1], [3, 1], [6, 1],
      [1, 2], [3, 2], [4, 2], [5, 2], [6, 2],
      [1, 3], [2, 3], [5, 3], [6, 3],
      [2, 4], [3, 4], [4, 4], [5, 4],
    ],
  },
  {
    columns: 9,
    rows: 6,
    cells: [
      [1, 1], [2, 1], [3, 1], [4, 1], [7, 1],
      [1, 2], [4, 2], [5, 2], [6, 2], [7, 2],
      [1, 3], [2, 3], [3, 3], [6, 3], [7, 3],
      [2, 4], [3, 4], [4, 4], [5, 4], [6, 4],
    ],
  },
];

export function normalizeSeed(seed) {
  if (Number.isFinite(seed)) return seed >>> 0;
  let hash = 2166136261;
  String(seed ?? 'f1-track').split('').forEach((character) => {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return hash >>> 0;
}

export function rotateControls(controls, random) {
  const rotation = Math.floor(seededRange(random, 0, controls.length));
  return [...controls.slice(rotation), ...controls.slice(0, rotation)];
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function traceRegionBoundary(template) {
  const selected = new Set(template.cells.map(([x, y]) => cellKey(x, y)));
  const edges = [];

  template.cells.forEach(([x, y]) => {
    if (!selected.has(cellKey(x, y - 1))) edges.push([[x, y], [x + 1, y]]);
    if (!selected.has(cellKey(x + 1, y))) edges.push([[x + 1, y], [x + 1, y + 1]]);
    if (!selected.has(cellKey(x, y + 1))) edges.push([[x + 1, y + 1], [x, y + 1]]);
    if (!selected.has(cellKey(x - 1, y))) edges.push([[x, y + 1], [x, y]]);
  });

  const outgoing = new Map();
  edges.forEach(([start, end]) => {
    const key = cellKey(start[0], start[1]);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(end);
  });

  const start = edges[0][0];
  let current = start;
  const boundary = [start];

  for (let index = 0; index < edges.length; index += 1) {
    const next = outgoing.get(cellKey(current[0], current[1]))?.shift();
    if (!next) break;
    current = next;
    if (current[0] === start[0] && current[1] === start[1]) return boundary;
    boundary.push(current);
  }

  return boundary;
}

function smoothRegionBoundary(points, amount = 0.34, rounds = 2) {
  let smoothed = points;
  for (let round = 0; round < rounds; round += 1) {
    const next = [];
    smoothed.forEach((point, index) => {
      const following = smoothed[(index + 1) % smoothed.length];
      next.push({
        x: point.x + (following.x - point.x) * amount,
        y: point.y + (following.y - point.y) * amount,
      });
      next.push({
        x: point.x + (following.x - point.x) * (1 - amount),
        y: point.y + (following.y - point.y) * (1 - amount),
      });
    });
    smoothed = next;
  }
  return smoothed;
}

function createRegionTransform(random) {
  return {
    centerX: 0.5 + seededRange(random, -0.015, 0.015),
    centerY: 0.5 + seededRange(random, -0.015, 0.015),
    scaleX: seededRange(random, 0.9, 0.98),
    scaleY: seededRange(random, 0.9, 0.98),
  };
}

function regionPointToWorld([x, y], template, transform) {
  const usableWidth = WORLD.width - TRACK_BOUNDARY_PADDING * 2;
  const usableHeight = WORLD.height - TRACK_BOUNDARY_PADDING * 2;
  const normalizedX = x / template.columns;
  const normalizedY = y / template.rows;

  return {
    x: TRACK_BOUNDARY_PADDING + clamp(
      transform.centerX + (normalizedX - 0.5) * transform.scaleX,
      0.04,
      0.96,
    ) * usableWidth,
    y: TRACK_BOUNDARY_PADDING + clamp(
      transform.centerY + (normalizedY - 0.5) * transform.scaleY,
      0.06,
      0.94,
    ) * usableHeight,
  };
}

export function generateRegionCenterlineControls(seed) {
  const random = createMulberry32(seed);
  const template = REGION_TRACK_TEMPLATES[seed % REGION_TRACK_TEMPLATES.length] ?? REGION_TRACK_TEMPLATES[0];
  const transform = createRegionTransform(random);
  const boundary = traceRegionBoundary(template).map((point) => regionPointToWorld(point, template, transform));
  return rotateControls(smoothRegionBoundary(boundary), random);
}

export function strengthenShapeVariation(controls) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const radii = controls.map((point) => distance(point, center));
  const mean = radii.reduce((total, radius) => total + radius, 0) / Math.max(1, radii.length);
  const variation = mean > 0
    ? Math.sqrt(radii.reduce((total, radius) => total + (radius - mean) ** 2, 0) / Math.max(1, radii.length)) / mean
    : 0;
  if (variation > MIN_TRACK_SHAPE_VARIATION + 0.015) return controls;

  return controls.map((point) => {
    const radius = distance(point, center);
    if (radius <= 0) return point;
    const amount = mean + (radius - mean) * 1.18;
    const scale = amount / radius;
    return {
      x: clamp(center.x + (point.x - center.x) * scale, TRACK_BOUNDARY_PADDING, WORLD.width - TRACK_BOUNDARY_PADDING),
      y: clamp(center.y + (point.y - center.y) * scale, TRACK_BOUNDARY_PADDING, WORLD.height - TRACK_BOUNDARY_PADDING),
    };
  });
}

export function generateCenterlineControls(seed) {
  return strengthenShapeVariation(generateRegionCenterlineControls(seed));
}

export function generateFallbackCenterlineControls(seed) {
  return strengthenShapeVariation(generateRegionCenterlineControls(seed ^ 0xa5a5a5a5));
}

export function generateSafeFallbackCenterlineControls(seed) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const scale = 0.78 + ((seed >>> 3) % 4) * 0.02;
  const mirrorX = (seed & 1) === 1 ? -1 : 1;
  const mirrorY = (seed & 2) === 2 ? -1 : 1;
  const controls = CENTERLINE_CONTROLS.map((point) => ({
    x: center.x + (point.x - center.x) * scale * mirrorX,
    y: center.y + (point.y - center.y) * scale * mirrorY,
  }));

  return rotateControls(controls, createMulberry32(seed ^ 0x9e3779b9));
}
