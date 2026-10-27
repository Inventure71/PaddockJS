import { priority } from './surfacePriority.js';

export function resetWheelSummary(summary) {
  const trackLimits = summary.trackLimits ?? {
    violating: false,
    side: 0,
    outsideBy: 0,
  };
  summary.effectiveSurface = 'track';
  summary.effectivePriority = priority(summary.effectiveSurface);
  summary.representative = null;
  summary.allRightOutside = true;
  summary.allLeftOutside = true;
  summary.allOnTrackOrPit = true;
  summary.allInPitLane = true;
  summary.minimumSignedOffset = Infinity;
  summary.maximumSignedOffset = -Infinity;
  summary.trackLimits = trackLimits;
  return summary;
}

export function prepareWheelSummary(scratch) {
  if (!scratch) return null;
  const summary = scratch.summary ?? {};
  scratch.summary = summary;
  return resetWheelSummary(summary);
}

export function recordWheelSummary(summary, wheel) {
  const wheelPriority = priority(wheel.surface);
  if (wheelPriority > summary.effectivePriority) {
    summary.effectivePriority = wheelPriority;
    summary.effectiveSurface = wheel.surface;
  }
  if (!summary.representative || Math.abs(wheel.signedOffset) > Math.abs(summary.representative.signedOffset)) {
    summary.representative = wheel;
  }
  if (wheel.outsideSide !== 1) summary.allRightOutside = false;
  if (wheel.outsideSide !== -1) summary.allLeftOutside = false;
  if (!(wheel.onTrack || wheel.inPitLane)) summary.allOnTrackOrPit = false;
  if (!wheel.inPitLane) summary.allInPitLane = false;
  if (wheel.minimumSignedOffset < summary.minimumSignedOffset) summary.minimumSignedOffset = wheel.minimumSignedOffset;
  if (wheel.maximumSignedOffset > summary.maximumSignedOffset) summary.maximumSignedOffset = wheel.maximumSignedOffset;
  return summary;
}

export function finishWheelSummary(summary, track, trackLimit = track?.width / 2) {
  const trackLimits = summary.trackLimits;
  trackLimits.violating = false;
  trackLimits.side = 0;
  trackLimits.outsideBy = 0;
  if (track && (summary.allRightOutside || summary.allLeftOutside)) {
    const side = summary.allRightOutside ? 1 : -1;
    const outsideBy = summary.allRightOutside
      ? summary.minimumSignedOffset - trackLimit
      : -trackLimit - summary.maximumSignedOffset;
    trackLimits.violating = outsideBy > 0;
    trackLimits.side = side;
    trackLimits.outsideBy = Math.max(0, outsideBy);
  }
  return summary;
}

export function isWholeCarOutsideTrackLimits(wheels = [], track, relaxedMargin = 0) {
  if (!wheels.length || !track) {
    return {
      violating: false,
      side: 0,
      outsideBy: 0,
    };
  }
  const trackLimit = track.width / 2 + relaxedMargin;
  let right = true;
  let left = true;
  let minimumSignedOffset = Infinity;
  let maximumSignedOffset = -Infinity;
  for (let index = 0; index < wheels.length; index += 1) {
    const wheel = wheels[index];
    if (wheel.outsideSide !== 1) right = false;
    if (wheel.outsideSide !== -1) left = false;
    if (wheel.minimumSignedOffset < minimumSignedOffset) minimumSignedOffset = wheel.minimumSignedOffset;
    if (wheel.maximumSignedOffset > maximumSignedOffset) maximumSignedOffset = wheel.maximumSignedOffset;
  }
  if (!right && !left) {
    return {
      violating: false,
      side: 0,
      outsideBy: 0,
    };
  }
  const side = right ? 1 : -1;
  const outsideBy = right
    ? minimumSignedOffset - trackLimit
    : -trackLimit - maximumSignedOffset;

  return {
    violating: outsideBy > 0,
    side,
    outsideBy: Math.max(0, outsideBy),
  };
}
