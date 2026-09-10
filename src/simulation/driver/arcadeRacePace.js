import { clamp, normalizeAngle } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import { sampleHeadingAt, sampleHeadingCurvatureAtInto } from '../track/trackModel.js';
import { VEHICLE_LIMITS, isSimulatorPhysicsMode, arcadeTrackCornerSpeedLimit } from '../vehicle/vehiclePhysics.js';
import { BRAKING_LOOKAHEAD_MAX_DISTANCE, CURVATURE_LOOKAHEAD_SAMPLES, LOOKAHEAD_BASE_DISTANCE, PREVIEW_CURVATURE_CAP } from './driverControlConstants.js';

const LOOKAHEAD_SAMPLE_SCRATCH = { heading: 0, curvature: 0 };

export function arcadePreviewLookahead(speed) {
  return Math.min(speed * 3.15 + LOOKAHEAD_BASE_DISTANCE, BRAKING_LOOKAHEAD_MAX_DISTANCE);
}

export function maxLookaheadCurvature(track, progress, lookahead) {
  let maximum = 0;
  const sample = LOOKAHEAD_SAMPLE_SCRATCH;
  let previousHeading = sampleHeadingCurvatureAtInto(track, progress, sample).heading;
  const segmentDistance = Math.max(1, lookahead / CURVATURE_LOOKAHEAD_SAMPLES);
  for (let index = 1; index <= CURVATURE_LOOKAHEAD_SAMPLES; index += 1) {
    sampleHeadingCurvatureAtInto(track, progress + lookahead * (index / CURVATURE_LOOKAHEAD_SAMPLES), sample);
    const segmentCurvature = Math.abs(normalizeAngle(sample.heading - previousHeading)) / segmentDistance;
    maximum = Math.max(maximum, Math.abs(sample.curvature ?? 0), Math.min(segmentCurvature, PREVIEW_CURVATURE_CAP));
    previousHeading = sample.heading;
  }
  return maximum;
}

export function calculateRacingLineOffset(car, race, lookahead, curvature, edgeGuard) {
  const cornerStrength = clamp((curvature - 0.00012) / 0.00095, 0, 1);
  if (cornerStrength <= 0) return 0;

  const entryHeading = sampleHeadingAt(race.track, car.progress - lookahead * 0.35);
  const apexHeading = sampleHeadingAt(race.track, car.progress + lookahead * 0.55);
  const exitHeading = sampleHeadingAt(race.track, car.progress + lookahead * 1.25);
  const signedEntry = normalizeAngle(apexHeading - entryHeading);
  const signedExit = normalizeAngle(exitHeading - apexHeading);
  const turnDirection = Math.sign(Math.abs(signedEntry) > Math.abs(signedExit) ? signedEntry : signedExit);
  if (turnDirection === 0) return 0;

  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const simulatorMode = isSimulatorPhysicsMode(race.physicsMode);
  const safeEdge = race.track.width / 2 - VEHICLE_LIMITS.carWidth *
    (simulatorMode ? 2.05 - aggression * 0.08 : 1.15 - aggression * 0.12);
  const apexOffset = turnDirection * safeEdge *
    (simulatorMode ? 0.42 + aggression * 0.05 : 0.72 + aggression * 0.08);

  return apexOffset * cornerStrength * (1 - edgeGuard.pressure * (simulatorMode ? 0.82 : 0.65));
}

export function arcadePreviewSpeed(car, track, horizon, aggression) {
  const speed = simUnitsToMeters(car.speed);
  const lateralGripBudget = 14.8 + car.racecraft * 3.4 + (car.tireEnergy ?? 100) * 0.011 + aggression * 1.8;
  let target = 330 / 3.6;
  const spacing = metersToSimUnits(12);
  let previous = sampleHeadingAt(track, car.progress);
  const sample = { heading: 0, curvature: 0 };
  for (let distance = 0; distance <= horizon; distance += spacing) {
    sampleHeadingCurvatureAtInto(track, car.progress + distance, sample);
    const segmentCurve = distance > 0 ? Math.min(Math.abs(normalizeAngle(sample.heading - previous)) / spacing, PREVIEW_CURVATURE_CAP) : 0;
    previous = sample.heading;
    const curve = Math.max(Math.abs(sample.curvature), segmentCurve);
    const radius = simUnitsToMeters(1 / Math.max(curve, 1e-7));
    const ratedCorner = clamp(
      Math.sqrt(lateralGripBudget * radius) * 3.6 * (1.12 + aggression * 0.08) + (car.pace - 1) * 20 + aggression * 10,
      96,
      318,
    ) / 3.6;
    // Driver ratings and DRS may raise the pace target, but cannot exceed the tire/yaw limit.
    const physicalCorner = arcadeTrackCornerSpeedLimit(car, curve * metersToSimUnits(1), 0.85);
    const corner = Math.min(physicalCorner, ratedCorner + (car.drsActive ? 22 / 3.6 : 0));
    // Reserve half a second of travel before braking at a conservative 8 m/s².
    const availableDistance = Math.max(0, simUnitsToMeters(distance) - speed * 0.5);
    target = Math.min(target, Math.sqrt(corner ** 2 + 2 * 8 * availableDistance));
  }
  return target * 3.6;
}
