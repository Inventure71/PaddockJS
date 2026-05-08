import { clamp, createMulberry32, normalizeAngle, seededRange, wrapDistance } from './simMath.js';

export const WORLD = {
  width: 7600,
  height: 4600,
};

export const TRACK = {
  name: 'Apex Harbor GP',
  width: 230,
  kerbWidth: 34,
  gravelWidth: 165,
  runoffWidth: 260,
  sampleCount: 3600,
  drsZones: [
    { id: 'main-straight', startRatio: 0.02, endRatio: 0.18 },
    { id: 'back-straight', startRatio: 0.43, endRatio: 0.60 },
    { id: 'harbor-straight', startRatio: 0.82, endRatio: 0.96 },
  ],
};

const GENERATED_TRACK_MIN_LENGTH = 7600;
const GENERATED_TRACK_MAX_LENGTH = 16000;
const GENERATED_TRACK_ATTEMPTS = 24;
const GENERATED_FALLBACK_ATTEMPTS = 8;
const TRACK_BOUNDARY_PADDING = 520;
const MIN_TRACK_CLEARANCE_MULTIPLIER = 1.55;
const MIN_TRACK_SHAPE_VARIATION = 0.28;
const MAX_LOCAL_TURN_RADIANS = 1.5;
const START_STRAIGHT_GRID_LENGTH = 1040;
const START_STRAIGHT_EXIT_LENGTH = 360;
const START_STRAIGHT_LOCK_EXTRA = 90;
const START_STRAIGHT_BLEND_LENGTH = 180;
const NEAREST_HINT_WINDOW_SAMPLES = 240;
const PIT_ENTRY_DISTANCE = -1900;
const PIT_EXIT_DISTANCE = 420;
const PIT_LANE_WIDTH = 72;
const PIT_LANE_EDGE_GAP = 220;
const PIT_ACCESS_MIN_LENGTH = 220;
const PIT_ACCESS_MAX_LENGTH = 360;
const PIT_ACCESS_TANGENT_RATIO = 0.72;
const PIT_ACCESS_SAMPLE_STEPS = 24;
const PIT_ACCESS_TRACK_OVERLAP = PIT_LANE_WIDTH * 0.52;
const PIT_ACCESS_SEARCH_STEP = 18;
const PIT_ENTRY_SEARCH_BEFORE = 480;
const PIT_ENTRY_SEARCH_AFTER = 520;
const PIT_EXIT_SEARCH_BEFORE = 120;
const PIT_EXIT_SEARCH_AFTER = 1180;
const PIT_BOX_COUNT = 20;
const PIT_TEAM_COUNT = 10;
const PIT_BOXES_PER_TEAM = 2;
const PIT_BOX_LENGTH = 46;
const PIT_BOX_DEPTH = 48;
const PIT_BOX_PAIR_GAP = 22;
const PIT_TEAM_GAP = 105;
const PIT_BOX_TO_LANE_GAP = 8;
const PIT_WORKING_LANE_GAP = 8;
const PIT_WORKING_LANE_WIDTH = 82;
const PIT_SERVICE_AREA_LENGTH = 74;
const PIT_SERVICE_AREA_DEPTH = 52;
const PIT_SERVICE_QUEUE_GAP = 100;
const PIT_WORLD_PADDING = 96;
const PROCEDURAL_TRACK_TEMPLATES = [
  [
    [0.08, 0.55], [0.10, 0.80], [0.22, 0.89], [0.42, 0.84], [0.52, 0.93],
    [0.60, 0.75], [0.74, 0.88], [0.91, 0.76], [0.94, 0.54], [0.82, 0.46],
    [0.94, 0.28], [0.78, 0.18], [0.62, 0.31], [0.54, 0.13], [0.43, 0.30],
    [0.33, 0.17], [0.20, 0.24], [0.12, 0.38], [0.22, 0.48], [0.13, 0.50],
  ],
  [
    [0.07, 0.46], [0.14, 0.72], [0.25, 0.83], [0.39, 0.73], [0.47, 0.88],
    [0.56, 0.70], [0.67, 0.82], [0.88, 0.84], [0.95, 0.63], [0.83, 0.56],
    [0.92, 0.43], [0.79, 0.35], [0.88, 0.20], [0.68, 0.15], [0.58, 0.29],
    [0.47, 0.18], [0.34, 0.30], [0.21, 0.19], [0.10, 0.28], [0.17, 0.39],
  ],
  [
    [0.06, 0.61], [0.13, 0.86], [0.31, 0.91], [0.43, 0.79], [0.57, 0.87],
    [0.71, 0.70], [0.92, 0.72], [0.95, 0.50], [0.84, 0.43], [0.91, 0.32],
    [0.74, 0.24], [0.69, 0.11], [0.54, 0.18], [0.45, 0.08], [0.35, 0.22],
    [0.23, 0.17], [0.11, 0.31], [0.24, 0.43], [0.15, 0.52], [0.28, 0.60],
  ],
];
const PROCEDURAL_TRACK_CACHE = new Map();
const TRACK_MODEL_CACHE = new WeakMap();

const CENTERLINE_CONTROLS = [
  { x: WORLD.width * 0.05, y: WORLD.height * 0.56 },
  { x: WORLD.width * 0.10, y: WORLD.height * 0.81 },
  { x: WORLD.width * 0.23, y: WORLD.height * 0.91 },
  { x: WORLD.width * 0.35, y: WORLD.height * 0.80 },
  { x: WORLD.width * 0.48, y: WORLD.height * 0.90 },
  { x: WORLD.width * 0.59, y: WORLD.height * 0.75 },
  { x: WORLD.width * 0.71, y: WORLD.height * 0.87 },
  { x: WORLD.width * 0.82, y: WORLD.height * 0.72 },
  { x: WORLD.width * 0.94, y: WORLD.height * 0.66 },
  { x: WORLD.width * 0.96, y: WORLD.height * 0.47 },
  { x: WORLD.width * 0.88, y: WORLD.height * 0.33 },
  { x: WORLD.width * 0.74, y: WORLD.height * 0.31 },
  { x: WORLD.width * 0.64, y: WORLD.height * 0.18 },
  { x: WORLD.width * 0.54, y: WORLD.height * 0.31 },
  { x: WORLD.width * 0.43, y: WORLD.height * 0.13 },
  { x: WORLD.width * 0.29, y: WORLD.height * 0.18 },
  { x: WORLD.width * 0.17, y: WORLD.height * 0.31 },
  { x: WORLD.width * 0.08, y: WORLD.height * 0.43 },
];

function uniformCatmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    ),
  };
}

function centripetalCatmullRom(p0, p1, p2, p3, t) {
  const t0 = 0;
  const t1 = t0 + Math.sqrt(Math.max(distance(p0, p1), 0.001));
  const t2 = t1 + Math.sqrt(Math.max(distance(p1, p2), 0.001));
  const t3 = t2 + Math.sqrt(Math.max(distance(p2, p3), 0.001));
  const localT = t1 + (t2 - t1) * t;

  const interpolate = (a, b, start, end) => {
    const span = Math.max(end - start, 0.001);
    const amount = (localT - start) / span;
    return {
      x: a.x + (b.x - a.x) * amount,
      y: a.y + (b.y - a.y) * amount,
    };
  };

  const a1 = interpolate(p0, p1, t0, t1);
  const a2 = interpolate(p1, p2, t1, t2);
  const a3 = interpolate(p2, p3, t2, t3);
  const b1 = interpolate(a1, a2, t0, t2);
  const b2 = interpolate(a2, a3, t1, t3);
  return interpolate(b1, b2, t1, t2);
}

function normalizeSeed(seed) {
  if (Number.isFinite(seed)) return seed >>> 0;
  let hash = 2166136261;
  String(seed ?? 'f1-track').split('').forEach((character) => {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return hash >>> 0;
}

function rawCenterPoint(ratio, controls = CENTERLINE_CONTROLS, interpolation = 'uniform') {
  const count = controls.length;
  const scaled = ratio * count;
  const index = Math.floor(scaled) % count;
  const localT = scaled - Math.floor(scaled);
  const p0 = controls[(index - 1 + count) % count];
  const p1 = controls[index];
  const p2 = controls[(index + 1) % count];
  const p3 = controls[(index + 2) % count];
  return interpolation === 'centripetal'
    ? centripetalCatmullRom(p0, p1, p2, p3, localT)
    : uniformCatmullRom(p0, p1, p2, p3, localT);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentBoxesOverlap(a, b, c, d) {
  return (
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  );
}

function segmentsIntersect(a, b, c, d) {
  if (!segmentBoxesOverlap(a, b, c, d)) return false;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function hasSelfIntersections(samples) {
  const points = samples.slice(0, -1).filter((_, index) => index % 12 === 0);
  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      const sharesLoopClosure = first === 0 && second >= points.length - 3;
      if (sharesLoopClosure) continue;
      if (segmentsIntersect(points[first], points[first + 1], points[second], points[second + 1])) return true;
    }
  }
  return false;
}

function samplesStayInsideWorld(samples) {
  return samples.every((sample) => (
    sample.x >= TRACK_BOUNDARY_PADDING &&
    sample.x <= WORLD.width - TRACK_BOUNDARY_PADDING &&
    sample.y >= TRACK_BOUNDARY_PADDING &&
    sample.y <= WORLD.height - TRACK_BOUNDARY_PADDING
  ));
}

function hasEnoughTrackClearance(samples, totalLength, minimumClearance) {
  const points = samples.slice(0, -1).filter((_, index) => index % 24 === 0);
  const minimumClearanceSquared = minimumClearance * minimumClearance;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const arcDistance = Math.abs(points[second].distance - points[first].distance);
      const loopDistance = Math.min(arcDistance, totalLength - arcDistance);
      if (loopDistance < 700) continue;
      const dx = points[first].x - points[second].x;
      const dy = points[first].y - points[second].y;
      if (dx * dx + dy * dy < minimumClearanceSquared) return false;
    }
  }
  return true;
}

function hasReasonableTurnSharpness(samples) {
  const usableSamples = samples.slice(0, -1);
  const windows = [30, 36];
  const step = 6;

  for (let index = 0; index < usableSamples.length; index += step) {
    for (const window of windows) {
      let accumulatedTurn = 0;
      for (let offset = 0; offset < window; offset += step) {
        const current = usableSamples[(index + offset) % usableSamples.length];
        const next = usableSamples[(index + offset + step) % usableSamples.length];
        accumulatedTurn += Math.abs(normalizeAngle(next.heading - current.heading));
      }
      if (accumulatedTurn > MAX_LOCAL_TURN_RADIANS) return false;
    }
  }

  return true;
}

function hasEnoughShapeVariation(controls) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const radii = controls.map((point) => distance(point, center));
  const mean = radii.reduce((total, radius) => total + radius, 0) / Math.max(1, radii.length);
  if (mean <= 0) return false;
  const variance = radii.reduce((total, radius) => total + (radius - mean) ** 2, 0) / Math.max(1, radii.length);
  return Math.sqrt(variance) / mean > MIN_TRACK_SHAPE_VARIATION;
}

function distanceForwardAlongTrack(from, to, totalLength) {
  return to >= from ? to - from : totalLength - from + to;
}

function recalculateSampleGeometry(samples) {
  const usableCount = samples.length - 1;
  for (let index = 0; index < usableCount; index += 1) {
    const sample = samples[index];
    const previous = samples[(index - 1 + usableCount) % usableCount];
    const next = samples[(index + 1) % usableCount];
    const nextNext = samples[(index + 2) % usableCount];
    const heading = Math.atan2(next.y - previous.y, next.x - previous.x);
    const nextHeading = Math.atan2(nextNext.y - sample.y, nextNext.x - sample.x);
    sample.heading = heading;
    sample.normalX = -Math.sin(heading);
    sample.normalY = Math.cos(heading);
    sample.curvature = Math.abs(normalizeAngle(nextHeading - heading)) / 28;
  }

  samples[usableCount] = {
    ...samples[0],
    distance: samples[usableCount].distance,
  };

  return samples;
}

