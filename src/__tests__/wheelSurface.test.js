import { describe, expect, test } from 'vitest';
import { buildTrackModel, nearestTrackState, offsetTrackPoint, pointAt, TRACK } from '../simulation/trackModel.js';
import { resetTrackQueryStats, snapshotTrackQueryStats } from '../simulation/track/trackQueryIndex.js';
import {
  applyWheelSurfaceState,
  calculateWheelSurfaceState,
  getEffectiveSurface,
  isWholeCarOutsideTrackLimits,
} from '../simulation/wheelSurface.js';
import { metersToSimUnits } from '../simulation/units.js';
import { getCurrentVehicleGeometryState } from '../simulation/vehicle/vehicleGeometry.js';

function carAt(track, distance, offset, headingOffset = 0) {
  const point = pointAt(track, distance);
  const position = offsetTrackPoint(point, offset);
  return {
    id: 'test-car',
    x: position.x,
    y: position.y,
    heading: point.heading + headingOffset,
    progress: point.distance,
  };
}

const SURFACE_TEST_DISTANCE = metersToSimUnits(4000);

describe('wheel surface classification', () => {
  test('reports track when all wheel contact patches are on asphalt', () => {
    const track = buildTrackModel(TRACK);
    const result = calculateWheelSurfaceState({ car: carAt(track, SURFACE_TEST_DISTANCE, 0), track });

    expect(result.wheels).toHaveLength(4);
    expect(result.sampleMode).toBe('analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(result.wheels.every((wheel) => wheel.surface === 'track')).toBe(true);
    expect(result.effectiveSurface).toBe('track');
    expect(result.trackLimits.violating).toBe(false);
  });

  test('reuses a provided center track state without another nearest-track scan', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, 0);
    const centerState = nearestTrackState(track, car, car.progress);
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

    const result = calculateWheelSurfaceState({ car, track: instrumentedTrack, centerState });

    expect(result.representativeState.distance).toBeCloseTo(centerState.distance, 6);
    expect(result.representativeState.crossTrackError).toBeGreaterThan(centerState.crossTrackError);
    expect(sampleReads).toBe(0);
  });

  test('matches the default calculation when current geometry is provided explicitly', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, 0);
    const centerState = nearestTrackState(track, car, car.progress);
    const geometry = getCurrentVehicleGeometryState(car);

    const explicit = calculateWheelSurfaceState({ car, track, centerState, geometry });
    const implicit = calculateWheelSurfaceState({ car, track, centerState });

    expect(explicit.sampleMode).toBe(implicit.sampleMode);
    expect(explicit.effectiveSurface).toBe(implicit.effectiveSurface);
    expect(explicit.trackLimits).toEqual(implicit.trackLimits);
    expect(explicit.wheels.map((wheel) => ({
      surface: wheel.surface,
      signedOffset: wheel.signedOffset,
      crossTrackError: wheel.crossTrackError,
      inPitLane: wheel.inPitLane,
      outsideSide: wheel.outsideSide,
    }))).toEqual(implicit.wheels.map((wheel) => ({
      surface: wheel.surface,
      signedOffset: wheel.signedOffset,
      crossTrackError: wheel.crossTrackError,
      inPitLane: wheel.inPitLane,
      outsideSide: wheel.outsideSide,
    })));
    expect(explicit.representativeState).toMatchObject({
      distance: implicit.representativeState.distance,
      surface: implicit.representativeState.surface,
      signedOffset: implicit.representativeState.signedOffset,
      crossTrackError: implicit.representativeState.crossTrackError,
    });
  });

  test('reuses analytic wheel-state containers across apply recomputes', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, 0);
    const centerState = nearestTrackState(track, car, car.progress);

    const first = applyWheelSurfaceState(car, track, { centerState });
    expect(first.sampleMode).toBe('analytic');
    const firstWheels = car.wheelStates;
    const firstWheel = firstWheels[0];
    const firstSampledStates = firstWheel.sampledStates;
    const firstSampledState = firstWheel.sampledStates[0];
    const firstTrackState = car.trackState;

    car.wheelSurfaceCache = null;
    car.previousX = car.x - metersToSimUnits(4);
    car.previousY = car.y + metersToSimUnits(1.5);
    car.previousHeading = car.heading + 0.08;

    const second = applyWheelSurfaceState(car, track, { centerState });
    expect(second.sampleMode).toBe('analytic');
    expect(car.wheelStates).toBe(firstWheels);
    expect(car.wheelStates[0]).toBe(firstWheel);
    expect(car.wheelStates[0].sampledStates).toBe(firstSampledStates);
    expect(car.wheelStates[0].sampledStates[0]).toBe(firstSampledState);
    expect(car.trackState).toBe(firstTrackState);
  });

  test('can write representative state into a provided track-state target', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, 0);
    const trackStateTarget = {};

    const result = calculateWheelSurfaceState({
      car,
      track,
      trackStateTarget,
    });

    expect(result.representativeState).toBe(trackStateTarget);
    expect(result.representativeState).toMatchObject({
      distance: expect.any(Number),
      surface: expect.any(String),
      signedOffset: expect.any(Number),
      crossTrackError: expect.any(Number),
      wheelSurface: expect.any(String),
    });
  });

  test('uses kerb as legal worst surface without a track-limit violation', () => {
    const track = buildTrackModel(TRACK);
    const result = calculateWheelSurfaceState({
      car: carAt(track, SURFACE_TEST_DISTANCE, track.width / 2),
      track,
    });

    expect(result.wheels.some((wheel) => wheel.surface === 'kerb')).toBe(true);
    expect(getEffectiveSurface(result.wheels)).toBe('kerb');
    expect(result.trackLimits.violating).toBe(false);
  });

  test('uses gravel as worst surface when one wheel reaches gravel but another remains legal', () => {
    const track = buildTrackModel(TRACK);
    const result = calculateWheelSurfaceState({
      car: carAt(track, SURFACE_TEST_DISTANCE, track.width / 2, Math.PI / 4),
      track,
    });

    expect(result.wheels.some((wheel) => wheel.surface === 'gravel')).toBe(true);
    expect(result.effectiveSurface).toBe('gravel');
    expect(result.trackLimits.violating).toBe(false);
  });

  test('requires all four wheel patches fully outside the same white line', () => {
    const track = buildTrackModel(TRACK);
    const right = calculateWheelSurfaceState({
      car: carAt(track, SURFACE_TEST_DISTANCE, track.width / 2 + metersToSimUnits(4)),
      track,
    });
    const left = calculateWheelSurfaceState({
      car: carAt(track, SURFACE_TEST_DISTANCE, -track.width / 2 - metersToSimUnits(4)),
      track,
    });
    const diagonalInside = calculateWheelSurfaceState({
      car: carAt(track, SURFACE_TEST_DISTANCE, track.width / 2 + metersToSimUnits(2), Math.PI / 4),
      track,
    });

    expect(isWholeCarOutsideTrackLimits(right.wheels, track).violating).toBe(true);
    expect(right.trackLimits.side).toBe(1);
    expect(isWholeCarOutsideTrackLimits(left.wheels, track).violating).toBe(true);
    expect(left.trackLimits.side).toBe(-1);
    expect(diagonalInside.trackLimits.violating).toBe(false);
  });

  test('pit lane roads and service boxes remain legal drivable surfaces', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const samples = [
      pitLane.entry.roadCenterline[Math.floor(pitLane.entry.roadCenterline.length / 2)],
      pitLane.mainLane.points[Math.floor(pitLane.mainLane.points.length / 2)],
      pitLane.exit.roadCenterline[Math.floor(pitLane.exit.roadCenterline.length / 2)],
      pitLane.serviceAreas[0].center,
    ];

    samples.forEach((sample) => {
      const result = calculateWheelSurfaceState({
        car: { id: 'pit-car', x: sample.x, y: sample.y, heading: sample.heading ?? pitLane.mainLane.heading },
        track,
      });
      expect(['full', 'pit-analytic']).toContain(result.sampleMode);
      expect(result.wheels.every((wheel) => (
        wheel.inPitLane ||
        ['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box'].includes(wheel.surface)
      ))).toBe(true);
      expect(result.trackLimits.violating).toBe(false);
    });
  });

  test('reuses internal wheel-surface containers across apply recomputes', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const offset = track.width / 2 + track.kerbWidth * 0.35;
    const car = carAt(track, distance, offset);

    const first = applyWheelSurfaceState(car, track);
    expect(first.sampleMode).toBe('connector-analytic');
    const firstWheels = car.wheelStates;
    const firstWheel = firstWheels[0];
    const firstSampledStates = firstWheel.sampledStates;
    const firstSampledState = firstWheel.sampledStates[0];
    const firstConnectorQueriedStates = car.wheelSurfaceScratch.connectorQueriedStatePools ?? null;
    const firstConnectorQueriedState = firstConnectorQueriedStates?.[0] ?? null;
    const firstConnectorProjections = car.wheelSurfaceScratch.connectorProjectionPools ?? null;
    const firstConnectorProjection = firstConnectorProjections?.[0] ?? null;

    car.wheelSurfaceCache = null;
    const nextPoint = pointAt(track, car.progress + metersToSimUnits(1));
    const nextPosition = offsetTrackPoint(nextPoint, offset);
    car.x = nextPosition.x;
    car.y = nextPosition.y;
    car.heading = nextPoint.heading;
    car.progress = nextPoint.distance;

    const second = applyWheelSurfaceState(car, track);
    expect(second.sampleMode).toBe('connector-analytic');
    expect(car.wheelStates).toBe(firstWheels);
    expect(car.wheelStates[0]).toBe(firstWheel);
    expect(car.wheelStates[0].sampledStates).toBe(firstSampledStates);
    expect(car.wheelStates[0].sampledStates[0]).toBe(firstSampledState);
    expect(car.wheelSurfaceScratch.connectorQueriedStatePools ?? null).toBe(firstConnectorQueriedStates);
    expect((car.wheelSurfaceScratch.connectorQueriedStatePools ?? null)?.[0] ?? null).toBe(firstConnectorQueriedState);
    expect(car.wheelSurfaceScratch.connectorProjectionPools ?? null).toBe(firstConnectorProjections);
    expect((car.wheelSurfaceScratch.connectorProjectionPools ?? null)?.[0] ?? null).toBe(firstConnectorProjection);
    expect(car.wheelStates).toHaveLength(4);
    expect(car.wheelStates.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);

    const publicFirst = calculateWheelSurfaceState({ car, track });
    const publicSecond = calculateWheelSurfaceState({ car, track });
    expect(publicSecond.wheels).not.toBe(publicFirst.wheels);
    expect(publicSecond.wheels[0]).not.toBe(publicFirst.wheels[0]);
  });

  test('reuses track-state and cache containers across apply recomputes', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const offset = track.width / 2 + track.kerbWidth * 0.35;
    const car = carAt(track, distance, offset);

    applyWheelSurfaceState(car, track);
    const firstTrackState = car.trackState;
    const firstTrackLimitState = car.trackLimitState;
    const firstSummary = car.wheelSurfaceScratch.summary;
    const firstCache = car.wheelSurfaceCache;

    const nextPoint = pointAt(track, car.progress + metersToSimUnits(1));
    const nextPosition = offsetTrackPoint(nextPoint, offset);
    car.x = nextPosition.x;
    car.y = nextPosition.y;
    car.heading = nextPoint.heading;
    car.progress = nextPoint.distance;

    applyWheelSurfaceState(car, track);

    expect(car.trackState).toBe(firstTrackState);
    expect(car.trackLimitState).toBe(firstTrackLimitState);
    expect(car.wheelSurfaceScratch.summary).toBe(firstSummary);
    expect(car.trackLimitState).toBe(firstSummary.trackLimits);
    expect(car.wheelSurfaceCache).toBe(firstCache);
    expect(car.trackState.distance).toBeCloseTo(nextPoint.distance, 6);
  });

  test('uses per-wheel connector geometry instead of full patch sampling when no wheel overlaps pit road', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const offset = track.width / 2 + track.kerbWidth * 0.35;
    const result = calculateWheelSurfaceState({
      car: carAt(track, distance, offset),
      track,
    });

    expect(result.sampleMode).toBe('connector-analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(result.wheels.every((wheel) => !wheel.inPitLane)).toBe(true);
    expect(result.wheels.some((wheel) => wheel.surface === 'kerb')).toBe(true);
  });

  test('connector geometry with a provided center state stays off the broad nearest-track and hinted paths', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const offset = track.width / 2 + track.kerbWidth * 0.35;
    const car = carAt(track, distance, offset);
    const centerState = nearestTrackState(track, car, car.progress);

    resetTrackQueryStats(track);
    const result = calculateWheelSurfaceState({ car, track, centerState });
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBeGreaterThan(0);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  test('straight main-track connector local-refresh path proves wheel patches analytically without wheel-center projections', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(4);
    const car = carAt(track, distance, 0);
    const centerState = nearestTrackState(track, car, car.progress);

    resetTrackQueryStats(track);
    const result = applyWheelSurfaceState(car, track, { centerState, cacheAsAuto: true });
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(result.wheels.every((wheel) => !wheel.inPitLane)).toBe(true);
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(0);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(0);
    expect(stats.pitQueries).toBe(0);
    expect(car.wheelSurfaceScratch.connectorQueriedStatePools?.length ?? 0).toBe(0);
    expect(car.wheelSurfaceScratch.connectorProjectionPools?.length ?? 0).toBe(0);
  });

  test('automatic connector center-state refresh reuses the local track-state fast path instead of a broad nearest query', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const car = carAt(track, distance, track.width / 2 + track.kerbWidth * 0.35);

    applyWheelSurfaceState(car, track);

    resetTrackQueryStats(track);
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, track);
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBeGreaterThan(0);
    expect(stats.segmentNeighborhoodBatchCalls).toBeGreaterThan(0);
    expect(stats.pitQueries).toBe(0);
  });

  test('same-pose connector refresh reuses the committed current center state instead of requerying it', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const car = carAt(track, distance, track.width / 2 + track.kerbWidth * 0.35);

    applyWheelSurfaceState(car, track);

    resetTrackQueryStats(track);
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, track);
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(4);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  test('same-pose main-track connector refresh reuses the committed center state and analytic patch proof', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(4);
    const car = carAt(track, distance, 0);

    applyWheelSurfaceState(car, track);

    resetTrackQueryStats(track);
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, track);
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(result.wheels.every((wheel) => !wheel.inPitLane)).toBe(true);
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(0);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(0);
    expect(stats.pitQueries).toBe(0);
    expect(car.wheelSurfaceScratch.connectorQueriedStatePools?.length ?? 0).toBe(0);
    expect(car.wheelSurfaceScratch.connectorProjectionPools?.length ?? 0).toBe(0);
  });

  test('connector-adjacent main-track wheels skip pit overlap queries when the whole footprint stays on the opposite half of the track', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(8);
    const car = carAt(track, distance, metersToSimUnits(-4));
    const centerState = nearestTrackState(track, car, car.progress);

    resetTrackQueryStats(track);
    const result = calculateWheelSurfaceState({ car, track, centerState });
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(result.wheels.every((wheel) => !wheel.inPitLane)).toBe(true);
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(0);
    expect(stats.pitQueries).toBe(0);
  });

  test('connector-adjacent mixed wheels keep exact connector geometry on all ambiguous wheels', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(4);
    const car = carAt(track, distance, track.width / 2 + track.kerbWidth * 0.35);
    const centerState = nearestTrackState(track, car, car.progress);

    resetTrackQueryStats(track);
    const result = calculateWheelSurfaceState({ car, track, centerState });
    const stats = snapshotTrackQueryStats(track);

    expect(result.sampleMode).toBe('connector-analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(4);
    expect(stats.segmentNeighborhoodBatchCalls).toBe(1);
    expect(stats.pitQueries).toBe(0);
  });

  test('classifies mixed pit-entry and runoff wheels through connector geometry without full sampling', () => {
    const track = buildTrackModel(TRACK);
    const pitLane = track.pitLane;
    const distance = pitLane.entry.trackDistance - metersToSimUnits(4);
    const result = calculateWheelSurfaceState({
      car: carAt(track, distance, metersToSimUnits(-10)),
      track,
    });

    expect(result.sampleMode).toBe('connector-analytic');
    expect(result.wheels.every((wheel) => wheel.sampledStates.length === 1)).toBe(true);
    expect(result.wheels.slice(0, 2).every((wheel) => wheel.surface === 'pit-entry' && wheel.inPitLane)).toBe(true);
    expect(result.wheels.slice(2).every((wheel) => wheel.surface === 'gravel' && !wheel.inPitLane)).toBe(true);
  });

  test('does not invalidate wheel-surface cache when only swept previous pose changes', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, 0);

    const first = applyWheelSurfaceState(car, track);
    car.previousX = car.x - 50;
    car.previousY = car.y + 25;
    car.previousHeading = car.heading + 0.2;
    const second = applyWheelSurfaceState(car, track);

    expect(second).toBe(first);
    expect(car.wheelStates).toBe(first.wheels);
  });

  test('reuses explicit-center wheel cache for later automatic lookup at the same pose', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, track.width / 2 + track.kerbWidth);
    const centerState = nearestTrackState(track, car, car.progress);

    const first = applyWheelSurfaceState(car, track, { centerState, cacheAsAuto: true });
    const second = applyWheelSurfaceState(car, track);

    expect(second).toBe(first);
    expect(car.trackState.distance).toBeCloseTo(centerState.distance, 6);
  });

  test('reuses explicit-center wheel cache for a fresh equivalent center-state object', () => {
    const track = buildTrackModel(TRACK);
    const car = carAt(track, SURFACE_TEST_DISTANCE, 0);
    const centerState = nearestTrackState(track, car, car.progress);

    const first = applyWheelSurfaceState(car, track, { centerState });
    const equivalentCenterState = {
      ...centerState,
      pitLanePart: centerState.pitLanePart ?? null,
      pitBoxId: centerState.pitBoxId ?? null,
      surface: centerState.surface ?? null,
    };
    const second = applyWheelSurfaceState(car, track, { centerState: equivalentCenterState });

    expect(second).toBe(first);
    expect(car.trackState.distance).toBeCloseTo(centerState.distance, 6);
  });
});
