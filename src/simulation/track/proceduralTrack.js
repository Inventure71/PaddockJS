import { TRACK } from './trackConstants.js';
import { buildTrackModel } from './trackBuilder.js';
import { generateCenterlineControls, generateFallbackCenterlineControls, generateSafeFallbackCenterlineControls, normalizeSeed } from './proceduralCenterline.js';
import { isValidProceduralTrackModel } from './trackValidation.js';
import { resolveProceduralTrackOptions } from './trackGenerationOptions.js';
import { cacheProceduralTrackDefinition, getCachedProceduralTrack } from './trackModelCache.js';

export function createProceduralTrack(seed = Date.now(), options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const generationOptions = resolveProceduralTrackOptions(options);
  const cacheKey = `${normalizedSeed}:${generationOptions.cacheKey}`;
  const cached = getCachedProceduralTrack(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt < generationOptions.attempts.primary; attempt += 1) {
    const candidateSeed = (normalizedSeed + Math.imul(attempt, 2654435761)) >>> 0;
    const candidate = {
      ...TRACK,
      name: `Generated GP ${candidateSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: candidateSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateCenterlineControls(candidateSeed, generationOptions.shape),
      drsZones: null,
      generationOptions,
      ...(generationOptions.pitLane.enabled === false ? { pitLane: { enabled: false } } : {}),
    };
    const model = buildTrackModel(candidate);
    if (isValidProceduralTrackModel(model, generationOptions)) {
      const trackDefinition = {
        ...candidate,
        drsZones: model.drsZones.map(({ id, startRatio, endRatio }) => ({ id, startRatio, endRatio })),
      };
      return cacheProceduralTrackDefinition(cacheKey, trackDefinition, model);
    }
  }

  let fallback = null;
  let fallbackModel = null;
  for (let attempt = 0; attempt < generationOptions.attempts.fallback; attempt += 1) {
    const candidateSeed = (normalizedSeed ^ Math.imul(attempt + 1, 2246822519)) >>> 0;
    const candidate = {
      ...TRACK,
      name: `Generated GP ${normalizedSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: candidateSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateFallbackCenterlineControls(candidateSeed, generationOptions.shape),
      drsZones: null,
      generationOptions,
      ...(generationOptions.pitLane.enabled === false ? { pitLane: { enabled: false } } : {}),
    };
    const model = buildTrackModel(candidate);
    if (isValidProceduralTrackModel(model, generationOptions)) {
      fallback = candidate;
      fallbackModel = model;
      break;
    }
  }

  if (!fallback || !fallbackModel) {
    fallback = {
      ...TRACK,
      name: `Generated GP ${normalizedSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: normalizedSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateSafeFallbackCenterlineControls(normalizedSeed, generationOptions.shape),
      drsZones: null,
      generationOptions,
      ...(generationOptions.pitLane.enabled === false ? { pitLane: { enabled: false } } : {}),
    };
    fallbackModel = buildTrackModel(fallback);
  }
  const fallbackDefinition = {
    ...fallback,
    drsZones: fallbackModel.drsZones.map(({ id, startRatio, endRatio }) => ({ id, startRatio, endRatio })),
  };
  return cacheProceduralTrackDefinition(cacheKey, fallbackDefinition, fallbackModel);
}
