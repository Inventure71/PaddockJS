import { clamp, lerp, normalizeAngle } from '../simMath.js';

const DEFAULT_GHOST_COLOR = '#00ff84';
const DEFAULT_GHOST_OPACITY = 0.35;

export function normalizeReplayGhosts(replayGhosts = []) {
  if (!Array.isArray(replayGhosts)) return [];
  return replayGhosts
    .map((ghost, index) => normalizeReplayGhost(ghost, index))
    .filter(Boolean);
}

export function updateReplayGhosts(replayGhosts = [], timeSeconds = 0) {
  for (let index = 0; index < replayGhosts.length; index += 1) {
    const ghost = replayGhosts[index];
    const previousX = ghost.x;
    const previousY = ghost.y;
    const previousHeading = ghost.heading;
    interpolateTrajectoryInto(ghost, ghost.trajectory, timeSeconds);
    ghost.previousX = Number.isFinite(previousX) ? previousX : ghost.x;
    ghost.previousY = Number.isFinite(previousY) ? previousY : ghost.y;
    ghost.previousHeading = Number.isFinite(previousHeading) ? previousHeading : ghost.heading;
    ghost.timeSeconds = timeSeconds;
  }
}

export function serializeReplayGhosts(replayGhosts = []) {
  return replayGhosts.map((ghost) => ({
    id: ghost.id,
    label: ghost.label,
    color: ghost.color,
    opacity: ghost.opacity,
    visible: ghost.visible,
    previousX: ghost.previousX,
    previousY: ghost.previousY,
    x: ghost.x,
    y: ghost.y,
    previousHeading: ghost.previousHeading,
    heading: ghost.heading,
    speedKph: ghost.speedKph,
    progressMeters: ghost.progressMeters,
    timeSeconds: ghost.timeSeconds,
    sensors: { ...ghost.sensors },
  }));
}

function normalizeReplayGhost(ghost, index) {
  if (!ghost || typeof ghost !== 'object') return null;
  const trajectory = normalizeTrajectory(ghost.trajectory);
  if (trajectory.length === 0) return null;
  const id = String(ghost.id ?? `replay-ghost-${index + 1}`);
  const initial = interpolateTrajectoryInto({}, trajectory, 0);
  return {
    id,
    label: String(ghost.label ?? id),
    color: typeof ghost.color === 'string' && ghost.color ? ghost.color : DEFAULT_GHOST_COLOR,
    opacity: clamp(Number(ghost.opacity ?? DEFAULT_GHOST_OPACITY), 0, 1),
    visible: ghost.visible !== false,
    trajectory,
    sensors: {
      detectableByRays: Boolean(ghost.sensors?.detectableByRays),
      detectableAsNearby: Boolean(ghost.sensors?.detectableAsNearby),
    },
    previousX: initial.x,
    previousY: initial.y,
    x: initial.x,
    y: initial.y,
    previousHeading: initial.heading,
    heading: initial.heading,
    speedKph: initial.speedKph,
    progressMeters: initial.progressMeters,
    timeSeconds: 0,
  };
}

function normalizeTrajectory(trajectory) {
  if (!Array.isArray(trajectory)) return [];
  return trajectory
    .map((sample) => {
      const timeSeconds = finiteNumber(sample?.timeSeconds);
      const x = finiteNumber(sample?.x);
      const y = finiteNumber(sample?.y);
      const heading = finiteNumber(sample?.headingRadians ?? sample?.heading);
      if (timeSeconds == null || x == null || y == null || heading == null) return null;
      return {
        timeSeconds,
        x,
        y,
        heading,
        speedKph: finiteNumber(sample?.speedKph) ?? 0,
        progressMeters: finiteNumber(sample?.progressMeters) ?? 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function interpolateTrajectoryInto(target, trajectory, timeSeconds) {
  if (trajectory.length === 1 || timeSeconds <= trajectory[0].timeSeconds) {
    return writeTrajectorySample(target, trajectory[0]);
  }
  const last = trajectory[trajectory.length - 1];
  if (timeSeconds >= last.timeSeconds) return writeTrajectorySample(target, last);
  const nextIndex = lowerBoundTrajectoryTime(trajectory, timeSeconds);
  const previous = trajectory[Math.max(0, nextIndex - 1)];
  const next = trajectory[nextIndex];
  const span = next.timeSeconds - previous.timeSeconds || 1;
  const amount = clamp((timeSeconds - previous.timeSeconds) / span, 0, 1);
  target.x = lerp(previous.x, next.x, amount);
  target.y = lerp(previous.y, next.y, amount);
  target.heading = previous.heading + normalizeAngle(next.heading - previous.heading) * amount;
  target.speedKph = lerp(previous.speedKph, next.speedKph, amount);
  target.progressMeters = lerp(previous.progressMeters, next.progressMeters, amount);
  return target;
}

function lowerBoundTrajectoryTime(trajectory, timeSeconds) {
  let low = 0;
  let high = trajectory.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trajectory[middle].timeSeconds < timeSeconds) low = middle + 1;
    else high = middle;
  }
  return low;
}

function writeTrajectorySample(target, sample) {
  target.x = sample.x;
  target.y = sample.y;
  target.heading = sample.heading;
  target.speedKph = sample.speedKph;
  target.progressMeters = sample.progressMeters;
  return target;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
