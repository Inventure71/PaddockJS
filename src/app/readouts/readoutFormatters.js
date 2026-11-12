export { formatCssColor } from '../../config/cssValues.js';

export { escapeHtml } from '../../ui/htmlEscaping.js';

export function getTireClass(tire) {
  return String(tire ?? 'M').toLowerCase();
}

export function formatTelemetryTime(value) {
  if (!Number.isFinite(value)) return '--';
  const rounded = Number(Math.max(0, value).toFixed(3));
  if (rounded >= 60) {
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }
  return `${rounded.toFixed(3)}s`;
}

export function setPerformanceClass(node, status) {
  ['overall-best', 'personal-best', 'slower'].forEach((name) => {
    node?.classList?.toggle?.(`is-${name}`, status === name);
  });
}

export function formatLapGap(laps) {
  const wholeLaps = Math.max(0, Math.floor(laps));
  return `+${wholeLaps}`;
}

export function formatRaceGap(car, mode) {
  const lapValue = mode === 'leader'
    ? car.leaderGapLaps
    : (car.intervalAheadLaps ?? car.gapAheadLaps);
  if (Number.isFinite(lapValue) && lapValue > 0) return formatLapGap(lapValue);

  const value = mode === 'leader'
    ? car.leaderGapSeconds
    : (car.intervalAheadSeconds ?? car.gapAheadSeconds);
  return Number.isFinite(value) ? `+${Math.max(0, value).toFixed(3)}` : '--';
}

export function formatTelemetryGap(car, mode) {
  const lapValue = mode === 'leader'
    ? car.leaderGapLaps
    : (car.intervalAheadLaps ?? car.gapAheadLaps);
  if (Number.isFinite(lapValue) && lapValue > 0) return formatLapGap(lapValue);

  const seconds = mode === 'leader'
    ? car.leaderGapSeconds
    : (car.intervalAheadSeconds ?? car.gapAheadSeconds);
  return Number.isFinite(seconds) ? `${seconds.toFixed(2)}s` : '--';
}
