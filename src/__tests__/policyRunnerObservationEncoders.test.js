import { describe, expect, test } from 'vitest';
import {
  encodeHybridObservation,
  encodeSoloRayHybridObservation,
} from '../../local-preview/src/policyRunner/observationEncoders.js';

describe('policy runner observation encoders', () => {
  test('solo-ray vector encoding matches object encoding for shared physical-driver senses', () => {
    const objectObservation = {
      object: {
        self: {
          speedKph: 144,
          steeringAngleRadians: 0.12,
          throttle: 0.7,
          brake: 0.1,
          yawRateRadiansPerSecond: -0.22,
          lateralG: 1.4,
          longitudinalG: -0.3,
          gripUsage: 0.95,
          slipAngleRadians: -0.08,
          tractionLimited: true,
          onTrack: true,
          lapProgressMeters: 1250,
          trackOffsetMeters: 1.5,
        },
        track: {
          lengthMeters: 5000,
          curvature: 0.003,
          lookahead: [
            { curvature: -0.004, headingDeltaRadians: 0.16 },
            { curvature: 0.002, headingDeltaRadians: -0.08 },
          ],
        },
        trackRelation: {
          lateralOffsetMeters: 1.5,
          headingErrorRadians: -0.18,
          legalWidthMeters: 12,
          leftBoundaryMeters: 7.5,
          rightBoundaryMeters: 4.5,
          onLegalSurface: true,
        },
        contactPatches: [
          {
            present: true,
            surface: 'kerb',
            surfaceCode: 1,
            onLegalSurface: true,
            signedOffsetMeters: 6.1,
            crossTrackErrorMeters: 0.1,
            inPitLane: false,
          },
          {
            present: true,
            surface: 'track',
            surfaceCode: 0,
            onLegalSurface: true,
            signedOffsetMeters: 5.9,
            crossTrackErrorMeters: -0.1,
            inPitLane: false,
          },
          {
            present: true,
            surface: 'gravel',
            surfaceCode: 4,
            onLegalSurface: false,
            signedOffsetMeters: 6.8,
            crossTrackErrorMeters: 0.8,
            inPitLane: false,
          },
          {
            present: true,
            surface: 'grass',
            surfaceCode: 3,
            onLegalSurface: false,
            signedOffsetMeters: -6.8,
            crossTrackErrorMeters: 0.8,
            inPitLane: false,
          },
        ],
        rays: [{
          angleDegrees: -140,
          lengthMeters: 60,
          track: { distanceMeters: 22, hit: true, kind: 'exit' },
          kerb: { distanceMeters: 18, hit: true },
          illegalSurface: { distanceMeters: 32, hit: true },
          car: { distanceMeters: 40, hit: true, relativeSpeedKph: -20 },
        }],
      },
    };
    const schemaValues = {
      'self.speedKph': 144 / 400,
      'self.steeringAngleRadians': 0.12 / Math.PI,
      'self.throttle': 0.7,
      'self.brake': 0.1,
      'self.yawRateRadiansPerSecond': -0.22 / Math.PI,
      'self.lateralG': 1.4 / 8,
      'self.longitudinalG': -0.3 / 6,
      'self.gripUsage': 0.95 / 2,
      'self.slipAngleRadians': -0.08 / Math.PI,
      'self.tractionLimited': 1,
      'self.onTrack': 1,
      'self.inPitLane': 0,
      'self.lapProgressRatio': 1250 / 5000,
      'self.trackOffsetMeters': 1.5,
      'self.trackHeadingErrorRadians': -0.18 / Math.PI,
      'track.curvature': 0.003,
      'trackRelation.legalWidthMeters': 12,
      'trackRelation.leftBoundaryMeters': 7.5,
      'trackRelation.rightBoundaryMeters': 4.5,
      'track.lookahead[0].curvature': -0.004,
      'track.lookahead[0].headingDeltaRadians': 0.16 / Math.PI,
      'track.lookahead[1].headingDeltaRadians': -0.08 / Math.PI,
      'contactPatches[0].present': 1,
      'contactPatches[0].surfaceCode': 1 / 5,
      'contactPatches[0].onLegalSurface': 1,
      'contactPatches[0].signedOffsetMeters': 6.1,
      'contactPatches[0].crossTrackErrorMeters': 0.1,
      'contactPatches[1].present': 1,
      'contactPatches[1].surfaceCode': 0,
      'contactPatches[1].onLegalSurface': 1,
      'contactPatches[1].signedOffsetMeters': 5.9,
      'contactPatches[1].crossTrackErrorMeters': -0.1,
      'contactPatches[2].present': 1,
      'contactPatches[2].surfaceCode': 4 / 5,
      'contactPatches[2].onLegalSurface': 0,
      'contactPatches[2].signedOffsetMeters': 6.8,
      'contactPatches[2].crossTrackErrorMeters': 0.8,
      'contactPatches[3].present': 1,
      'contactPatches[3].surfaceCode': 3 / 5,
      'contactPatches[3].onLegalSurface': 0,
      'contactPatches[3].signedOffsetMeters': -6.8,
      'contactPatches[3].crossTrackErrorMeters': 0.8,
      'rays[0].track.distanceRatio': 22 / 60,
      'rays[0].track.hit': 1,
      'rays[0].track.kindExit': 1,
      'rays[0].track.kindEntry': 0,
      'rays[0].kerb.distanceRatio': 18 / 60,
      'rays[0].kerb.hit': 1,
      'rays[0].illegalSurface.distanceRatio': 32 / 60,
      'rays[0].illegalSurface.hit': 1,
      'rays[0].car.distanceRatio': 40 / 60,
      'rays[0].car.hit': 1,
      'rays[0].car.relativeSpeedKph': -20 / 200,
    };
    const schema = Object.keys(schemaValues).map((name) => ({ name }));
    const vectorObservation = {
      schema,
      vector: schema.map((entry) => schemaValues[entry.name]),
    };

    const objectEncoded = encodeSoloRayHybridObservation(objectObservation, [0.2, -0.1], 120, 1.2, true, { rayCount: 1 });
    const vectorEncoded = encodeSoloRayHybridObservation(vectorObservation, [0.2, -0.1], 120, 1.2, true, { rayCount: 1 });

    expect(vectorEncoded).toEqual(objectEncoded);
  });

  test('solo-ray full observations encode actual object ray geometry instead of fallback vector layout', () => {
    const observation = {
      object: {
        self: {
          speedKph: 120,
          steeringAngleRadians: 0,
          throttle: 0.5,
          brake: 0,
          yawRateRadiansPerSecond: 0,
          lateralG: 0,
          longitudinalG: 0,
          gripUsage: 0,
          slipAngleRadians: 0,
          tractionLimited: false,
          onTrack: true,
          lapProgressMeters: 100,
          trackOffsetMeters: 0,
        },
        track: {
          lengthMeters: 5000,
          curvature: 0,
          lookahead: [],
        },
        trackRelation: {
          lateralOffsetMeters: 0,
          headingErrorRadians: 0,
          legalWidthMeters: 12,
          leftBoundaryMeters: 6,
          rightBoundaryMeters: 6,
          onLegalSurface: true,
        },
        contactPatches: [{}, {}, {}, {}],
        rays: [{
          angleDegrees: 45,
          lengthMeters: 42,
          track: { distanceMeters: 21, hit: true, kind: 'exit' },
          kerb: { distanceMeters: 42, hit: false },
          illegalSurface: { distanceMeters: 42, hit: false },
          car: { distanceMeters: 42, hit: false, relativeSpeedKph: 0 },
        }],
      },
      schema: [
        { name: 'self.speedKph' },
        { name: 'self.steeringAngleRadians' },
        { name: 'self.throttle' },
        { name: 'self.brake' },
        { name: 'self.lapProgressRatio' },
        { name: 'self.trackOffsetMeters' },
        { name: 'rays[0].track.distanceRatio' },
        { name: 'rays[0].track.hit' },
        { name: 'rays[0].track.kindExit' },
        { name: 'rays[0].track.kindEntry' },
        { name: 'rays[0].car.distanceRatio' },
        { name: 'rays[0].car.hit' },
        { name: 'rays[0].car.relativeSpeedKph' },
      ],
      vector: [
        120 / 400,
        0,
        0.5,
        0,
        100 / 5000,
        0,
        0.5,
        1,
        1,
        0,
        1,
        0,
        0,
      ],
    };

    const encoded = encodeSoloRayHybridObservation(observation, [0, 0], 0, 0, false, { rayCount: 1 });

    expect(encoded.rays[0][0]).toBeCloseTo(45 / 180, 6);
    expect(encoded.rays[0][1]).toBeCloseTo(42 / 300, 6);
    expect(encoded.rays[0][2]).toBeCloseTo(0.5, 6);
  });

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

  test('solo-ray compact layout encoding follows compact observation ray metadata', () => {
    const observation = {
      object: {
        self: {},
        track: {},
        trackRelation: {},
        contactPatches: [],
        rays: [{
          angleDegrees: -135,
          lengthMeters: 120,
          track: { distanceMeters: 120, hit: false, kind: null },
          kerb: { distanceMeters: 120, hit: false },
          illegalSurface: { distanceMeters: 120, hit: false },
          car: { distanceMeters: 120, hit: false, relativeSpeedKph: 0 },
        }],
      },
    };

    const encoded = encodeSoloRayHybridObservation(observation, [0, 0], 0, 0, true, {
      rayLayout: 'compact',
      rayCount: 8,
    });

    expect(encoded.rays).toHaveLength(8);
    expect(encoded.rays[0][0]).toBeCloseTo(-135 / 180);
    expect(encoded.rays[0][1]).toBeCloseTo(120 / 300);
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
