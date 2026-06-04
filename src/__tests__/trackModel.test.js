import { describe, expect, test } from 'vitest';
import { slowTest } from './testModes.js';
import {
  buildTrackModel,
  createProceduralTrack,
  nearestTrackState,
  offsetTrackPoint,
  pointAt,
  TRACK,
  WORLD,
} from '../simulation/trackModel.js';
import {
  nearestTrackStateForCar,
  queryLocalSegmentTrackStatesForCar,
  queryRunoffTrackStateForCar,
} from '../simulation/track/trackStatePolicy.js';
import { generateSafeFallbackCenterlineControls } from '../simulation/track/proceduralCenterline.js';
import { resolveProceduralTrackOptions } from '../simulation/track/trackGenerationOptions.js';
import { nearestPitLaneState } from '../simulation/track/pitLaneState.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import {
  offsetPointOverlapsNonLocalRoad,
  offsetSegmentIsSafe,
} from '../rendering/track/offsetStrokeSafety.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import {
  attachTrackQueryIndex,
  createTrackQueryIndex,
  queryHintedTrackProjection,
  queryPitBoxCandidates,
  queryPitRoadSegmentCandidatesByRoute,
  queryNearestTrackProjection,
  queryTrackSegmentsAlongRay,
  queryTrackSegmentsInBounds,
  resetTrackQueryStats,
  snapshotTrackQueryStats,
} from '../simulation/track/trackQueryIndex.js';
import { findIndexedRayBoundaryDistances } from '../environment/sensors/indexedRayBands.js';
import { clamp, wrapDistance } from '../simulation/simMath.js';
import { expandBoundsByPadding, pointInsideBounds } from '../simulation/track/trackMath.js';

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function expectNoSelfIntersections(track) {
  const points = track.samples.filter((_, index) => index % 12 === 0);
  const intersections = [];

  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      const sharesLoopClosure = first === 0 && second >= points.length - 3;
      if (sharesLoopClosure) continue;
      if (segmentsIntersect(points[first], points[first + 1], points[second], points[second + 1])) {
        intersections.push([first, second]);
      }
    }
  }

  expect(intersections).toEqual([]);
}

function trackSignature(track) {
  return track.centerlineControls.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|');
}

function controlSignature(controls) {
  return controls.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|');
}

function pitLaneLateralOffset(pitLane, point) {
  return (point.x - pitLane.mainLane.start.x) * pitLane.serviceNormal.x +
    (point.y - pitLane.mainLane.start.y) * pitLane.serviceNormal.y;
}

function queueHalfLength(serviceArea) {
  return serviceArea.length * 0.72 / 2;
}

function radialCoefficientOfVariation(track) {
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 };
  const radii = track.centerlineControls.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const mean = radii.reduce((total, radius) => total + radius, 0) / radii.length;
  const variance = radii.reduce((total, radius) => total + (radius - mean) ** 2, 0) / radii.length;
  return Math.sqrt(variance) / mean;
}

function averageGridCellOccupancy(grid) {
  const cells = Array.from(grid.cells.values()).filter((cell) => Array.isArray(cell));
  return cells.reduce((total, cell) => total + cell.length, 0) / Math.max(1, cells.length);
}

function minimumNonAdjacentSampleDistance(track) {
  const points = track.samples.slice(0, -1).filter((_, index) => index % 24 === 0);
  let minimum = Infinity;

  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const arcDistance = Math.abs(points[second].distance - points[first].distance);
      const loopDistance = Math.min(arcDistance, track.length - arcDistance);
      if (loopDistance < metersToSimUnits(700)) continue;
      minimum = Math.min(minimum, Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y));
    }
  }

  return minimum;
}

