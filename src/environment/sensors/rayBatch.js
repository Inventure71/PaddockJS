import { createCarRayMiss } from './carRays.js';
import { createTrackMiss, createTrackRayContext } from './trackRays.js';
import { canUseBatchTrainingRayApproximation } from './rayGuards.js';
import { degreesToRadians } from './rayGeometry.js';
import { createRayChannelContext, estimateCarHitForRay, estimateRayBands } from './rayQuery.js';
import { appendRayVectorValues, writeRayVectorValues, writeRichRay } from './rayOutputs.js';
import { getFilteredCarTargets, getNormalizedRayOptions, getRayOrigin, getRayScratch, getScratchRayVector, getSharedRayQuery, prepareScratchArray } from './rayScratch.js';

export function buildRaySensors(car, snapshot, rayOptions = {}, batchContext = null) {
  return buildRayBatch(car, snapshot, rayOptions, batchContext, 'rich');
}

export function buildRaySensorVectorValues(car, snapshot, rayOptions = {}, batchContext = null) {
  return buildRayBatch(car, snapshot, rayOptions, batchContext, 'vector');
}

export function appendRaySensorVectorValues(target, car, snapshot, rayOptions = {}, batchContext = null) {
  return buildRayBatch(car, snapshot, rayOptions, batchContext, 'append', target);
}

function buildRayBatch(car, snapshot, rayOptions, batchContext, output, target = null) {
  const scratch = getRayScratch(batchContext);
  const normalized = getNormalizedRayOptions(rayOptions, scratch);
  if (!normalized.enabled) return target ?? [];
  const channelContext = createRayChannelContext(normalized);
  const inactive = Boolean(car?.destroyed || car?.outOfRace);
  const origin = inactive ? null : getRayOrigin(car, scratch);
  const trackContext = !inactive && channelContext.hasRoadOrSurface
    ? createTrackRayContext(car, snapshot, origin, normalized.precision)
    : null;
  const carTargets = !inactive && channelContext.hasCar
    ? getFilteredCarTargets(car, snapshot, batchContext, scratch)
    : [];
  const skipEmptyCarQuery = output === 'rich' && canUseFastBatchTrainingRays(car, snapshot, trackContext) && carTargets.length === 0;
  const values = target ?? (output === 'rich'
    ? prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({})) ?? normalized.rays.map(() => ({}))
    : prepareScratchArray(scratch, 'rayVectorValues', 'rayVectorValuePool', normalized.rays.length, () => []) ?? normalized.rays.map(() => []));

  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const vector = inactive ? null : getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = inactive ? null : getSharedRayQuery(scratch, index);
    const { roadEdge, surfaceHits } = inactive
      ? { roadEdge: createTrackMiss(ray.lengthMeters), surfaceHits: {} }
      : estimateRayBands({
        car,
        snapshot,
        ray,
        angleDegrees: ray.angleDegrees,
        origin,
        vector,
        normalized,
        channelContext,
        trackContext,
        sharedRayQuery,
        scratch,
      });
    const carHit = !inactive && channelContext.hasCar && !skipEmptyCarQuery
      ? estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch)
      : createCarRayMiss(ray.lengthMeters);
    if (output === 'rich') {
      writeRichRay(values[index], ray, angleRadians, roadEdge, carHit, surfaceHits, channelContext.channels);
    } else if (output === 'vector') {
      writeRayVectorValues(values[index], ray.lengthMeters, roadEdge, carHit, surfaceHits, channelContext.surfaceChannels);
    } else {
      appendRayVectorValues(values, ray.lengthMeters, roadEdge, carHit, surfaceHits, channelContext.surfaceChannels);
    }
  }
  return values;
}

function canUseFastBatchTrainingRays(car, snapshot, trackContext) {
  return car?.interaction?.profile === 'batch-training' &&
    !car.inPitLane &&
    !trackContext?.originState?.inPitLane &&
    Array.isArray(snapshot.track?.samples) &&
    snapshot.track.samples.length > 0 &&
    trackContext?.originState &&
    canUseBatchTrainingRayApproximation(snapshot.track, trackContext.originState);
}
