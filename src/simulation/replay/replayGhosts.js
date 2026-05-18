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
  replayGhosts.forEach((ghost) => {
    const previous = {
      x: ghost.x,
      y: ghost.y,
      heading: ghost.heading,
    };
    const sample = interpolateTrajectory(ghost.trajectory, timeSeconds);
    Object.assign(ghost, {
      previousX: Number.isFinite(previous.x) ? previous.x : sample.x,
      previousY: Number.isFinite(previous.y) ? previous.y : sample.y,
      previousHeading: Number.isFinite(previous.heading) ? previous.heading : sample.heading,
      x: sample.x,
      y: sample.y,
      heading: sample.heading,
      speedKph: sample.speedKph,
      progressMeters: sample.progressMeters,
      timeSeconds,
    });
  });
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
  const initial = interpolateTrajectory(trajectory, 0);
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

function interpolateTrajectory(trajectory, timeSeconds) {
  if (trajectory.length === 1 || timeSeconds <= trajectory[0].timeSeconds) return { ...trajectory[0] };
  const last = trajectory[trajectory.length - 1];
  if (timeSeconds >= last.timeSeconds) return { ...last };
  const nextIndex = trajectory.findIndex((sample) => sample.timeSeconds >= timeSeconds);
  const previous = trajectory[Math.max(0, nextIndex - 1)];
  const next = trajectory[nextIndex];
  const span = next.timeSeconds - previous.timeSeconds || 1;
  const amount = clamp((timeSeconds - previous.timeSeconds) / span, 0, 1);
  return {
    timeSeconds,
    x: lerp(previous.x, next.x, amount),
    y: lerp(previous.y, next.y, amount),
    heading: previous.heading + normalizeAngle(next.heading - previous.heading) * amount,
    speedKph: lerp(previous.speedKph, next.speedKph, amount),
    progressMeters: lerp(previous.progressMeters, next.progressMeters, amount),
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
