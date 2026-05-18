export {
  createLapTelemetry,
  resetLapTelemetry,
  serializeLapTelemetry,
  updateLapTelemetry,
} from './lapTelemetry.js';
export { estimateGapAheadSeconds, estimateTimingLineGapSeconds, wholeLapGap } from './gapEstimation.js';
export { createEmptySectorPerformance, createEmptySectorTimes, updateSectorPerformance } from './sectorPerformance.js';
export { recordTimingSample, resetTimingHistory, trimTimingHistory } from './timingHistory.js';
export {
  createTimingLines,
  getTimingLineNumber,
  recordTimingLineCrossings,
  resetTimingLineCrossings,
} from './timingLines.js';
