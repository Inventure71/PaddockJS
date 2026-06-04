import { describe, expect, test } from 'vitest';
import { traceIndexedRayBands } from '../environment/sensors/rayBandTrace.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { slowTest } from './testModes.js';
import {
  createProceduralTrack,
  nearestTrackState,
  pointAt,
  offsetTrackPoint,
  TRACK,
} from '../simulation/trackModel.js';
import { resetTrackQueryStats, snapshotTrackQueryStats } from '../simulation/track/trackQueryIndex.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

const drivers = [
  { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
];
const LEGAL_SURFACES = new Set(['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box']);
const DIRECT_TRACE_SWEEP_TIMEOUT_MS = 60000;

function createSnapshot(track = undefined) {
  const sim = createRaceSimulation({
    drivers,
    seed: 1971,
    physicsMode: 'arcade',
    track,
    rules: { standingStart: false },
  });
  return sim.snapshotObservation();
}

function sideVector(state, direction = 1) {
  return {
    x: state.normalX * direction,
    y: state.normalY * direction,
  };
}

function rayVector(heading, angleDegrees) {
  const angle = heading + angleDegrees * Math.PI / 180;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function createTraceCar(snapshot, distanceMeters, offsetMeters, headingErrorRadians = 0) {
  const base = pointAt(snapshot.track, metersToSimUnits(distanceMeters));
  const signedOffset = metersToSimUnits(offsetMeters);
  const position = offsetTrackPoint(base, signedOffset);
  return {
    base,
    car: {
      x: position.x,
      y: position.y,
      heading: base.heading + headingErrorRadians,
      progress: base.distance,
      signedOffset,
    },
    origin: position,
    originState: nearestTrackState(snapshot.track, position, base.distance, {
      allowPitOverride: false,
    }),
  };
}

function createPitLaneTrace(snapshot) {
  const pitLane = snapshot.track.pitLane;
  const origin = {
    x: (pitLane.mainLane.start.x + pitLane.mainLane.end.x) / 2,
    y: (pitLane.mainLane.start.y + pitLane.mainLane.end.y) / 2,
  };
  const originState = nearestTrackState(snapshot.track, origin, pitLane.entry.trackDistance, {
    allowPitOverride: true,
  });
  const right = {
    x: -Math.sin(pitLane.mainLane.heading),
    y: Math.cos(pitLane.mainLane.heading),
  };
  const awayFromBoxesAngle = right.x * pitLane.serviceNormal.x + right.y * pitLane.serviceNormal.y > 0
    ? -90
    : 90;
  return {
    origin,
    originState,
    pitLane,
    vector: rayVector(pitLane.mainLane.heading, awayFromBoxesAngle),
  };
}

function marchTrackHit(track, origin, progressHint, vector, lengthMeters) {
  return marchTransition({
    track,
    origin,
    progressHint,
    vector,
    lengthMeters,
    matches: (state) => Math.abs(state.crossTrackError) <= track.width / 2,
    hitFromTransition: (previousMatches, distanceMeters) => ({
      hit: true,
      distanceMeters,
      kind: previousMatches ? 'exit' : 'entry',
    }),
    miss: { hit: false, distanceMeters: lengthMeters, kind: null },
  });
}

function marchSurfaceHit(track, origin, progressHint, vector, lengthMeters, channel) {
  const originState = nearestTrackState(track, origin, progressHint, { allowPitOverride: false });
  if (matchesSurfaceChannel(channel, originState)) {
    return {
      hit: true,
      distanceMeters: 0,
      surface: originState.surface ?? null,
    };
  }
  return marchTransition({
    track,
    origin,
    progressHint,
    vector,
    lengthMeters,
    matches: (state) => matchesSurfaceChannel(channel, state),
    hitFromTransition: (previousMatches, distanceMeters, state) => ({
      hit: true,
      distanceMeters,
      surface: state.surface ?? null,
    }),
    miss: { hit: false, distanceMeters: lengthMeters, surface: null },
  });
}

function marchTransition({
  track,
  origin,
  progressHint,
  vector,
  lengthMeters,
  matches,
  hitFromTransition,
  miss,
}) {
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(0.5);
  let previousDistance = 0;
  let previousMatches = null;
  let previousState = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const point = {
      x: origin.x + vector.x * distance,
      y: origin.y + vector.y * distance,
    };
    const state = nearestTrackState(track, point, progressHint, {
      allowPitOverride: false,
    });
    const currentMatches = matches(state);
    if (previousMatches == null) {
      previousMatches = currentMatches;
      previousState = state;
      continue;
    }
    if (currentMatches !== previousMatches) {
      const { distance: refinedDistance, state: refinedState } = refineTransition({
        track,
        origin,
        progressHint,
        vector,
        low: previousDistance,
        high: distance,
        previousMatches,
        matches,
        fallbackState: state,
      });
      return hitFromTransition(previousMatches, simUnitsToMeters(refinedDistance), refinedState ?? previousState);
    }
    previousDistance = distance;
    previousMatches = currentMatches;
    previousState = state;
  }

  return miss;
}

function refineTransition({
  track,
  origin,
  progressHint,
  vector,
  low,
  high,
  previousMatches,
  matches,
  fallbackState,
}) {
  let lastMatchingState = fallbackState;
  for (let index = 0; index < 12; index += 1) {
    const middle = (low + high) / 2;
    const point = {
      x: origin.x + vector.x * middle,
      y: origin.y + vector.y * middle,
    };
    const state = nearestTrackState(track, point, progressHint, {
      allowPitOverride: false,
    });
    const middleMatches = matches(state);
    if (middleMatches === previousMatches) {
      low = middle;
    } else {
      high = middle;
      lastMatchingState = state;
    }
  }
  return { distance: high, state: lastMatchingState };
}

function matchesSurfaceChannel(channel, state) {
  if (channel === 'kerb') return state?.surface === 'kerb';
  if (channel === 'illegalSurface') return !LEGAL_SURFACES.has(state?.surface) && state?.surface !== 'barrier';
  return false;
}

function expectTraceHitClose(traceHit, expected, { channel, label, maxDistanceErrorMeters = 0.55 }) {
  expect(traceHit.hit, `${label} ${channel} hit`).toBe(expected.hit);
  if (!expected.hit) {
    expect(traceHit.distanceMeters, `${label} ${channel} miss distance`).toBe(expected.distanceMeters);
    return;
  }
  expect(
    Math.abs(traceHit.distanceMeters - expected.distanceMeters),
    `${label} ${channel} distance`,
  ).toBeLessThanOrEqual(maxDistanceErrorMeters);
  if (channel === 'roadEdge') {
    expect(traceHit.kind, `${label} road-edge kind`).toBe(expected.kind);
  } else if (expected.surface != null) {
    expect(traceHit.surface, `${label} ${channel} surface`).toBe(expected.surface);
  }
}

describe('indexed ray band tracing', () => {
  test('reports direct road, kerb, and illegal-surface distances from main track geometry', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const origin = offsetTrackPoint(state, 0);
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, 1),
      lengthMeters: 120,
      originState: {
        ...state,
        signedOffset: 0,
        crossTrackError: 0,
        surface: 'track',
        inPitLane: false,
      },
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    });

    expect(trace.available).toBe(true);
    expect(trace.fallbackReason).toBe(null);
    expect(trace.roadEdge).toMatchObject({ hit: true, kind: 'exit' });
    expect(trace.roadEdge.distanceMeters).toBeCloseTo(simUnitsToMeters(snapshot.track.width / 2), 3);
    expect(trace.kerb).toMatchObject({ hit: true, surface: 'kerb' });
    expect(trace.kerb.distanceMeters).toBeCloseTo(simUnitsToMeters(snapshot.track.width / 2), 3);
    expect(trace.illegalSurface).toMatchObject({ hit: true, surface: 'gravel' });
    expect(trace.illegalSurface.distanceMeters).toBeCloseTo(
      simUnitsToMeters(snapshot.track.width / 2 + snapshot.track.kerbWidth),
      3,
    );
  });
  test('queries only the boundary bands required by requested channels', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const origin = offsetTrackPoint(state, 0);
    const sharedRayQuery = {};
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, 1),
      lengthMeters: 120,
      originState: {
        ...state,
        signedOffset: 0,
        crossTrackError: 0,
        surface: 'track',
        inPitLane: false,
      },
      channels: new Set(['roadEdge']),
      precision: 'driver',
      sharedRayQuery,
    });

    expect(trace.available).toBe(true);
    expect(trace.roadEdge).toMatchObject({ hit: true, kind: 'exit' });
    expect(sharedRayQuery.surfaceBoundaries).toEqual(expect.objectContaining({
      available: true,
      trackEdgeDistance: expect.any(Number),
      kerbOuterDistance: null,
      runoffOuterDistance: null,
    }));
  });

  test('reuses shared channel flags for array channel callers', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const origin = offsetTrackPoint(state, 0);
    const sharedRayQuery = {};
    const stats = { channelSetAllocations: 0 };
    const originState = {
      ...state,
      signedOffset: 0,
      crossTrackError: 0,
      surface: 'track',
      inPitLane: false,
    };

    traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, 1),
      lengthMeters: 120,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery,
      stats,
    });
    const firstFlags = sharedRayQuery.channelFlags;
    traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, -1),
      lengthMeters: 120,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery,
      stats,
    });

    expect(sharedRayQuery.channelFlags).toBe(firstFlags);
    expect(sharedRayQuery.channelFlags).toEqual(expect.objectContaining({
      hasRoadEdge: true,
      hasKerb: true,
      hasIllegalSurface: true,
      hasCar: false,
    }));
    expect(stats.channelSetAllocations).toBe(0);
  });

  test('reuses tracer result containers when shared ray scratch is provided', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const origin = offsetTrackPoint(state, 0);
    const sharedRayQuery = {};
    const originState = {
      ...state,
      signedOffset: 0,
      crossTrackError: 0,
      surface: 'track',
      inPitLane: false,
    };

    const first = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, 1),
      lengthMeters: 120,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery,
    });
    const firstRoadEdge = first.roadEdge;
    const firstKerb = first.kerb;
    const firstIllegalSurface = first.illegalSurface;
    const second = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, -1),
      lengthMeters: 120,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery,
    });

    expect(second).toBe(first);
    expect(sharedRayQuery.traceResult).toBe(first);
    expect(second.roadEdge).toBe(firstRoadEdge);
    expect(second.kerb).toBe(firstKerb);
    expect(second.illegalSurface).toBe(firstIllegalSurface);
    expect(second.path).toBe('direct');
  });

  test('keeps legal-origin illegal-surface direct tracing on one indexed outside-boundary validation sample instead of paired nearest-track classification work', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const origin = offsetTrackPoint(state, 0);

    resetTrackQueryStats(snapshot.track);
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, 1),
      lengthMeters: 120,
      originState: {
        ...state,
        signedOffset: 0,
        crossTrackError: 0,
        surface: 'track',
        inPitLane: false,
      },
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery: {},
    });
    const stats = snapshotTrackQueryStats(snapshot.track);

    expect(trace.available).toBe(true);
    expect(trace.path).toBe('direct');
    expect(trace.illegalSurface).toMatchObject({
      hit: true,
      surface: 'gravel',
    });
    expect(stats.nearestQueries).toBe(0);
    expect(stats.raySegmentObjectAllocations).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(1);
  });

  test('reports validated barrier recovery illegal-surface hits at the first non-barrier surface', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const offset = snapshot.track.width / 2 +
      snapshot.track.kerbWidth +
      snapshot.track.gravelWidth +
      snapshot.track.runoffWidth +
      metersToSimUnits(38);
    const origin = offsetTrackPoint(state, offset);
    resetTrackQueryStats(snapshot.track);
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, -1),
      lengthMeters: 120,
      originState: {
        ...state,
        signedOffset: offset,
        crossTrackError: Math.abs(offset),
        surface: 'barrier',
        inPitLane: false,
      },
      channels: ['illegalSurface'],
      precision: 'driver',
    });
    const stats = snapshotTrackQueryStats(snapshot.track);

    expect(trace.available).toBe(true);
    expect(trace.fallbackReason).toBe(null);
    expect(trace.illegalSurface).toMatchObject({
      hit: true,
      surface: 'grass',
    });
    expect(trace.illegalSurface.distanceMeters).toBeCloseTo(38, 0);
    expect(stats.nearestQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(3);
  });

  test('reports validated gravel recovery road and kerb entries directly', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, 6240);
    const offset = snapshot.track.width / 2 + metersToSimUnits(8);
    const origin = offsetTrackPoint(state, offset);
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: sideVector(state, -1),
      lengthMeters: 80,
      originState: {
        ...state,
        signedOffset: offset,
        crossTrackError: Math.abs(offset),
        surface: 'gravel',
        inPitLane: false,
      },
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    });

    expect(trace.available).toBe(true);
    expect(trace.fallbackReason).toBe(null);
    expect(trace.roadEdge).toMatchObject({ hit: true, kind: 'entry' });
    expect(trace.roadEdge.distanceMeters).toBeCloseTo(8, 0);
    expect(trace.kerb).toMatchObject({ hit: true, surface: 'kerb' });
    expect(trace.kerb.distanceMeters).toBeCloseTo(6.5, 0);
    expect(trace.illegalSurface).toMatchObject({
      hit: true,
      distanceMeters: 0,
      surface: 'gravel',
    });
  });

  test('uses bounded sampled recovery instead of falling back for ambiguous off-track entries', () => {
    const snapshot = createSnapshot();
    const { car, origin, originState } = createTraceCar(snapshot, 8054.916048963136, 28.49559565074742);
    const vector = rayVector(car.heading, -174.9416997190565);
    const lengthMeters = 140;
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    });
    const label = `ambiguous recovery surface=${originState.surface}`;

    expect(trace.available).toBe(true);
    expect(trace.path).toBe('sampled');
    expect(trace.sampledReason).toBe('road-edge-recovery');
    expectTraceHitClose(
      trace.roadEdge,
      marchTrackHit(snapshot.track, origin, car.progress, vector, lengthMeters),
      { channel: 'roadEdge', label, maxDistanceErrorMeters: 1.1 },
    );
    expectTraceHitClose(
      trace.kerb,
      marchSurfaceHit(snapshot.track, origin, car.progress, vector, lengthMeters, 'kerb'),
      { channel: 'kerb', label, maxDistanceErrorMeters: 1.1 },
    );
    expectTraceHitClose(
      trace.illegalSurface,
      marchSurfaceHit(snapshot.track, origin, car.progress, vector, lengthMeters, 'illegalSurface'),
      { channel: 'illegalSurface', label, maxDistanceErrorMeters: 1.1 },
    );
  });

  test('keeps barrier-origin off-track recovery on the direct indexed runoff boundary path instead of sampled marching', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const offset = snapshot.track.width / 2 +
      snapshot.track.kerbWidth +
      snapshot.track.gravelWidth +
      snapshot.track.runoffWidth +
      metersToSimUnits(55);
    const origin = offsetTrackPoint(state, offset);
    const originState = nearestTrackState(snapshot.track, origin, state.distance, {
      allowPitOverride: false,
    });

    resetTrackQueryStats(snapshot.track);
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector: rayVector(state.heading - Math.PI / 2, 40),
      lengthMeters: 220,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery: {},
    });
    const stats = snapshotTrackQueryStats(snapshot.track);

    expect(trace.available).toBe(true);
    expect(trace.path).toBe('direct');
    expect(trace.sampledReason).toBe(null);
    expect(trace.roadEdge).toEqual({
      hit: false,
      distanceMeters: 220,
      kind: null,
    });
    expect(trace.kerb).toEqual({
      hit: false,
      distanceMeters: 220,
      surface: null,
    });
    expect(trace.illegalSurface).toMatchObject({
      hit: true,
      surface: 'grass',
    });
    expect(trace.illegalSurface.distanceMeters).toBeCloseTo(88, 0);
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(2);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(0);
  });

  test('uses bounded sampled recovery for pit connector rays', () => {
    const snapshot = createSnapshot();
    const pitEntryMeters = simUnitsToMeters(snapshot.track.pitLane.entry.trackDistance);
    const { car, origin, originState } = createTraceCar(snapshot, pitEntryMeters - 20, 0);
    const vector = rayVector(car.heading, 90);
    const lengthMeters = 140;
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    });
    const label = `pit connector distance=${pitEntryMeters - 20}m`;

    expect(trace.available).toBe(true);
    expect(trace.path).toBe('sampled');
    expect(trace.sampledReason).toBe('pit-connector');
    expectTraceHitClose(
      trace.roadEdge,
      marchTrackHit(snapshot.track, origin, car.progress, vector, lengthMeters),
      { channel: 'roadEdge', label, maxDistanceErrorMeters: 1.1 },
    );
    expectTraceHitClose(
      trace.kerb,
      marchSurfaceHit(snapshot.track, origin, car.progress, vector, lengthMeters, 'kerb'),
      { channel: 'kerb', label, maxDistanceErrorMeters: 1.1 },
    );
    expectTraceHitClose(
      trace.illegalSurface,
      marchSurfaceHit(snapshot.track, origin, car.progress, vector, lengthMeters, 'illegalSurface'),
      { channel: 'illegalSurface', label, maxDistanceErrorMeters: 1.1 },
    );
  });

  test('uses direct pit-road boundary geometry for pit-lane-origin side rays', () => {
    const snapshot = createSnapshot();
    const { origin, originState, pitLane, vector } = createPitLaneTrace(snapshot);
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters: 80,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      allowPitOverride: true,
    });

    expect(originState).toMatchObject({
      surface: 'pit-lane',
      inPitLane: true,
    });
    expect(trace.available).toBe(true);
    expect(trace.path).toBe('direct');
    expect(trace.sampledReason).toBe(null);
    expect(trace.fallbackReason).toBe(null);
    expect(trace.roadEdge).toMatchObject({
      hit: true,
      kind: 'exit',
    });
    expect(trace.roadEdge.distanceMeters).toBeGreaterThan(simUnitsToMeters(pitLane.width / 2 - 2));
    expect(trace.roadEdge.distanceMeters).toBeLessThan(simUnitsToMeters(pitLane.width / 2 + pitLane.workingLane.width));
    expect(trace.kerb).toEqual({
      hit: false,
      distanceMeters: 80,
      surface: null,
    });
  });

  slowTest('matches sampled road and surface hits across representative track, offset, and angle sweeps', () => {
    const tracks = [
      ['default', TRACK, [120, 600, 1500, 3200, 6240, 9600, 15083]],
      ['short-generated', createProceduralTrack(4101, { profile: 'training-short' }), [80, 220, 450, 820, 1180, 1500]],
      ['technical-generated', createProceduralTrack(9117, { profile: 'training-technical' }), [60, 240, 520, 900, 1240]],
    ];
    const angleDegrees = [-135, -90, -55, -25, 0, 25, 55, 90, 135, 180];
    const offsetMeters = [-34, -14, -8, -2, 0, 2, 8, 14, 34];
    let directCount = 0;
    let sampledCount = 0;
    let fallbackCount = 0;

    tracks.forEach(([trackName, track, distances]) => {
      const snapshot = createSnapshot(track);
      distances.forEach((distanceMeters) => {
        offsetMeters.forEach((offset) => {
          angleDegrees.forEach((angle) => {
            const { car, origin, originState } = createTraceCar(snapshot, distanceMeters, offset);
            const vector = rayVector(car.heading, angle);
            const lengthMeters = 140;
            const trace = traceIndexedRayBands({
              track: snapshot.track,
              origin,
              vector,
              lengthMeters,
              originState,
              channels: ['roadEdge', 'kerb', 'illegalSurface'],
              precision: 'driver',
            });
            const label = `${trackName} d=${distanceMeters}m o=${offset}m a=${angle}deg surface=${originState.surface}`;
            if (!trace.available) {
              fallbackCount += 1;
              expect([
                'pit-connector',
                'road-edge-recovery',
                'kerb-recovery',
                'illegal-surface-recovery',
                'road-edge-validation',
                'kerb-validation',
                'illegal-surface-validation',
              ], label).toContain(trace.fallbackReason);
              return;
            }

            if (trace.path === 'sampled') sampledCount += 1;
            else directCount += 1;
            const maxDistanceErrorMeters = trace.path === 'sampled' ? 1.1 : 0.55;
            expectTraceHitClose(
              trace.roadEdge,
              marchTrackHit(snapshot.track, origin, car.progress, vector, lengthMeters),
              { channel: 'roadEdge', label, maxDistanceErrorMeters },
            );
            expectTraceHitClose(
              trace.kerb,
              marchSurfaceHit(snapshot.track, origin, car.progress, vector, lengthMeters, 'kerb'),
              { channel: 'kerb', label, maxDistanceErrorMeters },
            );
            expectTraceHitClose(
              trace.illegalSurface,
              marchSurfaceHit(snapshot.track, origin, car.progress, vector, lengthMeters, 'illegalSurface'),
              { channel: 'illegalSurface', label, maxDistanceErrorMeters },
            );
          });
        });
      });
    });

    expect(directCount).toBeGreaterThan(1100);
    expect(sampledCount).toBeGreaterThan(0);
    expect(fallbackCount).toBeLessThan(120);
  }, DIRECT_TRACE_SWEEP_TIMEOUT_MS);

  test('keeps debug precision on the tracer path and gates missing indexes explicitly', () => {
    const snapshot = createSnapshot();
    const state = pointAt(snapshot.track, metersToSimUnits(900));
    const origin = offsetTrackPoint(state, 0);
    const vector = sideVector(state, 1);
    const originState = {
      ...state,
      signedOffset: 0,
      crossTrackError: 0,
      surface: 'track',
      inPitLane: false,
    };

    const debugTrace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters: 120,
      originState,
      channels: ['roadEdge'],
      precision: 'debug',
    });

    expect(debugTrace.available).toBe(true);
    expect(debugTrace.path).toBe('direct');
    expect(debugTrace.fallbackReason).toBeNull();

    expect(traceIndexedRayBands({
      track: { ...snapshot.track, queryIndex: null },
      origin,
      vector,
      lengthMeters: 120,
      originState,
      channels: ['roadEdge'],
      precision: 'driver',
    }).fallbackReason).toBe('missing-index');

  });
});
