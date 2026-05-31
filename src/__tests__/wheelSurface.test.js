import { describe, expect, test } from 'vitest';
import { buildTrackModel, nearestTrackState, offsetTrackPoint, pointAt, TRACK } from '../simulation/trackModel.js';
import {
  applyWheelSurfaceState,
  calculateWheelSurfaceState,
  getEffectiveSurface,
  isWholeCarOutsideTrackLimits,
} from '../simulation/wheelSurface.js';
import { metersToSimUnits } from '../simulation/units.js';

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
    expect(sampleReads).toBe(0);
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
    expect(first.sampleMode).toBe('full');
    const firstWheels = car.wheelStates;
    const firstWheel = firstWheels[0];
    const firstSampledStates = firstWheel.sampledStates;

    car.wheelSurfaceCache = null;
    const nextPoint = pointAt(track, car.progress + metersToSimUnits(1));
    const nextPosition = offsetTrackPoint(nextPoint, offset);
    car.x = nextPosition.x;
    car.y = nextPosition.y;
    car.heading = nextPoint.heading;
    car.progress = nextPoint.distance;

    const second = applyWheelSurfaceState(car, track);
    expect(second.sampleMode).toBe('full');
    expect(car.wheelStates).toBe(firstWheels);
    expect(car.wheelStates[0]).toBe(firstWheel);
    expect(car.wheelStates[0].sampledStates).toBe(firstSampledStates);
    expect(car.wheelStates).toHaveLength(4);
    expect(car.wheelStates.every((wheel) => wheel.sampledStates.length === 5)).toBe(true);

    const publicFirst = calculateWheelSurfaceState({ car, track });
    const publicSecond = calculateWheelSurfaceState({ car, track });
    expect(publicSecond.wheels).not.toBe(publicFirst.wheels);
    expect(publicSecond.wheels[0]).not.toBe(publicFirst.wheels[0]);
  });
});
