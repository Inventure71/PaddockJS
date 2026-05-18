import { normalizeAngle } from '../simMath.js';
import { START_STRAIGHT_BLEND_LENGTH, START_STRAIGHT_EXIT_LENGTH, START_STRAIGHT_GRID_LENGTH, START_STRAIGHT_LOCK_EXTRA } from './trackConstants.js';
import { blendPoint, distanceForwardAlongTrack, pointWorldClearance, smoothstep } from './trackMath.js';
import { rebuildSampleDistances } from './sampleGeometry.js';

function resolveStartStraightOptions(options = {}) {
  return {
    grid: options.grid ?? START_STRAIGHT_GRID_LENGTH,
    exit: options.exit ?? START_STRAIGHT_EXIT_LENGTH,
    blend: options.blend ?? START_STRAIGHT_BLEND_LENGTH,
    lockExtra: options.lockExtra ?? START_STRAIGHT_LOCK_EXTRA,
  };
}

export function straightenStandingStartSamples(samples, totalLength, options = {}) {
  const startStraight = resolveStartStraightOptions(options);
  const start = samples[0];
  const forward = {
    x: Math.cos(start.heading),
    y: Math.sin(start.heading),
  };
  const gridLockLength = startStraight.grid + startStraight.lockExtra;
  const exitLockLength = startStraight.exit + startStraight.lockExtra;

  const straightened = samples.slice(0, -1).map((sample) => {
    const distanceFromStart = sample.distance;
    const distanceToStart = totalLength - sample.distance;
    let lineDistance = null;
    let blendAmount = 0;

    if (distanceFromStart <= exitLockLength + startStraight.blend) {
      lineDistance = distanceFromStart;
      blendAmount = distanceFromStart <= exitLockLength
        ? 1
        : 1 - smoothstep((distanceFromStart - exitLockLength) / startStraight.blend);
    } else if (distanceToStart <= gridLockLength + startStraight.blend) {
      lineDistance = -distanceToStart;
      blendAmount = distanceToStart <= gridLockLength
        ? 1
        : 1 - smoothstep((distanceToStart - gridLockLength) / startStraight.blend);
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

export function chooseStandingStartIndex(samples, totalLength, options = {}) {
  const startStraight = resolveStartStraightOptions(options);
  const usableSamples = samples.slice(0, -1);
  let best = { index: 0, score: Infinity };

  for (let index = 0; index < usableSamples.length; index += 1) {
    const candidate = usableSamples[index];
    const candidateForward = {
      x: Math.cos(candidate.heading),
      y: Math.sin(candidate.heading),
    };
    const projectedGridEnd = {
      x: candidate.x - candidateForward.x * startStraight.grid,
      y: candidate.y - candidateForward.y * startStraight.grid,
    };
    const projectedExitEnd = {
      x: candidate.x + candidateForward.x * startStraight.exit,
      y: candidate.y + candidateForward.y * startStraight.exit,
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
      if (distanceToLine > startStraight.grid) break;
      gridTurn = Math.max(gridTurn, Math.abs(normalizeAngle(candidate.heading - sample.heading)));
      gridCurvature += sample.curvature;
      gridCount += 1;
    }

    for (let offset = 1; offset < usableSamples.length; offset += 1) {
      const sample = usableSamples[(index + offset) % usableSamples.length];
      const distanceFromLine = distanceForwardAlongTrack(candidate.distance, sample.distance, totalLength);
      if (distanceFromLine > startStraight.exit) break;
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

export function rotateSamplesToStandingStart(samples, totalLength, options = {}) {
  const usableSamples = samples.slice(0, -1);
  const startIndex = chooseStandingStartIndex(samples, totalLength, options);
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