function rebuildSampleDistances(samples) {
  const usable = samples.slice(0, -1).map((sample) => ({ ...sample }));
  let rebuiltLength = 0;

  usable.forEach((sample, index) => {
    if (index > 0) rebuiltLength += distance(usable[index - 1], sample);
    sample.distance = rebuiltLength;
  });

  rebuiltLength += distance(usable.at(-1), usable[0]);
  const rebuilt = [
    ...usable,
    {
      ...usable[0],
      distance: rebuiltLength,
    },
  ];

  return {
    samples: recalculateSampleGeometry(rebuilt),
    totalLength: rebuiltLength,
  };
}

function smoothstep(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function blendPoint(original, target, amount) {
  return {
    ...original,
    x: original.x + (target.x - original.x) * amount,
    y: original.y + (target.y - original.y) * amount,
  };
}

function straightenStandingStartSamples(samples, totalLength) {
  const start = samples[0];
  const forward = {
    x: Math.cos(start.heading),
    y: Math.sin(start.heading),
  };
  const gridLockLength = START_STRAIGHT_GRID_LENGTH + START_STRAIGHT_LOCK_EXTRA;
  const exitLockLength = START_STRAIGHT_EXIT_LENGTH + START_STRAIGHT_LOCK_EXTRA;

  const straightened = samples.slice(0, -1).map((sample) => {
    const distanceFromStart = sample.distance;
    const distanceToStart = totalLength - sample.distance;
    let lineDistance = null;
    let blendAmount = 0;

    if (distanceFromStart <= exitLockLength + START_STRAIGHT_BLEND_LENGTH) {
      lineDistance = distanceFromStart;
      blendAmount = distanceFromStart <= exitLockLength
        ? 1
        : 1 - smoothstep((distanceFromStart - exitLockLength) / START_STRAIGHT_BLEND_LENGTH);
    } else if (distanceToStart <= gridLockLength + START_STRAIGHT_BLEND_LENGTH) {
      lineDistance = -distanceToStart;
      blendAmount = distanceToStart <= gridLockLength
        ? 1
        : 1 - smoothstep((distanceToStart - gridLockLength) / START_STRAIGHT_BLEND_LENGTH);
    }

    if (lineDistance == null || blendAmount <= 0) return { ...sample };

    return blendPoint(sample, {
      ...sample,
      x: start.x + forward.x * lineDistance,
      y: start.y + forward.y * lineDistance,
    }, blendAmount);
  });

  return rebuildSampleDistances([
    ...straightened,
    {
      ...straightened[0],
      distance: totalLength,
    },
  ]);
}

function chooseStandingStartIndex(samples, totalLength) {
  const usableSamples = samples.slice(0, -1);
  let best = { index: 0, score: Infinity };

  for (let index = 0; index < usableSamples.length; index += 1) {
    const candidate = usableSamples[index];
    const candidateForward = {
      x: Math.cos(candidate.heading),
      y: Math.sin(candidate.heading),
    };
    const projectedGridEnd = {
      x: candidate.x - candidateForward.x * START_STRAIGHT_GRID_LENGTH,
      y: candidate.y - candidateForward.y * START_STRAIGHT_GRID_LENGTH,
    };
    const projectedExitEnd = {
      x: candidate.x + candidateForward.x * START_STRAIGHT_EXIT_LENGTH,
      y: candidate.y + candidateForward.y * START_STRAIGHT_EXIT_LENGTH,
    };
    const projectedClearance = Math.min(pointWorldClearance(projectedGridEnd), pointWorldClearance(projectedExitEnd));
    if (projectedClearance < 0) continue;

    let gridTurn = 0;
    let gridCurvature = 0;
    let gridCount = 0;
    let exitTurn = 0;
    let exitCurvature = 0;
    let exitCount = 0;

    for (let offset = 1; offset < usableSamples.length; offset += 1) {
      const sample = usableSamples[(index - offset + usableSamples.length) % usableSamples.length];
      const distanceToLine = distanceForwardAlongTrack(sample.distance, candidate.distance, totalLength);
      if (distanceToLine > START_STRAIGHT_GRID_LENGTH) break;
      gridTurn = Math.max(gridTurn, Math.abs(normalizeAngle(candidate.heading - sample.heading)));
      gridCurvature += sample.curvature;
      gridCount += 1;
    }

    for (let offset = 1; offset < usableSamples.length; offset += 1) {
      const sample = usableSamples[(index + offset) % usableSamples.length];
      const distanceFromLine = distanceForwardAlongTrack(candidate.distance, sample.distance, totalLength);
      if (distanceFromLine > START_STRAIGHT_EXIT_LENGTH) break;
      exitTurn = Math.max(exitTurn, Math.abs(normalizeAngle(sample.heading - candidate.heading)));
      exitCurvature += sample.curvature;
      exitCount += 1;
    }

    const score =
      gridTurn * 5 +
      exitTurn * 1.2 +
      (gridCurvature / Math.max(1, gridCount)) * 2600 +
      (exitCurvature / Math.max(1, exitCount)) * 650 -
      projectedClearance * 0.002;

    if (score < best.score) best = { index, score };
  }

  return best.index;
}

function rotateSamplesToStandingStart(samples, totalLength) {
  const usableSamples = samples.slice(0, -1);
  const startIndex = chooseStandingStartIndex(samples, totalLength);
  const startDistance = usableSamples[startIndex].distance;

  const rotated = [
    ...usableSamples.slice(startIndex),
    ...usableSamples.slice(0, startIndex),
  ].map((sample) => ({
    ...sample,
    distance: distanceForwardAlongTrack(startDistance, sample.distance, totalLength),
  }));

  return [
    ...rotated,
    {
      ...rotated[0],
      distance: totalLength,
    },
  ];
}

function makeTemplatePoint([x, y], random, index) {
  const edgeDistance = Math.min(x, 1 - x, y, 1 - y);
  const jitter = edgeDistance < 0.13 ? 0.014 : 0.03;
  const chicaneNudge = index % 5 === 2 ? seededRange(random, -0.024, 0.024) : 0;

  return {
    x: clamp(x + seededRange(random, -jitter, jitter) + chicaneNudge, 0.06, 0.94),
    y: clamp(y + seededRange(random, -jitter, jitter) - chicaneNudge * 0.55, 0.08, 0.92),
  };
}

function applySectorMorph(points, random) {
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

function normalizedToWorld(point) {
  const usableWidth = WORLD.width - TRACK_BOUNDARY_PADDING * 2;
  const usableHeight = WORLD.height - TRACK_BOUNDARY_PADDING * 2;
  return {
    x: TRACK_BOUNDARY_PADDING + point.x * usableWidth,
    y: TRACK_BOUNDARY_PADDING + point.y * usableHeight,
  };
}

function rotateControls(controls, random) {
  const rotation = Math.floor(seededRange(random, 0, controls.length));
  return [...controls.slice(rotation), ...controls.slice(0, rotation)];
}

function strengthenShapeVariation(controls) {
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

function generateCenterlineControls(seed) {
  const random = createMulberry32(seed);
  const template = PROCEDURAL_TRACK_TEMPLATES[Math.floor(seededRange(random, 0, PROCEDURAL_TRACK_TEMPLATES.length))]
    ?? PROCEDURAL_TRACK_TEMPLATES[0];
  const normalized = applySectorMorph(
    template.map((point, index) => makeTemplatePoint(point, random, index)),
    random,
  );

  return rotateControls(strengthenShapeVariation(normalized.map(normalizedToWorld)), random);
}

function generateFallbackCenterlineControls(seed) {
  const random = createMulberry32(seed ^ 0xa5a5a5a5);
  const template = PROCEDURAL_TRACK_TEMPLATES[(seed >>> 2) % PROCEDURAL_TRACK_TEMPLATES.length] ??
    PROCEDURAL_TRACK_TEMPLATES[0];
  const normalized = applySectorMorph(
    template.map((point, index) => makeTemplatePoint(point, random, index)),
    random,
  );

  return rotateControls(strengthenShapeVariation(normalized.map(normalizedToWorld)), random);
}

function generateSafeFallbackCenterlineControls(seed) {
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

function normalizeDrsZone(zone, totalLength) {
  if (Number.isFinite(zone.start) && Number.isFinite(zone.end)) return zone;
  const start = zone.startRatio * totalLength;
  const rawEnd = zone.endRatio * totalLength;
  return {
    ...zone,
    start,
    end: rawEnd >= start ? rawEnd : rawEnd + totalLength,
  };
}

function createTrackSectors(totalLength) {
  return Array.from({ length: 3 }, (_, index) => {
    const startRatio = index / 3;
    const endRatio = (index + 1) / 3;
    const start = totalLength * startRatio;
    const end = totalLength * endRatio;

    return {
      index: index + 1,
      id: `s${index + 1}`,
      label: `S${index + 1}`,
      start,
      end,
      startRatio,
      endRatio,
      length: end - start,
    };
  });
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y,
    heading: point.heading,
    distance: point.distance,
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    length,
  };
}

function headingVector(heading) {
  return {
    x: Math.cos(heading),
    y: Math.sin(heading),
  };
}

function dotVectors(first, second) {
  return first.x * second.x + first.y * second.y;
}

function angleBetweenVectors(first, second) {
  const firstUnit = normalizeVector(first);
  const secondUnit = normalizeVector(second);
  return Math.acos(clamp(dotVectors(firstUnit, secondUnit), -1, 1));
}

function signedLateralOffsetToPoint(trackPoint, point) {
  return (point.x - trackPoint.x) * trackPoint.normalX + (point.y - trackPoint.y) * trackPoint.normalY;
}

function interpolatePitPoint(start, forward, distanceAlong) {
  return {
    x: start.x + forward.x * distanceAlong,
    y: start.y + forward.y * distanceAlong,
  };
}

function projectPitPoint(startPoint, forward, normal, distanceAlong, lateralOffset) {
  return {
    x: startPoint.x + forward.x * distanceAlong + normal.x * lateralOffset,
    y: startPoint.y + forward.y * distanceAlong + normal.y * lateralOffset,
  };
}

function pointWorldClearance(point) {
  return Math.min(
    point.x - PIT_WORLD_PADDING,
    WORLD.width - PIT_WORLD_PADDING - point.x,
    point.y - PIT_WORLD_PADDING,
    WORLD.height - PIT_WORLD_PADDING - point.y,
  );
}

function createStartStraightBasis(track) {
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

function createPitLaneEndpoints(track, side, laneOffset) {
  const basis = createStartStraightBasis(track);
  return {
    ...basis,
    start: projectPitPoint(basis.finish, basis.forward, basis.normal, PIT_ENTRY_DISTANCE, side * laneOffset),
    end: projectPitPoint(basis.finish, basis.forward, basis.normal, PIT_EXIT_DISTANCE, side * laneOffset),
  };
}

function scorePitLanePlacement(track, side, laneOffset) {
  const placement = createPitLaneEndpoints(track, side, laneOffset);
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

  for (let index = 0; index <= 6; index += 1) {
    const amount = index / 6;
    const lanePoint = interpolatePitPoint(entryLanePoint, laneVector, laneVector.length * amount);
    const boxPoint = {
      x: lanePoint.x + serviceNormal.x * boxLateral,
      y: lanePoint.y + serviceNormal.y * boxLateral,
    };
    minimumClearance = Math.min(minimumClearance, pointWorldClearance(lanePoint), pointWorldClearance(boxPoint));
    const progressHint = PIT_ENTRY_DISTANCE + (PIT_EXIT_DISTANCE - PIT_ENTRY_DISTANCE) * amount;
    minimumTrackClearance = Math.min(
      minimumTrackClearance,
      nearestTrackState(track, lanePoint, progressHint).crossTrackError - (track.width / 2 + (track.kerbWidth ?? 0) + 12),
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

function choosePitLanePlacement(track, baseLaneOffset) {
  const candidates = [];
  for (let offsetStep = 0; offsetStep <= 9; offsetStep += 1) {
    const laneOffset = baseLaneOffset + offsetStep * 72;
    candidates.push(scorePitLanePlacement(track, -1, laneOffset));
    candidates.push(scorePitLanePlacement(track, 1, laneOffset));
  }

  const valid = candidates
    .filter((candidate) => candidate.worldClearance > 0 && candidate.trackClearance > 0)
    .sort((left, right) => (
      Number(right.outwardDistance > 0) - Number(left.outwardDistance > 0) ||
      left.laneOffset - right.laneOffset ||
      right.score - left.score
    ));
  if (valid.length) return valid[0];

  return candidates.sort((left, right) => right.score - left.score)[0];
}

function createPitBoxCorners(center, forward, serviceNormal) {
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

function createPitRectangleCorners(center, forward, serviceNormal, length, depth) {
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

function createPitBoxes({ laneStart, laneForward, laneLength, serviceNormal }) {
  const runLength =
    PIT_BOX_COUNT * PIT_BOX_LENGTH +
    PIT_TEAM_COUNT * (PIT_BOXES_PER_TEAM - 1) * PIT_BOX_PAIR_GAP +
    (PIT_TEAM_COUNT - 1) * PIT_TEAM_GAP;
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

function sampleCubicBezier(p0, p1, p2, p3, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
  });
}

function createPitAccessRoadCenterline(start, end, startForward, endForward, tangentLength) {
  return sampleCubicBezier(
    start,
    {
      x: start.x + startForward.x * tangentLength,
      y: start.y + startForward.y * tangentLength,
    },
    {
      x: end.x - endForward.x * tangentLength,
      y: end.y - endForward.y * tangentLength,
    },
    end,
    PIT_ACCESS_SAMPLE_STEPS,
  );
}

function expandBounds(bounds, point) {
  if (!point) return bounds;
  return {
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

function createPointBounds(points, padding = 0) {
  const bounds = points.filter(Boolean).reduce(
    (current, point) => expandBounds(current, point),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  if (!Number.isFinite(bounds.minX)) return null;
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minY: bounds.minY - padding,
    maxY: bounds.maxY + padding,
  };
}

function pointInsideBounds(point, bounds) {
  if (!bounds) return true;
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function createLaneFacingTrackConnection(track, distanceFromStart, lanePoint) {
  const trackPoint = pointAt(track, distanceFromStart);
  const laneSide = signedLateralOffsetToPoint(trackPoint, lanePoint) >= 0 ? 1 : -1;
  const edgePoint = offsetTrackPoint(trackPoint, laneSide * (track.width / 2));
  const trackConnectPoint = offsetTrackPoint(
    trackPoint,
    laneSide * Math.max(0, track.width / 2 - PIT_ACCESS_TRACK_OVERLAP),
  );

  return {
    distanceFromStart,
    trackDistance: wrapDistance(trackPoint.distance, track.length),
    trackPoint,
    edgePoint,
    trackConnectPoint,
    laneSide,
  };
}

function scorePitAccessConnection(track, connection, lanePoint, laneForward, direction) {
  const roadVector = direction === 'entry'
    ? normalizeVector({
      x: lanePoint.x - connection.trackConnectPoint.x,
      y: lanePoint.y - connection.trackConnectPoint.y,
    })
    : normalizeVector({
      x: connection.trackConnectPoint.x - lanePoint.x,
      y: connection.trackConnectPoint.y - lanePoint.y,
    });
  const trackForward = headingVector(connection.trackPoint.heading);
  const trackAngle = angleBetweenVectors(roadVector, trackForward);
  const laneAngle = angleBetweenVectors(roadVector, laneForward);
  const laneFacingClearance = Math.abs(signedLateralOffsetToPoint(connection.trackPoint, lanePoint)) - track.width / 2;

  return {
    ...connection,
    roadVector,
    trackAngle,
    laneAngle,
    pathLength: roadVector.length,
    score:
      trackAngle * 1100 +
      laneAngle * 900 +
      roadVector.length * 0.32 -
      Math.max(0, laneFacingClearance) * 0.18,
  };
}

function findPitAccessConnection(track, lanePoint, laneForward, {
  direction,
  startDistance,
  endDistance,
  fallbackDistance,
}) {
  const start = Math.min(startDistance, endDistance);
  const end = Math.max(startDistance, endDistance);
  let best = null;
  let fallback = null;

  for (let distanceFromStart = start; distanceFromStart <= end; distanceFromStart += PIT_ACCESS_SEARCH_STEP) {
    const connection = scorePitAccessConnection(
      track,
      createLaneFacingTrackConnection(track, distanceFromStart, lanePoint),
      lanePoint,
      laneForward,
      direction,
    );
    fallback = !fallback || connection.score < fallback.score ? connection : fallback;
    if (connection.trackAngle > 1.15 || connection.laneAngle > 1.15) continue;
    best = !best || connection.score < best.score ? connection : best;
  }

  if (best) return best;

  return fallback ?? scorePitAccessConnection(
    track,
    createLaneFacingTrackConnection(track, fallbackDistance, lanePoint),
    lanePoint,
    laneForward,
    direction,
  );
}

function createPitLaneBounds(pitLane) {
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
  ) / 2 + 6;
  return createPointBounds(points, padding);
}

function createPitLaneModel(track) {
  const laneOffset = track.width / 2 + (track.kerbWidth ?? 0) + PIT_LANE_EDGE_GAP + PIT_LANE_WIDTH / 2;
  const placement = choosePitLanePlacement(track, laneOffset);
  const side = placement.side;
  const placedLaneOffset = placement.laneOffset;
  const startStraight = createPitLaneEndpoints(track, side, placedLaneOffset);
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
    startDistance: PIT_ENTRY_DISTANCE - PIT_ENTRY_SEARCH_BEFORE,
    endDistance: PIT_ENTRY_DISTANCE + PIT_ENTRY_SEARCH_AFTER,
    fallbackDistance: PIT_ENTRY_DISTANCE - accessLength,
  });
  const exitConnection = findPitAccessConnection(track, laneEnd, laneVector, {
    direction: 'exit',
    startDistance: PIT_EXIT_DISTANCE - PIT_EXIT_SEARCH_BEFORE,
    endDistance: PIT_EXIT_DISTANCE + PIT_EXIT_SEARCH_AFTER,
    fallbackDistance: PIT_EXIT_DISTANCE + accessLength,
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
  const entryMergePoint = interpolatePitPoint(laneStart, laneVector, Math.min(180, laneVector.length * 0.16));
  const exitMergePoint = interpolatePitPoint(laneEnd, laneVector, -Math.min(180, laneVector.length * 0.16));

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

function scoreStraightWindow(samples, startIndex, windowSize) {
  let curvature = 0;
  for (let offset = 0; offset < windowSize; offset += 1) {
    curvature += samples[(startIndex + offset) % (samples.length - 1)].curvature;
  }
  return curvature / windowSize;
}

function deriveDrsZones(samples, totalLength) {
  const usableSampleCount = samples.length - 1;
  const windowSize = Math.max(96, Math.floor(usableSampleCount * 0.07));
  const candidates = [];

  for (let index = 0; index < usableSampleCount; index += Math.floor(windowSize / 2)) {
    const start = samples[index];
    const end = samples[(index + windowSize) % usableSampleCount];
    const distance = end.distance >= start.distance
      ? end.distance - start.distance
      : totalLength - start.distance + end.distance;
    if (distance < 360) continue;
    candidates.push({
      startRatio: start.distance / totalLength,
      endRatio: (start.distance + Math.min(distance, totalLength * 0.16)) / totalLength,
      score: scoreStraightWindow(samples, index, windowSize),
    });
  }

  return candidates
    .sort((a, b) => a.score - b.score)
    .reduce((zones, candidate) => {
      const farEnough = zones.every((zone) => Math.abs(zone.startRatio - candidate.startRatio) > 0.18);
      if (farEnough && zones.length < 3) {
        zones.push({
          id: `generated-drs-${zones.length + 1}`,
          startRatio: candidate.startRatio % 1,
          endRatio: candidate.endRatio % 1,
        });
      }
      return zones;
    }, [])
    .sort((a, b) => a.startRatio - b.startRatio);
}

function isValidProceduralTrackModel(model) {
  return (
    model.length >= GENERATED_TRACK_MIN_LENGTH &&
    model.length <= GENERATED_TRACK_MAX_LENGTH &&
    hasEnoughShapeVariation(model.centerlineControls) &&
    samplesStayInsideWorld(model.samples) &&
    hasEnoughTrackClearance(model.samples, model.length, model.width * MIN_TRACK_CLEARANCE_MULTIPLIER) &&
    hasReasonableTurnSharpness(model.samples) &&
    !hasSelfIntersections(model.samples)
  );
}

export function buildTrackModel(track = TRACK) {
  const cached = TRACK_MODEL_CACHE.get(track);
  if (cached) return cached;

  const controls = track.centerlineControls ?? CENTERLINE_CONTROLS;
  const base = [];
  for (let index = 0; index <= track.sampleCount; index += 1) {
    base.push(rawCenterPoint(index / track.sampleCount, controls, track.curveInterpolation));
  }

  let totalLength = 0;
  const samples = base.map((point, index) => {
    if (index > 0) totalLength += distance(base[index - 1], point);
    return { ...point, distance: totalLength, heading: 0, normalX: 0, normalY: 0, curvature: 0 };
  });
  recalculateSampleGeometry(samples);

  const rotatedSamples = rotateSamplesToStandingStart(samples, totalLength);
  const straightenedTrack = straightenStandingStartSamples(rotatedSamples, totalLength);
  const normalizedSamples = straightenedTrack.samples;
  totalLength = straightenedTrack.totalLength;

  const model = {
    ...track,
    centerlineControls: controls,
    length: totalLength,
    samples: normalizedSamples,
    sectors: createTrackSectors(totalLength),
    drsZones: (track.drsZones ?? deriveDrsZones(normalizedSamples, totalLength))
      .map((zone) => normalizeDrsZone(zone, totalLength)),
  };
  model.pitLane = createPitLaneModel(model);
  TRACK_MODEL_CACHE.set(track, model);
  return model;
}

export function createProceduralTrack(seed = Date.now()) {
  const normalizedSeed = normalizeSeed(seed);
  const cached = PROCEDURAL_TRACK_CACHE.get(normalizedSeed);
  if (cached) return cached;

  for (let attempt = 0; attempt < GENERATED_FALLBACK_ATTEMPTS; attempt += 1) {
    const candidateSeed = (normalizedSeed + Math.imul(attempt, 2654435761)) >>> 0;
    const candidate = {
      ...TRACK,
      name: `Generated GP ${candidateSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: candidateSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateCenterlineControls(candidateSeed),
      drsZones: null,
    };
    const model = buildTrackModel(candidate);
    if (isValidProceduralTrackModel(model)) {
      const trackDefinition = {
        ...candidate,
        drsZones: model.drsZones.map(({ id, startRatio, endRatio }) => ({ id, startRatio, endRatio })),
      };
      PROCEDURAL_TRACK_CACHE.set(normalizedSeed, trackDefinition);
      return trackDefinition;
    }
  }

  let fallback = null;
  let fallbackModel = null;
  for (let attempt = 0; attempt < GENERATED_TRACK_ATTEMPTS; attempt += 1) {
    const candidateSeed = (normalizedSeed ^ Math.imul(attempt + 1, 2246822519)) >>> 0;
    const candidate = {
      ...TRACK,
      name: `Generated GP ${normalizedSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: candidateSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateFallbackCenterlineControls(candidateSeed),
      drsZones: null,
    };
    const model = buildTrackModel(candidate);
    if (isValidProceduralTrackModel(model)) {
      fallback = candidate;
      fallbackModel = model;
      break;
    }
  }

  if (!fallback || !fallbackModel) {
    fallback = {
      ...TRACK,
      name: `Generated GP ${normalizedSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: normalizedSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateSafeFallbackCenterlineControls(normalizedSeed),
      drsZones: null,
    };
    fallbackModel = buildTrackModel(fallback);
  }
  const fallbackDefinition = {
    ...fallback,
    drsZones: fallbackModel.drsZones.map(({ id, startRatio, endRatio }) => ({ id, startRatio, endRatio })),
  };
  PROCEDURAL_TRACK_CACHE.set(normalizedSeed, fallbackDefinition);
  return fallbackDefinition;
}

export function pointAt(track, distanceAlong) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  const low = sampleIndexAtDistance(track, wrapped);

  const next = track.samples[low] ?? track.samples[0];
  const previous = track.samples[Math.max(0, low - 1)] ?? next;
  const span = Math.max(1, next.distance - previous.distance);
  const amount = clamp((wrapped - previous.distance) / span, 0, 1);

  return {
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
    heading: previous.heading + normalizeAngle(next.heading - previous.heading) * amount,
    normalX: previous.normalX + (next.normalX - previous.normalX) * amount,
    normalY: previous.normalY + (next.normalY - previous.normalY) * amount,
    curvature: previous.curvature + (next.curvature - previous.curvature) * amount,
    distance: wrapped,
  };
}

function sampleIndexAtDistance(track, distanceAlong) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  let low = 0;
  let high = track.samples.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (track.samples[mid].distance < wrapped) low = mid + 1;
    else high = mid;
  }

  return low;
}

function nearestSampleInRange(track, position, startIndex, endIndex) {
  const sampleCount = track.samples.length - 1;
  let best = null;
  let bestDistance = Infinity;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const wrappedIndex = ((index % sampleCount) + sampleCount) % sampleCount;
    const sample = track.samples[wrappedIndex];
    const dx = position.x - sample.x;
    const dy = position.y - sample.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestDistance) {
      bestDistance = squared;
      best = sample;
    }
  }

  return { best, bestDistance };
}

function nearestSampleGlobal(track, position) {
  return nearestSampleInRange(track, position, 0, track.samples.length - 2);
}

function projectPointToSegment(position, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared, 0, 1)
    : 0;
  const projected = {
    x: start.x + dx * amount,
    y: start.y + dy * amount,
  };
  const length = Math.sqrt(lengthSquared);
  const heading = Math.atan2(dy, dx);
  const normalX = length > 0 ? -dy / length : 0;
  const normalY = length > 0 ? dx / length : 1;
  const signedOffset = (position.x - projected.x) * normalX + (position.y - projected.y) * normalY;

  return {
    point: projected,
    amount,
    length,
    heading,
    normalX,
    normalY,
    signedOffset,
    crossTrackError: Math.abs(signedOffset),
  };
}

function nearestPointOnPolyline(points, position) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let best = null;
  let distanceBefore = 0;
  let totalLength = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const projection = projectPointToSegment(position, current, next);
    if (!best || projection.crossTrackError < best.crossTrackError) {
      best = {
        ...projection,
        segmentIndex: index,
        distanceAlong: distanceBefore + projection.length * projection.amount,
      };
    }
    distanceBefore += projection.length;
    totalLength += projection.length;
  }

  if (!best) return null;
  return {
    ...best,
    totalLength,
  };
}

function mapPitDistance(track, startDistance, endDistance, amount) {
  return wrapDistance(startDistance + (endDistance - startDistance) * clamp(amount, 0, 1), track.length);
}

function createPitRoadState(track, position, pitLane, {
  points,
  surface,
  part,
  roadWidth,
  startDistance,
  endDistance,
}) {
  const projected = nearestPointOnPolyline(points, position);
  if (!projected || projected.crossTrackError > roadWidth / 2) return null;
  const amount = projected.totalLength > 0 ? projected.distanceAlong / projected.totalLength : 0;
  const distanceAlongTrack = mapPitDistance(track, startDistance, endDistance, amount);

  return {
    x: projected.point.x,
    y: projected.point.y,
    heading: projected.heading,
    normalX: projected.normalX,
    normalY: projected.normalY,
    curvature: 0,
    distance: distanceAlongTrack,
    signedOffset: projected.signedOffset,
    crossTrackError: projected.crossTrackError,
    surface,
    onTrack: true,
    inPitLane: true,
    pitLanePart: part,
    pitLaneSignedOffset: projected.signedOffset,
    pitLaneCrossTrackError: projected.crossTrackError,
    pitLaneDistanceAlong: projected.distanceAlong,
    pitLaneTotalLength: projected.totalLength,
    pitLaneRouteAmount: amount,
    pitLaneRoadWidth: roadWidth,
  };
}

function pointIsInsidePolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crossesY = (current.y > point.y) !== (previous.y > point.y);
    if (!crossesY) continue;
    const xAtY = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (point.x < xAtY) inside = !inside;
  }

  return inside;
}

function createPitBoxState(track, position, pitLane) {
  const serviceArea = pitLane.serviceAreas?.find((candidate) => (
    pointIsInsidePolygon(position, candidate.corners) ||
    pointIsInsidePolygon(position, candidate.queueCorners)
  ));
  const box = serviceArea ?? pitLane.boxes?.find((candidate) => pointIsInsidePolygon(position, candidate.corners));
  if (!box) return null;
  const distanceAmount = pitLane.mainLane.length > 0
    ? box.distanceAlongLane / pitLane.mainLane.length
    : 0;
  const distanceAlongTrack = mapPitDistance(track, PIT_ENTRY_DISTANCE, PIT_EXIT_DISTANCE, distanceAmount);
  const heading = pitLane.mainLane.heading;

  return {
    x: box.center.x,
    y: box.center.y,
    heading,
    normalX: pitLane.serviceNormal.x,
    normalY: pitLane.serviceNormal.y,
    curvature: 0,
    distance: distanceAlongTrack,
    signedOffset: 0,
    crossTrackError: 0,
    surface: 'pit-box',
    onTrack: true,
    inPitLane: true,
    pitLanePart: serviceArea ? 'service-box' : 'garage-box',
    pitLaneSignedOffset: 0,
    pitLaneCrossTrackError: 0,
    pitBoxId: box.id,
    pitBoxIndex: box.index,
    pitTeamId: box.teamId ?? null,
    pitLaneDistanceAlong: box.distanceAlongLane,
    pitLaneTotalLength: pitLane.mainLane.length,
    pitLaneRoadWidth: box.depth,
  };
}

function nearestPitLaneState(track, position) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return null;
  if (!pointInsideBounds(position, pitLane.bounds)) return null;

  const boxState = createPitBoxState(track, position, pitLane);
  if (boxState) return boxState;

  const candidates = [
    createPitRoadState(track, position, pitLane, {
      points: pitLane.entry.roadCenterline,
      surface: 'pit-entry',
      part: 'entry',
      roadWidth: pitLane.width,
      startDistance: pitLane.entry.distanceFromStart,
      endDistance: PIT_ENTRY_DISTANCE,
    }),
    createPitRoadState(track, position, pitLane, {
      points: pitLane.mainLane.points,
      surface: 'pit-lane',
      part: 'fast-lane',
      roadWidth: pitLane.width,
      startDistance: PIT_ENTRY_DISTANCE,
      endDistance: PIT_EXIT_DISTANCE,
    }),
    createPitRoadState(track, position, pitLane, {
      points: pitLane.workingLane?.points,
      surface: 'pit-lane',
      part: 'working-lane',
      roadWidth: pitLane.workingLane?.width ?? 0,
      startDistance: PIT_ENTRY_DISTANCE,
      endDistance: PIT_EXIT_DISTANCE,
    }),
    createPitRoadState(track, position, pitLane, {
      points: pitLane.exit.roadCenterline,
      surface: 'pit-exit',
      part: 'exit',
      roadWidth: pitLane.width,
      startDistance: PIT_EXIT_DISTANCE,
      endDistance: pitLane.exit.distanceFromStart,
    }),
  ].filter(Boolean);

  return candidates.sort((left, right) => left.crossTrackError - right.crossTrackError)[0] ?? null;
}

function createTrackState(track, position, best) {
  const dx = position.x - best.x;
  const dy = position.y - best.y;
  const signedOffset = dx * best.normalX + dy * best.normalY;
  const crossTrackError = Math.abs(signedOffset);
  const trackEdge = track.width / 2;
  const kerbEdge = trackEdge + (track.kerbWidth ?? 0);
  const gravelEdge = kerbEdge + track.gravelWidth;
  const runoffEdge = gravelEdge + track.runoffWidth;
  const surface = crossTrackError <= trackEdge
    ? 'track'
    : crossTrackError <= kerbEdge
      ? 'kerb'
      : crossTrackError <= gravelEdge
        ? 'gravel'
        : crossTrackError <= runoffEdge
          ? 'grass'
          : 'barrier';

  return {
    ...best,
    signedOffset,
    crossTrackError,
    surface,
    onTrack: surface === 'track' || surface === 'kerb',
  };
}

export function nearestTrackState(track, position, progressHint = null) {
  let nearest = null;

  if (Number.isFinite(progressHint)) {
    const centerIndex = sampleIndexAtDistance(track, progressHint);
    nearest = nearestSampleInRange(
      track,
      position,
      centerIndex - NEAREST_HINT_WINDOW_SAMPLES,
      centerIndex + NEAREST_HINT_WINDOW_SAMPLES,
    );
    const fallbackDistance = track.width / 2 + (track.kerbWidth ?? 0) + track.gravelWidth + track.runoffWidth + 180;
    if (!nearest.best || nearest.bestDistance > fallbackDistance * fallbackDistance) {
      nearest = null;
    }
  }

  const best = nearest?.best ?? nearestSampleGlobal(track, position).best;
  const trackState = createTrackState(track, position, best);
  const pitState = nearestPitLaneState(track, position);
  if (!pitState) return trackState;

  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  if (trackState.crossTrackError <= mainRoadEdge && pitState.surface !== 'pit-box') return trackState;

  const mergeBuffer = PIT_LANE_WIDTH * 0.16;
  const isMainTrackMerge =
    trackState.surface === 'track' &&
    (
      (pitState.surface === 'pit-entry' && pitState.pitLaneDistanceAlong <= mergeBuffer) ||
      (pitState.surface === 'pit-exit' && (pitState.pitLaneTotalLength - pitState.pitLaneDistanceAlong) <= mergeBuffer)
    );

  if (isMainTrackMerge) return trackState;

  return {
    ...pitState,
    mainTrackSignedOffset: trackState.signedOffset,
    mainTrackCrossTrackError: trackState.crossTrackError,
    signedOffset: trackState.signedOffset,
    crossTrackError: trackState.crossTrackError,
  };
}

export function offsetTrackPoint(point, offset) {
  return {
    x: point.x + point.normalX * offset,
    y: point.y + point.normalY * offset,
    heading: point.heading,
  };
}

export function isInDrsZone(track, progress) {
  const wrapped = wrapDistance(progress, track.length);
  return track.drsZones.some((zone) => {
    const start = wrapDistance(zone.start, track.length);
    const end = wrapDistance(zone.end, track.length);
    if (zone.end - zone.start >= track.length) return true;
    return end >= start
      ? wrapped >= start && wrapped <= end
      : wrapped >= start || wrapped <= end;
  });
}

export { normalizeAngle };
