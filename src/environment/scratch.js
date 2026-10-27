import { clearRayBatchContextScratch } from './sensors/rayScratch.js';

export function clearObservationScratch(scratch) {
  if (!scratch) return;
  scratch.carsById?.clear?.();
  scratch.eventsByDriver?.clear?.();
  scratch.controlledEventDrivers?.clear?.();
  clearRayBatchContextScratch(scratch.rayBatchContextScratch);
  if (Array.isArray(scratch.eventDriverIds)) scratch.eventDriverIds.length = 0;
}

export function clearMetricScratch(scratch) {
  if (!scratch) return;
  scratch.previousCarsById?.clear?.();
  scratch.currentCarsById?.clear?.();
  scratch.contactCounts?.clear?.();
  if (Array.isArray(scratch.eventDriverIds)) scratch.eventDriverIds.length = 0;
}
