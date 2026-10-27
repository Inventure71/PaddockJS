import { estimateCarHit } from './carRays.js';
import { createTrackMiss, estimateTrackHit } from './trackRays.js';
import { estimateSurfaceHits } from './surfaceRays.js';
import { traceIndexedRayBands } from './rayBandTrace.js';
import { createRayChannelFlags, writeRayChannelFlags } from './rayChannels.js';
import { getCarRayStats, getRayBandTraceStats } from './rayScratch.js';
import { MODEL_RAY_SURFACE_CHANNELS } from '../observationSchema.js';
import { pitOverrideAllowedForCar } from '../../simulation/track/trackStatePolicy.js';

const CHANNEL_CONTEXT = Symbol('rayChannelContext');

export function estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch) {
  return estimateCarHit(car, snapshot, ray.angleDegrees, ray.lengthMeters, origin, carTargets, {
    rayVector: vector,
    resultTarget: sharedRayQuery?.carHitResult,
    stats: getCarRayStats(scratch),
  });
}

export function createRayChannelContext(normalized) {
  if (normalized?.[CHANNEL_CONTEXT]) return normalized[CHANNEL_CONTEXT];
  const channels = writeRayChannelFlags(createRayChannelFlags(), normalized.channels);
  const context = {
    channels,
    surfaceChannels: MODEL_RAY_SURFACE_CHANNELS.filter((channel) => channels.has(channel)),
    hasRoadEdge: channels.hasRoadEdge,
    hasCar: channels.hasCar,
    hasRoadOrSurface: channels.hasRoadEdge || channels.surfaceChannels.length > 0,
  };
  if (normalized) {
    Object.defineProperty(normalized, CHANNEL_CONTEXT, {
      value: context,
      enumerable: false,
    });
  }
  return context;
}

export function estimateRayBands({
  car,
  snapshot,
  ray,
  angleDegrees,
  origin,
  vector,
  normalized,
  channelContext,
  trackContext,
  sharedRayQuery,
  scratch,
}) {
  const stats = getRayBandTraceStats(scratch);
  const canUseRayBandTrace = channelContext.hasRoadOrSurface &&
    trackContext?.originState;
  if (canUseRayBandTrace) {
    const direct = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters: ray.lengthMeters,
      originState: trackContext.originState,
      channels: channelContext.channels,
      precision: normalized.precision,
      sharedRayQuery,
      stats,
      validateBoundaries: car?.interaction?.profile !== 'batch-training',
      allowPitOverride: car?.interaction?.profile === 'batch-training'
        ? false
        : pitOverrideAllowedForCar(car),
      mainTrackOnly: car?.interaction?.profile === 'batch-training',
    });
    if (direct.available) {
      if (stats) {
        if (direct.path === 'sampled') stats.sampledPathCount += 1;
        else stats.directPathCount += 1;
      }
      return {
        roadEdge: direct.roadEdge,
        surfaceHits: {
          kerb: direct.kerb,
          illegalSurface: direct.illegalSurface,
        },
      };
    }
    if (stats) stats.fallbackCount += 1;
  }

  return {
    roadEdge: channelContext.hasRoadEdge
      ? estimateTrackHit(
        car,
        snapshot,
        angleDegrees,
        ray.lengthMeters,
        trackContext,
        { precision: normalized.precision, sharedRayQuery },
      )
      : createTrackMiss(ray.lengthMeters),
    surfaceHits: estimateSurfaceHits(
      car,
      snapshot,
      ray,
      origin,
      vector,
      channelContext.surfaceChannels,
      trackContext,
      { precision: normalized.precision, sharedRayQuery },
    ),
  };
}
