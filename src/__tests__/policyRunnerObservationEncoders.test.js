import { describe, expect, test } from 'vitest';
import {
  encodeHybridObservation,
  encodeSoloRayHybridObservation,
} from '../../local-preview/src/policyRunner/observationEncoders.js';

describe('policy runner observation encoders', () => {
  test('solo-ray vector encoding omits legacy barrier tensor slots', () => {
    const schema = [
      { name: 'self.speedKph' },
      { name: 'self.steeringAngleRadians' },
      { name: 'self.throttle' },
      { name: 'self.brake' },
      { name: 'self.yawRateRadiansPerSecond' },
      { name: 'self.lateralG' },
      { name: 'self.longitudinalG' },
      { name: 'self.gripUsage' },
      { name: 'self.slipAngleRadians' },
      { name: 'self.tractionLimited' },
      { name: 'self.onTrack' },
      { name: 'self.lapProgressRatio' },
      { name: 'self.trackOffsetMeters' },
      { name: 'self.trackHeadingErrorRadians' },
      { name: 'track.curvature' },
      { name: 'trackRelation.legalWidthMeters' },
      { name: 'trackRelation.leftBoundaryMeters' },
      { name: 'trackRelation.rightBoundaryMeters' },
      { name: 'track.lookahead[0].curvature' },
      { name: 'track.lookahead[0].headingDeltaRadians' },
      { name: 'track.lookahead[1].headingDeltaRadians' },
      { name: 'contactPatches[0].present' },
      { name: 'contactPatches[0].surfaceCode' },
      { name: 'contactPatches[0].onLegalSurface' },
      { name: 'contactPatches[0].signedOffsetMeters' },
      { name: 'contactPatches[1].present' },
      { name: 'contactPatches[1].surfaceCode' },
      { name: 'contactPatches[1].onLegalSurface' },
      { name: 'contactPatches[1].signedOffsetMeters' },
      { name: 'contactPatches[2].present' },
      { name: 'contactPatches[2].surfaceCode' },
      { name: 'contactPatches[2].onLegalSurface' },
      { name: 'contactPatches[2].signedOffsetMeters' },
      { name: 'contactPatches[3].present' },
      { name: 'contactPatches[3].surfaceCode' },
      { name: 'contactPatches[3].onLegalSurface' },
      { name: 'contactPatches[3].signedOffsetMeters' },
      { name: 'rays[0].track.distanceRatio' },
      { name: 'rays[0].track.hit' },
      { name: 'rays[0].track.kindExit' },
      { name: 'rays[0].track.kindEntry' },
      { name: 'rays[0].kerb.distanceRatio' },
      { name: 'rays[0].kerb.hit' },
      { name: 'rays[0].illegalSurface.distanceRatio' },
      { name: 'rays[0].illegalSurface.hit' },
      { name: 'rays[0].car.distanceRatio' },
      { name: 'rays[0].car.hit' },
      { name: 'rays[0].car.relativeSpeedKph' },
    ];
    const vector = Array.from({ length: schema.length }, (_, index) => (index + 1) / 100);
    const encoded = encodeSoloRayHybridObservation(
      { schema, vector },
      [0, 0],
      0,
      0,
      true,
      { rayCount: 1 },
    );

    expect(encoded.rays).toHaveLength(1);
    expect(encoded.rays[0]).toHaveLength(13);
  });

  test('solo-ray object encoding ignores barrier fields in ray tensors', () => {
    const observationBase = {
      object: {
        self: {
          speedKph: 120,
          steeringAngleRadians: 0.1,
          throttle: 0.5,
          brake: 0,
          yawRateRadiansPerSecond: 0.2,
          lateralG: 1.1,
          longitudinalG: 0.4,
          gripUsage: 0.9,
          slipAngleRadians: 0.05,
          tractionLimited: false,
          onTrack: true,
          lapProgressMeters: 100,
          trackOffsetMeters: 0.5,
        },
        track: {
          lengthMeters: 5000,
          curvature: 0.01,
          lookahead: [],
        },
        trackRelation: {
          lateralOffsetMeters: 0.5,
          headingErrorRadians: 0.02,
          legalWidthMeters: 12,
          leftBoundaryMeters: 5,
          rightBoundaryMeters: 7,
          onLegalSurface: true,
        },
        contactPatches: [{}, {}, {}, {}],
        rays: [{
          angleDegrees: 0,
          lengthMeters: 120,
          track: { distanceMeters: 100, hit: true, kind: 'exit' },
          kerb: { distanceMeters: 120, hit: false },
          illegalSurface: { distanceMeters: 120, hit: false },
          car: { distanceMeters: 120, hit: false, relativeSpeedKph: 0 },
        }],
      },
    };

    const withBarrier = encodeSoloRayHybridObservation({
      ...observationBase,
      object: {
        ...observationBase.object,
        rays: [{
          ...observationBase.object.rays[0],
          barrier: { distanceMeters: 1, hit: true },
        }],
      },
    }, [0, 0], 0, 0, true, { rayCount: 1 });

    const withoutBarrier = encodeSoloRayHybridObservation(observationBase, [0, 0], 0, 0, true, { rayCount: 1 });

    expect(withBarrier.rays[0]).toHaveLength(13);
    expect(withBarrier.rays[0]).toEqual(withoutBarrier.rays[0]);
  });

  test('hybrid encoder ray tensors omit barrier slots', () => {
    const encoded = encodeHybridObservation({
      object: {
        self: {},
        trackRelation: {},
        race: {},
        track: {},
        contactPatches: [],
        rays: [{
          angleDegrees: 0,
          lengthMeters: 120,
          track: { distanceMeters: 90, hit: true, kind: 'exit' },
          kerb: { distanceMeters: 120, hit: false },
          illegalSurface: { distanceMeters: 120, hit: false },
          barrier: { distanceMeters: 1, hit: true },
          car: { distanceMeters: 120, hit: false, relativeSpeedKph: 0 },
        }],
        nearbyCars: [],
      },
    }, [0, 0], 0, 0);

    expect(encoded.rays[0]).toHaveLength(13);
  });
});
