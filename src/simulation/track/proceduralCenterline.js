import { clamp, createMulberry32, seededRange } from '../simMath.js';
import { CENTERLINE_CONTROLS, PROCEDURAL_TRACK_TEMPLATES, TRACK_BOUNDARY_PADDING, WORLD, MIN_TRACK_SHAPE_VARIATION } from './trackConstants.js';
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

export function makeTemplatePoint([x, y], random, index) {
  const edgeDistance = Math.min(x, 1 - x, y, 1 - y);
  const jitter = edgeDistance < 0.13 ? 0.014 : 0.03;
  const chicaneNudge = index % 5 === 2 ? seededRange(random, -0.024, 0.024) : 0;

  return {
    x: clamp(x + seededRange(random, -jitter, jitter) + chicaneNudge, 0.06, 0.94),
    y: clamp(y + seededRange(random, -jitter, jitter) - chicaneNudge * 0.55, 0.08, 0.92),
  };
}

export function applySectorMorph(points, random) {
  const center = { x: 0.5, y: 0.5 };
  const horizontalBias = seededRange(random, -0.035, 0.035);
  const verticalBias = seededRange(random, -0.035, 0.035);
  const squeeze = seededRange(random, 0.94, 1.06);
  const stretch = seededRange(random, 0.93, 1.07);
  const layoutScale = seededRange(random, 0.76, 0.84);

  return points.map((point, index) => {
    const turnComplex = index % 4 === 1 ? seededRange(random, -0.024, 0.024) : 0;
    return {
      x: clamp(center.x + (point.x - center.x) * stretch * layoutScale + horizontalBias + turnComplex, 0.06, 0.94),
      y: clamp(center.y + (point.y - center.y) * squeeze * layoutScale + verticalBias - turnComplex * 0.4, 0.08, 0.92),
    };
  });
}

export function normalizedToWorld(point) {
  const usableWidth = WORLD.width - TRACK_BOUNDARY_PADDING * 2;
  const usableHeight = WORLD.height - TRACK_BOUNDARY_PADDING * 2;
  return {
    x: TRACK_BOUNDARY_PADDING + point.x * usableWidth,
    y: TRACK_BOUNDARY_PADDING + point.y * usableHeight,
  };
}

export function rotateControls(controls, random) {
  const rotation = Math.floor(seededRange(random, 0, controls.length));
  return [...controls.slice(rotation), ...controls.slice(0, rotation)];
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
  const random = createMulberry32(seed);
  const template = PROCEDURAL_TRACK_TEMPLATES[Math.floor(seededRange(random, 0, PROCEDURAL_TRACK_TEMPLATES.length))]
    ?? PROCEDURAL_TRACK_TEMPLATES[0];
  const normalized = applySectorMorph(
    template.map((point, index) => makeTemplatePoint(point, random, index)),
    random,
  );

  return rotateControls(strengthenShapeVariation(normalized.map(normalizedToWorld)), random);
}

export function generateFallbackCenterlineControls(seed) {
  const random = createMulberry32(seed ^ 0xa5a5a5a5);
  const template = PROCEDURAL_TRACK_TEMPLATES[(seed >>> 2) % PROCEDURAL_TRACK_TEMPLATES.length] ??
    PROCEDURAL_TRACK_TEMPLATES[0];
  const normalized = applySectorMorph(
    template.map((point, index) => makeTemplatePoint(point, random, index)),
    random,
  );

  return rotateControls(strengthenShapeVariation(normalized.map(normalizedToWorld)), random);
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
