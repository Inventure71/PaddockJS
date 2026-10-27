export function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

export function visualFpsFromFrameGap(frameGapMs) {
  const gap = Number(frameGapMs);
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  return Math.round((1000 / gap) * 10) / 10;
}
