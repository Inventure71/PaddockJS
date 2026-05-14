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
import { generateSafeFallbackCenterlineControls } from '../simulation/track/proceduralCenterline.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import {
  offsetPointOverlapsNonLocalRoad,
  offsetSegmentIsSafe,
} from '../rendering/track/offsetStrokeSafety.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import {
  queryTrackSegmentsAlongRay,
  resetTrackQueryStats,
  snapshotTrackQueryStats,
} from '../simulation/track/trackQueryIndex.js';

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
  const cells = Array.from(grid.cells.values());
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

function maximumStartGridHeadingDelta(track) {
  const line = pointAt(track, 0);
  const gridSlots = [0, -8, -16, -24, -32, -40, -48, -56].map(metersToSimUnits);

  return Math.max(...gridSlots.map((distanceAlong) => {
    const point = pointAt(track, distanceAlong);
    return headingDelta(line.heading, point.heading);
  }));
}

const GENERATED_TRACK_SEEDS = [7, 71, 1971, 10101, 20260427];
const START_GRID_TRACK_SEEDS = [null, ...GENERATED_TRACK_SEEDS];
const PIT_LANE_SWEEP_SEEDS = [1, 7919, 63352, 150461, 20260430, 0xffffffff];
const PINCHED_CORNER_REGRESSION_SEEDS = [2, 9, 10, 150461, 20260427, 0xffffffff];
const PROCEDURAL_TRACK_TEST_TIMEOUT_MS = 20000;
const generatedTrackModels = new Map();

function generatedTrackModel(seed) {
  if (!generatedTrackModels.has(seed)) {
    generatedTrackModels.set(seed, buildTrackModel(createProceduralTrack(seed)));
  }
  return generatedTrackModels.get(seed);
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

  test('race snapshots can keep the internal query index available without serializing it', () => {
    const sim = createRaceSimulation({
      drivers: [{ id: 'alpha', name: 'Alpha', color: '#f00' }],
      rules: { standingStart: false },
      trackQueryIndex: true,
    });
    const snapshot = sim.snapshot();

    expect(sim.track.queryIndex).toBeTruthy();
    expect(snapshot.track.queryIndex).toBe(sim.track.queryIndex);
    expect(Object.keys(snapshot.track)).not.toContain('queryIndex');
    expect(JSON.stringify(snapshot.track)).not.toContain('queryIndex');
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

  test('indexed nearest-track lookup preserves legacy surface classification across track bands', () => {
    const track = buildTrackModel(TRACK);
    const legacyTrack = { ...track };
    const offsets = [
      0,
      track.width * 0.49,
      track.width / 2 + track.kerbWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.5,
      track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(4),
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
      offsets.forEach((offset) => {
        const position = offsetTrackPoint(center, offset);
        const indexed = nearestTrackState(track, position, center.distance, { allowPitOverride: false });
        const legacy = nearestTrackState(legacyTrack, position, center.distance, { allowPitOverride: false });

        expect(indexed.surface).toBe(legacy.surface);
        expect(indexed.onTrack).toBe(legacy.onTrack);
        expect(indexed.signedOffset).toBeCloseTo(offset, 1);
      });
    });
  });

  test('indexed nearest-track lookup resolves segment ties without legacy fallback', () => {
    const track = buildTrackModel(TRACK);
    resetTrackQueryStats(track);

    track.samples.slice(0, -1).forEach((sample) => {
      nearestTrackState(track, sample, sample.distance, { allowPitOverride: false });
    });

    const stats = snapshotTrackQueryStats(track);
    expect(stats.nearestFallbacks).toBe(0);
    expect(stats.nearestPaths['arc-hint-tie-resolved']).toBeGreaterThan(0);
  });

  test('indexed nearest-track lookup avoids fallback for normal training bands and preserves far-out safety fallback', () => {
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
    expect(stats.nearestFallbacks).toBe(1);
    expect(stats.nearestFallbackReasons['spatial-grid-no-candidates']).toBe(1);
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

    expect(rebuilt).not.toBe(first);
    expect(rebuilt.samples[0].x).not.toBeCloseTo(first.samples[0].x, 6);
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

  slowTest('explicit procedural overrides beat profile defaults', () => {
    const track = buildTrackModel(createProceduralTrack(4102, {
      profile: 'training-short',
      startStraight: { gridMeters: 120, exitMeters: 120 },
      pitLane: { enabled: true },
    }));

    expect(track.pitLane?.enabled).toBe(true);
    expect(simUnitsToMeters(track.samples[1].distance)).toBeGreaterThan(0);
  }, PROCEDURAL_TRACK_TEST_TIMEOUT_MS);

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

  test.each(START_GRID_TRACK_SEEDS)('normalizes seed %s start finish line onto a straight grid section', (seed) => {
    const track = seed == null ? buildTrackModel(TRACK) : generatedTrackModel(seed);
    const line = pointAt(track, 0);
    const exit = pointAt(track, metersToSimUnits(200));

    expect(maximumStartGridHeadingDelta(track)).toBeLessThan(0.14);
    expect(headingDelta(line.heading, exit.heading)).toBeLessThan(0.2);
  });

  test.each(START_GRID_TRACK_SEEDS)('makes seed %s start and finish window fully straight', (seed) => {
    const track = seed == null ? buildTrackModel(TRACK) : generatedTrackModel(seed);
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
  });

  test.each(START_GRID_TRACK_SEEDS)('creates a straight pit lane beside the start straight for seed %s', (seed) => {
    const track = seed == null ? buildTrackModel(TRACK) : generatedTrackModel(seed);
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
