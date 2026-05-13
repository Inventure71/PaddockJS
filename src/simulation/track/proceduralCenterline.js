import { clamp, createMulberry32, seededRange } from '../simMath.js';
import { CENTERLINE_CONTROLS, TRACK_BOUNDARY_PADDING, WORLD, MIN_TRACK_SHAPE_VARIATION } from './trackConstants.js';
import { distance } from './trackMath.js';

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

function randomInteger(random, min, max) {
  return Math.floor(seededRange(random, min, max + 1));
}

function clampInteger(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function createRandomRegionTemplate(seed, options = {}) {
  const random = createMulberry32(seed);
  const cornerDensity = Number.isFinite(options.cornerDensity) ? Math.max(0.5, options.cornerDensity) : 1;
  const extraColumns = Math.round((cornerDensity - 1) * 4);
  const extraFeatures = Math.round((cornerDensity - 1) * 3);
  const columns = randomInteger(random, options.minColumns ?? 10, options.maxColumns ?? (14 + extraColumns));
  const rows = randomInteger(random, options.minRows ?? 7, options.maxRows ?? (8 + Math.max(0, Math.round(extraColumns / 2))));
  const top = new Array(columns).fill(1);
  const bottom = new Array(columns).fill(rows - 2);
  let topCursor = randomInteger(random, 1, 2);
  let bottomCursor = rows - randomInteger(random, 2, 3);

  for (let column = 1; column < columns - 1; column += 1) {
    topCursor += randomInteger(random, -1, 1);
    bottomCursor += randomInteger(random, -1, 1);
    topCursor = clampInteger(topCursor, 1, rows - 4);
    bottomCursor = clampInteger(bottomCursor, topCursor + 2, rows - 2);
    top[column] = topCursor;
    bottom[column] = bottomCursor;
  }

  const featureCount = randomInteger(random, options.minFeatures ?? 4, options.maxFeatures ?? (6 + extraFeatures));
  for (let feature = 0; feature < featureCount; feature += 1) {
    const column = randomInteger(random, 2, columns - 3);
    const width = randomInteger(random, 1, 2);
    const carvesTop = random() < 0.5;
    const amount = random() < 0.76 ? 1 : 2;

    for (let offset = 0; offset < width; offset += 1) {
      const target = clampInteger(column + offset, 1, columns - 2);
      if (carvesTop) {
        top[target] = clampInteger(top[target] + amount, 1, bottom[target] - 2);
        top[target - 1] = clampInteger(top[target - 1] - 1, 1, bottom[target - 1] - 2);
      } else {
        bottom[target] = clampInteger(bottom[target] - amount, top[target] + 2, rows - 2);
        bottom[target - 1] = clampInteger(bottom[target - 1] + 1, top[target - 1] + 2, rows - 2);
      }
    }
  }

  const cells = [];
  for (let column = 1; column < columns - 1; column += 1) {
    for (let row = top[column]; row <= bottom[column]; row += 1) {
      cells.push([column, row]);
    }
  }

  return { columns, rows, cells };
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

function createRegionTransform(random, options = {}) {
  const scale = Number.isFinite(options.scale) ? Math.max(0.05, options.scale) : 1;
  return {
    centerX: 0.5 + seededRange(random, -0.015, 0.015),
    centerY: 0.5 + seededRange(random, -0.015, 0.015),
    scaleX: seededRange(random, 0.9, 0.98) * scale,
    scaleY: seededRange(random, 0.9, 0.98) * scale,
    phaseX: seededRange(random, 0, Math.PI * 2),
    phaseY: seededRange(random, 0, Math.PI * 2),
    warpX: seededRange(random, 0.018, 0.044),
    warpY: seededRange(random, 0.018, 0.052),
  };
}

function regionPointToWorld([x, y], template, transform) {
  const usableWidth = WORLD.width - TRACK_BOUNDARY_PADDING * 2;
  const usableHeight = WORLD.height - TRACK_BOUNDARY_PADDING * 2;
  const normalizedX = x / template.columns;
  const normalizedY = y / template.rows;
  const radialX = normalizedX - 0.5;
  const radialY = normalizedY - 0.5;
  const edgeInfluence = clamp((Math.abs(radialX) + Math.abs(radialY) - 0.22) / 0.36, 0, 1);
  const warpX = Math.sin(normalizedY * Math.PI * 4.4 + transform.phaseX) * transform.warpX * edgeInfluence;
  const warpY = Math.sin(normalizedX * Math.PI * 4.2 + transform.phaseY) * transform.warpY * edgeInfluence;

  return {
    x: TRACK_BOUNDARY_PADDING + clamp(
      transform.centerX + radialX * transform.scaleX + warpX,
      0.04,
      0.96,
    ) * usableWidth,
    y: TRACK_BOUNDARY_PADDING + clamp(
      transform.centerY + radialY * transform.scaleY + warpY,
      0.06,
      0.94,
    ) * usableHeight,
  };
}

export function generateRegionCenterlineControls(seed, options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const random = createMulberry32(normalizedSeed);
  const template = options.fallback
    ? createRandomRegionTemplate(normalizedSeed, {
      minColumns: 9,
      maxColumns: 13,
      minRows: 6,
      maxRows: 8,
      minFeatures: 3,
      maxFeatures: 5,
      cornerDensity: options.cornerDensity,
    })
    : createRandomRegionTemplate(normalizedSeed, { cornerDensity: options.cornerDensity });
  const transform = createRegionTransform(random, options);
  const boundary = traceRegionBoundary(template).map((point) => regionPointToWorld(point, template, transform));
  return rotateControls(smoothRegionBoundary(boundary), random);
}

export function strengthenShapeVariation(controls, minimumVariation = MIN_TRACK_SHAPE_VARIATION) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const radii = controls.map((point) => distance(point, center));
  const mean = radii.reduce((total, radius) => total + radius, 0) / Math.max(1, radii.length);
  const variation = mean > 0
    ? Math.sqrt(radii.reduce((total, radius) => total + (radius - mean) ** 2, 0) / Math.max(1, radii.length)) / mean
    : 0;
  if (variation > minimumVariation + 0.015) return controls;

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

export function generateCenterlineControls(seed, options = {}) {
  return strengthenShapeVariation(generateRegionCenterlineControls(seed, options), options.variation);
}

export function generateFallbackCenterlineControls(seed, options = {}) {
  return strengthenShapeVariation(
    generateRegionCenterlineControls(seed ^ 0xa5a5a5a5, { ...options, fallback: true }),
    options.variation,
  );
}

export function generateSafeFallbackCenterlineControls(seed, options = {}) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const scale = (0.78 + ((seed >>> 3) % 4) * 0.02) *
    (Number.isFinite(options.scale) ? Math.max(0.05, options.scale) : 1);
  const mirrorX = (seed & 1) === 1 ? -1 : 1;
  const mirrorY = (seed & 2) === 2 ? -1 : 1;
  const controls = CENTERLINE_CONTROLS.map((point) => ({
    x: center.x + (point.x - center.x) * scale * mirrorX,
    y: center.y + (point.y - center.y) * scale * mirrorY,
  }));

  return rotateControls(controls, createMulberry32(seed ^ 0x9e3779b9));
}
