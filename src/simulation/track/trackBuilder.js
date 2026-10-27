import { CENTERLINE_CONTROLS, TRACK } from './trackConstants.js';
import { distance } from './trackMath.js';
import { rawCenterPoint } from './centerlineSpline.js';
import { recalculateSampleGeometry } from './sampleGeometry.js';
import { rotateSamplesToStandingStart, straightenStandingStartSamples } from './startStraight.js';
import { prepareSampleIndexLut } from './spatialQueries.js';
import { createTrackSectors } from './trackSectors.js';
import { deriveDrsZones, normalizeDrsZone } from './drsZones.js';
import { createPitLaneModel } from './pitLaneLayout.js';
import { attachTrackQueryIndex, createTrackQueryIndex } from './trackQueryConstruction.js';
import { attachTrackSnapshotJsonSerializer } from './trackSnapshotJson.js';
import { cacheTrackModel, getCachedTrackModel } from './trackModelCache.js';

export function buildTrackModel(track = TRACK) {
  const cached = getCachedTrackModel(track);
  if (cached) return cached;

  const controls = track.centerlineControls ?? CENTERLINE_CONTROLS;
  const base = [];
  for (let index = 0; index <= track.sampleCount; index += 1) {
    base.push(rawCenterPoint(index / track.sampleCount, controls, track.curveInterpolation));
  }

  let totalLength = 0;
  const samples = base.map((point, index) => {
    if (index > 0) totalLength += distance(base[index - 1], point);
    return { ...point, distance: totalLength, heading: 0, normalX: 0, normalY: 0, curvature: 0 };
  });
  recalculateSampleGeometry(samples);

  const startStraightOptions = track.generationOptions?.startStraight;
  const rotatedSamples = rotateSamplesToStandingStart(samples, totalLength, startStraightOptions);
  const straightenedTrack = straightenStandingStartSamples(rotatedSamples, totalLength, startStraightOptions);
  const normalizedSamples = straightenedTrack.samples;
  totalLength = straightenedTrack.totalLength;

  const model = {
    ...track,
    centerlineControls: controls,
    length: totalLength,
    samples: normalizedSamples,
    sectors: createTrackSectors(totalLength),
    drsZones: (track.drsZones ?? deriveDrsZones(normalizedSamples, totalLength))
      .map((zone) => normalizeDrsZone(zone, totalLength)),
  };
  model.pitLane = track.pitLane?.enabled === false || track.generationOptions?.pitLane?.enabled === false
    ? null
    : createPitLaneModel(model);
  attachTrackQueryIndex(model, createTrackQueryIndex(model));
  prepareSampleIndexLut(model);
  attachTrackSnapshotJsonSerializer(model);
  cacheTrackModel(track, model);
  return model;
}
