export function normalizeTimingGapMode(value) {
  return value === 'leader' ? 'leader' : 'interval';
}

export function getTimingGapModeLabel(mode) {
  return normalizeTimingGapMode(mode) === 'leader' ? 'Gap' : 'Int';
}

export function getNextTimingGapMode(mode) {
  return normalizeTimingGapMode(mode) === 'leader' ? 'interval' : 'leader';
}