function maximumLocalTurn(track) {
  const samples = track.samples.slice(0, -1);
  let maximum = 0;

  for (let index = 0; index < samples.length; index += 6) {
    let turn = 0;
    for (let offset = 0; offset < 30; offset += 6) {
      const current = samples[(index + offset) % samples.length];
      const next = samples[(index + offset + 6) % samples.length];
      let delta = ((next.heading - current.heading + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (delta < -Math.PI) delta += Math.PI * 2;
      turn += Math.abs(delta);
    }
    maximum = Math.max(maximum, turn);
  }

  return maximum;
}

function headingDelta(first, second) {
  let delta = ((second - first + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function segmentHeading(first, second) {
  return Math.atan2(second.y - first.y, second.x - first.x);
}

function signedSideToPoint(trackPoint, point) {
  return (point.x - trackPoint.x) * trackPoint.normalX + (point.y - trackPoint.y) * trackPoint.normalY;
}

function expectPointClose(actual, expected) {
  expect(pointDistance(actual, expected)).toBeLessThan(0.001);
}

function createParallelSegmentQueryTrack() {
  const samples = [
    { x: 0, y: 0, distance: 0, heading: 0, normalX: 0, normalY: 1, curvature: 0 },
    { x: 100, y: 0, distance: 100, heading: 0, normalX: 0, normalY: 1, curvature: 0 },
    { x: 135, y: 85, distance: 192, heading: Math.PI / 3, normalX: -0.866, normalY: 0.5, curvature: 0 },
    { x: 95, y: 150, distance: 268, heading: Math.PI * 0.7, normalX: -0.8, normalY: -0.6, curvature: 0 },
    { x: 0, y: 20, distance: 430, heading: 0, normalX: 0, normalY: 1, curvature: 0 },
    { x: 100, y: 20, distance: 530, heading: 0, normalX: 0, normalY: 1, curvature: 0 },
    { x: 0, y: 0, distance: 632, heading: Math.PI, normalX: 0, normalY: -1, curvature: 0 },
  ];
  const track = {
    samples,
    length: samples.at(-1).distance,
    width: 15,
    kerbWidth: 1.5,
    gravelWidth: 12,
    runoffWidth: 20,
    barrierWidth: 0.55,
  };
  attachTrackQueryIndex(track, createTrackQueryIndex(track));
  return track;
}

function bruteForceTrackProjection(track, position, preferredDistance = null) {
  const sampleCount = Math.max(0, track.samples.length - 1);
  let best = null;
  let bestTieScore = Infinity;
  for (let segmentId = 0; segmentId < sampleCount; segmentId += 1) {
    const projection = projectSampleSegment(track.samples[segmentId], track.samples[segmentId + 1], segmentId, position);
    const tieScore = Number.isFinite(preferredDistance)
      ? Math.abs(projection.distance - wrapDistance(preferredDistance, track.length))
      : segmentId;
    if (!best || projection.distanceSquared < best.distanceSquared - 1e-6) {
      best = projection;
      bestTieScore = tieScore;
    } else if (Math.abs(projection.distanceSquared - best.distanceSquared) <= 1e-6 && tieScore < bestTieScore) {
      best = projection;
      bestTieScore = tieScore;
    }
  }
  return best;
}

function projectSampleSegment(start, end, segmentId, position) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = start.x + dx * amount;
  const y = start.y + dy * amount;
  const px = position.x - x;
  const py = position.y - y;
  return {
    segmentId,
    x,
    y,
    distance: start.distance + (end.distance - start.distance) * amount,
    heading: start.heading,
    normalX: start.normalX,
    normalY: start.normalY,
    curvature: start.curvature ?? 0,
    signedOffset: px * start.normalX + py * start.normalY,
    crossTrackError: Math.abs(px * start.normalX + py * start.normalY),
    distanceSquared: px * px + py * py,
  };
}

function expectProjectionMatchesExact(actual, expected) {
  expect(actual.segmentId).toBe(expected.segmentId);
  expect(actual.distance).toBeCloseTo(expected.distance, 6);
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.signedOffset).toBeCloseTo(expected.signedOffset, 6);
  expect(actual.distanceSquared).toBeCloseTo(expected.distanceSquared, 6);
}

function bruteForceSegmentsInBounds(track, bounds) {
  const expected = [];
  for (let segmentId = 0; segmentId < track.samples.length - 1; segmentId += 1) {
    const start = track.samples[segmentId];
    const end = track.samples[segmentId + 1];
    if (boundsOverlap(bounds, {
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxY: Math.max(start.y, end.y),
    })) expected.push(segmentId);
  }
  return expected;
}

function boundsOverlap(first, second) {
  return first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY;
}

function bruteForceRayBoundaryDistances(track, origin, vector, lengthMeters, offsets) {
  const maxDistance = metersToSimUnits(lengthMeters);
  const distances = offsets.map(() => Infinity);

  for (let segmentId = 0; segmentId < track.samples.length - 1; segmentId += 1) {
    const start = track.samples[segmentId];
    const end = track.samples[segmentId + 1];
    offsets.forEach((offset, offsetIndex) => {
      const distance = raySegmentIntersectionDistance(
        origin,
        vector,
        offsetSamplePoint(start, offset),
        offsetSamplePoint(end, offset),
        maxDistance,
      );
      if (distance != null && distance < distances[offsetIndex]) distances[offsetIndex] = distance;
    });
  }

  return distances.map((distance) => (Number.isFinite(distance) ? distance : null));
}

function offsetSamplePoint(sample, offset) {
  return {
    x: sample.x + sample.normalX * offset,
    y: sample.y + sample.normalY * offset,
  };
}

function raySegmentIntersectionDistance(origin, ray, start, end, maxDistance) {
  const sx = end.x - start.x;
  const sy = end.y - start.y;
  const denominator = cross(ray.x, ray.y, sx, sy);
  if (Math.abs(denominator) < 1e-9) return null;

  const ox = start.x - origin.x;
  const oy = start.y - origin.y;
  const rayDistance = cross(ox, oy, sx, sy) / denominator;
  const segmentAmount = cross(ox, oy, ray.x, ray.y) / denominator;

  if (rayDistance < 0 || rayDistance > maxDistance) return null;
  if (segmentAmount < -1e-6 || segmentAmount > 1 + 1e-6) return null;
  return rayDistance;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function expectNullableDistanceClose(actual, expected) {
  if (expected == null) {
    expect(actual).toBeNull();
  } else {
    expect(actual).not.toBeNull();
    expect(actual).toBeCloseTo(expected, 6);
  }
}

function pitRoadRouteDefinitions(pitLane) {
  return [
    { routeId: 'entry', points: pitLane?.entry?.roadCenterline ?? [] },
    { routeId: 'main', points: pitLane?.mainLane?.points ?? [] },
    { routeId: 'working', points: pitLane?.workingLane?.points ?? [] },
    { routeId: 'exit', points: pitLane?.exit?.roadCenterline ?? [] },
  ].filter((route) => route.points.length >= 2);
}

function pointOnSegment(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function maximumStartGridHeadingDelta(track) {
  const line = pointAt(track, 0);
  const gridSlots = [0, -8, -16, -24, -32, -40, -48, -56].map(metersToSimUnits);

  return Math.max(...gridSlots.map((distanceAlong) => {
    const point = pointAt(track, distanceAlong);
    return headingDelta(line.heading, point.heading);
  }));
}

const GENERATED_TRACK_SEEDS = [7, 71, 1971, 10101, 20260427];
const PIT_LANE_SWEEP_SEEDS = [1, 7919, 63352, 150461, 20260430, 0xffffffff];
const PINCHED_CORNER_REGRESSION_SEEDS = [2, 9, 10, 150461, 20260427, 0xffffffff];
const PROCEDURAL_TRACK_TEST_TIMEOUT_MS = 60000;
const RAY_EQUIVALENCE_TEST_TIMEOUT_MS = 60000;
const generatedTrackModels = new Map();

function startGridTrack(seed) {
  return seed == null ? buildTrackModel(TRACK) : generatedTrackModel(seed);
}

function generatedTrackModel(seed) {
  if (!generatedTrackModels.has(seed)) {
    generatedTrackModels.set(seed, buildTrackModel(createProceduralTrack(seed)));
  }
  return generatedTrackModels.get(seed);
}

function expectStraightStartGrid(track) {
  const line = pointAt(track, 0);
  const exit = pointAt(track, metersToSimUnits(200));

  expect(maximumStartGridHeadingDelta(track)).toBeLessThan(0.14);
  expect(headingDelta(line.heading, exit.heading)).toBeLessThan(0.2);
}

function expectStraightStartFinishWindow(track) {
  const line = pointAt(track, 0);
  const straightNormal = {
    x: -Math.sin(line.heading),
    y: Math.cos(line.heading),
  };
  const distances = [-490, -400, -280, -160, -80, 0, 80, 160, 200]
    .map(metersToSimUnits);

  distances.forEach((distanceAlong) => {
    const point = pointAt(track, distanceAlong);
    const lateralError = Math.abs((point.x - line.x) * straightNormal.x + (point.y - line.y) * straightNormal.y);

    expect(headingDelta(line.heading, point.heading)).toBeLessThan(0.025);
    expect(lateralError).toBeLessThan(metersToSimUnits(1.5));
  });
}

function expectStraightStartPitLane(track, seed) {
  const pitLane = track.pitLane;

  expect(pitLane).toMatchObject({
    enabled: true,
    boxCount: 20,
    teamCount: 10,
    boxesPerTeam: 2,
  });
  expect(pitLane.entry.trackDistance).toBeGreaterThanOrEqual(track.length - metersToSimUnits(2400));
  expect(pitLane.entry.distanceFromStart).toBeLessThan(metersToSimUnits(-180));
  expect(pitLane.entry.distanceFromStart).toBeGreaterThanOrEqual(metersToSimUnits(-800));
  expect(pitLane.exit.trackDistance).toBeGreaterThan(metersToSimUnits(150));
  expect(pitLane.exit.trackDistance).toBeLessThan(metersToSimUnits(800));
  expect(pitLane.exit.distanceFromStart).toBeGreaterThan(metersToSimUnits(150));
  expect(pitLane.exit.distanceFromStart).toBeLessThan(metersToSimUnits(800));
  expect(pitLane.mainLane.length).toBeGreaterThan(metersToSimUnits(400));
  expect(pitLane.mainLane.length).toBeLessThan(metersToSimUnits(520));
  expect(pitLane.layout.runLength).toBeGreaterThan(metersToSimUnits(320));
  expect(pitLane.mainLane.length - pitLane.layout.runLength).toBeLessThanOrEqual(metersToSimUnits(100));
  expect(pitLane.offset).toBeGreaterThanOrEqual(
    track.width / 2 + track.kerbWidth + pitLane.width / 2 + metersToSimUnits(16),
  );
  expect(pitLane.boxes).toHaveLength(20);
  expect(pitLane.serviceAreas).toHaveLength(10);
  expect(new Set(pitLane.boxes.map((box) => box.teamIndex))).toHaveLength(10);

  expect(pitLane.entry.roadCenterline.length).toBeGreaterThanOrEqual(3);
  expect(pitLane.exit.roadCenterline.length).toBeGreaterThanOrEqual(3);
  expectPointClose(pitLane.entry.roadCenterline[0], pitLane.entry.trackConnectPoint);
  expectPointClose(pitLane.entry.roadCenterline.at(-1), pitLane.mainLane.start);
  expectPointClose(pitLane.exit.roadCenterline[0], pitLane.mainLane.end);
  expectPointClose(pitLane.exit.roadCenterline.at(-1), pitLane.exit.trackConnectPoint);
  expect(nearestTrackState(track, pitLane.entry.trackConnectPoint).surface).toBe('track');
  expect(nearestTrackState(track, pitLane.exit.trackConnectPoint).surface).toBe('track');
  expect(nearestTrackState(track, pitLane.entry.trackConnectPoint).crossTrackError)
    .toBeLessThan(nearestTrackState(track, pitLane.entry.edgePoint).crossTrackError);
  expect(nearestTrackState(track, pitLane.exit.trackConnectPoint).crossTrackError)
    .toBeLessThan(nearestTrackState(track, pitLane.exit.edgePoint).crossTrackError);
  expect(pointDistance(pitLane.entry.trackConnectPoint, pitLane.entry.edgePoint)).toBeGreaterThan(pitLane.width * 0.35);
  expect(pointDistance(pitLane.exit.trackConnectPoint, pitLane.exit.edgePoint)).toBeGreaterThan(pitLane.width * 0.35);
  expect(headingDelta(
    segmentHeading(pitLane.entry.roadCenterline.at(-2), pitLane.entry.roadCenterline.at(-1)),
    pitLane.mainLane.heading,
  )).toBeLessThan(0.2);
  expect(headingDelta(
    segmentHeading(pitLane.exit.roadCenterline[0], pitLane.exit.roadCenterline[1]),
    pitLane.mainLane.heading,
  )).toBeLessThan(0.2);
  expect(pointDistance(pitLane.entry.edgePoint, pitLane.mainLane.start)).toBeGreaterThan(pitLane.width * 2);
  expect(pointDistance(pitLane.exit.edgePoint, pitLane.mainLane.end)).toBeGreaterThan(pitLane.width * 2);

  const finishLine = pointAt(track, 0);
  const pitMidpoint = {
    x: (pitLane.mainLane.start.x + pitLane.mainLane.end.x) / 2,
    y: (pitLane.mainLane.start.y + pitLane.mainLane.end.y) / 2,
  };
  if (seed != null) {
    expect(pointDistance(pitMidpoint, finishLine)).toBeGreaterThan(track.width / 2 + track.kerbWidth);
  }

  for (let index = 0; index <= 8; index += 1) {
    const amount = index / 8;
    const point = {
      x: pitLane.mainLane.start.x + (pitLane.mainLane.end.x - pitLane.mainLane.start.x) * amount,
      y: pitLane.mainLane.start.y + (pitLane.mainLane.end.y - pitLane.mainLane.start.y) * amount,
    };
    const state = nearestTrackState(track, point);
    expect(state.crossTrackError).toBeGreaterThan(track.width / 2 + track.kerbWidth + metersToSimUnits(2));
  }
}

function pointAwayFromPitBounds(track, preferredDistance) {
  const pitBounds = track.pitLane?.bounds ? expandBoundsByPadding(track.pitLane.bounds, metersToSimUnits(24)) : null;
  for (let scan = 0; scan < track.length; scan += 240) {
    const distance = (preferredDistance + scan) % track.length;
    const point = pointAt(track, distance);
    if (!pitBounds || !pointInsideBounds(point, pitBounds)) return point;
  }
  throw new Error('Could not find a track point away from pit-lane bounds');
}

describe('track model', () => {
  test('provides guidance without owning vehicle position', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, track.length * 0.25);
    const outside = offsetTrackPoint(center, track.width);
    const state = nearestTrackState(track, outside);

    expect(track.length).toBeGreaterThan(1800);
    expect(Math.abs(state.signedOffset)).toBeGreaterThan(track.width / 2);
    expect(state.onTrack).toBe(false);
  });

  test('uses local nearest-track lookup when a progress hint is available', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, track.length * 0.25);
    const position = offsetTrackPoint(center, track.width * 0.2);
    const expected = nearestTrackState(track, position);
    let sampleReads = 0;
    const instrumentedTrack = {
      ...track,
      samples: new Proxy(track.samples, {
        get(target, property, receiver) {
          if (/^\d+$/.test(String(property))) sampleReads += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
    };
    Object.defineProperty(instrumentedTrack, 'queryIndex', {
      value: track.queryIndex,
      enumerable: false,
    });

    const hinted = nearestTrackState(instrumentedTrack, position, center.distance);

    expect(hinted.distance).toBeCloseTo(expected.distance, 6);
    expect(hinted.signedOffset).toBeCloseTo(expected.signedOffset, 6);
    expect(sampleReads).toBeLessThan(track.samples.length / 2);
  });

  test('skips pit-lane geometry checks for points outside the pit-lane bounds', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, track.length * 0.5);
    const expected = nearestTrackState(track, center, center.distance);
    let pitGeometryReads = 0;
    const countReads = (items) => new Proxy(items, {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property))) pitGeometryReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const instrumentedTrack = {
      ...track,
      pitLane: {
        ...track.pitLane,
        boxes: countReads(track.pitLane.boxes),
        serviceAreas: countReads(track.pitLane.serviceAreas),
      },
    };
    Object.defineProperty(instrumentedTrack, 'queryIndex', {
      value: track.queryIndex,
      enumerable: false,
    });

    const state = nearestTrackState(instrumentedTrack, center, center.distance);

    expect(state.distance).toBeCloseTo(expected.distance, 6);
    expect(state.surface).toBe(expected.surface);
    expect(pitGeometryReads).toBe(0);
  });

  test('keeps the internal query index out of public track enumeration', () => {
    const track = buildTrackModel(TRACK);

    expect(track.queryIndex).toBeTruthy();
    expect(Object.keys(track)).not.toContain('queryIndex');
    expect(JSON.stringify(track)).not.toContain('queryIndex');
  });

  test('builds query indexes after explicit pit-lane geometry is finalized', () => {
    const track = buildTrackModel({
      ...TRACK,
      pitLane: { enabled: true },
    });

    expect(track.pitLane?.enabled).toBe(true);
    expect(track.pitLane.bounds).toBeTruthy();
    expect(track.pitLane.connectorBounds?.entry).toBeTruthy();
    expect(track.pitLane.connectorBounds?.exit).toBeTruthy();
    expect(track.queryIndex.pit?.boxCandidates.length).toBeGreaterThan(0);
  });

  test('race snapshots can keep the internal query index available without serializing it', () => {
    const sim = createRaceSimulation({
      drivers: [{ id: 'alpha', name: 'Alpha', color: '#f00' }],
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();

    expect(sim.track.queryIndex).toBeTruthy();
    expect(snapshot.track.queryIndex).toBe(sim.track.queryIndex);
    expect(Object.keys(snapshot.track)).not.toContain('queryIndex');
    expect(JSON.stringify(snapshot.track)).not.toContain('queryIndex');
  });

  test('track JSON serialization uses the lean public geometry view', () => {
    const sim = createRaceSimulation({
      drivers: [{ id: 'alpha', name: 'Alpha', color: '#f00' }],
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const serialized = JSON.parse(JSON.stringify(snapshot.track));

    expect(snapshot.track.pitLane?.bounds).toBeTruthy();
    expect(snapshot.track.pitLane?.boxBounds).toBeTruthy();
    expect(snapshot.track.pitLane?.connectorBounds?.entry).toBeTruthy();
    expect(snapshot.track.pitLane?.connectorBounds?.exit).toBeTruthy();
    expect(serialized.pitLane?.bounds).toBeUndefined();
    expect(serialized.pitLane?.boxBounds).toBeUndefined();
    expect(serialized.pitLane?.connectorBounds).toBeUndefined();
    expect(serialized.pitLane?.teams?.[0]?.pitCrew).toBeUndefined();
    expect(serialized.sampleSchema).toEqual([
      'x',
      'y',
      'distance',
      'heading',
      'normalX',
      'normalY',
      'curvature',
    ]);
    expect(serialized.samples.length).toBeLessThan(snapshot.track.samples.length);
    expect(serialized.samples[0]).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(serialized.samples[0][0]).toBeCloseTo(snapshot.track.samples[0].x, 3);
    expect(serialized.samples[0][3]).toBeCloseTo(snapshot.track.samples[0].heading, 6);
    expect(serialized.samples.at(-1)[2]).toBeCloseTo(snapshot.track.samples.at(-1).distance, 3);
    expect(serialized.pitLane?.boxes?.[0]?.teamName).toBeUndefined();
    expect(serialized.pitLane?.boxes?.[0]?.teamColor).toBeUndefined();
    expect(serialized.pitLane?.boxes?.[0]?.teamId).toBeUndefined();
  });

  test('race simulations always attach indexed track queries', () => {
    const sim = createRaceSimulation({
      drivers: [{ id: 'alpha', name: 'Alpha', color: '#f00' }],
      rules: { standingStart: false },
    });

    expect(sim.track.queryIndex).toBeTruthy();
  });

  test('indexed track queries precompute segment projection scalars', () => {
    const track = buildTrackModel(TRACK);
    const { centerline } = track.queryIndex;

    expect(centerline.deltaX.length).toBe(centerline.segmentCount);
    expect(centerline.deltaY.length).toBe(centerline.segmentCount);
    expect(centerline.lengthSquared.length).toBe(centerline.segmentCount);
    expect(centerline.distanceSpan.length).toBe(centerline.segmentCount);
    expect(centerline.deltaX[0]).toBeCloseTo(centerline.endX[0] - centerline.startX[0], 12);
    expect(centerline.deltaY[0]).toBeCloseTo(centerline.endY[0] - centerline.startY[0], 12);
    expect(centerline.lengthSquared[0]).toBeCloseTo(
      centerline.deltaX[0] * centerline.deltaX[0] + centerline.deltaY[0] * centerline.deltaY[0],
      12,
    );
    expect(centerline.distanceSpan[0]).toBeCloseTo(centerline.endDistance[0] - centerline.startDistance[0], 12);
  });

  test('indexed nearest-track lookup treats progress hints as optimization only', () => {
    const track = createParallelSegmentQueryTrack();
    const position = { x: 50, y: 1 };
    const misleadingHint = 480;
    resetTrackQueryStats(track);
    const indexed = queryNearestTrackProjection(track, position, misleadingHint);
    const exact = bruteForceTrackProjection(track, position, misleadingHint);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(stats.nearestFallbacks).toBe(0);
  });

  slowTest('keeps a tight segment grid for compact training-track ray queries', () => {
    const track = buildTrackModel(createProceduralTrack(4101, { profile: 'training-short' }));

    expect(track.queryIndex?.grid).toBeTruthy();
    expect(track.queryIndex?.segmentGrid).toBeTruthy();

    const expandedAverage = averageGridCellOccupancy(track.queryIndex.grid);
    const segmentAverage = averageGridCellOccupancy(track.queryIndex.segmentGrid);

    expect(segmentAverage).toBeGreaterThan(0);
    expect(segmentAverage).toBeLessThan(expandedAverage * 0.2);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('ray segment corridor queries avoid expanded-grid fanout on compact tracks', () => {
    const track = buildTrackModel(createProceduralTrack(4101, { profile: 'training-short' }));
    const origin = pointAt(track, metersToSimUnits(120));
    const vector = { x: Math.cos(origin.heading), y: Math.sin(origin.heading) };
    const segments = queryTrackSegmentsAlongRay(
      track,
      origin,
      vector,
      metersToSimUnits(260),
      track.width + track.kerbWidth + track.gravelWidth,
    );

    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length).toBeLessThan(800);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('indexed bounds queries include every segment whose bounds overlap the query', () => {
    const tracks = [
      buildTrackModel(TRACK),
      buildTrackModel(createProceduralTrack(71, { profile: 'race' })),
      buildTrackModel(createProceduralTrack(20260427, { profile: 'race' })),
    ];

    tracks.forEach((track) => {
      for (let step = 0; step < 36; step += 1) {
        const center = pointAt(track, (track.length * step) / 36);
        const reach = track.width / 2 + track.kerbWidth + track.gravelWidth;
        const bounds = {
          minX: center.x - reach,
          maxX: center.x + reach * (1 + (step % 3)),
          minY: center.y - reach * (1 + ((step + 1) % 3)),
          maxY: center.y + reach,
        };
        const indexedIds = new Set(queryTrackSegmentsInBounds(track, bounds).map((segment) => segment.segmentId));
        const expectedIds = bruteForceSegmentsInBounds(track, bounds);

        expectedIds.forEach((segmentId) => {
          expect(indexedIds.has(segmentId)).toBe(true);
        });
      }
    });
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('indexed ray boundary distances match brute-force segment intersections', () => {
    const cases = [
      { seed: 71, profile: 'race' },
      { seed: 4101, profile: 'training-short' },
      { seed: 20260427, profile: 'race' },
    ];
    const angles = [-135, -90, -35, 0, 25, 60, 115, 170];

    cases.forEach(({ seed, profile }) => {
      const track = buildTrackModel(createProceduralTrack(seed, { profile }));
      const offsets = [
        track.width / 2,
        -track.width / 2,
        track.width / 2 + track.kerbWidth,
        -track.width / 2 - track.kerbWidth,
      ];

      for (let step = 0; step < 24; step += 1) {
        const center = pointAt(track, (track.length * step) / 24);
        const origins = [
          offsetTrackPoint(center, 0),
          offsetTrackPoint(center, track.width / 2 + track.kerbWidth + metersToSimUnits(3)),
          offsetTrackPoint(center, -track.width / 2 - track.kerbWidth - metersToSimUnits(3)),
        ];

        origins.forEach((origin) => {
          angles.forEach((angleDegrees) => {
            const heading = center.heading + (angleDegrees * Math.PI) / 180;
            const vector = { x: Math.cos(heading), y: Math.sin(heading) };
            const indexed = findIndexedRayBoundaryDistances(track, origin, vector, 180, offsets);
            const expected = bruteForceRayBoundaryDistances(track, origin, vector, 180, offsets);

            expect(indexed.available).toBe(true);
            indexed.distances.forEach((distance, index) => {
              expectNullableDistanceClose(distance, expected[index]);
            });
          });
        });
      }
    });
  }, RAY_EQUIVALENCE_TEST_TIMEOUT_MS);

  test('indexed nearest-track lookup classifies surface bands from projected track offsets', () => {
    const track = buildTrackModel(TRACK);
    const bands = [
      { offset: 0, surface: 'track', onTrack: true },
      { offset: track.width * 0.49, surface: 'track', onTrack: true },
      { offset: track.width / 2 + track.kerbWidth * 0.5, surface: 'kerb', onTrack: true },
      { offset: track.width / 2 + track.kerbWidth + track.gravelWidth * 0.5, surface: 'gravel', onTrack: false },
      {
        offset: track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.5,
        surface: 'grass',
        onTrack: false,
      },
      {
        offset: track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(4),
        surface: 'barrier',
        onTrack: false,
      },
    ];
    const distances = [
      0,
      track.length * 0.125,
      track.length * 0.33,
      track.length * 0.66,
      track.length - metersToSimUnits(2),
    ];

    distances.forEach((distanceAlong) => {
      const center = pointAt(track, distanceAlong);
      bands.forEach(({ offset, surface, onTrack }) => {
        const position = offsetTrackPoint(center, offset);
        const indexed = nearestTrackState(track, position, center.distance, { allowPitOverride: false });

        expect(indexed.surface).toBe(surface);
        expect(indexed.onTrack).toBe(onTrack);
        expect(indexed.signedOffset).toBeCloseTo(offset, 1);
      });
    });
  });

  test('indexed nearest-track lookup resolves segment ties deterministically', () => {
    const track = buildTrackModel(TRACK);
    resetTrackQueryStats(track);

    track.samples.slice(0, -1).forEach((sample) => {
      nearestTrackState(track, sample, sample.distance, { allowPitOverride: false });
    });

    const stats = snapshotTrackQueryStats(track);
    const tieResolvedPaths = Object.entries(stats.nearestPaths)
      .filter(([path]) => path.endsWith('tie-resolved'))
      .reduce((sum, [, count]) => sum + count, 0);
    expect(stats.nearestFallbacks).toBe(0);
    expect(tieResolvedPaths).toBeGreaterThan(0);
  });

  test('indexed nearest-track lookup can trust distance-gated local hinted geometry near the centerline', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);
    const position = offsetTrackPoint(center, 0);

    resetTrackQueryStats(track);
    const indexed = queryNearestTrackProjection(track, position, center.distance);
    const exact = bruteForceTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(track.queryIndex.nearestNonLocalHintDistanceSquared[indexed.segmentId]).toBeGreaterThan(0);
    expect(stats.nearestIsolatedHintQueries).toBe(1);
    expect(stats.nearestPaths['segment-hint-distance-gated']).toBe(1);
  });

  test('indexed nearest-track lookup reuses repeated progress-hint segment resolution across same-distance queries', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);

    resetTrackQueryStats(track);
    queryNearestTrackProjection(track, offsetTrackPoint(center, 0), center.distance);
    queryNearestTrackProjection(track, offsetTrackPoint(center, track.width * 0.48), center.distance);
    const stats = snapshotTrackQueryStats(track);

    expect(stats.hintDistanceCacheHits).toBeGreaterThan(0);
  });

  test('indexed nearest-track lookup can trust low-density local hinted geometry on track-side positions that miss the nonlocal distance proof', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, 0);
    const position = offsetTrackPoint(center, track.width * 0.48);

    resetTrackQueryStats(track);
    const indexed = queryNearestTrackProjection(track, position, center.distance);
    const exact = bruteForceTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(track.queryIndex.nearestNonLocalHintDistanceSquared[indexed.segmentId])
      .toBeLessThanOrEqual(4 * indexed.crossTrackError * indexed.crossTrackError);
    expect(stats.nearestIsolatedHintQueries).toBe(0);
    expect(stats.nearestLowDensityHintQueries).toBe(1);
    expect(stats.nearestPaths['segment-hint-density-gated-tie-resolved']).toBe(1);
  });

  test('indexed nearest-track lookup can finish low-density gravel queries from the precomputed cell neighborhood before full exact-grid search', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, 0);
    const position = offsetTrackPoint(center, track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55);

    resetTrackQueryStats(track);
    const indexed = queryNearestTrackProjection(track, position, center.distance);
    const exact = bruteForceTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(stats.nearestLowDensityCellExactQueries).toBe(1);
    expect(stats.nearestLowDensityCellDirectQueries).toBe(1);
    expect(stats.arcBucketRadius2PrecomputedQueries).toBe(0);
    expect(
      (stats.nearestPaths['low-density-cell-exact'] ?? 0) +
      (stats.nearestPaths['low-density-cell-exact-tie-resolved'] ?? 0),
    ).toBe(1);
  });

  test('indexed nearest-track lookup can finish runoff queries from the ring-2 segment neighborhood before full exact-grid search', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, (track.length * 17) / 240);
    const position = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.65,
    );

    resetTrackQueryStats(track);
    const indexed = queryNearestTrackProjection(track, position, center.distance);
    const exact = bruteForceTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(stats.nearestRing2NeighborhoodExactQueries).toBe(1);
    expect(
      (stats.nearestPaths['arc-hint-ring2-neighborhood-exact'] ?? 0) +
      (stats.nearestPaths['arc-hint-ring2-neighborhood-exact-tie-resolved'] ?? 0),
    ).toBe(1);
  });

  test('indexed nearest-track lookup resolves representative far-out hinted queries through sparse exact grid before arc buckets', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, 0);
    const position = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(6),
    );

    resetTrackQueryStats(track);
    const indexed = queryNearestTrackProjection(track, position, center.distance);
    const exact = bruteForceTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(stats.nearestSparseGridExactQueries).toBe(1);
    expect(stats.arcBucketRadius2PrecomputedQueries).toBe(0);
    expect(stats.nearestLowDensityCellExactQueries).toBe(0);
    expect(stats.nearestRing2NeighborhoodExactQueries).toBe(0);
    expect((stats.nearestPaths['sparse-grid-exact'] ?? 0) + (stats.nearestPaths['sparse-grid-exact-tie-resolved'] ?? 0)).toBe(1);
  });

  test('hinted track queries use precomputed wrapped segment neighborhoods for common radius-2 and wide-radius checks', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, 0);
    const widePosition = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(6),
    );

    resetTrackQueryStats(track);
    queryHintedTrackProjection(track, offsetTrackPoint(center, 0), center.distance);
    queryHintedTrackProjection(track, widePosition, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expect(stats.precomputedSegmentNeighborhoodHits).toBeGreaterThan(0);
  });


  test('indexed nearest-track lookup resolves normal and far-out positions deterministically', () => {
    const track = buildTrackModel(TRACK);
    resetTrackQueryStats(track);
    const offsets = [
      0,
      track.width * 0.49,
      track.width / 2 + track.kerbWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(6),
    ];

    for (let index = 0; index < 180; index += 1) {
      const center = pointAt(track, (track.length * index) / 180);
      offsets.forEach((offset) => {
        nearestTrackState(track, offsetTrackPoint(center, offset), center.distance, { allowPitOverride: false });
        nearestTrackState(track, offsetTrackPoint(center, -offset), center.distance, { allowPitOverride: false });
      });
    }

    expect(snapshotTrackQueryStats(track).nearestFallbacks).toBe(0);

    nearestTrackState(track, { x: 1e7, y: -1e7 }, null, { allowPitOverride: false });

    const stats = snapshotTrackQueryStats(track);
    expect(stats.nearestFallbacks).toBe(0);
    expect((stats.nearestPaths['exact-grid'] ?? 0) + (stats.nearestPaths['exact-grid-tie-resolved'] ?? 0))
      .toBe(1);
  });

  slowTest('indexed nearest-track lookup matches exact segment projection across generated tracks', () => {
    const cases = [
      { seed: 7, profile: 'race' },
      { seed: 71, profile: 'race' },
      { seed: 4101, profile: 'training-short' },
      { seed: 20260427, profile: 'race' },
    ];
    const offsetMultipliers = [
      0,
      0.49,
      0.72,
      1.15,
      1.85,
      3.2,
      -0.49,
      -1.15,
      -3.2,
    ];

    cases.forEach(({ seed, profile }) => {
      const track = buildTrackModel(createProceduralTrack(seed, { profile }));
      const surfaceEdge = track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth;
      for (let step = 0; step < 96; step += 1) {
        const center = pointAt(track, (track.length * step) / 96);
        offsetMultipliers.forEach((multiplier, offsetIndex) => {
          const position = offsetTrackPoint(center, surfaceEdge * multiplier);
          const hints = [
            null,
            center.distance,
            wrapDistance(center.distance + track.length * (0.31 + offsetIndex * 0.013), track.length),
          ];

          hints.forEach((hint) => {
            const indexed = queryNearestTrackProjection(track, position, hint);
            const exact = bruteForceTrackProjection(track, position, hint);
            expectProjectionMatchesExact(indexed, exact);
          });
        });
      }
    });
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('car track-state sampling uses indexed nearest-track lookup by default', () => {
    const track = buildTrackModel(TRACK);
    resetTrackQueryStats(track);
    const center = pointAt(track, track.length * 0.4);
    const position = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + 220,
    );
    const car = {
      id: 'player',
      environmentControlled: true,
      progress: center.distance,
      ...position,
    };

    const state = nearestTrackStateForCar(track, car, position, center.distance, { allowPitOverride: false });

    expect(state.surface).toBe('barrier');
    const stats = snapshotTrackQueryStats(track);
    expect(stats.nearestQueries).toBeGreaterThan(0);
    expect(stats.nearestFallbacks).toBe(0);
  });

  test('indexed nearest-track lookup skips empty exact-grid rings for far-out accurate-hint queries', () => {
    const track = buildTrackModel(TRACK);
    resetTrackQueryStats(track);
    const center = pointAt(track, track.length * 0.4);
    const position = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(260),
    );

    const indexed = queryNearestTrackProjection(track, position, center.distance);
    const exact = bruteForceTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expectProjectionMatchesExact(indexed, exact);
    expect(stats.nearestEmptyCellSkippedRings).toBeGreaterThan(0);
  });

  test('runoff track-state fast path uses local segment projections away from pit geometry', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);
    const start = offsetTrackPoint(center, track.width / 2 + track.kerbWidth + metersToSimUnits(2));
    const movedPoint = pointAt(track, center.distance + metersToSimUnits(3));
    const moved = offsetTrackPoint(movedPoint, track.width / 2 + track.kerbWidth + metersToSimUnits(2));
    const car = {
      id: 'budget',
      environmentControlled: true,
      progress: movedPoint.distance,
      previousX: start.x,
      previousY: start.y,
      x: moved.x,
      y: moved.y,
      heading: movedPoint.heading,
      trackState: nearestTrackState(track, start, center.distance, { allowPitOverride: false }),
    };

    resetTrackQueryStats(track);
    const result = queryRunoffTrackStateForCar(track, car);
    const stats = snapshotTrackQueryStats(track);
    const exact = nearestTrackState(track, moved, movedPoint.distance, { allowPitOverride: false });

    expect(result.usedFastPathProjection).toBe(true);
    expect(result.state.distance).toBeCloseTo(exact.distance, 6);
    expect(result.state.signedOffset).toBeCloseTo(exact.signedOffset, 6);
    expect(result.mainTrackState.surface).toBe(exact.surface);
    expect(stats.segmentNeighborhoodQueries).toBeGreaterThan(0);
    expect(stats.runoffRadius1Queries).toBe(0);
    expect(stats.runoffRadius2Queries).toBe(1);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.nearestQueries).toBe(0);
  });

  test('runoff track-state fast path stays exact with one-segment local neighborhood motion', () => {
    const track = buildTrackModel(TRACK);
    const previousDistance = 96206.2943526878;
    const deltaDistance = 10;
    const lateralOffset = -180;
    const previousPoint = pointAt(track, previousDistance);
    const movedPoint = pointAt(track, previousDistance + deltaDistance);
    const previousPosition = offsetTrackPoint(previousPoint, lateralOffset);
    const movedPosition = offsetTrackPoint(movedPoint, lateralOffset);
    const previousState = nearestTrackState(track, previousPosition, previousPoint.distance, { allowPitOverride: false });
    const exact = nearestTrackState(track, movedPosition, previousPoint.distance, { allowPitOverride: false });
    const car = {
      id: 'budget',
      environmentControlled: true,
      previousX: previousPosition.x,
      previousY: previousPosition.y,
      x: movedPosition.x,
      y: movedPosition.y,
      heading: movedPoint.heading,
      progress: movedPoint.distance,
      trackState: previousState,
    };

    resetTrackQueryStats(track);
    const result = queryRunoffTrackStateForCar(track, car);
    const stats = snapshotTrackQueryStats(track);

    expect(result.usedFastPathProjection).toBe(true);
    expect(result.state.distance).toBeCloseTo(exact.distance, 6);
    expect(result.state.signedOffset).toBeCloseTo(exact.signedOffset, 6);
    expect(result.mainTrackState.segmentId).toBe(exact.segmentId);
    expect(stats.segmentNeighborhoodQueries).toBe(1);
    expect(stats.runoffRadius1Queries).toBe(1);
    expect(stats.runoffRadius2Queries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.nearestQueries).toBe(0);
  });

  test('runoff track-state fast path reuses its main-track state object across repeated queries', () => {
    const track = buildTrackModel(TRACK);
    const previousDistance = 96206.2943526878;
    const deltaDistance = 10;
    const lateralOffset = -180;
    const previousPoint = pointAt(track, previousDistance);
    const movedPoint = pointAt(track, previousDistance + deltaDistance);
    const previousPosition = offsetTrackPoint(previousPoint, lateralOffset);
    const movedPosition = offsetTrackPoint(movedPoint, lateralOffset);
    const car = {
      id: 'budget',
      environmentControlled: true,
      previousX: previousPosition.x,
      previousY: previousPosition.y,
      x: movedPosition.x,
      y: movedPosition.y,
      heading: movedPoint.heading,
      progress: movedPoint.distance,
      trackState: nearestTrackState(track, previousPosition, previousPoint.distance, { allowPitOverride: false }),
    };

    const first = queryRunoffTrackStateForCar(track, car);
    const second = queryRunoffTrackStateForCar(track, car);

    expect(second).toBe(first);
    expect(second.state).toBe(first.state);
    expect(second.mainTrackState).toBe(first.mainTrackState);
    expect(second.mainTrackState.distance).toBeCloseTo(first.mainTrackState.distance, 9);
    expect(second.mainTrackState.signedOffset).toBeCloseTo(first.mainTrackState.signedOffset, 9);
  });

  test('runoff track-state fast path widens back to radius 2 for larger motion and stays exact', () => {
    const track = buildTrackModel(TRACK);
    const previousDistance = 96206.2943526878;
    const deltaDistance = 28;
    const lateralOffset = -180;
    const previousPoint = pointAt(track, previousDistance);
    const movedPoint = pointAt(track, previousDistance + deltaDistance);
    const previousPosition = offsetTrackPoint(previousPoint, lateralOffset);
    const movedPosition = offsetTrackPoint(movedPoint, lateralOffset);
    const previousState = nearestTrackState(track, previousPosition, previousPoint.distance, { allowPitOverride: false });
    const exact = nearestTrackState(track, movedPosition, previousPoint.distance, { allowPitOverride: false });
    const car = {
      id: 'budget',
      environmentControlled: true,
      previousX: previousPosition.x,
      previousY: previousPosition.y,
      x: movedPosition.x,
      y: movedPosition.y,
      heading: movedPoint.heading,
      progress: movedPoint.distance,
      trackState: previousState,
    };

    resetTrackQueryStats(track);
    const result = queryRunoffTrackStateForCar(track, car);
    const stats = snapshotTrackQueryStats(track);

    expect(result.usedFastPathProjection).toBe(true);
    expect(result.state.distance).toBeCloseTo(exact.distance, 6);
    expect(result.state.signedOffset).toBeCloseTo(exact.signedOffset, 6);
    expect(result.mainTrackState.segmentId).toBe(exact.segmentId);
    expect(stats.segmentNeighborhoodQueries).toBe(1);
    expect(stats.runoffRadius1Queries).toBe(0);
    expect(stats.runoffRadius2Queries).toBe(1);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.nearestQueries).toBe(0);
  });

  test('runoff track-state fast path stays disabled near pit connectors for pit-aware cars', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const previousPoint = pointAt(track, pitLane.entry.trackDistance - metersToSimUnits(12));
    const movedPoint = pointAt(track, pitLane.entry.trackDistance - metersToSimUnits(10));
    const previousPosition = offsetTrackPoint(previousPoint, track.width / 2 + track.kerbWidth + metersToSimUnits(2));
    const movedPosition = offsetTrackPoint(movedPoint, track.width / 2 + track.kerbWidth + metersToSimUnits(2));
    const previousState = nearestTrackState(track, previousPosition, previousPoint.distance, { allowPitOverride: false });
    const exact = nearestTrackState(track, movedPosition, movedPoint.distance);
    const car = {
      id: 'budget',
      previousX: previousPosition.x,
      previousY: previousPosition.y,
      x: movedPosition.x,
      y: movedPosition.y,
      heading: movedPoint.heading,
      progress: movedPoint.distance,
      trackState: previousState,
    };

    resetTrackQueryStats(track);
    const result = queryRunoffTrackStateForCar(track, car);
    const stats = snapshotTrackQueryStats(track);

    expect(result.usedFastPathProjection).toBe(false);
    expect(result.state.distance).toBeCloseTo(exact.distance, 6);
    expect(result.state.signedOffset).toBeCloseTo(exact.signedOffset, 6);
    expect(stats.segmentNeighborhoodQueries).toBe(0);
    expect(stats.nearestQueries).toBeGreaterThan(0);
  });

  test('runoff track-state fast path stays disabled when a stale previous state is paired with a teleported progress jump onto pit-entry road', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const previousPoint = pointAwayFromPitBounds(track, track.length * 0.45);
    const previousPosition = offsetTrackPoint(previousPoint, 0);
    const entryPoint = pitLane.entry.roadCenterline[Math.floor(pitLane.entry.roadCenterline.length / 2)];
    const car = {
      id: 'budget',
      previousX: entryPoint.x,
      previousY: entryPoint.y,
      x: entryPoint.x,
      y: entryPoint.y,
      heading: entryPoint.heading,
      progress: pitLane.entry.distanceFromStart,
      trackState: nearestTrackState(track, previousPosition, previousPoint.distance, { allowPitOverride: false }),
    };

    resetTrackQueryStats(track);
    const result = queryRunoffTrackStateForCar(track, car);
    const stats = snapshotTrackQueryStats(track);

    expect(result.usedFastPathProjection).toBe(false);
    expect(result.state.pitLanePart).toBe('entry');
    expect(stats.segmentNeighborhoodQueries).toBe(0);
    expect(stats.nearestQueries).toBeGreaterThan(0);
  });

  test('batched local segment track-state queries stay exact for connector wheel centers', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const center = pointAt(track, distance);
    const position = offsetTrackPoint(center, track.width / 2 + track.kerbWidth * 0.35);
    const car = {
      id: 'budget',
      environmentControlled: true,
      x: position.x,
      y: position.y,
      heading: center.heading,
      progress: center.distance,
      trackState: nearestTrackState(track, position, center.distance, { allowPitOverride: false }),
    };
    const wheelCenters = [
      { x: position.x + Math.cos(center.heading) * 6.3 + center.normalX * -9.12, y: position.y + Math.sin(center.heading) * 6.3 + center.normalY * -9.12 },
      { x: position.x + Math.cos(center.heading) * 6.3 + center.normalX * 9.12, y: position.y + Math.sin(center.heading) * 6.3 + center.normalY * 9.12 },
      { x: position.x - Math.cos(center.heading) * 6.3 + center.normalX * -9.12, y: position.y - Math.sin(center.heading) * 6.3 + center.normalY * -9.12 },
      { x: position.x - Math.cos(center.heading) * 6.3 + center.normalX * 9.12, y: position.y - Math.sin(center.heading) * 6.3 + center.normalY * 9.12 },
    ];

    resetTrackQueryStats(track);
    const batched = queryLocalSegmentTrackStatesForCar(
      track,
      car,
      wheelCenters,
      car.trackState.segmentId,
      car.trackState.distance,
      { skipPitOverrideInsideMainRoad: true, radius: 2 },
    );
    const stats = snapshotTrackQueryStats(track);
    const exact = wheelCenters.map((wheelCenter) => nearestTrackState(track, wheelCenter, car.trackState.distance, { allowPitOverride: false }));

    batched.forEach((state, index) => {
      expect(state.segmentId).toBe(exact[index].segmentId);
      expect(state.distance).toBeCloseTo(exact[index].distance, 6);
      expect(state.signedOffset).toBeCloseTo(exact[index].signedOffset, 6);
      expect(state.crossTrackError).toBeCloseTo(exact[index].crossTrackError, 6);
    });
    expect(stats.segmentNeighborhoodQueries).toBe(wheelCenters.length);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(1);
    expect(stats.hintedArcQueries).toBe(0);
  });

  test('hinted segment fast path matches indexed nearest-track lookup through gravel-band queries', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);
    const offsets = [
      0,
      track.width * 0.48,
      track.width / 2 + track.kerbWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    ];

    offsets.forEach((offset) => {
      const position = offsetTrackPoint(center, offset);
      const hinted = queryHintedTrackProjection(track, position, center.distance, { radius: 2 });
      const exact = queryNearestTrackProjection(track, position, center.distance);

      expect(hinted).not.toBeNull();
      expect(hinted.segmentId).toBe(exact.segmentId);
      expect(hinted.distance).toBeCloseTo(exact.distance, 6);
      expect(hinted.signedOffset).toBeCloseTo(exact.signedOffset, 6);
      expect(hinted.distanceSquared).toBeCloseTo(exact.distanceSquared, 6);
    });

    const stats = snapshotTrackQueryStats(track);
    expect(stats.hintedSegmentFastPathQueries).toBe(offsets.length);
    expect(stats.hintedSegmentWideRadiusQueries).toBe(0);
    expect(stats.hintedSegmentWideRadiusHits).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
  });

  test('hinted segment neighborhood queries do not materialize scratch segment id arrays', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);
    const position = offsetTrackPoint(center, track.width * 0.48);

    expect(track.queryIndex.queryScratch.segmentNeighborhoodIds?.length ?? 0).toBe(0);

    const hinted = queryHintedTrackProjection(track, position, center.distance, { radius: 2 });

    expect(hinted).not.toBeNull();
    expect(track.queryIndex.queryScratch.segmentNeighborhoodIds?.length ?? 0).toBe(0);
  });

  test('hinted and nearest indexed track queries avoid transient candidate projection objects', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);
    const positions = [
      offsetTrackPoint(center, 0),
      offsetTrackPoint(center, track.width * 0.48),
      offsetTrackPoint(center, track.width / 2 + track.kerbWidth * 0.5),
      offsetTrackPoint(center, track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55),
    ];

    resetTrackQueryStats(track);
    positions.forEach((position) => {
      expect(queryHintedTrackProjection(track, position, center.distance, { radius: 2 })).not.toBeNull();
      expect(queryNearestTrackProjection(track, position, center.distance)).not.toBeNull();
    });

    const stats = snapshotTrackQueryStats(track);
    expect(stats.candidateProjectionObjectAllocations).toBe(0);
  });

  test('nearest-track state can reuse internal projection scratch without changing public query freshness', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAwayFromPitBounds(track, track.length * 0.45);
    const position = offsetTrackPoint(center, track.width * 0.48);

    const firstProjection = queryNearestTrackProjection(track, position, center.distance);
    const secondProjection = queryNearestTrackProjection(track, position, center.distance);
    expect(secondProjection).not.toBe(firstProjection);

    const firstState = nearestTrackState(track, position, center.distance, { allowPitOverride: false });
    const firstScratchProjection = track.queryIndex.queryScratch.nearestProjection;
    const secondState = nearestTrackState(track, position, center.distance, { allowPitOverride: false });

    expect(firstScratchProjection).toBeDefined();
    expect(track.queryIndex.queryScratch.nearestProjection).toBe(firstScratchProjection);
    expect(secondState).toEqual(firstState);
  });

  test('wide hinted runoff queries can use expanded local segment radius instead of segment-grid refinement', () => {
    const track = buildTrackModel(TRACK);
    const distance = (track.length * 222) / 240;
    const center = pointAt(track, distance);
    const position = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.65,
    );

    resetTrackQueryStats(track);
    const hinted = queryHintedTrackProjection(track, position, center.distance, { radius: 2 });
    const exact = queryNearestTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expect(hinted).not.toBeNull();
    expect(hinted.segmentId).toBe(exact.segmentId);
    expect(hinted.distance).toBeCloseTo(exact.distance, 6);
    expect(hinted.signedOffset).toBeCloseTo(exact.signedOffset, 6);
    expect(stats.hintedSegmentFastPathQueries).toBe(0);
    expect(stats.hintedSegmentWideRadiusQueries).toBe(1);
    expect(stats.hintedSegmentWideRadiusHits).toBe(1);
    expect(stats.hintedArcQueries).toBe(0);
  });

  test('wide hinted runoff queries keep exact same-neighborhood winners deeper into runoff', () => {
    const track = buildTrackModel(TRACK);
    const distance = (track.length * 1330) / 1440;
    const center = pointAt(track, distance);
    const position = offsetTrackPoint(
      center,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.35,
    );

    resetTrackQueryStats(track);
    const hinted = queryHintedTrackProjection(track, position, center.distance, { radius: 2 });
    const exact = queryNearestTrackProjection(track, position, center.distance);
    const stats = snapshotTrackQueryStats(track);

    expect(hinted).not.toBeNull();
    expect(hinted.segmentId).toBe(exact.segmentId);
    expect(hinted.distance).toBeCloseTo(exact.distance, 6);
    expect(hinted.signedOffset).toBeCloseTo(exact.signedOffset, 6);
    expect(stats.hintedSegmentFastPathQueries).toBe(0);
    expect(stats.hintedSegmentWideRadiusQueries).toBe(1);
    expect(stats.hintedSegmentWideRadiusHits).toBe(1);
    expect(stats.hintedArcQueries).toBe(0);
  });

  test('pit-lane index queries avoid irrelevant route filtering and nearest fallback', () => {
    const track = buildTrackModel(TRACK);
    resetTrackQueryStats(track);
    const pitLane = track.pitLane;
    const points = [
      ...pitLane.entry.roadCenterline,
      ...pitLane.mainLane.points,
      ...(pitLane.workingLane?.points ?? []),
      ...pitLane.exit.roadCenterline,
      ...pitLane.boxes.map((box) => box.center),
      ...pitLane.serviceAreas.flatMap((area) => [area.center, area.queuePoint]),
    ];

    points.forEach((point) => nearestTrackState(track, point, point.distance ?? null));

    const stats = snapshotTrackQueryStats(track);
    expect(stats.nearestFallbacks).toBe(0);
    expect(stats.pitFallbacks).toBe(0);
    expect(stats.pitPaths['road-route-miss'] ?? 0).toBe(0);
  });

  test('pit-lane candidate queries can reuse scratch storage without changing default freshness', () => {
    const track = buildTrackModel(TRACK);
    const point = track.pitLane.mainLane.points[Math.floor(track.pitLane.mainLane.points.length / 2)];
    const scratch = {};

    const firstRoad = queryPitRoadSegmentCandidatesByRoute(track, point, scratch);
    const firstRoadEntry = firstRoad.entry;
    const secondRoad = queryPitRoadSegmentCandidatesByRoute(track, point, scratch);
    const freshRoad = queryPitRoadSegmentCandidatesByRoute(track, point);

    expect(secondRoad).toBe(firstRoad);
    expect(secondRoad.entry).toBe(firstRoadEntry);
    expect(
      secondRoad.entry.length +
      secondRoad.main.length +
      secondRoad.working.length +
      secondRoad.exit.length,
    ).toBeGreaterThan(0);
    expect(freshRoad).not.toBe(secondRoad);
    expect(freshRoad.entry).not.toBe(secondRoad.entry);

    const boxPoint = track.pitLane.boxes[0].center;
    const firstBoxes = queryPitBoxCandidates(track, boxPoint, scratch);
    const firstBox = firstBoxes[0];
    const secondBoxes = queryPitBoxCandidates(track, boxPoint, scratch);
    const freshBoxes = queryPitBoxCandidates(track, boxPoint);

    expect(secondBoxes).toBe(firstBoxes);
    expect(secondBoxes[0]).toBe(firstBox);
    expect(secondBoxes.length).toBeGreaterThan(0);
    expect(freshBoxes).not.toBe(secondBoxes);
    expect(freshBoxes[0]).toBe(secondBoxes[0]);
  });

  test('indexed pit-road classification reuses polyline projection scratch', () => {
    const track = buildTrackModel(TRACK);
    const point = track.pitLane.mainLane.points[Math.floor(track.pitLane.mainLane.points.length / 2)];
    const routeDistances = track.queryIndex.pit.routes.main.cumulativeDistances;

    const first = nearestPitLaneState(track, point, track.pitLane.layout.entryDistance);
    const scratch = track.queryIndex.queryScratch;
    const projection = scratch?.pitRoadProjection;
    const projectionPoint = projection?.point;
    const projectionScratch = scratch?.pitRoadProjectionScratch;

    const second = nearestPitLaneState(track, point, track.pitLane.layout.entryDistance);

    expect(first.inPitLane).toBe(true);
    expect(second.inPitLane).toBe(true);
    expect(routeDistances).toBeTruthy();
    expect(routeDistances[0]).toBe(0);
    expect(routeDistances[routeDistances.length - 1]).toBeCloseTo(track.pitLane.mainLane.length, 6);
    expect(projection).toBeTruthy();
    expect(projectionPoint).toBeTruthy();
    expect(scratch.pitRoadProjection).toBe(projection);
    expect(scratch.pitRoadProjection.point).toBe(projectionPoint);
    expect(scratch.pitRoadProjectionScratch).toBe(projectionScratch);
    expect(scratch.pitRoadProjectionScratch.cumulativeDistances).toBeUndefined();
  });

  test('connector-adjacent main-road classification skips pit override queries outside box bounds', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const point = offsetTrackPoint(
      pointAt(track, pitLane.entry.trackDistance - metersToSimUnits(8)),
      track.width / 2 + track.kerbWidth * 0.35,
    );

    expect(pointInsideBounds(point, pitLane.bounds)).toBe(true);
    expect(pointInsideBounds(point, pitLane.boxBounds)).toBe(false);

    resetTrackQueryStats(track);
    const state = nearestTrackState(track, point, pitLane.entry.trackDistance);
    const stats = snapshotTrackQueryStats(track);

    expect(state.inPitLane).not.toBe(true);
    expect(['track', 'kerb']).toContain(state.surface);
    expect(stats.pitPaths['box-grid-miss'] ?? 0).toBe(0);
    expect(stats.pitPaths['main-road-skip'] ?? 0).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  test('connector-adjacent gravel classification skips pit override queries outside the direct connector road envelope', () => {
    const track = buildTrackModel(TRACK);
    const benchmarkDistance = (track.length * 6) / 240;
    const point = offsetTrackPoint(
      pointAt(track, benchmarkDistance),
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    );

    expect(pointInsideBounds(point, track.pitLane.connectorBounds?.exit)).toBe(true);

    resetTrackQueryStats(track);
    const state = nearestTrackState(track, point, benchmarkDistance);
    const stats = snapshotTrackQueryStats(track);

    expect(state.surface).toBe('gravel');
    expect(state.inPitLane).not.toBe(true);
    expect(stats.pitPaths['connector-direct-skip'] ?? 0).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  test('benchmark-representative pit-exit connector queries use direct connector geometry', () => {
    const track = buildTrackModel(TRACK);
    const point = offsetTrackPoint(
      pointAt(track, 0),
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    );

    resetTrackQueryStats(track);
    const state = nearestTrackState(track, point, 0);
    const stats = snapshotTrackQueryStats(track);

    expect(state).toMatchObject({
      surface: 'pit-exit',
      inPitLane: true,
    });
    expect(stats.pitPaths['connector-direct-state'] ?? 0).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  test('direct connector pit-road classification reuses projection scratch', () => {
    const track = buildTrackModel(TRACK);
    const point = offsetTrackPoint(
      pointAt(track, 0),
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    );

    resetTrackQueryStats(track);
    track.queryIndex.queryScratch.pitRoadProjection = undefined;
    const first = nearestTrackState(track, point, 0);
    const scratch = track.queryIndex.queryScratch;
    const projection = scratch?.pitRoadProjection;
    const projectionPoint = projection?.point;

    const second = nearestTrackState(track, point, 0);
    const stats = snapshotTrackQueryStats(track);

    expect(first.surface).toBe('pit-exit');
    expect(second.surface).toBe('pit-exit');
    expect(projection).toBeTruthy();
    expect(projectionPoint).toBeTruthy();
    expect(scratch.pitRoadProjection).toBe(projection);
    expect(scratch.pitRoadProjection.point).toBe(projectionPoint);
    expect(stats.pitPaths['connector-direct-state'] ?? 0).toBe(2);
    expect(stats.pitQueries).toBe(0);
    expect(stats.pitConnectorEndpointWindowProjectionCalls).toBeGreaterThan(0);
    expect(stats.pitConnectorFullRouteProjectionScans).toBe(0);
  });

  test('benchmark-representative pit-entry connector queries use direct connector geometry', () => {
    const track = buildTrackModel(TRACK);
    const benchmarkDistance = (track.length * 233) / 240;
    const point = offsetTrackPoint(
      pointAt(track, benchmarkDistance),
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    );

    resetTrackQueryStats(track);
    const state = nearestTrackState(track, point, benchmarkDistance);
    const stats = snapshotTrackQueryStats(track);

    expect(state).toMatchObject({
      surface: 'pit-entry',
      inPitLane: true,
    });
    expect(stats.pitPaths['connector-direct-state'] ?? 0).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  slowTest('pit-lane index candidates include every route segment and box polygon', () => {
    const tracks = [
      buildTrackModel(TRACK),
      generatedTrackModel(71),
      generatedTrackModel(20260427),
    ];

    tracks.forEach((track) => {
      const pitLane = track.pitLane;
      expect(pitLane?.enabled).toBe(true);
      pitRoadRouteDefinitions(pitLane).forEach(({ routeId, points }) => {
        for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
          [0, 0.5, 1].forEach((amount) => {
            const point = pointOnSegment(points[segmentIndex], points[segmentIndex + 1], amount);
            const candidatesByRoute = queryPitRoadSegmentCandidatesByRoute(track, point);
            expect(candidatesByRoute).toBeTruthy();
            expect(new Set(candidatesByRoute[routeId] ?? []).has(segmentIndex)).toBe(true);
          });
        }
      });

      pitLane.serviceAreas.forEach((area) => {
        [
          { type: 'service-area', point: area.center },
          { type: 'service-queue', point: area.queuePoint },
        ].forEach(({ type, point }) => {
          const candidates = queryPitBoxCandidates(track, point);
          expect(candidates).toBeTruthy();
          expect(candidates.some((candidate) => candidate.type === type && candidate.target === area)).toBe(true);
        });
      });

      pitLane.boxes.forEach((box) => {
        const candidates = queryPitBoxCandidates(track, box.center);
        expect(candidates).toBeTruthy();
        expect(candidates.some((candidate) => candidate.type === 'garage-box' && candidate.target === box)).toBe(true);
      });
    });
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('rendering offset-stroke safety uses indexed nearby segment candidates', () => {
    const track = buildTrackModel(TRACK);
    const current = track.samples[220];
    const next = track.samples[224];
    const offset = track.width / 2 + track.kerbWidth;
    const start = offsetTrackPoint(current, offset);
    const end = offsetTrackPoint(next, offset);
    let sampleReads = 0;
    const instrumentedTrack = {
      ...track,
      samples: new Proxy(track.samples, {
        get(target, property, receiver) {
          if (/^\d+$/.test(String(property))) sampleReads += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
    };
    Object.defineProperty(instrumentedTrack, 'queryIndex', {
      value: track.queryIndex,
      enumerable: false,
    });

    offsetPointOverlapsNonLocalRoad(instrumentedTrack, current, start, offset);
    offsetSegmentIsSafe(instrumentedTrack, current, next, start, end, offset);

    expect(sampleReads).toBeLessThan(32);
  });

  test('keeps the handcrafted DRS zones long enough to cover the full main straights', () => {
    const track = buildTrackModel(TRACK);
    const zoneLengths = track.drsZones.map((zone) => (zone.end - zone.start) / track.length);

    expect(zoneLengths[0]).toBeCloseTo(0.16, 6);
    expect(zoneLengths[1]).toBeCloseTo(0.17, 6);
    expect(zoneLengths[2]).toBeCloseTo(0.14, 6);
  });

  test('uses F1-scale physical dimensions for default track bands', () => {
    const track = buildTrackModel(TRACK);

    expect(simUnitsToMeters(track.length)).toBeGreaterThan(3500);
    expect(simUnitsToMeters(track.length)).toBeLessThan(9000);
    expect(simUnitsToMeters(track.width)).toBeCloseTo(15, 1);
    expect(simUnitsToMeters(track.kerbWidth)).toBeCloseTo(1.5, 1);
    expect(simUnitsToMeters(track.gravelWidth)).toBeCloseTo(12, 1);
    expect(simUnitsToMeters(track.runoffWidth)).toBeCloseTo(20, 1);
  });

  test('reuses built track models for the same track definition object', () => {
    const first = buildTrackModel(TRACK);
    const repeated = buildTrackModel(TRACK);

    expect(repeated).toBe(first);
  });

  slowTest('generates deterministic but seed-distinct circuit definitions', () => {
    const first = createProceduralTrack(12345);
    const repeated = createProceduralTrack(12345);
    const different = createProceduralTrack(5);

    expect(trackSignature(first)).toBe(trackSignature(repeated));
    expect(trackSignature(first)).not.toBe(trackSignature(different));
    expect(first.drsZones).toHaveLength(3);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest.each([7, 71, 20260430])('generated circuit seed %s avoids the safe fallback layout', (seed) => {
    const track = createProceduralTrack(seed);

    expect(controlSignature(track.centerlineControls)).not.toBe(controlSignature(generateSafeFallbackCenterlineControls(seed)));
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('reuses procedural track definitions for repeated seeds', () => {
    const first = createProceduralTrack(1971);
    const repeated = createProceduralTrack(1971);

    expect(repeated).toBe(first);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('protects cached procedural definitions from consumer mutation', () => {
    const first = createProceduralTrack(1972);

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.centerlineControls)).toBe(true);
    expect(Object.isFrozen(first.centerlineControls[0])).toBe(true);
    expect(() => {
      first.centerlineControls[0].x += 100;
    }).toThrow(TypeError);
    expect(() => {
      first.drsZones.push({ id: 'bad-zone', startRatio: 0, endRatio: 1 });
    }).toThrow(TypeError);

    const repeated = createProceduralTrack(1972);
    expect(repeated).toBe(first);
    expect(trackSignature(repeated)).toBe(trackSignature(first));
    expect(repeated.drsZones).toHaveLength(first.drsZones.length);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('does not reuse stale built models for mutable custom track definitions', () => {
    const mutable = structuredClone(createProceduralTrack(1973));
    const first = buildTrackModel(mutable);
    mutable.centerlineControls[0].x += metersToSimUnits(120);
    const rebuilt = buildTrackModel(mutable);
    const maxSampleDelta = first.samples.reduce((maxDelta, sample, index) => {
      const other = rebuilt.samples[index];
      return Math.max(maxDelta, Math.hypot(sample.x - other.x, sample.y - other.y));
    }, 0);

    expect(rebuilt).not.toBe(first);
    expect(maxSampleDelta).toBeGreaterThan(metersToSimUnits(100));
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('protects cached built procedural models from pit-lane mutation', () => {
    const track = createProceduralTrack(1974);
    const first = buildTrackModel(track);

    expect(Object.isFrozen(first.pitLane)).toBe(true);
    expect(() => {
      first.pitLane.enabled = false;
    }).toThrow(TypeError);

    const rebuilt = buildTrackModel(track);
    expect(rebuilt).toBe(first);
    expect(rebuilt.pitLane.enabled).toBe(true);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('protects cached built query indexes from static geometry mutation', () => {
    const track = createProceduralTrack(1975);
    const first = buildTrackModel(track);
    const originalStartX = first.queryIndex.centerline.startX[0];

    expect(() => {
      first.queryIndex.centerline.startX[0] += metersToSimUnits(10000);
    }).toThrow(TypeError);

    const rebuilt = buildTrackModel(track);
    expect(rebuilt).toBe(first);
    expect(rebuilt.queryIndex.centerline.startX[0]).toBe(originalStartX);

    resetTrackQueryStats(rebuilt);
    nearestTrackState(rebuilt, pointAt(rebuilt, 0), 0);
    expect(snapshotTrackQueryStats(rebuilt).nearestQueries).toBeGreaterThan(0);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('keeps profile-free procedural generation equivalent to the race profile', () => {
    const implicit = createProceduralTrack(5051);
    const explicit = createProceduralTrack(5051, { profile: 'race' });

    expect(trackSignature(explicit)).toBe(trackSignature(implicit));
    expect(Boolean(buildTrackModel(explicit).pitLane)).toBe(true);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest('caches procedural tracks by seed and resolved generation options', () => {
    const race = createProceduralTrack(5052);
    const short = createProceduralTrack(5052, { profile: 'training-short' });
    const repeatedShort = createProceduralTrack(5052, { profile: 'training-short' });

    expect(repeatedShort).toBe(short);
    expect(short).not.toBe(race);
    expect(trackSignature(short)).not.toBe(trackSignature(race));
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest.each([
    ['training-short', 900, 1800],
    ['training-medium', 1600, 3000],
    ['training-technical', 800, 1700],
  ])('generated %s profile stays inside its length preset and omits pit lane', (profile, minMeters, maxMeters) => {
    const track = buildTrackModel(createProceduralTrack(4101, { profile }));
    const lengthMeters = simUnitsToMeters(track.length);

    expect(lengthMeters).toBeGreaterThanOrEqual(minMeters);
    expect(lengthMeters).toBeLessThanOrEqual(maxMeters);
    expect(track.pitLane).toBeNull();
    expectNoSelfIntersections(track);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('explicit procedural overrides beat profile defaults', () => {
    const generationOptions = resolveProceduralTrackOptions({
      profile: 'training-short',
      startStraight: { gridMeters: 120, exitMeters: 120 },
      pitLane: { enabled: true },
    });
    const track = buildTrackModel({
      ...TRACK,
      generationOptions,
      drsZones: null,
    });

    expect(simUnitsToMeters(generationOptions.startStraight.grid)).toBe(120);
    expect(simUnitsToMeters(generationOptions.startStraight.exit)).toBe(120);
    expect(generationOptions.pitLane.enabled).toBe(true);
    expect(track.pitLane?.enabled).toBe(true);
    expect(simUnitsToMeters(track.samples[1].distance)).toBeGreaterThan(0);
  });

  test('rejects invalid procedural generation options', () => {
    expect(() => createProceduralTrack(1, { profile: 'missing-profile' })).toThrow(/Unsupported procedural track profile/);
    expect(() => createProceduralTrack(1, { length: { minMeters: 2000, maxMeters: 1000 } })).toThrow(/length\.minMeters/);
    expect(() => createProceduralTrack(1, { attempts: { primary: 0 } })).toThrow(/attempts\.primary/);
  });

  slowTest.each(GENERATED_TRACK_SEEDS)('generated circuit seed %s stays inside the world and does not self-intersect', (seed) => {
    const track = generatedTrackModel(seed);

    expect(simUnitsToMeters(track.length)).toBeGreaterThan(3500);
    expect(simUnitsToMeters(track.length)).toBeLessThan(9000);
    expect(track.drsZones).toHaveLength(3);
    expect(radialCoefficientOfVariation(track)).toBeGreaterThan(0.28);
    expect(minimumNonAdjacentSampleDistance(track)).toBeGreaterThan(track.width * 1.55);
    expect(maximumLocalTurn(track)).toBeLessThanOrEqual(1.85);
    expect(track.samples.every((sample) => (
      sample.x > metersToSimUnits(220) &&
      sample.x < WORLD.width - metersToSimUnits(220) &&
      sample.y > metersToSimUnits(220) &&
      sample.y < WORLD.height - metersToSimUnits(220)
    ))).toBe(true);
    expectNoSelfIntersections(track);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest.each(PINCHED_CORNER_REGRESSION_SEEDS)('generated circuit seed %s rejects pinched impossible corners', (seed) => {
    const track = generatedTrackModel(seed);

    expect(maximumLocalTurn(track)).toBeLessThanOrEqual(1.85);
    expect(minimumNonAdjacentSampleDistance(track)).toBeGreaterThan(track.width * 1.55);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('normalizes built track start finish line onto a straight grid section', () => {
    expectStraightStartGrid(startGridTrack(null));
  });

  slowTest.each(GENERATED_TRACK_SEEDS)('normalizes generated seed %s start finish line onto a straight grid section', (seed) => {
    expectStraightStartGrid(startGridTrack(seed));
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('makes built track start and finish window fully straight', () => {
    expectStraightStartFinishWindow(startGridTrack(null));
  });

  slowTest.each(GENERATED_TRACK_SEEDS)('makes generated seed %s start and finish window fully straight', (seed) => {
    expectStraightStartFinishWindow(startGridTrack(seed));
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('creates a straight pit lane beside the built track start straight', () => {
    const track = startGridTrack(null);
    const pitLane = track.pitLane;

    expectStraightStartPitLane(track, null);

    const firstBoxGap = pointDistance(pitLane.boxes[0].center, pitLane.boxes[1].center);
    const firstTeamGap = pointDistance(pitLane.boxes[1].center, pitLane.boxes[2].center);
    expect(firstTeamGap).toBeGreaterThan(firstBoxGap);

    const laneStart = pitLane.mainLane.start;
    const laneEnd = pitLane.mainLane.end;
    const laneLength = pointDistance(laneStart, laneEnd);
    const laneX = (laneEnd.x - laneStart.x) / laneLength;
    const laneY = (laneEnd.y - laneStart.y) / laneLength;
    const normalX = -laneY;
    const normalY = laneX;

    pitLane.boxes.forEach((box, index) => {
      const dx = box.center.x - laneStart.x;
      const dy = box.center.y - laneStart.y;
      const along = dx * laneX + dy * laneY;
      const lateral = Math.abs(dx * normalX + dy * normalY);

      expect(along).toBeGreaterThan(0);
      expect(along).toBeLessThan(laneLength);
      expect(lateral).toBeGreaterThan(pitLane.width / 2);
      if (index > 0) expect(along).toBeGreaterThan(pitLane.boxes[index - 1].distanceAlongLane);
    });

    pitLane.serviceAreas.forEach((serviceArea) => {
      const teamBoxes = pitLane.boxes.filter((box) => box.teamIndex === serviceArea.teamIndex);
      const nextServiceArea = pitLane.serviceAreas[serviceArea.index + 1];
      const serviceLateral = pitLaneLateralOffset(pitLane, serviceArea.center);
      const queueLateral = pitLaneLateralOffset(pitLane, serviceArea.queuePoint);
      const garageLateral = Math.min(...teamBoxes.map((box) => pitLaneLateralOffset(pitLane, box.center)));
      const queueToServiceClearance = serviceArea.distanceAlongLane - serviceArea.length / 2 -
        (serviceArea.queueDistanceAlongLane + queueHalfLength(serviceArea));

      expect(teamBoxes).toHaveLength(2);
      expect(serviceArea.distanceAlongLane).toBeGreaterThan(teamBoxes[0].distanceAlongLane);
      expect(serviceArea.distanceAlongLane).toBeLessThan(teamBoxes[1].distanceAlongLane);
      expect(serviceLateral).toBeGreaterThan(pitLane.width / 2);
      expect(garageLateral).toBeGreaterThan(serviceLateral);
      expect(Math.abs(queueLateral - serviceLateral)).toBeLessThan(metersToSimUnits(1));
      expect(serviceArea.queueDistanceAlongLane).toBeLessThan(serviceArea.distanceAlongLane);
      expect(serviceArea.distanceAlongLane - serviceArea.queueDistanceAlongLane).toBeGreaterThan(metersToSimUnits(11.9));
      expect(queueToServiceClearance).toBeGreaterThan(metersToSimUnits(2));
      if (nextServiceArea) {
        const interTeamClearance = nextServiceArea.queueDistanceAlongLane - queueHalfLength(nextServiceArea) -
          (serviceArea.distanceAlongLane + serviceArea.length / 2);
        expect(interTeamClearance).toBeGreaterThan(metersToSimUnits(5));
      }
    });
  });

  slowTest.each(GENERATED_TRACK_SEEDS)('creates a straight pit lane beside the start straight for generated seed %s', (seed) => {
    const track = startGridTrack(seed);
    const pitLane = track.pitLane;

    expectStraightStartPitLane(track, seed);

    const firstBoxGap = pointDistance(pitLane.boxes[0].center, pitLane.boxes[1].center);
    const firstTeamGap = pointDistance(pitLane.boxes[1].center, pitLane.boxes[2].center);
    expect(firstTeamGap).toBeGreaterThan(firstBoxGap);

    const laneStart = pitLane.mainLane.start;
    const laneEnd = pitLane.mainLane.end;
    const laneLength = pointDistance(laneStart, laneEnd);
    const laneX = (laneEnd.x - laneStart.x) / laneLength;
    const laneY = (laneEnd.y - laneStart.y) / laneLength;
    const normalX = -laneY;
    const normalY = laneX;

    pitLane.boxes.forEach((box, index) => {
      const dx = box.center.x - laneStart.x;
      const dy = box.center.y - laneStart.y;
      const along = dx * laneX + dy * laneY;
      const lateral = Math.abs(dx * normalX + dy * normalY);

      expect(along).toBeGreaterThan(0);
      expect(along).toBeLessThan(laneLength);
      expect(lateral).toBeGreaterThan(pitLane.width / 2);
      if (index > 0) expect(along).toBeGreaterThan(pitLane.boxes[index - 1].distanceAlongLane);
    });

    pitLane.serviceAreas.forEach((serviceArea) => {
      const teamBoxes = pitLane.boxes.filter((box) => box.teamIndex === serviceArea.teamIndex);
      const nextServiceArea = pitLane.serviceAreas[serviceArea.index + 1];
      const serviceLateral = pitLaneLateralOffset(pitLane, serviceArea.center);
      const queueLateral = pitLaneLateralOffset(pitLane, serviceArea.queuePoint);
      const garageLateral = Math.min(...teamBoxes.map((box) => pitLaneLateralOffset(pitLane, box.center)));
      const queueToServiceClearance = serviceArea.distanceAlongLane - serviceArea.length / 2 -
        (serviceArea.queueDistanceAlongLane + queueHalfLength(serviceArea));

      expect(teamBoxes).toHaveLength(2);
      expect(serviceArea.distanceAlongLane).toBeGreaterThan(teamBoxes[0].distanceAlongLane);
      expect(serviceArea.distanceAlongLane).toBeLessThan(teamBoxes[1].distanceAlongLane);
      expect(serviceLateral).toBeGreaterThan(pitLane.width / 2);
      expect(garageLateral).toBeGreaterThan(serviceLateral);
      expect(Math.abs(queueLateral - serviceLateral)).toBeLessThan(metersToSimUnits(1));
      expect(serviceArea.queueDistanceAlongLane).toBeLessThan(serviceArea.distanceAlongLane);
      expect(serviceArea.distanceAlongLane - serviceArea.queueDistanceAlongLane).toBeGreaterThan(metersToSimUnits(11.9));
      expect(queueToServiceClearance).toBeGreaterThan(metersToSimUnits(2));
      if (nextServiceArea) {
        const interTeamClearance = nextServiceArea.queueDistanceAlongLane - queueHalfLength(nextServiceArea) -
          (serviceArea.distanceAlongLane + serviceArea.length / 2);
        expect(interTeamClearance).toBeGreaterThan(metersToSimUnits(5));
      }
    });
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest.each(PIT_LANE_SWEEP_SEEDS)('keeps pit access roads connected to the track for generated seed %s', (seed) => {
    const track = generatedTrackModel(seed);
    const pitLane = track.pitLane;
    const entryConnect = nearestTrackState(track, pitLane.entry.trackConnectPoint);
    const exitConnect = nearestTrackState(track, pitLane.exit.trackConnectPoint);
    const entryEdge = nearestTrackState(track, pitLane.entry.edgePoint);
    const exitEdge = nearestTrackState(track, pitLane.exit.edgePoint);
    const roadPoints = [
      ...pitLane.entry.roadCenterline,
      ...pitLane.exit.roadCenterline,
      ...pitLane.mainLane.points,
      ...pitLane.boxes.flatMap((box) => [box.center, box.laneTarget, ...box.corners]),
    ];

    expect(roadPoints.every((point) => (
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x > 0 &&
      point.x < WORLD.width &&
      point.y > 0 &&
      point.y < WORLD.height
    ))).toBe(true);

    expectPointClose(pitLane.entry.roadCenterline[0], pitLane.entry.trackConnectPoint);
    expectPointClose(pitLane.entry.roadCenterline.at(-1), pitLane.mainLane.start);
    expectPointClose(pitLane.exit.roadCenterline[0], pitLane.mainLane.end);
    expectPointClose(pitLane.exit.roadCenterline.at(-1), pitLane.exit.trackConnectPoint);

    expect(entryConnect.surface).toBe('track');
    expect(exitConnect.surface).toBe('track');
    expect(entryConnect.crossTrackError).toBeLessThan(track.width / 2 - metersToSimUnits(2));
    expect(exitConnect.crossTrackError).toBeLessThan(track.width / 2 - metersToSimUnits(2));
    expect(entryEdge.crossTrackError).toBeGreaterThan(track.width / 2 - metersToSimUnits(1));
    expect(entryEdge.crossTrackError).toBeLessThan(track.width / 2 + metersToSimUnits(1));
    expect(exitEdge.crossTrackError).toBeGreaterThan(track.width / 2 - metersToSimUnits(1));
    expect(exitEdge.crossTrackError).toBeLessThan(track.width / 2 + metersToSimUnits(1));

    expect(headingDelta(
      segmentHeading(pitLane.entry.roadCenterline.at(-2), pitLane.entry.roadCenterline.at(-1)),
      pitLane.mainLane.heading,
    )).toBeLessThan(0.2);
    expect(headingDelta(
      segmentHeading(pitLane.exit.roadCenterline[0], pitLane.exit.roadCenterline[1]),
      pitLane.mainLane.heading,
    )).toBeLessThan(0.2);

    for (let index = 0; index <= 4; index += 1) {
      const amount = index / 4;
      const point = {
        x: pitLane.mainLane.start.x + (pitLane.mainLane.end.x - pitLane.mainLane.start.x) * amount,
        y: pitLane.mainLane.start.y + (pitLane.mainLane.end.y - pitLane.mainLane.start.y) * amount,
      };
      const state = nearestTrackState(track, point);
      expect(state.crossTrackError).toBeGreaterThan(track.width / 2 + track.kerbWidth + metersToSimUnits(2));
    }
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  slowTest.each(PIT_LANE_SWEEP_SEEDS)('connects pit access roads to the lane-facing track side for generated seed %s', (seed) => {
    const track = generatedTrackModel(seed);
    const pitLane = track.pitLane;
    const entryTrackPoint = pointAt(track, pitLane.entry.distanceFromStart);
    const exitTrackPoint = pointAt(track, pitLane.exit.distanceFromStart);
    const entryLaneSide = Math.sign(signedSideToPoint(entryTrackPoint, pitLane.mainLane.start));
    const exitLaneSide = Math.sign(signedSideToPoint(exitTrackPoint, pitLane.mainLane.end));
    const entryConnectSide = Math.sign(signedSideToPoint(entryTrackPoint, pitLane.entry.trackConnectPoint));
    const exitConnectSide = Math.sign(signedSideToPoint(exitTrackPoint, pitLane.exit.trackConnectPoint));

    expect(entryLaneSide).not.toBe(0);
    expect(exitLaneSide).not.toBe(0);
    expect(entryConnectSide).toBe(entryLaneSide);
    expect(exitConnectSide).toBe(exitLaneSide);

    expect(headingDelta(
      segmentHeading(pitLane.entry.roadCenterline[0], pitLane.entry.roadCenterline[1]),
      entryTrackPoint.heading,
    )).toBeLessThan(0.35);
    expect(headingDelta(
      segmentHeading(pitLane.entry.roadCenterline.at(-2), pitLane.entry.roadCenterline.at(-1)),
      pitLane.mainLane.heading,
    )).toBeLessThan(0.25);
    expect(headingDelta(
      segmentHeading(pitLane.exit.roadCenterline[0], pitLane.exit.roadCenterline[1]),
      pitLane.mainLane.heading,
    )).toBeLessThan(0.25);
    expect(headingDelta(
      segmentHeading(pitLane.exit.roadCenterline.at(-2), pitLane.exit.roadCenterline.at(-1)),
      exitTrackPoint.heading,
    )).toBeLessThan(0.35);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

  test('classifies pit lane roads and boxes as legal drivable surfaces', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const entryMidpoint = pitLane.entry.roadCenterline.find((point) => (
      nearestTrackState(track, point, pitLane.entry.trackDistance).surface === 'pit-entry'
    ));
    const exitMidpoint = pitLane.exit.roadCenterline.find((point) => (
      nearestTrackState(track, point, pitLane.exit.trackDistance).surface === 'pit-exit'
    ));
    const laneMidpoint = {
      x: (pitLane.mainLane.start.x + pitLane.mainLane.end.x) / 2,
      y: (pitLane.mainLane.start.y + pitLane.mainLane.end.y) / 2,
    };
    const boxCenter = pitLane.boxes[0].center;

    expect(entryMidpoint).toBeTruthy();
    expect(exitMidpoint).toBeTruthy();
    expect(nearestTrackState(track, entryMidpoint, pitLane.entry.trackDistance)).toMatchObject({
      surface: 'pit-entry',
      onTrack: true,
      inPitLane: true,
    });
    expect(nearestTrackState(track, laneMidpoint)).toMatchObject({
      surface: 'pit-lane',
      onTrack: true,
      inPitLane: true,
    });
    expect(nearestTrackState(track, exitMidpoint, pitLane.exit.trackDistance)).toMatchObject({
      surface: 'pit-exit',
      onTrack: true,
      inPitLane: true,
    });
    expect(nearestTrackState(track, boxCenter)).toMatchObject({
      surface: 'pit-box',
      onTrack: true,
      inPitLane: true,
      pitBoxId: pitLane.boxes[0].id,
    });
  });

  test('treats the visual kerb band as drivable track-adjacent surface', () => {
    const track = buildTrackModel(TRACK);
    const center = pointAt(track, track.length * 0.3);
    const kerbPoint = offsetTrackPoint(center, track.width / 2 + track.kerbWidth * 0.55);
    const gravelPoint = offsetTrackPoint(center, track.width / 2 + track.kerbWidth + 18);

    const kerbState = nearestTrackState(track, kerbPoint);
    const gravelState = nearestTrackState(track, gravelPoint);

    expect(kerbState.surface).toBe('kerb');
    expect(kerbState.onTrack).toBe(true);
    expect(gravelState.surface).toBe('gravel');
    expect(gravelState.onTrack).toBe(false);
  });
});
